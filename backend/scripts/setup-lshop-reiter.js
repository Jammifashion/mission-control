import dotenv from 'dotenv';
dotenv.config();
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_NAME       = 'LShop_Bestellungen';
const HEADER         = [
  'Bestell-ID',        // A – Format LSB-YYYY-NNNN
  'Bestelldatum',      // B – ISO Timestamp
  'SSOT-ID',           // C
  'Artikelnummer',     // D
  'Variante',          // E – z.B. "Schwarz · L · Neon Gelb"
  'Stückzahl',         // F
  'KW',                // G – z.B. "KW 23" oder leer
  'Betroffene_Orders', // H – kommagetrennte WC-Order-IDs
];

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

  if (existing) {
    console.log(`Reiter "${TAB_NAME}" existiert bereits (sheetId: ${existing.properties.sheetId}) – wird nicht überschrieben.`);
    console.log('\nSetup abgeschlossen ✓ (keine Änderungen)');
    return;
  }

  // ── Neuen Reiter anlegen ──────────────────────────────────────────────────
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
  const tabSheetId = addResp.replies[0].addSheet.properties.sheetId;
  console.log(`Reiter "${TAB_NAME}" angelegt (sheetId: ${tabSheetId}).`);

  // ── Header schreiben ──────────────────────────────────────────────────────
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range:            `${TAB_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody:      { values: [HEADER] },
  });
  console.log('Header geschrieben:', HEADER.join(' | '));

  // ── Formatierung ──────────────────────────────────────────────────────────
  const requests = [
    // Header-Zeile fett + Hintergrundfarbe
    {
      repeatCell: {
        range: { sheetId: tabSheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            textFormat:      { bold: true },
            backgroundColor: { red: 0.18, green: 0.18, blue: 0.18 },
          },
        },
        fields: 'userEnteredFormat(textFormat,backgroundColor)',
      },
    },
    // Spalten fixieren (Zeile 1 einfrieren)
    {
      updateSheetProperties: {
        properties: {
          sheetId:       tabSheetId,
          gridProperties: { frozenRowCount: 1 },
        },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    // Spaltenbreiten: A=160, B=180, C=150, D=160, E=220, F=80, G=80, H=220
    ...[ 160, 180, 150, 160, 220, 80, 80, 220 ].map((px, i) => ({
      updateDimensionProperties: {
        range: {
          sheetId:        tabSheetId,
          dimension:      'COLUMNS',
          startIndex:     i,
          endIndex:       i + 1,
        },
        properties:       { pixelSize: px },
        fields:           'pixelSize',
      },
    })),
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody:   { requests },
  });
  console.log('Formatierung angewendet (Header, Freeze, Spaltenbreiten).');
  console.log('\nSetup abgeschlossen ✓');
}

main().catch(err => {
  console.error('Fehler:', err.message ?? err);
  process.exit(1);
});
