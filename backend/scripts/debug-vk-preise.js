// Debug: Zeige Kalkulation_Verkaufspreise Inhalt
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SHEET_ID = process.env.BUSINESS_SHEET_ID;

async function readTab(sheets, tabName) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: `${tabName}!A1:Z`,
  });
  const [header, ...rows] = data.values ?? [];
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}

async function run() {
  if (!SHEET_ID) { console.error('BUSINESS_SHEET_ID fehlt.'); process.exit(1); }

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const tab = await readTab(sheets, 'Kalkulation_Verkaufspreise');
  console.log('\n━━ Kalkulation_Verkaufspreise ━━');
  console.log('Header:');
  tab.header.forEach((h, i) => console.log(`  [${i}] ${h}`));

  console.log('\nRows:');
  const vkPreisIdx = tab.header.indexOf('VK-Brutto');
  const vkPreisAltIdx = tab.header.indexOf('VK-Preis-Brutto');

  console.log(`\n⚠️  VK-Brutto Index: ${vkPreisIdx}`);
  console.log(`⚠️  VK-Preis-Brutto Index: ${vkPreisAltIdx}`);

  const realIdx = vkPreisIdx !== -1 ? vkPreisIdx : vkPreisAltIdx;

  tab.rows.forEach((r, idx) => {
    console.log(`\nRow ${idx + 1}:`);
    r.forEach((val, colIdx) => {
      if (colIdx < tab.header.length) {
        const hdr = tab.header[colIdx];
        const mark = colIdx === realIdx ? ' ← VK-PREIS' : '';
        console.log(`  [${hdr}] = "${val}"${mark}`);
      }
    });
  });

  console.log('\n━━ Analyse der letzten zwei Zeilen (VK-Preis-Spalte) ━━');
  if (realIdx >= 0 && tab.rows.length >= 2) {
    const lastTwo = tab.rows.slice(-2);
    lastTwo.forEach((r, idx) => {
      const val = r[realIdx];
      const isDate = /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(val?.toString() || '');
      const isNumeric = /^\d+([.,]\d+)?$/.test(val?.toString() || '');
      console.log(`\n  Zeile ${tab.rows.length - 1 + idx}: "${val}"`);
      console.log(`    Format: ${isDate ? 'DATUM ⚠️' : isNumeric ? 'NUMMER ✓' : 'ANDERE'}`);
    });
  }
}

run().catch(e => { console.error(e); process.exit(1); });
