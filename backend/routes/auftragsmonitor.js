import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient } from '../lib/shopConfig.js';
import { requireHeader, requireHeaderAny } from '../utils/sheet-headers.js';
import { wcVariationMap } from '../utils/varianten-zeilen.js';

const router = Router();

// ── Clients ───────────────────────────────────────────────────────────────────
const getWc = (req) => getWcClient(req?.query?.shop);

function sid() {
  if (!process.env.GOOGLE_SHEET_ID) throw new Error('GOOGLE_SHEET_ID fehlt in .env');
  return process.env.GOOGLE_SHEET_ID;
}

async function getSheets() {
  const auth = await getGoogleAuth();
  return google.sheets({ version: 'v4', auth });
}

// ── Tabellen-Konstanten ────────────────────────────────────────────────────────
const TAB_PS  = 'Produktions_Status';
const TAB_LSB = 'LShop_Bestellungen';
const TAB_DTF = 'DTF_Bestellungen';
const TAB_VAR = 'Varianten';
const TAB_ERF = 'Erfassungsmaske';

// Spalten-Indizes Produktions_Status (0-basiert)
const PI = { orderId: 0, wcItemId: 1, artikelname: 2, sku: 3, menge: 4, lshop: 5, dtf: 6 };
// Spalten-Indizes Varianten (0-basiert)
// Varianten: nur über Spaltennamen (utils/varianten-zeilen.js → wcVariationMap).

function normBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v).toUpperCase().trim();
  return s === 'TRUE' || s === 'WAHR';
}

/**
 * Welche Produktions_Status-Zeilen gehoeren zu dieser Bestellung?
 *
 * 1. Mit {orderId, wcItemId}-Paaren: exakt, wie bisher.
 * 2. Ohne Paare wurde frueher der ARTIKELNAME per Teilstring gegen den Teil
 *    hinter dem "/" der Artikelnummer geprueft:
 *      artikelname.includes(artikelnummer.split('/').pop())
 *    Das setzte voraus, dass hinter dem "/" der Produkttitel steht - genau das
 *    Schema, das S2 abschafft. Mit "JH030/UglySw01" traefe der Vergleich nie
 *    mehr, und ein kurzes Kuerzel koennte zufaellig fremde Zeilen treffen.
 *    Neu: exakt gegen die SKU-Spalte, die bereits die volle Artikelnummer
 *    fuehrt. Der alte Namensvergleich greift nur noch, wo diese Spalte LEER
 *    ist - also fuer Altzeilen, die sonst nicht mehr gefunden wuerden.
 */
export function psZeilenFinden(psRows, { orderIds = [], artikelnummer = '', wcItemIds = [] }) {
  const treffer = [];

  if (Array.isArray(wcItemIds) && wcItemIds.length > 0) {
    const pairSet = new Set(wcItemIds.map(({ orderId, wcItemId }) => `${orderId}|${wcItemId}`));
    psRows.slice(1).forEach((r, i) => {
      const key = `${(r[PI.orderId] ?? '').trim()}|${(r[PI.wcItemId] ?? '').trim()}`;
      if (pairSet.has(key)) treffer.push(i + 2); // +1 Header, +1 1-Basierung
    });
    return treffer;
  }

  const orderIdSet = new Set(orderIds.map(String));
  const artNr = String(artikelnummer ?? '').trim();
  const kurz  = artNr.split('/').pop();

  psRows.slice(1).forEach((r, i) => {
    if (!orderIdSet.has((r[PI.orderId] ?? '').trim())) return;
    const rowSku = (r[PI.sku] ?? '').trim();
    if (rowSku) {
      if (rowSku === artNr) treffer.push(i + 2);
      return;
    }
    if (kurz && (r[PI.artikelname] ?? '').trim().includes(kurz)) treffer.push(i + 2);
  });
  return treffer;
}

function buildVariante(v1, v2, v3) {
  return [v1, v2, v3].filter(Boolean).join('·');
}

