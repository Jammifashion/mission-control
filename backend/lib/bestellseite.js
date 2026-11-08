// Bestellseite per Token (KS1): Reiter Bestellseiten, Bestell_Termine, Bestell_Bilder im SSOT (GOOGLE_SHEET_ID).
// Logik in utils/bestellseite.js. Katalog nur aus dem SSOT (Kategorien, Maske, Varianten, LShop_Modelle, Lieferbarkeit) plus
// Bild-URLs aus dem Zwischenspeicher Bestell_Bilder - die oeffentliche Seite greift NIE in den Shop (Hoster-Schutz).
// Den Zwischenspeicher fuellt nur der MC-Knopf "Artikelliste aktualisieren" (getWcClient, 2-s-Takt, nacheinander).
//
// Schreiben: eine Sperre je Instanz, frisch gelesen (UNFORMATTED), kein values.append (pruefeZielStrecke/ersetzeZeile),
// zurueckgelesen. Token-Klartext verlaesst diese Datei nur in der Antwort an MC, nie ins Sheet, nie ins Log.
// LK1: neue Links stehen zusaetzlich AES-256-GCM-verschluesselt in Token_Verschluesselt; `zeigeLink` gibt den Token fuer
// "Link kopieren" an MC (hinter dem API-Key). Ohne Schluessel oder Spalte: nur der Hash (wie KS1), Kopieren nicht verfuegbar.
// Log: nur Zugang_ID, Zahlen.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { pruefeZielStrecke, ersetzeZeile, zeilenAbweichungen, spalteBuchstabe } from './sheet-zeilen.js';
import { leseReiterSpalten } from './ssot-reiter.js';
import { leseLieferbarkeit } from './lieferbarkeitLesen.js';
import { ladeLShopZeilen, lshopAuswertung } from './lshop.js';
import { liesAuftraege, lshopInfo, nummernAus } from './auftraege.js';
import { leseKunden } from './kunden.js';
import { getWcClient } from './shopConfig.js';
import { seitenGrenze, seitenListe } from './hosterPruefseite.js';
import { zeilenAus, aktivePositionen } from '../utils/auftraege.js';
import {
  TAB_ZUGAENGE, TAB_TERMINE, TAB_EINTRAEGE, TAB_BILDER, ZUGANG_SPALTEN, ZUGANG_OPTIONAL, ZUGANG_ALLE, TERMIN_SPALTEN, BILD_SPALTEN,
  BILD_OPTIONAL, EINTRAG_SPALTEN, ART, STATUS, fehler, erzeugeToken, tokenHash, findeZugang, zugangStatus, anlagePlan, bearbeitenPlan,
  katalogDauer, katalogAuftrag, seitenAntwort, zugangFuerMc, sortimentNamen, trikotsDauer, zugangKontext,
  auswahlLesen, auswahlAus, abschlussPlan, abschlussNachricht, ZUGANG_KS6,
} from '../utils/bestellseite.js';
import { notify } from './chatNotify.js';
import { ladeLinkSchluessel } from './linkSchluessel.js';
import { verschluessele, tokenFuerMc, linkFehler } from '../utils/link-schluessel.js';
import { EINTRAG_OPTIONAL, OFFEN } from '../utils/bestell-eintraege.js';
import { GROESSEN_KINDER, GROESSEN_ERWACHSENE } from '../utils/trikot-intern.js';

const t = v => String(v ?? '').trim();
const KATALOG_MS = 5 * 60 * 1000;
export const TAKT_MS = 2000;
let katalogCache = new Map();   // Zugang_ID|Stand|Bilder-Stand -> { zeit, daten }  (KS2: Bilder-Stand im Schluessel)
export function _bestellseiteCacheLeeren() { katalogCache = new Map(); }

let laeuft = false;
/** Eine Sperre je Instanz fuer alle Schreiber der Bestellseite (MC und Seite). */
export async function mitSperre(fn) {
  if (laeuft) throw fehler('Bestellseiten werden gerade gespeichert – gleich noch einmal.', 409, 'laeuft_gerade');
  laeuft = true;
  try { return await fn(); } finally { laeuft = false; katalogCache = new Map(); }
}
export async function sheetsClient() { return google.sheets({ version: 'v4', auth: await getGoogleAuth() }); }
export function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  return id;
}
const istFehlenderReiter = err => err?.code === 400 || err?.response?.status === 400;

