// Legt im Kunden-Sheet (KUNDEN_SHEET_ID) den Reiter `Kunden` an (AM-1).
//
//   node backend/scripts/setup-kunden-reiter.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-kunden-reiter.js --write   legt den Reiter an
//
// Idempotent: Einen vorhandenen Reiter fasst das Skript nicht an; fehlende Spalten werden nur gemeldet.
// Kopfzeile RAW, fett, fixiert; Textformat fuer Nummern-/Telefon-/PLZ-Spalten NACH dem Schreiben der Kopfzeile
// (Befund LS2: values.update loescht das Format beschriebener Zellen). Danach zurueckgelesen.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { TAB_KUNDEN, KUNDEN_SPALTEN, KUNDEN_TEXT } from '../utils/kunden.js';

const SPREADSHEET_ID = process.env.KUNDEN_SHEET_ID;
const WRITE = process.argv.includes('--write');

async function main() {
  if (!SPREADSHEET_ID) throw new Error('KUNDEN_SHEET_ID fehlt (.env im Hauptordner).');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties(title,sheetId)' });
  const titel = (data.sheets ?? []).map(s => s.properties.title);
  console.log(`Kunden-Sheet erreichbar, Reiter: ${titel.length}`);
  if (titel.includes(TAB_KUNDEN)) {
    const { data: k } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB_KUNDEN}'!1:1` });
    const kopf = (k.values?.[0] ?? []).map(x => String(x).trim());
    const fehlt = KUNDEN_SPALTEN.filter(s => !kopf.includes(s));
    console.log(fehlt.length ? `✗ Reiter "${TAB_KUNDEN}" gibt es schon, es fehlen Spalten: ${fehlt.join(', ')} - bitte von Hand pruefen.`
      : `✓ Reiter "${TAB_KUNDEN}" gibt es schon, alle Spalten da.`);
    if (fehlt.length) process.exitCode = 1;
    return;
  }
  console.log(`Anlegen: "${TAB_KUNDEN}" mit ${KUNDEN_SPALTEN.length} Spalten: ${KUNDEN_SPALTEN.join(' | ')}  (Text: ${KUNDEN_TEXT.join(', ')})`);
  if (!WRITE) { console.log('Trockenlauf - nichts angelegt. Mit --write anlegen.'); return; }

  const { data: add } = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: TAB_KUNDEN, gridProperties: { rowCount: 1000, columnCount: KUNDEN_SPALTEN.length, frozenRowCount: 1 } } } }] },
  });
  const sheetId = add.replies[0].addSheet.properties.sheetId;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: `'${TAB_KUNDEN}'!A1`, valueInputOption: 'RAW', requestBody: { values: [KUNDEN_SPALTEN] },
  });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
      ...KUNDEN_TEXT.map(name => KUNDEN_SPALTEN.indexOf(name)).map(i => ({ repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat',
      } })),
    ] },
  });
  const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB_KUNDEN}'!1:1` });
  const gleich = JSON.stringify(zurueck.values?.[0] ?? []) === JSON.stringify(KUNDEN_SPALTEN);
  console.log(gleich ? `✓ Reiter "${TAB_KUNDEN}" angelegt, Kopfzeile zurueckgelesen.` : `✗ "${TAB_KUNDEN}": Kopfzeile weicht beim Zuruecklesen ab - bitte pruefen.`);
  if (!gleich) process.exitCode = 1;
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
