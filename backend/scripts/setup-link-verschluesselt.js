// LK1: Spalte `Token_Verschluesselt` hinten in `Bestellseiten` (SSOT) sowie `Partner` und `FP_Partner` (Business-Sheet) anlegen.
//
//   node backend/scripts/setup-link-verschluesselt.js           Trockenlauf (Standard): zeigt je Reiter, ob/wo die Spalte kaeme
//   node backend/scripts/setup-link-verschluesselt.js --write   legt nur die Kopfzelle an (Raster bei Bedarf breiter), liest zurueck
//
// Schreibt nur die Kopfzelle, nie Werte (die kommen erst mit "neuer Link" bzw. "Link neu erzeugen"). Ausgabe nur Reiter,
// Spaltennummern und Anzahlen - nie Tokens, Hashes oder verschluesselte Werte. Wiederholbar: vorhandene Spalte = nichts.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { SPALTE_VERSCHLUESSELT } from '../utils/link-schluessel.js';
import { TAB_ZUGAENGE } from '../utils/bestellseite.js';

const WRITE = process.argv.includes('--write');
export const ZIELE = [
  { env: 'GOOGLE_SHEET_ID', tab: TAB_ZUGAENGE, nachSpalte: 'Token_Hash' },
  { env: 'BUSINESS_SHEET_ID', tab: 'Partner', nachSpalte: 'Token_Hash' },
  { env: 'BUSINESS_SHEET_ID', tab: 'FP_Partner', nachSpalte: 'Token_Hash' },
];

async function main() {
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const meta = new Map();
  let zuTun = 0;
  for (const z of ZIELE) {
    const id = process.env[z.env];
    if (!id) { console.log(`✗ ${z.env} fehlt - ${z.tab} uebersprungen.`); process.exitCode = 1; continue; }
    if (!meta.has(id)) meta.set(id, (await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(title,sheetId,gridProperties)' })).data);
    const info = meta.get(id).sheets.find(x => x.properties.title === z.tab)?.properties;
    if (!info) { console.log(`✗ Reiter "${z.tab}" fehlt.`); process.exitCode = 1; continue; }
    const { data: k } = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${z.tab}'!1:1` });
    const kopf = (k.values?.[0] ?? []).map(x => String(x).trim());
    const { data: alle } = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${z.tab}'!A2:A` });
    const zeilen = (alle.values ?? []).filter(r => String(r[0] ?? '').trim()).length;
    if (kopf.includes(SPALTE_VERSCHLUESSELT)) { console.log(`✓ "${z.tab}": ${SPALTE_VERSCHLUESSELT} schon da (Spalte ${kopf.indexOf(SPALTE_VERSCHLUESSELT) + 1}), ${zeilen} Zeile(n).`); continue; }
    if (!kopf.includes(z.nachSpalte)) { console.log(`✗ "${z.tab}": Spalte ${z.nachSpalte} fehlt - erst das KS1-/PPS1-Setup.`); process.exitCode = 1; continue; }
    const i = kopf.length;
    const raster = info.gridProperties?.columnCount ?? 0;
    console.log(`Ergaenzen: "${z.tab}" Spalte ${i + 1} (${colLetter(i)}) = ${SPALTE_VERSCHLUESSELT} · ${zeilen} Zeile(n), alle bleiben ohne Wert`
      + ` (Altbestand: kopierbar erst nach neuem Link) · Raster ${raster} Spalten${i + 1 > raster ? ', wird um 1 breiter' : ''}`);
    zuTun++;
    if (!WRITE) continue;
    if (i + 1 > raster) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [
        { appendDimension: { sheetId: info.sheetId, dimension: 'COLUMNS', length: i + 1 - raster } },
      ] } });
    }
    const range = `'${z.tab}'!${colLetter(i)}1`;
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range, valueInputOption: 'RAW', requestBody: { values: [[SPALTE_VERSCHLUESSELT]] } });
    const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId: id, range });
    const ok = String(zurueck.values?.[0]?.[0] ?? '') === SPALTE_VERSCHLUESSELT;
    console.log(ok ? `✓ "${z.tab}": Kopfzelle geschrieben und zurueckgelesen.` : `✗ "${z.tab}": Kopfzelle weicht ab - bitte pruefen.`);
    if (!ok) process.exitCode = 1;
  }
  if (!WRITE) console.log(zuTun ? `Trockenlauf - nichts geschrieben (${zuTun} Kopfzelle(n) offen). Mit --write anlegen.` : 'Nichts zu tun.');
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