/** Zugaenge + Termine frisch lesen. Fehlen Reiter/Spalten -> 409 einrichtung. */
export async function liesZugaengeTermine(sheets, spreadsheetId) { return lies(sheets, spreadsheetId); }
async function lies(sheets, spreadsheetId) {
  let data;
  try {
    ({ data } = await sheets.spreadsheets.values.batchGet({
      spreadsheetId, ranges: [`'${TAB_ZUGAENGE}'`, `'${TAB_TERMINE}'`], valueRenderOption: 'UNFORMATTED_VALUE',
    }));
  } catch (err) {
    if (istFehlenderReiter(err)) throw fehler('Reiter Bestellseiten/Bestell_Termine fehlen – scripts/setup-bestellseiten-reiter.js --write.', 409, 'einrichtung');
    throw err;
  }
  const [wz = [], wt = []] = (data.valueRanges ?? []).map(v => v.values ?? []);
  const z = zeilenAus(wz, ZUGANG_SPALTEN, 'Zugang_ID', ZUGANG_OPTIONAL);
  const tr = zeilenAus(wt, TERMIN_SPALTEN, 'Termin_ID');
  if (!wz.length || !wt.length || z.fehlt.length || tr.fehlt.length) {
    throw fehler(`Spalten fehlen (${[...z.fehlt, ...tr.fehlt].join(', ') || 'Kopfzeile'}) – scripts/setup-bestellseiten-reiter.js.`, 409, 'einrichtung');
  }
  return { wz, wt, z, tr };
}

/** Objekt -> Zeile in Spaltenfolge des Reiters (jede bekannte Spalte, die das Objekt traegt). */
export const alsZeile = (idx, obj, breite) => {
  const z = Array.from({ length: breite }, () => '');
  for (const [s, i] of Object.entries(idx)) if (obj[s] !== undefined) z[i] = obj[s];
  return z;
};

/** KS2: Bestell_Eintraege lesen (fehlt der Reiter -> null). */
export async function liesEintraege(sheets, spreadsheetId) {
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_EINTRAEGE}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    const werte = data.values ?? [];
    const r = zeilenAus(werte, EINTRAG_SPALTEN, 'Eintrag_ID', EINTRAG_OPTIONAL);
    if (!werte.length || r.fehlt.length) return null;
    return { werte, ...r };
  } catch (err) {
    if (istFehlenderReiter(err)) return null;
    throw err;
  }
}

/** Neue Zeilen in mehreren Reitern in EINEM batchUpdate, danach zurueckgelesen. */
export async function schreibeBloecke(sheets, spreadsheetId, bloecke) {
  const data = [], strecken = [];
  for (const b of bloecke.filter(x => x.zeilen.length)) {
    const s = await pruefeZielStrecke(sheets, spreadsheetId, b.tab, b.alt, b.zeilen);
    strecken.push({ ...b, ...s });
    data.push({ range: s.range, values: b.zeilen });
  }
  if (!data.length) return;
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  const { data: zurueck } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId, ranges: strecken.map(s => s.range), valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const ab = strecken.reduce((n, s, i) => n + zeilenAbweichungen(s.zeilen, zurueck.valueRanges?.[i]?.values ?? []).length, 0);
  if (ab) throw fehler(`Bestellseiten: Rücklesen weicht in ${ab} Zelle(n) ab – bitte prüfen.`, 500, 'ruecklesen');
}

// ── SSOT-Stammdaten (nur lesen) ──────────────────────────────────────────────

export const leseKategorien = sheets => leseReiterSpalten({
  tab: 'Struktur_Kategorien', spalten: { nr: 'Kategorienummer', pfad: 'Kategorien', name: 'Kategoriename' }, sheets,
});
const leseMaske = sheets => leseReiterSpalten({
  tab: 'Erfassungsmaske', spalten: { id: 'ID', status: 'Status Shop', produktId: 'Produkt-ID', name: 'Produktname', kategorien: 'Kategorien' }, sheets,
});
const leseVarianten = sheets => leseReiterSpalten({
  tab: 'Varianten',
  spalten: { ssotId: 'SSOT-ID', E1: 'E1', V1: 'V1', aktiv: 'Aktiv', wcId: 'WC_Variation_ID' },
  optional: { E2: 'E2', V2: 'V2', E3: 'E3', V3: 'V3', articleNr: 'LShop_ArticleNr' }, sheets,
});

/** Bild-Zwischenspeicher: WC_ID -> { url, status }. Fehlt der Reiter: leer (Seite ohne Bilder). */
export async function leseBilder(sheets, spreadsheetId) {
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_BILDER}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    const r = zeilenAus(data.values ?? [], BILD_SPALTEN, 'WC_ID', BILD_OPTIONAL);
    if (r.fehlt.length) return { je: new Map(), stand: '' };
    const je = new Map(r.zeilen.map(x => [x.WC_ID, { url: x.Bild_URL, status: x.Status, kategorien: x.Kategorien }]));
    const stand = r.zeilen.map(x => x.Stand).filter(Boolean).sort().at(-1) ?? '';
    return { je, stand, werte: data.values ?? [] };
  } catch (err) {
    if (istFehlenderReiter(err)) return { je: new Map(), stand: '' };
    throw err;
  }
}

// ── Katalog je Zugang ────────────────────────────────────────────────────────

/** Trikots aus Trikot_Artikel (Business-Sheet), nur gelesen; fehlt der Reiter -> keine. */
async function leseTrikotArtikel(sheets) {
  const id = process.env.BUSINESS_SHEET_ID;
  if (!id) return [];
  try {
    return await leseReiterSpalten({ tab: 'Trikot_Artikel', spalten: { produktId: 'Produkt-ID' }, optional: { name: 'Produktname', aktiv: 'Aktiv' }, sheets, spreadsheetId: id });
  } catch { return []; }
}

