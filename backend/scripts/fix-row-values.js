// Fix incorrect values in rows that were synced with wrong data
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

  console.log('Repariere die fehlerhaften Werte in Row 10 (Order 17084)...');

  // Row 10 is the 11th row (including header), so it's row 11 in 1-based notation
  // But in the values range, we count from row 1 (header), so row 10 of data is row 11 in the sheet
  // Actually, checking: header = row 1, data row 1 = row 2, ..., data row 10 = row 11

  // For order 17084 (data row 10 = sheet row 11):
  // [J] = "17004" (Produkt-ID) - correct
  // [K] = "11.83" (Gewinn-netto) - correct
  // [L] = "5.92" (Lizenz-Anteil) - correct
  // [M] = "0.00" (Porto-Saldo) - correct
  // [N] = was "07.04" now "46119,00" - should be "7.04"

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Partner_Verkäufe!N11',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['7.04']] },
  });

  console.log('✓ Row 10 (Order 17084): Anteil-Brutto = 7.04€');

  // Row 11 (Order 17075) should already be correct at 7.39, but let's verify by re-setting it
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Partner_Verkäufe!N12',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['7.39']] },
  });

  console.log('✓ Row 11 (Order 17075): Anteil-Brutto = 7.39€');
  console.log('\nAlle Werte korrigiert.');
}

run().catch(e => { console.error(e); process.exit(1); });
