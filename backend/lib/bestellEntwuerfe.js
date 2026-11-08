// KS7: Entwuerfe aus einem Google-Drive-Ordner auf der Bestellseite. Logik in utils/bestell-entwuerfe.js.
//
// Ablage (Entscheidung, bericht-KS7 0.2): NUR Ordner in der geteilten Ablage "Mission Control" (Pruefung driveId). Das Dienstkonto
// liest dort mit drive.readonly (getGoogleAuth); nichts wird oeffentlich geteilt. "Ordner anlegen" legt `Entwürfe/<AU-Nr bzw. BS-Nr>`
// ueber lib/belegArchiv.js an (einzige Drive-Schreibstelle, Scope drive.file).
// Ausliefern: nur nach Token-Pruefung (Seite) bzw. API-Key (MC); Antwort nur nr/titel/breite/hoehe, Bilder als Bytes - nie Drive-ID,
// Drive-Adresse oder thumbnailLink (der ist ohne Anmeldung abrufbar, Messung 08.11.). Log: nur Zugang_ID und Zahlen.
// Zwischenspeicher: Liste 60 s je Ordner; Bilder je Datei-ID + Aenderungszeit + Groesse (eine geaenderte Datei = neuer Schluessel),
// hoechstens 80 Bilder / 40 MB je Instanz.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { richteEntwurfOrdnerEin } from './belegArchiv.js';
import { mitSperre, sheetsClient, sheetId, liesFuerToken, pruefeZugang, liesZugaengeTermine, ersetzeZugang } from './bestellseite.js';
import {
  ordnerIdAus, entwurfListe, fuerSeite, auslieferWeg, vorschauUrl, nrAus, fehler, ORDNER_MIME, ANTWORT_MAX_BYTE, BILD_TYPEN,
} from '../utils/bestell-entwuerfe.js';

const t = v => String(v ?? '').trim();
export const LISTE_MS = 60 * 1000;
const BILD_MS = 10 * 60 * 1000, BILD_ANZAHL = 80, BILD_BYTE = 40 * 1024 * 1024, ZEIT_MS = 15000;
let listen = new Map();   // ordnerId -> { zeit, daten }
let bilder = new Map();   // "<id>|<stand>|<groesse>" -> { zeit, buf, typ }
export function _entwurfCacheLeeren() { listen = new Map(); bilder = new Map(); }

let _drive = null;
async function driveLesen() { if (!_drive) _drive = google.drive({ version: 'v3', auth: await getGoogleAuth() }); return _drive; }   // drive.readonly
const geteilteAblage = () => process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID;

/** Ordner pruefen: gibt es, ist ein Ordner, liegt in der geteilten Ablage, nicht im Papierkorb. Fehlertexte ohne ID. */
export async function pruefeOrdner(drive, id, driveId = geteilteAblage()) {
  let data;
  try {
    ({ data } = await drive.files.get({ fileId: id, fields: 'id,mimeType,driveId,trashed', supportsAllDrives: true }));
  } catch (err) {
    const st = err?.code ?? err?.response?.status;
    if ([403, 404].includes(Number(st))) throw fehler('Ordner nicht gefunden oder für Mission Control nicht lesbar – bitte einen Ordner in der Ablage „Mission Control“ nehmen.', 422, 'ordner');
    throw fehler(`Drive nicht erreichbar${st ? ` (${st})` : ''} – gleich noch einmal.`, 502, 'drive');
  }
  if (data.mimeType !== ORDNER_MIME) throw fehler('Der Link zeigt nicht auf einen Ordner.', 422, 'ordner');
  if (!driveId || data.driveId !== driveId) throw fehler('Der Ordner liegt nicht in der Ablage „Mission Control“ – bitte dort anlegen (oder „Ordner anlegen“).', 422, 'ordner');
  if (data.trashed) throw fehler('Der Ordner liegt im Papierkorb.', 422, 'ordner');
  return true;
}

