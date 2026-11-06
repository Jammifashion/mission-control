// AL2: legt im SSOT den Reiter "Alarm_Stand" an (Schluessel | Letzte_Zeitueberschreitung | Stand).
// Ohne den Reiter meldet MC jede Shop-Zeitueberschreitung sofort (wie vor AL2).
//
//   node backend/scripts/setup-alarm-stand.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-alarm-stand.js --write   legt Reiter + Kopfzeile an
//
// Idempotent: Gibt es den Reiter mit dieser Kopfzeile, passiert nichts. Hat er eine andere Kopfzeile oder Inhalt
// ohne Kopf, wird nichts geschrieben. Nie loeschen. RAW, zurueckgelesen.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { TAB_ALARM, KOPF_ALARM } from '../utils/alarm-stand.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const WRITE = process.argv.includes('--write');

async function main() {
  if (!SPREADSHEET_ID) throw new Error('GOOGLE_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties(title,sheetId)' });
  const da = (meta.sheets ?? []).some(s => s.properties.title === TAB_ALARM);
  const range = `'${TAB_ALARM}'!A1:${String.fromCharCode(64 + KOPF_ALARM.length)}1`;
  if (da) {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB_ALARM}'` });
    const werte = data.values ?? [];
    if (JSON.stringify((werte[0] ?? []).slice(0, KOPF_ALARM.length)) === JSON.stringify(KOPF_ALARM)) {
      console.log(`✓ Reiter "${TAB_ALARM}" mit Kopfzeile vorhanden (${werte.length - 1} Zeilen). Nichts zu tun.`);
      return;
    }
    if (werte.length) throw new Error(`Reiter "${TAB_ALARM}" hat eine andere Kopfzeile oder Inhalt - nichts geschrieben.`);
    console.log(`Plan: leeren Reiter "${TAB_ALARM}" mit Kopfzeile ${KOPF_ALARM.join(' | ')} versehen.`);
  } else {
    console.log(`Plan: Reiter "${TAB_ALARM}" anlegen, Kopfzeile ${KOPF_ALARM.join(' | ')}.`);
  }
  if (!WRITE) { console.log('Trockenlauf - nichts geschrieben. Mit --write schreiben.'); return; }

  if (!da) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [
      { addSheet: { properties: { title: TAB_ALARM, gridProperties: { rowCount: 100, columnCount: KOPF_ALARM.length, frozenRowCount: 1 } } } },
    ] } });
  }
  await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range, valueInputOption: 'RAW', requestBody: { values: [KOPF_ALARM] } });
  const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const ok = JSON.stringify(zurueck.values?.[0] ?? []) === JSON.stringify(KOPF_ALARM);
  console.log(ok ? `✓ Reiter "${TAB_ALARM}" angelegt, Kopfzeile zurueckgelesen.` : '✗ Kopfzeile weicht beim Zuruecklesen ab - bitte pruefen.');
  if (!ok) process.exitCode = 1;
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
