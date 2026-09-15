import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient as wcClientForShop, getShopConfig } from '../lib/shopConfig.js';
import { berechnePartnerAnteil, parseKonfiguration, baueLizenzSaetze, baueVertragsbeginne } from '../utils/partner-kalkulation.js';
import { toFloat, toDE, WC_STATES_VERKAUF, WC_STATES_STORNO, STORNO_MARKER, buildStornoRows, ordersFuerVerkaufszeilen, vorVertragsbeginn } from '../utils/sync-logic.js';
import { notify, buildPartnerNachricht } from '../lib/chatNotify.js';
import { requireHeader } from '../utils/sheet-headers.js';

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

// Token-Aufloesung ueber BEIDE Partner-Tabs.
//
// resolvePartner() weiter unten liest nur 'Partner' und bleibt so - es bedient
// das Lizenz-Portal. Der Eigenauftrag wird aber auch von
// partner-festpreis.html aufgerufen, und Festpreis-Partner stehen
// ausschliesslich in 'FP_Partner'. Nur gegen 'Partner' zu pruefen wuerde sie
// aussperren (derselbe Fehler wie seinerzeit bei loadPartner(), siehe
// bugfix.md 2026-06-09).
//
// Wirft 401 bei unbekanntem Token, 403 bei inaktivem Partner.
async function resolvePartnerAnyTab(token) {
  const sheetId = process.env.BUSINESS_SHEET_ID;
  if (!sheetId) throw Object.assign(new Error('BUSINESS_SHEET_ID nicht konfiguriert.'), { status: 503 });

  const sheets = await getSheets();
  for (const tab of ['Partner', 'FP_Partner']) {
    let header, rows;
    try {
      ({ header, rows } = await readTab(sheets, sheetId, tab));
    } catch { continue; }        // Tab evtl. nicht vorhanden

    const tokenIdx = header.indexOf('Token');
    const idIdx    = header.indexOf('Partner-ID');
    if (tokenIdx === -1 || idIdx === -1) continue;

    const row = rows.find(r => (r[tokenIdx] ?? '') === token);
    if (!row) continue;

    // trim(): ein versehentliches Leerzeichen im Sheet wuerde den Partner sonst
    // still auf 403 setzen - im Tabellenblatt ist das nicht zu sehen.
    const aktivIdx = header.indexOf('Aktiv');
    if (aktivIdx !== -1 && String(row[aktivIdx] ?? '').trim().toLowerCase() !== 'ja')
      throw Object.assign(new Error('Partner ist nicht aktiv.'), { status: 403 });

    const nameIdx = header.indexOf('Name');
    return { partnerId: row[idIdx] ?? '', name: nameIdx !== -1 ? (row[nameIdx] ?? '') : '' };
  }
  throw Object.assign(new Error('Ungültiger Token.'), { status: 401 });
}

// WC-Status: VERKAUF = processing/completed/on-hold, STORNO = refunded/cancelled
// (importiert aus sync-logic.js)

const TAB_HK_ARTIKEL = 'HK_Partner_Artikel';

