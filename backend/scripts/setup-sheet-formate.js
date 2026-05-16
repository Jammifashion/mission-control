// Setzt Spaltenformate in Partner_Verkäufe via batchUpdate
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SHEET_ID = process.env.BUSINESS_SHEET_ID;

// Hilfsfunktion: Spaltenindex (0-basiert) aus Buchstabe
const col = letter => letter.toUpperCase().charCodeAt(0) - 65;

function formatRange(sheetId, colLetter, type, pattern) {
  return {
    repeatCell: {
      range: {
        sheetId,
        startColumnIndex: col(colLetter),
        endColumnIndex:   col(colLetter) + 1,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type, pattern },
        },
      },
      fields: 'userEnteredFormat.numberFormat',
    },
  };
}

async function run() {
  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Sheet-ID (numerisch) von Partner_Verkäufe holen
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = meta.data.sheets.find(s => s.properties.title === 'Partner_Verkäufe');
  if (!sheet) { console.error('Sheet "Partner_Verkäufe" nicht gefunden.'); process.exit(1); }
  const numericSheetId = sheet.properties.sheetId;
  console.log(`Sheet-ID für "Partner_Verkäufe": ${numericSheetId}`);

  const requests = [
    formatRange(numericSheetId, 'B', 'DATE',   'DD.MM.YYYY'),   // Datum
    formatRange(numericSheetId, 'H', 'NUMBER', '#,##0.00'),      // VK-Preis (Lizenzgebühr laut Header)
    formatRange(numericSheetId, 'I', 'NUMBER', '#,##0.00'),      // Lizenzgebühr (laut Header: Status – wird trotzdem formatiert)
    formatRange(numericSheetId, 'K', 'NUMBER', '#,##0.00'),      // Gewinn-netto
    formatRange(numericSheetId, 'L', 'NUMBER', '#,##0.00'),      // Lizenz-Anteil
    formatRange(numericSheetId, 'M', 'NUMBER', '#,##0.00'),      // Porto-Saldo
    formatRange(numericSheetId, 'N', 'NUMBER', '#,##0.00'),      // Anteil-Brutto
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody:   { requests },
  });

  console.log('\n✓ Formate gesetzt:');
  console.log('  B  → DATE   DD.MM.YYYY');
  console.log('  H  → NUMBER #,##0.00');
  console.log('  I  → NUMBER #,##0.00');
  console.log('  K  → NUMBER #,##0.00');
  console.log('  L  → NUMBER #,##0.00');
  console.log('  M  → NUMBER #,##0.00');
  console.log('  N  → NUMBER #,##0.00');
}

run().catch(e => { console.error(e); process.exit(1); });
