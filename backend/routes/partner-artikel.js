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

function toFloat(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = parseFloat(val.toString().replace(',', '.'));
  return Number.isNaN(n) ? fallback : n;
}

function colLetter(idx) {
  let s = '';
  idx++;
  while (idx > 0) {
    idx--;
    s = String.fromCharCode(65 + (idx % 26)) + s;
    idx = Math.floor(idx / 26);
  }
  return s;
}

function todayDE() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

async function loadPartner(sheets, sheetId, partnerId) {
  const { header, rows } = await readTab(sheets, sheetId, 'Partner');
  const h = col => header.indexOf(col);
  const row = rows.find(r => (r[h('Partner-ID')] ?? '') === partnerId);
  if (!row) return null;
  return {
    id:            row[h('Partner-ID')]     ?? '',
    name:          row[h('Name')]           ?? '',
    hauptkategorie:(row[h('Hauptkategorie')] ?? '').trim(),
    lizenzProzent: toFloat(row[h('Lizenz-%')]),
    portoModell:   row[h('Porto-Modell')]   ?? 'geteilt-50-50',
  };
}

async function loadKonfiguration(sheets, sheetId) {
  const { header, rows } = await readTab(sheets, sheetId, 'Kalkulation_Fixkosten');
  return parseKonfiguration(rows, header);
}

function requireSheetId(res) {
  const sheetId = process.env.BUSINESS_SHEET_ID;
  if (!sheetId) {
    res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });
    return null;
  }
  return sheetId;
}

// ── GET /:id/artikel ─────────────────────────────────────────────────────────
router.get('/:id/artikel', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Artikel');
    const h = col => header.indexOf(col);

    res.json(rows
      .filter(r => (r[h('Partner-ID')] ?? '') === req.params.id)
      .map(r => ({
        artikelnummer: r[h('Artikelnummer')] ?? '',
        produktId:     r[h('Produkt-ID')]    ?? '',
        artikelname:   r[h('Artikelname')]   ?? '',
        ekPreis:       toFloat(r[h('EK-Preis-Netto')]),
        druckkosten:   toFloat(r[h('Druckkosten')]),
        versandart:    (r[h('Versandart')] ?? 'P').toUpperCase(),
        lizenzProzent: toFloat(r[h('Lizenz-%')]),
        letzteSynchro: r[h('Letzte-Synchro')] ?? '',
      })));
  } catch (err) { next(err); }
});

