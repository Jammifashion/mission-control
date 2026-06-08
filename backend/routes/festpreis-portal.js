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

// Erlaubte WC-Status für neue Einträge (inkl. on-hold)
const FP_STATES_VERKAUF = ['processing', 'completed', 'on-hold'];
const FP_STATES_STORNO  = ['refunded', 'cancelled'];
const FP_STORNO_MARKER  = 'Storniert/Rückerstattet';

// Lädt WC-Bestellungen für mehrere Status paginiert. afterParam optional (ISO).
async function fetchFpOrders(wc, statuses, afterParam) {
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

// Erzeugt negative Gegeneinträge für FP_Verkäufe-Zeilen deren Order storniert wurde.
// FP_Verkäufe Spalten-Layout (A=0 … P=15, Q=16 neu):
//   0=Partner-ID, 1=Datum, 2=WC-Bestellnummer, 3=Artikelname, 4=Variante,
//   5=Stückzahl, 6=Festpreis-EK, 7=Handling, 8=Porto-Einnahme, 9=Porto-Kosten,
//   10=Versandnk, 11=PayPal, 12=Gesamt-Netto, 13=Gesamt-Brutto,
//   14=Status Abrechnung, 15=Produkt-ID, 16=Storno-Status (Q),
//   17=Artikelkategorie (R), 18=Festpreis (S), 19=Mehrkosten (T)
function buildFpStornoRows(vRows, stornoOrders) {
  const ORD_COL    = 2;
  const ART_COL    = 3;
  const VAR_COL    = 4;
  const PID_COL    = 0;
  const DATE_COL   = 1;
  const STATUS_COL = 14;
  const STORNO_COL = 16;
  const NEG_COLS   = new Set([5, 6, 7, 8, 9, 10, 11, 12, 13, 18, 19, 20, 21]); // inkl. Festpreis, Mehrkosten, VK-Netto, Handlingskosten
  const varKey = v => (v === '' || v === null || v === undefined) ? '0' : String(v);

  const refundDate = new Map(
    stornoOrders.map(o => [String(o.id), toDE(new Date(o.date_modified || o.date_created))])
  );

  // Bereits vorhandene Storno-Einträge nicht doppelt anlegen
  const stornoDone = new Set();
  for (const r of vRows) {
    if ((r[STORNO_COL] ?? '') !== '')
      stornoDone.add(`${r[ORD_COL]}|${r[ART_COL]}|${varKey(r[VAR_COL])}|${r[PID_COL]}`);
  }

  const out = [];
  for (const r of vRows) {
    const oid = String(r[ORD_COL] ?? '');
    if (!refundDate.has(oid)) continue;
    if ((r[STORNO_COL] ?? '') !== '') continue;  // Zeile ist selbst ein Gegeneintrag

    const dupKey = `${r[ORD_COL]}|${r[ART_COL]}|${varKey(r[VAR_COL])}|${r[PID_COL]}`;
    if (stornoDone.has(dupKey)) continue;
    stornoDone.add(dupKey);

    const counter = [];
    for (let i = 0; i < 22; i++) {
      let v = r[i] ?? '';
      if (NEG_COLS.has(i) && v !== '') v = -toFloat(v);
      counter[i] = v;
    }
    counter[DATE_COL]   = refundDate.get(oid) || r[DATE_COL] || toDE(new Date());
    counter[STATUS_COL] = 'offen';
    counter[STORNO_COL] = FP_STORNO_MARKER;
    out.push(counter);
  }
  return out;
}

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
  // Echten Sheet-Zeilenindex (_sheetRow) anhängen BEVOR Leerzeilen gefiltert werden,
  // damit Status-Updates die korrekte Zeile treffen (sonst verschiebt jede Leerzeile alles).
  rows.forEach((r, i) => { r._sheetRow = i + 2; });
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
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);

    const maxId = rows.reduce((max, r) => {
      const m = String(r[0] ?? '').match(/^FP-?(\d+)$/i);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    const partnerId = `FP-${String(maxId + 1).padStart(3, '0')}`;

    const kategorien = Array.isArray(req.body.kategorien)
      ? req.body.kategorien.join(',')
      : (req.body.kategorien ?? '');

    // Zeilenarray anhand der tatsächlichen Sheet-Header aufbauen (reihenfolge-sicher)
    const h = col => header.indexOf(col);
    const row = new Array(header.length).fill('');
    if (h('Partner-ID')  !== -1) row[h('Partner-ID')]  = partnerId;
    if (h('Name')        !== -1) row[h('Name')]        = name;
    if (h('Shop')        !== -1) row[h('Shop')]        = cleanShop;
    if (h('Aktiv')       !== -1) row[h('Aktiv')]       = aktiv;
    if (h('Notiz')       !== -1) row[h('Notiz')]       = notiz;
    if (h('Kategorien')  !== -1) row[h('Kategorien')]  = kategorien;

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${TAB_FP_PARTNER}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
    res.status(201).json({ partnerId, name, shop: cleanShop });
  } catch (err) { next(err); }
});

