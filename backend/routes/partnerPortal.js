import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient as wcClientForShop, getShopConfig } from '../lib/shopConfig.js';
import { berechnePartnerAnteil, parseKonfiguration } from '../utils/partner-kalkulation.js';

const router = Router();

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

function getSheets() {
  return getGoogleAuth().then(auth => google.sheets({ version: 'v4', auth }));
}

const getWcClient = (shop) => wcClientForShop(shop);

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

function parseDate(s) {
  if (!s) return null;
  const [d, m, y] = s.split('.');
  if (!d || !m || !y) return null;
  const dt = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// WC-Status für NEUE Einträge. refunded/cancelled/failed/trash werden NICHT
// als Verkauf erfasst; refunded/cancelled lösen stattdessen Storno-Gegeneinträge aus.
const WC_STATES_VERKAUF = ['processing', 'completed', 'on-hold'];
const WC_STATES_STORNO  = ['refunded', 'cancelled'];
const STORNO_MARKER     = 'Storniert/Rückerstattet';

function buildSyncMessage(neu, storniert) {
  if (!neu && !storniert) return 'Alle Einträge bereits vorhanden – nichts Neues.';
  const parts = [];
  if (neu)       parts.push(`${neu} neue`);
  if (storniert) parts.push(`${storniert} stornierte`);
  return `${parts.join(' + ')} Einträge synchronisiert.`;
}

// Lädt WC-Bestellungen für mehrere Status paginiert. afterParam optional (ISO).
async function fetchOrders(wc, statuses, afterParam) {
  const all = [];
  for (let page = 1; ; page++) {
    const results = await Promise.all(statuses.map(status => {
      const params = { per_page: 100, page, status };
      if (afterParam) params.after = afterParam;
      return wc.get('orders', params);
    }));
    for (const r of results) all.push(...r.data);
    if (results.every(r => r.data.length < 100)) break;
  }
  return all;
}

// Erzeugt negative Gegeneinträge für bestehende Verkaufs-Zeilen, deren Order in WC
// auf refunded/cancelled steht. Der Originaleintrag bleibt unverändert; der
// Gegeneintrag bekommt Status 'offen' (Spalte I) → fließt negativ in Saldo/Abrechnung,
// sowie den Storno-Marker in Spalte O. Spalten-Layout fix (identisch zum Append A:N).
function buildStornoRows(vRows, vh, stornoOrders, partnerFilter) {
  const ordIdx = vh('Order-ID');
  const artIdx = vh('Artikelnummer');
  const varIdx = vh('Variante');
  const pIdx   = vh('Partner-ID');
  const varKey = v => (v === '' || v === null || v === undefined) ? '0' : String(v);

  // Order-ID → Storno-Datum (Zeitpunkt der Rückerstattung/Stornierung)
  const refundDate = new Map(
    stornoOrders.map(o => [String(o.id), toDE(new Date(o.date_modified || o.date_created))])
  );

  // Fixe Spalten-Positionen (so wie beim Append A:N geschrieben)
  const NEG_COLS   = [5, 6, 7, 10, 11, 12, 13]; // Stückzahl, VK, Lizenz, gewinn, lizenzAnteil, portoSaldo, brutto
  const STATUS_COL = 8;   // I
  const DATE_COL   = 1;   // B
  const STORNO_COL = 14;  // O

  // Bereits stornierte Kombinationen (Spalte O gesetzt) nicht doppelt anlegen
  const stornoDone = new Set();
  for (const r of vRows) {
    if ((r[STORNO_COL] ?? '') !== '')
      stornoDone.add(`${r[ordIdx]}|${r[artIdx]}|${varKey(r[varIdx])}|${r[pIdx]}`);
  }

  const out = [];
  for (const r of vRows) {
    const oid = String(r[ordIdx] ?? '');
    if (!refundDate.has(oid)) continue;          // Order nicht refunded/cancelled
    if ((r[STORNO_COL] ?? '') !== '') continue;  // Zeile ist selbst ein Gegeneintrag
    if (partnerFilter && !partnerFilter.has(r[pIdx])) continue;

    const dupKey = `${r[ordIdx]}|${r[artIdx]}|${varKey(r[varIdx])}|${r[pIdx]}`;
    if (stornoDone.has(dupKey)) continue;        // Gegeneintrag existiert bereits
    stornoDone.add(dupKey);

    const counter = [];
    for (let i = 0; i < 14; i++) {
      let v = r[i] ?? '';
      if (NEG_COLS.includes(i) && v !== '' && v !== null) v = -toFloat(v);
      counter[i] = v;
    }
    counter[DATE_COL]   = refundDate.get(oid) || r[DATE_COL] || toDE(new Date());
    counter[STATUS_COL] = 'offen';
    counter[STORNO_COL] = STORNO_MARKER;
    out.push(counter);
  }
  return out;
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

// ── Sync-Kern (wiederverwendbar für /sync und /sync-all) ─────────────────────
// opts.after          – ISO-Datum (z.B. '2026-05-01T00:00:00') als WC after-Filter
// opts.partnerFilter  – Set<Partner-ID>, wenn gesetzt: nur diese Partner berücksichtigen
// opts.shop           – 'jfn' (Default) oder 'honk' – bestimmt WC-Credentials + Sheet-Tab
async function runVerkaeufeSync(sheets, sheetId, opts = {}) {
  const { after, partnerFilter, shop } = opts;
  const shopCfg = getShopConfig(shop);
  const TAB_VERKAEUFE = shopCfg.tabVerkaeufe;

  // HonkShop: kein Partner_Artikel Lookup – alle Items gehen an den einzigen honk-Partner.
  if (shop === 'honk') {
    const { header: pH, rows: pRows } = await readTab(sheets, sheetId, 'Partner');
    const ph = col => pH.indexOf(col);
    const shopCol = ph('Shop');
    const honkRow = pRows.find(r =>
      (shopCol !== -1 ? (r[shopCol] ?? '') : '').toLowerCase().trim() === 'honk' &&
      (r[ph('Aktiv')] ?? '').toLowerCase() === 'ja'
    );
    if (!honkRow) return { synced: 0, orders: 0, afterParam: null, message: 'Kein aktiver HonkShop-Partner gefunden.' };

    const honkPartnerId  = honkRow[ph('Partner-ID')] ?? '';
    const lizenzProzent  = toFloat(honkRow[ph('Lizenz-%')]);
    const portoModell    = honkRow[ph('Porto-Modell')] ?? 'geteilt-50-50';

    const { header: kH, rows: kRows } = await readTab(sheets, sheetId, 'Kalkulation_Fixkosten');
    const konfiguration = parseKonfiguration(kRows, kH);

    const { header: vH, rows: vRows } = await readTab(sheets, sheetId, TAB_VERKAEUFE);
    const vh = col => vH.indexOf(col);
    const varKey = v => (v === '' || v === null || v === undefined) ? '0' : String(v);
    const existingKeys = new Set(
      vRows.map(r => `${r[vh('Order-ID')] ?? ''}|${r[vh('Artikelnummer')] ?? ''}|${varKey(r[vh('Variante')])}|${r[vh('Partner-ID')] ?? ''}`)
    );

    let afterParam = after || null;
    if (!afterParam && vRows.length) {
      const datIdx = vh('Datum');
      let newest = null;
      for (const r of vRows) {
        const d = parseDate(r[datIdx] ?? '');
        if (d && (!newest || d > newest)) newest = d;
      }
      if (newest) afterParam = newest.toISOString().slice(0, 19);
    }

    const wc = getWcClient(shop);
    const orders = await fetchOrders(wc, WC_STATES_VERKAUF, afterParam);
    // Stornos voll-historisch (ohne after-Filter) – fängt auch ältere Refunds.
    const stornoOrders = await fetchOrders(wc, WC_STATES_STORNO, null);

    const toWrite = [];
    const artikelName = item => item.name || item.sku || String(item.product_id);
    for (const order of orders) {
      const orderDate = toDE(new Date(order.date_created));
      const shippingNetto = toFloat(order.shipping_total);
      const orderNetto = order.line_items.reduce((s, i) => s + toFloat(i.total), 0);

      for (const item of order.line_items) {
        const itemNetto = toFloat(item.total);
        const anteil = orderNetto > 0 ? (itemNetto / orderNetto) : 0;
        const portoEinnahmeAnteil = shippingNetto * anteil;
        const artKey = artikelName(item);
        const variationId = String(item.variation_id || 0);
        const key = `${order.id}|${artKey}|${variationId}|${honkPartnerId}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);

        const calc = berechnePartnerAnteil({
          vkNetto: itemNetto, ekPreis: 0, druckkosten: 0, versandart: 'P',
          portoModell, bestellungsAnteil: anteil, lizenzProzent, portoEinnahmeAnteil, konfiguration,
        });
        const lizenzAnteilVomGewinn = calc.gewinnNetto * (lizenzProzent || 0) / 100;
        toWrite.push([
          honkPartnerId, orderDate, order.id,
          artKey, item.variation_id || 0, item.quantity,
          itemNetto, calc.partnerAnteil, 'offen',
          item.product_id, calc.gewinnNetto, lizenzAnteilVomGewinn, calc.portoSaldoPartner, calc.brutto,
        ]);
      }
    }

    const stornoRows = buildStornoRows(vRows, vh, stornoOrders, null);
    const allRows = [...toWrite, ...stornoRows];
    if (allRows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${TAB_VERKAEUFE}!A:O`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: allRows },
      });
    }

    return {
      synced: toWrite.length, storniert: stornoRows.length, orders: orders.length, afterParam: afterParam || null,
      message: buildSyncMessage(toWrite.length, stornoRows.length),
    };
  }

  // JFN: Partner_Artikel Lookup → Map: productId → [{ partnerId, lizenzProzent, ek, druck, versandart }]
  const { header: aH, rows: aRows } = await readTab(sheets, sheetId, 'Partner_Artikel');
  const ah = col => aH.indexOf(col);
  const partnerArtikelMap = {};
  for (const r of aRows) {
    const partnerId  = r[ah('Partner-ID')] ?? '';
    if (partnerFilter && !partnerFilter.has(partnerId)) continue;
    const pid        = (r[ah('Produkt-ID')] ?? '').toString().trim();
    const lizenzProzent = toFloat(r[ah('Lizenz-%')]);
    const ekPreis     = toFloat(r[ah('EK-Preis-Netto')]);
    const druckkosten = toFloat(r[ah('Druckkosten')]);
    const versandart  = ((r[ah('Versandart')] ?? 'P').toString().toUpperCase() === 'B') ? 'B' : 'P';
    if (!pid || !partnerId) continue;
    if (!partnerArtikelMap[pid]) partnerArtikelMap[pid] = [];
    partnerArtikelMap[pid].push({ partnerId, lizenzProzent, ekPreis, druckkosten, versandart });
  }

  if (!Object.keys(partnerArtikelMap).length)
    return { synced: 0, orders: 0, afterParam: null, message: 'Keine passenden Partner-Artikel.' };

  // 1b. Partner → Porto-Modell
  const { header: pH, rows: pRows } = await readTab(sheets, sheetId, 'Partner');
  const ph = col => pH.indexOf(col);
  const partnerInfoMap = {};
  for (const r of pRows) {
    const id = r[ph('Partner-ID')] ?? '';
    if (id) partnerInfoMap[id] = { portoModell: r[ph('Porto-Modell')] ?? 'geteilt-50-50' };
  }

  // 1c. Konfiguration
  const { header: kH, rows: kRows } = await readTab(sheets, sheetId, 'Kalkulation_Fixkosten');
  const konfiguration = parseKonfiguration(kRows, kH);

  // 2. Partner_Verkäufe → Duplikat-Set + neuestes Datum (shop-spezifischer Tab)
  const { header: vH, rows: vRows } = await readTab(sheets, sheetId, TAB_VERKAEUFE);
  const vh = col => vH.indexOf(col);
  const varKey = v => (v === '' || v === null || v === undefined) ? '0' : String(v);
  const existingKeys = new Set(
    vRows.map(r => `${r[vh('Order-ID')] ?? ''}|${r[vh('Artikelnummer')] ?? ''}|${varKey(r[vh('Variante')])}|${r[vh('Partner-ID')] ?? ''}`)
  );

  let afterParam = after || null;
  if (!afterParam && vRows.length) {
    const datIdx = vh('Datum');
    let newest = null;
    for (const r of vRows) {
      const d = parseDate(r[datIdx] ?? '');
      if (d && (!newest || d > newest)) newest = d;
    }
    if (newest) afterParam = newest.toISOString().slice(0, 19);
  }

  // 3. WC Bestellungen laden (shop-spezifische Credentials)
  const wc = getWcClient(shop);
  const orders = await fetchOrders(wc, WC_STATES_VERKAUF, afterParam);
  // Stornos voll-historisch (ohne after-Filter) – fängt auch ältere Refunds.
  const stornoOrders = await fetchOrders(wc, WC_STATES_STORNO, null);

  // 4. Iterieren → Sheet-Zeilen sammeln
  const toWrite = [];
  const artikelName = (item) => item.name || item.sku || String(item.product_id);

  for (const order of orders) {
    const orderDate      = toDE(new Date(order.date_created));
    const shippingNetto  = toFloat(order.shipping_total); // net from WC
    const orderNetto     = order.line_items.reduce((s, i) => s + toFloat(i.total), 0);

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
      const itemNetto  = toFloat(item.total); // net from WC
      const anteil     = orderNetto > 0 ? (itemNetto / orderNetto) : 0;
      const portoEinnahmeAnteil = shippingNetto * anteil; // net from WC
      const artKey      = artikelName(item);
      const variationId = String(item.variation_id || 0);

      for (const e of entries) {
        const key = `${order.id}|${artKey}|${variationId}|${e.partnerId}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);

        const calc = berechnePartnerAnteil({
          vkNetto:            itemNetto,
          ekPreis:            e.ekPreis,
          druckkosten:        e.druckkosten,
          versandart:         orderVersandart,
          portoModell:        partnerInfoMap[e.partnerId]?.portoModell ?? 'geteilt-50-50',
          bestellungsAnteil:  anteil,
          lizenzProzent:      e.lizenzProzent,
          portoEinnahmeAnteil,
          konfiguration,
        });

        // Berechnung Breakdown für Tooltip
        const lizenzAnteilVomGewinn = calc.gewinnNetto * (e.lizenzProzent || 0) / 100;

        toWrite.push([
          e.partnerId, orderDate, order.id,
          artKey, item.variation_id || 0, item.quantity,
          itemNetto, calc.partnerAnteil, 'offen',
          item.product_id,
          calc.gewinnNetto,
          lizenzAnteilVomGewinn,
          calc.portoSaldoPartner,
          calc.brutto,
        ]);
      }
    }
  }

  const stornoRows = buildStornoRows(vRows, vh, stornoOrders, partnerFilter);
  const allRows = [...toWrite, ...stornoRows];
  if (allRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${TAB_VERKAEUFE}!A:O`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: allRows },
    });
  }

  return {
    synced:     toWrite.length,
    storniert:  stornoRows.length,
    orders:     orders.length,
    afterParam: afterParam || null,
    message:    buildSyncMessage(toWrite.length, stornoRows.length),
  };
}