// ── POST /:id/artikel/import ─────────────────────────────────────────────────
// Holt alle WC-Produkte unter Partner.Hauptkategorie (inkl. Unterkategorien via
// Parent-Kette) und legt fehlende Zeilen in Partner_Artikel mit Defaults an.
router.post('/:id/artikel/import', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();

    const partner = await loadPartner(sheets, sheetId, req.params.id);
    if (!partner) return res.status(404).json({ error: 'Partner nicht gefunden.' });
    if (!partner.hauptkategorie)
      return res.status(400).json({ error: 'Partner hat keine Hauptkategorie konfiguriert.' });

    // 1. WC-Kategorien laden, Hauptkategorie + alle Nachkommen ermitteln
    const wc = getWcClient();
    const catMap = {}; // id → { name, parentId }
    for (let page = 1; ; page++) {
      const { data: cats } = await wc.get('products/categories', { per_page: 100, page });
      cats.forEach(c => { catMap[c.id] = { name: c.name.toLowerCase(), parentId: c.parent ?? 0 }; });
      if (cats.length < 100) break;
    }

    const hauptLower = partner.hauptkategorie.toLowerCase();
    const rootIds = Object.entries(catMap)
      .filter(([, c]) => c.name === hauptLower)
      .map(([id]) => parseInt(id, 10));
    if (!rootIds.length)
      return res.status(404).json({ error: `WC-Kategorie "${partner.hauptkategorie}" nicht gefunden.` });

    // Alle Nachkommen-IDs einsammeln (BFS)
    const allIds = new Set(rootIds);
    let frontier = [...rootIds];
    while (frontier.length) {
      const next = [];
      for (const [id, c] of Object.entries(catMap)) {
        const idNum = parseInt(id, 10);
        if (!allIds.has(idNum) && frontier.includes(c.parentId)) {
          allIds.add(idNum);
          next.push(idNum);
        }
      }
      frontier = next;
    }

    // 2. WC-Produkte aller relevanten Kategorien holen
    const products = [];
    for (const catId of allIds) {
      for (let page = 1; ; page++) {
        const { data: prods } = await wc.get('products', { category: catId, per_page: 100, page });
        products.push(...prods);
        if (prods.length < 100) break;
      }
    }
    // De-Duplizieren (ein Produkt kann in mehreren Kategorien sein)
    const uniqueProducts = [...new Map(products.map(p => [p.id, p])).values()];

    // 3. Bereits vorhandene Artikelnummern für den Partner laden
    const { header: aH, rows: aRows } = await readTab(sheets, sheetId, 'Partner_Artikel');
    const ah = col => aH.indexOf(col);
    const existingSkus = new Set(
      aRows.filter(r => (r[ah('Partner-ID')] ?? '') === partner.id)
           .map(r => r[ah('Artikelnummer')] ?? '')
    );

    // 4. Neue Zeilen schreiben
    const today = todayDE();
    const toWrite = [];
    for (const p of uniqueProducts) {
      const sku = p.sku || String(p.id);
      if (existingSkus.has(sku)) continue;
      existingSkus.add(sku);
      toWrite.push([
        partner.id,
        sku,
        String(p.id),
        p.name,
        0,                       // EK-Preis-Netto Default
        0,                       // Druckkosten Default
        'P',                     // Versandart Default
        partner.lizenzProzent,   // Lizenz-% aus Partner
        today,
      ]);
    }

    if (toWrite.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'Partner_Artikel!A:I',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: toWrite },
      });
    }

    res.json({
      neu:        toWrite.length,
      vorhanden:  uniqueProducts.length - toWrite.length,
      kategorien: allIds.size,
      message:    toWrite.length
        ? `${toWrite.length} neue Artikel aus ${allIds.size} Kategorie(n) importiert.`
        : 'Keine neuen Artikel – alle bereits vorhanden.',
    });
  } catch (err) { next(err); }
});

// ── PATCH /:id/artikel/:artikelnummer ────────────────────────────────────────
router.patch('/:id/artikel/:artikelnummer', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Artikel');
    const h = col => header.indexOf(col);

    const rowIdx = rows.findIndex(r =>
      (r[h('Partner-ID')] ?? '')    === req.params.id &&
      (r[h('Artikelnummer')] ?? '') === req.params.artikelnummer
    );
    if (rowIdx === -1)
      return res.status(404).json({ error: 'Artikel nicht gefunden.' });

    const { ekPreis, druckkosten, versandart, lizenzProzent } = req.body;
    const colMap = {
      'EK-Preis-Netto': ekPreis,
      'Druckkosten':    druckkosten,
      'Versandart':     versandart ? versandart.toUpperCase() : undefined,
      'Lizenz-%':       lizenzProzent,
    };

    const sheetRow = rowIdx + 2;
    const data = Object.entries(colMap)
      .filter(([, v]) => v !== undefined)
      .map(([col, value]) => ({
        range: `Partner_Artikel!${colLetter(h(col))}${sheetRow}`,
        majorDimension: 'ROWS',
        values: [[value]],
      }));

    if (data.length === 0)
      return res.status(400).json({ error: 'Keine Felder zum Aktualisieren.' });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data },
    });

    res.json({
      partnerId:     req.params.id,
      artikelnummer: req.params.artikelnummer,
      updated:       Object.keys(colMap).filter(k => colMap[k] !== undefined),
    });
  } catch (err) { next(err); }
});

