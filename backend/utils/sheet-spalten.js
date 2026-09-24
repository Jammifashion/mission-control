// Spalten zur Laufzeit anlegen. Zentrale Stelle, damit Vertrag-ab (Partner)
// und Marke (Erfassungsmaske) dasselbe Verhalten haben.

import { findHeader } from './sheet-headers.js';

// Liefert Spaltenbuchstaben für Index (0=A, 25=Z, 26=AA …)
export function colLetter(idx) {
  let s = ''; idx++;
  while (idx > 0) { idx--; s = String.fromCharCode(65 + (idx % 26)) + s; idx = Math.floor(idx / 26); }
  return s;
}

// Legt eine Spalte am Ende der Kopfzeile an, falls es sie noch nicht gibt.
// Gesucht wird über findHeader (normalisiert, exakt). Geschrieben wird nur der
// Name in Zeile 1 - Bestandszeilen bleiben LEER. Mutiert header, damit die
// folgenden Index-Lookups die neue Spalte sehen.
//
// Voraussetzung: header ist die VOLLSTÄNDIGE Kopfzeile. Wurde sie auf eine
// Endspalte begrenzt gelesen, zeigt header.length womöglich auf eine belegte
// Spalte.
export async function sichereSpalte(sheets, sheetId, tab, header, name) {
  const idx = findHeader(header, name);
  if (idx !== -1) return idx;
  const neu = header.length;
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${tab}!${colLetter(neu)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [[name]] },
  });
  header.push(name);
  return neu;
}

// Wie sichereSpalte, setzt beim ANLEGEN zusaetzlich das Zahlenformat Text (@)
// fuer die ganze Spalte ab Zeile 2. Fuer Nummern, die Sheets sonst als Zahl
// deutet (L-Shop-ArticleNr: 10 Ziffern, beim Import einst zu E+12 gekuerzt).
// Eine bereits vorhandene Spalte bleibt unangetastet.
// tabSheetId = numerische sheetId des Reiters (nicht die Spreadsheet-ID).
export async function sichereTextSpalte(sheets, sheetId, tab, tabSheetId, header, name) {
  const vorhanden = findHeader(header, name);
  if (vorhanden !== -1) return vorhanden;
  const idx = await sichereSpalte(sheets, sheetId, tab, header, name);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{ repeatCell: {
      range:  { sheetId: tabSheetId, startRowIndex: 1, startColumnIndex: idx, endColumnIndex: idx + 1 },
      cell:   { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
      fields: 'userEnteredFormat.numberFormat',
    } }] },
  });
  return idx;
}