// ── PATCH /api/festpreis/partner/:partnerId ───────────────────────────────────
// Nur für Token-Feld (weiteres kann später ergänzt werden)
router.patch('/partner/:partnerId', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { token, aktiv, kategorien } = req.body;

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);
    const pidIdx   = header.indexOf('Partner-ID');
    const tokenIdx = header.indexOf('Token');
    const aktivIdx = header.indexOf('Aktiv');
    const katIdx   = header.indexOf('Kategorien');

    const rowIdx = rows.findIndex(r => (r[pidIdx] ?? '') === req.params.partnerId);
    if (rowIdx === -1) return res.status(404).json({ error: 'Partner nicht gefunden.' });

    const sheetRow = rows[rowIdx]._sheetRow;
    const colLetter = i => String.fromCharCode(65 + i);
    const updates = [];
    if (token !== undefined && tokenIdx !== -1)
      updates.push({ range: `${TAB_FP_PARTNER}!${colLetter(tokenIdx)}${sheetRow}`, values: [[token]] });
    if (aktiv !== undefined && aktivIdx !== -1)
      updates.push({ range: `${TAB_FP_PARTNER}!${colLetter(aktivIdx)}${sheetRow}`, values: [[aktiv]] });
    if (kategorien !== undefined && katIdx !== -1) {
      const katStr = Array.isArray(kategorien) ? kategorien.join(',') : String(kategorien ?? '');
      updates.push({ range: `${TAB_FP_PARTNER}!${colLetter(katIdx)}${sheetRow}`, values: [[katStr]] });
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'RAW', data: updates },
      });
    }
    res.json({ ok: true });
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
    const { festpreisEK, handlingGebuehr, versandart, artikelkategorie } = req.body;

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_ARTIKEL);
    const pidIdx  = header.indexOf('Partner-ID');
    const prodIdx = header.indexOf('Produkt-ID');
    const ekIdx   = header.indexOf('Festpreis-EK-Netto');
    const hgIdx   = header.indexOf('Handling-Gebühr');
    const vaIdx   = header.indexOf('Versandart');
    const akIdx   = header.indexOf('Artikelkategorie');

    const rowIdx = rows.findIndex(r =>
      (r[pidIdx] ?? '') === partnerId && String(r[prodIdx] ?? '') === String(produktId)
    );
    if (rowIdx === -1) return res.status(404).json({ error: 'Artikel nicht gefunden.' });

    const sheetRow = rows[rowIdx]._sheetRow;
    const updates = [];
    const colLetter = i => String.fromCharCode(65 + i);
    if (ekIdx !== -1 && festpreisEK !== undefined) updates.push({ range: `${TAB_FP_ARTIKEL}!${colLetter(ekIdx)}${sheetRow}`, values: [[Number(festpreisEK)]] });
    if (hgIdx !== -1 && handlingGebuehr !== undefined) updates.push({ range: `${TAB_FP_ARTIKEL}!${colLetter(hgIdx)}${sheetRow}`, values: [[Number(handlingGebuehr)]] });
    if (vaIdx !== -1 && versandart !== undefined) updates.push({ range: `${TAB_FP_ARTIKEL}!${colLetter(vaIdx)}${sheetRow}`, values: [[String(versandart).toUpperCase() === 'B' ? 'B' : 'P']] });
    if (akIdx !== -1 && artikelkategorie !== undefined) updates.push({ range: `${TAB_FP_ARTIKEL}!${colLetter(akIdx)}${sheetRow}`, values: [[String(artikelkategorie)]] });

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
// Liest Shop + Kategorien aus FP_Partner. Unterkategorien werden automatisch
// eingeschlossen. Body-Parameter werden nur als Fallback akzeptiert.
router.post('/artikel/:partnerId/import', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { partnerId } = req.params;

    const sheets = await getSheets();

    // Partner-Daten lesen (Shop + Kategorien)
    const { header: pH, rows: pRows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);
    const ph = col => pH.indexOf(col);
    const partnerRow = pRows.find(r => (r[ph('Partner-ID')] ?? '') === partnerId);
    if (!partnerRow) return res.status(404).json({ error: 'FP-Partner nicht gefunden.' });

    const shop = (partnerRow[ph('Shop')] ?? '').toLowerCase() === 'honk' ? 'honk' : 'jfn';
    const kategorienRaw = partnerRow[ph('Kategorien')] ?? req.body.kategorien ?? '';
    const kategorienIds = String(kategorienRaw).split(',').map(s => s.trim()).filter(Boolean);

    // Vorhandene Produkt-IDs dieses Partners ermitteln (Dedup)
    const { header: aH, rows: aRows } = await readTab(sheets, sheetId, TAB_FP_ARTIKEL);
    const pidCol    = aH.indexOf('Partner-ID');
    const prodIdCol = aH.indexOf('Produkt-ID');
    const existingIds = new Set(
      aRows.filter(r => (r[pidCol] ?? '') === partnerId).map(r => String(r[prodIdCol] ?? ''))
    );

    const wc = getWcClient(shop);

    // Ziel-Kategorie-IDs bestimmen (inkl. Unterkategorien)
    let targetCatIds = [];
    if (kategorienIds.length > 0) {
      const allCats = [];
      for (let page = 1; ; page++) {
        const { data } = await wc.get('products/categories', { per_page: 100, page });
        allCats.push(...data);
        if (data.length < 100) break;
      }
      // parent → [child-IDs]
      const children = {};
      for (const c of allCats) {
        if (c.parent) {
          if (!children[c.parent]) children[c.parent] = [];
          children[c.parent].push(c.id);
        }
      }
      // Rekursiv alle Nachfahren sammeln
      const expand = id => {
        const num = Number(id);
        const result = [num];
        for (const child of (children[num] ?? [])) result.push(...expand(child));
        return result;
      };
      const expanded = new Set();
      for (const id of kategorienIds) expand(id).forEach(i => expanded.add(i));
      targetCatIds = [...expanded];
    }

    // WC-Produkte laden
    const allProducts = [];
    const seenIds = new Set();
    if (targetCatIds.length > 0) {
      for (const catId of targetCatIds) {
        for (let page = 1; ; page++) {
          const { data } = await wc.get('products', { status: 'any', per_page: 100, page, category: catId });
          for (const p of data) {
            if (!seenIds.has(p.id)) { seenIds.add(p.id); allProducts.push(p); }
          }
          if (data.length < 100) break;
        }
      }
    } else {
      for (let page = 1; ; page++) {
        const { data } = await wc.get('products', { status: 'any', per_page: 100, page });
        allProducts.push(...data);
        if (data.length < 100) break;
      }
    }

    const toWrite = allProducts
      .filter(p => !existingIds.has(String(p.id)))
      .map(p => [
        partnerId,
        String(p.id),
        p.name || '',
        0,   // Festpreis-EK-Netto
        0,   // Handling-Gebühr
        'P', // Versandart
        (p.categories?.[0]?.name) || '',
        '',  // Artikelkategorie
      ]);

    if (toWrite.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${TAB_FP_ARTIKEL}!A:H`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: toWrite },
      });
    }

    res.json({ imported: toWrite.length, total: allProducts.length, kategorien: targetCatIds });
  } catch (err) { next(err); }
});

// ── GET /api/festpreis/artikel-kategorien ────────────────────────────────────
// Liefert alle Werte aus Spalte 'Kategorie' im Tab FP_Artikel_Kategorie.
router.get('/artikel-kategorien', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'FP_Artikel_Kategorie');
    const katIdx = header.indexOf('Kategorie');
    if (katIdx === -1) return res.json({ kategorien: [] });
    const kategorien = rows.map(r => r[katIdx] ?? '').filter(Boolean);
    res.json({ kategorien });
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
    res.json({ verkaeufe: filtered.map(r => ({ ...rowToObj(header, r), _rowId: r._sheetRow })) });
  } catch (err) { next(err); }
});

// ── GET /api/festpreis/verkaeufe/summary ─────────────────────────────────────
// Aggregiert FP_Verkäufe pro Produkt-ID. Parameter: partnerId, vonDatum,
// bisDatum (beide DD.MM.YYYY, optional), status (default: offen).
router.get('/verkaeufe/summary', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { partnerId, vonDatum, bisDatum } = req.query;
    const statusFilter = req.query.status ?? 'offen';

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_VERKAEUFE);
    const vh = col => header.indexOf(col);

    const von = vonDatum ? parseDate(vonDatum) : null;
    const bis = bisDatum ? parseDate(bisDatum) : null;

    const filtered = rows.filter(r => {
      if (partnerId && (r[vh('Partner-ID')] ?? '') !== partnerId) return false;
      if ((r[vh('Status Abrechnung')] ?? '').toLowerCase() !== statusFilter.toLowerCase()) return false;
      if ((r[vh('Storno-Status')] ?? '') !== '') return false; // Storno-Gegenbuchungen ausschließen
      if (von || bis) {
        const d = parseDate(r[vh('Datum')] ?? '');
        if (von && d && d < von) return false;
        if (bis && d && d > bis) return false;
      }
      return true;
    });

    // Aggregieren pro Produkt-ID
    const gruppen = {};
    for (const r of filtered) {
      const pid = String(r[vh('Produkt-ID')] ?? 'unbekannt');
      if (!gruppen[pid]) {
        gruppen[pid] = {
          produktId:       pid,
          artikelname:     r[vh('Artikelname')]    ?? '',
          stueckzahl:      0,
          ekGesamt:        0,
          handlingGesamt:  0,
          portoEinnahmen:  0,
          portoKosten:     0,
          versandnkGesamt: 0,
          paypalGesamt:    0,
          nettoGesamt:     0,
          bruttoGesamt:    0,
        };
      }
      const g = gruppen[pid];
      g.stueckzahl      += toFloat(r[vh('Stückzahl')]);
      g.ekGesamt        += toFloat(r[vh('Festpreis-EK-Netto')]);
      g.handlingGesamt  += toFloat(r[vh('Handling-Gebühr')]);
      g.portoEinnahmen  += toFloat(r[vh('Porto-Einnahme')]);
      g.portoKosten     += toFloat(r[vh('Porto-Kosten')]);
      g.versandnkGesamt += toFloat(r[vh('Versandnebenkosten')]);
      g.paypalGesamt    += toFloat(r[vh('PayPal-Kosten')]);
      g.nettoGesamt     += toFloat(r[vh('Gesamt-Partner-Netto')]);
      g.bruttoGesamt    += toFloat(r[vh('Gesamt-Partner-Brutto')]);
    }

    const round2 = n => Math.round(n * 100) / 100;
    const produkteGruppen = Object.values(gruppen).map(g => ({
      ...g,
      ekGesamt:        round2(g.ekGesamt),
      handlingGesamt:  round2(g.handlingGesamt),
      portoEinnahmen:  round2(g.portoEinnahmen),
      portoKosten:     round2(g.portoKosten),
      versandnkGesamt: round2(g.versandnkGesamt),
      paypalGesamt:    round2(g.paypalGesamt),
      nettoGesamt:     round2(g.nettoGesamt),
      bruttoGesamt:    round2(g.bruttoGesamt),
    }));

    const summen = produkteGruppen.reduce((s, g) => ({
      stueckzahl:      s.stueckzahl      + g.stueckzahl,
      ekGesamt:        round2(s.ekGesamt        + g.ekGesamt),
      handlingGesamt:  round2(s.handlingGesamt  + g.handlingGesamt),
      portoEinnahmen:  round2(s.portoEinnahmen  + g.portoEinnahmen),
      portoKosten:     round2(s.portoKosten     + g.portoKosten),
      versandnkGesamt: round2(s.versandnkGesamt + g.versandnkGesamt),
      paypalGesamt:    round2(s.paypalGesamt    + g.paypalGesamt),
      nettoGesamt:     round2(s.nettoGesamt     + g.nettoGesamt),
      bruttoGesamt:    round2(s.bruttoGesamt    + g.bruttoGesamt),
    }), { stueckzahl:0, ekGesamt:0, handlingGesamt:0, portoEinnahmen:0, portoKosten:0, versandnkGesamt:0, paypalGesamt:0, nettoGesamt:0, bruttoGesamt:0 });

    res.json({ produkteGruppen, summen, positionen: filtered.length });
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

    // 2. FP_Artikel → Map: produktId → [{ partnerId, festpreisEK, handlingGebuehr, versandart, artikelkategorie }]
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
        partnerId:       pid,
        festpreisEK:     toFloat(r[ah('Festpreis-EK-Netto')]),
        handlingGebuehr: toFloat(r[ah('Handling-Gebühr')]),
        versandart:      ((r[ah('Versandart')] ?? 'P').toUpperCase() === 'B') ? 'B' : 'P',
        artikelkategorie: r[ah('Artikelkategorie')] ?? '',
      });
    }
    if (!Object.keys(artikelMap).length)
      return res.json({ synced: 0, orders: 0, message: 'Keine FP-Artikel konfiguriert.' });

    // 2b. FP_Artikel_Kategorie → Map: `${partnerId}|${kategorie}` → festpreis
    const { header: akH, rows: akRows } = await readTab(sheets, sheetId, 'FP_Artikel_Kategorie');
    const akh = col => akH.indexOf(col);
    const festpreisMap = {};
    for (const r of akRows) {
      const pid = r[akh('Festpreispartner-ID')] ?? '';
      const kat = r[akh('Kategorie')] ?? '';
      if (pid && kat) festpreisMap[`${pid}|${kat}`] = {
        festpreis:      toFloat(r[akh('Festpreis')]),
        handlingskosten: toFloat(r[akh('Handlingskosten')]),
      };
    }

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
    // Stornos voll-historisch ohne after-Filter – fängt auch ältere Refunds.
    const shopsNeeded = new Set(Object.values(partnerShopMap));
    const ordersByShop = {};
    const stornoByShop = {};
    for (const shop of shopsNeeded) {
      const wc = getWcClient(shop);
      ordersByShop[shop] = await fetchFpOrders(wc, FP_STATES_VERKAUF, afterParam);
      stornoByShop[shop] = await fetchFpOrders(wc, FP_STATES_STORNO, null);
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
            // PayPal berechnet die Gebühr auf den Brutto-Betrag, den der Kunde zahlt.
            const paypalKosten       = (itemNetto * (1 + k.mwstProzent / 100)) * (k.paypalProzent / 100)
                                     + (k.paypalPauschale * anteil);

            const artikelkategorie = e.artikelkategorie || '';
            const katPreis = festpreisMap[`${e.partnerId}|${artikelkategorie}`] ?? { festpreis: 0, handlingskosten: 0 };
            const festpreis      = katPreis.festpreis;
            const handlingskosten = katPreis.handlingskosten;

            const { netto, brutto } = berechneFestpreisAnteil({
              festpreisEK: festpreis,
              handlingskosten,
              portoEinnahmeAnteil,
              portoKostenAnteil,
              versandnkAnteil,
              paypalKosten,
              mwstProzent: k.mwstProzent,
            });

            toWrite.push([
              e.partnerId,           // A 0
              orderDate,             // B 1
              order.id,              // C 2
              artikelname,           // D 3
              item.variation_id || 0, // E 4
              item.quantity,         // F 5
              e.festpreisEK,         // G 6 (legacy, aus FP_Artikel)
              e.handlingGebuehr,     // H 7 (legacy, aus FP_Artikel)
              Math.round(portoEinnahmeAnteil * 100) / 100,  // I 8
              Math.round(portoKostenAnteil * 100) / 100,    // J 9
              Math.round(versandnkAnteil * 100) / 100,      // K 10
              Math.round(paypalKosten * 100) / 100,         // L 11
              netto,                 // M 12 Gesamt-Partner-Netto
              brutto,                // N 13 Gesamt-Partner-Brutto
              'offen',               // O 14 Status Abrechnung
              item.product_id,       // P 15 Produkt-ID
              '',                    // Q 16 Storno-Status (leer)
              artikelkategorie,      // R 17 Artikelkategorie
              festpreis,             // S 18 Festpreis (aus FP_Artikel_Kategorie)
              0,                     // T 19 Mehrkosten (manuell, default 0)
              Math.round(itemNetto * 100) / 100, // U 20 VK-Netto
              handlingskosten,       // V 21 Handlingskosten (aus FP_Artikel_Kategorie)
            ]);
          }
        }
      }
    }

    // Storno-Gegeneinträge: alle Shops zusammenführen, dann gegen vRows prüfen
    const allStornoOrders = Object.values(stornoByShop).flat();
    const stornoRows = buildFpStornoRows(vRows, allStornoOrders);

    const allRows = [...toWrite, ...stornoRows];
    if (allRows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${TAB_FP_VERKAEUFE}!A:V`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: allRows },
      });
    }

    const totalOrders = Object.values(ordersByShop).reduce((s, o) => s + o.length, 0);
    res.json({
      synced:    toWrite.length,
      storniert: stornoRows.length,
      orders:    totalOrders,
      afterParam: afterParam || null,
      message: toWrite.length || stornoRows.length
        ? `${[toWrite.length && `${toWrite.length} neue`, stornoRows.length && `${stornoRows.length} stornierte`].filter(Boolean).join(' + ')} Einträge synchronisiert.`
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

    // Zugehörige FP_Verkäufe auf 'abgerechnet' setzen – über echten Sheet-Zeilenindex
    // (_sheetRow) statt Positions-Match, daher kein erneuter Read nötig.
    const statusColLetter = String.fromCharCode(65 + vh('Status Abrechnung'));
    const updates = offene.map(r => ({
      range: `${TAB_FP_VERKAEUFE}!${statusColLetter}${r._sheetRow}`,
      values: [['abgerechnet']],
    }));

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'RAW', data: updates },
      });
    }

    res.status(201).json({ abrechnungsId, partnerId, gesamtNetto, gesamtBrutto, positionen: offene.length });
  } catch (err) { next(err); }
});

