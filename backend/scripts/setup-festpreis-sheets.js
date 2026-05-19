import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

// Sprint 5.5 – Festpreismodell Sheet Setup
// Legt FP_Partner, FP_Artikel, FP_Verkäufe, FP_Abrechnungen an (idempotent).

const SPREADSHEET_ID = process.env.BUSINESS_SHEET_ID;

const TABS = [
  {
    name: 'FP_Partner',
    header: ['Partner-ID', 'Name', 'Shop', 'Aktiv', 'Notiz', 'Kategorien', 'Token'],
    widths: [120, 200, 80, 80, 300, 200, 280],
    note: 'Festpreis-Partner – Shop: jfn | honk – Aktiv: Ja | Nein',
    dateColumns: [],
    currencyColumns: [],
  },
  {
    name: 'FP_Artikel',
    header: ['Partner-ID', 'Produkt-ID', 'Artikelname', 'Festpreis-EK-Netto', 'Handling-Gebühr', 'Versandart', 'WC-Kategorie'],
    widths: [120, 120, 280, 130, 120, 100, 180],
    note: 'Festpreis-Artikel – Versandart: P (Paket) | B (Brief)',
    dateColumns: [],
    currencyColumns: [3, 4],
  },
  {
    name: 'FP_Verkäufe',
    header: [
      'Partner-ID', 'Datum', 'WC-Bestellnummer', 'Artikelname',
      'Variante', 'Stückzahl', 'Festpreis-EK', 'Handling',
      'Porto-Einnahme', 'Porto-Kosten', 'Versandnebenkosten',
      'PayPal-Kosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto',
      'Status Abrechnung', 'Produkt-ID',
    ],
    widths: [120, 100, 140, 220, 100, 80, 120, 110, 120, 110, 140, 110, 150, 150, 140, 110],
    note: 'FP-Verkäufe – Status: offen | abgerechnet',
    dateColumns: [1],
    currencyColumns: [6, 7, 8, 9, 10, 11, 12, 13],
  },
  {
    name: 'FP_Abrechnungen',
    header: ['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Gesamt-Netto', 'Gesamt-Brutto', 'Status', 'Erstellt-Am'],
    widths: [150, 120, 120, 120, 130, 130, 120, 120],
    note: 'FP-Abrechnungen – Status: entwurf | freigegeben',
    dateColumns: [2, 3, 7],
    currencyColumns: [4, 5],
  },
];

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
    console.log(`     ${rows.length} Zeile(n) geschrieben (Header + Notiz).`);

    const requests = [
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              backgroundColor: { red: 0.1, green: 0.1, blue: 0.1 },
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
      ...(tab.dateColumns || []).map(colIdx => ({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: 10000, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd.mm.yyyy' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      })),
      ...(tab.currencyColumns || []).map(colIdx => ({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: 10000, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0.00' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      })),
    ];

    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });
    console.log(`     Formatierung angewendet (${tab.widths.length} Spalten, ${(tab.dateColumns||[]).length} Datum, ${(tab.currencyColumns||[]).length} Währung).`);
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
    const width = tab.widths[tab.header.indexOf(col)] ?? 120;
    return { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: colIdx, endIndex: colIdx + 1 }, properties: { pixelSize: width }, fields: 'pixelSize' } };
  });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });
  console.log(`     Spaltenbreiten aktualisiert.`);
}

async function main() {
  if (!SPREADSHEET_ID) { console.error('Fehler: BUSINESS_SHEET_ID fehlt in .env'); process.exit(1); }

  console.log(`Festpreis Sheet Setup – ID: ${SPREADSHEET_ID}`);
  console.log('='.repeat(60));

  const auth = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties' });
  const existingSheets = meta.sheets;

  console.log(`Vorhandene Reiter: ${existingSheets.map(s => s.properties.title).join(', ')}`);
  console.log('='.repeat(60));

  for (const tab of TABS) await setupTab(sheets, existingSheets, tab);

  console.log('='.repeat(60));
  console.log(`\nSetup abgeschlossen ✓ (${TABS.length} Reiter geprüft/angelegt)`);
}

main().catch(err => { console.error('Fehler:', err.message ?? err); process.exit(1); });
