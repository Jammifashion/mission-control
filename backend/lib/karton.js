// Karton-Scan (BO4b-5 Schritt 2) - Ein-/Ausgabe, Logik in utils/karton.js.
//  - POST /api/bestellen/lshop-korb/karton/pruefen     { link }           -> kartonPruefen()     liest, schreibt nichts
//  - POST /api/bestellen/lshop-korb/karton/angekommen  { link, auswahl }  -> kartonAngekommen()  "Karton angekommen"
//
// ⚠️ Der Link enthaelt unsere L-Shop-Kundennummer: er lebt nur in diesem Aufruf. Nie speichern, loggen,
// zurueckgeben, nie in Fehlertexte (auch nicht die Fehlertexte von fetch). Abruf nur fuer Links mit genau dem
// Muster KARTON_LINK; die Kundennummer im Link muss still zu Config lshop.customer_id passen.
// Angekommen: PDF erneut lesen (nie dem Browser glauben), unter der Korb-Sperre abgleichen, PDF archivieren
// (Karton/<Jahr>/<LA>_<Karton-ID>.pdf, Name + MD5, nie ueberschreiben), dann derselbe Schreibweg wie
// "Ware angekommen" (bucheEingangInSperre), dann eine Zeile LShop_Kartons (ohne append). Nie loeschen.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { mitKorbSperre } from './lshopKorb.js';
import { leseCustomerId } from './lshopEdi.js';
import { archiviere, ArchivFehler, ArchivKonflikt } from './belegArchiv.js';
import { reiter, haengeAn, legeReiterAn } from './lshopBelege.js';
import { bucheEingangInSperre } from './wareneingang.js';
import { normHeader } from '../utils/sheet-headers.js';
import { TAB_KORB, korbZeilen } from '../utils/korb-logic.js';
import { referenzFuer } from '../utils/edi-bestellung.js';
import {
  kartonLink, leseKartonPdf, kartonAbgleich, kartonDatei, KARTONS_TAB, KARTONS_SPALTEN, MAX_KARTON_BYTES, AMPEL,
} from '../utils/karton.js';

export const KARTON_ZEITLIMIT_MS = 15_000;
const q = tab => `'${tab}'`;
const t = v => String(v ?? '').trim();
function fehler(msg, status, extra = {}) { const e = new Error(msg); e.status = status; Object.assign(e, extra); return e; }

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}
async function werte(sheets, spreadsheetId, tab) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: q(tab), valueRenderOption: 'FORMATTED_VALUE' });
  return data.values ?? [];
}

/** PDF laden. Jeder Fehlertext ohne Link. */
export async function ladeKartonPdf(link, { holen = fetch } = {}) {
  let res;
  try {
    res = await holen(link, { redirect: 'error', signal: AbortSignal.timeout(KARTON_ZEITLIMIT_MS) });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw fehler('Karton-PDF: keine Antwort von L-Shop (Zeitlimit) - später noch einmal.', 504);
    throw fehler('Karton-PDF: L-Shop nicht erreichbar - später noch einmal.', 502);
  }
  if (res.status === 404) throw fehler('Karton-PDF nicht gefunden (404) - QR-Code noch einmal scannen.', 404);
  if (!res.ok) throw fehler(`Karton-PDF: L-Shop antwortet mit ${res.status}.`, 502);
  const laenge = Number(res.headers?.get?.('content-length') ?? 0);
  if (laenge > MAX_KARTON_BYTES) throw fehler('Karton-PDF ist zu groß.', 422);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_KARTON_BYTES) throw fehler('Karton-PDF ist zu groß.', 422);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw fehler('Karton-Link liefert keine PDF.', 422);
  return buf;
}

/** Link pruefen, Konto vergleichen, PDF lesen. -> { kartonId, buf, karton } */
async function holeKarton({ link, sheets, holen }) {
  const { kunde, kartonId } = kartonLink(link);
  const unsere = await leseCustomerId({ sheets });
  if (!unsere) throw fehler('lshop.customer_id fehlt im Reiter Config - Karton kann nicht zugeordnet werden.', 422);
  if (t(unsere) !== kunde) throw fehler('Karton nicht von unserem L-Shop-Konto.', 422);
  const buf = await ladeKartonPdf(link, { holen });
  return { kartonId, buf, karton: leseKartonPdf(buf) };
}

/** LShop_Kartons lesen (fehlt der Reiter -> info null). -> { info, alt, schonDa } */
async function leseKartons(sheets, spreadsheetId, kartonId) {
  const info = await reiter(sheets, spreadsheetId, KARTONS_TAB);
  if (!info) return { info: null, alt: [], schonDa: null };
  const alt = await werte(sheets, spreadsheetId, KARTONS_TAB);
  const norm = (alt[0] ?? []).map(normHeader);
  const fehlen = KARTONS_SPALTEN.filter(n => !norm.includes(normHeader(n)));
  if (fehlen.length) throw fehler(`${KARTONS_TAB}: Spalte(n) fehlen: ${fehlen.join(', ')}.`, 422);
  const i = n => norm.indexOf(normHeader(n));
  const r = alt.slice(1).find(z => t(z[i('Karton_ID')]) === kartonId);
  return { info, alt, schonDa: r ? { Eingang: t(r[i('Eingang')]) } : null, idx: i };
}

function antwort(kartonId, karton, abgleich) {
  return {
    kartonId, orderId: karton.orderId, la: karton.la, va: karton.va, stueck: karton.stueck,
    hinweise: karton.hinweise, ...abgleich,
  };
}

