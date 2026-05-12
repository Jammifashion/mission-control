import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SPREADSHEET_ID = process.env.BUSINESS_SHEET_ID;

const TAB = {
  name: 'Partner_Artikel',
  header: [
    'Partner-ID',     // A
    'Artikelnummer',  // B – SKU (FK zu WC)
    'Produkt-ID',     // C – WC product_id
    'Artikelname',    // D – Cache
    'EK-Preis-Netto', // E
    'Druckkosten',    // F – manueller Euro-Betrag pro Artikel
    'Versandart',     // G – B oder P
    'Lizenz-%',       // H
    'Letzte-Synchro', // I
  ],
  widths: [120, 140, 100, 240, 120, 110, 100, 90, 130],
  note: 'Versandart: B | P  ·  Letzte-Synchro: tt.mm.jjjj',
};

function colLetter(idx) {
  let s = '';
  idx++;
  while (idx > 0) {
    idx--;
    s = String.fromCharCode(65 + (idx % 26)) + s;
    idx = Math.floor(idx / 26);
  }
  return s;
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
        ],
      },
    });
    console.log(`     Formatierung angewendet (${tab.widths.length} Spaltenbreiten).`);
    return;
  }

  // Reiter existiert: fehlende Spalten ergänzen
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

  const startColIdx = currentHeader.length;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab.name}!${colLetter(startColIdx)}1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [missingCols] },
  });
  console.log(`     ${missingCols.length} neue Spalte(n) ergänzt: ${missingCols.join(', ')}`);

  const requests = missingCols.map((col, i) => {
    const colIdx = startColIdx + i;
    const width  = tab.widths[tab.header.indexOf(col)] ?? 120;
    return {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: colIdx, endIndex: colIdx + 1 },
        properties: { pixelSize: width },
        fields: 'pixelSize',
      },
    };
  });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });
  console.log(`     Spaltenbreiten aktualisiert.`);
}

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('Fehler: BUSINESS_SHEET_ID fehlt in .env');
    process.exit(1);
  }

  console.log(`Partner_Artikel Setup – Sheet-ID: ${SPREADSHEET_ID}`);
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
