// Find row numbers for specific orders
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

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Partner_Verkäufe!A1:N'
  });

  const [header, ...rows] = response.data.values ?? [];

  console.log('Looking for orders 17084 and 17075...\n');

  rows.forEach((r, idx) => {
    const orderId = r[2]; // Column C = Order-ID
    const anteilBrutto = r[13]; // Column N = Anteil-Brutto
    if (orderId === '17084' || orderId === '17075') {
      const sheetRow = idx + 2; // +1 for header, +1 for 1-based indexing
      console.log(`Sheet row ${sheetRow}: Order ${orderId}`);
      console.log(`  Anteil-Brutto (Column N): ${anteilBrutto}`);
      console.log(`  Range to update: Partner_Verkäufe!N${sheetRow}\n`);
    }
  });
}

run().catch(e => { console.error(e); process.exit(1); });
