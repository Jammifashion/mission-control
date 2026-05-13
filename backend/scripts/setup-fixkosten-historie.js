import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SPREADSHEET_ID = process.env.BUSINESS_SHEET_ID;
const TAB_NAME       = 'Kalkulation_Fixkosten';

const HEADER = ['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis'];
const WIDTHS  = [200, 80, 140, 110, 110];

const SEED_DATA = [
  ['Nebenkosten',             '0.8',  'EUR/Artikel',    '01.01.2022', ''],
  ['Versandanteil',           '1.75', 'EUR/Artikel',    '01.01.2022', ''],
  ['PayPal-Anteil',           '0.66', '%/VK',           '01.01.2022', ''],
  ['Versandnebenkosten B',    '0.9',  'EUR/Bestellung', '01.01.2022', ''],
  ['Versandnebenkosten P',    '1.41', 'EUR/Bestellung', '01.01.2022', ''],
  ['Herstellungsnebenkosten', '0.8',  'EUR/Artikel',    '01.01.2022', ''],
  ['Porto B',                 '3',    'EUR/Bestellung', '01.01.2022', ''],
  ['PayPal Prozent',          '2.49', '%',              '01.01.2022', ''],
  ['Porto P',                 '6',    'EUR/Bestellung', '01.01.2022', ''],
  ['PayPal Pauschale',        '0.35', 'EUR/Bestellung', '01.01.2022', ''],
  ['MwSt',                    '19',   '%',              '01.01.2022', ''],
];

function colLetter(idx) {
  let s = ''; idx++;
  while (idx > 0) { idx--; s = String.fromCharCode(65 + (idx % 26)) + s; idx = Math.floor(idx / 26); }
  return s;
}

async function run() {
  if (!SPREADSHEET_ID) { console.error('BUSINESS_SHEET_ID fehlt – .env prüfen.'); process.exit(1); }

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Spreadsheet-Metadaten laden → sheetId des Reiters
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existingSheet  = meta.sheets.find(s => s.properties.title === TAB_NAME);

  let sheetId;
  if (!existingSheet) {
    console.log(`"${TAB_NAME}" existiert nicht – lege Reiter an …`);
    const { data: addResp } = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB_NAME } } }] },
    });
    sheetId = addResp.replies[0].addSheet.properties.sheetId;
    console.log(`  ✓  Reiter angelegt (sheetId: ${sheetId})`);
  } else {
    sheetId = existingSheet.properties.sheetId;
    console.log(`"${TAB_NAME}" gefunden (sheetId: ${sheetId}) – Inhalt wird ersetzt …`);
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: TAB_NAME,
    });
    console.log('  ✓  Inhalt gelöscht');
  }

  // Header + Seed-Daten schreiben
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADER, ...SEED_DATA] },
  });
  console.log(`  ✓  ${SEED_DATA.length + 1} Zeilen geschrieben (1 Header + ${SEED_DATA.length} Seed-Datensätze)`);

  // Formatierung: Header-Styling + Freeze + Spaltenbreiten
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                textFormat:      { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
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
        ...WIDTHS.map((px, i) => ({
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
            properties: { pixelSize: px },
            fields: 'pixelSize',
          },
        })),
      ],
    },
  });
  console.log(`  ✓  Formatierung gesetzt (Freeze Zeile 1, ${WIDTHS.length} Spaltenbreiten)`);
  console.log('Fertig.');
}

run().catch(e => { console.error(e); process.exit(1); });
