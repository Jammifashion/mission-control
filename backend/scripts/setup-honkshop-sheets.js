import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

// Sprint 5.4 – Multi-Shop Setup
// Legt die HonkShop-spezifischen Sheet-Reiter im Business Sheet an:
//   - HK_Partner_Verkäufe   (Struktur identisch zu Partner_Verkäufe)
//   - HK_Partner_Abrechnungen (Struktur identisch zu Partner_Abrechnungen)
// Partner-Stamm, Partner_Artikel und Partner_Interne_Bestellungen bleiben
// shop-übergreifend (gleiche Partner mit unterschiedlichen Shops).

const SPREADSHEET_ID = process.env.BUSINESS_SHEET_ID;

const TABS = [
  {
    name: 'HK_Partner_Verkäufe',
    header: ['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status',
             'Produkt-ID', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto'],
    widths: [120, 120, 100, 140, 180, 80, 130, 110, 110, 110, 110, 110, 110, 110],
    seedData: [],
    note: 'HonkShop-Verkäufe – Status: offen | abgerechnet',
  },
  {
    name: 'HK_Partner_Abrechnungen',
    header: ['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Verkaufs-Guthaben', 'Saldo', 'Status', 'Erstellt-Am', 'Notiz', 'Positionen'],
    widths: [150, 120, 120, 120, 150, 100, 120, 120, 220, 400],
    seedData: [],
    note: 'HonkShop-Abrechnungen – Abrechnungs-ID: AB-YYYY-NNNN | Status: entwurf → freigegeben → bezahlt · Positionen: JSON',
  },
  {
    name: 'HK_Partner_Artikel',
    header: ['Produkt-ID', 'Artikelname', 'EK-Preis-Netto', 'Druckkosten', 'Versandart'],
    widths: [120, 280, 120, 120, 100],
    seedData: [],
    note: 'HonkShop-Artikel – Versandart: P (Paket) | B (Brief)',
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

    const rows = [tab.header, ...tab.seedData];
    if (tab.note) rows.push([`// ${tab.note}`]);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tab.name}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
    console.log(`     ${rows.length} Zeile(n) geschrieben (Header + Notiz).`);

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

  const sheetId = existing.properties.sheetId;
  console.log(`  ↩  "${tab.name}" existiert (sheetId: ${sheetId})`);

  const { data: headerData } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab.name}!1:1`,
  });
  const currentHeader = (headerData.values?.[0] ?? []);

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
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests },
  });
  console.log(`     Spaltenbreiten aktualisiert.`);
}

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('Fehler: BUSINESS_SHEET_ID fehlt in .env');
    process.exit(1);
  }

  console.log(`HonkShop Sheet Setup – ID: ${SPREADSHEET_ID}`);
  console.log('='.repeat(60));

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const { data: meta } = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties',
  });
  const existingSheets = meta.sheets;

  console.log(`Vorhandene Reiter: ${existingSheets.map(s => s.properties.title).join(', ')}`);
  console.log('='.repeat(60));

  for (const tab of TABS) {
    await setupTab(sheets, existingSheets, tab);
  }

  console.log('='.repeat(60));
  console.log(`\nSetup abgeschlossen ✓ (${TABS.length} Reiter geprüft/angelegt)`);
}

main().catch(err => {
  console.error('Fehler:', err.message ?? err);
  process.exit(1);
});
