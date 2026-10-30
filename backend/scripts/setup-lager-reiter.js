// Legt im SSOT-Sheet die Lager-Reiter an (BO5-1): Lager_Buchungen, Lager_Artikel, Lager_Orte.
//
//   node backend/scripts/setup-lager-reiter.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-lager-reiter.js --write   legt die fehlenden Reiter an
//
// Idempotent: Einen vorhandenen Reiter fasst das Skript nicht an; fehlende Spalten werden nur gemeldet
// (von Hand pruefen). Nur NEUE Reiter, kein bestehender Reiter wird geaendert (auch Produkt_Inventar nicht).
// Kopfzeile RAW, fett, fixiert; Textformat fuer Nummern-/Schluesselspalten NACH dem Schreiben der Kopfzeile
// (Befund LS2: values.update loescht das Format beschriebener Zellen). Lager_Orte bleibt leer - Orte legt der
// Inhaber in MC an ("+ neuer Ort"). Danach zurueckgelesen.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { reiterPlan } from '../utils/lager-setup.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const WRITE = process.argv.includes('--write');

async function main() {
  if (!SPREADSHEET_ID) throw new Error('GOOGLE_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties(title,sheetId)' });
  const titel = (data.sheets ?? []).map(s => s.properties.title);
  const koepfe = {};
  for (const tab of titel.filter(x => x.startsWith('Lager_'))) {
    const { data: k } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!1:1` });
    koepfe[tab] = k.values?.[0] ?? [];
  }
  const plan = reiterPlan(titel, koepfe);
  for (const v of plan.vorhanden) {
    console.log(v.fehlt.length ? `✗ Reiter "${v.tab}" gibt es schon, es fehlen Spalten: ${v.fehlt.join(', ')} - bitte von Hand pruefen.`
      : `✓ Reiter "${v.tab}" gibt es schon, alle Spalten da.`);
  }
  if (!plan.neu.length) { console.log('Nichts anzulegen.'); if (plan.vorhanden.some(v => v.fehlt.length)) process.exitCode = 1; return; }
  for (const n of plan.neu) console.log(`Anlegen: "${n.tab}" mit ${n.spalten.length} Spalten: ${n.spalten.join(' | ')}${n.text.length ? `  (Text: ${n.text.join(', ')})` : ''}`);
  if (!WRITE) { console.log('Trockenlauf - nichts angelegt. Mit --write anlegen.'); return; }

  let ok = true;
  for (const n of plan.neu) {
    const { data: add } = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: n.tab, gridProperties: { rowCount: n.zeilen, columnCount: n.spalten.length, frozenRowCount: 1 } } } }] },
    });
    const sheetId = add.replies[0].addSheet.properties.sheetId;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `'${n.tab}'!A1`, valueInputOption: 'RAW', requestBody: { values: [n.spalten] },
    });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
        ...n.text.map(name => n.spalten.indexOf(name)).map(i => ({ repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat',
        } })),
      ] },
    });
    const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${n.tab}'!1:1` });
    const gleich = JSON.stringify(zurueck.values?.[0] ?? []) === JSON.stringify(n.spalten);
    console.log(gleich ? `✓ Reiter "${n.tab}" angelegt, Kopfzeile zurueckgelesen.` : `✗ "${n.tab}": Kopfzeile weicht beim Zuruecklesen ab - bitte pruefen.`);
    ok &&= gleich;
  }
  if (!ok) process.exitCode = 1;
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