/** Pruefen: lesen und abgleichen, nichts schreiben. */
export async function kartonPruefen({ link, sheets: s, holen } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  const { kartonId, karton } = await holeKarton({ link, sheets, holen });
  const { zeilen } = korbZeilen(await werte(sheets, spreadsheetId, TAB_KORB));
  const { schonDa } = await leseKartons(sheets, spreadsheetId, kartonId);
  return antwort(kartonId, karton, kartonAbgleich({ karton, korbZeilen: zeilen, referenz: referenzFuer, schonDa }));
}

/**
 * Karton angekommen: nur waehlbare Positionen des frisch gelesenen Kartons (Schluessel), Status wie im Browser.
 * @param {{ link: string, auswahl: {schluessel:string,status:string}[] }} o
 */
export async function kartonAngekommen({ link, auswahl, sheets: s, holen, archiv = archiviere, jetzt = () => new Date() } = {}) {
  if (!Array.isArray(auswahl) || !auswahl.length) throw fehler('Keine Position gewählt.', 400);
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  const { kartonId, buf, karton } = await holeKarton({ link, sheets, holen });
  return mitKorbSperre('karton', async () => {
    const nun = jetzt().toISOString();
    const { zeilen } = korbZeilen(await werte(sheets, spreadsheetId, TAB_KORB));
    const kartons = await leseKartons(sheets, spreadsheetId, kartonId);
    if (!kartons.info) throw fehler(`Reiter ${KARTONS_TAB} fehlt - erst einrichten (scripts/setup-lshop-belege-reiter.js).`, 503);
    const abgleich = kartonAbgleich({ karton, korbZeilen: zeilen, referenz: referenzFuer, schonDa: kartons.schonDa });
    if (abgleich.ampel === AMPEL.ROT) throw fehler(abgleich.grund, 422);
    const waehlbar = new Map(abgleich.positionen.filter(p => p.waehlbar).map(p => [p.schluessel, p]));
    const probleme = auswahl.filter(a => !waehlbar.has(t(a?.schluessel))).map(a => ({ schluessel: t(a?.schluessel), text: 'nicht in diesem Karton wählbar' }));
    if (probleme.length) throw fehler(`${probleme.length} Position(en) nicht wählbar - nichts geändert.`, 422, { probleme });

    // 1. Archiv (wiederholbar ueber Name + MD5). Scheitert es, ist nichts geschrieben.
    const datei = kartonDatei(karton.la, kartonId);
    let ablage;
    try {
      ablage = await archiv({ art: 'Karton', jahr: nun.slice(0, 4), name: datei, buf, mime: 'application/pdf' });
    } catch (err) {
      if (err instanceof ArchivKonflikt) throw fehler(`Archiv: ${err.message}`, 409);
      if (err instanceof ArchivFehler) throw fehler(`Archiv: ${err.message} - nichts gebucht.`, 502);
      throw err;
    }

    // 2. Korb (+ Wareneingang am Paket) - derselbe Weg wie "Ware angekommen".
    const r = await bucheEingangInSperre({
      orderId: karton.orderId, auswahl: auswahl.map(a => ({ schluessel: t(a.schluessel), status: t(a.status) })), sheets, spreadsheetId, nun,
    });

    // 3. Protokollzeile (nur beim ersten Eingang dieses Kartons).
    const gebucht = new Set(auswahl.map(a => t(a.schluessel)));
    const abweichungen = abgleich.positionen.filter(p => p.ampel !== AMPEL.OK).length + abgleich.nichtImKarton.length;
    let protokoll = 'schon vorhanden';
    if (!kartons.schonDa) {
      const zeile = KARTONS_SPALTEN.map(n => ({
        Karton_ID: kartonId, LA: karton.la, VA: karton.va, order_id: karton.orderId, Eingang: nun, Quelle: 'scan',
        Positionen: `${gebucht.size} gebucht / ${abgleich.positionen.length} im Karton (${karton.stueck} Stück)`,
        Abweichungen: String(abweichungen), Datei: datei, Drive_ID: t(ablage?.id), Stand: nun,
      }[n] ?? ''));
      const norm = (kartons.alt[0] ?? []).map(normHeader);
      const breit = Array(norm.length).fill('');
      KARTONS_SPALTEN.forEach((n, i) => { breit[norm.indexOf(normHeader(n))] = zeile[i]; });
      const b = await haengeAn({ sheets, spreadsheetId, tab: KARTONS_TAB, info: kartons.info, alt: kartons.alt, zeilen: [breit] });
      protokoll = `Zeile ${b.von}`;
    }
    return { ...r, kartonId, archiv: t(ablage?.status), protokoll, abweichungen, nichtGebucht: abgleich.positionen.filter(p => !gebucht.has(p.schluessel)).length };
  });
}

/** Reiter LShop_Kartons anlegen (Teil der Beleg-Einrichtung). Idempotent, schreibt nur mit write. */
export async function richteKartonsEin({ write = false, sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  if (await reiter(sheets, spreadsheetId, KARTONS_TAB)) {
    await leseKartons(sheets, spreadsheetId, '');
    return [`Reiter "${KARTONS_TAB}" vorhanden, Kopf vollständig - nicht angefasst.`];
  }
  const log = [`Reiter "${KARTONS_TAB}" fehlt -> ${write ? 'anlegen' : 'wuerde angelegt'}: ${KARTONS_SPALTEN.join(' | ')}.`];
  if (write) {
    const text = ['Karton_ID', 'LA', 'VA'].map(n => KARTONS_SPALTEN.indexOf(n));
    await legeReiterAn({ sheets, spreadsheetId, tab: KARTONS_TAB, spalten: KARTONS_SPALTEN, textSpalten: text });
    log.push('✓ Reiter angelegt (Karton_ID/LA/VA als Text), Kopf zurueckgelesen.');
  }
  return log;
}
