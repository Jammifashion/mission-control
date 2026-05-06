import dotenv from 'dotenv';
dotenv.config();
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_NAME       = 'Produktions_Status';
const HEADER         = [
  'WC_Order_ID', 'WC_Item_ID', 'Artikelname', 'SKU', 'Menge',
  'L-Shop_bestellt', 'DTF_bestellt', 'Gedruckt', 'Versendet', 'Notiz',
];
// 0-basierte Spalten-Indizes der Checkbox-Spalten
const CHECKBOX_COL_INDICES = [5, 6, 7, 8]; // L-Shop_bestellt, DTF_bestellt, Gedruckt, Versendet

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('Fehler: GOOGLE_SHEET_ID fehlt in .env');
    process.exit(1);
  }

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // ── Bestehende Reiter prüfen ──────────────────────────────────────────────
  const { data: meta } = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties',
  });

  const existing = meta.sheets.find(s => s.properties.title === TAB_NAME);

  let tabSheetId;

  if (existing) {
    tabSheetId = existing.properties.sheetId;
    console.log(`Reiter "${TAB_NAME}" existiert bereits (sheetId: ${tabSheetId}) – Header wird nicht überschrieben.`);
  } else {
    // ── Neuen Reiter anlegen ──────────────────────────────────────────────
    const { data: addResp } = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: TAB_NAME },
          },
        }],
      },
    });
    tabSheetId = addResp.replies[0].addSheet.properties.sheetId;
    console.log(`Reiter "${TAB_NAME}" angelegt (sheetId: ${tabSheetId}).`);

    // ── Header schreiben ──────────────────────────────────────────────────
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range:            `${TAB_NAME}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody:      { values: [HEADER] },
    });
    console.log('Header geschrieben:', HEADER.join(' | '));
  }

  // ── Checkbox-Format für Spalten L-Shop_bestellt bis Versendet ────────────
  // Gilt ab Zeile 2 (Datenzeilen), Zeile 1 = Header
  const checkboxRequests = CHECKBOX_COL_INDICES.map(colIndex => ({
    repeatCell: {
      range: {
        sheetId:          tabSheetId,
        startRowIndex:    1,     // Zeile 2 (0-basiert)
        endRowIndex:      2000,
        startColumnIndex: colIndex,
        endColumnIndex:   colIndex + 1,
      },
      cell: {
        dataValidation: {
          condition: { type: 'BOOLEAN' },
          showCustomUi: true,
        },
      },
      fields: 'dataValidation',
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: checkboxRequests },
  });

  console.log(`Checkbox-Format gesetzt für Spalten: ${CHECKBOX_COL_INDICES.map(i => HEADER[i]).join(', ')}`);
  console.log('\nSetup abgeschlossen ✓');
}

main().catch(err => {
  console.error('Fehler:', err.message ?? err);
  process.exit(1);
});