// ── GET /api/auftragsmonitor/lshop/offen ──────────────────────────────────────
router.get('/lshop/offen', async (req, res, next) => {
  try {
    const wc            = getWc(req);
    const sheets        = await getSheets();
    const spreadsheetId = sid();

    // Alle Datenquellen parallel laden
    const [psResp, varResp, erfResp, wcPending, wcProcessing, wcOnHold] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: `${TAB_PS}!A1:J5000` }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: TAB_VAR }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: `${TAB_ERF}!1:2000` }),
      wc.get('orders', { status: 'pending',    per_page: 100 }),
      wc.get('orders', { status: 'processing', per_page: 100 }),
      wc.get('orders', { status: 'on-hold',    per_page: 100 }),
    ]);

    const psRows   = (psResp.data.values  ?? []).slice(1);
    const erfRows  = erfResp.data.values ?? [];
    const erfHdr   = erfRows[0] ?? [];
    const wcOrders = [
      ...(Array.isArray(wcPending.data)    ? wcPending.data    : []),
      ...(Array.isArray(wcProcessing.data) ? wcProcessing.data : []),
      ...(Array.isArray(wcOnHold.data)     ? wcOnHold.data     : []),
    ];

    // WC_Variation_ID → {ssotId, e1-v3}
    const varMap = wcVariationMap(varResp.data.values, `${req.method} ${req.baseUrl}${req.path}`);

    // SSOT-ID → {artikelnummer, produktname}
    // Exakter Vergleich: /artikelnummer/i traf als Teilstring die Spalte
    // "L-Shop-Artikelnummer", weil die im Sheet vor "Artikelnummer" steht.
    // Pflichtspalten werfen: ein Monitor, der stumm die falsche Nummer zeigt,
    // erzeugt Fehlbestellungen - der laute Ausfall ist der billigere Fehler.
    const CTX_L    = 'GET /api/auftragsmonitor/lshop/offen';
    const ssotIdx  = requireHeaderAny(erfHdr, ['SSOT-ID', 'ID'], CTX_L);
    const artIdx   = requireHeader(erfHdr, 'Artikelnummer', CTX_L);
    const nameIdx  = requireHeader(erfHdr, 'Produktname', CTX_L);
    const ssotArt  = {};
    erfRows.slice(1).forEach(r => {
      const id = (r[ssotIdx] ?? '').trim();
      if (id) ssotArt[id] = { artikelnummer: r[artIdx] ?? '', produktname: r[nameIdx] ?? '' };
    });

    // WC orderId → {billing, lineItemMap: {wcItemId → lineItem}}
    const orderMap = {};
    wcOrders.forEach(o => {
      const lim = {};
      (o.line_items ?? []).forEach(li => { lim[String(li.id)] = li; });
      orderMap[String(o.id)] = { billing: o.billing, lim };
    });

    // Aggregation: nur Zeilen mit L-Shop_bestellt=FALSE
    const groups = {};
    psRows.forEach(r => {
      if (normBool(r[PI.lshop] ?? false)) return;

      const orderId  = (r[PI.orderId]  ?? '').trim();
      const wcItemId = (r[PI.wcItemId] ?? '').trim();
      const sku      = (r[PI.sku]      ?? '').trim();
      const menge    = parseInt(r[PI.menge] ?? '1', 10) || 1;
      const artName  = (r[PI.artikelname] ?? '').trim();

      const ord = orderMap[orderId];
      if (!ord) return; // Bestellung nicht mehr offen

      const li = ord.lim[wcItemId];
      if (!li) return;

      // Variante ermitteln: zuerst Varianten-Sheet, dann WC meta_data
      const varInfo = varMap[String(li.variation_id ?? '')];
      let variante = '', varDetails = { e1: '', v1: '', e2: '', v2: '', e3: '', v3: '' };
      let ssotId = '';

      if (varInfo) {
        ssotId    = varInfo.ssotId;
        varDetails = { e1: varInfo.e1, v1: varInfo.v1, e2: varInfo.e2, v2: varInfo.v2, e3: varInfo.e3, v3: varInfo.v3 };
        variante  = buildVariante(varInfo.v1, varInfo.v2, varInfo.v3);
      } else {
        // Fallback: WC meta_data display values
        variante = (li.meta_data ?? [])
          .filter(m => !m.key.startsWith('_') && m.display_value)
          .map(m => m.display_value).join('·');
      }

      const art       = ssotArt[ssotId] ?? {};
      const groupKey  = `${ssotId || sku}__${variante}`;
      const kunde     = `${ord.billing?.first_name ?? ''} ${ord.billing?.last_name ?? ''}`.trim();

      if (!groups[groupKey]) {
        groups[groupKey] = {
          groupKey,
          ssotId,
          artikelnummer:  art.artikelnummer || sku,
          produktname:    art.produktname   || artName,
          variante,
          varianteDetails: varDetails,
          stueck:          0,
          betroffeneOrders: [],
        };
      }

      groups[groupKey].stueck += menge;

      const existing = groups[groupKey].betroffeneOrders.find(o => o.orderId === orderId);
      if (existing) {
        existing.stueck += menge;
        existing.wcItemIds.push(wcItemId);
      } else {
        groups[groupKey].betroffeneOrders.push({ orderId, kunde, stueck: menge, wcItemIds: [wcItemId] });
      }
    });

    res.json(Object.values(groups).sort((a, b) => b.stueck - a.stueck));
  } catch (err) { next(err); }
});

