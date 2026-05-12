import { Router } from 'express';
import { google } from 'googleapis';
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { berechnePartnerAnteil, parseKonfiguration } from '../utils/partner-kalkulation.js';

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

// Robustes parseFloat: behandelt Komma als Dezimaltrennzeichen (DE-Format aus Sheet).
function toFloat(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = parseFloat(val.toString().replace(',', '.'));
  return Number.isNaN(n) ? fallback : n;
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
// Lookup via Partner_Artikel (Produkt-ID → Partner-ID), kein Kategorie-Lookup.
// ?after=ISO-DATUM optional; ohne Parameter: auto-detect aus neuestem Eintrag.
router.get('/verkaeufe/sync', async (req, res, next) => {
  if (req.headers['x-api-key'] !== process.env.MC_API_KEY)
    return res.status(401).json({ error: 'Unauthorized.' });

  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });

    const sheets = await getSheets();

    // 1a. Partner_Artikel laden → Map: productId → [{ partnerId, lizenzProzent, ek, druck, versandart }]
    const { header: aH, rows: aRows } = await readTab(sheets, sheetId, 'Partner_Artikel');
    const ah = col => aH.indexOf(col);
    const partnerArtikelMap = {};
    for (const r of aRows) {
      const pid        = (r[ah('Produkt-ID')] ?? '').toString().trim();
      const partnerId  = r[ah('Partner-ID')] ?? '';
      const lizenzProzent = toFloat(r[ah('Lizenz-%')]);
      const ekPreis     = toFloat(r[ah('EK-Preis-Netto')]);
      const druckkosten = toFloat(r[ah('Druckkosten')]);
      const versandart  = ((r[ah('Versandart')] ?? 'P').toString().toUpperCase() === 'B') ? 'B' : 'P';
      if (!pid || !partnerId) continue;
      if (!partnerArtikelMap[pid]) partnerArtikelMap[pid] = [];
      partnerArtikelMap[pid].push({ partnerId, lizenzProzent, ekPreis, druckkosten, versandart });
    }

    if (!Object.keys(partnerArtikelMap).length)
      return res.json({ synced: 0, orders: 0, message: 'Partner_Artikel ist leer – bitte zuerst Artikel importieren.' });

    // 1b. Partner → Porto-Modell-Map
    const { header: pH, rows: pRows } = await readTab(sheets, sheetId, 'Partner');
    const ph = col => pH.indexOf(col);
    const partnerInfoMap = {};
    for (const r of pRows) {
      const id = r[ph('Partner-ID')] ?? '';
      if (id) partnerInfoMap[id] = {
        portoModell: r[ph('Porto-Modell')] ?? 'geteilt-50-50',
      };
    }

    // 1c. Konfiguration aus Kalkulation_Fixkosten
    const { header: kH, rows: kRows } = await readTab(sheets, sheetId, 'Kalkulation_Fixkosten');
    const konfiguration = parseKonfiguration(kRows, kH);

    // 2. Partner_Verkäufe laden → Duplikat-Set + neuestes Datum für after-Parameter
    const { header: vH, rows: vRows } = await readTab(sheets, sheetId, 'Partner_Verkäufe');
    const vh = col => vH.indexOf(col);
    const existingKeys = new Set(
      vRows.map(r => `${r[vh('Order-ID')] ?? ''}|${r[vh('Artikelnummer')] ?? ''}|${r[vh('Partner-ID')] ?? ''}`)
    );

    // after-Parameter: explizit übergeben oder auto-detect aus neuestem Eintrag
    let afterParam = req.query.after || null;
    if (!afterParam && vRows.length) {
      const datIdx = vh('Datum');
      let newest = null;
      for (const r of vRows) {
        const d = parseDate(r[datIdx] ?? '');
        if (d && (!newest || d > newest)) newest = d;
      }
      if (newest) afterParam = newest.toISOString().slice(0, 19);
    }

    // 3. WC Bestellungen laden (mit optionalem after-Filter)
    const wc = getWcClient();
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

    // 4. Order-Items → Partner_Artikel-Lookup → Helper berechnePartnerAnteil
    const toWrite = [];
    const artikelName = (item) => item.name || item.sku || String(item.product_id);

    const mwstFaktor = 1 + (konfiguration.mwstProzent || 0) / 100;

    for (const order of orders) {
      const orderDate     = toDE(new Date(order.date_created));
      // WC liefert shipping_total und item.total netto → brutto erst hier hochrechnen.
      const shippingNetto = toFloat(order.shipping_total);
      const shippingBrutto = shippingNetto * mwstFaktor;
      const orderNetto    = order.line_items.reduce((s, i) => s + toFloat(i.total), 0);

      // Matching-Items + Versandart der Bestellung bestimmen:
      // wenn mindestens ein matchender Artikel "P" hat → ganze Bestellung gilt als "P".
      const matching = [];
      let orderVersandart = 'B';
      for (const item of order.line_items) {
        const entries = partnerArtikelMap[String(item.product_id || '')];
        if (!entries) continue;
        matching.push({ item, entries });
        if (entries.some(e => e.versandart === 'P')) orderVersandart = 'P';
      }
      if (!matching.length) continue;

      for (const { item, entries } of matching) {
        const itemNetto  = toFloat(item.total);
        const itemBrutto = itemNetto * mwstFaktor;
        const anteil     = orderNetto > 0 ? (itemNetto / orderNetto) : 0;
        const portoEinnahmeAnteil = shippingBrutto * anteil;
        const artKey = artikelName(item);

        for (const e of entries) {
          const key = `${order.id}|${artKey}|${e.partnerId}`;
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);

          const calc = berechnePartnerAnteil({
            vkBrutto:           itemBrutto,
            ekPreis:            e.ekPreis,
            druckkosten:        e.druckkosten,
            versandart:         orderVersandart,
            portoModell:        partnerInfoMap[e.partnerId]?.portoModell ?? 'geteilt-50-50',
            bestellungsAnteil:  anteil,
            lizenzProzent:      e.lizenzProzent,
            portoEinnahmeAnteil,
            konfiguration,
          });

          toWrite.push([
            e.partnerId, orderDate, String(order.id),
            artKey, item.sku || '', String(item.quantity),
            itemBrutto.toFixed(2), calc.partnerAnteil, 'offen',
          ]);
        }
      }
    }

    // 5. Batch-Append ins Sheet
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
      synced:     toWrite.length,
      orders:     orders.length,
      afterParam: afterParam || null,
      message:    toWrite.length
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

