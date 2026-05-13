// Fix Partner_Verkäufe headers by adding J-N columns
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

  const newHeaders = [
    'Produkt-ID',       // J
    'Gewinn-netto',     // K
    'Lizenz-Anteil',    // L
    'Porto-Saldo',      // M
    'Anteil-Brutto'     // N
  ];

  console.log('Updating Partner_Verkäufe header row with columns J-N:');
  console.log(newHeaders);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Partner_Verkäufe!J1:N1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [newHeaders] },
  });

  console.log('✓ Header row updated successfully.');
}

run().catch(e => { console.error(e); process.exit(1); });