/** Katalog eines Zugangs (5 min je Zugang + Stand + Bilder-Stand). KS2: exportiert fuer die Pruefung beim Absenden. */
export async function katalogFuer(sheets, spreadsheetId, zugang) {
  // KS2: der Stand der Bilder gehoert in den Schluessel - sonst zeigt eine Instanz nach "Artikelliste aktualisieren"
  // bis zu 5 min den alten Katalog ohne Bilder (Befund Inhaber 07.11.: alle Karten "ohne Bild").
  const bilder = zugang.Art === ART.DAUER ? await leseBilder(sheets, spreadsheetId) : { je: new Map(), stand: '' };
  const k = `${zugang.Zugang_ID}|${zugang.Stand}|${bilder.stand}`;
  const c = katalogCache.get(k);
  if (c && Date.now() - c.zeit < KATALOG_MS) return c.daten;
  const lb = await leseLieferbarkeit({ sheets, spreadsheetId });
  let daten;
  if (zugang.Art === ART.DAUER) {
    const [kategorien, maske, varianten, trikotArtikel] = [await leseKategorien(sheets), await leseMaske(sheets), await leseVarianten(sheets), await leseTrikotArtikel(sheets)];
    daten = {
      artikel: katalogDauer({ sortiment: zugang.Sortiment, kategorien, maske, varianten, lieferbarkeit: lb.je, bilder: bilder.je }), stand: bilder.stand,
      trikots: trikotsDauer({ sortiment: zugang.Sortiment, kategorien, trikotArtikel, bilder: bilder.je, groessen: [...GROESSEN_KINDER, ...GROESSEN_ERWACHSENE] }),
    };
  } else {
    const { a, p } = await liesAuftraege(sheets, spreadsheetId);
    const auftrag = a.zeilen.find(x => x.Auftrag_Nr === zugang.Auftrag_Nr);
    if (!auftrag) throw fehler('Diese Bestellseite gibt es nicht mehr.', 403, 'weg');
    const auswahl = auswahlLesen(zugang);   // KS6: Auswahl ohne Mengen; leer = Uebergang ueber die Positionen
    const pos = auswahl.length ? [] : aktivePositionen(p.zeilen, auftrag.Auftrag_Nr);
    const { info } = auswahl.length ? { info: new Map() } : await lshopInfo(sheets, spreadsheetId, nummernAus(pos));
    const modelle = auswahl.length ? new Set(auswahl.map(x => x.modell)) : new Set(pos.map(x => info.get(t(x.LShop_ArticleNr))?.modell).filter(Boolean));
    const groessenJe = await groessenJeModell(sheets, spreadsheetId, modelle, lb.je);
    daten = { artikel: katalogAuftrag({ auftrag, positionen: pos, info, groessenJe, auswahl }), stand: '', auftrag, trikots: [] };   // Auftrag: keine Trikots (Positionen kennen keine)
  }
  katalogCache.set(k, { zeit: Date.now(), daten });
  return daten;
}

/** Fuer jedes Modell: alle waehlbaren Groessen je Farbe (LShop_Modelle, ohne ausgelaufen/3/6) -> "modell|farbe" -> Groessen. */
async function groessenJeModell(sheets, spreadsheetId, modelle, lieferbarkeit) {
  if (!modelle.size) return new Map();
  const zeilen = await ladeLShopZeilen({ sheets, spreadsheetId });
  const aus = new Map();
  for (const m of modelle) {
    const a = lshopAuswertung(zeilen.filter(z => z.catalogNr === m), { lieferbarkeit });
    for (const v of a.varianten) {
      const k = `${m}|${v.farbe}`;
      if (!aus.has(k)) aus.set(k, []);
      aus.get(k).push({ articleNr: v.articleNr, groesse: v.groesse, lieferbar: v.lieferbar?.stufe ?? '' });
    }
  }
  return aus;
}

// ── Oeffentlich: GET /api/bestellseite/zugang ────────────────────────────────

/**
 * Token pruefen (gemeinsam fuer Lesen und Schreiben der Seite). Unbekannt 401, gesperrt/abgelaufen 403 (freundlicher Text).
 * @returns {{ zugang, daten }}  daten = gelesene Reiter Bestellseiten/Bestell_Termine
 */
