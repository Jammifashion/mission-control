// Wartungslauf (AUD1-Rest, NB2): Altstatus "Neu" in Partner_Interne_Bestellungen auf "offen" setzen.
// Bisher hat das Partnerportal das beim LESEN (/api/partner/intern, /saldo) getan - jetzt zaehlt "Neu" dort nur im
// Speicher wie "offen", und dieses Skript richtet das Sheet einmal von Hand.
//
//   node backend/scripts/wartung-interne-neu.js            Trockenlauf: zeigt Anzahl und Zeilen (nur Partner-ID + Zeile)
//   node backend/scripts/wartung-interne-neu.js --write    schreibt NUR die Status-Zellen, die beim Schreiben noch "Neu"
//                                                          sind (frisch gelesen), RAW, und liest zurueck
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { spalteBuchstabe } from '../lib/sheet-zeilen.js';

const TAB = 'Partner_Interne_Bestellungen';
const write = process.argv.includes('--write');

/** Zeilen mit Status "Neu": [{ zeile (Sheet-Zeile), partnerId }] - rein, fuer Test und Lauf. */
export function neuZeilen(werte) {
  const kopf = (werte[0] ?? []).map(x => String(x ?? '').trim());
  const iSt = kopf.indexOf('Status'), iP = kopf.indexOf('Partner-ID');
  if (iSt === -1) throw new Error(`Spalte Status fehlt in ${TAB}.`);
  return { iSt, zeilen: werte.slice(1).map((r, i) => ({ zeile: i + 2, partnerId: String(r[iP] ?? ''), status: String(r[iSt] ?? '').trim() }))
    .filter(z => z.status === 'Neu').map(({ zeile, partnerId }) => ({ zeile, partnerId })) };
}

async function run() {
  const spreadsheetId = process.env.BUSINESS_SHEET_ID;
  if (!spreadsheetId) { console.error('BUSINESS_SHEET_ID fehlt.'); process.exit(1); }
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const lies = async () => (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
  const { iSt, zeilen } = neuZeilen(await lies());
  console.log(`== ${TAB}: ${zeilen.length} Zeile(n) mit Status "Neu"${write ? ' · SCHREIBEN' : ' · Trockenlauf'}`);
  for (const z of zeilen) console.log(`  Zeile ${z.zeile} · ${z.partnerId}`);
  if (!write || !zeilen.length) return;
  // frisch gelesen: nur Zellen, die jetzt noch "Neu" sind
  const frisch = neuZeilen(await lies()).zeilen.filter(z => zeilen.some(y => y.zeile === z.zeile));
  const sp = spalteBuchstabe(iSt);
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW',
    data: frisch.map(z => ({ range: `'${TAB}'!${sp}${z.zeile}`, values: [['offen']] })) } });
  const rest = neuZeilen(await lies()).zeilen.filter(z => frisch.some(y => y.zeile === z.zeile));
  console.log(`-> ${frisch.length} auf "offen" gesetzt, zurückgelesen: ${rest.length ? `${rest.length} noch "Neu" (FEHLER)` : 'ok'}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run().catch(e => { console.error(`FEHLER: ${String(e?.message ?? 'unbekannt').slice(0, 300)}`); process.exit(1); });
