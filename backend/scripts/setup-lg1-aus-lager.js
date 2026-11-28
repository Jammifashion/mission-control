// LG1: haengt in "Warenkorb_LShop" und "Warenkorb_DTF" (SSOT) die Spalte "Aus_Lager" ganz hinten an (Stueck Fertigware, die
// fuer die Position aus dem Lager kam; Menge der Zeile = Rest). Leer = nichts aus dem Lager.
//
//   node backend/scripts/setup-lg1-aus-lager.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-lg1-aus-lager.js --write   schreibt je Reiter die eine Kopfzelle
//
// Idempotent: Gibt es die Spalte, passiert nichts. Geschrieben wird NUR die Kopfzelle direkt hinter der letzten belegten
// Kopfspalte, und nur, wenn diese Spalte in allen Zeilen leer ist. Nie eine Zeile oder Spalte loeschen. RAW, zurueckgelesen.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { findHeader } from '../utils/sheet-headers.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { TAB_KORB } from '../utils/korb-logic.js';
import { TAB_DTF_KORB } from '../utils/dtf-korb.js';
import { ausLagerSpaltePlan, SPALTE_AUS_LAGER } from '../utils/lager-fertig.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const WRITE = process.argv.includes('--write');

async function reiterEinrichten(sheets, meta, tab) {
  const reiter = (meta.sheets ?? []).map(s => s.properties).find(p => p.title === tab);
  if (!reiter) { console.log(`- Reiter "${tab}" fehlt - übersprungen.`); return true; }
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'` });
  const werte = data.values ?? [];
  const plan = ausLagerSpaltePlan(werte);
  console.log(`Reiter "${tab}": ${plan.kopfBreite} Kopfspalten, ${Math.max(0, werte.length - 1)} Zeilen.`);
  if (plan.da) { console.log(`  ✓ Spalte ${SPALTE_AUS_LAGER} vorhanden. Nichts zu tun.`); return true; }
  if (findHeader(werte[0] ?? [], 'Schluessel') < 0) throw new Error(`${tab}: Spalte "Schluessel" fehlt - nichts geschrieben.`);
  const ziel = `'${tab}'!${colLetter(plan.spalte)}1`;
  console.log(`  Plan: ${ziel} = ${SPALTE_AUS_LAGER}`);
  if (plan.belegt) throw new Error(`${tab}: ${plan.belegt} Zeile(n) haben schon Werte in der Zielspalte - nichts geschrieben.`);
  const fehlen = plan.spalte + 1 - (reiter.gridProperties?.columnCount ?? 0);
  if (fehlen > 0) console.log(`  Das Raster bekommt ${fehlen} Spalte(n) mehr.`);
  if (!WRITE) return true;
  if (fehlen > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ appendDimension: { sheetId: reiter.sheetId, dimension: 'COLUMNS', length: fehlen } }] } });
  }
  await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: ziel, valueInputOption: 'RAW', requestBody: { values: [[SPALTE_AUS_LAGER]] } });
  const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!1:1` });
  const k2 = zurueck.values?.[0] ?? [];
  const ok = JSON.stringify(k2.slice(0, plan.spalte)) === JSON.stringify((werte[0] ?? []).slice(0, plan.spalte)) && k2[plan.spalte] === SPALTE_AUS_LAGER;
  console.log(ok ? `  ✓ Spalte ${SPALTE_AUS_LAGER} angelegt, Kopfzeile zurueckgelesen.` : '  ✗ Kopfzeile weicht beim Zuruecklesen ab - bitte pruefen.');
  return ok;
}

async function main() {
  if (!SPREADSHEET_ID) throw new Error('GOOGLE_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties(title,sheetId,gridProperties)' });
  let ok = true;
  for (const tab of [TAB_KORB, TAB_DTF_KORB]) ok = (await reiterEinrichten(sheets, meta, tab)) && ok;
  if (!WRITE) console.log('Trockenlauf - nichts geschrieben. Mit --write schreiben.');
  if (!ok) process.exitCode = 1;
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
