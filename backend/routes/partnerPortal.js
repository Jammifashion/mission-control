import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient as wcClientForShop, getShopConfig } from '../lib/shopConfig.js';
import { berechnePartnerAnteil, parseKonfiguration } from '../utils/partner-kalkulation.js';
import { toFloat, toDE, WC_STATES_VERKAUF, WC_STATES_STORNO, STORNO_MARKER, buildStornoRows } from '../utils/sync-logic.js';
import { notify, buildPartnerNachricht } from '../lib/chatNotify.js';

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
  // Echten Sheet-Zeilenindex (_sheetRow) anhängen BEVOR Leerzeilen gefiltert werden,
  // damit Status-Updates die korrekte Zeile treffen (sonst verschiebt jede Leerzeile alles).
  rows.forEach((r, i) => { r._sheetRow = i + 2; });
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}

// Bugfix-Migration: Zeilen mit Status 'Neu' (vor dem Status-Bugfix angelegt, siehe
// partner-artikel.js PATCH /:id/intern/:rowId) einmalig auf 'offen' heben, lazy
// beim Lesen – damit sie in Saldo-Berechnung und Abrechnung ankommen. Mutiert rows
// in-place, damit der Aufrufer sofort den korrigierten Wert sieht.
async function migrateNeuStatus(sheets, sheetId, header, rows) {
  const stIdx = header.indexOf('Status');
  if (stIdx === -1) return;
  const stCol = colLetter(stIdx);
  const betroffen = rows.filter(r => (r[stIdx] ?? '') === 'Neu');
  if (!betroffen.length) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: betroffen.map(r => ({
        range: `Partner_Interne_Bestellungen!${stCol}${r._sheetRow}`,
        values: [['offen']],
      })),
    },
  });
  betroffen.forEach(r => { r[stIdx] = 'offen'; });
}