// ── GET /api/partner/verkaeufe/sync   (requires MC_API_KEY) ──────────────────
router.get('/verkaeufe/sync', async (req, res, next) => {
  if (req.headers['x-api-key'] !== process.env.MC_API_KEY)
    return res.status(401).json({ error: 'Unauthorized.' });
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheets = await getSheets();

    // Optional partner filter
    let partnerFilter = null;
    if (req.query.partnerId) {
      partnerFilter = new Set([req.query.partnerId]);
      console.log(`Sync gefiltert auf Partner: ${req.query.partnerId}`);
    }

    const result = await runVerkaeufeSync(sheets, sheetId, { after: req.query.after, partnerFilter, shop: req.query.shop });
    res.json(result);
  } catch (err) { next(err); }
});

// ── POST /api/partner/verkaeufe/sync-all  (requires MC_API_KEY) ──────────────
// Sync für alle AKTIVEN Partner. Gedacht für Cron-Jobs (täglich 02:00 Uhr).
router.post('/verkaeufe/sync-all', async (req, res, next) => {
  if (req.headers['x-api-key'] !== process.env.MC_API_KEY)
    return res.status(401).json({ error: 'Unauthorized.' });
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheets = await getSheets();

    // Aktive Partner aus Sheet Partner (Spalte 'Aktiv' = 'ja')
    const { header, rows } = await readTab(sheets, sheetId, 'Partner');
    const h = col => header.indexOf(col);
    const aktivePartner = rows
      .filter(r => (r[h('Aktiv')] ?? '').toString().toLowerCase() === 'ja')
      .map(r => r[h('Partner-ID')])
      .filter(Boolean);

    if (!aktivePartner.length)
      return res.json({ partner: 0, neueVerkäufe: 0, errors: [], message: 'Keine aktiven Partner.' });

    const errors = [];
    let neueVerkäufe = 0;
    let result = null;
    try {
      result = await runVerkaeufeSync(sheets, sheetId, { partnerFilter: new Set(aktivePartner), shop: req.query.shop });
      neueVerkäufe = result.synced;
    } catch (err) {
      errors.push(err.message ?? String(err));
    }

    res.json({
      partner:      aktivePartner.length,
      partnerIds:   aktivePartner,
      neueVerkäufe,
      storniert:    result?.storniert ?? 0,
      orders:       result?.orders ?? 0,
      afterParam:   result?.afterParam ?? null,
      errors,
      message:      result?.message ?? (errors.length ? 'Sync mit Fehlern' : 'Sync fertig'),
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
    const tabVerkaeufe = getShopConfig(req.query.shop).tabVerkaeufe;
    const { header, rows } = await readTab(sheets, sheetId, tabVerkaeufe);
    const h = col => header.indexOf(col);

    const parseDE = s => { const [d,m,y] = (s ?? '').split('.'); return new Date(`${y}-${m}-${d}`); };
    const stornoIdx = h('Storno-Status') !== -1 ? h('Storno-Status') : 14; // Spalte O
    res.json(rows
      .filter(r => r[h('Partner-ID')] === partnerId && r[h('Status')] !== 'abgerechnet')
      .map(r => ({
        orderId:     r[h('Order-ID')]    ?? '',
        artikelname: r[h('Artikelnummer')] ?? '',
        stueckzahl:  parseInt(r[h('Stückzahl')] ?? '1', 10),
        datum:       r[h('Datum')]       ?? '',
        status:      r[h('Status')]      ?? '',
        storno:      r[stornoIdx]        ?? '',
      }))
      .sort((a, b) => parseDE(b.datum) - parseDE(a.datum)));
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
    const tabVerkaeufe = getShopConfig(req.query.shop).tabVerkaeufe;
    const [verkäufeTab, internTab] = await Promise.all([
      readTab(sheets, sheetId, tabVerkaeufe),
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
// Partner sieht nur freigegebene oder bezahlte Abrechnungen (keine Entwürfe).
router.get('/abrechnungen', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partnerId } = await resolvePartner(token);

    const sheetId = process.env.BUSINESS_SHEET_ID;
    const sheets  = await getSheets();
    const tabAbrechnungen = getShopConfig(req.query.shop).tabAbrechnungen;
    const { header, rows } = await readTab(sheets, sheetId, tabAbrechnungen);
    const h = col => header.indexOf(col);
    const VISIBLE = new Set(['freigegeben', 'bezahlt']);

    res.json(rows
      .filter(r => r[h('Partner-ID')] === partnerId && VISIBLE.has(r[h('Status')] ?? ''))
      .map(r => {
        let positionen = null;
        const posRaw = r[h('Positionen')];
        if (posRaw) {
          try { positionen = JSON.parse(posRaw); } catch { positionen = null; }
        }
        return {
          abrechnungId: r[h('Abrechnungs-ID')] ?? '',
          zeitraumVon:  r[h('Zeitraum-Von')]    ?? '',
          zeitraumBis:  r[h('Zeitraum-Bis')]    ?? '',
          verkaufsSumme: toFloat(r[h('Verkaufs-Guthaben')]),
          saldo:        toFloat(r[h('Saldo')]),
          status:       r[h('Status')]          ?? '',
          erstelltAm:   r[h('Erstellt-Am')]     ?? '',
          positionen,
        };
      }));
  } catch (err) { next(err); }
});

export default router;
