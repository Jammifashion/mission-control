// PD2: optionale Spalte `Detailansicht` hinten in den Business-Reitern `FP_Partner` und `Partner` (leer = aus, "ja" = an).
// Das Skript legt NUR die Kopfzelle an (und erweitert vorher das Spaltenraster, falls noetig - Lehre FIX2). Welcher Partner
// "ja" bekommt, traegt der Inhaber selbst im Sheet ein. Im Lizenz-Reiter hat der Schalter vorerst keine Wirkung.
//
//   node backend/scripts/setup-partner-detailansicht.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-partner-detailansicht.js --write   Kopfzellen anlegen, zuruecklesen
//
// Idempotent. Aendert sonst nichts. Ausgabe nur Reiter und Spaltennummern.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { sichereSpaltenRaster } from '../lib/sheet-zeilen.js';
import { DETAIL_SPALTE } from '../utils/partner-uebersicht.js';

const SHEET = process.env.BUSINESS_SHEET_ID;
const WRITE = process.argv.includes('--write');
const TABS = ['FP_Partner', 'Partner'];
const spalte = i => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

async function main() {
  if (!SHEET) throw new Error('BUSINESS_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const plan = [];
  for (const tab of TABS) {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET, range: `'${tab}'!1:1` });
    const kopf = data.values?.[0] ?? [];
    if (!kopf.includes('Partner-ID')) throw new Error(`${tab}: Spalte Partner-ID fehlt - nichts geschrieben.`);
    const i = kopf.indexOf(DETAIL_SPALTE);
    if (i >= 0) { console.log(`✓ ${tab}: ${DETAIL_SPALTE} gibt es schon (Spalte ${i + 1}).`); continue; }
    plan.push({ tab, index: kopf.length, range: `'${tab}'!${spalte(kopf.length)}1` });
    console.log(`Ergaenzen: ${tab} hinten ${DETAIL_SPALTE} (Spalte ${kopf.length + 1}, ${spalte(kopf.length)}1)`);
  }
  if (!plan.length) { console.log('Nichts zu tun.'); return; }
  if (!WRITE) { console.log('Trockenlauf - nichts geschrieben. Mit --write schreiben.'); return; }
  for (const p of plan) await sichereSpaltenRaster(sheets, SHEET, p.tab, p.index + 1);
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET, requestBody: { valueInputOption: 'RAW',
    data: plan.map(p => ({ range: p.range, values: [[DETAIL_SPALTE]] })) } });
  const { data: zurueck } = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET, ranges: plan.map(p => p.range) });
  const ok = plan.every((p, i) => String(zurueck.valueRanges?.[i]?.values?.[0]?.[0] ?? '') === DETAIL_SPALTE);
  console.log(ok ? `✓ ${plan.length} Kopfzelle(n) geschrieben und zurueckgelesen.` : '✗ Zuruecklesen weicht ab - bitte pruefen.');
  if (!ok) process.exitCode = 1;
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