// ── POST /kalkulation/preview ────────────────────────────────────────────────
// Body: { vkBrutto, ekPreis, druckkosten, versandart, portoModell,
//         anzahlArtikelInBestellung, lizenzProzent }
// Konfiguration wird serverseitig aus Kalkulation_Fixkosten gezogen.
router.post('/kalkulation/preview', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();
    const konfiguration = await loadKonfiguration(sheets, sheetId);

    const result = berechnePartnerAnteil({
      vkBrutto:                  parseFloat(req.body.vkBrutto ?? 0),
      ekPreis:                   parseFloat(req.body.ekPreis ?? 0),
      druckkosten:               parseFloat(req.body.druckkosten ?? 0),
      versandart:                req.body.versandart ?? 'P',
      portoModell:               req.body.portoModell ?? 'geteilt-50-50',
      anzahlArtikelInBestellung: parseInt(req.body.anzahlArtikelInBestellung ?? 1, 10),
      lizenzProzent:             parseFloat(req.body.lizenzProzent ?? 0),
      portoEinnahmeAnteil:       parseFloat(req.body.portoEinnahmeAnteil ?? 0),
      konfiguration,
    });

    res.json({ ...result, konfiguration });
  } catch (err) { next(err); }
});

// ── POST /:id/intern ─────────────────────────────────────────────────────────
// Body: { datum, bezeichnung, anzahl, einzelpreis }
router.post('/:id/intern', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();

    const { datum, bezeichnung, anzahl, einzelpreis } = req.body;
    if (!bezeichnung || anzahl === undefined || einzelpreis === undefined)
      return res.status(400).json({ error: 'bezeichnung, anzahl, einzelpreis sind erforderlich.' });

    const partner = await loadPartner(sheets, sheetId, req.params.id);
    if (!partner) return res.status(404).json({ error: 'Partner nicht gefunden.' });

    const anz = toFloat(anzahl);
    const ep  = toFloat(einzelpreis);
    const summe = Math.round(anz * ep * 100) / 100;

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Partner_Interne_Bestellungen!A:G',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[
        partner.id, datum || todayDE(), bezeichnung, anz, ep, summe, 'offen',
      ]] },
    });

    res.status(201).json({
      partnerId: partner.id, datum: datum || todayDE(),
      bezeichnung, anzahl: anz, einzelpreis: ep, summe, status: 'offen',
    });
  } catch (err) { next(err); }
});

// ── GET /:id/intern ──────────────────────────────────────────────────────────
router.get('/:id/intern', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Interne_Bestellungen');
    const h = col => header.indexOf(col);

    res.json(rows
      .map((r, idx) => ({
        rowId:       idx + 2,
        partnerId:   r[h('Partner-ID')]  ?? '',
        datum:       r[h('Datum')]       ?? '',
        bezeichnung: r[h('Bezeichnung')] ?? '',
        anzahl:      toFloat(r[h('Anzahl')]),
        einzelpreis: toFloat(r[h('Einzelpreis')]),
        summe:       toFloat(r[h('Summe')]),
        status:      r[h('Status')]      ?? '',
      }))
      .filter(r => r.partnerId === req.params.id));
  } catch (err) { next(err); }
});

// ── PATCH /:id/intern/:rowId/status ──────────────────────────────────────────
router.patch('/:id/intern/:rowId/status', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();
    const { header } = await readTab(sheets, sheetId, 'Partner_Interne_Bestellungen');

    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status fehlt.' });

    const statusCol = colLetter(header.indexOf('Status'));
    const sheetRow  = parseInt(req.params.rowId, 10);
    if (!sheetRow || sheetRow < 2)
      return res.status(400).json({ error: 'Ungültige rowId.' });

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Partner_Interne_Bestellungen!${statusCol}${sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[status]] },
    });

    res.json({ partnerId: req.params.id, rowId: sheetRow, status });
  } catch (err) { next(err); }
});

export default router;
