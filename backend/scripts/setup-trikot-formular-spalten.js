// TR3: haengt in "Trikot_Artikel" (Business-Sheet) die Spalten "Formular_Artikel", "Formular_Material" und
// "Formular_Kragen" hinten an und befuellt sie fuer die Crocodiles-Trikots (Inhaber 30.10.): Heimtrikot
// (19365) "Trikot schwarz" / "Heavy", Auswaertstrikot (20064) "Trikot weiss" / "Heavy", Kragen leer.
// Danach kommen die Formularwerte nur noch aus dem Sheet (lib/trikotFormular.js), nie aus dem Code.
//
//   node backend/scripts/setup-trikot-formular-spalten.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-trikot-formular-spalten.js --write   schreibt Kopfzellen + Werte
//
// Geschrieben werden nur leere Zellen: die Kopfzellen direkt hinter der letzten Kopfspalte (Spalten in allen
// Zeilen leer) und je Produkt-ID die Zellen Formular_Artikel/Formular_Material. Steht schon etwas anderes
// darin -> Stopp, nichts geschrieben. RAW, ein batchUpdate, kein append, danach zurueckgelesen.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { findHeader, requireHeader } from '../utils/sheet-headers.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { TAB_ARTIKEL, ARTIKEL_FORMULAR_SPALTEN } from '../utils/trikot-formular.js';

const SPREADSHEET_ID = process.env.BUSINESS_SHEET_ID;
const WRITE = process.argv.includes('--write');
const WERTE = {   // Produkt-ID -> [Formular_Artikel, Formular_Material]; Formular_Kragen bleibt leer
  19365: ['Trikot schwarz', 'Heavy'],
  20064: ['Trikot weiss', 'Heavy'],
};
const t = v => String(v ?? '').trim();

async function main() {
  if (!SPREADSHEET_ID) throw new Error('BUSINESS_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const lies = async () => (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB_ARTIKEL}'` })).data.values ?? [];
  const werte = await lies();
  const kopf = werte[0] ?? [];
  console.log(`Reiter "${TAB_ARTIKEL}": ${kopf.length} Kopfspalten, ${werte.length - 1} Zeilen. Kopf: ${kopf.join(' | ')}`);
  const iId = requireHeader(kopf, 'Produkt-ID', TAB_ARTIKEL);

  const daten = [];
  const idx = {};
  let naechste = kopf.length;
  for (const n of ARTIKEL_FORMULAR_SPALTEN) {
    const i = findHeader(kopf, n);
    if (i >= 0) { idx[n] = i; continue; }
    if (werte.some(r => t(r[naechste]))) throw new Error(`Spalte ${colLetter(naechste)} ist nicht leer - nichts geschrieben.`);
    idx[n] = naechste;
    daten.push({ range: `'${TAB_ARTIKEL}'!${colLetter(naechste)}1`, values: [[n]] });
    naechste++;
  }
  for (const [pid, [artikel, material]] of Object.entries(WERTE)) {
    const zeilen = werte.map((r, i) => [i + 1, r]).filter(([z, r]) => z > 1 && t(r[iId]) === pid);
    if (zeilen.length !== 1) throw new Error(`Produkt-ID ${pid}: ${zeilen.length} Zeilen statt 1 - nichts geschrieben.`);
    const [z, r] = zeilen[0];
    for (const [n, wert] of [[ARTIKEL_FORMULAR_SPALTEN[0], artikel], [ARTIKEL_FORMULAR_SPALTEN[1], material]]) {
      const alt = t(r[idx[n]]);
      if (alt === wert) { console.log(`${n} ${pid}: steht schon`); continue; }
      if (alt) throw new Error(`${n} ${pid}: steht "${alt}" - nichts geschrieben.`);
      daten.push({ range: `'${TAB_ARTIKEL}'!${colLetter(idx[n])}${z}`, values: [[wert]] });
    }
  }
  for (const d of daten) console.log(`${WRITE ? 'schreibe' : 'wuerde schreiben'} ${d.range.split('!')[1]} = ${JSON.stringify(d.values[0][0])}`);
  if (!daten.length) { console.log('Nichts zu tun.'); return; }
  if (!WRITE) { console.log('Trockenlauf - nichts geschrieben. Mit --write ausfuehren.'); return; }
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { valueInputOption: 'RAW', data: daten } });
  const nach = await lies();
  let fehler = 0;
  for (const d of daten) {
    const ref = d.range.split('!')[1];
    const sp = ref.charCodeAt(0) - 65, z = Number(ref.slice(1));
    if (t(nach[z - 1]?.[sp]) !== d.values[0][0]) { fehler++; console.log(`ABWEICHUNG ${ref}`); }
  }
  const geplant = new Set(daten.map(d => d.range.split('!')[1]));
  for (let r = 0; r < Math.max(werte.length, nach.length); r++) for (let c = 0; c < 26; c++) {
    const ref = `${colLetter(c)}${r + 1}`;
    if (!geplant.has(ref) && t(werte[r]?.[c]) !== t(nach[r]?.[c])) { fehler++; console.log(`FREMD veraendert ${ref}`); }
  }
  console.log(fehler ? `Zurueckgelesen: ${fehler} Abweichungen` : `Zurueckgelesen: ${daten.length} Zellen wie geplant, keine andere Zelle veraendert.`);
  if (fehler) process.exitCode = 1;
}

main().catch(e => { console.error('Fehler:', e.message); process.exitCode = 1; });
