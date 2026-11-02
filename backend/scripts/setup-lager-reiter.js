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
import { reiterPlan, orteFehlend, orteAusArgs } from '../utils/lager-setup.js';
import { schreibeNeueZeilen } from '../lib/sheet-zeilen.js';
import { TAB_ORTE, ORTE_SPALTEN, STATUS_AKTIV } from '../utils/lager.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const WRITE = process.argv.includes('--write');
// BO5-5: --orte "Wrist,Itzehoe" legt fehlende Lagerorte an (nur diese Zeilen, Status aktiv), vorhandene bleiben unveraendert.
const ORTE = orteAusArgs(process.argv);

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
  if (!plan.neu.length) {
    console.log('Keine Reiter anzulegen.');
    if (plan.vorhanden.some(v => v.fehlt.length)) process.exitCode = 1;
    await orteAnlegen(sheets);
    return;
  }
  for (const n of plan.neu) console.log(`Anlegen: "${n.tab}" mit ${n.spalten.length} Spalten: ${n.spalten.join(' | ')}${n.text.length ? `  (Text: ${n.text.join(', ')})` : ''}`);
  if (!WRITE) { console.log('Trockenlauf - nichts angelegt. Mit --write anlegen.'); await orteAnlegen(sheets); return; }

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
  await orteAnlegen(sheets);
}

// Lagerorte: nur fehlende Namen als neue Zeilen (kein append, zurueckgelesen ueber schreibeNeueZeilen).
async function orteAnlegen(sheets) {
  if (!ORTE.length) return;
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB_ORTE}'`, valueRenderOption: 'UNFORMATTED_VALUE' }).catch(() => ({ data: {} }));
  const werte = data.values ?? [];
  if (!werte.length) { console.log(`Reiter "${TAB_ORTE}" fehlt noch - Orte erst nach --write.`); return; }
  const kopf = werte[0].map(k => String(k).trim());
  const vorhanden = werte.slice(1).map(r => r[kopf.indexOf('Ort')]);
  console.log(`Lager_Orte heute: ${vorhanden.filter(Boolean).join(', ') || '(leer)'}`);
  const neu = orteFehlend(vorhanden, ORTE);
  if (!neu.length) { console.log(`✓ Orte ${ORTE.join(', ')} gibt es schon.`); return; }
  console.log(`Anlegen: Orte ${neu.join(', ')} (Status ${STATUS_AKTIV})`);
  if (!WRITE) { console.log('Trockenlauf - keine Orte angelegt.'); return; }
  const zeilen = neu.map(o => kopf.map(k => (k === 'Ort' ? o : k === 'Status' ? STATUS_AKTIV : '')));
  if (ORTE_SPALTEN.some(n => !kopf.includes(n))) throw new Error('Lager_Orte: Spalten fehlen - nichts geschrieben.');
  const start = await schreibeNeueZeilen(sheets, SPREADSHEET_ID, TAB_ORTE, zeilen, { alt: werte });
  console.log(`✓ Orte angelegt ab Zeile ${start}, zurueckgelesen.`);
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
