import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { berechnePartnerAnteil, parseKonfiguration } from '../utils/partner-kalkulation.js';

const SHEET_ID     = process.env.BUSINESS_SHEET_ID;
const ORDER_ID     = process.argv[2] || '17263';
const SHOW_PARTNER = process.argv.includes('--show-partner');
const RAW_WC       = process.argv.includes('--raw-wc');

function getWcClient() {
  if (!process.env.WC_URL || !process.env.WC_KEY || !process.env.WC_SECRET)
    throw new Error('WooCommerce-Zugangsdaten fehlen (WC_URL, WC_KEY, WC_SECRET).');
  return new WooCommerceRestApi.default({
    url: process.env.WC_URL, consumerKey: process.env.WC_KEY,
    consumerSecret: process.env.WC_SECRET, version: 'wc/v3', queryStringAuth: true,
  });
}

async function runRawWc() {
  const wc = getWcClient();
  const { data: order } = await wc.get(`orders/${ORDER_ID}`);

  const sep = '─'.repeat(62);
  console.log(`\n${'═'.repeat(62)}`);
  console.log(` WC Raw-Order  ·  ID: ${order.id}  ·  Status: ${order.status}`);
  console.log(`${'═'.repeat(62)}\n`);

  console.log(' ORDER-EBENE');
  console.log(sep);
  const orderFields = [
    ['total',            order.total],
    ['total_tax',        order.total_tax],
    ['subtotal',         order.line_items?.reduce((s, i) => s + parseFloat(i.subtotal || 0), 0)?.toFixed(2)],
    ['shipping_total',   order.shipping_total],
    ['shipping_tax',     order.shipping_tax],
    ['discount_total',   order.discount_total],
    ['discount_tax',     order.discount_tax],
    ['cart_tax',         order.cart_tax],
    ['currency',         order.currency],
    ['prices_include_tax', String(order.prices_include_tax)],
  ];
  for (const [k, v] of orderFields)
    console.log(`  ${k.padEnd(24)} ${v}`);

  console.log('');
  console.log(' LINE_ITEMS');
  console.log(sep);
  for (const item of (order.line_items ?? [])) {
    console.log(`  [${item.id}] ${item.name}`);
    const itemFields = [
      ['product_id',   item.product_id],
      ['variation_id', item.variation_id],
      ['quantity',     item.quantity],
      ['subtotal',     item.subtotal],
      ['subtotal_tax', item.subtotal_tax],
      ['total',        item.total],
      ['total_tax',    item.total_tax],
      ['price',        item.price],
      ['sku',          item.sku],
    ];
    for (const [k, v] of itemFields)
      console.log(`    ${k.padEnd(22)} ${v}`);
    console.log('');
  }

  if (order.shipping_lines?.length) {
    console.log(' SHIPPING_LINES');
    console.log(sep);
    for (const sl of order.shipping_lines) {
      console.log(`  [${sl.id}] ${sl.method_title}`);
      console.log(`    total            ${sl.total}`);
      console.log(`    total_tax        ${sl.total_tax}`);
      console.log('');
    }
  }

  console.log(`${'═'.repeat(62)}\n`);
}

async function readTab(sheets, tabName) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: `${tabName}!A1:Z`,
  });
  const [header, ...rows] = data.values ?? [];
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}