// ── GET /api/auftragsmonitor/lshop/protokoll?days=7 ──────────────────────────
router.get('/lshop/protokoll', async (req, res, next) => {
  try {
    const days   = Math.min(parseInt(req.query.days ?? '7', 10), 365);
    const sheets = await getSheets();
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sid(),
      range: `${TAB_LSB}!A1:H5000`,
    });
    const rows   = data.values ?? [];
    if (rows.length <= 1) return res.json([]);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const result = rows.slice(1)
      .map(r => ({
        bestellId:        (r[0] ?? '').trim(),
        bestelldatum:     (r[1] ?? '').trim(),
        ssotId:           (r[2] ?? '').trim(),
        artikelnummer:    (r[3] ?? '').trim(),
        variante:         (r[4] ?? '').trim(),
        stueck:           parseInt(r[5] ?? '0', 10) || 0,
        kw:               (r[6] ?? '').trim(),
        betroffeneOrders: (r[7] ?? '').trim(),
      }))
      .filter(e => {
        if (!e.bestellId) return false;
        const d = new Date(e.bestelldatum);
        return !isNaN(d.getTime()) && d >= cutoff;
      })
      .reverse();

    res.json(result);
  } catch (err) { next(err); }
});

// ── POST /api/auftragsmonitor/lshop/bestellen ─────────────────────────────────
// Body: { ssotId, artikelnummer, variante, stueck, kw, orderIds, wcItemIds: [{orderId, wcItemId}] }
router.post('/lshop/bestellen', async (req, res, next) => {
  try {
    const { ssotId = '', artikelnummer, variante = '', stueck, kw = '', orderIds = [], wcItemIds = [] } = req.body;
    if (!artikelnummer || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: 'artikelnummer und orderIds erforderlich' });
    }

    const sheets        = await getSheets();
    const spreadsheetId = sid();

    // ── Bestell-ID generieren (LSB-YYYY-NNNN) ────────────────────────────
    const { data: lsbData } = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${TAB_LSB}!A1:A5000`,
    });
    const year   = new Date().getFullYear();
    const prefix = `LSB-${year}-`;
    let maxSeq   = 0;
    (lsbData.values ?? []).slice(1).forEach(r => {
      const val = (r[0] ?? '').trim();
      if (val.startsWith(prefix)) {
        const n = parseInt(val.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    });
    const bestellId = `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;

    // ── Protokoll-Zeile schreiben ─────────────────────────────────────────
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${TAB_LSB}!A1`, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[
        bestellId, new Date().toISOString(), ssotId, artikelnummer,
        variante, stueck ?? 0, kw, orderIds.map(String).join(', '),
      ]] },
    });

    // ── L-Shop_bestellt = TRUE in Produktions_Status ──────────────────────
    const { data: psData } = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${TAB_PS}!A1:J5000`,
    });
    const psRows = psData.values ?? [];

    // Welche Zeilen updaten?
    const updateRows = psZeilenFinden(psRows, { orderIds, artikelnummer, wcItemIds });

    if (updateRows.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updateRows.map(row => ({ range: `${TAB_PS}!F${row}`, values: [[true]] })),
        },
      });
    }

    res.json({ ok: true, bestellId, updated: updateRows.length });
  } catch (err) { next(err); }
});

