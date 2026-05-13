// Debug: Zeige Partner_Verkäufe Inhalt, besonders die letzten zwei Zeilen
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SHEET_ID = process.env.BUSINESS_SHEET_ID;

async function readTab(sheets, tabName, range = 'A1:Z') {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: `${tabName}!${range}`,
  });
  const [header, ...rows] = data.values ?? [];
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}

async function run() {
  if (!SHEET_ID) { console.error('BUSINESS_SHEET_ID fehlt.'); process.exit(1); }

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const tab = await readTab(sheets, 'Partner_Verkäufe', 'A1:N1000');
  console.log('\n━━ Partner_Verkäufe ━━');
  console.log(`Total rows: ${tab.rows.length}\n`);
  console.log('Header (Spalten A-N):');
  tab.header.forEach((h, i) => console.log(`  [${String.fromCharCode(65 + i)}] ${h || '(leer)'}`))

  const vkIdx = tab.header.indexOf('VK-Preis-Brutto');
  console.log(`\n⚠️  VK-Preis-Brutto Index: ${vkIdx}`);

  console.log('\n━━ Letzte 5 Zeilen ━━');
  const lastFive = tab.rows.slice(-5);
  lastFive.forEach((r, idx) => {
    const rowNum = tab.rows.length - 4 + idx;
    console.log(`\nRow ${rowNum + 1}:`);
    r.forEach((val, colIdx) => {
      if (colIdx < tab.header.length) {
        const hdr = tab.header[colIdx];
        const mark = colIdx === vkIdx ? ' ← VK-PREIS' : '';
        console.log(`  [${hdr}] = "${val}"${mark}`);
      }
    });
  });

  console.log('\n━━ Analyse der VK-Preis-Brutto Spalte der letzten zwei Zeilen ━━');
  if (vkIdx >= 0 && tab.rows.length >= 2) {
    const lastTwo = tab.rows.slice(-2);
    lastTwo.forEach((r, idx) => {
      const val = r[vkIdx];
      const isDate = /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(val?.toString() || '');
      const isNumeric = /^\d+([.,]\d+)?$/.test(val?.toString() || '');
      console.log(`\n  Zeile ${tab.rows.length - 1 + idx}: "${val}"`);
      console.log(`    Format: ${isDate ? 'DATUM ⚠️' : isNumeric ? 'NUMMER ✓' : 'ANDERE'}`);
      if (isDate) {
        const parsed = parseFloat(val.toString().replace(',', '.'));
        console.log(`    toFloat() würde ergeben: ${parsed}`);
      }
    });
  }
}

run().catch(e => { console.error(e); process.exit(1); });