// ── GET /api/partner/intern?token= ───────────────────────────────────────────
// Direkte Bestellungen für die Partner-Sicht – mit Preisen (eigene Kosten).
router.get('/intern', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partnerId } = await resolvePartner(token);

    const sheetId = process.env.BUSINESS_SHEET_ID;
    const sheets  = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Interne_Bestellungen');
    const h = col => header.indexOf(col);

    res.json(rows
      .filter(r => r[h('Partner-ID')] === partnerId)
      .map(r => ({
        datum:       r[h('Datum')]       ?? '',
        bezeichnung: r[h('Bezeichnung')] ?? '',
        anzahl:      toFloat(r[h('Anzahl')]),
        einzelpreis: toFloat(r[h('Einzelpreis')]),
        summe:       toFloat(r[h('Summe')]),
        status:      r[h('Status')]      ?? '',
      })));
  } catch (err) { next(err); }
});

// ── GET /api/partner/saldo?token= ────────────────────────────────────────────
// Aggregierte offene Posten: Lizenz-Summe − Interne-Summe = Saldo.
router.get('/saldo', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partnerId } = await resolvePartner(token);

    const sheetId = process.env.BUSINESS_SHEET_ID;
    const sheets  = await getSheets();
    const [verkäufeTab, internTab] = await Promise.all([
      readTab(sheets, sheetId, 'Partner_Verkäufe'),
      readTab(sheets, sheetId, 'Partner_Interne_Bestellungen'),
    ]);

    const vh = col => verkäufeTab.header.indexOf(col);
    const lizenzSumme = verkäufeTab.rows
      .filter(r => r[vh('Partner-ID')] === partnerId && (r[vh('Status')] ?? '') === 'offen')
      .reduce((s, r) => s + toFloat(r[vh('Lizenzgebühr')]), 0);

    const ih = col => internTab.header.indexOf(col);
    const interneSumme = internTab.rows
      .filter(r => r[ih('Partner-ID')] === partnerId && (r[ih('Status')] ?? '') === 'offen')
      .reduce((s, r) => s + toFloat(r[ih('Summe')]), 0);

    const saldo = lizenzSumme - interneSumme;
    res.json({
      lizenzSumme:  parseFloat(lizenzSumme.toFixed(2)),
      interneSumme: parseFloat(interneSumme.toFixed(2)),
      saldo:        parseFloat(saldo.toFixed(2)),
    });
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
        saldo:       toFloat(r[h('Saldo')]),
        status:      r[h('Status')]        ?? '',
      })));
  } catch (err) { next(err); }
});

export default router;
