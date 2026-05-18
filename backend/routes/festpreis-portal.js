// ── Festpreis-Portal – Sprint 5.5 ────────────────────────────────────────────
// Alle Endpunkte hinter requireApiKey (registriert in index.js).

import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient } from '../lib/shopConfig.js';
import { berechneFestpreisAnteil } from '../utils/festpreis-kalkulation.js';
import { parseKonfiguration } from '../utils/partner-kalkulation.js';

const router = Router();

const SHEETID = () => process.env.BUSINESS_SHEET_ID;

const TAB_FP_PARTNER       = 'FP_Partner';
const TAB_FP_ARTIKEL       = 'FP_Artikel';
const TAB_FP_VERKAEUFE     = 'FP_Verkäufe';
const TAB_FP_ABRECHNUNGEN  = 'FP_Abrechnungen';
const TAB_FIXKOSTEN        = 'Kalkulation_Fixkosten';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getSheets() {
  const auth = await getGoogleAuth();
  return google.sheets({ version: 'v4', auth });
}

async function readTab(sheets, sheetId, tabName) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${tabName}!A1:Z`,
  });
  const [header, ...rows] = data.values ?? [];
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}

function toFloat(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = parseFloat(val.toString().replace(',', '.'));
  return Number.isNaN(n) ? fallback : n;
}

function toDE(date) {
  const d = new Date(date);
  return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${d.getUTCFullYear()}`;
}

function parseDate(str) {
  if (!str) return null;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    const [dd, mm, yyyy] = str.split('.');
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function rowToObj(header, row) {
  const obj = {};
  header.forEach((h, i) => { obj[h] = row[i] ?? ''; });
  return obj;
}

// ── GET /api/festpreis/partner ───────────────────────────────────────────────
router.get('/partner', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);
    const partner = rows.map(r => rowToObj(header, r));
    res.json({ partner });
  } catch (err) { next(err); }
});

// ── POST /api/festpreis/partner ──────────────────────────────────────────────
router.post('/partner', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { name, shop, aktiv = 'Ja', notiz = '' } = req.body;
    if (!name) return res.status(400).json({ error: 'name ist erforderlich.' });
    const cleanShop = (shop ?? '').toLowerCase() === 'honk' ? 'honk' : 'jfn';

    const sheets = await getSheets();
    const { rows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);

    const maxId = rows.reduce((max, r) => {
      const m = String(r[0] ?? '').match(/^FP-?(\d+)$/i);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    const partnerId = `FP-${String(maxId + 1).padStart(3, '0')}`;

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${TAB_FP_PARTNER}!A:E`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[partnerId, name, cleanShop, aktiv, notiz]] },
    });
    res.status(201).json({ partnerId, name, shop: cleanShop });
  } catch (err) { next(err); }
});

// ── GET /api/festpreis/artikel/:partnerId ────────────────────────────────────
router.get('/artikel/:partnerId', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_ARTIKEL);
    const pidCol = header.indexOf('Partner-ID');
    const filtered = rows
      .filter(r => (r[pidCol] ?? '') === req.params.partnerId)
      .map(r => rowToObj(header, r));
    res.json({ artikel: filtered });
  } catch (err) { next(err); }
});

// ── PATCH /api/festpreis/artikel/:partnerId/:produktId ───────────────────────
// Body: { festpreisEK, handlingGebuehr, versandart }
router.patch('/artikel/:partnerId/:produktId', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { partnerId, produktId } = req.params;
    const { festpreisEK, handlingGebuehr, versandart } = req.body;

    const sheets = await getSheets();
    const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties' });
    const sheetMeta = (meta.sheets ?? []).find(s => s.properties.title === TAB_FP_ARTIKEL);
    if (!sheetMeta) return res.status(404).json({ error: 'FP_Artikel Sheet nicht gefunden.' });
    const sheetId2 = sheetMeta.properties.sheetId;

    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_ARTIKEL);
    const pidIdx  = header.indexOf('Partner-ID');
    const prodIdx = header.indexOf('Produkt-ID');
    const ekIdx   = header.indexOf('Festpreis-EK-Netto');
    const hgIdx   = header.indexOf('Handling-Gebühr');
    const vaIdx   = header.indexOf('Versandart');

    const rowIdx = rows.findIndex(r =>
      (r[pidIdx] ?? '') === partnerId && String(r[prodIdx] ?? '') === String(produktId)
    );
    if (rowIdx === -1) return res.status(404).json({ error: 'Artikel nicht gefunden.' });

    const sheetRow = rowIdx + 2; // +1 header, +1 1-based
    const updates = [];
    const colLetter = i => String.fromCharCode(65 + i);
    if (ekIdx !== -1 && festpreisEK !== undefined) updates.push({ range: `${TAB_FP_ARTIKEL}!${colLetter(ekIdx)}${sheetRow}`, values: [[Number(festpreisEK)]] });
    if (hgIdx !== -1 && handlingGebuehr !== undefined) updates.push({ range: `${TAB_FP_ARTIKEL}!${colLetter(hgIdx)}${sheetRow}`, values: [[Number(handlingGebuehr)]] });
    if (vaIdx !== -1 && versandart !== undefined) updates.push({ range: `${TAB_FP_ARTIKEL}!${colLetter(vaIdx)}${sheetRow}`, values: [[String(versandart).toUpperCase() === 'B' ? 'B' : 'P']] });

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'RAW', data: updates },
      });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/festpreis/artikel/:partnerId/import ────────────────────────────
// Body: { shop, kategorie }  (kategorie = WC category name/slug, optional)
router.post('/artikel/:partnerId/import', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { partnerId } = req.params;
    const { shop = 'jfn', kategorie } = req.body;

    const sheets = await getSheets();

    // Vorhandene Produkt-IDs dieses Partners ermitteln (Dedup)
    const { header: aH, rows: aRows } = await readTab(sheets, sheetId, TAB_FP_ARTIKEL);
    const pidCol = aH.indexOf('Partner-ID');
    const prodIdCol = aH.indexOf('Produkt-ID');
    const existingIds = new Set(
      aRows.filter(r => (r[pidCol] ?? '') === partnerId).map(r => String(r[prodIdCol] ?? ''))
    );

    const wc = getWcClient(shop);
    const products = [];
    for (let page = 1; ; page++) {
      const params = { status: 'publish', per_page: 100, page };
      if (kategorie) params.category = kategorie;
      const { data } = await wc.get('products', params);
      products.push(...data);
      if (data.length < 100) break;
    }

    const toWrite = products
      .filter(p => !existingIds.has(String(p.id)))
      .map(p => [
        partnerId,
        String(p.id),
        p.name || '',
        0,   // Festpreis-EK-Netto
        0,   // Handling-Gebühr
        'P', // Versandart
        (p.categories?.[0]?.name) || '',
      ]);

    if (toWrite.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${TAB_FP_ARTIKEL}!A:G`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: toWrite },
      });
    }

    res.json({ imported: toWrite.length, total: products.length });
  } catch (err) { next(err); }
});