export function pruefeZugang(daten, token, jetzt) {
  const zugang = findeZugang(daten.z.zeilen, token);
  if (!zugang) throw fehler('Bestellseite nicht gefunden.', 401, 'unbekannt');
  const st = zugangStatus(zugang, jetzt);
  if (st === STATUS.GESPERRT) throw fehler('Diese Bestellseite ist gesperrt. Bitte bei JammiFashion melden.', 403, 'gesperrt');
  if (st === STATUS.ABGELAUFEN) throw fehler('Dieser Link ist abgelaufen. Bitte bei JammiFashion einen neuen anfordern.', 403, 'abgelaufen');
  return zugang;
}
export async function liesFuerToken(sheets, spreadsheetId) {
  try { return await lies(sheets, spreadsheetId); } catch (err) {
    if (err.code === 'einrichtung') throw fehler('Bestellseite nicht gefunden.', 401, 'unbekannt');
    throw err;
  }
}
/** Termine eines Zugangs; Art auftrag: das Datum fuehrt der Auftrag (Termin), die Termin-Zeile traegt die ID. */
export function termineDesZugangs(daten, zugang, k) {
  const termine = daten.tr.zeilen.filter(x => x.Zugang_ID === zugang.Zugang_ID);
  if (zugang.Art !== ART.AUFTRAG || !k?.auftrag) return termine;
  return termine.map(x => ({ ...x, Datum: /^\d{4}-\d{2}-\d{2}$/.test(t(k.auftrag.Termin)) ? t(k.auftrag.Termin) : x.Datum }));
}

export async function leseSeite({ token, sheets: s, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  const daten = await liesFuerToken(sheets, spreadsheetId);
  const zugang = pruefeZugang(daten, token, jetzt());
  const k = await katalogFuer(sheets, spreadsheetId, zugang);
  const termine = termineDesZugangs(daten, zugang, k);
  // KS2: Zahl der Eintraege je Termin (ohne stornierte)
  const e = await liesEintraege(sheets, spreadsheetId);
  const anzahlJe = new Map();
  for (const x of e?.zeilen ?? []) if (x.Zugang_ID === zugang.Zugang_ID && t(x.Status) !== 'storniert') anzahlJe.set(x.Termin_ID, (anzahlJe.get(x.Termin_ID) ?? 0) + 1);
  const designLink = zugang.Art === ART.AUFTRAG && t(zugang.Design_Link_Zeigen) === 'ja' ? t(k.auftrag?.Design_Link) : '';
  return seitenAntwort({ zugang, termine, artikel: k.artikel, trikots: k.trikots, designLink, katalogStand: k.stand, anzahlJe, jetzt: jetzt() });
}

// ── MC: Liste, Anlegen, Bearbeiten, neuer Link ───────────────────────────────

export async function leseZugaenge({ sheets: s, jetzt = () => new Date(), schluesselLaden = ladeLinkSchluessel } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  const { z, tr } = await lies(sheets, spreadsheetId);
  const bilder = await leseBilder(sheets, spreadsheetId);
  return {
    zugaenge: z.zeilen.map(x => zugangFuerMc(x, jetzt(), tr.zeilen)).sort((a, b) => b.Zugang_ID.localeCompare(a.Zugang_ID)),
    bilderStand: bilder.stand, bilderAnzahl: bilder.je.size,
    spalten: { designLink: z.idx.Design_Link_Zeigen !== undefined, linkVerschluesselt: z.idx.Token_Verschluesselt !== undefined },
    linkSchluessel: Boolean(await schluesselLaden()),   // LK1: nur ja/nein, nie der Wert
  };
}

/** KS6: Werte fuer die neuen Spalten nur, wenn es die Spalte gibt - sonst gingen sie still verloren (409 einrichtung, nichts geschrieben). */
function ks6SpaltenPruefen(z, zugang, alt = {}) {
  const fehlt = ZUGANG_KS6.filter(s => z.idx[s] === undefined && t(zugang[s]) !== t(alt[s]));
  if (fehlt.length) throw fehler(`Spalten fehlen in Bestellseiten (${fehlt.join(', ')}) – erst scripts/setup-bestellseiten-reiter.js --write.`, 409, 'einrichtung');
}

/** KS6: waehlbare Farben je Modell (LShop_Modelle ueber lshopAuswertung, ohne ausgelaufen/3/6) fuer die Pruefung der Auswahl. */
async function farbenJeModell(sheets, spreadsheetId, modelle) {
  const zeilen = await ladeLShopZeilen({ sheets, spreadsheetId });
  const je = new Map();
  for (const m of new Set(modelle)) {
    const zm = zeilen.filter(x => x.catalogNr === m);
    if (!zm.length) continue;
    je.set(m, new Set(lshopAuswertung(zm).varianten.map(v => v.farbe)));
  }
  return je;
}

const kundeDaAus = kunden => nr => kunden.some(k => k.Kunden_Nr === nr && k.Status !== 'gesperrt-DSGVO' && k.Status !== 'archiviert');

/** Neuer Zugang. Antwort enthaelt den Token-Klartext EINMAL (nie gespeichert). Gleiche Vorgang-Kennung = schon angelegt. */
/**
 * LK1: verschluesselten Token in den Zugang legen (Spalte da + Schluessel da), sonst leeren - ein alter Wert gehoerte zum
 * alten Link. Liefert, ob der Link spaeter kopierbar ist.
 */
async function verschluesselt(z, zugang, token, schluesselLaden) {
  if (z.idx.Token_Verschluesselt === undefined) return false;
  const schluessel = await schluesselLaden();
  zugang.Token_Verschluesselt = schluessel ? verschluessele(token, schluessel, zugangKontext(zugang.Zugang_ID)) : '';
  return Boolean(zugang.Token_Verschluesselt);
}

export async function legeZugangAn({ eingabe, sheets: s, jetzt = () => new Date(), kundenLesen = leseKunden, zufall, schluesselLaden = ladeLinkSchluessel } = {}) {
  const vorgang = t(eingabe?.vorgang);
  if (!/^[\w-]{8,64}$/.test(vorgang)) throw fehler('Vorgangs-Kennung fehlt.', 422);
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { wz, wt, z, tr } = await lies(sheets, spreadsheetId);
    if (z.idx.Vorgang === undefined) throw fehler('Spalte Vorgang fehlt in Bestellseiten – scripts/setup-bestellseiten-reiter.js --write.', 409, 'einrichtung');
    const schon = z.zeilen.find(x => x.Vorgang === vorgang);
    if (schon) return { ok: true, schon: true, zugangId: schon.Zugang_ID };
    const art = t(eingabe?.art);
    const auftraege = art === ART.AUFTRAG ? (await liesAuftraege(sheets, spreadsheetId)).a.zeilen : [];
    const kategorien = art === ART.DAUER ? await leseKategorien(sheets) : [];
    const { kunden } = await kundenLesen();
    const plan = anlagePlan({ eingabe, zugaenge: z.zeilen, termine: tr.zeilen, auftraege, kategorien, kundeDa: kundeDaAus(kunden), jetzt: jetzt().toISOString() });
    if (plan.zugang.Design_Link_Zeigen && z.idx.Design_Link_Zeigen === undefined) throw fehler('Spalte Design_Link_Zeigen fehlt – Setup.', 409, 'einrichtung');
    ks6SpaltenPruefen(z, plan.zugang);
    const token = erzeugeToken(zufall);
    plan.zugang.Token_Hash = tokenHash(token);
    const kopierbar = await verschluesselt(z, plan.zugang, token, schluesselLaden);
    await schreibeBloecke(sheets, spreadsheetId, [
      { tab: TAB_ZUGAENGE, alt: wz, zeilen: [alsZeile(z.idx, plan.zugang, wz[0].length)] },
      { tab: TAB_TERMINE, alt: wt, zeilen: plan.termin ? [alsZeile(tr.idx, plan.termin, wt[0].length)] : [] },
    ]);
    console.log(`Bestellseite ${plan.zugang.Zugang_ID} angelegt (${plan.zugang.Art}).`);
    return { ok: true, schon: false, zugangId: plan.zugang.Zugang_ID, token, ablauf: plan.zugang.Ablauf, kopierbar };
  });
}

