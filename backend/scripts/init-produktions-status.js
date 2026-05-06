import dotenv from 'dotenv';
dotenv.config();
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_PS         = 'Produktions_Status';
const PS_COLS        = [
  'WC_Order_ID', 'WC_Item_ID', 'Artikelname', 'SKU', 'Menge',
  'L-Shop_bestellt', 'DTF_bestellt', 'Gedruckt', 'Versendet', 'Notiz',
];

function getWcClient() {
  if (!process.env.WC_URL || !process.env.WC_KEY || !process.env.WC_SECRET) {
    throw new Error('WooCommerce-Zugangsdaten fehlen (WC_URL, WC_KEY, WC_SECRET).');
  }
  return new WooCommerceRestApi.default({
    url:             process.env.WC_URL,
    consumerKey:     process.env.WC_KEY,
    consumerSecret:  process.env.WC_SECRET,
    version:         'wc/v3',
    queryStringAuth: true,
  });
}

async function fetchAllOrders(wc) {
  const orders = [];
  let page = 1;
  while (true) {
    const { data } = await wc.get('orders', {
      status:   'pending,processing',
      per_page: 100,
      page,
    });
    if (!Array.isArray(data) || data.length === 0) break;
    orders.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return orders;
}

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('Fehler: GOOGLE_SHEET_ID fehlt in .env');
    process.exit(1);
  }

  const wc     = getWcClient();
  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // ── Bestehende Produktions_Status Zeilen laden ────────────────────────────
  const { data: existing } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range:         `${TAB_PS}!A1:J5000`,
  });
  const existingRows = existing.values ?? [];

  // Set mit "orderId|itemId" für Idempotenz-Prüfung
  const existingKeys = new Set(
    existingRows.slice(1).map(r => `${(r[0] ?? '').trim()}|${(r[1] ?? '').trim()}`)
  );

  // ── Offene WC-Bestellungen laden ──────────────────────────────────────────
  console.log('Lade offene Bestellungen (pending + processing)…');
  const orders = await fetchAllOrders(wc);
  console.log(`${orders.length} Bestellung(en) gefunden.\n`);

  // ── Neue Zeilen aufbauen ──────────────────────────────────────────────────
  const newRows = [];
  let skippedOrders  = 0;
  let newOrders      = 0;
  let skippedItems   = 0;
  let newItems       = 0;

  for (const order of orders) {
    const orderId    = String(order.id);
    const lineItems  = Array.isArray(order.line_items) ? order.line_items : [];
    let   orderIsNew = false;

    for (const item of lineItems) {
      const itemId = String(item.id);
      const key    = `${orderId}|${itemId}`;

      if (existingKeys.has(key)) {
        skippedItems++;
        continue;
      }

      newRows.push([
        orderId,
        itemId,
        item.name   ?? '',
        item.sku    ?? '',
        item.quantity ?? 1,
        false, false, false, false,  // Checkboxen
        '',                          // Notiz
      ]);
      existingKeys.add(key);
      newItems++;
      orderIsNew = true;
    }

    if (orderIsNew) {
      const name = `${order.billing?.first_name ?? ''} ${order.billing?.last_name ?? ''}`.trim();
      console.log(`  #${orderId} ${name || '–'} → ${lineItems.length} Artikel`);
      newOrders++;
    } else {
      skippedOrders++;
    }
  }

  // ── Neue Zeilen schreiben ─────────────────────────────────────────────────
  if (newRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId:    SPREADSHEET_ID,
      range:            `${TAB_PS}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody:      { values: newRows },
    });
  }

  console.log('\n─────────────────────────────────────');
  console.log('Import abgeschlossen.');
  console.log(`  Bestellungen neu:        ${newOrders}`);
  console.log(`  Bestellungen übersprungen: ${skippedOrders}`);
  console.log(`  Artikel-Zeilen neu:      ${newItems}`);
  console.log(`  Artikel-Zeilen übersprungen: ${skippedItems}`);
}

main().catch(err => {
  console.error('Fehler:', err.message ?? err);
  process.exit(1);
});
