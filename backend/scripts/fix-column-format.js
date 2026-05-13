// Fix column N formatting to be numbers not dates
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

  // Get sheet ID for Partner_Verkäufe
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const vkSheet = spreadsheet.data.sheets.find(s => s.properties.title === 'Partner_Verkäufe');
  const sheetId = vkSheet.properties.sheetId;

  console.log(`Formatiere Spalte N (Anteil-Brutto) in Sheet ${sheetId} als Dezimalzahl...`);

  // Format column N (Anteil-Brutto) as number with 2 decimal places
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: sheetId,
              startColumnIndex: 13,  // Column N = index 13 (0-based)
              endColumnIndex: 14,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: {
                  type: 'NUMBER',
                  pattern: '0.00'
                }
              }
            },
            fields: 'userEnteredFormat.numberFormat'
          }
        }
      ]
    }
  });

  console.log('✓ Spalte N formatiert als Dezimalzahl mit 2 Stellen.\n');

  // Also fix column K (Gewinn-netto), L (Lizenz-Anteil), M (Porto-Saldo)
  console.log('Formatiere Spalten K, L, M auch als Dezimalzahl...');
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: sheetId,
              startColumnIndex: 10,  // Column K = index 10
              endColumnIndex: 13,    // Through column M
            },
            cell: {
              userEnteredFormat: {
                numberFormat: {
                  type: 'NUMBER',
                  pattern: '0.00'
                }
              }
            },
            fields: 'userEnteredFormat.numberFormat'
          }
        }
      ]
    }
  });

  console.log('✓ Spalten K, L, M formatiert als Dezimalzahl mit 2 Stellen.');
}

run().catch(e => { console.error(e); process.exit(1); });
