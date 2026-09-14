// Legt im Business-Sheet die Reiter "Trikots" und "Trikot_Artikel" an.
// Idempotent: vorhandene Reiter werden nicht überschrieben, nur fehlende
// Spalten hinten ergänzt. Trikot_Artikel wird nur vorbelegt, solange er
// keine Datenzeile hat.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { findHeader } from '../utils/sheet-headers.js';
import {
  TAB_TRIKOTS, TAB_ARTIKEL, SCRIPT_COLUMNS, MANUAL_COLUMNS, ARTIKEL_COLUMNS,
} from '../utils/trikot-logic.js';

const SPREADSHEET_ID = process.env.BUSINESS_SHEET_ID;

const TABS = [
  {
    name:   TAB_TRIKOTS,
    header: [...SCRIPT_COLUMNS, ...MANUAL_COLUMNS],   // A–O Skript, P–T manuell
    //        A    B    C    D    E    F    G    H    I   J   K    L   M   N   O
    widths: [150, 150, 150, 80, 100, 180, 150, 240, 70, 90, 140, 70, 60, 80, 320,
    //        P    Q    R    S    T
             100, 110, 110, 110, 220],
    manualFrom: SCRIPT_COLUMNS.length,
    seed: [],
  },
  {
    name:   TAB_ARTIKEL,
    header: ARTIKEL_COLUMNS,
    widths: [180, 100, 280, 70],
    // Artikelnummer | Produkt-ID | Produktname | Aktiv
    seed: [
      ['', 19365, '', true],
      ['', 20064, '', true],
    ],
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

const range = (tab, a1) => `'${tab}'!${a1}`;

async function createTab(sheets, tab) {
  const { data: addResp } = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: tab.name } } }] },
  });
  const sheetId = addResp.replies[0].addSheet.properties.sheetId;
  console.log(`  ✓  "${tab.name}" angelegt (sheetId: ${sheetId})`);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: range(tab.name, 'A1'),
    valueInputOption: 'RAW',
    requestBody: { values: [tab.header] },
  });

  const headerFormat = (start, end, bg) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: start, endColumnIndex: end },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
          backgroundColor: bg,
        },
      },
      fields: 'userEnteredFormat(textFormat,backgroundColor)',
    },
  });

  const dunkel  = { red: 0.15, green: 0.15, blue: 0.15 };
  const manuell = { red: 0.45, green: 0.33, blue: 0.10 };   // manuelle Spalten optisch absetzen
  const requests = tab.manualFrom
    ? [headerFormat(0, tab.manualFrom, dunkel), headerFormat(tab.manualFrom, tab.header.length, manuell)]
    : [headerFormat(0, tab.header.length, dunkel)];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        ...requests,
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
  console.log(`     Header + Formatierung (${tab.header.length} Spalten).`);
}

async function ergaenzeSpalten(sheets, tab, currentHeader) {
  const missing = tab.header.filter(h => findHeader(currentHeader, h) < 0);
  if (missing.length === 0) {
    console.log('     Alle Spalten vorhanden – keine Änderungen.');
    return;
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: range(tab.name, `${colLetter(currentHeader.length)}1`),
    valueInputOption: 'RAW',
    requestBody: { values: [missing] },
  });
  console.log(`     ${missing.length} Spalte(n) ergänzt: ${missing.join(', ')}`);
}

async function seedTab(sheets, tab) {
  if (tab.seed.length === 0) return;
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: range(tab.name, 'A:Z'),
  });
  const dataRows = (data.values ?? []).slice(1).filter(r => r.some(c => String(c ?? '').trim() !== ''));
  if (dataRows.length > 0) {
    console.log(`     ${dataRows.length} Datenzeile(n) vorhanden – keine Vorbelegung.`);
    return;
  }
  // Vorbelegung liegt in der Reihenfolge von tab.header vor; header-basiert einsortieren.
  const header = data.values?.[0] ?? [];
  const rows = tab.seed.map(seedRow => {
    const row = new Array(header.length).fill('');
    tab.header.forEach((name, i) => {
      const idx = findHeader(header, name);
      if (idx >= 0) row[idx] = seedRow[i];
    });
    return row;
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: range(tab.name, 'A1'),
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
  console.log(`     ${rows.length} Zeile(n) vorbelegt.`);
}

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('Fehler: BUSINESS_SHEET_ID fehlt in .env');
    process.exit(1);
  }

  console.log(`Trikot-Reiter Setup – Sheet-ID: ${SPREADSHEET_ID}`);
  console.log('='.repeat(60));

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const { data: meta } = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties',
  });

  for (const tab of TABS) {
    const existing = meta.sheets.find(s => s.properties.title === tab.name);
    if (!existing) {
      await createTab(sheets, tab);
    } else {
      console.log(`  ↩  "${tab.name}" existiert (sheetId: ${existing.properties.sheetId})`);
      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: range(tab.name, '1:1'),
      });
      await ergaenzeSpalten(sheets, tab, data.values?.[0] ?? []);
    }
    await seedTab(sheets, tab);
  }

  console.log('='.repeat(60));
  console.log('Setup abgeschlossen ✓');
}

main().catch(err => {
  console.error('Fehler:', err.message ?? err);
  process.exit(1);
});
