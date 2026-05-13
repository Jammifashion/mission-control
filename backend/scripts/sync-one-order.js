// Sync eines einzelnen WC-Auftrags direkt in Partner_Verkäufe.
// Verwendung: NODE_TLS_REJECT_UNAUTHORIZED=0 node backend/scripts/sync-one-order.js <ORDER_ID>
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { berechnePartnerAnteil, parseKonfiguration } from '../utils/partner-kalkulation.js';

const SHEET_ID = process.env.BUSINESS_SHEET_ID;
const ORDER_ID = process.argv[2];
if (!ORDER_ID) { console.error('Verwendung: node sync-one-order.js <ORDER_ID>'); process.exit(1); }

function toFloat(val) {
  if (!val && val !== 0) return 0;
  const n = parseFloat(val.toString().replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
function toDE(date) {
  const d = new Date(date);
  return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${d.getUTCFullYear()}`;
}
async function readTab(sheets, tabName) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: `${tabName}!A1:Z`,
  });
  const [header, ...rows] = data.values ?? [];
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}

async function run() {
  if (!SHEET_ID) { console.error('BUSINESS_SHEET_ID fehlt.'); process.exit(1); }

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Sheets laden
  const [aTab, kTab, pTab, vTab] = await Promise.all([
    readTab(sheets, 'Partner_Artikel'),
    readTab(sheets, 'Kalkulation_Fixkosten'),
    readTab(sheets, 'Partner'),
    readTab(sheets, 'Partner_Verkäufe'),
  ]);

  // Partner_Artikel → Map productId → Einträge
  const ah = col => aTab.header.indexOf(col);
  const partnerArtikelMap = {};
  console.log(`\n━━ Partner_Artikel-Lookup aufgebaut ━━`);
  console.log(`Header: ${aTab.header.join(' | ')}`);
  for (const r of aTab.rows) {
    const partnerId    = r[ah('Partner-ID')] ?? '';
    const pid          = (r[ah('Produkt-ID')] ?? '').toString().trim();
    const lizenzProzent = toFloat(r[ah('Lizenz-%')]);
    const ekPreis       = toFloat(r[ah('EK-Preis-Netto')]);
    const druckkosten   = toFloat(r[ah('Druckkosten')]);
    const versandart    = ((r[ah('Versandart')] ?? 'P').toString().toUpperCase() === 'B') ? 'B' : 'P';
    const artikelname   = r[ah('Artikelname')] ?? '';
    if (!pid || !partnerId) { console.log(`  ⊘ Zeile übersprungen: pid="${pid}" partnerId="${partnerId}"`); continue; }
    if (!partnerArtikelMap[pid]) partnerArtikelMap[pid] = [];
    partnerArtikelMap[pid].push({ partnerId, lizenzProzent, ekPreis, druckkosten, versandart, artikelname });
    console.log(`  ✓ Produkt-ID ${pid}: Partner ${partnerId}, ${artikelname}, Lizenz ${lizenzProzent}%, EK ${ekPreis}€, Druck ${druckkosten}€`);
  }
  console.log(`→ ${Object.keys(partnerArtikelMap).length} unterschiedliche Produkt-IDs registriert\n`);

  // Partner → Porto-Modell
  const ph = col => pTab.header.indexOf(col);
  const partnerInfoMap = {};
  for (const r of pTab.rows) {
    const id = r[ph('Partner-ID')] ?? '';
    if (id) partnerInfoMap[id] = { portoModell: r[ph('Porto-Modell')] ?? 'geteilt-50-50' };
  }

  // Konfiguration
  const konfiguration = parseKonfiguration(kTab.rows, kTab.header);

  // Duplikat-Set aus vorhandenen Verkäufen
  const vh = col => vTab.header.indexOf(col);
  const varKey = v => (v === '' || v === null || v === undefined) ? '0' : String(v);
  const existingKeys = new Set(
    vTab.rows.map(r => `${r[vh('Order-ID')]??''}|${r[vh('Artikelnummer')]??''}|${varKey(r[vh('Variante')])}|${r[vh('Partner-ID')]??''}`)
  );

  // WC-Order direkt laden
  const wc = new WooCommerceRestApi.default({
    url: process.env.WC_URL, consumerKey: process.env.WC_KEY,
    consumerSecret: process.env.WC_SECRET, version: 'wc/v3', queryStringAuth: true,
  });
  const { data: order } = await wc.get(`orders/${ORDER_ID}`);
  console.log(`\nOrder ${order.id} · Status: ${order.status} · ${order.date_created}`);

  // Sync-Logik (identisch zu runVerkaeufeSync)
  const artikelName = item => item.name || item.sku || String(item.product_id);
  const orderDate   = toDE(new Date(order.date_created));
  const shippingNetto = toFloat(order.shipping_total);
  const orderNetto    = order.line_items.reduce((s, i) => s + toFloat(i.total), 0);

  console.log(`\n━━ WC-Order-Items vs. Partner_Artikel-Lookup ━━`);
  let orderVersandart = 'B';
  const matching = [];
  for (const item of order.line_items) {
    const pid = String(item.product_id || '');
    const entries = partnerArtikelMap[pid];
    console.log(`\nItem: Produkt-ID ${pid}`);
    console.log(`  Name: "${item.name}" (SKU: ${item.sku || '–'})`);
    console.log(`  Quantity: ${item.quantity}, Total netto: ${item.total}€`);
    if (!entries) {
      console.log(`  ⚠ NICHT GEFUNDEN in Partner_Artikel`);
      continue;
    }
    console.log(`  ✓ GEFUNDEN: ${entries.length} Eintrag(e)`);
    for (const e of entries) {
      console.log(`    - Partner ${e.partnerId}: ${e.artikelname || '(keine Beschreibung)'}, Lizenz ${e.lizenzProzent}%, EK ${e.ekPreis}€, Druck ${e.druckkosten}€, Versand ${e.versandart}`);
    }
    matching.push({ item, entries });
    if (entries.some(e => e.versandart === 'P')) orderVersandart = 'P';
  }
  console.log(`\n→ ${matching.length} passende Artikel gefunden\n`);

  if (!matching.length) {
    console.log('Keine passenden Partner-Artikel gefunden – nichts zu schreiben.');
    process.exit(0);
  }

  const toWrite = [];
  for (const { item, entries } of matching) {
    const itemNetto = toFloat(item.total);
    const anteil    = orderNetto > 0 ? (itemNetto / orderNetto) : 0;
    const portoEinnahmeAnteil = shippingNetto * anteil;
    const artKey    = artikelName(item);
    const variationId = String(item.variation_id || 0);

    for (const e of entries) {
      const key = `${order.id}|${artKey}|${variationId}|${e.partnerId}`;
      const isDuplicate = existingKeys.has(key);

      const calc = berechnePartnerAnteil({
        vkNetto: itemNetto, ekPreis: e.ekPreis, druckkosten: e.druckkosten,
        versandart: orderVersandart,
        portoModell: partnerInfoMap[e.partnerId]?.portoModell ?? 'geteilt-50-50',
        bestellungsAnteil: anteil, lizenzProzent: e.lizenzProzent,
        portoEinnahmeAnteil, konfiguration,
      });

      console.log(`\n  Artikel:  ${artKey}  (Variation ${variationId})`);
      console.log(`  Partner:  ${e.partnerId}  |  Lizenz: ${e.lizenzProzent}%`);
      console.log(`  vkNetto:  ${itemNetto.toFixed(2)} €  |  anteil: ${(anteil*100).toFixed(1)}%`);
      console.log(`  portoEinnahmeAnteil: ${portoEinnahmeAnteil.toFixed(4)} €`);
      console.log(`  gewinnNetto: ${calc.gewinnNetto} €  |  partnerAnteil (netto): ${calc.netto} €  (brutto: ${calc.brutto} €)`);
      console.log(`  Duplikat: ${isDuplicate ? '⚠ JA – wird übersprungen' : 'nein'}`);

      if (!isDuplicate) {
        existingKeys.add(key);
        // Berechnung Breakdown für Tooltip
        const lizenzAnteilVomGewinn = calc.gewinnNetto * (e.lizenzProzent || 0) / 100;

        toWrite.push([
          e.partnerId, orderDate, String(order.id),
          artKey, variationId, String(item.quantity),
          itemNetto.toFixed(2), calc.partnerAnteil, 'offen',
          String(item.product_id),  // Produkt-ID für späteren Lookup
          calc.gewinnNetto.toFixed(2),  // Gewinn netto
          lizenzAnteilVomGewinn.toFixed(2),  // Lizenz-Anteil vom Gewinn
          calc.portoSaldoPartner.toFixed(2),  // Porto-Saldo
          calc.brutto.toFixed(2),  // Partner-Anteil brutto
        ]);
      }
    }
  }

  if (!toWrite.length) {
    console.log('\nAlle Einträge bereits vorhanden – Sheet unverändert.');
    process.exit(0);
  }

  console.log(`\n→ Schreibe ${toWrite.length} Zeile(n) in Partner_Verkäufe …`);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Partner_Verkäufe!A:N',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: toWrite },
  });
  console.log('✓ Fertig.\n');
}

run().catch(e => { console.error(e); process.exit(1); });