// ── GET /api/auftragsmonitor/dtf/offen ───────────────────────────────────────
router.get('/dtf/offen', async (req, res, next) => {
  try {
    const wc            = getWc(req);
    const sheets        = await getSheets();
    const spreadsheetId = sid();

    const [psResp, varResp, erfResp, wcPending, wcProcessing, wcOnHold] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: `${TAB_PS}!A1:J5000` }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: TAB_VAR }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: `${TAB_ERF}!1:2000` }),
      wc.get('orders', { status: 'pending',    per_page: 100 }),
      wc.get('orders', { status: 'processing', per_page: 100 }),
      wc.get('orders', { status: 'on-hold',    per_page: 100 }),
    ]);

    const psRows   = (psResp.data.values  ?? []).slice(1);
    const erfRows  = erfResp.data.values ?? [];
    const erfHdr   = erfRows[0] ?? [];
    const wcOrders = [
      ...(Array.isArray(wcPending.data)    ? wcPending.data    : []),
      ...(Array.isArray(wcProcessing.data) ? wcProcessing.data : []),
      ...(Array.isArray(wcOnHold.data)     ? wcOnHold.data     : []),
    ];

    const varMap = wcVariationMap(varResp.data.values, `${req.method} ${req.baseUrl}${req.path}`);

    // Exakter Vergleich + Pflichtspalten, siehe lshop/offen-Handler oben.
    const CTX_D   = 'GET /api/auftragsmonitor/dtf/offen';
    const ssotIdx = requireHeaderAny(erfHdr, ['SSOT-ID', 'ID'], CTX_D);
    const artIdx  = requireHeader(erfHdr, 'Artikelnummer', CTX_D);
    const nameIdx = requireHeader(erfHdr, 'Produktname', CTX_D);
    const ssotArt = {};
    erfRows.slice(1).forEach(r => {
      const id = (r[ssotIdx] ?? '').trim();
      if (id) ssotArt[id] = { artikelnummer: r[artIdx] ?? '', produktname: r[nameIdx] ?? '' };
    });

    const orderMap = {};
    wcOrders.forEach(o => {
      const lim = {};
      (o.line_items ?? []).forEach(li => { lim[String(li.id)] = li; });
      orderMap[String(o.id)] = { billing: o.billing, lim };
    });

    const groups = {};
    psRows.forEach(r => {
      if (normBool(r[PI.dtf] ?? false)) return;

      const orderId  = (r[PI.orderId]  ?? '').trim();
      const wcItemId = (r[PI.wcItemId] ?? '').trim();
      const sku      = (r[PI.sku]      ?? '').trim();
      const menge    = parseInt(r[PI.menge] ?? '1', 10) || 1;
      const artName  = (r[PI.artikelname] ?? '').trim();

      const ord = orderMap[orderId];
      if (!ord) return;

      const li = ord.lim[wcItemId];
      if (!li) return;

      const varInfo = varMap[String(li.variation_id ?? '')];
      let variante = '', varDetails = { e1: '', v1: '', e2: '', v2: '', e3: '', v3: '' };
      let ssotId = '';

      if (varInfo) {
        ssotId     = varInfo.ssotId;
        varDetails = { e1: varInfo.e1, v1: varInfo.v1, e2: varInfo.e2, v2: varInfo.v2, e3: varInfo.e3, v3: varInfo.v3 };
        variante   = buildVariante(varInfo.v1, varInfo.v2, varInfo.v3);
      } else {
        variante = (li.meta_data ?? [])
          .filter(m => !m.key.startsWith('_') && m.display_value)
          .map(m => m.display_value).join('·');
      }

      const art      = ssotArt[ssotId] ?? {};
      const groupKey = `${ssotId || sku}__${variante}`;
      const kunde    = `${ord.billing?.first_name ?? ''} ${ord.billing?.last_name ?? ''}`.trim();

      if (!groups[groupKey]) {
        groups[groupKey] = {
          groupKey,
          ssotId,
          artikelnummer:    art.artikelnummer || sku,
          produktname:      art.produktname   || artName,
          variante,
          varianteDetails:  varDetails,
          stueck:           0,
          betroffeneOrders: [],
        };
      }

      groups[groupKey].stueck += menge;

      const existing = groups[groupKey].betroffeneOrders.find(o => o.orderId === orderId);
      if (existing) {
        existing.stueck += menge;
        existing.wcItemIds.push(wcItemId);
      } else {
        groups[groupKey].betroffeneOrders.push({ orderId, kunde, stueck: menge, wcItemIds: [wcItemId] });
      }
    });

    res.json(Object.values(groups).sort((a, b) => b.stueck - a.stueck));
  } catch (err) { next(err); }
});

