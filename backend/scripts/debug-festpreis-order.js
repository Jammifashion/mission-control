// Zeigt den Porto-/Auszahlungs-Rechenweg einer Festpreis-Order.
// Aufruf:  NODE_TLS_REJECT_UNAUTHORIZED=0 node backend/scripts/debug-festpreis-order.js <ORDER-ID> [jfn|honk]
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient } from '../lib/shopConfig.js';
import { parseKonfiguration } from '../utils/partner-kalkulation.js';

const SHEET_ID = process.env.BUSINESS_SHEET_ID;
const ORDER_ID = process.argv[2];
const SHOP     = (process.argv[3] || 'jfn').toLowerCase() === 'honk' ? 'honk' : 'jfn';

if (!ORDER_ID) { console.error('Bitte Order-ID angeben.'); process.exit(1); }

const eur = n => Number(n || 0).toFixed(2) + ' €';

async function readTab(sheets, tab) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A1:Z` });
  const [header, ...rows] = data.values ?? [];
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}
const toFloat = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isNaN(n) ? 0 : n; };

async function run() {
  const auth = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const wc = getWcClient(SHOP);
  const { data: order } = await wc.get(`orders/${ORDER_ID}`);

  const { header: kH, rows: kRows } = await readTab(sheets, 'Kalkulation_Fixkosten');
  const k = parseKonfiguration(kRows, kH);

  // FP_Artikel → Versandart + Artikelkategorie je Produkt-ID
  const { header: aH, rows: aRows } = await readTab(sheets, 'FP_Artikel');
  const ah = c => aH.indexOf(c);
  const artMap = {};
  for (const r of aRows) {
    const pid = String(r[ah('Produkt-ID')] ?? '').trim();
    if (pid) artMap[pid] = {
      versandart: ((r[ah('Versandart')] ?? 'P').toUpperCase() === 'B') ? 'B' : 'P',
      kategorie:  r[ah('Artikelkategorie')] ?? '',
      partnerId:  r[ah('Partner-ID')] ?? '',
    };
  }

  const sep = '─'.repeat(64);
  console.log(`\n${'═'.repeat(64)}`);
  console.log(` Festpreis-Order ${order.id}  ·  Shop: ${SHOP}  ·  Status: ${order.status}`);
  console.log(`${'═'.repeat(64)}\n`);

  const shippingNetto = toFloat(order.shipping_total);
  const orderNetto = order.line_items.reduce((s, i) => s + toFloat(i.total), 0);
  console.log(' ORDER-EBENE');
  console.log(sep);
  console.log(`  shipping_total (netto, Porto-Einnahme): ${eur(shippingNetto)}`);
  console.log(`  shipping_tax:                           ${eur(order.shipping_tax)}`);
  console.log(`  Summe line_items (netto):               ${eur(orderNetto)}`);
  console.log('');
  console.log(' FIXKOSTEN (aus Kalkulation_Fixkosten)');
  console.log(sep);
  console.log(`  Porto B / P:            ${eur(k.portoB)} / ${eur(k.portoP)}`);
  console.log(`  Versandnebenkosten B/P: ${eur(k.versandnebenkostenB)} / ${eur(k.versandnebenkostenP)}`);
  console.log(`  PayPal %: ${k.paypalProzent} %   Pauschale: ${eur(k.paypalPauschale)}   MwSt: ${k.mwstProzent} %`);
  console.log('');

  for (const item of order.line_items) {
    const pid = String(item.product_id || '');
    const art = artMap[pid];
    const itemNetto = toFloat(item.total);
    const anteil = orderNetto > 0 ? itemNetto / orderNetto : 0;
    const va = art?.versandart ?? 'P';
    const portoEin   = shippingNetto * anteil;
    const portoKost  = (va === 'B' ? k.portoB : k.portoP) * anteil;
    const versandnk  = (va === 'B' ? k.versandnebenkostenB : k.versandnebenkostenP) * anteil;
    const portoSaldo = portoEin - portoKost - versandnk;

    console.log(` ARTIKEL: ${item.name}  (Produkt-ID ${pid}${art ? '' : ' – NICHT in FP_Artikel!'})`);
    console.log(sep);
    console.log(`  Menge: ${item.quantity}   item.total (netto): ${eur(itemNetto)}   Versandart: ${va}`);
    console.log(`  Wertanteil an Bestellung (anteil): ${(anteil * 100).toFixed(1)} %`);
    console.log(`  + Porto-Einnahme  = ${eur(shippingNetto)} × ${anteil.toFixed(3)} = ${eur(portoEin)}`);
    console.log(`  − Porto-Kosten    = ${eur(va==='B'?k.portoB:k.portoP)} × ${anteil.toFixed(3)} = ${eur(portoKost)}`);
    console.log(`  − Versandnk       = ${eur(va==='B'?k.versandnebenkostenB:k.versandnebenkostenP)} × ${anteil.toFixed(3)} = ${eur(versandnk)}`);
    console.log(`  ───────────────────────────────────────`);
    console.log(`  = Porto-Saldo (Anzeige inkl. Versandnk): ${eur(portoSaldo)}`);
    console.log(`    davon reiner Porto-Saldo (ohne Versandnk): ${eur(portoEin - portoKost)}`);
    console.log('');
  }
}

run().catch(e => { console.error(e); process.exit(1); });
