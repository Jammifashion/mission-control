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
    header: ['L-Shop-Nr', 'Artikelname', 'EK-Preis-Netto', 'Kategorie', 'Gültig-Ab', 'Notiz'],
    widths: [120, 220, 120, 160, 110, 240],
    seedData: [],
  },
  {
    name: 'Kalkulation_Druckpreise',
    header: ['Druckposition', 'Größe', 'Preis-Netto', 'Gültig-Ab'],
    widths: [160, 100, 100, 110],
    seedData: [
      ['Brust vorne', 'Klein',  '3.00', '01.01.2026'],
      ['Brust vorne', 'Mittel', '4.50', '01.01.2026'],
      ['Brust vorne', 'Groß',   '6.50', '01.01.2026'],
      ['Rücken',      'Klein',  '3.00', '01.01.2026'],
      ['Rücken',      'Mittel', '4.50', '01.01.2026'],
      ['Rücken',      'Groß',   '6.50', '01.01.2026'],
    ],
  },
  {
    name: 'Kalkulation_Fixkosten',
    header: ['Position', 'Betrag', 'Einheit', 'Gültig-Ab'],
    widths: [180, 100, 140, 110],
    seedData: [
      ['Nebenkosten',   '0.70', 'EUR/Artikel', '01.01.2026'],
      ['Versandanteil', '1.75', 'EUR/Artikel', '01.01.2026'],
      ['PayPal-Anteil', '0.66', '%/VK',        '01.01.2026'],
    ],
  },
  {
    name: 'Kalkulation_Verkaufspreise',
    header: ['Produkttyp', 'Ab-Menge', 'VK-Brutto', 'Gültig-Ab', 'Notiz'],
    widths: [180, 90, 100, 110, 240],
    seedData: [
      ['Premium Shirt', '1',  '25.00', '01.01.2026', 'Standard Einzelpreis'],
      ['Premium Shirt', '10', '22.50', '01.01.2026', 'Ab 10 Stück'],
      ['Premium Shirt', '30', '20.00', '01.01.2026', 'Ab 30 Stück'],
    ],
  },
  {
    name: 'Partner',
    header: ['Partner-ID', 'Name', 'Hauptkategorie', 'Token', 'Aktiv', 'Lizenz-%', 'Versand-Modell', 'PayPal-Modell', 'Porto-Modell', 'Notiz'],
    widths: [120, 180, 160, 200, 60, 80, 140, 140, 130, 240],
    seedData: [],
    note: 'Versand-Modell/PayPal-Modell: pauschal | anteilig | partner-trägt  ·  Porto-Modell: geteilt-50-50 | partner-trägt',
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
    header: ['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Verkaufs-Guthaben', 'Saldo', 'Status', 'Erstellt-Am', 'Notiz', 'Positionen'],
    widths: [150, 120, 120, 120, 150, 100, 120, 120, 220, 400],
    seedData: [],
    note: 'Abrechnungs-ID: AB-YYYY-NNNN | Status: entwurf → freigegeben → bezahlt (Alt: angefordert | geprüft)  ·  Positionen: JSON',
  },
];

async function setupTab(sheets, existingSheets, tab) {
  const existing = existingSheets.find(s => s.properties.title === tab.name);

  if (!existing) {
    // ── Neuen Reiter anlegen ────────────────────────────────────────────────
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
    console.log(`     ${tab.seedData.length + 1} Zeile(n) geschrieben (Header + ${tab.seedData.length} Seed-Datensätze).`);

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

  // ── Reiter existiert: prüfe ob Spalten fehlen ──────────────────────────────
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

  // Fehlende Spalten am Ende anhängen
  const startColIdx = currentHeader.length;
  const newHeaderRange = colLetter(startColIdx) + '1';
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab.name}!${newHeaderRange}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [missingCols] },
  });
  console.log(`     ${missingCols.length} neue Spalte(n) ergänzt: ${missingCols.join(', ')}`);

  // Spaltenbreiten für neue Spalten setzen
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
