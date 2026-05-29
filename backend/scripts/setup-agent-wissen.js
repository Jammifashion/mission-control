import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SPREADSHEET_ID = process.env.BUSINESS_SHEET_ID;

const TAB_NAME = 'Agent_Wissen';

const HEADER = ['Typ', 'Schlüssel', 'Wert', 'Notiz'];

const WIDTHS = [100, 200, 420, 300];

const INITIAL_ROWS = [
  // Produktinfos
  ['produkt', 'mindestmenge',        '10',                                                                  'Minimale Bestellmenge für Einzelpersonen'],
  ['produkt', 'lieferzeit_standard', '7-10 Werktage',                                                      'Standard ohne Expressaufschlag'],
  ['produkt', 'lieferzeit_express',  '3-4 Werktage',                                                       'Expressaufschlag auf Anfrage'],
  ['produkt', 'drucktechniken',      'DTF, Siebdruck',                                                     'Verfügbare Techniken'],
  ['produkt', 'druckpositionen',     'Brust, Rücken, Ärmel',                                               'Mögliche Druckpositionen'],
  ['produkt', 'farbanzahl_preis',    'unabhängig',                                                         'Preis ist unabhängig von Farbanzahl'],
  // Tonalität & FAQs
  ['ton',     'anrede',              'du',                                                                  'Kunden werden geduzt'],
  ['ton',     'stil',                'locker-professionell',                                               'Freundlich aber kompetent'],
  ['ton',     'sonderanfragen',      'auf Anfrage',                                                        'Immer "gerne, ich gebe das weiter"'],
  // Allgemeine Geschäftsinfos
  ['info',    'partnermodelle',      'Wir bieten Staffelpreise sowie Sonderkonditionen für Vereine und Wiederverkäufer an. Details auf Anfrage.', 'Datenschutz: keine Kundennamen'],
  ['info',    'zahlung',             'Rechnung, PayPal, Überweisung',                                      'Zahlungsarten allgemein'],
  ['info',    'versand',             'DHL, versichert',                                                    'Standard-Versandweg'],
];

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('Fehler: BUSINESS_SHEET_ID fehlt in .env');
    process.exit(1);
  }

  console.log(`Agent_Wissen Setup – Sheet-ID: ${SPREADSHEET_ID}`);
  console.log('='.repeat(60));

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const { data: meta } = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties',
  });

  const existing = meta.sheets.find(s => s.properties.title === TAB_NAME);

  if (existing) {
    const sheetId = existing.properties.sheetId;
    console.log(`  ↩  "${TAB_NAME}" existiert bereits (sheetId: ${sheetId})`);

    const { data: headerData } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TAB_NAME}!1:1`,
    });
    const currentHeader = headerData.values?.[0] ?? [];
    const missingCols   = HEADER.filter(h => !currentHeader.includes(h));
    if (missingCols.length === 0) {
      console.log('     Alle Spalten vorhanden – keine Änderungen.');
    } else {
      console.log(`     ⚠  Fehlende Spalten: ${missingCols.join(', ')} – bitte manuell ergänzen.`);
    }
    console.log('='.repeat(60));
    console.log('Setup abgeschlossen ✓');
    return;
  }

  // ── Reiter anlegen ──────────────────────────────────────────────────────
  const { data: addResp } = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: TAB_NAME } } }] },
  });
  const sheetId = addResp.replies[0].addSheet.properties.sheetId;
  console.log(`  ✓  "${TAB_NAME}" angelegt (sheetId: ${sheetId})`);

  // ── Header + Daten schreiben ─────────────────────────────────────────────
  await sheets.spreadsheets.values.update({
    spreadsheetId:   SPREADSHEET_ID,
    range:           `${TAB_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADER, ...INITIAL_ROWS] },
  });
  console.log(`     ${INITIAL_ROWS.length} initiale Einträge geschrieben.`);

  // ── Formatierung ─────────────────────────────────────────────────────────
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        // Header fett + dunkler Hintergrund
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
        // Zeile 1 fixieren
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        // Spaltenbreiten
        ...WIDTHS.map((px, i) => ({
          updateDimensionProperties: {
            range:      { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
            properties: { pixelSize: px },
            fields:     'pixelSize',
          },
        })),
      ],
    },
  });
  console.log('     Formatierung angewendet (Header, Fixierung, Spaltenbreiten).');

  console.log('='.repeat(60));
  console.log('Setup abgeschlossen ✓');
}

main().catch(err => {
  console.error('Fehler:', err.message ?? err);
  process.exit(1);
});
