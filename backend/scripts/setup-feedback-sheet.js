// FB1: legt das Google Sheet "MC Feedback" (geteilte Ablage "Mission Control") mit dem Reiter `Feedback` an.
//
//   node backend/scripts/setup-feedback-sheet.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-feedback-sheet.js --write   legt Datei, Reiter und Kopfzeile an und nennt die Sheet-ID
//
// Idempotent: Datei vorhanden -> nicht neu angelegt; Reiter vorhanden -> fehlende Spalten werden nur HINTEN ergaenzt,
// vorhandene Zellen nie angefasst. Kopfzeile RAW, fett, fixiert; alle Spalten Textformat (Formel-Schutz, FB-Nr bleibt Text),
// gesetzt NACH dem Schreiben (Befund LS2). Danach zurueckgelesen.
// Die Sheet-ID erscheint NUR im Terminal - sie gehoert in das Secret FEEDBACK_SHEET_ID (und lokal in die .env), nie ins Repo/Postfach.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { richteFeedbackSheetEin, FEEDBACK_SHEET_NAME } from '../lib/belegArchiv.js';
import { TAB, SPALTEN } from '../utils/feedback.js';

const WRITE = process.argv.includes('--write');
const BREIT = { Text: 420, KI_Zusammenfassung: 320, 'KI_Lösungsidee': 320, KI_Titel: 220, Otto_Notiz: 260, Ansicht_lesbar: 200 };

async function main() {
  const datei = await richteFeedbackSheetEin({ write: WRITE });
  if (datei.wuerde) {
    console.log(`Drive: "${FEEDBACK_SHEET_NAME}" fehlt in der geteilten Ablage -> wuerde angelegt.`);
    console.log(`Reiter "${TAB}" mit ${SPALTEN.length} Spalten: ${SPALTEN.join(' | ')}`);
    console.log('Trockenlauf - nichts angelegt. Mit --write anlegen.');
    return;
  }
  console.log(datei.neu ? `✓ Drive: "${FEEDBACK_SHEET_NAME}" angelegt.` : `Drive: "${FEEDBACK_SHEET_NAME}" vorhanden - Datei nicht angefasst.`);
  const spreadsheetId = datei.id;
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId,gridProperties)' });
  const blaetter = (data.sheets ?? []).map(s => s.properties);
  let blatt = blaetter.find(b => b.title === TAB);

  if (!blatt) {
    // frische Datei: das eine leere Blatt umbenennen; sonst neuen Reiter anlegen
    const leer = datei.neu && blaetter.length === 1 ? blaetter[0] : null;
    console.log(leer ? `Reiter "${leer.title}" -> "${TAB}"` : `Reiter "${TAB}" fehlt -> wird angelegt`);
    if (!WRITE) { console.log('Trockenlauf - nichts geschrieben.'); return; }
    const { data: r } = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [leer
      ? { updateSheetProperties: { properties: { sheetId: leer.sheetId, title: TAB }, fields: 'title' } }
      : { addSheet: { properties: { title: TAB, gridProperties: { rowCount: 1000, columnCount: SPALTEN.length } } } }] } });
    blatt = leer ? { ...leer, title: TAB } : r.replies[0].addSheet.properties;
  }

  const { data: k } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!1:1` });
  const kopf = (k.values?.[0] ?? []).map(x => String(x).trim());
  const fehlt = SPALTEN.filter(s => !kopf.includes(s));
  if (!fehlt.length) {
    console.log(`✓ Reiter "${TAB}": alle ${SPALTEN.length} Spalten da.`);
  } else {
    const neu = [...kopf, ...fehlt];
    console.log(`${kopf.length ? 'Fehlende Spalten hinten ergaenzen' : 'Kopfzeile anlegen'}: ${fehlt.join(' | ')}`);
    if (!WRITE) { console.log('Trockenlauf - nichts geschrieben. Mit --write schreiben.'); }
    else {
      const spaltenDa = blatt.gridProperties?.columnCount ?? 26;
      const requests = [];
      if (neu.length > spaltenDa) requests.push({ appendDimension: { sheetId: blatt.sheetId, dimension: 'COLUMNS', length: neu.length - spaltenDa } });
      if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
      await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: [neu] } });
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
        { repeatCell: { range: { sheetId: blatt.sheetId, startColumnIndex: 0, endColumnIndex: neu.length }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' }, wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(numberFormat,wrapStrategy,verticalAlignment)' } },
        { repeatCell: { range: { sheetId: blatt.sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
        { updateSheetProperties: { properties: { sheetId: blatt.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
        ...neu.map((n, i) => BREIT[n] ? { updateDimensionProperties: { range: { sheetId: blatt.sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: BREIT[n] }, fields: 'pixelSize' } } : null).filter(Boolean),
      ] } });
      const { data: z } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!1:1` });
      const ist = (z.values?.[0] ?? []).map(x => String(x).trim());
      if (JSON.stringify(ist) !== JSON.stringify(neu)) throw new Error('Kopfzeile weicht beim Zuruecklesen ab.');
      console.log(`✓ Kopfzeile geschrieben und zurueckgelesen (${neu.length} Spalten).`);
    }
  }
  console.log('');
  console.log('Sheet-ID (nur hier im Terminal - als Secret FEEDBACK_SHEET_ID hinterlegen, lokal in die .env des Hauptordners):');
  console.log(spreadsheetId);
}

main().catch(e => { console.error(`✗ ${e.message}`); process.exit(1); });
