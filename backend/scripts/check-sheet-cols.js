// Check all columns in Partner_Verkäufe sheet
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SHEET_ID = process.env.BUSINESS_SHEET_ID;

async function run() {
  const auth = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  console.log('Fetching Partner_Verkäufe entire range...');
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Partner_Verkäufe'
  });

  const [header, ...rows] = response.data.values ?? [];

  console.log('\n━━ Partner_Verkäufe Raw Data ━━');
  console.log(`Header columns: ${header.length}`);
  console.log('Header:');
  header.forEach((h, i) => {
    const col = String.fromCharCode(65 + (i % 26));
    const doubleCol = i >= 26 ? String.fromCharCode(65 + Math.floor(i / 26) - 1) : '';
    console.log(`  [${doubleCol}${col}] = ${h}`);
  });

  console.log(`\nTotal data rows: ${rows.length}`);

  if (rows.length > 0) {
    console.log('\n━━ Last 2 Rows (All Columns) ━━');
    rows.slice(-2).forEach((row, idx) => {
      const rowNum = rows.length - 1 + idx;
      console.log(`\nRow ${rowNum + 1} (${row.length} columns):`);
      row.forEach((val, i) => {
        const col = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
        console.log(`  [${col}] = "${val || '(empty)'}"`);
      });
    });
  }
}

run().catch(e => { console.error(e); process.exit(1); });