function toFloat(val) {
  if (!val && val !== 0) return 0;
  const n = parseFloat(val.toString().replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function fmt(n) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function line(label, value, prefix = '') {
  console.log(`  ${prefix}${label.padEnd(30)} ${fmt(value)}`);
}

async function run() {
  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const [verkäufeTab, artikelTab, fixkostenTab, partnerTab] = await Promise.all([
    readTab(sheets, 'Partner_Verkäufe'),
    readTab(sheets, 'Partner_Artikel'),
    readTab(sheets, 'Kalkulation_Fixkosten'),
    readTab(sheets, 'Partner'),
  ]);

  // ── Verkauf finden ────────────────────────────────────────────────────────
  const vh = col => verkäufeTab.header.indexOf(col);
  const verkaufRows = verkäufeTab.rows.filter(r => (r[vh('Order-ID')] ?? '') === ORDER_ID);

  if (!verkaufRows.length) {
    console.error(`Keine Zeilen für Order-ID "${ORDER_ID}" gefunden.`);
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(62)}`);
  console.log(` Lizenz-Berechnungsweg  ·  Order-ID: ${ORDER_ID}`);
  console.log(`${'═'.repeat(62)}\n`);

  for (const [idx, vRow] of verkaufRows.entries()) {
    const partnerId   = vRow[vh('Partner-ID')]      ?? '';
    const datum       = vRow[vh('Datum')]            ?? '';
    const artikelname = vRow[vh('Artikelnummer')]    ?? '';
    const variante    = vRow[vh('Variante')]         ?? '';
    const stueckzahl  = parseInt(vRow[vh('Stückzahl')] ?? '1', 10);
    const vkNetto     = toFloat(vRow[vh('VK-Preis-Brutto')]); // WC item.total ist netto
    const lizenzSheet = toFloat(vRow[vh('Lizenzgebühr')]);
    const status      = vRow[vh('Status')]           ?? '';

    if (verkaufRows.length > 1)
      console.log(`── Artikel ${idx + 1} / ${verkaufRows.length} ─────────────────────────────────────`);

    console.log(` Partner-ID:  ${partnerId}`);
    console.log(` Datum:       ${datum}`);
    console.log(` Artikelname: ${artikelname}${variante ? '  ·  Variante: ' + variante : ''}`);
    console.log(` Stückzahl:   ${stueckzahl}`);
    console.log(` Status:      ${status}`);
    console.log('');

    // ── Partner-Daten ───────────────────────────────────────────────────────
    const ph    = col => partnerTab.header.indexOf(col);
    const pRow  = partnerTab.rows.find(r => (r[ph('Partner-ID')] ?? '') === partnerId);
    const lizenzProzent = pRow ? toFloat(pRow[ph('Lizenz-%')]) : 0;
    const portoModell   = pRow ? (pRow[ph('Porto-Modell')] ?? 'geteilt-50-50') : 'geteilt-50-50';
    const partnerName   = pRow ? (pRow[ph('Name')] ?? partnerId) : partnerId;

    console.log(` Partner:     ${partnerName}  |  Lizenz: ${lizenzProzent}%  |  Porto-Modell: ${portoModell}`);

    if (SHOW_PARTNER && pRow) {
      console.log('');
      console.log(' ┌─ Partner-Zeile (alle Spalten) ───────────────────────────');
      partnerTab.header.forEach((col, i) => {
        const val = pRow[i] ?? '(leer)';
        console.log(` │  ${col.padEnd(22)} ${val}`);
      });
      console.log(' └──────────────────────────────────────────────────────────');
    } else if (SHOW_PARTNER && !pRow) {
      console.log(' ⚠  Kein Partner-Eintrag für ID "' + partnerId + '" gefunden.');
    }
    console.log('');

    // ── Artikel-Daten ───────────────────────────────────────────────────────
    const ah  = col => artikelTab.header.indexOf(col);
    const aRow = artikelTab.rows.find(r =>
      (r[ah('Partner-ID')] ?? '') === partnerId &&
      (r[ah('Artikelname')] ?? '') === artikelname
    );
    const ekPreis      = aRow ? toFloat(aRow[ah('EK-Preis-Netto')]) : 0;
    const druckkosten  = aRow ? toFloat(aRow[ah('Druckkosten')])     : 0;
    const versandart   = aRow ? ((aRow[ah('Versandart')] ?? 'P').toString().toUpperCase() === 'B' ? 'B' : 'P') : 'P';

    if (!aRow) console.log(' ⚠  Kein Eintrag in Partner_Artikel → EK/Druck = 0\n');

    // ── Konfiguration ───────────────────────────────────────────────────────
    const konfig = parseKonfiguration(fixkostenTab.rows, fixkostenTab.header);

    // ── Berechnung ──────────────────────────────────────────────────────────
    const calc = berechnePartnerAnteil({
      vkNetto, ekPreis, druckkosten, versandart,
      portoModell, anzahlArtikelInBestellung: 1, bestellungsAnteil: 1,
      lizenzProzent, portoEinnahmeAnteil: 0, konfiguration: konfig,
    });

    console.log(`${'─'.repeat(62)}`);
    console.log(' KALKULATION (bestellungsAnteil = 1, kein Porto-Einnahme-Anteil)\n');

    line('VK Netto (aus WC item.total):', vkNetto);
    console.log('');
    line('− EK-Preis (netto):',       ekPreis,     '');
    line('− Druckkosten:',            druckkosten, '');
    line('− Herstellungsnebenkosten:',konfig.herstellungsnebenkosten, '');
    line(`= Herstellungspreis:`,      calc.herstellungspreis, '');
    console.log('');
    const vnkKey = versandart === 'B' ? 'versandnebenkostenB' : 'versandnebenkostenP';
    line(`− Versandnebenkosten (${versandart}):`, konfig[vnkKey], '');
    console.log('');
    const paypalProzent  = konfig.paypalProzent;
    const paypalPauschale = konfig.paypalPauschale;
    line(`− PayPal (${vkNetto}×${paypalProzent}% + ${fmt(paypalPauschale)}):`, calc.paypalKosten, '');
    console.log('');
    line('= Gewinn netto:',            calc.gewinnNetto);
    line(`× Lizenz ${lizenzProzent}%:`, calc.gewinnNetto * lizenzProzent / 100);
    console.log('');

    const portoKey   = versandart === 'B' ? 'portoB' : 'portoP';
    const portoKosten = konfig[portoKey];
    line(`  Porto-Kosten (${versandart}, Anteil 1):`, -portoKosten);
    line('  Porto-Einnahme (kein WC-Sync-Wert):',     0);
    if (portoModell === 'geteilt-50-50') {
      line('  Porto-Saldo ÷ 2 (geteilt-50-50):', calc.portoSaldoPartner);
    } else {
      line('  Porto-Saldo 100% (partner-trägt):', calc.portoSaldoPartner);
    }
    console.log('');
    line('= PARTNER-ANTEIL netto:',      calc.netto);
    line(`  × (1 + ${konfig.mwstProzent}% MwSt) brutto:`, calc.brutto);
    console.log('');
    console.log(`${'─'.repeat(62)}`);
    line(' Sheet-Lizenzgebühr (gespeichert):', lizenzSheet);
    if (stueckzahl > 1) {
      line(` × ${stueckzahl} Stück (Sheet speichert Gesamtwert):`, lizenzSheet * stueckzahl);
    }
    console.log('');

    const diff = Math.abs(calc.partnerAnteil - lizenzSheet);
    if (diff < 0.02) {
      console.log(' ✓  Berechneter Wert stimmt mit Sheet-Wert überein.');
    } else {
      console.log(` ⚠  Abweichung: ${fmt(diff)} (Ursache: anderer Porto-Anteil beim Sync, abweichende EK-Daten oder Stückzahl-Splitting)`);
    }
    console.log('');

    console.log(' Verwendete Fixkosten:');
    console.log(`   MwSt:                  ${konfig.mwstProzent}%`);
    console.log(`   Herstellungsnebenk.:   ${fmt(konfig.herstellungsnebenkosten)}`);
    console.log(`   Versandnebenkosten ${versandart}: ${fmt(konfig[vnkKey])}`);
    console.log(`   PayPal Prozent:        ${konfig.paypalProzent}%`);
    console.log(`   PayPal Pauschale:      ${fmt(konfig.paypalPauschale)}`);
    console.log(`   Porto ${versandart}:           ${fmt(konfig[portoKey])}`);
    console.log('');
  }

  console.log(`${'═'.repeat(62)}\n`);
}

(RAW_WC ? runRawWc() : run()).catch(e => { console.error(e); process.exit(1); });
