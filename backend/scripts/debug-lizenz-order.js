// Lizenz-Berechnungsweg einer Order nachvollziehen.
//
// Verwendung:
//   node backend/scripts/debug-lizenz-order.js <ORDER_ID> [--shop=honk] [--show-partner] [--raw-wc]
//
// Stehen zur Order Zeilen im Verkaeufe-Reiter, wird je Zeile nachgerechnet und
// mit dem gespeicherten Wert verglichen. Stehen keine da (z.B. nach dem
// Loeschen fuer einen Neu-Sync), rechnet das Skript je WC-Position so, wie der
// Sync sie schreiben wuerde: Stückzahl, Wertanteil, Lizenzsatz aus dem
// Partner-Reiter, EK/Druck aus Partner_Artikel bzw. HK_Partner_Artikel.
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient, getShopConfig } from '../lib/shopConfig.js';
import {
  berechnePartnerAnteil, parseKonfiguration, baueLizenzSaetze, lizenzSatzAusZeile,
} from '../utils/partner-kalkulation.js';

const SHEET_ID     = process.env.BUSINESS_SHEET_ID;
const ORDER_ID     = process.argv[2] || '17263';
const SHOW_PARTNER = process.argv.includes('--show-partner');
const RAW_WC       = process.argv.includes('--raw-wc');
const SHOP         = process.argv.find(a => a.startsWith('--shop='))?.slice(7) ?? 'jfn';

async function runRawWc() {
  const wc = getWcClient(SHOP);
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
  console.log(`  ${prefix}${label.padEnd(34)} ${fmt(value)}`);
}

function zeigeFixkosten(konfig, versandart) {
  const vnkKey   = versandart === 'B' ? 'versandnebenkostenB' : 'versandnebenkostenP';
  const portoKey = versandart === 'B' ? 'portoB' : 'portoP';
  console.log(' Verwendete Fixkosten:');
  console.log(`   MwSt:                  ${konfig.mwstProzent}%`);
  console.log(`   Herstellungsnebenk.:   ${fmt(konfig.herstellungsnebenkosten)} je Stück`);
  console.log(`   Versandnebenkosten ${versandart}: ${fmt(konfig[vnkKey])} je Bestellung`);
  console.log(`   PayPal Prozent:        ${konfig.paypalProzent}%`);
  console.log(`   PayPal Pauschale:      ${fmt(konfig.paypalPauschale)} je Bestellung`);
  console.log(`   Porto ${versandart}:           ${fmt(konfig[portoKey])} je Bestellung`);
  console.log('');
}

// Rechenweg einer Position, wie der Sync sie schreibt.
function zeigeRechenweg({ vkNetto, stueckzahl, ekPreis, druckkosten, versandart, anteil,
                          portoEinnahmeAnteil, portoModell, lizenzProzent, konfig }) {
  const calc = berechnePartnerAnteil({
    vkNetto, ekPreis, druckkosten, versandart, portoModell,
    bestellungsAnteil: anteil, stueckzahl, lizenzProzent, portoEinnahmeAnteil, konfiguration: konfig,
  });
  const vnkKey   = versandart === 'B' ? 'versandnebenkostenB' : 'versandnebenkostenP';
  const portoKey = versandart === 'B' ? 'portoB' : 'portoP';

  line('VK netto (item.total):', vkNetto);
  line(`− EK ${fmt(ekPreis)} × ${stueckzahl}:`, ekPreis * stueckzahl);
  line(`− Druck ${fmt(druckkosten)} × ${stueckzahl}:`, druckkosten * stueckzahl);
  line(`− HNK ${fmt(konfig.herstellungsnebenkosten)} × ${stueckzahl}:`, konfig.herstellungsnebenkosten * stueckzahl);
  line('= Herstellungspreis:', calc.herstellungspreis);
  line(`− Versand-NK ${versandart} × ${(anteil * 100).toFixed(1)} %:`, calc.versandnebenkosten);
  line(`− PayPal (${konfig.paypalProzent} % v. brutto + Pauschale × Anteil):`, calc.paypalKosten);
  line('= Gewinn netto:', calc.gewinnNetto);
  line(`× Lizenz ${lizenzProzent} %:`, calc.gewinnNetto * lizenzProzent / 100);
  line(`  Porto-Einnahme × Anteil:`, portoEinnahmeAnteil);
  line(`  Porto-Kosten ${versandart} × Anteil:`, -(konfig[portoKey] * anteil));
  line(`+ Porto-Saldo (${portoModell}):`, calc.portoSaldoPartner);
  line('= PARTNER-ANTEIL netto:', calc.netto);
  line(`  brutto (+${konfig.mwstProzent} % MwSt):`, calc.brutto);
  void vnkKey;
  return calc;
}

