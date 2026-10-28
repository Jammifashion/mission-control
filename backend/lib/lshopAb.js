// Auftragsbestaetigung auswerten (BO4i) - Ein-/Ausgabe, Logik in utils/lshop-ab.js.
// Aufrufer: Beleg-Abruf (lib/lshopBelege.js, je neue/geaenderte AB-Datei) und scripts/ab-auswerten.js (Bestand).
//
// Schreibmuster des Korbs: unter der Korb-Sperre LShop_EDI_Dateien + Warenkorb_LShop frisch lesen, planen, EIN
// values.batchUpdate RAW (nur geaenderte Zellen), alles zuruecklesen. Kein append, nie loeschen. Geschrieben werden
// nur: EDI Status (nur gesendet -> bestätigt) + AB_Nr/AB_VA/AB_Datum/AB_Eingang/AB_Hinweis und je Korb-Position der
// Bestellung Liefertermin + AB_Hinweis. Menge und Status im Korb bleiben. Nie Preise, Adressen, Kundennummer.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { mitKorbSperre } from './lshopKorb.js';
import { reiter } from './lshopBelege.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { normHeader } from '../utils/sheet-headers.js';
import { TAB_KORB, korbZeilen, vergleicheZurueck } from '../utils/korb-logic.js';
import { EDI_TAB, referenzFuer } from '../utils/edi-bestellung.js';
import { AB_EDI_SPALTEN, AB_KORB_SPALTEN, abAbgleich, abKurz, ediStatusNachAb } from '../utils/lshop-ab.js';

const q = tab => `'${tab}'`;
const t = v => String(v ?? '').trim();
function fehler(msg, status) { const e = new Error(msg); e.status = status; return e; }

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}
async function werte(sheets, spreadsheetId, tab) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: q(tab), valueRenderOption: 'FORMATTED_VALUE' });
  return data.values ?? [];
}
// Im Trockenlauf gelten fehlende AB-Spalten als leer (gedachte Spalten hinter dem Kopf), damit er vor der
// Einrichtung zeigt, was geschrieben wuerde.
function spalten(kopf, namen, tab, { trocken = false } = {}) {
  const norm = (kopf ?? []).map(normHeader);
  const idx = {};
  const fehlt = [];
  for (const n of namen) { const i = norm.indexOf(normHeader(n)); if (i < 0) fehlt.push(n); else idx[n] = i; }
  if (trocken && fehlt.every(n => AB_EDI_SPALTEN.includes(n) || AB_KORB_SPALTEN.includes(n))) {
    fehlt.forEach((n, k) => { idx[n] = (kopf ?? []).length + k; });
    return idx;
  }
  if (fehlt.length) throw fehler(`${tab}: Spalte(n) ${fehlt.join(', ')} fehlen - erst scripts/setup-lshop-ab-spalten.js --write.`, 409);
  return idx;
}

/**
 * Eine gelesene AB auswerten und schreiben. Haelt die Korb-Sperre selbst (409 "gleich noch einmal", wenn belegt).
 * @param {{ ab: object, sheets?, spreadsheetId?, nun: Date, dryRun?: boolean }} o   ab = leseAb(...)
 * -> { orderId, abNr, va, anlass ('' | 'zweite'), statusAlt, statusNeu, kurz, abgleich, referenzen, zellen }
 */