export async function ersetzeZugang(sheets, spreadsheetId, wz, z, alt, neu) {   // KS7: auch fuer den Entwurfs-Ordner
  const breite = wz[0].length;
  const altZeile = wz[alt._zeile - 1] ?? [];
  const neuZeile = Array.from({ length: breite }, (_, i) => altZeile[i] ?? '');
  for (const s of ZUGANG_ALLE) if (z.idx[s] !== undefined) neuZeile[z.idx[s]] = neu[s] ?? '';
  try {
    await ersetzeZeile(sheets, spreadsheetId, TAB_ZUGAENGE, alt._zeile, altZeile, neuZeile);
  } catch (err) {
    if (err.status === 409) throw fehler('Zugang wurde inzwischen geändert – bitte neu laden.', 409, 'konflikt');
    throw err;
  }
}

export async function bearbeiteZugang({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { wz, z } = await lies(sheets, spreadsheetId);
    const alt = z.zeilen.find(x => x.Zugang_ID === t(eingabe?.zugangId));
    const kategorien = eingabe?.sortiment !== undefined ? await leseKategorien(sheets) : [];
    // KS6: Auswahl gegen LShop_Modelle pruefen (Modell da, Farben waehlbar), bevor geplant wird
    const auswahlJson = eingabe?.auswahl !== undefined && alt?.Art === ART.AUFTRAG
      ? auswahlAus(eingabe.auswahl, await farbenJeModell(sheets, spreadsheetId, (Array.isArray(eingabe.auswahl) ? eingabe.auswahl : []).map(x => t(x?.modell)))) : undefined;
    const neu = bearbeitenPlan({ zugang: alt, eingabe: { ...eingabe, auswahlJson }, kategorien, jetzt: jetzt().toISOString() });
    ks6SpaltenPruefen(z, neu, alt);
    await ersetzeZugang(sheets, spreadsheetId, wz, z, alt, neu);
    console.log(`Bestellseite ${alt.Zugang_ID} geändert.`);
    return { ok: true, zugangId: alt.Zugang_ID, status: zugangStatus(neu, jetzt().toISOString()), stand: neu.Stand };
  });
}

/**
 * KS6: POST /api/bestellseite/abschliessen (oeffentlich, Bearer) - "Bestellung abschließen": nur wenn am Zugang erlaubt; danach liest die
 * Seite nur noch. Schreibt nur die Zugang-Zeile (Abgeschlossen + Stand). Chat danach (nur Zugang + Anzahl). Zweiter Klick = schon.
 */
