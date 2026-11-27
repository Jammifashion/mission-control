// KS8: Spalte `Handling_Fanshop` hinten in FP_Artikel_Kategorie (Business-Sheet) anlegen - nur die Kopfzelle.
// Wert (netto, z. B. fuer die Kategorie Trikots) traegt der Inhaber ein; leer = Trikot-Position ohne Preis mit Grund.
//
//   node backend/scripts/setup-fanshop-handling.js          Trockenlauf (Standard)
//   node backend/scripts/setup-fanshop-handling.js --write  schreibt die Kopfzelle (RAW, zurueckgelesen)

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });

const TAB = 'FP_Artikel_Kategorie', SPALTE = 'Handling_Fanshop';
const spalte = i => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

async function main() {
  const WRITE = process.argv.includes('--write');
  const id = process.env.BUSINESS_SHEET_ID;
  if (!id) throw new Error('BUSINESS_SHEET_ID fehlt.');
  const { google } = await import('googleapis');
  const { getGoogleAuth } = await import('../lib/googleAuth.js');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${TAB}'!1:1` });
  const kopf = (data.values?.[0] ?? []).map(x => String(x ?? '').trim());
  if (kopf.includes(SPALTE)) { console.log(`✓ ${TAB}.${SPALTE} gibt es schon (Spalte ${spalte(kopf.indexOf(SPALTE))}).`); return; }
  const range = `'${TAB}'!${spalte(kopf.length)}1`;
  console.log(`+ ${TAB}: Spalte ${spalte(kopf.length)} = ${SPALTE}`);
  if (!WRITE) { console.log('Trockenlauf – nichts geschrieben. Mit --write.'); return; }
  await sheets.spreadsheets.values.update({ spreadsheetId: id, range, valueInputOption: 'RAW', requestBody: { values: [[SPALTE]] } });
  const { data: nach } = await sheets.spreadsheets.values.get({ spreadsheetId: id, range });
  console.log(String(nach.values?.[0]?.[0] ?? '') === SPALTE ? '✓ Kopfzelle geschrieben und zurückgelesen.' : '✗ Kopfzelle anders zurückgelesen.');
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
