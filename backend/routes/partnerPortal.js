import { Router } from 'express';
import { google } from 'googleapis';
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import { getGoogleAuth } from '../lib/googleAuth.js';

const router = Router();

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

function getSheets() {
  return getGoogleAuth().then(auth => google.sheets({ version: 'v4', auth }));
}

function getWcClient() {
  if (!process.env.WC_URL || !process.env.WC_KEY || !process.env.WC_SECRET)
    throw new Error('WooCommerce-Zugangsdaten fehlen (WC_URL, WC_KEY, WC_SECRET).');
  return new WooCommerceRestApi.default({
    url: process.env.WC_URL, consumerKey: process.env.WC_KEY,
    consumerSecret: process.env.WC_SECRET, version: 'wc/v3', queryStringAuth: true,
  });
}

async function readTab(sheets, sheetId, tabName) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${tabName}!A1:Z`,
  });
  const [header, ...rows] = data.values ?? [];
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}

function toDE(date) {
  const d = new Date(date);
  return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${d.getUTCFullYear()}`;
}

async function resolvePartner(token) {
  const sheetId = process.env.BUSINESS_SHEET_ID;
  if (!sheetId) throw Object.assign(new Error('BUSINESS_SHEET_ID nicht konfiguriert.'), { status: 503 });

  const sheets = await getSheets();
  const { header, rows } = await readTab(sheets, sheetId, 'Partner');

  const tokenIdx = header.indexOf('Token');
  const idIdx    = header.indexOf('Partner-ID');
  const nameIdx  = header.indexOf('Name');
  const aktivIdx = header.indexOf('Aktiv');

  const row = rows.find(r => token && (r[tokenIdx] ?? '') === token);
  if (!row) throw Object.assign(new Error('Ungültiger Token.'), { status: 401 });
  if ((row[aktivIdx] ?? '').toLowerCase() !== 'ja')
    throw Object.assign(new Error('Partner ist nicht aktiv.'), { status: 403 });

  return { partnerId: row[idIdx] ?? '', partnerName: row[nameIdx] ?? '' };
}

// ── GET /api/partner/auth?token= ─────────────────────────────────────────────
router.get('/auth', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    res.json(await resolvePartner(token));
  } catch (err) { next(err); }
});

