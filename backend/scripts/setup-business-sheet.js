import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SPREADSHEET_ID = process.env.BUSINESS_SHEET_ID;

const TABS = [
  {
    name: 'Kalkulation_Artikel',
    header: ['L-Shop-Nr', 'Artikelname', 'EK-Preis-Netto', 'Kategorie', 'Notiz'],
    widths: [120, 220, 120, 160, 240],
    seedData: [],
  },
  {
    name: 'Kalkulation_Druckpreise',
    header: ['Druckposition', 'Größe', 'Preis-Netto'],
    widths: [160, 100, 100],
    seedData: [
      ['Brust vorne', 'Klein',  '3.00'],
      ['Brust vorne', 'Mittel', '4.50'],
      ['Brust vorne', 'Groß',   '6.50'],
      ['Rücken',      'Klein',  '3.00'],
      ['Rücken',      'Mittel', '4.50'],
      ['Rücken',      'Groß',   '6.50'],
    ],
  },
  {
    name: 'Kalkulation_Fixkosten',
    header: ['Position', 'Betrag', 'Einheit'],
    widths: [180, 100, 140],
    seedData: [
      ['Nebenkosten',   '0.70', 'EUR/Artikel'],
      ['Versandanteil', '1.75', 'EUR/Artikel'],
      ['PayPal-Anteil', '0.66', '%/VK'],
    ],
  },
  {
    name: 'Kalkulation_Verkaufspreise',
    header: ['Produkttyp', 'Ab-Menge', 'VK-Brutto', 'Notiz'],
    widths: [180, 90, 100, 240],
    seedData: [
      ['Premium Shirt', '1',  '25.00', 'Standard Einzelpreis'],
      ['Premium Shirt', '10', '22.50', 'Ab 10 Stück'],
      ['Premium Shirt', '30', '20.00', 'Ab 30 Stück'],
    ],
  },
  {
    name: 'Partner',
    header: ['Partner-ID', 'Name', 'Hauptkategorie', 'Token', 'Aktiv', 'Lizenz-%', 'Versand-Modell', 'PayPal-Modell', 'Notiz'],
    widths: [120, 180, 160, 200, 60, 80, 140, 140, 240],
    seedData: [],
    note: 'Versand-Modell/PayPal-Modell: pauschal | anteilig | partner-trägt',
  },
  {
    name: 'Partner_Verkäufe',
    header: ['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status'],
    widths: [120, 120, 100, 140, 180, 80, 130, 110, 110],
    seedData: [],
    note: 'Status: offen | abgerechnet',
  },
  {
    name: 'Partner_Abrechnungen',
    header: ['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Verkaufs-Guthaben', 'Saldo', 'Status', 'Erstellt-Am', 'Notiz'],
    widths: [150, 120, 120, 120, 150, 100, 120, 120, 220],
    seedData: [],
    note: 'Abrechnungs-ID: AB-YYYY-NNNN | Status: angefordert | geprüft | freigegeben | bezahlt',
  },
];

async function setupTab(sheets, existingSheets, tab) {
  const existing = existingSheets.find(s => s.properties.title === tab.name);

  let sheetId;

  if (existing) {
    sheetId = existing.properties.sheetId;
    console.log(`  ↩  "${tab.name}" existiert bereits (sheetId: ${sheetId})`);

    const { data: check } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tab.name}!A1`,
    });

    if ((check.values ?? []).length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab.name}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [tab.header] },
      });
      console.log(`     Header geschrieben.`);
    } else {
      console.log(`     Header vorhanden – keine Änderungen.`);
    }
    return;
  }

  // Neuen Reiter anlegen
  const { data: addResp } = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: tab.name } } }] },
  });
  sheetId = addResp.replies[0].addSheet.properties.sheetId;
  console.log(`  ✓  "${tab.name}" angelegt (sheetId: ${sheetId})`);

  // Header + Seed-Daten schreiben
  const rows = [tab.header, ...tab.seedData];
  if (tab.note) rows.push([`// ${tab.note}`]);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab.name}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
  console.log(`     ${rows.length - 1} Zeile(n) geschrieben (Header + ${tab.seedData.length} Seed-Datensätze).`);

  // Formatierung: Header-Zeile fett + dark BG, Freeze, Spaltenbreiten
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
  console.log(`     Formatierung angewendet (Header, Freeze, ${tab.widths.length} Spaltenbreiten).`);
}

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('Fehler: BUSINESS_SHEET_ID fehlt in .env');
    process.exit(1);
  }

  console.log(`Business Sheet Setup – ID: ${SPREADSHEET_ID}`);
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
