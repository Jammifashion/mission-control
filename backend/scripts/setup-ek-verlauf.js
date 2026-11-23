// PR1: SSOT-Reiter LShop_EK_Verlauf anlegen (ArticleNr | EK_alt | EK_neu | Geaendert_Am | Quelle_Datei).
// Das L-Shop-Stammdaten-Update schreibt dort ab jetzt je Preisaenderung den alten EK - Grundlage fuer "EK damals" im Marge-Vergleich und die
// Leseliste "EK gestiegen". Nie rueckwirkend EK in Auftraegen/Partner-Reitern aendern.
//
//   node backend/scripts/setup-ek-verlauf.js           Trockenlauf (Standard)
//   node backend/scripts/setup-ek-verlauf.js --write   Reiter + Kopfzeile anlegen, zuruecklesen
// Idempotent; ein vorhandener Reiter wird nur geprueft (Kopfzeile), nie geaendert.
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { TAB_EK_VERLAUF, EK_VERLAUF_SPALTEN } from '../utils/ek-verlauf.js';

const SSOT = process.env.GOOGLE_SHEET_ID;
const WRITE = process.argv.includes('--write');

try {
  if (!SSOT) throw new Error('GOOGLE_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data } = await sheets.spreadsheets.get({ spreadsheetId: SSOT, fields: 'sheets.properties.title' });
  const da = (data.sheets ?? []).some(s => s.properties?.title === TAB_EK_VERLAUF);
  if (da) {
    const { data: k } = await sheets.spreadsheets.values.get({ spreadsheetId: SSOT, range: `'${TAB_EK_VERLAUF}'!1:1` });
    const kopf = (k.values?.[0] ?? []).map(x => String(x).trim());
    const ok = EK_VERLAUF_SPALTEN.every((s, i) => kopf[i] === s);
    console.log(ok ? `✓ ${TAB_EK_VERLAUF} gibt es schon, Kopfzeile passt.` : `✗ ${TAB_EK_VERLAUF} hat eine andere Kopfzeile – bitte prüfen, nichts geändert.`);
    if (!ok) process.exitCode = 1;
  } else if (!WRITE) {
    console.log(`Anlegen: Reiter ${TAB_EK_VERLAUF} mit Kopfzeile ${EK_VERLAUF_SPALTEN.join(' | ')}`);
    console.log('Trockenlauf – nichts geschrieben. Mit --write anlegen.');
  } else {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SSOT, requestBody: { requests: [{ addSheet: { properties: { title: TAB_EK_VERLAUF, gridProperties: { frozenRowCount: 1 } } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId: SSOT, range: `'${TAB_EK_VERLAUF}'!A1`, valueInputOption: 'RAW', requestBody: { values: [EK_VERLAUF_SPALTEN] } });
    const { data: k } = await sheets.spreadsheets.values.get({ spreadsheetId: SSOT, range: `'${TAB_EK_VERLAUF}'!1:1` });
    const ok = EK_VERLAUF_SPALTEN.every((s, i) => String(k.values?.[0]?.[i] ?? '') === s);
    console.log(ok ? `✓ ${TAB_EK_VERLAUF} angelegt und zurückgelesen.` : '✗ Zurücklesen weicht ab – bitte prüfen.');
    if (!ok) process.exitCode = 1;
  }
} catch (err) { console.error('✗', err.message); process.exit(1); }