/** Entwuerfe eines Ordners (60 s zwischengespeichert). -> { liste, mehr, ausgelassen } */
export async function leseEntwuerfe(ordnerId, { drive: d, jetzt = Date.now } = {}) {
  const c = listen.get(ordnerId);
  if (c && jetzt() - c.zeit < LISTE_MS) return c.daten;
  const drive = d ?? await driveLesen();
  const dateien = [];
  let pageToken;
  try {
    for (let seite = 0; seite < 5; seite++) {
      const { data } = await drive.files.list({
        corpora: 'drive', driveId: geteilteAblage(), includeItemsFromAllDrives: true, supportsAllDrives: true,
        q: `'${ordnerId}' in parents and trashed = false`, pageSize: 100, pageToken,
        fields: 'nextPageToken,files(id,name,mimeType,size,thumbnailLink,imageMediaMetadata(width,height),modifiedTime,trashed)',
      });
      dateien.push(...(data.files ?? []));
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
  } catch (err) {
    const st = err?.code ?? err?.response?.status;
    throw fehler(`Entwürfe gerade nicht lesbar${st ? ` (${st})` : ''}.`, [403, 404].includes(Number(st)) ? 404 : 502, 'drive');
  }
  const daten = entwurfListe(dateien);
  listen.set(ordnerId, { zeit: jetzt(), daten });
  return daten;
}

function bildMerken(k, eintrag) {
  bilder.set(k, eintrag);
  let summe = [...bilder.values()].reduce((s, x) => s + x.buf.length, 0);
  for (const [key, x] of bilder) {
    if (bilder.size <= BILD_ANZAHL && summe <= BILD_BYTE) break;
    bilder.delete(key); summe -= x.buf.length;
  }
}

/** Bild-Bytes eines Entwurfs holen (Vorschaubild ohne Anmeldung vom Google-Bildhost bzw. Datei ueber alt=media). */
export async function ladeEntwurfBild(e, groesse, { drive: d, holen = fetch, jetzt = Date.now } = {}) {
  const g = groesse === 'gross' ? 'gross' : 'klein';
  const k = `${e._id}|${e._stand}|${g}`;
  const c = bilder.get(k);
  if (c && jetzt() - c.zeit < BILD_MS) return c;
  const w = auslieferWeg(e, g);
  let buf, typ;
  if (w.weg === 'vorschau') {
    const url = vorschauUrl(e._thumb, w.px);
    if (!url) throw fehler('Für diesen Entwurf gibt es kein Vorschaubild.', 404, 'kein_bild');
    let res;
    try {
      res = await holen(url, { redirect: 'error', signal: AbortSignal.timeout(ZEIT_MS) });
      // Rueckfall: verlangt der Bildhost doch eine Anmeldung, mit dem Lese-Token des Dienstkontos (nur an *.googleusercontent.com)
      if ([401, 403].includes(res.status)) {
        const tok = (await (await (await getGoogleAuth()).getClient()).getAccessToken())?.token;
        if (tok) res = await holen(url, { redirect: 'error', headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(ZEIT_MS) });
      }
    } catch { throw fehler('Vorschaubild gerade nicht erreichbar.', 502, 'drive'); }
    if (!res.ok) throw fehler(`Vorschaubild gerade nicht erreichbar (${res.status}).`, 502, 'drive');
    typ = String(res.headers.get('content-type') ?? '').split(';')[0].trim();
    buf = Buffer.from(await res.arrayBuffer());
  } else {
    const drive = d ?? await driveLesen();
    try {
      const r = await drive.files.get({ fileId: e._id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
      buf = Buffer.from(r.data);
    } catch (err) {
      const st = err?.code ?? err?.response?.status;
      throw fehler(`Entwurf gerade nicht lesbar${st ? ` (${st})` : ''}.`, 502, 'drive');
    }
    typ = e._mime;
  }
  if (!BILD_TYPEN.includes(typ)) throw fehler('Kein Bild.', 502, 'kein_bild');
  if (buf.length > ANTWORT_MAX_BYTE) throw fehler('Entwurf ist zu groß.', 413, 'zu_gross');
  const eintrag = { zeit: jetzt(), buf, typ };
  bildMerken(k, eintrag);
  return eintrag;
}

// ── Oeffentlich (Token) ──────────────────────────────────────────────────────

async function zugangFuerToken(token, sheets, jetzt) {
  const s = sheets ?? await sheetsClient();
  const daten = await liesFuerToken(s, sheetId());
  return pruefeZugang(daten, token, jetzt);
}

/** GET /api/bestellseite/entwuerfe -> { entwuerfe: [{nr, titel, breite, hoehe}], mehr }. Ohne Ordner: leere Liste. */
export async function entwuerfeSeite({ token, sheets, drive, jetzt = () => new Date() } = {}) {
  const zugang = await zugangFuerToken(token, sheets, jetzt());
  const ordner = t(zugang.Entwurf_Ordner);
  if (!ordner) return { entwuerfe: [], mehr: false };
  const d = await leseEntwuerfe(ordner, { drive });
  return { entwuerfe: d.liste.map(fuerSeite), mehr: d.mehr };
}

/** GET /api/bestellseite/entwurf/:nr?groesse=klein|gross -> { buf, typ } (nur Bilder dieses Zugangs). */
export async function entwurfBildSeite({ token, nr, groesse, sheets, drive, holen, jetzt = () => new Date() } = {}) {
  const n = nrAus(nr);
  const zugang = await zugangFuerToken(token, sheets, jetzt());
  return bildAusOrdner(t(zugang.Entwurf_Ordner), n, groesse, { drive, holen });
}

async function bildAusOrdner(ordner, n, groesse, { drive, holen } = {}) {
  if (!ordner) throw fehler('Entwurf gibt es nicht.', 404, 'kein_bild');
  const d = await leseEntwuerfe(ordner, { drive });
  const e = d.liste.find(x => x.nr === n);
  if (!e) throw fehler('Entwurf gibt es nicht.', 404, 'kein_bild');
  return ladeEntwurfBild(e, groesse, { drive, holen });
}

// ── MC (hinter dem API-Key) ──────────────────────────────────────────────────

async function zugangMc(zugangId, sheets) {
  const s = sheets ?? await sheetsClient();
  const daten = await liesZugaengeTermine(s, sheetId());
  const zugang = daten.z.zeilen.find(x => x.Zugang_ID === t(zugangId));
  if (!zugang) throw fehler('Zugang gibt es nicht.', 404);
  return { zugang, daten, sheets: s };
}

/** GET /api/bestellseiten/:zugangId/entwuerfe -> Liste wie die Seite + Anzahl ausgelassener Dateien (andere Typen). */
export async function entwuerfeMc({ zugangId, sheets, drive } = {}) {
  const { zugang } = await zugangMc(zugangId, sheets);
  const ordner = t(zugang.Entwurf_Ordner);
  if (!ordner) return { ordner: false, entwuerfe: [], mehr: false, ausgelassen: 0 };
  const d = await leseEntwuerfe(ordner, { drive });
  return { ordner: true, entwuerfe: d.liste.map(fuerSeite), mehr: d.mehr, ausgelassen: Math.max(0, d.ausgelassen) };
}

/** GET /api/bestellseiten/:zugangId/entwurf/:nr - dieselben Bilder fuer die Vorschau in MC. */
export async function entwurfBildMc({ zugangId, nr, groesse, sheets, drive, holen } = {}) {
  const n = nrAus(nr);
  const { zugang } = await zugangMc(zugangId, sheets);
  return bildAusOrdner(t(zugang.Entwurf_Ordner), n, groesse, { drive, holen });
}

/**
 * POST /api/bestellseiten/entwuerfe/ordner { zugangId, stand, link } | { …, anlegen: true } | { …, entfernen: true }
 * Ordner pruefen (Ablage "Mission Control") bzw. `Entwürfe/<AU-Nr|BS-Nr>` anlegen, dann nur Entwurf_Ordner + Stand des Zugangs schreiben.
 * -> { ok, zugangId, stand, anzahl, mehr, ordnerId (nur MC) }
 */
export async function setzeEntwurfOrdner({ eingabe, sheets: s, drive, anleger = richteEntwurfOrdnerEin, jetzt = () => new Date() } = {}) {
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const daten = await liesZugaengeTermine(sheets, spreadsheetId);
    const alt = daten.z.zeilen.find(x => x.Zugang_ID === t(eingabe?.zugangId));
    if (!alt) throw fehler('Zugang gibt es nicht.', 404);
    if (t(eingabe?.stand) !== t(alt.Stand)) throw fehler('Zugang wurde inzwischen geändert – bitte neu laden.', 409, 'konflikt');
    if (daten.z.idx.Entwurf_Ordner === undefined) throw fehler('Spalte Entwurf_Ordner fehlt in Bestellseiten – erst scripts/setup-bestellseiten-reiter.js --write.', 409, 'einrichtung');
    const lesen = drive ?? await driveLesen();
    let id = '';
    if (eingabe?.entfernen === true) id = '';
    else if (eingabe?.anlegen === true) {
      const r = await anleger({ name: t(alt.Auftrag_Nr) || alt.Zugang_ID, write: true });
      if (!r.id) throw fehler('Ordner wurde nicht angelegt – bitte noch einmal.', 502, 'drive');
      id = r.id;
    } else {
      id = ordnerIdAus(eingabe?.link);
      if (!id) throw fehler('Bitte den Link eines Drive-Ordners einfügen (…/folders/…).', 422, 'ordner');
    }
    if (id) await pruefeOrdner(lesen, id);
    const neu = { ...alt, Entwurf_Ordner: id, Stand: jetzt().toISOString() };
    await ersetzeZugang(sheets, spreadsheetId, daten.wz, daten.z, alt, neu);
    listen.delete(id);
    const d = id ? await leseEntwuerfe(id, { drive: lesen }) : { liste: [], mehr: false };
    console.log(`Bestellseite ${alt.Zugang_ID}: Entwurfs-Ordner ${id ? (eingabe?.anlegen ? 'angelegt' : 'gesetzt') : 'entfernt'} (${d.liste.length} Entwürfe).`);
    return { ok: true, zugangId: alt.Zugang_ID, stand: neu.Stand, anzahl: d.liste.length, mehr: d.mehr, ordnerId: id };
  });
}