export async function schliesseAb({ token, sheets: s, jetzt = () => new Date(), melden = notify } = {}) {
  const r = await mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const daten = await liesFuerToken(sheets, spreadsheetId);
    const zugang = pruefeZugang(daten, token, jetzt());
    const plan = abschlussPlan({ zugang, jetzt: jetzt().toISOString() });
    if (plan.schon) return { schon: true, abgeschlossen: zugang.Abgeschlossen };
    if (daten.z.idx.Abgeschlossen === undefined) throw fehler('Bestellseite ist noch nicht fertig eingerichtet – bitte bei JammiFashion melden.', 409, 'einrichtung');
    await ersetzeZugang(sheets, spreadsheetId, daten.wz, daten.z, zugang, plan.neu);
    const e = await liesEintraege(sheets, spreadsheetId);
    const anzahl = (e?.zeilen ?? []).filter(x => x.Zugang_ID === zugang.Zugang_ID && t(x.Status) !== 'storniert').length;
    console.log(`Bestellseite ${zugang.Zugang_ID}: abgeschlossen (${anzahl} Einträge).`);
    return { schon: false, abgeschlossen: plan.neu.Abgeschlossen, zugangId: zugang.Zugang_ID, anzahl };
  });
  if (!r.schon) await melden(abschlussNachricht({ zugangId: r.zugangId, anzahl: r.anzahl }));   // notify wirft nie
  return { ok: true, schon: r.schon, abgeschlossen: r.abgeschlossen };
}

/** Neuer Link: neuer Token, der alte ist sofort ungueltig. Klartext einmal in der Antwort. */
export async function neuerLink({ eingabe, sheets: s, jetzt = () => new Date(), zufall, schluesselLaden = ladeLinkSchluessel } = {}) {
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { wz, z } = await lies(sheets, spreadsheetId);
    const alt = z.zeilen.find(x => x.Zugang_ID === t(eingabe?.zugangId));
    if (!alt) throw fehler('Zugang gibt es nicht.', 404);
    if (t(eingabe?.stand) !== t(alt.Stand)) throw fehler('Zugang wurde inzwischen geändert – bitte neu laden.', 409, 'konflikt');
    const token = erzeugeToken(zufall);
    const neu = { ...alt, Token_Hash: tokenHash(token), Stand: jetzt().toISOString() };
    const kopierbar = await verschluesselt(z, neu, token, schluesselLaden);
    await ersetzeZugang(sheets, spreadsheetId, wz, z, alt, neu);
    console.log(`Bestellseite ${alt.Zugang_ID}: neuer Link erzeugt.`);
    return { ok: true, zugangId: alt.Zugang_ID, token, stand: neu.Stand, status: zugangStatus(neu, jetzt().toISOString()), kopierbar };
  });
}

/**
 * LK1: Token fuer "Link kopieren" (nur MC, hinter dem API-Key). Liest frisch, entschluesselt, prueft gegen den Hash.
 * Altbestand/ohne Schluessel/passt nicht -> 409 `link_alt` | `link_kein_schluessel` | `link_fehler` (Text ohne Wert).
 */
export async function zeigeLink({ zugangId, sheets: s, schluesselLaden = ladeLinkSchluessel } = {}) {
  const sheets = s ?? await sheetsClient();
  const { z } = await lies(sheets, sheetId());
  const zugang = z.zeilen.find(x => x.Zugang_ID === t(zugangId));
  if (!zugang) throw fehler('Zugang gibt es nicht.', 404);
  const wert = t(zugang.Token_Verschluesselt);
  const schluessel = wert ? await schluesselLaden() : null;
  const e = tokenFuerMc({ wert, hash: zugang.Token_Hash, schluessel, kontext: zugangKontext(zugang.Zugang_ID) });
  if (e.status !== 'ok') throw linkFehler(e.status);
  return { zugangId: zugang.Zugang_ID, token: e.token };
}

// ── MC-Knopf "Artikelliste aktualisieren": Bild-URLs schonend aus dem Shop ────

const warte = ms => new Promise(r => setTimeout(r, ms));

// KS2-2: Der Lauf dauerte am Stueck mehrere Minuten (gut 60 Shop-Abrufe im 2-s-Takt, je 2-4 s Antwort) - der Browser brach nach
// 60 s ab ("signal timed out"), Cloud Run (Standard 300 s) haette mit mehr Artikeln mitten im Lauf abgebrochen. Hintergrundarbeit
// nach der Antwort ist in Cloud Run nicht sicher (CPU gedrosselt). Darum in STUECKEN, gesteuert von MC:
//   1. bilderPlan     - liest nur das Sheet: welche Produkte (Maske + Trikots), Stand vorher. Schnell.
//   2. bilderStueck   - je Anfrage hoechstens STUECK_MAX Produkte aus dem Shop (Produkt + Variationen), schreibt nichts (~30 s).
//   3. bilderSchreiben - ganzer Reiter in EINEM values.update, nur wenn der Stand seit dem Plan gleich ist (sonst 409), zurueckgelesen.
// Die Zeilen wandern zwischen 2 und 3 ueber MC (hinter dem API-Key) und werden beim Schreiben erneut geprueft.
export const STUECK_MAX = 6;
const BILD_ARTEN = new Set(['produkt', 'variante']);

