// Legt im SSOT-Sheet die Reiter der Bestellseite an (KS1): Bestellseiten, Bestell_Termine, Bestell_Eintraege (erst KS2 beschrieben)
// und Bestell_Bilder (Zwischenspeicher Bild-URLs).
//
//   node backend/scripts/setup-bestellseiten-reiter.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-bestellseiten-reiter.js --write   legt die fehlenden Reiter an
//
// Idempotent: Einen vorhandenen Reiter fasst das Skript nicht an; fehlende Pflichtspalten werden nur gemeldet, fehlende
// optionale Spalten (Bestellseiten: Design_Link_Zeigen, Vorgang) mit --write hinten an die Kopfzeile gehaengt. Nur Kopfzeilen,
// keine Daten. Kopfzeile RAW, fett, fixiert; Textformat fuer Nummern-/Datumsspalten NACH dem Schreiben der Kopfzeile (Befund LS2).
// Danach zurueckgelesen.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import {
  TAB_ZUGAENGE, TAB_TERMINE, TAB_EINTRAEGE, TAB_BILDER, ZUGANG_SPALTEN, ZUGANG_OPTIONAL, TERMIN_SPALTEN, EINTRAG_SPALTEN, BILD_SPALTEN,
  ZUGANG_TEXT, TERMIN_TEXT, EINTRAG_TEXT, BILD_TEXT,
} from '../utils/bestellseite.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const WRITE = process.argv.includes('--write');
export const REITER = [
  { tab: TAB_ZUGAENGE, spalten: [...ZUGANG_SPALTEN, ...ZUGANG_OPTIONAL], pflicht: ZUGANG_SPALTEN, text: ZUGANG_TEXT, optional: ZUGANG_OPTIONAL },
  { tab: TAB_TERMINE, spalten: TERMIN_SPALTEN, pflicht: TERMIN_SPALTEN, text: TERMIN_TEXT },
  { tab: TAB_EINTRAEGE, spalten: EINTRAG_SPALTEN, pflicht: EINTRAG_SPALTEN, text: EINTRAG_TEXT },
  { tab: TAB_BILDER, spalten: BILD_SPALTEN, pflicht: BILD_SPALTEN, text: BILD_TEXT },
];

const spalte = i => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

async function main() {
  if (!SPREADSHEET_ID) throw new Error('GOOGLE_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties(title,sheetId,gridProperties)' });
  const titel = (data.sheets ?? []).map(s => s.properties.title);
  const neu = [];
  for (const r of REITER) {
    if (!titel.includes(r.tab)) { neu.push(r); continue; }
    const { data: k } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${r.tab}'!1:1` });
    const kopf = (k.values?.[0] ?? []).map(x => String(x).trim());
    const fehlt = r.pflicht.filter(s => !kopf.includes(s));
    console.log(fehlt.length ? `✗ Reiter "${r.tab}" gibt es schon, es fehlen Spalten: ${fehlt.join(', ')} - bitte von Hand pruefen.`
      : `✓ Reiter "${r.tab}" gibt es schon, alle Spalten da.`);
    if (fehlt.length) process.exitCode = 1;
    const opt = (r.optional ?? []).filter(s => !kopf.includes(s));
    if (!opt.length) continue;
    console.log(`Ergaenzen: "${r.tab}" hinten ${opt.join(', ')} (Spalten ${kopf.length + 1}-${kopf.length + opt.length})`);
    if (!WRITE) { console.log('Trockenlauf - keine Spalte ergaenzt.'); continue; }
    const info = data.sheets.find(x => x.properties.title === r.tab).properties;
    const noetig = kopf.length + opt.length - (info.gridProperties?.columnCount ?? 0);
    if (noetig > 0) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [
        { appendDimension: { sheetId: info.sheetId, dimension: 'COLUMNS', length: noetig } },
      ] } });
    }
    await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `'${r.tab}'!${spalte(kopf.length)}1`, valueInputOption: 'RAW', requestBody: { values: [opt] } });
    const { data: z } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${r.tab}'!1:1` });
    const ok = JSON.stringify((z.values?.[0] ?? []).slice(kopf.length)) === JSON.stringify(opt);
    console.log(ok ? `✓ "${r.tab}": ${opt.join(', ')} ergaenzt, Kopfzeile zurueckgelesen.` : `✗ "${r.tab}": Kopfzeile weicht ab - bitte pruefen.`);
    if (!ok) process.exitCode = 1;
  }
  if (!neu.length) { console.log('Keine Reiter anzulegen.'); return; }
  for (const r of neu) console.log(`Anlegen: "${r.tab}" mit ${r.spalten.length} Spalten: ${r.spalten.join(' | ')}  (Text: ${r.text.join(', ')})`);
  if (!WRITE) { console.log('Trockenlauf - nichts angelegt. Mit --write anlegen.'); return; }

  for (const r of neu) {
    const { data: add } = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: r.tab, gridProperties: { rowCount: 1000, columnCount: r.spalten.length, frozenRowCount: 1 } } } }] },
    });
    const sheetId = add.replies[0].addSheet.properties.sheetId;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `'${r.tab}'!A1`, valueInputOption: 'RAW', requestBody: { values: [r.spalten] },
    });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
        ...r.text.map(name => r.spalten.indexOf(name)).map(i => ({ repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat',
        } })),
      ] },
    });
    const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${r.tab}'!1:1` });
    const gleich = JSON.stringify(zurueck.values?.[0] ?? []) === JSON.stringify(r.spalten);
    console.log(gleich ? `✓ Reiter "${r.tab}" angelegt, Kopfzeile zurueckgelesen.` : `✗ "${r.tab}": Kopfzeile weicht beim Zuruecklesen ab - bitte pruefen.`);
    if (!gleich) process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error('✗', err.message); process.exit(1); });
}