export async function werteAbAus({ ab, sheets: s, spreadsheetId = process.env.GOOGLE_SHEET_ID, nun, dryRun = false }) {
  if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  const sheets = s ?? await sheetsClient();
  return mitKorbSperre('ab-auswertung', async () => {
    const ediWerte = await werte(sheets, spreadsheetId, EDI_TAB);
    const eIdx = spalten(ediWerte[0], ['order_id', 'Status', ...AB_EDI_SPALTEN], EDI_TAB, { trocken: dryRun });
    const ediTreffer = ediWerte.map((r, i) => ({ r, zeile: i + 1 })).slice(1).filter(({ r }) => t(r[eIdx.order_id]) === t(ab.orderId));
    if (ediTreffer.length !== 1) throw fehler(`${ab.orderId}: ${ediTreffer.length ? 'mehrfach' : 'nicht'} in ${EDI_TAB} - nichts geschrieben.`, 409);
    const { r: eZeile, zeile: eNr } = ediTreffer[0];

    const korbWerte = await werte(sheets, spreadsheetId, TAB_KORB);
    const { idx: kIdx, zeilen } = korbZeilen(korbWerte);
    Object.assign(kIdx, spalten(korbWerte[0], AB_KORB_SPALTEN, TAB_KORB, { trocken: dryRun }));
    const abgleich = abAbgleich({ ab, korbZeilen: zeilen, referenz: referenzFuer });
    const kurz = abKurz(abgleich);

    const statusAlt = t(eZeile[eIdx.Status]);
    const statusNeu = ediStatusNachAb(statusAlt);
    const altNr = t(eZeile[eIdx.AB_Nr]);
    const anlass = altNr && altNr !== ab.abNr ? 'zweite' : '';
    const ediNeu = {
      Status: statusNeu, AB_Nr: ab.abNr, AB_VA: ab.va, AB_Datum: ab.belegdatum, AB_Eingang: nun.toISOString(),
      AB_Hinweis: [statusAlt === 'unklar' ? 'Status unklar, AB da - "Als gesendet markieren" prüfen' : '', kurz].filter(Boolean).join(' · '),
    };
    // Gleiche AB noch einmal (Skript): nichts aendern, auch den Zeitpunkt nicht.
    const gleich = altNr === ab.abNr && ['AB_VA', 'AB_Datum', 'AB_Hinweis', 'Status'].every(n => t(eZeile[eIdx[n]]) === ediNeu[n]);
    const data = [];
    if (!gleich) {
      for (const [n, w] of Object.entries(ediNeu)) {
        if (t(eZeile[eIdx[n]]) !== w) data.push({ range: `${q(EDI_TAB)}!${colLetter(eIdx[n])}${eNr}`, values: [[w]], soll: w });
      }
    }
    const jeSchluessel = new Map(zeilen.map(z => [z.Schluessel, z]));
    for (const p of abgleich.positionen) {
      const z = jeSchluessel.get(p.schluessel);
      for (const [n, w] of [['Liefertermin', p.liefertermin], ['AB_Hinweis', p.hinweis]]) {
        if (t(z[n] ?? korbWerte[z._zeile - 1]?.[kIdx[n]]) !== w) data.push({ range: `${q(TAB_KORB)}!${colLetter(kIdx[n])}${z._zeile}`, values: [[w]], soll: w });
      }
    }
    const referenzen = new Map(zeilen.filter(z => t(z.Bestell_ID) === t(ab.orderId)).map(z => [z.Schluessel, referenzFuer(z)]));
    const ergebnis = { orderId: ab.orderId, abNr: ab.abNr, va: ab.va, anlass, statusAlt, statusNeu, kurz, abgleich, referenzen, zellen: data.length };
    if (dryRun || !data.length) return ergebnis;

    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: data.map(({ range, values }) => ({ range, values })) } });
    const { data: z } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: data.map(d => d.range), valueRenderOption: 'FORMATTED_VALUE' });
    const abweichend = data.filter((d, i) => t(z.valueRanges?.[i]?.values?.[0]?.[0]) !== d.soll);
    if (abweichend.length) throw fehler(`AB ${ab.orderId}: Rücklesen weicht ab (${abweichend.map(d => d.range).join(', ')}).`, 500);
    return ergebnis;
  });
}

/** Spalten hinten anhaengen (LShop_EDI_Dateien, Warenkorb_LShop). Idempotent, schreibt nur mit write. -> Logzeilen */
export async function richteAbSpaltenEin({ write = false, sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  const log = [];
  for (const [tab, namen] of [[EDI_TAB, AB_EDI_SPALTEN], [TAB_KORB, AB_KORB_SPALTEN]]) {
    const info = await reiter(sheets, spreadsheetId, tab);
    if (!info) throw fehler(`Reiter "${tab}" fehlt.`, 409);
    const kopf = (await werte(sheets, spreadsheetId, tab))[0] ?? [];
    const norm = kopf.map(normHeader);
    const fehlen = namen.filter(n => !norm.includes(normHeader(n)));
    if (!fehlen.length) { log.push(`Reiter "${tab}": ${namen.join(', ')} vorhanden - nicht angefasst.`); continue; }
    const von = colLetter(kopf.length), bis = colLetter(kopf.length + fehlen.length - 1);
    log.push(`Reiter "${tab}": ${fehlen.join(', ')} fehlen -> ${write ? 'anhaengen' : 'wuerden angehaengt'} (${von}1:${bis}1).`);
    if (!write) continue;
    const breite = info.gridProperties?.columnCount ?? Infinity;
    if (breite < kopf.length + fehlen.length) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
        { appendDimension: { sheetId: info.sheetId, dimension: 'COLUMNS', length: kopf.length + fehlen.length - breite } },
      ] } });
    }
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${q(tab)}!${von}1:${bis}1`, valueInputOption: 'RAW', requestBody: { values: [fehlen] } });
    const neu = (await werte(sheets, spreadsheetId, tab))[0] ?? [];
    if (vergleicheZurueck([fehlen], [neu.slice(kopf.length)]).length) throw fehler(`${tab}: neue Spalten beim Zuruecklesen nicht gefunden.`, 500);
    log.push(`✓ ${tab}: ${fehlen.join(', ')} angehaengt und zurueckgelesen.`);
  }
  return log;
}
