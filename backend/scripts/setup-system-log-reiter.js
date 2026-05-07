import dotenv from 'dotenv';
dotenv.config();
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_NAME       = 'System_Log';
const HEADER         = ['Timestamp', 'Level', 'Service', 'Message', 'Details'];

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('Fehler: GOOGLE_SHEET_ID fehlt in .env');
    process.exit(1);
  }

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const { data: meta } = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties',
  });

  const existing = meta.sheets.find(s => s.properties.title === TAB_NAME);

  if (existing) {
    const tabSheetId = existing.properties.sheetId;
    console.log(`Reiter "${TAB_NAME}" existiert bereits (sheetId: ${tabSheetId}).`);
    const { data: check } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `${TAB_NAME}!A1`,
    });
    if ((check.values ?? []).length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID, range: `${TAB_NAME}!A1`,
        valueInputOption: 'USER_ENTERED', requestBody: { values: [HEADER] },
      });
      console.log('Header nachträglich geschrieben:', HEADER.join(' | '));
    } else {
      console.log('Header bereits vorhanden – keine Änderungen.');
    }
    console.log('\nSetup abgeschlossen ✓');
    return;
  }

  const { data: addResp } = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: TAB_NAME } } }] },
  });
  const tabSheetId = addResp.replies[0].addSheet.properties.sheetId;
  console.log(`Reiter "${TAB_NAME}" angelegt (sheetId: ${tabSheetId}).`);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: `${TAB_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADER] },
  });
  console.log('Header geschrieben:', HEADER.join(' | '));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [
      {
        repeatCell: {
          range: { sheetId: tabSheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.18, green: 0.18, blue: 0.18 },
          }},
          fields: 'userEnteredFormat(textFormat,backgroundColor)',
        },
      },
      {
        updateSheetProperties: {
          properties: { sheetId: tabSheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      },
      // Spaltenbreiten: A=180, B=80, C=120, D=300, E=400
      ...[180, 80, 120, 300, 400].map((px, i) => ({
        updateDimensionProperties: {
          range: { sheetId: tabSheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
          properties: { pixelSize: px },
          fields: 'pixelSize',
        },
      })),
    ]},
  });
  console.log('Formatierung angewendet.');
  console.log('\nSetup abgeschlossen ✓');
}

main().catch(err => {
  console.error('Fehler:', err.message ?? err);
  process.exit(1);
});
