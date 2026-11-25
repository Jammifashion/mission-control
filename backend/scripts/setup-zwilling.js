// ZW1: Spalten fuer den HONK!-Zwilling hinten in den SSOT-Reitern anlegen (nur Kopfzellen) und HONK_Kategorie vorbelegen.
//
//   node backend/scripts/setup-zwilling.js          Trockenlauf: zeigt fehlende Spalten und die Vorbelegung
//   node backend/scripts/setup-zwilling.js --write  schreibt Kopfzellen + Vorbelegung (EIN values.batchUpdate RAW, zurueckgelesen)
//
// Spalten: Erfassungsmaske HONK_Produkt_ID, HONK_Status · Varianten HONK_Variation_ID · Struktur_Kategorien HONK_Kategorie ·
// Struktur_Lieferzeiten Term_ID_HONK (bleibt LEER - traegt der Inhaber nach Blick in HONK-Admin ein).
// Vorbelegung HONK_Kategorie (Inhaber 25.11.): nur JFN-Kategorien unter "HONK!", deren NAME es in HONK genau einmal gibt (Gross/Klein
// egal), nur in LEERE Zellen. Die Wurzel "HONK!" und Kategorien ohne Namensgleiche (z. B. HohoHonk!) bleiben leer.
// Liest beide Shops nur (Kategorien, Takt 2 s), keine IDs im Code. Ausgabe nur Kategorienummern und Namen.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { SPALTE_ERF_HONK_ID, SPALTE_ERF_HONK_STATUS, SPALTE_VAR_HONK_ID, SPALTE_KAT_HONK, SPALTE_LZ_HONK } from '../utils/zwilling.js';

const t = v => String(v ?? '').trim();
const klein = v => t(v).toLowerCase();
const spalte = i => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

const SPALTEN = [
  ['Erfassungsmaske', SPALTE_ERF_HONK_ID], ['Erfassungsmaske', SPALTE_ERF_HONK_STATUS],
  ['Varianten', SPALTE_VAR_HONK_ID], ['Struktur_Kategorien', SPALTE_KAT_HONK], ['Struktur_Lieferzeiten', SPALTE_LZ_HONK],
];

/**
 * Vorbelegung (reine Logik, Test zwilling.test.js).
 * @param {{id,name,parent}[]} jfn   alle JFN-Kategorien
 * @param {{id,name}[]} honk         alle HONK-Kategorien
 * @param {string} wurzel            Name der JFN-Wurzel ("HONK!")
 * @returns {{ jfnId: string, name: string, honkId: string, grund: string }[]}
 */
export function kategorieVorschlaege(jfn, honk, wurzel = 'HONK!') {
  const root = (jfn ?? []).filter(k => klein(k.name) === klein(wurzel)).map(k => Number(k.id));
  if (root.length !== 1) return [];
  const baum = new Set(root);
  for (let neu = true; neu;) {
    neu = false;
    for (const k of jfn) if (baum.has(Number(k.parent)) && !baum.has(Number(k.id))) { baum.add(Number(k.id)); neu = true; }
  }
  return jfn.filter(k => baum.has(Number(k.id))).map(k => {
    if (Number(k.id) === root[0]) return { jfnId: String(k.id), name: t(k.name), honkId: '', grund: 'Wurzel – trägt der Inhaber ein' };
    const treffer = (honk ?? []).filter(h => klein(h.name) === klein(k.name));
    if (treffer.length === 1) return { jfnId: String(k.id), name: t(k.name), honkId: String(treffer[0].id), grund: 'Name gleich' };
    return { jfnId: String(k.id), name: t(k.name), honkId: '', grund: treffer.length ? 'Name mehrdeutig in HONK' : 'kein gleicher Name in HONK' };
  });
}