// ── Keine Sheet-Zeilen: je WC-Position rechnen ───────────────────────────────
async function runAusWc({ artikelTab, hkArtikelTab, partnerTab, konfig }) {
  const { data: order } = await getWcClient(SHOP).get(`orders/${ORDER_ID}`);
  const lizenzSatz = baueLizenzSaetze(partnerTab.header, partnerTab.rows);
  const ph = col => partnerTab.header.indexOf(col);
  const portoModellVon = id => partnerTab.rows.find(r => r[ph('Partner-ID')] === id)?.[ph('Porto-Modell')] ?? 'geteilt-50-50';

  // Artikel-Lookup je Produkt-ID → [{ partnerId, ekPreis, druckkosten, versandart }]
  const lookup = new Map();
  if (SHOP === 'honk') {
    const honk = partnerTab.rows.find(r => String(r[ph('Shop')] ?? '').trim().toLowerCase() === 'honk'
                                        && String(r[ph('Aktiv')] ?? '').trim().toLowerCase() === 'ja');
    const ah = col => hkArtikelTab.header.indexOf(col);
    for (const r of hkArtikelTab.rows) {
      const pid = String(r[ah('Produkt-ID')] ?? '').trim();
      if (pid && !lookup.has(pid)) lookup.set(pid, [{
        partnerId: honk?.[ph('Partner-ID')] ?? '?', ekPreis: toFloat(r[ah('EK-Preis-Netto')]),
        druckkosten: toFloat(r[ah('Druckkosten')]),
        versandart: String(r[ah('Versandart')] ?? 'P').toUpperCase() === 'B' ? 'B' : 'P',
      }]);
    }
  } else {
    const ah = col => artikelTab.header.indexOf(col);
    for (const r of artikelTab.rows) {
      const pid = String(r[ah('Produkt-ID')] ?? '').trim();
      const partnerId = r[ah('Partner-ID')] ?? '';
      if (!pid || !partnerId) continue;
      if (!lookup.has(pid)) lookup.set(pid, []);
      lookup.get(pid).push({
        partnerId, ekPreis: toFloat(r[ah('EK-Preis-Netto')]), druckkosten: toFloat(r[ah('Druckkosten')]),
        versandart: String(r[ah('Versandart')] ?? 'P').toUpperCase() === 'B' ? 'B' : 'P',
      });
    }
  }

  const orderNetto    = order.line_items.reduce((s, i) => s + toFloat(i.total), 0);
  const shippingNetto = toFloat(order.shipping_total);
  const bekannte      = order.line_items.flatMap(i => lookup.get(String(i.product_id)) ?? []);
  const versandart    = SHOP === 'honk'
    ? (bekannte.length && bekannte.every(e => e.versandart === 'B') ? 'B' : 'P')
    : (bekannte.some(e => e.versandart === 'P') ? 'P' : 'B');

  console.log(`\n${'═'.repeat(62)}`);
  console.log(` Lizenz-Berechnung aus WC  ·  Order ${order.id}  ·  ${getShopConfig(SHOP).label}`);
  console.log(` Status ${order.status}  ·  Order netto ${fmt(orderNetto)}  ·  Versand netto ${fmt(shippingNetto)}`);
  console.log(` (keine Zeilen in ${getShopConfig(SHOP).tabVerkaeufe} – so würde der Sync schreiben)`);
  console.log(`${'═'.repeat(62)}\n`);

  let summe = 0;
  const tabelle = [];
  for (const [idx, item] of order.line_items.entries()) {
    const entries = lookup.get(String(item.product_id));
    console.log(`── Position ${idx + 1} / ${order.line_items.length}: ${item.name}  (Variation ${item.variation_id || 0})`);
    if (!entries) {
      console.log(`  ⚠ Produkt-ID ${item.product_id} nicht im Artikel-Reiter – Sync überspringt.\n`);
      continue;
    }
    const vkNetto = toFloat(item.total);
    const anteil  = orderNetto > 0 ? vkNetto / orderNetto : 0;
    for (const e of entries) {
      const lizenzProzent = lizenzSatz(e.partnerId);
      console.log(`  Partner ${e.partnerId}  ·  Stück ${item.quantity}  ·  Anteil ${(anteil * 100).toFixed(2)} %  ·  Lizenz ${lizenzProzent} % (Partner-Reiter)`);
      const calc = zeigeRechenweg({
        vkNetto, stueckzahl: item.quantity, ekPreis: e.ekPreis, druckkosten: e.druckkosten, versandart,
        anteil, portoEinnahmeAnteil: shippingNetto * anteil, portoModell: portoModellVon(e.partnerId),
        lizenzProzent, konfig,
      });
      summe += calc.netto;
      tabelle.push({ pos: idx + 1, stueck: item.quantity, vk: vkNetto, gewinn: calc.gewinnNetto, netto: calc.netto });
      console.log('');
    }
  }

  console.log(`${'─'.repeat(62)}`);
  console.log('  Pos  Stück   VK netto     Gewinn    Partner netto');
  for (const t of tabelle)
    console.log(`  ${String(t.pos).padStart(3)}  ${String(t.stueck).padStart(5)}  ${fmt(t.vk).padStart(10)} ${fmt(t.gewinn).padStart(10)}  ${fmt(t.netto).padStart(12)}`);
  line('Summe Partner-Anteil netto:', Math.round(summe * 100) / 100);
  console.log('');
  zeigeFixkosten(konfig, versandart);
}