// ── PATCH /api/festpreis/abrechnungen/:id/status ─────────────────────────────
router.patch('/abrechnungen/:id/status', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { status } = req.body;
    const ALLOWED = new Set(['entwurf', 'freigegeben', 'bezahlt']);
    if (!status || !ALLOWED.has(status))
      return res.status(400).json({ error: `Ungültiger Status. Erlaubt: ${[...ALLOWED].join(', ')}` });

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_ABRECHNUNGEN);
    const idIdx = header.indexOf('Abrechnungs-ID');
    const stIdx = header.indexOf('Status');
    const rowIdx = rows.findIndex(r => (r[idIdx] ?? '') === req.params.id);
    if (rowIdx === -1) return res.status(404).json({ error: 'Abrechnung nicht gefunden.' });

    const sheetRow = rows[rowIdx]._sheetRow;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${TAB_FP_ABRECHNUNGEN}!${String.fromCharCode(65 + stIdx)}${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[status]] },
    });
    res.json({ ok: true, abrechnungsId: req.params.id, status });
  } catch (err) { next(err); }
});

// ── GET /api/festpreis/preise ─────────────────────────────────────────────────
// Liest FP_Artikel_Kategorie: Kategorie | Festpreispartner-ID | Festpreis
router.get('/preise', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'FP_Artikel_Kategorie');
    res.json({ preise: rows.map(r => ({ ...rowToObj(header, r), _rowId: r._sheetRow })) });
  } catch (err) { next(err); }
});

