import dotenv from 'dotenv';
dotenv.config();
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_NAME       = 'Varianten';
const HEADERS        = [
  'SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3',
  'Preis', 'Aktiv', 'WC_Variation_ID', 'Google_Farbe',
];
// 0-basierter Index der "Aktiv"-Spalte in HEADERS
const AKTIV_COL_INDEX = 9;

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('Fehler: GOOGLE_SHEET_ID fehlt in .env');
    process.exit(1);
  }

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // ── Prüfen ob Reiter schon existiert ──────────────────────────────────────
  const { data: spreadsheet } = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties.title',
  });

  const exists = spreadsheet.sheets.some(s => s.properties.title === TAB_NAME);
  if (exists) {
    console.log(`✓ Reiter "${TAB_NAME}" existiert bereits – nichts zu tun.`);
    return;
  }

  // ── Neuen Reiter anlegen ──────────────────────────────────────────────────
  const addResponse = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: TAB_NAME,
              gridProperties: { rowCount: 1000, columnCount: HEADERS.length },
            },
          },
        },
      ],
    },
  });

  const newSheetId = addResponse.data.replies[0].addSheet.properties.sheetId;
  console.log(`✓ Reiter "${TAB_NAME}" angelegt (sheetId: ${newSheetId})`);

  // ── Header-Zeile schreiben ────────────────────────────────────────────────
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range:            `${TAB_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody:      { values: [HEADERS] },
  });
  console.log('✓ Header-Zeile geschrieben');

  // ── Aktiv-Spalte als Checkbox formatieren ─────────────────────────────────
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId:          newSheetId,
              startRowIndex:    1,       // ab Zeile 2 (0-basiert)
              endRowIndex:      1000,
              startColumnIndex: AKTIV_COL_INDEX,
              endColumnIndex:   AKTIV_COL_INDEX + 1,
            },
            cell: {
              dataValidation: {
                condition: { type: 'BOOLEAN' },
                strict: true,
              },
            },
            fields: 'dataValidation',
          },
        },
      ],
    },
  });
  console.log('✓ Spalte "Aktiv" als Checkbox formatiert');
  console.log('\nSetup abgeschlossen.');
}

main().catch(err => {
  console.error('Fehler:', err.message ?? err);
  process.exit(1);
});