// ── GET /api/auftragsmonitor/dtf/protokoll?days=7 ────────────────────────────
router.get('/dtf/protokoll', async (req, res, next) => {
  try {
    const days   = Math.min(parseInt(req.query.days ?? '7', 10), 365);
    const sheets = await getSheets();
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sid(),
      range: `${TAB_DTF}!A1:G5000`,
    });
    const rows = data.values ?? [];
    if (rows.length <= 1) return res.json([]);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const result = rows.slice(1)
      .map(r => ({
        bestellId:        (r[0] ?? '').trim(),
        bestelldatum:     (r[1] ?? '').trim(),
        ssotId:           (r[2] ?? '').trim(),
        artikelnummer:    (r[3] ?? '').trim(),
        variante:         (r[4] ?? '').trim(),
        stueck:           parseInt(r[5] ?? '0', 10) || 0,
        betroffeneOrders: (r[6] ?? '').trim(),
      }))
      .filter(e => {
        if (!e.bestellId) return false;
        const d = new Date(e.bestelldatum);
        return !isNaN(d.getTime()) && d >= cutoff;
      })
      .reverse();

    res.json(result);
  } catch (err) { next(err); }
});

// ── POST /api/auftragsmonitor/dtf/bestellen ───────────────────────────────────
// Body: { ssotId, artikelnummer, variante, stueck, orderIds[], wcItemIds?: [{orderId, wcItemId}] }
router.post('/dtf/bestellen', async (req, res, next) => {
  try {
    const { ssotId = '', artikelnummer, variante = '', stueck, orderIds = [], wcItemIds = [] } = req.body;
    if (!artikelnummer || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: 'artikelnummer und orderIds erforderlich' });
    }

    const sheets        = await getSheets();
    const spreadsheetId = sid();

    // ── Bestell-ID generieren (DTFB-YYYY-NNNN) ──────────────────────────────
    const { data: dtfData } = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${TAB_DTF}!A1:A5000`,
    });
    const year   = new Date().getFullYear();
    const prefix = `DTFB-${year}-`;
    let maxSeq   = 0;
    (dtfData.values ?? []).slice(1).forEach(r => {
      const val = (r[0] ?? '').trim();
      if (val.startsWith(prefix)) {
        const n = parseInt(val.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    });
    const bestellId = `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;

    // ── Protokoll-Zeile schreiben (kein KW-Feld) ─────────────────────────────
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${TAB_DTF}!A1`, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[
        bestellId, new Date().toISOString(), ssotId, artikelnummer,
        variante, stueck ?? 0, orderIds.map(String).join(', '),
      ]] },
    });

    // ── DTF_bestellt = TRUE in Produktions_Status (Spalte G) ─────────────────
    const { data: psData } = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${TAB_PS}!A1:J5000`,
    });
    const psRows = psData.values ?? [];

    const updateRows = psZeilenFinden(psRows, { orderIds, artikelnummer, wcItemIds });

    if (updateRows.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updateRows.map(row => ({ range: `${TAB_PS}!G${row}`, values: [[true]] })),
        },
      });
    }

    res.json({ ok: true, bestellId, updated: updateRows.length });
  } catch (err) { next(err); }
});

