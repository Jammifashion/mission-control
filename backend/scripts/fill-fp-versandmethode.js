// Versandmethode in FP_Verkäufe (Spalte W) für Bestandszeilen nachtragen (VP1).
//
// Verwendung:
//   node backend/scripts/fill-fp-versandmethode.js [--partner FP-001] [--ab 2026-04-01] [--write]
//
// Standard ist ein TROCKENLAUF: liest FP_Verkäufe, holt die Bestellungen mit
// leerer Versandmethode aus dem Shop (nur GET, include je 100, 1 Abruf / 2 s)
// und zählt je Versandmethode. Ausgabe nur Zähler, keine Kundendaten, keine Beträge.
// Erst --write schreibt - NUR leere Zellen in W, nach erneutem Lesen (RAW).
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient } from '../lib/shopConfig.js';
import { planeVersandNachtrag, ladeVersandmethoden, TAB_FP_VERKAEUFE, SPALTE_W } from '../lib/fpVersandmethode.js';
import { VERSANDMETHODE, versandArt } from '../utils/festpreis-verpackung.js';

const args  = process.argv.slice(2);
const WRITE = args.includes('--write');
const wert  = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const PARTNER = wert('--partner');
const AB      = wert('--ab');

let letzte = 0;
async function drossel() {
  const warte = letzte + 2000 - Date.now();
  if (warte > 0) await new Promise(r => setTimeout(r, warte));
  letzte = Date.now();
}

async function lese(sheets, id) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${TAB_FP_VERKAEUFE}!A1:Z` });
  const [header = [], ...rows] = data.values ?? [];
  rows.forEach((r, i) => { r._sheetRow = i + 2; });
  return { header, rows: rows.filter(r => r.some(c => c)) };
}

async function run() {
  const id = process.env.BUSINESS_SHEET_ID;
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { header, rows } = await lese(sheets, id);
  const iVm = header.indexOf(VERSANDMETHODE);
  if (iVm !== -1 && iVm !== SPALTE_W) throw new Error(`${VERSANDMETHODE} steht nicht in Spalte W.`);
  if (iVm === -1 && header.length !== SPALTE_W) throw new Error(`FP_Verkäufe hat ${header.length} Spalten statt ${SPALTE_W}.`);

  const { zeilen, ids } = planeVersandNachtrag(header, rows, { partnerId: PARTNER, ab: AB });
  console.log(`Zeilen ohne Versandmethode: ${zeilen.length}, Bestellungen: ${ids.length}`);
  if (!ids.length) return;

  const { methode, fehlend } = await ladeVersandmethoden(getWcClient('jfn'), ids, drossel);
  const zaehler = {};
  for (const m of methode.values()) { const k = `${versandArt(m)} (${m})`; zaehler[k] = (zaehler[k] || 0) + 1; }
  console.log('Bestellungen je Versandmethode:', JSON.stringify(zaehler));
  if (fehlend.length) console.log(`Nicht im Shop gefunden: ${fehlend.length} (${fehlend.join(', ')})`);

  if (!WRITE) { console.log('Trockenlauf – nichts geschrieben. Schreiben mit --write.'); return; }

  // Neu lesen, nur leere Zellen der geplanten Zeilen schreiben
  const neu = await lese(sheets, id);
  const iOrd = neu.header.indexOf('WC-Bestellnummer');
  const geplant = new Set(zeilen.map(r => r._sheetRow));
  const data = [];
  if (neu.header.indexOf(VERSANDMETHODE) === -1) data.push({ range: `${TAB_FP_VERKAEUFE}!W1`, values: [[VERSANDMETHODE]] });
  for (const r of neu.rows) {
    if (!geplant.has(r._sheetRow) || String(r[SPALTE_W] ?? '').trim() !== '') continue;
    const m = methode.get(String(r[iOrd] ?? ''));
    if (m) data.push({ range: `${TAB_FP_VERKAEUFE}!W${r._sheetRow}`, values: [[m]] });
  }
  if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'RAW', data } });
  console.log(`Geschrieben: ${data.length} Zelle(n).`);
}

run().catch(err => { console.error('STOPP:', err.message ?? err); process.exit(1); });