// HK_Partner_Artikel → Map Produkt-ID → { ekPreis, druckkosten, versandart }.
// Pflichtspalten werfen: ohne EK-Spalte wuerde toFloat(undefined) still 0 liefern.
function baueHkArtikelMap(header, rows) {
  const idIdx    = requireHeader(header, 'Produkt-ID',     TAB_HK_ARTIKEL);
  const ekIdx    = requireHeader(header, 'EK-Preis-Netto', TAB_HK_ARTIKEL);
  const druckIdx = requireHeader(header, 'Druckkosten',    TAB_HK_ARTIKEL);
  const vaIdx    = requireHeader(header, 'Versandart',     TAB_HK_ARTIKEL);
  const map = new Map();
  for (const r of rows) {
    const id = String(r[idIdx] ?? '').trim();
    if (!id || map.has(id)) continue;
    map.set(id, {
      ekPreis:     toFloat(r[ekIdx]),
      druckkosten: toFloat(r[druckIdx]),
      versandart:  String(r[vaIdx] ?? 'P').trim().toUpperCase() === 'B' ? 'B' : 'P',
    });
  }
  return map;
}

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

  // HonkShop: alle Items gehen an den einzigen honk-Partner. EK, Druck und
  // Versandart kommen aus HK_Partner_Artikel (Produkt-ID). Frueher rechnete der
  // Sync hier mit EK 0 / Druck 0 - der Partner bekam die Marge vom vollen VK.
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
    // Wirft mit Partner-ID, wenn der Satz fehlt - vor jedem WC- oder Schreibzugriff.
    const lizenzProzent  = baueLizenzSaetze(pH, pRows)(honkPartnerId);
    // Vertrag-ab: Bestellungen davor gehoeren nicht zur Vereinbarung. Wirft
    // bei einem ungueltigen Wert, ebenfalls vor jedem WC- oder Schreibzugriff.
    const vertragsbeginn = baueVertragsbeginne(pH, pRows)(honkPartnerId);
    const portoModell    = honkRow[ph('Porto-Modell')] ?? 'geteilt-50-50';

    const { header: kH, rows: kRows } = await readTab(sheets, sheetId, 'Kalkulation_Fixkosten');
    const konfiguration = parseKonfiguration(kRows, kH);

    // HK_Partner_Artikel → Map Produkt-ID → { ekPreis, druckkosten, versandart }
    const { header: aH, rows: aRows } = await readTab(sheets, sheetId, TAB_HK_ARTIKEL);
    const artikelMap = baueHkArtikelMap(aH, aRows);

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
    // Schon stornierte, bezahlte Bestellungen bekommen Verkauf + Gegenbuchung.
    const verkaufsOrders = ordersFuerVerkaufszeilen(orders, stornoOrders, afterParam);

    const toWrite = [];
    const uebersprungen = [];
    let vorVertrag = 0; // Positionen vor Vertrag-ab - weder geschrieben noch als uebersprungen gemeldet
    const artikelName = item => item.name || item.sku || String(item.product_id);
    for (const order of verkaufsOrders) {
      // Vor dem Vertragsbeginn: die ganze Bestellung faellt raus, auch aus
      // "uebersprungen" - fuer diese Artikel muss niemand etwas nachtragen.
      if (vorVertragsbeginn(order.date_created, vertragsbeginn)) {
        vorVertrag += order.line_items.length;
        continue;
      }
      const orderDate = toDE(new Date(order.date_created));
      const shippingNetto = toFloat(order.shipping_total);
      // Wertanteil bleibt ueber ALLE Positionen der Bestellung - auch ueber
      // die uebersprungenen. Sonst wuerde eine fehlende Position ihren Anteil
      // an Porto und PayPal auf die uebrigen abwaelzen.
      const orderNetto = order.line_items.reduce((s, i) => s + toFloat(i.total), 0);
      // Versandart wie beim JFN-Sync: P, sobald ein bekannter Artikel P ist.
      const bekannte = order.line_items.map(i => artikelMap.get(String(i.product_id ?? ''))).filter(Boolean);
      const orderVersandart = bekannte.length && bekannte.every(a => a.versandart === 'B') ? 'B' : 'P';

      for (const item of order.line_items) {
        const itemNetto = toFloat(item.total);
        const anteil = orderNetto > 0 ? (itemNetto / orderNetto) : 0;
        const portoEinnahmeAnteil = shippingNetto * anteil;
        const artKey = artikelName(item);
        const variationId = String(item.variation_id || 0);
        const key = `${order.id}|${artKey}|${variationId}|${honkPartnerId}`;
        if (existingKeys.has(key)) continue;

        const artikel = artikelMap.get(String(item.product_id ?? ''));
        if (!artikel) {
          // Nicht schreiben und nicht in existingKeys aufnehmen: sobald der
          // Artikel in HK_Partner_Artikel steht, holt der naechste Sync die
          // Zeile nach (mit after auf das Bestelldatum).
          uebersprungen.push({
            orderId: order.id, datum: orderDate, produktId: item.product_id,
            artikel: artKey, grund: `Produkt-ID ${item.product_id} fehlt in ${TAB_HK_ARTIKEL}`,
          });
          continue;
        }
        existingKeys.add(key);

        const calc = berechnePartnerAnteil({
          vkNetto: itemNetto, ekPreis: artikel.ekPreis, druckkosten: artikel.druckkosten,
          versandart: orderVersandart,
          portoModell, bestellungsAnteil: anteil, stueckzahl: item.quantity,
          lizenzProzent, portoEinnahmeAnteil, konfiguration,
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

    // Auch die gerade gebauten Zeilen: sonst bekaeme ein nachgeholter Verkauf
    // seine Gegenbuchung erst im naechsten Lauf.
    const stornoRows = buildStornoRows([...vRows, ...toWrite], vh, stornoOrders, null);
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

    if (uebersprungen.length) {
      console.warn(
        `[sync honk] ${uebersprungen.length} Position(en) übersprungen, Artikel fehlt in ${TAB_HK_ARTIKEL}: `
        + uebersprungen.map(u => `Order ${u.orderId} / Produkt-ID ${u.produktId} (${u.artikel})`).join('; '),
      );
    }

    const message = buildSyncMessage(toWrite.length, stornoRows.length)
      + (uebersprungen.length ? ` ${uebersprungen.length} übersprungen (Artikel fehlt in ${TAB_HK_ARTIKEL}).` : '');
    return {
      synced: toWrite.length, storniert: stornoRows.length, orders: orders.length, afterParam: afterParam || null,
      stornoNachgeholt: verkaufsOrders.length - orders.length,
      vorVertragsbeginn: vorVertrag,
      uebersprungen, message,
    };
  }

  // JFN: Partner_Artikel Lookup → Map: productId → [{ partnerId, ek, druck, versandart }]
  // Lizenz-% aus Partner_Artikel wird bewusst nicht gelesen (B16), der Satz
  // kommt aus dem Partner-Reiter.
  const { header: aH, rows: aRows } = await readTab(sheets, sheetId, 'Partner_Artikel');
  const ah = col => aH.indexOf(col);
  const partnerArtikelMap = {};
  for (const r of aRows) {
    const partnerId  = r[ah('Partner-ID')] ?? '';
    if (partnerFilter && !partnerFilter.has(partnerId)) continue;
    const pid        = (r[ah('Produkt-ID')] ?? '').toString().trim();
    const ekPreis     = toFloat(r[ah('EK-Preis-Netto')]);
    const druckkosten = toFloat(r[ah('Druckkosten')]);
    const versandart  = ((r[ah('Versandart')] ?? 'P').toString().toUpperCase() === 'B') ? 'B' : 'P';
    if (!pid || !partnerId) continue;
    if (!partnerArtikelMap[pid]) partnerArtikelMap[pid] = [];
    partnerArtikelMap[pid].push({ partnerId, ekPreis, druckkosten, versandart });
  }

  if (!Object.keys(partnerArtikelMap).length)
    return { synced: 0, orders: 0, afterParam: null, message: 'Keine passenden Partner-Artikel.' };

  // 1b. Partner → Porto-Modell + Lizenzsatz
  const { header: pH, rows: pRows } = await readTab(sheets, sheetId, 'Partner');
  const lizenzSatz = baueLizenzSaetze(pH, pRows);
  const vertragsbeginn = baueVertragsbeginne(pH, pRows);
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
  // Schon stornierte, bezahlte Bestellungen bekommen Verkauf + Gegenbuchung.
  const verkaufsOrders = ordersFuerVerkaufszeilen(orders, stornoOrders, afterParam);

  // 4. Iterieren → Sheet-Zeilen sammeln
  const toWrite = [];
  let vorVertrag = 0; // Positionen vor Vertrag-ab des jeweiligen Partners
  const artikelName = (item) => item.name || item.sku || String(item.product_id);

  for (const order of verkaufsOrders) {
    const orderDate      = toDE(new Date(order.date_created));
    const shippingNetto  = toFloat(order.shipping_total); // net from WC
    const orderNetto     = order.line_items.reduce((s, i) => s + toFloat(i.total), 0);

    const matching = [];
    let orderVersandart = 'B';
    for (const item of order.line_items) {
      const alle = partnerArtikelMap[String(item.product_id || '')];
      if (!alle) continue;
      // Vertrag-ab gilt je Partner: ein Produkt kann mehreren Partnern gehoeren,
      // und nur fuer die, deren Vereinbarung schon lief, entsteht eine Zeile.
      const entries = alle.filter(e => !vorVertragsbeginn(order.date_created, vertragsbeginn(e.partnerId)));
      vorVertrag += alle.length - entries.length;
      if (!entries.length) continue;
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

        // Wirft mit Partner-ID, wenn der Satz fehlt. Geschrieben wird erst nach
        // der Schleife, ein Fehler hinterlaesst also keine halben Zeilen.
        const lizenzProzent = lizenzSatz(e.partnerId);

        const calc = berechnePartnerAnteil({
          vkNetto:            itemNetto,
          ekPreis:            e.ekPreis,
          druckkosten:        e.druckkosten,
          versandart:         orderVersandart,
          portoModell:        partnerInfoMap[e.partnerId]?.portoModell ?? 'geteilt-50-50',
          bestellungsAnteil:  anteil,
          stueckzahl:         item.quantity,
          lizenzProzent,
          portoEinnahmeAnteil,
          konfiguration,
        });

        // Berechnung Breakdown für Tooltip
        const lizenzAnteilVomGewinn = calc.gewinnNetto * lizenzProzent / 100;

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

  // Auch die gerade gebauten Zeilen: sonst bekaeme ein nachgeholter Verkauf
  // seine Gegenbuchung erst im naechsten Lauf.
  const stornoRows = buildStornoRows([...vRows, ...toWrite], vh, stornoOrders, partnerFilter);
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
    stornoNachgeholt: verkaufsOrders.length - orders.length,
    vorVertragsbeginn: vorVertrag,
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
      uebersprungen: result?.uebersprungen ?? [],
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
// Kein MC_API_KEY, aber Token-Auth: der Partner weist sich mit dem Bearer-Token
// seiner Portalseite aus (partner.html oder partner-festpreis.html).
// Die ID im Pfad muss zu diesem Token gehoeren - frueher wurde sie ungeprueft
// uebernommen und nur auf Existenz getestet, womit jeder mit einer bekannten
// Partner-ID ohne Token ins Sheet schreiben konnte.
// Schreibt nach Partner_Interne_Bestellungen mit Status 'offen' und Kanal
// 'Portal'. Preis/Summe bleiben leer und werden später vom Admin gepflegt.
// Pflichtfelder: artikel, menge, varianten.
router.post('/:id/eigenauftrag', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    // Wirft 401 (unbekannter Token) bzw. 403 (inaktiv) über den Error-Handler.
    const partner = await resolvePartnerAnyTab(token);

    // Der Pfadparameter darf nicht auf einen fremden Partner zeigen.
    const partnerId = req.params.id;
    if (partnerId !== partner.partnerId)
      return res.status(403).json({ error: 'Partner-ID gehört nicht zu diesem Token.' });

    const { artikel, menge, varianten, lieferTyp,
            lieferName, lieferStrasse, lieferPlzOrt, wunschtermin, anmerkungen } = req.body;

    const artikelTrim   = (artikel   ?? '').toString().trim();
    const variantenTrim = (varianten ?? '').toString().trim();
    const mengeNum      = toFloat(menge, 0);
    if (!artikelTrim || !variantenTrim || !(mengeNum > 0))
      return res.status(400).json({ error: 'Artikel, Menge und Varianten sind Pflichtfelder.' });

    // Kein Existenz-Check mehr: ein aufgeloester Token belegt bereits, dass es
    // die Partner-Zeile gibt, und resolvePartnerAnyTab liefert den Namen mit.
    const sheets = await getSheets();

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