// ── POST /api/auftragsmonitor/lshop/bestellen-bulk ───────────────────────────
// Body: { bestellungen: [{ ssotId, artikelnummer, variante, stueck, kw, orderIds[], wcItemIds? }] }
router.post('/lshop/bestellen-bulk', async (req, res, next) => {
  try {
    const { bestellungen } = req.body;
    if (!Array.isArray(bestellungen) || bestellungen.length === 0) {
      return res.status(400).json({ error: 'bestellungen Array erforderlich' });
    }

    const sheets        = await getSheets();
    const spreadsheetId = sid();
    const year          = new Date().getFullYear();
    const prefix        = `LSB-${year}-`;

    // Sequenz einmalig lesen, dann lokal inkrementieren
    const { data: lsbData } = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${TAB_LSB}!A1:A5000`,
    });
    let maxSeq = 0;
    (lsbData.values ?? []).slice(1).forEach(r => {
      const val = (r[0] ?? '').trim();
      if (val.startsWith(prefix)) {
        const n = parseInt(val.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    });

    // Produktions_Status einmalig lesen
    const { data: psData } = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${TAB_PS}!A1:J5000`,
    });
    const psRows = psData.values ?? [];

    const results = [];
    for (const b of bestellungen) {
      const { ssotId = '', artikelnummer, variante = '', stueck, kw = '', orderIds = [], wcItemIds = [] } = b;
      if (!artikelnummer || !Array.isArray(orderIds) || orderIds.length === 0) {
        results.push({ ok: false, error: 'artikelnummer und orderIds erforderlich', artikelnummer });
        continue;
      }
      maxSeq++;
      const bestellId = `${prefix}${String(maxSeq).padStart(4, '0')}`;
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${TAB_LSB}!A1`, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [[
            bestellId, new Date().toISOString(), ssotId, artikelnummer,
            variante, stueck ?? 0, kw, orderIds.map(String).join(', '),
          ]] },
        });

        const updateRows = psZeilenFinden(psRows, { orderIds, artikelnummer, wcItemIds });
        if (updateRows.length > 0) {
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
              valueInputOption: 'USER_ENTERED',
              data: updateRows.map(row => ({ range: `${TAB_PS}!F${row}`, values: [[true]] })),
            },
          });
        }
        results.push({ ok: true, bestellId, updated: updateRows.length, artikelnummer });
      } catch (err) {
        results.push({ ok: false, error: err.message ?? String(err), artikelnummer });
      }
    }

    const totalOrdered = results.filter(r => r.ok).length;
    const errors       = results.filter(r => !r.ok).map(r => ({ artikelnummer: r.artikelnummer, error: r.error }));
    res.json({ ok: errors.length === 0, totalOrdered, results, errors });
  } catch (err) { next(err); }
});

// ── POST /api/auftragsmonitor/dtf/bestellen-bulk ─────────────────────────────
// Body: { bestellungen: [{ ssotId, artikelnummer, variante, stueck, orderIds[], wcItemIds? }] }
router.post('/dtf/bestellen-bulk', async (req, res, next) => {
  try {
    const { bestellungen } = req.body;
    if (!Array.isArray(bestellungen) || bestellungen.length === 0) {
      return res.status(400).json({ error: 'bestellungen Array erforderlich' });
    }

    const sheets        = await getSheets();
    const spreadsheetId = sid();
    const year          = new Date().getFullYear();
    const prefix        = `DTFB-${year}-`;

    const { data: dtfData } = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${TAB_DTF}!A1:A5000`,
    });
    let maxSeq = 0;
    (dtfData.values ?? []).slice(1).forEach(r => {
      const val = (r[0] ?? '').trim();
      if (val.startsWith(prefix)) {
        const n = parseInt(val.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    });

    const { data: psData } = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${TAB_PS}!A1:J5000`,
    });
    const psRows = psData.values ?? [];

    const results = [];
    for (const b of bestellungen) {
      const { ssotId = '', artikelnummer, variante = '', stueck, orderIds = [], wcItemIds = [] } = b;
      if (!artikelnummer || !Array.isArray(orderIds) || orderIds.length === 0) {
        results.push({ ok: false, error: 'artikelnummer und orderIds erforderlich', artikelnummer });
        continue;
      }
      maxSeq++;
      const bestellId = `${prefix}${String(maxSeq).padStart(4, '0')}`;
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${TAB_DTF}!A1`, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [[
            bestellId, new Date().toISOString(), ssotId, artikelnummer,
            variante, stueck ?? 0, orderIds.map(String).join(', '),
          ]] },
        });

        const updateRows = psZeilenFinden(psRows, { orderIds, artikelnummer, wcItemIds });
        if (updateRows.length > 0) {
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
              valueInputOption: 'USER_ENTERED',
              data: updateRows.map(row => ({ range: `${TAB_PS}!G${row}`, values: [[true]] })),
            },
          });
        }
        results.push({ ok: true, bestellId, updated: updateRows.length, artikelnummer });
      } catch (err) {
        results.push({ ok: false, error: err.message ?? String(err), artikelnummer });
      }
    }

    const totalOrdered = results.filter(r => r.ok).length;
    const errors       = results.filter(r => !r.ok).map(r => ({ artikelnummer: r.artikelnummer, error: r.error }));
    res.json({ ok: errors.length === 0, totalOrdered, results, errors });
  } catch (err) { next(err); }
});

export default router;