// ── GET /api/festpreis/verkaeufe ─────────────────────────────────────────────
router.get('/verkaeufe', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { partnerId, status } = req.query;
    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_VERKAEUFE);
    const pidIdx    = header.indexOf('Partner-ID');
    const statusIdx = header.indexOf('Status Abrechnung');
    let filtered = rows;
    if (partnerId) filtered = filtered.filter(r => (r[pidIdx] ?? '') === partnerId);
    if (status)    filtered = filtered.filter(r => (r[statusIdx] ?? '').toLowerCase() === status.toLowerCase());
    res.json({ verkaeufe: filtered.map(r => rowToObj(header, r)) });
  } catch (err) { next(err); }
});

// ── POST /api/festpreis/verkaeufe/sync ───────────────────────────────────────
router.post('/verkaeufe/sync', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { after } = req.body;

    const sheets = await getSheets();

    // 1. Alle aktiven FP-Partner laden
    const { header: pH, rows: pRows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);
    const ph = col => pH.indexOf(col);
    const activePartners = pRows.filter(r =>
      (r[ph('Aktiv')] ?? '').toLowerCase() === 'ja'
    );
    if (!activePartners.length)
      return res.json({ synced: 0, orders: 0, message: 'Keine aktiven FP-Partner gefunden.' });

    // 2. FP_Artikel → Map: produktId → [{ partnerId, festpreisEK, handlingGebuehr, versandart }]
    const { header: aH, rows: aRows } = await readTab(sheets, sheetId, TAB_FP_ARTIKEL);
    const ah = col => aH.indexOf(col);
    const activePartnerIds = new Set(activePartners.map(r => r[ph('Partner-ID')] ?? ''));

    const artikelMap = {};
    for (const r of aRows) {
      const pid = r[ah('Partner-ID')] ?? '';
      if (!activePartnerIds.has(pid)) continue;
      const produktId = String(r[ah('Produkt-ID')] ?? '').trim();
      if (!produktId) continue;
      if (!artikelMap[produktId]) artikelMap[produktId] = [];
      artikelMap[produktId].push({
        partnerId:      pid,
        festpreisEK:    toFloat(r[ah('Festpreis-EK-Netto')]),
        handlingGebuehr: toFloat(r[ah('Handling-Gebühr')]),
        versandart:     ((r[ah('Versandart')] ?? 'P').toUpperCase() === 'B') ? 'B' : 'P',
      });
    }
    if (!Object.keys(artikelMap).length)
      return res.json({ synced: 0, orders: 0, message: 'Keine FP-Artikel konfiguriert.' });

    // 3. Partner-Shop-Map für WC-Credentials
    const partnerShopMap = {};
    for (const r of activePartners) {
      const pid  = r[ph('Partner-ID')] ?? '';
      const shop = (r[ph('Shop')] ?? '').toLowerCase() === 'honk' ? 'honk' : 'jfn';
      partnerShopMap[pid] = shop;
    }

    // 4. Kalkulation_Fixkosten für Porto + PayPal-Kosten
    const { header: kH, rows: kRows } = await readTab(sheets, sheetId, TAB_FIXKOSTEN);
    const konfiguration = parseKonfiguration(kRows, kH);
    const k = konfiguration;

    // 5. FP_Verkäufe → Duplikat-Set + neuestes Datum
    const { header: vH, rows: vRows } = await readTab(sheets, sheetId, TAB_FP_VERKAEUFE);
    const vh = col => vH.indexOf(col);
    const varKey = v => (v === '' || v === null || v === undefined) ? '0' : String(v);
    const existingKeys = new Set(
      vRows.map(r => `${r[vh('WC-Bestellnummer')] ?? ''}|${r[vh('Artikelname')] ?? ''}|${varKey(r[vh('Variante')])}|${r[vh('Partner-ID')] ?? ''}`)
    );

    let afterParam = after || null;
    if (!afterParam && vRows.length) {
      let newest = null;
      for (const r of vRows) {
        const d = parseDate(r[vh('Datum')] ?? '');
        if (d && (!newest || d > newest)) newest = d;
      }
      if (newest) afterParam = newest.toISOString().slice(0, 19);
    }

    // 6. WC Bestellungen laden (jfn + ggf. honk separat)
    const shopsNeeded = new Set(Object.values(partnerShopMap));
    const ordersByShop = {};
    for (const shop of shopsNeeded) {
      const wc = getWcClient(shop);
      const orders = [];
      for (let page = 1; ; page++) {
        const params = { per_page: 100, page };
        if (afterParam) params.after = afterParam;
        const [proc, compl] = await Promise.all([
          wc.get('orders', { ...params, status: 'processing' }),
          wc.get('orders', { ...params, status: 'completed'  }),
        ]);
        orders.push(...proc.data, ...compl.data);
        if (proc.data.length < 100 && compl.data.length < 100) break;
      }
      ordersByShop[shop] = orders;
    }

    // 7. Zeilen berechnen
    const toWrite = [];

    for (const [shop, orders] of Object.entries(ordersByShop)) {
      for (const order of orders) {
        const orderDate     = toDE(new Date(order.date_created));
        const shippingNetto = toFloat(order.shipping_total);
        const orderNetto    = order.line_items.reduce((s, i) => s + toFloat(i.total), 0);

        for (const item of order.line_items) {
          const entries = artikelMap[String(item.product_id || '')];
          if (!entries) continue;

          const itemNetto  = toFloat(item.total);
          const anteil     = orderNetto > 0 ? (itemNetto / orderNetto) : 0;
          const portoEinnahmeAnteil = shippingNetto * anteil;
          const artikelname = item.name || item.sku || String(item.product_id);
          const variationId = String(item.variation_id || 0);

          for (const e of entries) {
            if (partnerShopMap[e.partnerId] !== shop) continue;
            const key = `${order.id}|${artikelname}|${variationId}|${e.partnerId}`;
            if (existingKeys.has(key)) continue;
            existingKeys.add(key);

            const va = e.versandart;
            const portoKostenAnteil  = (va === 'B' ? k.portoB : k.portoP) * anteil;
            const versandnkAnteil    = (va === 'B' ? k.versandnebenkostenB : k.versandnebenkostenP) * anteil;
            const paypalKosten       = (itemNetto * k.paypalProzent / 100) + (k.paypalPauschale * anteil);

            const { netto, brutto } = berechneFestpreisAnteil({
              festpreisEK: e.festpreisEK,
              handlingGebuehr: e.handlingGebuehr,
              portoEinnahmeAnteil,
              portoKostenAnteil,
              versandnkAnteil,
              paypalKosten,
              mwstProzent: k.mwstProzent,
            });

            toWrite.push([
              e.partnerId,
              orderDate,
              order.id,
              artikelname,
              item.variation_id || 0,
              item.quantity,
              e.festpreisEK,
              e.handlingGebuehr,
              Math.round(portoEinnahmeAnteil * 100) / 100,
              Math.round(portoKostenAnteil * 100) / 100,
              Math.round(versandnkAnteil * 100) / 100,
              Math.round(paypalKosten * 100) / 100,
              netto,
              brutto,
              'offen',
              item.product_id,
            ]);
          }
        }
      }
    }

    if (toWrite.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${TAB_FP_VERKAEUFE}!A:P`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: toWrite },
      });
    }

    const totalOrders = Object.values(ordersByShop).reduce((s, o) => s + o.length, 0);
    res.json({
      synced: toWrite.length,
      orders: totalOrders,
      afterParam: afterParam || null,
      message: toWrite.length
        ? `${toWrite.length} neue Einträge aus ${totalOrders} Bestellungen synchronisiert.`
        : 'Alle Einträge bereits vorhanden – nichts Neues.',
    });
  } catch (err) { next(err); }
});

// ── GET /api/festpreis/abrechnungen ──────────────────────────────────────────
router.get('/abrechnungen', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { partnerId } = req.query;
    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_ABRECHNUNGEN);
    const pidIdx = header.indexOf('Partner-ID');
    let filtered = rows;
    if (partnerId) filtered = filtered.filter(r => (r[pidIdx] ?? '') === partnerId);
    res.json({ abrechnungen: filtered.map(r => rowToObj(header, r)) });
  } catch (err) { next(err); }
});

// ── POST /api/festpreis/abrechnungen ─────────────────────────────────────────
// Body: { partnerId, vonDatum, bisDatum }  (dd.mm.yyyy)
router.post('/abrechnungen', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { partnerId, vonDatum, bisDatum } = req.body;
    if (!partnerId || !vonDatum || !bisDatum)
      return res.status(400).json({ error: 'partnerId, vonDatum und bisDatum sind erforderlich.' });

    const sheets = await getSheets();

    // FP_Verkäufe: alle offenen Einträge des Partners im Zeitraum summieren
    const { header: vH, rows: vRows } = await readTab(sheets, sheetId, TAB_FP_VERKAEUFE);
    const vh = col => vH.indexOf(col);
    const von = parseDate(vonDatum);
    const bis = parseDate(bisDatum);

    const offene = vRows.filter(r => {
      if ((r[vh('Partner-ID')] ?? '') !== partnerId) return false;
      if ((r[vh('Status Abrechnung')] ?? '').toLowerCase() !== 'offen') return false;
      const d = parseDate(r[vh('Datum')] ?? '');
      return d && d >= von && d <= bis;
    });

    if (!offene.length)
      return res.status(400).json({ error: 'Keine offenen Einträge im angegebenen Zeitraum.' });

    const gesamtNetto  = Math.round(offene.reduce((s, r) => s + toFloat(r[vh('Gesamt-Partner-Netto')]), 0) * 100) / 100;
    const gesamtBrutto = Math.round(offene.reduce((s, r) => s + toFloat(r[vh('Gesamt-Partner-Brutto')]), 0) * 100) / 100;

    // Abrechnungs-ID generieren
    const { header: abH, rows: abRows } = await readTab(sheets, sheetId, TAB_FP_ABRECHNUNGEN);
    const maxAbNr = abRows.reduce((max, r) => {
      const m = String(r[0] ?? '').match(/^FPA-(\d+)$/i);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    const abrechnungsId = `FPA-${String(maxAbNr + 1).padStart(4, '0')}`;
    const erstelltAm = toDE(new Date());

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${TAB_FP_ABRECHNUNGEN}!A:H`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[abrechnungsId, partnerId, vonDatum, bisDatum, gesamtNetto, gesamtBrutto, 'entwurf', erstelltAm]] },
    });

    // Zugehörige FP_Verkäufe auf 'abgerechnet' setzen
    const allRows = (await readTab(sheets, sheetId, TAB_FP_VERKAEUFE)).rows;
    const statusColLetter = String.fromCharCode(65 + vh('Status Abrechnung'));
    const updates = [];
    allRows.forEach((r, i) => {
      if (offene.includes(vRows[i])) {
        updates.push({ range: `${TAB_FP_VERKAEUFE}!${statusColLetter}${i + 2}`, values: [['abgerechnet']] });
      }
    });

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'RAW', data: updates },
      });
    }

    res.status(201).json({ abrechnungsId, partnerId, gesamtNetto, gesamtBrutto, positionen: offene.length });
  } catch (err) { next(err); }
});

export default router;
