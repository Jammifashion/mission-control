// PP1 (Inhaber 04.11., antwort-PP1): optionale Spalte `Saldo_Kachel` hinten im Business-Reiter `Partner` und fuer P-012 "nein".
//
//   node backend/scripts/setup-partner-saldo-kachel.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-partner-saldo-kachel.js --write   haengt die Kopfzelle an und setzt P-012 = "nein"
//
// Idempotent. Aendert nichts sonst im Reiter: nur die eine Kopfzelle (falls sie fehlt) und die eine Zelle von P-012 (nur wenn
// sie leer ist). EIN values.batchUpdate RAW, danach zurueckgelesen. Ausgabe nur IDs und Spaltennummern, keine Namen.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { SALDO_KACHEL_SPALTE } from '../utils/partner-saldo.js';

const SHEET = process.env.BUSINESS_SHEET_ID;
const WRITE = process.argv.includes('--write');
const TAB = 'Partner';
const OHNE_SALDO = { 'P-012': 'nein' };   // Inhaber 04.11.: Lizenz-% bleibt, nur die Kachel faellt weg

const spalte = i => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

async function main() {
  if (!SHEET) throw new Error('BUSINESS_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: SHEET, fields: 'sheets.properties(title,sheetId,gridProperties)' });
  const info = meta.sheets.find(x => x.properties.title === TAB)?.properties;
  if (!info) throw new Error(`Reiter ${TAB} fehlt.`);
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET, range: `'${TAB}'` });
  const [kopf = [], ...zeilen] = data.values ?? [];
  const iId = kopf.indexOf('Partner-ID');
  if (iId < 0) throw new Error('Spalte Partner-ID fehlt.');
  let iS = kopf.indexOf(SALDO_KACHEL_SPALTE);
  const neueSpalte = iS < 0;
  if (neueSpalte) iS = kopf.length;
  const zellen = [];
  if (neueSpalte) zellen.push({ range: `'${TAB}'!${spalte(iS)}1`, wert: SALDO_KACHEL_SPALTE });
  for (const [pid, wert] of Object.entries(OHNE_SALDO)) {
    const z = zeilen.findIndex(r => String(r[iId] ?? '').trim() === pid);
    if (z < 0) { console.log(`✗ ${pid} steht nicht im Reiter - nichts gesetzt.`); process.exitCode = 1; continue; }
    const alt = String(zeilen[z][iS] ?? '').trim();
    if (alt === wert) { console.log(`✓ ${pid}: ${SALDO_KACHEL_SPALTE} ist schon "${wert}".`); continue; }
    if (alt) { console.log(`✗ ${pid}: ${SALDO_KACHEL_SPALTE} steht schon auf "${alt}" - nicht ueberschrieben.`); process.exitCode = 1; continue; }
    zellen.push({ range: `'${TAB}'!${spalte(iS)}${z + 2}`, wert });
  }
  console.log(neueSpalte ? `Ergaenzen: "${TAB}" hinten ${SALDO_KACHEL_SPALTE} (Spalte ${iS + 1})` : `✓ Spalte ${SALDO_KACHEL_SPALTE} gibt es schon (Spalte ${iS + 1}).`);
  for (const z of zellen) console.log(`  ${z.range} = "${z.wert}"`);
  if (!zellen.length) { console.log('Nichts zu tun.'); return; }
  if (!WRITE) { console.log('Trockenlauf - nichts geschrieben. Mit --write schreiben.'); return; }

  if (neueSpalte && iS + 1 > (info.gridProperties?.columnCount ?? 0)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET, requestBody: { requests: [
      { appendDimension: { sheetId: info.sheetId, dimension: 'COLUMNS', length: iS + 1 - info.gridProperties.columnCount } },
    ] } });
  }
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET, requestBody: { valueInputOption: 'RAW', data: zellen.map(z => ({ range: z.range, values: [[z.wert]] })) } });
  const { data: zurueck } = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET, ranges: zellen.map(z => z.range) });
  const ok = zellen.every((z, i) => String(zurueck.valueRanges?.[i]?.values?.[0]?.[0] ?? '') === z.wert);
  console.log(ok ? `✓ ${zellen.length} Zelle(n) geschrieben und zurueckgelesen.` : '✗ Zuruecklesen weicht ab - bitte pruefen.');
  if (!ok) process.exitCode = 1;
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