/** Plan: Produkt-IDs der nicht gesperrten Dauer-Sortimente (Maske, veroeffentlicht) + Trikots; Stand des Reiters vorher. */
export async function bilderPlan({ sheets: s, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  const { z } = await lies(sheets, spreadsheetId);
  const vorher = await leseBilder(sheets, spreadsheetId);
  if (!vorher.werte) throw fehler(`Reiter ${TAB_BILDER} fehlt – scripts/setup-bestellseiten-reiter.js --write.`, 409, 'einrichtung');
  const sortimente = z.zeilen.filter(x => x.Art === ART.DAUER && zugangStatus(x, jetzt().toISOString()) !== STATUS.GESPERRT).map(x => x.Sortiment);
  const [kategorien, maske] = [await leseKategorien(sheets), await leseMaske(sheets)];
  const namen = new Set(sortimente.flatMap(so => [...sortimentNamen(so, kategorien)]));
  const ids = [...new Set(maske.filter(a => t(a.produktId) && /^\d+$/.test(t(a.produktId)) && t(a.status) === 'Veröffentlicht'
    && t(a.kategorien).split(',').map(t).some(n => namen.has(n))).map(a => t(a.produktId)))];
  // KS2: Trikots (Trikot_Artikel) stehen nicht in der Maske - ihr Hauptbild + Kategorien kommen mit (ohne Variationen)
  const trikotIds = sortimente.length ? (await leseTrikotArtikel(sheets)).map(x => t(x.produktId)).filter(x => /^\d+$/.test(x) && !ids.includes(x)) : [];
  const stuecke = [];
  const alle = [...ids.map(id => ({ id, variationen: true })), ...trikotIds.map(id => ({ id, variationen: false }))];
  for (let i = 0; i < alle.length; i += STUECK_MAX) {
    const teil = alle.slice(i, i + STUECK_MAX);
    stuecke.push({ ids: teil.filter(x => x.variationen).map(x => x.id), ohneVariationen: teil.filter(x => !x.variationen).map(x => x.id) });
  }
  return { ok: true, produkte: ids.length, trikots: trikotIds.length, stuecke, vorherStand: vorher.stand, stand: jetzt().toISOString() };
}

/** Ein Stueck: Produkte (Hauptbild, Status, Kategorien) + Variationen der `ids`, nacheinander im Takt. Schreibt nichts. */
export async function bilderStueck({ ids = [], ohneVariationen = [], wc: wcTest, takt = TAKT_MS } = {}) {
  const nr = l => (Array.isArray(l) ? l.map(t).filter(x => /^\d+$/.test(x)) : []);
  const mit = [...new Set(nr(ids))], ohne = [...new Set(nr(ohneVariationen))].filter(x => !mit.includes(x));
  if (!mit.length && !ohne.length) throw fehler('Stück ohne Produkte.', 422);
  if (mit.length + ohne.length > STUECK_MAX) throw fehler(`Höchstens ${STUECK_MAX} Produkte je Stück.`, 422);
  const wc = wcTest ?? getWcClient('jfn');
  const zeilen = [];
  let abrufe = 0;
  const hole = async (pfad, params) => { if (abrufe++ && takt) await warte(takt); return (await wc.get(pfad, params)).data; };
  const liste = seitenListe(await hole('products', { include: [...mit, ...ohne].join(','), per_page: 100, _fields: 'id,status,images,categories' }), { wc, pfad: 'products' });
  for (const p of liste) zeilen.push([String(p.id), 'produkt', https(p.images?.[0]?.src), String(p.status ?? ''), (p.categories ?? []).map(c => c.id).join(',')]);
  for (const id of mit) {
    for (let page = 1; ; page++) {
      seitenGrenze(page, { wc, pfad: 'products/variations' });
      const v = seitenListe(await hole(`products/${id}/variations`, { per_page: 100, page, _fields: 'id,image' }), { wc, pfad: 'products/variations' });
      for (const x of v) zeilen.push([String(x.id), 'variante', https(x.image?.src), '', '']);
      if (v.length < 100) break;
    }
  }
  return { ok: true, zeilen, abrufe };
}

/** Eingehende Zeilen pruefen (kommen ueber MC): [WC_ID, Art, Bild_URL, Status, Kategorien]. */
export function bilderZeilenPruefen(zeilen) {
  if (!Array.isArray(zeilen) || zeilen.length > 5000) throw fehler('Zeilen fehlen oder zu viele.', 422);
  const gesehen = new Set();
  return zeilen.map((r, i) => {
    const [id, art, url, status, kat] = (Array.isArray(r) ? r : []).map(t);
    if (!/^\d+$/.test(id) || !BILD_ARTEN.has(art) || (url && !/^https:\/\/[^\s"'<>]+$/.test(url)) || !/^[a-z-]{0,20}$/.test(status) || !/^[\d,]*$/.test(kat)) {
      throw fehler(`Zeile ${i + 1} ungültig – nichts geschrieben.`, 422);
    }
    if (gesehen.has(id)) throw fehler(`WC_ID doppelt – nichts geschrieben.`, 422);
    gesehen.add(id);
    return [id, art, url, status, kat];
  });
}

/**
 * Schreiben: ganzer Reiter in EINEM values.update. Nur wenn der Stand seit dem Plan gleich ist (sonst 409, nichts geschrieben).
 * Rueckmeldung (KS2-1): neu / unveraendert / ohne Bild gegen den Stand vorher.
 */
export async function bilderSchreiben({ zeilen: roh, vorherStand = '', stand, produkte = 0, trikots = 0, abrufe = 0, sheets: s, jetzt = () => new Date(), dryRun = false } = {}) {
  const zeilen5 = bilderZeilenPruefen(roh);
  const standNeu = /^\d{4}-\d{2}-\d{2}T/.test(t(stand)) ? t(stand) : jetzt().toISOString();
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const vorher = await leseBilder(sheets, spreadsheetId);
    if (!vorher.werte) throw fehler(`Reiter ${TAB_BILDER} fehlt – scripts/setup-bestellseiten-reiter.js --write.`, 409, 'einrichtung');
    if (t(vorher.stand) !== t(vorherStand)) throw fehler('Bilder wurden inzwischen von einem anderen Lauf geändert – bitte noch einmal aktualisieren.', 409, 'konflikt');
    const zeilen = zeilen5.map(([id, art, url, status, kat]) => [id, art, url, status, standNeu, kat]);
    const neu = zeilen.filter(r => r[2] && vorher.je.get(r[0])?.url !== r[2]).length;
    const ohneBild = zeilen.filter(r => !r[2]).length;
    const ergebnis = { produkte: Number(produkte) || 0, trikots: Number(trikots) || 0, zeilen: zeilen.length, mitBild: zeilen.length - ohneBild, abrufe: Number(abrufe) || 0,
      bilderNeu: neu, bilderUnveraendert: zeilen.length - neu - ohneBild, ohneBild };
    if (dryRun) return { ok: true, dryRun: true, ...ergebnis };
    const kopf = vorher.werte[0];
    const idx = Object.fromEntries(kopf.map((k, j) => [t(k), j]));
    const breite = kopf.length;
    const spalten = [...BILD_SPALTEN, ...BILD_OPTIONAL];   // Kategorien nur, wenn die Spalte da ist (Setup)
    const voll = zeilen.map(r => { const x = Array.from({ length: breite }, () => ''); spalten.forEach((n, j) => { if (idx[n] !== undefined) x[idx[n]] = r[j] ?? ''; }); return x; });
    const leer = Math.max(0, vorher.werte.length - 1 - voll.length);
    const werte = [...voll, ...Array.from({ length: leer }, () => Array.from({ length: breite }, () => ''))];
    const ende = 1 + werte.length;
    if (werte.length) {
      const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId,gridProperties)' });
      const info = (meta.sheets ?? []).map(x => x.properties).find(p => p.title === TAB_BILDER);
      const raster = info?.gridProperties?.rowCount ?? 0;
      if (raster < ende) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ appendDimension: { sheetId: info.sheetId, dimension: 'ROWS', length: ende - raster } }] } });
      const range = `'${TAB_BILDER}'!A2:${spalteBuchstabe(breite - 1)}${ende}`;
      await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: werte } });
      const { data: zur } = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' });
      if (zeilenAbweichungen(werte, zur.values ?? []).length) throw fehler('Bilder: Rücklesen weicht ab – bitte prüfen.', 500, 'ruecklesen');
    }
    console.log(`Bestellseite Bilder: ${ergebnis.produkte} Produkte, ${ergebnis.zeilen} Zeilen geschrieben.`);
    return { ok: true, ...ergebnis, stand: standNeu };
  });
}

/** Alles in einem Zug (Tests, Trockenlauf von Hand): Plan -> alle Stuecke -> Schreiben. MC nutzt die drei Schritte einzeln. */
export async function aktualisiereBilder({ sheets, wc, jetzt = () => new Date(), takt = TAKT_MS, dryRun = false } = {}) {
  const plan = await bilderPlan({ sheets, jetzt });
  const zeilen = [];
  let abrufe = 0;
  for (const st of plan.stuecke) {
    const r = await bilderStueck({ ...st, wc, takt });
    zeilen.push(...r.zeilen); abrufe += r.abrufe;
  }
  return bilderSchreiben({ zeilen, vorherStand: plan.vorherStand, stand: plan.stand, produkte: plan.produkte, trikots: plan.trikots, abrufe, sheets, jetzt, dryRun });
}
const https = u => (/^https:\/\/[^\s"'<>]+$/.test(t(u)) ? t(u) : '');

export { TAB_EINTRAEGE };
