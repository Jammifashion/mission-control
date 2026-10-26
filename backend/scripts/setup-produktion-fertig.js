// PS1: haengt in "Produktions_Status" (SSOT) die Spalten "Fertig" und "Fertig_Am" hinten an.
//
//   node backend/scripts/setup-produktion-fertig.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-produktion-fertig.js --write   schreibt die zwei Kopfzellen
//
// Idempotent: Gibt es beide Spalten, passiert nichts. Fehlt nur eine, wird nichts geschrieben (von Hand
// pruefen). Geschrieben werden NUR die Kopfzellen direkt hinter der letzten belegten Kopfspalte, und nur,
// wenn diese Spalten in allen Zeilen leer sind. Nie eine Zeile oder Spalte loeschen. RAW, zurueckgelesen.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { findHeader } from '../utils/sheet-headers.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { PS_FERTIG, PS_FERTIG_AM } from '../utils/produktion-stand.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const WRITE = process.argv.includes('--write');
const TAB = 'Produktions_Status';
const NEU = [PS_FERTIG, PS_FERTIG_AM];

async function main() {
  if (!SPREADSHEET_ID) throw new Error('GOOGLE_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties(title,sheetId,gridProperties)' });
  const reiter = (meta.sheets ?? []).map(s => s.properties).find(p => p.title === TAB);
  if (!reiter) throw new Error(`Reiter "${TAB}" fehlt.`);

  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'` });
  const werte = data.values ?? [];
  const kopf = werte[0] ?? [];
  const da = NEU.filter(n => findHeader(kopf, n) >= 0);
  console.log(`Reiter "${TAB}": ${kopf.length} Kopfspalten, ${werte.length - 1} Zeilen. Kopf: ${kopf.join(' | ')}`);
  if (da.length === NEU.length) { console.log('✓ Beide Spalten vorhanden. Nichts zu tun.'); return; }
  if (da.length) throw new Error(`Nur "${da.join(', ')}" vorhanden - bitte von Hand pruefen, nichts geschrieben.`);

  // Erste Spalte hinter der letzten belegten Kopfzelle; die Zielspalten muessen in jeder Zeile leer sein.
  let start = kopf.length;
  while (start > 0 && !String(kopf[start - 1] ?? '').trim()) start--;
  const belegt = werte.slice(1).filter(r => NEU.some((_, i) => String(r[start + i] ?? '').trim())).length;
  const ziel = `'${TAB}'!${colLetter(start)}1:${colLetter(start + NEU.length - 1)}1`;
  console.log(`Plan: ${ziel} = ${NEU.join(' | ')}`);
  if (belegt) throw new Error(`${belegt} Zeile(n) haben schon Werte in ${colLetter(start)}/${colLetter(start + 1)} - nichts geschrieben.`);
  const fehlenSpalten = start + NEU.length - (reiter.gridProperties?.columnCount ?? 0);
  if (fehlenSpalten > 0) console.log(`Das Raster bekommt ${fehlenSpalten} Spalte(n) mehr.`);
  if (!WRITE) { console.log('Trockenlauf - nichts geschrieben. Mit --write schreiben.'); return; }

  if (fehlenSpalten > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ appendDimension: { sheetId: reiter.sheetId, dimension: 'COLUMNS', length: fehlenSpalten } }] },
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: ziel, valueInputOption: 'RAW', requestBody: { values: [NEU] },
  });
  const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!1:1` });
  const k2 = zurueck.values?.[0] ?? [];
  const ok = JSON.stringify(k2.slice(0, start)) === JSON.stringify(kopf.slice(0, start)) && NEU.every((n, i) => k2[start + i] === n);
  console.log(ok ? `✓ Spalten ${NEU.join(', ')} angelegt, Kopfzeile zurueckgelesen.` : '✗ Kopfzeile weicht beim Zuruecklesen ab - bitte pruefen.');
  if (!ok) process.exitCode = 1;
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
