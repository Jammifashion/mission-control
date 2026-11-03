// Legt im SSOT-Sheet die Reiter `Auftraege` und `Auftrag_Positionen` an (AM-2).
//
//   node backend/scripts/setup-auftraege-reiter.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-auftraege-reiter.js --write   legt die fehlenden Reiter an
//
// Idempotent: Einen vorhandenen Reiter fasst das Skript nicht an; fehlende Spalten werden nur gemeldet. Nur NEUE Reiter.
// Kopfzeile RAW, fett, fixiert; Textformat fuer Nummern-/Datumsspalten NACH dem Schreiben der Kopfzeile (Befund LS2:
// values.update loescht das Format beschriebener Zellen; sonst wird "2026-11-03" zum Datumswert). Danach zurueckgelesen.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { TAB_AUFTRAEGE, TAB_POSITIONEN, AUFTRAG_SPALTEN, POSITION_SPALTEN, AUFTRAG_TEXT, POSITION_TEXT } from '../utils/auftraege.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const WRITE = process.argv.includes('--write');
const REITER = [
  { tab: TAB_AUFTRAEGE, spalten: AUFTRAG_SPALTEN, text: AUFTRAG_TEXT },
  { tab: TAB_POSITIONEN, spalten: POSITION_SPALTEN, text: POSITION_TEXT },
];

async function main() {
  if (!SPREADSHEET_ID) throw new Error('GOOGLE_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties(title,sheetId)' });
  const titel = (data.sheets ?? []).map(s => s.properties.title);
  const neu = [];
  for (const r of REITER) {
    if (!titel.includes(r.tab)) { neu.push(r); continue; }
    const { data: k } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${r.tab}'!1:1` });
    const kopf = (k.values?.[0] ?? []).map(x => String(x).trim());
    const fehlt = r.spalten.filter(s => !kopf.includes(s));
    console.log(fehlt.length ? `✗ Reiter "${r.tab}" gibt es schon, es fehlen Spalten: ${fehlt.join(', ')} - bitte von Hand pruefen.`
      : `✓ Reiter "${r.tab}" gibt es schon, alle Spalten da.`);
    if (fehlt.length) process.exitCode = 1;
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

main().catch(err => { console.error('✗', err.message); process.exit(1); });
