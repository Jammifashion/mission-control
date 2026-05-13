// Verify correct sync values for orders 17084 and 17075
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { berechnePartnerAnteil, parseKonfiguration } from '../utils/partner-kalkulation.js';

const SHEET_ID = process.env.BUSINESS_SHEET_ID;
const ORDER_IDS = [17084, 17075];

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
    spreadsheetId: SHEET_ID, range: `${tabName}!A1:N`,
  });
  const [header, ...rows] = data.values ?? [];
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}

async function run() {
  const auth = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Load Partner_Artikel
  const { header: aH, rows: aRows } = await readTab(sheets, 'Partner_Artikel');
  const ah = col => aH.indexOf(col);
  const partnerArtikelMap = {};
  for (const r of aRows) {
    const partnerId  = r[ah('Partner-ID')] ?? '';
    const pid        = (r[ah('Produkt-ID')] ?? '').toString().trim();
    const lizenzProzent = toFloat(r[ah('Lizenz-%')]);
    const ekPreis     = toFloat(r[ah('EK-Preis-Netto')]);
    const druckkosten = toFloat(r[ah('Druckkosten')]);
    const versandart  = ((r[ah('Versandart')] ?? 'P').toString().toUpperCase() === 'B') ? 'B' : 'P';
    if (!pid || !partnerId) continue;
    if (!partnerArtikelMap[pid]) partnerArtikelMap[pid] = [];
    partnerArtikelMap[pid].push({ partnerId, lizenzProzent, ekPreis, druckkosten, versandart });
  }

  // Load Partner info
  const { header: pH, rows: pRows } = await readTab(sheets, 'Partner');
  const ph = col => pH.indexOf(col);
  const partnerInfoMap = {};
  for (const r of pRows) {
    const id = r[ph('Partner-ID')] ?? '';
    if (id) partnerInfoMap[id] = { portoModell: r[ph('Porto-Modell')] ?? 'geteilt-50-50' };
  }

  // Load Konfiguration
  const { header: kH, rows: kRows } = await readTab(sheets, 'Kalkulation_Fixkosten');
  const konfiguration = parseKonfiguration(kRows, kH);

  // Get WC orders
  const wc = new WooCommerceRestApi.default({
    url: process.env.WC_URL, consumerKey: process.env.WC_KEY,
    consumerSecret: process.env.WC_SECRET, version: 'wc/v3', queryStringAuth: true,
  });

  console.log('━━ Verifikation der Sync-Werte ━━\n');

  for (const orderId of ORDER_IDS) {
    try {
      const { data: order } = await wc.get(`orders/${orderId}`);
      console.log(`\n╔ Order ${order.id} ╔`);
      console.log(`   Datum: ${toDE(order.date_created)}`);
      console.log(`   Versand (netto): ${order.shipping_total}€`);
      console.log(`   Order netto gesamt: ${order.line_items.reduce((s, i) => s + toFloat(i.total), 0).toFixed(2)}€`);

      const shippingNetto = toFloat(order.shipping_total);
      const orderNetto = order.line_items.reduce((s, i) => s + toFloat(i.total), 0);

      for (const item of order.line_items) {
        const pid = String(item.product_id || '');
        const entries = partnerArtikelMap[pid];

        if (entries && entries.length > 0) {
          const itemNetto = toFloat(item.total);
          const anteil = orderNetto > 0 ? (itemNetto / orderNetto) : 0;
          const portoEinnahmeAnteil = shippingNetto * anteil;

          for (const e of entries) {
            console.log(`\n   Artikel: ${item.name} (Produkt-ID: ${pid})`);
            console.log(`   Partner: ${e.partnerId}`);
            console.log(`   Lizenz: ${e.lizenzProzent}%`);

            const calc = berechnePartnerAnteil({
              vkNetto: itemNetto,
              ekPreis: e.ekPreis,
              druckkosten: e.druckkosten,
              versandart: 'B',
              portoModell: partnerInfoMap[e.partnerId]?.portoModell ?? 'geteilt-50-50',
              bestellungsAnteil: anteil,
              lizenzProzent: e.lizenzProzent,
              portoEinnahmeAnteil,
              konfiguration,
            });

            const lizenzAnteilVomGewinn = calc.gewinnNetto * (e.lizenzProzent || 0) / 100;

            console.log(`   Gewinn-netto: ${calc.gewinnNetto.toFixed(2)}€`);
            console.log(`   Lizenz-Anteil: ${lizenzAnteilVomGewinn.toFixed(2)}€`);
            console.log(`   Porto-Saldo: ${calc.portoSaldoPartner.toFixed(2)}€`);
            console.log(`   Anteil-Brutto: ${calc.brutto.toFixed(2)}€`);
          }
        }
      }
    } catch (e) {
      console.log(`\n⚠️  Fehler bei Order ${orderId}: ${e.message}`);
    }
  }
}

run().catch(e => { console.error(e); process.exit(1); });
