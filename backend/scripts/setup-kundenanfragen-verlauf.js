// KA2: Reiter `Kundenanfragen_Verlauf` im Business-Sheet anlegen (nur Reiter + Kopfzeile, nie Inhalte).
// Trockenlauf Standard (zeigt, ob er da ist und wie viele Zeilen er hat), `--write` legt ihn an.
//   node scripts/setup-kundenanfragen-verlauf.js [--write]
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { TAB_VERLAUF, VERLAUF_SPALTEN } from '../utils/anfrage-verlauf.js';

const write = process.argv.includes('--write');
const spreadsheetId = process.env.BUSINESS_SHEET_ID;
if (!spreadsheetId) { console.error('BUSINESS_SHEET_ID fehlt.'); process.exit(1); }

const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId)' });
const da = (meta.sheets ?? []).find(x => x.properties.title === TAB_VERLAUF);
const kopfSoll = JSON.stringify(VERLAUF_SPALTEN);

if (da) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_VERLAUF}'!A:A` });
  const { data: k } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_VERLAUF}'!1:1` });
  const kopf = k.values?.[0] ?? [];
  console.log(`${TAB_VERLAUF} ist da: Kopf ${JSON.stringify(kopf)}, ${Math.max((data.values ?? []).length - 1, 0)} Zeilen.`);
  if (JSON.stringify(kopf) !== kopfSoll) { console.error(`Kopf weicht ab (Soll ${kopfSoll}) - bitte von Hand prüfen, nichts geschrieben.`); process.exit(1); }
  console.log('Nichts zu tun.');
  process.exit(0);
}

console.log(`${write ? 'Lege an' : 'Würde anlegen'}: Reiter ${TAB_VERLAUF} mit Kopf ${kopfSoll}`);
if (!write) { console.log('Trockenlauf - nichts geschrieben (--write zum Schreiben).'); process.exit(0); }
const { data: neu } = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
  { addSheet: { properties: { title: TAB_VERLAUF, gridProperties: { frozenRowCount: 1 } } } },
] } });
const sid = neu.replies[0].addSheet.properties.sheetId;
await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${TAB_VERLAUF}'!A1`, valueInputOption: 'RAW', requestBody: { values: [VERLAUF_SPALTEN] } });
await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
  { repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
  // Nachrichten-Spalte: Text, nicht umbrechen (JSON kann lang sein)
  { repeatCell: { range: { sheetId: sid, startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { wrapStrategy: 'CLIP' } }, fields: 'userEnteredFormat.wrapStrategy' } },
] } });
const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_VERLAUF}'!1:1` });
if (JSON.stringify(zurueck.values?.[0] ?? []) !== kopfSoll) { console.error('Rücklesen weicht ab.'); process.exit(1); }
console.log('Angelegt und zurückgelesen ✓');
