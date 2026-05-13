// Fix the correct order rows with correct values
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

  console.log('Fixing Anteil-Brutto values...\n');

  // Order 17084: Row 10, should be 7.04
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Partner_Verkäufe!N10',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['7.04']] },
  });
  console.log('✓ Row 10 (Order 17084): Anteil-Brutto = 7.04€');

  // Order 17075: Row 11, should be 7.39
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Partner_Verkäufe!N11',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['7.39']] },
  });
  console.log('✓ Row 11 (Order 17075): Anteil-Brutto = 7.39€');

  console.log('\n✓ Alle Werte korrigiert.');
}

run().catch(e => { console.error(e); process.exit(1); });