// ── Sheet-Zeilen vorhanden: je Zeile nachrechnen ─────────────────────────────
async function run() {
  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const shopCfg = getShopConfig(SHOP);

  const [verkäufeTab, artikelTab, hkArtikelTab, fixkostenTab, partnerTab] = await Promise.all([
    readTab(sheets, shopCfg.tabVerkaeufe),
    readTab(sheets, 'Partner_Artikel'),
    SHOP === 'honk' ? readTab(sheets, 'HK_Partner_Artikel') : Promise.resolve({ header: [], rows: [] }),
    readTab(sheets, 'Kalkulation_Fixkosten'),
    readTab(sheets, 'Partner'),
  ]);
  const konfig = parseKonfiguration(fixkostenTab.rows, fixkostenTab.header);

  const vh = col => verkäufeTab.header.indexOf(col);
  const verkaufRows = verkäufeTab.rows.filter(r => (r[vh('Order-ID')] ?? '') === ORDER_ID);

  if (!verkaufRows.length) {
    return runAusWc({ artikelTab, hkArtikelTab, partnerTab, konfig });
  }

  console.log(`\n${'═'.repeat(62)}`);
  console.log(` Lizenz-Berechnungsweg  ·  Order-ID: ${ORDER_ID}  ·  ${shopCfg.tabVerkaeufe}`);
  console.log(`${'═'.repeat(62)}\n`);

  const lizenzSatz = baueLizenzSaetze(partnerTab.header, partnerTab.rows);
  const ph = col => partnerTab.header.indexOf(col);

  for (const [idx, vRow] of verkaufRows.entries()) {
    const partnerId   = vRow[vh('Partner-ID')]      ?? '';
    const artikelname = vRow[vh('Artikelnummer')]    ?? '';
    const stueckzahl  = parseInt(vRow[vh('Stückzahl')] ?? '1', 10);
    const vkNetto     = toFloat(vRow[vh('VK-Preis-Brutto')]); // WC item.total ist netto
    const lizenzSheet = toFloat(vRow[vh('Lizenzgebühr')]);
    const satzZeile   = lizenzSatzAusZeile(vRow[vh('Gewinn-netto')], vRow[vh('Lizenz-Anteil')]);

    if (verkaufRows.length > 1)
      console.log(`── Zeile ${idx + 1} / ${verkaufRows.length} ─────────────────────────────────────`);
    console.log(` Partner-ID:  ${partnerId}  ·  Datum ${vRow[vh('Datum')] ?? ''}  ·  Status ${vRow[vh('Status')] ?? ''}`);
    console.log(` Artikel:     ${artikelname}  ·  Stückzahl ${stueckzahl}`);

    const pRow = partnerTab.rows.find(r => (r[ph('Partner-ID')] ?? '') === partnerId);
    const portoModell = pRow ? (pRow[ph('Porto-Modell')] ?? 'geteilt-50-50') : 'geteilt-50-50';
    const lizenzProzent = lizenzSatz(partnerId);
    console.log(` Satz:        Partner-Reiter ${lizenzProzent} %  ·  in der Zeile gespeichert ${satzZeile ?? '–'} %`);
    if (SHOW_PARTNER && pRow) {
      partnerTab.header.forEach((col, i) => console.log(`   ${col.padEnd(22)} ${pRow[i] ?? '(leer)'}`));
    }

    const produktId = String(vRow[vh('Produkt-ID')] ?? '');
    let ekPreis = 0, druckkosten = 0, versandart = 'P';
    if (SHOP === 'honk') {
      const ah = col => hkArtikelTab.header.indexOf(col);
      const a = hkArtikelTab.rows.find(r => String(r[ah('Produkt-ID')] ?? '') === produktId);
      if (a) { ekPreis = toFloat(a[ah('EK-Preis-Netto')]); druckkosten = toFloat(a[ah('Druckkosten')]); versandart = String(a[ah('Versandart')] ?? 'P').toUpperCase() === 'B' ? 'B' : 'P'; }
      else console.log(` ⚠  Produkt-ID ${produktId} nicht in HK_Partner_Artikel → EK/Druck = 0`);
    } else {
      const ah = col => artikelTab.header.indexOf(col);
      const a = artikelTab.rows.find(r => (r[ah('Partner-ID')] ?? '') === partnerId && String(r[ah('Produkt-ID')] ?? '') === produktId);
      if (a) { ekPreis = toFloat(a[ah('EK-Preis-Netto')]); druckkosten = toFloat(a[ah('Druckkosten')]); versandart = String(a[ah('Versandart')] ?? 'P').toUpperCase() === 'B' ? 'B' : 'P'; }
      else console.log(` ⚠  Produkt-ID ${produktId} nicht in Partner_Artikel → EK/Druck = 0`);
    }
    console.log('');
    console.log(' KALKULATION (Anteil = 1, ohne Porto-Einnahme – Anteil/Porto der Order kennt die Zeile nicht)\n');
    const calc = zeigeRechenweg({
      vkNetto, stueckzahl, ekPreis, druckkosten, versandart, anteil: 1,
      portoEinnahmeAnteil: 0, portoModell, lizenzProzent, konfig,
    });
    console.log('');
    line('Sheet-Lizenzgebühr (gespeichert):', lizenzSheet);
    const diff = Math.abs(calc.partnerAnteil - lizenzSheet);
    console.log(diff < 0.02
      ? ' ✓  Berechneter Wert stimmt mit Sheet-Wert überein.'
      : ` ⚠  Abweichung: ${fmt(diff)} (Wertanteil/Porto der Order, anderer Satz beim Sync oder alte Rechnung ohne × Stückzahl)`);
    console.log('');
    zeigeFixkosten(konfig, versandart);
  }

  console.log(`${'═'.repeat(62)}\n`);
}

(RAW_WC ? runRawWc() : run()).catch(e => { console.error(e); process.exit(1); });
