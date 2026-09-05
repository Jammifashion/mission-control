// Lese-Skript: Titelpflege Ugly Christmas Sweater
//
// Holt alle Produkte der WC-Kategorie "Ugly Christmas Sweater" (Shop jfn),
// verknuepft sie ueber die WC-Produkt-ID mit der SSOT-Erfassungsmaske und
// schreibt eine CSV als Vorlage fuer die manuelle Titelaenderung.
//
// NUR LESEN. Keine PUT/POST/DELETE-Aufrufe gegen WooCommerce oder Sheets.
//
//   node backend/scripts/ugly-sweater-titel.js
//   node backend/scripts/ugly-sweater-titel.js --sku-fallback
//
// Ohne Flag ist die SSOT-Erfassungsmaske die einzige Quelle fuer die
// Artikelnummer; ohne Treffer bleibt der Artikel UNBEKANNT. Mit --sku-fallback
// wird ersatzweise das Praefix der WC-SKU vor dem ersten "-" oder "_" benutzt
// (z.B. "JH030F_Woman-Christmas-Pinguin" -> "JH030F").
//
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient } from '../lib/shopConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SKU_FALLBACK = process.argv.includes('--sku-fallback');

const KATEGORIE = 'Ugly Christmas Sweater';
const TAB_ERF   = 'Erfassungsmaske';
const OUT_DIR   = resolve(__dirname, 'out');
const OUT_FILE  = resolve(OUT_DIR, 'ugly-sweater-titel.csv');

// U+2013 Halbgeviertstrich, kein Bindestrich
const DASH = '\u2013';
// Semikolon: deutsches Excel trennt CSV standardmaessig so
const SEP  = ';';