// ── POST /api/festpreis/preise ────────────────────────────────────────────────
router.post('/preise', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { kategorie, partnerId, festpreis, handlingskosten } = req.body;
    if (!kategorie || !partnerId) return res.status(400).json({ error: 'kategorie und partnerId sind erforderlich.' });
    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'FP_Artikel_Kategorie!A:D',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[kategorie, partnerId, toFloat(festpreis), toFloat(handlingskosten)]] },
    });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ── PATCH /api/festpreis/preise/:rowId ───────────────────────────────────────
router.patch('/preise/:rowId', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheetRow = parseInt(req.params.rowId, 10);
    if (!sheetRow || sheetRow < 2) return res.status(400).json({ error: 'Ungültige rowId.' });
    const { festpreis, handlingskosten } = req.body;
    const sheets = await getSheets();
    const updates = [];
    if (festpreis      !== undefined) updates.push({ range: `FP_Artikel_Kategorie!C${sheetRow}`, values: [[toFloat(festpreis)]] });
    if (handlingskosten !== undefined) updates.push({ range: `FP_Artikel_Kategorie!D${sheetRow}`, values: [[toFloat(handlingskosten)]] });
    if (!updates.length) return res.status(400).json({ error: 'Kein Feld zum Aktualisieren.' });
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'RAW', data: updates },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/festpreis/preise/:rowId ──────────────────────────────────────
router.delete('/preise/:rowId', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheetRow = parseInt(req.params.rowId, 10);
    if (!sheetRow || sheetRow < 2) return res.status(400).json({ error: 'Ungültige rowId.' });
    const sheets = await getSheets();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties' });
    const sheetGid = meta.data.sheets.find(s => s.properties.title === 'FP_Artikel_Kategorie')?.properties.sheetId;
    if (sheetGid === undefined) return res.status(404).json({ error: 'Tab nicht gefunden.' });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ deleteDimension: { range: { sheetId: sheetGid, dimension: 'ROWS', startIndex: sheetRow - 1, endIndex: sheetRow } } }] },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── PATCH /api/festpreis/verkaeufe-eintrag/:rowId ────────────────────────────
// Aktualisiert Mehrkosten (Spalte T) einer einzelnen FP_Verkäufe-Zeile.
router.patch('/verkaeufe-eintrag/:rowId', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheetRow = parseInt(req.params.rowId, 10);
    if (!sheetRow || sheetRow < 2) return res.status(400).json({ error: 'Ungültige rowId.' });
    const { mehrkosten } = req.body;
    if (mehrkosten === undefined) return res.status(400).json({ error: 'mehrkosten fehlt.' });
    const sheets = await getSheets();
    const { header } = await readTab(sheets, sheetId, TAB_FP_VERKAEUFE);
    const mkIdx = header.indexOf('Mehrkosten');
    if (mkIdx === -1) return res.status(400).json({ error: 'Spalte Mehrkosten nicht im Sheet.' });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${TAB_FP_VERKAEUFE}!${String.fromCharCode(65 + mkIdx)}${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[toFloat(mehrkosten)]] },
    });
    res.json({ ok: true, sheetRow });
  } catch (err) { next(err); }
});

export default router;