function parseDate(s) {
  if (!s) return null;
  const [d, m, y] = s.split('.');
  if (!d || !m || !y) return null;
  const dt = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// Spaltenindex (0-basiert) → Spaltenbuchstabe (A, B, …, AA).
function colLetter(idx) {
  let s = '';
  idx++;
  while (idx > 0) { idx--; s = String.fromCharCode(65 + (idx % 26)) + s; idx = Math.floor(idx / 26); }
  return s;
}

// Prüft, ob eine Partner-ID in 'Partner' ODER 'FP_Partner' existiert.
// (Eigenaufträge kommen sowohl aus partner.html als auch partner-festpreis.html.)
// Liefert { partnerId, name } oder null. Ersetzt die reine Existenzpruefung,
// damit der Partnername fuer die Chat-Nachricht bereitsteht - ohne einen
// zweiten Sheet-Aufruf.
async function findPartner(sheets, sheetId, partnerId) {
  for (const tab of ['Partner', 'FP_Partner']) {
    try {
      const { header, rows } = await readTab(sheets, sheetId, tab);
      const idx = header.indexOf('Partner-ID');
      if (idx === -1) continue;
      const row = rows.find(r => (r[idx] ?? '') === partnerId);
      if (row) {
        const nameIdx = header.indexOf('Name');
        return { partnerId, name: nameIdx !== -1 ? (row[nameIdx] ?? '') : '' };
      }
    } catch { /* Tab evtl. nicht vorhanden – ignorieren */ }
  }
  return null;
}

async function partnerIdExists(sheets, sheetId, partnerId) {
  return (await findPartner(sheets, sheetId, partnerId)) !== null;
}

// WC-Status: VERKAUF = processing/completed/on-hold, STORNO = refunded/cancelled
// (importiert aus sync-logic.js)

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

function extractToken(req) {
  const auth = req.headers.authorization ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
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

// ── GET /api/partner/auth ────────────────────────────────────────────────────
router.get('/auth', async (req, res, next) => {
  try {
    const token = extractToken(req);
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

// ── GET /api/partner/verkaeufe ───────────────────────────────────────────────
// Gibt nur offene (nicht abgerechnete) Zeilen des Partners zurück – ohne Preise
router.get('/verkaeufe', async (req, res, next) => {
  try {
    const token = extractToken(req);
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

// ── GET /api/partner/intern ──────────────────────────────────────────────────
// Direkte Bestellungen für die Partner-Sicht – mit Preisen (eigene Kosten).
router.get('/intern', async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partnerId } = await resolvePartner(token);

    const sheetId = process.env.BUSINESS_SHEET_ID;
    const sheets  = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Interne_Bestellungen');
    await migrateNeuStatus(sheets, sheetId, header, rows);
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

// ── GET /api/partner/saldo ───────────────────────────────────────────────────
// Aggregierte offene Posten: Lizenz-Summe − Interne-Summe = Saldo.
router.get('/saldo', async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partnerId } = await resolvePartner(token);

    const sheetId = process.env.BUSINESS_SHEET_ID;
    const sheets  = await getSheets();
    const tabVerkaeufe = getShopConfig(req.query.shop).tabVerkaeufe;
    const [verkäufeTab, internTab, konfigTab] = await Promise.all([
      readTab(sheets, sheetId, tabVerkaeufe),
      readTab(sheets, sheetId, 'Partner_Interne_Bestellungen'),
      readTab(sheets, sheetId, 'Kalkulation_Fixkosten'),
    ]);
    await migrateNeuStatus(sheets, sheetId, internTab.header, internTab.rows);

    const round2 = n => Math.round(n * 100) / 100;
    const mwstProzent = parseKonfiguration(konfigTab.rows, konfigTab.header).mwstProzent;

    const vh = col => verkäufeTab.header.indexOf(col);
    const lizenzNetto = verkäufeTab.rows
      .filter(r => r[vh('Partner-ID')] === partnerId && (r[vh('Status')] ?? '') === 'offen')
      .reduce((s, r) => s + toFloat(r[vh('Lizenzgebühr')]), 0);

    const ih = col => internTab.header.indexOf(col);
    const interneSumme = internTab.rows
      .filter(r => r[ih('Partner-ID')] === partnerId && (r[ih('Status')] ?? '') === 'offen')
      .reduce((s, r) => s + toFloat(r[ih('Summe')]), 0);

    // Lizenz brutto (netto + MwSt), davon interne (brutto) abziehen.
    const lizenzBrutto = round2(lizenzNetto * (1 + mwstProzent / 100));
    const saldoBrutto  = round2(lizenzBrutto - interneSumme);
    const saldoNetto   = round2(saldoBrutto / (1 + mwstProzent / 100));
    res.json({
      mwstProzent,
      lizenzNetto:  round2(lizenzNetto),
      lizenzBrutto,
      lizenzSumme:  round2(lizenzNetto),   // Rückwärtskompatibel (netto)
      interneSumme: round2(interneSumme),
      saldoNetto,
      saldo:        saldoBrutto,            // Saldo jetzt brutto
    });
  } catch (err) { next(err); }
});

// ── GET /api/partner/abrechnungen ────────────────────────────────────────────
// Partner sieht nur freigegebene oder bezahlte Abrechnungen (keine Entwürfe).
router.get('/abrechnungen', async (req, res, next) => {
  try {
    const token = extractToken(req);
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

// ── POST /api/partner/:id/eigenauftrag ───────────────────────────────────────
// Öffentlich (kein API-Key): Partner stellt einen Eigenauftrag direkt im Portal.
// Die Partner-ID wird zuvor über die Token-Auth der Portalseite ermittelt und hier
// im Pfad mitgegeben. Schreibt nach Partner_Interne_Bestellungen mit Status 'Neu'
// und Kanal 'Portal'. Preis/Summe bleiben leer und werden später vom Admin gepflegt.
// Pflichtfelder: artikel, menge, varianten.
router.post('/:id/eigenauftrag', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const partnerId = req.params.id;
    const { artikel, menge, varianten, lieferTyp,
            lieferName, lieferStrasse, lieferPlzOrt, wunschtermin, anmerkungen } = req.body;

    const artikelTrim   = (artikel   ?? '').toString().trim();
    const variantenTrim = (varianten ?? '').toString().trim();
    const mengeNum      = toFloat(menge, 0);
    if (!artikelTrim || !variantenTrim || !(mengeNum > 0))
      return res.status(400).json({ error: 'Artikel, Menge und Varianten sind Pflichtfelder.' });

    const sheets  = await getSheets();
    const partner = await findPartner(sheets, sheetId, partnerId);
    if (!partner)
      return res.status(404).json({ error: 'Partner nicht gefunden.' });

    // Eigenauftrag-Details in die Bezeichnung komponieren (bestehende Admin-/Abrechnungs-
    // Ansichten lesen nur Bezeichnung – so bleiben alle Felder ohne Schemaänderung sichtbar).
    const teile = [artikelTrim, `Varianten: ${variantenTrim}`];
    if ((lieferTyp ?? '') === 'abweichend') {
      const adr = [lieferName, lieferStrasse, lieferPlzOrt].map(v => (v ?? '').toString().trim()).filter(Boolean);
      teile.push(`Lieferung abweichend: ${adr.join(', ') || '—'}`);
    } else {
      teile.push('Lieferung an Partner');
    }
    if ((wunschtermin ?? '').toString().trim()) teile.push(`Wunschtermin: ${wunschtermin.toString().trim()}`);
    if ((anmerkungen  ?? '').toString().trim()) teile.push(`Anmerkung: ${anmerkungen.toString().trim()}`);
    const bezeichnung = teile.join(' | ');

    // Spaltenlayout ermitteln; Kanal- und Fulfillment-Spalte ggf. neu anlegen.
    const { header } = await readTab(sheets, sheetId, 'Partner_Interne_Bestellungen');
    const kanalIsNew = header.indexOf('Kanal') === -1;
    const kanalIdx   = kanalIsNew ? header.length : header.indexOf('Kanal');
    const fulIsNew   = header.indexOf('Fulfillment') === -1;
    const fulIdx     = fulIsNew ? (kanalIsNew ? kanalIdx + 1 : header.length) : header.indexOf('Fulfillment');

    // Beim ersten Mal Kanal-Header setzen und bestehende Einträge als 'Manuell' markieren.
    if (kanalIsNew) {
      const { data: colA } = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId, range: 'Partner_Interne_Bestellungen!A:A',
      });
      const totalRows = (colA.values ?? []).length; // inkl. Header-Zeile
      const kanalCol  = colLetter(kanalIdx);
      const data = [{ range: `Partner_Interne_Bestellungen!${kanalCol}1`, values: [['Kanal']] }];
      if (totalRows > 1)
        data.push({
          range:  `Partner_Interne_Bestellungen!${kanalCol}2:${kanalCol}${totalRows}`,
          values: Array.from({ length: totalRows - 1 }, () => ['Manuell']),
        });
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'RAW', data },
      });
    }

    // Beim ersten Mal Fulfillment-Header setzen, Bestandszeilen mit 'Beauftragt' befüllen.
    if (fulIsNew) {
      const { data: colA } = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId, range: 'Partner_Interne_Bestellungen!A:A',
      });
      const totalRows = (colA.values ?? []).length; // inkl. Header-Zeile
      const fulCol    = colLetter(fulIdx);
      const data = [{ range: `Partner_Interne_Bestellungen!${fulCol}1`, values: [['Fulfillment']] }];
      if (totalRows > 1)
        data.push({
          range:  `Partner_Interne_Bestellungen!${fulCol}2:${fulCol}${totalRows}`,
          values: Array.from({ length: totalRows - 1 }, () => ['Beauftragt']),
        });
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'RAW', data },
      });
    }

    // Zeile anhand der Header-Positionen aufbauen (Einzelpreis/Summe bleiben leer).
    const rowArr = new Array(Math.max(header.length, kanalIdx + 1, fulIdx + 1)).fill('');
    const setCol = (name, val) => { const i = header.indexOf(name); if (i !== -1) rowArr[i] = val; };
    setCol('Partner-ID',  partnerId);
    setCol('Datum',       toDE(new Date()));
    setCol('Bezeichnung', bezeichnung);
    setCol('Anzahl',      mengeNum);
    // Bugfix: Status startet direkt auf 'offen' statt 'Neu' – Portal-Eigenaufträge
    // flossen mit 'Neu' nie in Saldo/Abrechnung ein (Summe ist hier 0, unkritisch).
    setCol('Status',      'offen');
    rowArr[kanalIdx] = 'Portal';
    rowArr[fulIdx]   = 'Beauftragt';

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `Partner_Interne_Bestellungen!A:${colLetter(rowArr.length - 1)}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [rowArr] },
    });

    // Mit await vor der Antwort, siehe anfragen.js. Eine Summe gibt es hier
    // bewusst noch nicht - Einzelpreis/Summe pflegt der Admin spaeter nach.
    await notify(buildPartnerNachricht({
      partnerName: partner.name || partnerId,
      anzahl:      mengeNum,
    }));

    res.status(201).json({
      partnerId, bezeichnung, anzahl: mengeNum,
      status: 'offen', kanal: 'Portal', fulfillment: 'Beauftragt',
    });
  } catch (err) { next(err); }
});

export default router;