// ── GET /api/partner/verkaeufe/sync   (requires MC_API_KEY) ──────────────────
// Holt WC-Bestellungen, matched Produkt-Kategorien gegen Partner-Hauptkategorie,
// schreibt neue Zeilen in Partner_Verkäufe (Duplikate per Order-ID + Artikelname).
router.get('/verkaeufe/sync', async (req, res, next) => {
  if (req.headers['x-api-key'] !== process.env.MC_API_KEY)
    return res.status(401).json({ error: 'Unauthorized.' });

  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });

    const sheets = await getSheets();

    // 1. Partner mit Hauptkategorie und Lizenz-% laden
    const { header: pH, rows: pRows } = await readTab(sheets, sheetId, 'Partner');
    const ph = col => pH.indexOf(col);
    const partners = pRows.map(r => ({
      id:            r[ph('Partner-ID')]       ?? '',
      kategorie:     (r[ph('Hauptkategorie')] ?? '').trim().toLowerCase(),
      lizenzProzent: parseFloat(r[ph('Lizenz-%')] ?? '0'),
    })).filter(p => p.id && p.kategorie);

    if (!partners.length)
      return res.json({ synced: 0, orders: 0, message: 'Keine Partner mit Kategorie konfiguriert.' });

    // 2. WC Produktkategorien laden → Hierarchie-Map aufbauen
    const wc = getWcClient();
    const catMap = {}; // id → { name, parentId }
    for (let page = 1; ; page++) {
      const { data: cats } = await wc.get('products/categories', { per_page: 100, page });
      cats.forEach(c => { catMap[c.id] = { name: c.name.toLowerCase(), parentId: c.parent ?? 0 }; });
      if (cats.length < 100) break;
    }

    // Root-Kategorie eines Kategorieeintrags ermitteln (parent-Kette hochlaufen)
    function rootCatName(catId) {
      let cur = catMap[catId];
      while (cur?.parentId) cur = catMap[cur.parentId];
      return cur?.name ?? null;
    }

    // 3. Bereits vorhandene Einträge laden → Duplikat-Set
    const { header: vH, rows: vRows } = await readTab(sheets, sheetId, 'Partner_Verkäufe');
    const vh = col => vH.indexOf(col);
    const existingKeys = new Set(
      vRows.map(r => `${r[vh('Order-ID')] ?? ''}|${r[vh('Artikelnummer')] ?? ''}`)
    );

    // 4. WC Bestellungen laden (processing + completed, alle Seiten)
    const orders = [];
    for (let page = 1; ; page++) {
      const [proc, compl] = await Promise.all([
        wc.get('orders', { per_page: 100, page, status: 'processing' }),
        wc.get('orders', { per_page: 100, page, status: 'completed'  }),
      ]);
      orders.push(...proc.data, ...compl.data);
      if (proc.data.length < 100 && compl.data.length < 100) break;
    }

    // 5. Unique product_ids sammeln → Produkte in 100er-Batches laden
    const uniqueIds = [...new Set(
      orders.flatMap(o => o.line_items.map(i => i.product_id).filter(Boolean))
    )];
    const prodCache = {}; // productId → { name, catIds }
    for (let i = 0; i < uniqueIds.length; i += 100) {
      const batch = uniqueIds.slice(i, i + 100);
      try {
        const { data: prods } = await wc.get('products', { include: batch.join(','), per_page: 100 });
        prods.forEach(p => {
          prodCache[p.id] = { name: p.name, catIds: (p.categories ?? []).map(c => c.id) };
        });
      } catch { /* Batch überspringen */ }
    }

    // 6. Iterieren: Order-Items → Kategorie-Match → Zeilen sammeln
    const toWrite = [];
    for (const order of orders) {
      const orderDate = toDE(new Date(order.date_created));
      for (const item of order.line_items) {
        const prod = prodCache[item.product_id];
        if (!prod) continue;

        const rootNames = [...new Set(prod.catIds.map(id => rootCatName(id)).filter(Boolean))];

        for (const rootName of rootNames) {
          for (const partner of partners.filter(p => p.kategorie === rootName)) {
            const key = `${order.id}|${prod.name}`;
            if (existingKeys.has(key)) continue;
            existingKeys.add(key);

            const vkBrutto = parseFloat(item.total ?? '0');
            const lizenz   = parseFloat(((vkBrutto * partner.lizenzProzent) / 100).toFixed(2));
            toWrite.push([
              partner.id, orderDate, String(order.id),
              prod.name, '', String(item.quantity),
              vkBrutto, lizenz, 'offen',
            ]);
          }
        }
      }
    }

    // 7. Batch-Append ins Sheet
    if (toWrite.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'Partner_Verkäufe!A:I',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: toWrite },
      });
    }

    res.json({
      synced:  toWrite.length,
      orders:  orders.length,
      message: toWrite.length
        ? `${toWrite.length} neue Einträge aus ${orders.length} Bestellungen synchronisiert.`
        : 'Alle Einträge bereits vorhanden – nichts Neues.',
    });
  } catch (err) { next(err); }
});

// ── GET /api/partner/verkaeufe?token= ────────────────────────────────────────
// Gibt nur offene (nicht abgerechnete) Zeilen des Partners zurück – ohne Preise
router.get('/verkaeufe', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partnerId } = await resolvePartner(token);

    const sheetId = process.env.BUSINESS_SHEET_ID;
    const sheets  = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Verkäufe');
    const h = col => header.indexOf(col);

    res.json(rows
      .filter(r => r[h('Partner-ID')] === partnerId && r[h('Status')] !== 'abgerechnet')
      .map(r => ({
        orderId:     r[h('Order-ID')]    ?? '',
        artikelname: r[h('Artikelnummer')] ?? '',
        stueckzahl:  parseInt(r[h('Stückzahl')] ?? '1', 10),
        datum:       r[h('Datum')]       ?? '',
        status:      r[h('Status')]      ?? '',
      })));
  } catch (err) { next(err); }
});

// ── GET /api/partner/abrechnungen?token= ─────────────────────────────────────
router.get('/abrechnungen', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partnerId } = await resolvePartner(token);

    const sheetId = process.env.BUSINESS_SHEET_ID;
    const sheets  = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Abrechnungen');
    const h = col => header.indexOf(col);

    res.json(rows
      .filter(r => r[h('Partner-ID')] === partnerId)
      .map(r => ({
        zeitraumVon: r[h('Zeitraum-Von')] ?? '',
        zeitraumBis: r[h('Zeitraum-Bis')] ?? '',
        saldo:       parseFloat(r[h('Saldo')] ?? '0'),
        status:      r[h('Status')]        ?? '',
      })));
  } catch (err) { next(err); }
});

export default router;
