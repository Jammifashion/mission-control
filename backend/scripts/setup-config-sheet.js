import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { DEFAULT_MODELS } from '../lib/modelConfig.js';

const SPREADSHEET_ID = process.env.BUSINESS_SHEET_ID;

const ROLLEN_BESCHREIBUNG = {
  'chat-kunde':      'Kundenanfragen-Chat (anfrage.html Widget, POST /api/anfragen/chat)',
  'klassifizierung': 'Varianten-Klassifizierung: unübliche Kombinationen erkennen (suggest_variants)',
  'seo-text':        'SEO-Beschreibungsgenerierung in der Artikelerfassung (seo_description)',
  'agent-intern':    'Interner Dashboard-Assistent + sonstige Admin-Aktionen (Mission Control Chat)',
};

const anbieter = wert => {
  if (wert.startsWith('claude')) return 'Anthropic';
  if (wert.startsWith('gemini')) return 'Google';
  return '';
};

const heuteDE = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};

const TAB = {
  name: 'Config',
  header: [
    'Schlüssel',      // A
    'Wert',           // B
    'Anbieter',       // C
    'Beschreibung',   // D
    'Geändert-Am',    // E
  ],
  widths: [180, 220, 100, 380, 110],
  note: 'Modell-Zuordnung: Schlüssel im Format modell.<rolle>. Nur Werte, die gegen ^(claude|gemini)-[a-z0-9.-]+$ matchen, werden von getModel() übernommen – sonst greift der Code-Fallback aus backend/lib/modelConfig.js.',
};

const col = letter => letter.toUpperCase().charCodeAt(0) - 65;

function numberFormatRequest(sheetId, colLetter, type, pattern) {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 2, // ab Zeile 3 (Header + Hinweis-Zeile bleiben Text)
        startColumnIndex: col(colLetter),
        endColumnIndex:   col(colLetter) + 1,
      },
      cell: { userEnteredFormat: { numberFormat: { type, pattern } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  };
}

function defaultModelRows() {
  return Object.entries(DEFAULT_MODELS).map(([rolle, wert]) => [
    `modell.${rolle}`,
    wert,
    anbieter(wert),
    ROLLEN_BESCHREIBUNG[rolle] ?? '',
    heuteDE(),
  ]);
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
    rows.push(...defaultModelRows());

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tab.name}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
    console.log(`     ${defaultModelRows().length} Standard-Zeilen aus DEFAULT_MODELS eingefügt.`);

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
          numberFormatRequest(sheetId, 'E', 'DATE', 'DD.MM.YYYY'),
        ],
      },
    });
    console.log(`     Formatierung angewendet (Spaltenbreiten, Datum E).`);
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
  if (missingCols.length > 0) {
    console.log(`     ⚠  Fehlende Spalten: ${missingCols.join(', ')} – bitte manuell ergänzen.`);
  }

  const { data: allData } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab.name}!A:A`,
  });
  const existingKeys = new Set((allData.values ?? []).flat());
  const missingRows = defaultModelRows().filter(row => !existingKeys.has(row[0]));

  if (missingRows.length === 0) {
    console.log(`     Alle Standard-Rollen aus DEFAULT_MODELS bereits vorhanden – keine Änderungen.`);
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab.name}!A:E`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: missingRows },
  });
  console.log(`     ${missingRows.length} fehlende Standard-Zeile(n) ergänzt: ${missingRows.map(r => r[0]).join(', ')}`);
}

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('Fehler: BUSINESS_SHEET_ID fehlt in .env');
    process.exit(1);
  }

  console.log(`Config-Sheet Setup – Sheet-ID: ${SPREADSHEET_ID}`);
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
