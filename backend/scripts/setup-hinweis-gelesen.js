// DB1: legt im SSOT den Reiter "Hinweis_Gelesen" an (Shop | Bestellnummer | Pruefsumme | Gelesen_Von | Gelesen_Am).
// Nur IDs + Pruefsumme der Kundennotiz - nie den Text, nie Kundendaten. "gelesen" gilt fuer alle (Dashboard).
//
//   node backend/scripts/setup-hinweis-gelesen.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-hinweis-gelesen.js --write   legt Reiter + Kopfzeile an
//
// Idempotent: Gibt es den Reiter mit dieser Kopfzeile, passiert nichts. Andere Kopfzeile oder Inhalt ohne Kopf -> nichts
// geschrieben. Nie loeschen. RAW, zurueckgelesen.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { TAB_GELESEN, KOPF_GELESEN } from '../utils/dashboard.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const WRITE = process.argv.includes('--write');

async function main() {
  if (!SPREADSHEET_ID) throw new Error('GOOGLE_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties(title,sheetId)' });
  const da = (meta.sheets ?? []).some(s => s.properties.title === TAB_GELESEN);
  const range = `'${TAB_GELESEN}'!A1:${String.fromCharCode(64 + KOPF_GELESEN.length)}1`;
  if (da) {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB_GELESEN}'` });
    const werte = data.values ?? [];
    if (JSON.stringify((werte[0] ?? []).slice(0, KOPF_GELESEN.length)) === JSON.stringify(KOPF_GELESEN)) {
      console.log(`✓ Reiter "${TAB_GELESEN}" mit Kopfzeile vorhanden (${werte.length - 1} Zeilen). Nichts zu tun.`);
      return;
    }
    if (werte.length) throw new Error(`Reiter "${TAB_GELESEN}" hat eine andere Kopfzeile oder Inhalt - nichts geschrieben.`);
    console.log(`Plan: leeren Reiter "${TAB_GELESEN}" mit Kopfzeile ${KOPF_GELESEN.join(' | ')} versehen.`);
  } else {
    console.log(`Plan: Reiter "${TAB_GELESEN}" anlegen, Kopfzeile ${KOPF_GELESEN.join(' | ')}.`);
  }
  if (!WRITE) { console.log('Trockenlauf - nichts geschrieben. Mit --write schreiben.'); return; }

  if (!da) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [
      { addSheet: { properties: { title: TAB_GELESEN, gridProperties: { rowCount: 500, columnCount: KOPF_GELESEN.length, frozenRowCount: 1 } } } },
    ] } });
  }
  await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range, valueInputOption: 'RAW', requestBody: { values: [KOPF_GELESEN] } });
  const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const ok = JSON.stringify(zurueck.values?.[0] ?? []) === JSON.stringify(KOPF_GELESEN);
  console.log(ok ? `✓ Reiter "${TAB_GELESEN}" angelegt, Kopfzeile zurueckgelesen.` : '✗ Kopfzeile weicht beim Zuruecklesen ab - bitte pruefen.');
  if (!ok) process.exitCode = 1;
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