async function alleKategorien(wc) {
  const liste = [];
  for (let page = 1; page <= 20; page++) {
    const { data, headers } = await wc.get('products/categories', { per_page: 100, page, _fields: 'id,name,parent' });
    liste.push(...data);
    await new Promise(r => setTimeout(r, 2000));
    if (page >= Number(headers['x-wp-totalpages'] ?? 1)) break;
  }
  return liste;
}

async function main() {
  const WRITE = process.argv.includes('--write');
  const SHEET = process.env.GOOGLE_SHEET_ID;
  if (!SHEET) throw new Error('GOOGLE_SHEET_ID fehlt.');
  const { google } = await import('googleapis');
  const { getGoogleAuth } = await import('../lib/googleAuth.js');
  const { getWcClient } = await import('../lib/shopConfig.js');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const tabs = [...new Set(SPALTEN.map(([tab]) => tab))];
  const { data } = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET, ranges: tabs.map(x => `'${x}'!1:1`) });
  const kopf = Object.fromEntries(tabs.map((x, i) => [x, (data.valueRanges[i].values?.[0] ?? []).map(t)]));

  const zellen = [];
  const neuIdx = {};
  for (const [tab, name] of SPALTEN) {
    let i = kopf[tab].indexOf(name);
    if (i >= 0) { console.log(`✓ ${tab}.${name} gibt es schon (Spalte ${spalte(i)}).`); neuIdx[`${tab}.${name}`] = i; continue; }
    i = kopf[tab].length;
    kopf[tab].push(name);
    neuIdx[`${tab}.${name}`] = i;
    zellen.push({ range: `'${tab}'!${spalte(i)}1`, wert: name });
    console.log(`+ ${tab}: Spalte ${spalte(i)} = ${name}`);
  }

  // Vorbelegung HONK_Kategorie
  const [jfnKat, honkKat] = [await alleKategorien(getWcClient('jfn')), await alleKategorien(getWcClient('honk'))];
  const vorschlaege = kategorieVorschlaege(jfnKat, honkKat);
  const { data: sk } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET, range: "'Struktur_Kategorien'!A1:ZZ" });
  const [kk = [], ...kz] = sk.values ?? [];
  const iNr = kk.map(t).indexOf('Kategorienummer');
  if (iNr < 0) throw new Error('Struktur_Kategorien: Spalte Kategorienummer fehlt.');
  const iHonk = neuIdx[`Struktur_Kategorien.${SPALTE_KAT_HONK}`];
  console.log(`HONK!-Kategorien in JFN: ${vorschlaege.length}`);
  for (const v of vorschlaege) {
    const zi = kz.findIndex(r => t(r[iNr]) === v.jfnId);
    const alt = zi >= 0 ? t(kz[zi][iHonk]) : '';
    const schreiben = v.honkId && zi >= 0 && !alt;
    console.log(`  ${schreiben ? '+' : ' '} ${v.jfnId.padEnd(4)} ${v.name} -> ${v.honkId || '–'} (${zi < 0 ? 'keine Zeile in Struktur_Kategorien' : alt ? `steht schon: ${alt}` : v.grund})`);
    if (schreiben) zellen.push({ range: `'Struktur_Kategorien'!${spalte(iHonk)}${zi + 2}`, wert: v.honkId });
  }

  if (!zellen.length) { console.log('Nichts zu schreiben.'); return; }
  if (!WRITE) { console.log(`Trockenlauf – nichts geschrieben (${zellen.length} Zelle(n) wären es). Mit --write.`); return; }
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET, requestBody: { valueInputOption: 'RAW',
    data: zellen.map(z => ({ range: z.range, values: [[z.wert]] })) } });
  const { data: nach } = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET, ranges: zellen.map(z => z.range) });
  const falsch = nach.valueRanges.filter((r, i) => t(r.values?.[0]?.[0]) !== t(zellen[i].wert));
  console.log(falsch.length ? `✗ ${falsch.length} Zelle(n) anders zurückgelesen.` : `✓ ${zellen.length} Zelle(n) geschrieben und zurückgelesen.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('✗', e.message); process.exit(1); });
}
