// Setzt Spalte O ('Storno-Status') in Partner_Verkäufe + HK_Partner_Verkäufe.
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SHEET_ID = process.env.BUSINESS_SHEET_ID;
const TABS = ['Partner_Verkäufe', 'HK_Partner_Verkäufe'];

async function run() {
  const auth = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  for (const tab of TABS) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${tab}!O1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['Storno-Status']] },
    });
    console.log(`✓ ${tab}!O1 = "Storno-Status"`);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
