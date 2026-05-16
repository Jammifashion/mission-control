import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SPREADSHEET_ID = process.env.BUSINESS_SHEET_ID;

const TAB = {
  name: 'Kundenanfragen',
  header: [
    'Anfrage-ID',           // A
    'Datum',                // B
    'Kanal',                // C
    'Kunde-Name',           // D
    'Kunde-Email',          // E
    'Produkt-Beschreibung', // F
    'Menge',                // G
    'Varianten',            // H
    'Partner-ID',           // I
    'Preisvorschlag',       // J
    'Anmerkungen-Kunde',    // K
    'Status',               // L
    'Notiz-intern',         // M
    'WC-Order-ID',          // N
  ],
  widths: [130, 100, 110, 160, 200, 280, 70, 180, 110, 110, 260, 140, 280, 110],
  note: 'Kanal: Homepage | E-Mail | Manuell  ·  Status: Neu | Geprüft | Angebot-gesendet | Bestätigt | In-Produktion | Abgeschlossen',
};

const col = letter => letter.toUpperCase().charCodeAt(0) - 65;

function numberFormatRequest(sheetId, colLetter, type, pattern) {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1, // ab Zeile 2 (Header bleibt Text)
        startColumnIndex: col(colLetter),
        endColumnIndex:   col(colLetter) + 1,
      },
      cell: { userEnteredFormat: { numberFormat: { type, pattern } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  };
}

async function setupTab(sheets, existingSheets, tab) {
  const existing = existingSheets.find(s => s.properties.title === tab.name);

  if (!existing) {
    const { data: addResp } = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: tab.name } } }] },
    });
    const sheetId = addResp.replies[0].addSheet.properties.sheetId;
    console.log(`  ✓  "${tab.name}" angelegt (sheetId: ${sheetId})`);

    const rows = [tab.header];
    if (tab.note) rows.push([`// ${tab.note}`]);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tab.name}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  backgroundColor: { red: 0.15, green: 0.15, blue: 0.15 },
                },
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor)',
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount',
            },
          },
          ...tab.widths.map((px, i) => ({
            updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
              properties: { pixelSize: px },
              fields: 'pixelSize',
            },
          })),
          numberFormatRequest(sheetId, 'B', 'DATE',   'DD.MM.YYYY'),
          numberFormatRequest(sheetId, 'J', 'NUMBER', '#,##0.00'),
        ],
      },
    });
    console.log(`     Formatierung angewendet (Spaltenbreiten, Datum B, Währung J).`);
    return;
  }

  const sheetId = existing.properties.sheetId;
  console.log(`  ↩  "${tab.name}" existiert (sheetId: ${sheetId})`);

  const { data: headerData } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab.name}!1:1`,
  });
  const currentHeader = headerData.values?.[0] ?? [];
  const missingCols = tab.header.filter(h => !currentHeader.includes(h));
  if (missingCols.length === 0) {
    console.log(`     Alle Spalten vorhanden – keine Änderungen.`);
    return;
  }
  console.log(`     ⚠  Fehlende Spalten: ${missingCols.join(', ')} – bitte manuell ergänzen.`);
}

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('Fehler: BUSINESS_SHEET_ID fehlt in .env');
    process.exit(1);
  }

  console.log(`Kundenanfragen Setup – Sheet-ID: ${SPREADSHEET_ID}`);
  console.log('='.repeat(60));

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const { data: meta } = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties',
  });

  await setupTab(sheets, meta.sheets, TAB);

  console.log('='.repeat(60));
  console.log('Setup abgeschlossen ✓');
}

main().catch(err => {
  console.error('Fehler:', err.message ?? err);
  process.exit(1);
});
