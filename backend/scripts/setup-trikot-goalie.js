// TR7: haengt im Business-Sheet, Reiter "Trikots", die Spalte "Goalie" ganz hinten an (Wert "ja" oder leer).
// Ohne die Spalte lehnt MC "Goalie" ab (409, code einrichtung); alles andere laeuft wie bisher.
//
//   node backend/scripts/setup-trikot-goalie.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-trikot-goalie.js --write   schreibt die eine Kopfzelle
//
// Idempotent: Gibt es die Spalte, passiert nichts. Geschrieben wird NUR die Kopfzelle direkt hinter der letzten
// belegten Kopfspalte, und nur, wenn diese Spalte in allen Zeilen leer ist. Nie eine Zeile oder Spalte loeschen.
// RAW, zurueckgelesen. Der Trikot-Sync schreibt die Spalte nie (toSheetRow: null).

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { findHeader } from '../utils/sheet-headers.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { TAB_TRIKOTS, SPALTE_GOALIE } from '../utils/trikot-logic.js';

const SPREADSHEET_ID = process.env.BUSINESS_SHEET_ID;
const WRITE = process.argv.includes('--write');

async function main() {
  if (!SPREADSHEET_ID) throw new Error('BUSINESS_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties(title,sheetId,gridProperties)' });
  const reiter = (meta.sheets ?? []).map(s => s.properties).find(p => p.title === TAB_TRIKOTS);
  if (!reiter) throw new Error(`Reiter "${TAB_TRIKOTS}" fehlt.`);
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB_TRIKOTS}'` });
  const werte = data.values ?? [];
  const kopf = werte[0] ?? [];
  console.log(`Reiter "${TAB_TRIKOTS}": ${kopf.length} Kopfspalten, ${werte.length - 1} Zeilen.`);
  if (findHeader(kopf, SPALTE_GOALIE) >= 0) { console.log(`✓ Spalte ${SPALTE_GOALIE} vorhanden. Nichts zu tun.`); return; }
  if (findHeader(kopf, 'Zeilen-ID') < 0) throw new Error('Spalte "Zeilen-ID" fehlt - nichts geschrieben.');
  let spalte = kopf.length;
  while (spalte > 0 && !String(kopf[spalte - 1] ?? '').trim()) spalte--;
  const ziel = `'${TAB_TRIKOTS}'!${colLetter(spalte)}1`;
  console.log(`Plan: ${ziel} = ${SPALTE_GOALIE}`);
  const belegt = werte.slice(1).filter(r => String(r[spalte] ?? '').trim()).length;
  if (belegt) throw new Error(`${belegt} Zeile(n) haben schon Werte in der Zielspalte - nichts geschrieben.`);
  const fehlen = spalte + 1 - (reiter.gridProperties?.columnCount ?? 0);
  if (fehlen > 0) console.log(`Das Raster bekommt ${fehlen} Spalte(n) mehr.`);
  if (!WRITE) { console.log('Trockenlauf - nichts geschrieben. Mit --write schreiben.'); return; }

  if (fehlen > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ appendDimension: { sheetId: reiter.sheetId, dimension: 'COLUMNS', length: fehlen } }] } });
  }
  await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: ziel, valueInputOption: 'RAW', requestBody: { values: [[SPALTE_GOALIE]] } });
  const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB_TRIKOTS}'!1:1` });
  const k2 = zurueck.values?.[0] ?? [];
  const ok = JSON.stringify(k2.slice(0, spalte)) === JSON.stringify(kopf.slice(0, spalte)) && k2[spalte] === SPALTE_GOALIE;
  console.log(ok ? `✓ Spalte ${SPALTE_GOALIE} angelegt, Kopfzeile zurueckgelesen.` : '✗ Kopfzeile weicht beim Zuruecklesen ab - bitte pruefen.');
  if (!ok) process.exitCode = 1;
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