function colLetter(i) {
  return i < 26
    ? String.fromCharCode(65 + i)
    : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

function csvCell(v) {
  const s = String(v ?? '');
  return /["\r\n;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── WooCommerce: Kategorie-ID ermitteln ──────────────────────────────────────
async function findKategorieId(wc) {
  const { data } = await wc.get('products/categories', { search: KATEGORIE, per_page: 100 });
  const treffer = (data ?? []).filter(c => c.name.trim().toLowerCase() === KATEGORIE.toLowerCase());

  if (!treffer.length) {
    const namen = (data ?? []).map(c => `${c.name} (id ${c.id})`).join(', ') || 'keine';
    throw new Error(`Kategorie "${KATEGORIE}" nicht gefunden. Suchtreffer: ${namen}`);
  }
  if (treffer.length > 1) {
    console.warn(`! Mehrere Kategorien heissen "${KATEGORIE}": ${treffer.map(c => c.id).join(', ')} – nehme die erste.`);
  }
  return treffer[0];
}

// ── WooCommerce: alle Produkte der Kategorie (paginiert) ─────────────────────
async function ladeProdukte(wc, categoryId) {
  const alle = [];
  for (let page = 1; page <= 20; page++) {
    const { data } = await wc.get('products', {
      category: categoryId,
      per_page: 100,
      page,
      status:  'any',
      orderby: 'id',
      order:   'asc',
    });
    if (!data?.length) break;
    alle.push(...data);
    if (data.length < 100) break;
  }
  return alle;
}

// ── SSOT: Erfassungsmaske lesen, Map WC-Produkt-ID -> Artikelnummer ─────────
async function ladeSsotMap() {
  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range:         `${TAB_ERF}!A1:BZ2000`,
  });

  const rows    = data.values ?? [];
  const headers = rows[0] ?? [];

  // Spalten ueber die Header-Namen aufloesen, nicht ueber feste Buchstaben:
  // im Sheet steht die Produkt-ID in D und die L-Shop-Artikelnummer in H.
  const idxProduktId = headers.findIndex(h => /^produkt.?id$/i.test(String(h).trim()));
  const idxArtNr     = headers.findIndex(h => /^l.?shop.?artikelnummer$/i.test(String(h).trim()));

  if (idxProduktId < 0) throw new Error(`Spalte "Produkt-ID" nicht in ${TAB_ERF} gefunden.`);
  if (idxArtNr     < 0) throw new Error(`Spalte "L-Shop-Artikelnummer" nicht in ${TAB_ERF} gefunden.`);

  console.log(`SSOT-Spalten: Produkt-ID = ${colLetter(idxProduktId)}, L-Shop-Artikelnummer = ${colLetter(idxArtNr)}`);

  const map = new Map();
  for (const row of rows.slice(1)) {
    const wcId = String(row[idxProduktId] ?? '').trim();
    if (!wcId) continue;
    // Erster Treffer gewinnt; Dubletten nur melden, nicht aufloesen.
    if (map.has(wcId)) {
      console.warn(`! SSOT: WC-ID ${wcId} kommt mehrfach vor – nehme den ersten Treffer.`);
      continue;
    }
    map.set(wcId, String(row[idxArtNr] ?? '').trim());
  }
  return map;
}

// Artikelnummer-Praefix aus der SKU: alles vor dem ersten "-" oder "_"
function artNrAusSku(sku) {
  const m = String(sku ?? '').trim().match(/^([A-Za-z0-9]+)/);
  return m ? m[1] : '';
}

function geschlechtAus(artikelnummer) {
  if (!artikelnummer) return 'UNBEKANNT';
  return /f$/i.test(artikelnummer.trim()) ? 'Damen' : 'Herren';
}

async function main() {
  if (!process.env.GOOGLE_SHEET_ID) {
    console.error('Fehler: GOOGLE_SHEET_ID fehlt in .env');
    process.exit(1);
  }

  const wc  = getWcClient('jfn');
  const kat = await findKategorieId(wc);
  console.log(`Kategorie "${kat.name}" (id ${kat.id}, ${kat.count} Produkte laut WC)`);

  const [produkte, ssot] = await Promise.all([ladeProdukte(wc, kat.id), ladeSsotMap()]);
  console.log(`WooCommerce: ${produkte.length} Produkte geladen`);
  console.log(`SSOT: ${ssot.size} Zeilen mit Produkt-ID\n`);

  const zeilen    = [];
  const unbekannt = [];
  const ausSku    = [];

  for (const p of produkte) {
    const wcId     = String(p.id);
    const ssotArtNr = ssot.get(wcId) ?? '';

    let artNr  = ssotArtNr;
    let quelle = ssotArtNr ? 'SSOT' : '';
    if (!artNr && SKU_FALLBACK) {
      artNr = artNrAusSku(p.sku);
      if (artNr) quelle = 'SKU';
    }
    const gesch = geschlechtAus(artNr);

    const titelAlt = p.name ?? '';
    const vorschlag = gesch === 'UNBEKANNT'
      ? ''
      : `${titelAlt} ${DASH} Ugly Christmas Sweater ${gesch}`;

    zeilen.push({
      wc_id:                 wcId,
      artikelnummer:         artNr,
      geschlecht:            gesch,
      titel_alt:             titelAlt,
      slug:                  p.slug ?? '',
      titel_neu_vorschlag:   vorschlag,
    });

    if (gesch === 'UNBEKANNT') {
      unbekannt.push({ wcId, titelAlt, grund: ssot.has(wcId) ? 'Artikelnummer leer' : 'keine SSOT-Zeile' });
    } else if (quelle === 'SKU') {
      ausSku.push({ wcId, titelAlt, artNr, sku: p.sku ?? '' });
    }
  }

  // ── CSV schreiben ──────────────────────────────────────────────────────────
  const header = ['wc_id', 'artikelnummer', 'geschlecht', 'titel_alt', 'slug', 'titel_neu_vorschlag'];
  const csv = [
    header.join(SEP),
    ...zeilen.map(z => header.map(h => csvCell(z[h])).join(SEP)),
  ].join('\r\n') + '\r\n';

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, '\uFEFF' + csv, 'utf8');   // BOM fuer Excel
  console.log(`CSV geschrieben: ${OUT_FILE}\n`);

  // ── Zusammenfassung ────────────────────────────────────────────────────────
  const damen  = zeilen.filter(z => z.geschlecht === 'Damen').length;
  const herren = zeilen.filter(z => z.geschlecht === 'Herren').length;

  if (ausSku.length) {
    console.log(`── ${ausSku.length} Artikel mit Artikelnummer aus der SKU (nicht aus dem SSOT) ──`);
    ausSku.forEach(a => console.log(`  ${a.wcId}  ${a.artNr}  <- ${a.sku}`));
    console.log('');
  }

  if (unbekannt.length) {
    console.log(`━━ ${unbekannt.length} Artikel ohne Zuordnung ━━`);
    unbekannt.forEach(u => console.log(`  ${u.wcId}  ${u.titelAlt}  (${u.grund})`));
    console.log('');
  }

  console.log('━━ Zusammenfassung ━━');
  console.log(`  gesamt:    ${zeilen.length}`);
  console.log(`  Damen:     ${damen}`);
  console.log(`  Herren:    ${herren}`);
  console.log(`  unbekannt: ${unbekannt.length}`);
  if (!SKU_FALLBACK && unbekannt.length) {
    console.log('');
    console.log('Tipp: --sku-fallback leitet die Artikelnummer ersatzweise aus der WC-SKU ab.');
  }
}

main().catch(e => { console.error(e.response?.data ?? e); process.exit(1); });
