// BO5-4: haengt in "Warenkorb_LShop" (SSOT) die Spalte "Lager_Ziel" ganz hinten an ("bei Ankunft ins Lager",
// leer = nein, sonst Ortsname; nur eigene Positionen).
//
//   node backend/scripts/setup-korb-lager-ziel.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-korb-lager-ziel.js --write   schreibt die eine Kopfzelle
//
// Idempotent: Gibt es die Spalte, passiert nichts. Geschrieben wird NUR die Kopfzelle direkt hinter der letzten
// belegten Kopfspalte, und nur, wenn diese Spalte in allen Zeilen leer ist. Nie eine Zeile oder Spalte loeschen.
// RAW, zurueckgelesen. Bestehende Zeilen bleiben, wie sie sind (leer = nicht ins Lager).

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { findHeader } from '../utils/sheet-headers.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { TAB_KORB } from '../utils/korb-logic.js';
import { lagerZielSpaltePlan } from '../utils/lager-eingang.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const WRITE = process.argv.includes('--write');

async function main() {
  if (!SPREADSHEET_ID) throw new Error('GOOGLE_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties(title,sheetId,gridProperties)' });
  const reiter = (meta.sheets ?? []).map(s => s.properties).find(p => p.title === TAB_KORB);
  if (!reiter) throw new Error(`Reiter "${TAB_KORB}" fehlt.`);
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB_KORB}'` });
  const werte = data.values ?? [];
  const plan = lagerZielSpaltePlan(werte);
  console.log(`Reiter "${TAB_KORB}": ${plan.kopfBreite} Kopfspalten, ${werte.length - 1} Zeilen.`);
  if (plan.da) { console.log('✓ Spalte Lager_Ziel vorhanden. Nichts zu tun.'); return; }
  if (findHeader(werte[0] ?? [], 'Schluessel') < 0) throw new Error('Spalte "Schluessel" fehlt - nichts geschrieben.');
  const ziel = `'${TAB_KORB}'!${colLetter(plan.spalte)}1`;
  console.log(`Plan: ${ziel} = Lager_Ziel`);
  if (plan.belegt) throw new Error(`${plan.belegt} Zeile(n) haben schon Werte in der Zielspalte - nichts geschrieben.`);
  const fehlen = plan.spalte + 1 - (reiter.gridProperties?.columnCount ?? 0);
  if (fehlen > 0) console.log(`Das Raster bekommt ${fehlen} Spalte(n) mehr.`);
  if (!WRITE) { console.log('Trockenlauf - nichts geschrieben. Mit --write schreiben.'); return; }

  if (fehlen > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ appendDimension: { sheetId: reiter.sheetId, dimension: 'COLUMNS', length: fehlen } }] } });
  }
  await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: ziel, valueInputOption: 'RAW', requestBody: { values: [['Lager_Ziel']] } });
  const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB_KORB}'!1:1` });
  const k2 = zurueck.values?.[0] ?? [];
  const ok = JSON.stringify(k2.slice(0, plan.spalte)) === JSON.stringify((werte[0] ?? []).slice(0, plan.spalte)) && k2[plan.spalte] === 'Lager_Ziel';
  console.log(ok ? '✓ Spalte Lager_Ziel angelegt, Kopfzeile zurueckgelesen.' : '✗ Kopfzeile weicht beim Zuruecklesen ab - bitte pruefen.');
  if (!ok) process.exitCode = 1;
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
