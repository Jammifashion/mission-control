// Sync eines einzelnen WC-Auftrags direkt in Partner_Verkäufe.
//
// Verwendung:
//   node backend/scripts/sync-one-order.js <ORDER_ID> [--partner P-001] [--write]
//
// Standard ist ein TROCKENLAUF: zeigt, welche Zeilen entstuenden, schreibt nichts.
// Erst --write haengt sie an. --partner beschraenkt auf einen Partner (Befund
// PA3: ohne Filter schrieb das Skript fuer alle Partner der Bestellung).
// Rechnung wie der Sync (verkaufsBetraege); fehlt EK oder Druck (leer), wird die
// Zeile wie im Sync "gesperrt" geschrieben (PA2 Teil B). Ausgabe ohne Betraege.
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { parseKonfiguration, baueLizenzSaetze, baueVertragsbeginne, verkaufsBetraege } from '../utils/partner-kalkulation.js';
import { vorVertragsbeginn, toFloat, toDE, leerWert, sperrGrund, STATUS_GESPERRT, SPALTE_SPERRE } from '../utils/sync-logic.js';
import { colLetter, sichereSpalte } from '../utils/sheet-spalten.js';

const SHEET_ID = process.env.BUSINESS_SHEET_ID;
const args     = process.argv.slice(2);
const ORDER_ID = args.find(a => /^\d+$/.test(a));
const WRITE    = args.includes('--write');
const pi       = args.indexOf('--partner');
const PARTNER  = pi >= 0 ? args[pi + 1] : null;
if (!ORDER_ID) { console.error('Verwendung: node sync-one-order.js <ORDER_ID> [--partner P-001] [--write]'); process.exit(1); }

async function readTab(sheets, tabName) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tabName}!A1:Z` });
  const [header, ...rows] = data.values ?? [];
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}

async function run() {
  if (!SHEET_ID) { console.error('BUSINESS_SHEET_ID fehlt.'); process.exit(1); }
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });

  const [aTab, kTab, pTab, vTab] = await Promise.all([
    readTab(sheets, 'Partner_Artikel'), readTab(sheets, 'Kalkulation_Fixkosten'),
    readTab(sheets, 'Partner'), readTab(sheets, 'Partner_Verkäufe'),
  ]);

  // Partner_Artikel -> Map Produkt-ID -> Eintraege (Lizenz-% kommt aus dem Partner-Reiter, B16).
  const ah = col => aTab.header.indexOf(col);
  const map = {};
  for (const r of aTab.rows) {
    const partnerId = r[ah('Partner-ID')] ?? '';
    const pid = (r[ah('Produkt-ID')] ?? '').toString().trim();
    if (!pid || !partnerId) continue;
    (map[pid] ??= []).push({
      partnerId,
      ekPreis: toFloat(r[ah('EK-Preis-Netto')]), druckkosten: toFloat(r[ah('Druckkosten')]),
      ekLeer: leerWert(r[ah('EK-Preis-Netto')]), druckLeer: leerWert(r[ah('Druckkosten')]),
      versandart: ((r[ah('Versandart')] ?? 'P').toString().toUpperCase() === 'B') ? 'B' : 'P',
    });
  }
  const ph = col => pTab.header.indexOf(col);
  const lizenzSatz = baueLizenzSaetze(pTab.header, pTab.rows);
  const vertragsbeginn = baueVertragsbeginne(pTab.header, pTab.rows);
  const porto = {};
  for (const r of pTab.rows) { const id = r[ph('Partner-ID')] ?? ''; if (id) porto[id] = r[ph('Porto-Modell')] ?? 'geteilt-50-50'; }
  const konfiguration = parseKonfiguration(kTab.rows, kTab.header);

  const vh = col => vTab.header.indexOf(col);
  const varKey = v => (v === '' || v === null || v === undefined) ? '0' : String(v);
  const existing = new Set(vTab.rows.map(r => `${r[vh('Order-ID')] ?? ''}|${r[vh('Artikelnummer')] ?? ''}|${varKey(r[vh('Variante')])}|${r[vh('Partner-ID')] ?? ''}`));

  const wc = new WooCommerceRestApi.default({
    url: process.env.WC_URL, consumerKey: process.env.WC_KEY,
    consumerSecret: process.env.WC_SECRET, version: 'wc/v3', queryStringAuth: false,
  });
  const { data: order } = await wc.get(`orders/${ORDER_ID}`);
  console.log(`Order ${order.id} · ${order.status} · ${order.date_created} · ${order.line_items.length} Position(en)`
    + `${PARTNER ? ` · nur ${PARTNER}` : ''} · ${WRITE ? 'SCHREIBEN' : 'Trockenlauf'}`);

  // Versandart wie im Sync: ueber ALLE Partner der Bestellung (nach Vertrag-ab).
  const artikelName = item => item.name || item.sku || String(item.product_id);
  const orderDate = toDE(new Date(order.date_created));
  let versandart = 'B';
  const matching = [];
  for (const item of order.line_items) {
    const alle = map[String(item.product_id || '')];
    if (!alle) continue;
    const entries = alle.filter(e => !vorVertragsbeginn(order.date_created, vertragsbeginn(e.partnerId)));
    if (!entries.length) continue;
    matching.push({ item, entries });
    if (entries.some(e => e.versandart === 'P')) versandart = 'P';
  }

  const toWrite = [];
  for (const { item, entries } of matching) {
    for (const e of entries) {
      if (PARTNER && e.partnerId !== PARTNER) continue;
      const key = `${order.id}|${artikelName(item)}|${String(item.variation_id || 0)}|${e.partnerId}`;
      const dup = existing.has(key);
      const grund = sperrGrund(e);
      console.log(`  Produkt ${item.product_id} · Variation ${item.variation_id || 0} · ${e.partnerId}`
        + ` -> ${dup ? 'schon vorhanden, uebersprungen' : grund ? `gesperrt (${grund})` : 'neue Zeile'}`);
      if (dup) continue;
      existing.add(key);
      if (grund) {
        const row = [e.partnerId, orderDate, order.id, artikelName(item), item.variation_id || 0, item.quantity,
          toFloat(item.total), '', STATUS_GESPERRT, item.product_id, '', '', '', ''];
        row._sperre = grund;
        toWrite.push(row);
        continue;
      }
      const b = verkaufsBetraege({ order, item, eintrag: e, versandart, portoModell: porto[e.partnerId] ?? 'geteilt-50-50',
        lizenzProzent: lizenzSatz(e.partnerId), konfiguration });
      toWrite.push([e.partnerId, orderDate, order.id, artikelName(item), item.variation_id || 0, item.quantity,
        b.vkNetto, b.lizenz, 'offen', item.product_id, b.gewinnNetto, b.lizenzAnteil, b.portoSaldo, b.brutto]);
    }
  }

  console.log(`-> ${toWrite.length} Zeile(n)${WRITE ? '' : ' wuerden entstehen (Trockenlauf, nichts geschrieben)'}.`);
  if (!WRITE || !toWrite.length) return;

  const header = [...vTab.header];
  if (toWrite.some(r => r._sperre)) {
    const i = await sichereSpalte(sheets, SHEET_ID, 'Partner_Verkäufe', header, SPALTE_SPERRE);
    for (const r of toWrite.filter(x => x._sperre)) { while (r.length <= i) r.push(''); r[i] = r._sperre; }
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `Partner_Verkäufe!A:${colLetter(Math.max(header.length - 1, 14))}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: toWrite },
  });
  console.log('Geschrieben.');
}

run().catch(e => { console.error(e.message ?? e); process.exit(1); });
