// KA1: Spalte `Auftrag_Nr` hinten in `Kundenanfragen` (Business-Sheet) anlegen - nur die Kopfzelle, additiv.
// Trockenlauf Standard (zeigt Kopfzeile, Zeilenzahl, Status-Zaehler, Zellen ohne Kopf - nie Inhalte), `--write` schreibt.
//   node scripts/setup-kundenanfragen-ka1.js [--write]
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { sichereSpaltenRaster, spalteBuchstabe } from '../lib/sheet-zeilen.js';
import { TAB, SPALTEN, SPALTE_AUFTRAG, anfragenAus, fehlendeSpalten } from '../utils/anfragen.js';

const write = process.argv.includes('--write');
const spreadsheetId = process.env.BUSINESS_SHEET_ID;
if (!spreadsheetId) { console.error('BUSINESS_SHEET_ID fehlt.'); process.exit(1); }

const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
const werte = data.values ?? [];
const kopf = werte[0] ?? [];
const { idx, anfragen } = anfragenAus(werte);
console.log(`Kopfzeile (${kopf.length}): ${JSON.stringify(kopf)}`);
console.log(`Anfragen: ${anfragen.length}`);
const status = {};
for (const a of anfragen) status[a.status || '(leer)'] = (status[a.status || '(leer)'] ?? 0) + 1;
console.log(`Status: ${JSON.stringify(status)}`);
const ohneKopf = werte.slice(1).filter(r => (r ?? []).slice(kopf.length).some(c => String(c ?? '').trim())).length;
console.log(`Zeilen mit Werten hinter der Kopfzeile: ${ohneKopf}`);
const fehlt = fehlendeSpalten(idx);
if (fehlt.length) { console.error(`Pflichtspalten fehlen: ${fehlt.join(', ')} - Stopp.`); process.exit(1); }
const extra = kopf.filter(k => k && !SPALTEN.includes(k) && k !== SPALTE_AUFTRAG);
if (extra.length) console.log(`Weitere Spalten (bleiben unberührt): ${extra.join(', ')}`);

if (idx[SPALTE_AUFTRAG] !== undefined) { console.log(`${SPALTE_AUFTRAG} ist schon da (Spalte ${spalteBuchstabe(idx[SPALTE_AUFTRAG])}) - nichts zu tun.`); process.exit(0); }
const breite = Math.max(kopf.length, ...werte.map(r => (r ?? []).length));
const ziel = `'${TAB}'!${spalteBuchstabe(breite)}1`;
console.log(`${write ? 'Schreibe' : 'Würde schreiben'}: ${ziel} = ${SPALTE_AUFTRAG}`);
if (!write) { console.log('Trockenlauf - nichts geschrieben (--write zum Schreiben).'); process.exit(0); }
await sichereSpaltenRaster(sheets, spreadsheetId, TAB, breite + 1);
await sheets.spreadsheets.values.update({ spreadsheetId, range: ziel, valueInputOption: 'RAW', requestBody: { values: [[SPALTE_AUFTRAG]] } });
const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId, range: ziel });
if (zurueck.values?.[0]?.[0] !== SPALTE_AUFTRAG) { console.error('Rücklesen weicht ab.'); process.exit(1); }
console.log('Geschrieben und zurückgelesen ✓');
