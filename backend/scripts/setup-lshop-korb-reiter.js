// Legt im SSOT-Sheet den Reiter "Warenkorb_LShop" an (BO2 Teil 2).
//
//   node backend/scripts/setup-lshop-korb-reiter.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-lshop-korb-reiter.js --write   legt an
//
// Idempotent: Gibt es den Reiter schon, wird nichts ueberschrieben; fehlende Spalten
// werden nur gemeldet (keine Spalten zwischen vorhandene schieben). Kopfzeile RAW,
// erste Zeile fixiert. Textformat fuer Schluessel, Bestellnummer, Position und
// LShop_ArticleNr wird NACH dem Schreiben der Kopfzeile gesetzt (Befund LS2:
// values.update loescht das Format auf beschriebenen Zellen). Der Abgleich schreibt
// RAW-Strings, damit bleiben die Nummern auch ohne Format Text.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { findHeader } from '../utils/sheet-headers.js';
import { TAB_KORB, KORB_SPALTEN } from '../utils/korb-logic.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const WRITE = process.argv.includes('--write');
const TEXT_SPALTEN = ['Schluessel', 'Bestellnummer', 'Position', 'LShop_ArticleNr', 'Referenz', 'SSOT-ID', 'Bestell_ID'];

async function main() {
  if (!SPREADSHEET_ID) throw new Error('GOOGLE_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties(title,sheetId)' });
  const vorhanden = (data.sheets ?? []).map(s => s.properties).find(p => p.title === TAB_KORB);

  if (vorhanden) {
    const { data: k } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB_KORB}'!1:1` });
    const header = k.values?.[0] ?? [];
    const fehlt = KORB_SPALTEN.filter(n => findHeader(header, n) < 0);
    console.log(`Reiter "${TAB_KORB}" gibt es schon (${header.length} Spalten).`);
    console.log(fehlt.length ? `✗ Es fehlen Spalten: ${fehlt.join(', ')} - bitte von Hand hinten ergaenzen.` : '✓ Alle Spalten vorhanden. Nichts zu tun.');
    return;
  }

  console.log(`Reiter "${TAB_KORB}" fehlt. Anlegen mit ${KORB_SPALTEN.length} Spalten:`);
  console.log(`  ${KORB_SPALTEN.join(' | ')}`);
  console.log(`  Textformat: ${TEXT_SPALTEN.join(', ')}`);
  if (!WRITE) { console.log('Trockenlauf - nichts angelegt. Mit --write anlegen.'); return; }

  const { data: add } = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: TAB_KORB, gridProperties: { rowCount: 500, columnCount: KORB_SPALTEN.length, frozenRowCount: 1 } } } }] },
  });
  const sheetId = add.replies[0].addSheet.properties.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: `'${TAB_KORB}'!A1`, valueInputOption: 'RAW',
    requestBody: { values: [KORB_SPALTEN] },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
      ...TEXT_SPALTEN.map(n => KORB_SPALTEN.indexOf(n)).map(i => ({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      })),
    ] },
  });

  const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB_KORB}'!1:1` });
  const ok = JSON.stringify(zurueck.values?.[0] ?? []) === JSON.stringify(KORB_SPALTEN);
  console.log(ok ? `✓ Reiter "${TAB_KORB}" angelegt, Kopfzeile zurueckgelesen.` : '✗ Kopfzeile weicht beim Zuruecklesen ab - bitte pruefen.');
  if (!ok) process.exitCode = 1;
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
