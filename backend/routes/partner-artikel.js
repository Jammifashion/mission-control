import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient as wcClientForShop } from '../lib/shopConfig.js';
import { berechnePartnerAnteil, parseKonfiguration } from '../utils/partner-kalkulation.js';
import { importiereFuerPartner, artikelAbgleich, abgleichMelden } from '../lib/partnerArtikel.js';
import { notify, buildArtikelAbgleichNachricht, buildAbgleichLebenszeichen } from '../lib/chatNotify.js';

const router = Router();

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

function getSheets() {
  return getGoogleAuth().then(auth => google.sheets({ version: 'v4', auth }));
}

const getWcClient = (req) => wcClientForShop(req?.query?.shop);

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

// Prüft, ob eine Partner-ID in 'Partner' ODER 'FP_Partner' existiert.
// Interne Bestellungen werden im gemeinsamen Sheet geführt; der Festpreis-Reiter
// nutzt FP-Partner-IDs, die nur im FP_Partner-Tab stehen.
async function partnerIdExists(sheets, sheetId, partnerId) {
  for (const tab of ['Partner', 'FP_Partner']) {
    try {
      const { header, rows } = await readTab(sheets, sheetId, tab);
      const idx = header.indexOf('Partner-ID');
      if (idx !== -1 && rows.some(r => (r[idx] ?? '') === partnerId)) return true;
    } catch { /* Tab evtl. nicht vorhanden – ignorieren */ }
  }
  return false;
}

// Partner-Name je Partner-ID nachschlagen – sucht in 'Partner' UND 'FP_Partner'
// (analog zu partnerIdExists, s.o.), da Interne Bestellungen im gemeinsamen Sheet
// geführt werden, Festpreis-Partner aber nur im FP_Partner-Tab stehen.
async function loadPartnerNames(sheets, sheetId) {
  const map = {};
  for (const tab of ['Partner', 'FP_Partner']) {
    try {
      const { header, rows } = await readTab(sheets, sheetId, tab);
      const idIdx = header.indexOf('Partner-ID');
      const nameIdx = header.indexOf('Name');
      if (idIdx === -1 || nameIdx === -1) continue;
      for (const r of rows) {
        const id = r[idIdx] ?? '';
        if (id && !map[id]) map[id] = r[nameIdx] ?? '';
      }
    } catch { /* Tab evtl. nicht vorhanden – ignorieren */ }
  }
  return map;
}

// Legt die Spalte 'Fulfillment' lazy an (Muster wie 'Kanal' in partnerPortal.js),
// falls sie fehlt. Bestandszeilen erhalten Default 'Beauftragt'. Gibt den
// Spaltenindex zurück.
async function ensureFulfillmentColumn(sheets, sheetId, header) {
  const idx = header.indexOf('Fulfillment');
  if (idx !== -1) return idx;
  const newIdx = header.length;
  const { data: colA } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: 'Partner_Interne_Bestellungen!A:A',
  });
  const totalRows = (colA.values ?? []).length; // inkl. Header-Zeile
  const col = colLetter(newIdx);
  const data = [{ range: `Partner_Interne_Bestellungen!${col}1`, values: [['Fulfillment']] }];
  if (totalRows > 1)
    data.push({
      range:  `Partner_Interne_Bestellungen!${col}2:${col}${totalRows}`,
      values: Array.from({ length: totalRows - 1 }, () => ['Beauftragt']),
    });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { valueInputOption: 'RAW', data },
  });
  return newIdx;
}

// Bugfix-Migration: Zeilen mit Status 'Neu' (vor dem Status-Bugfix angelegt, siehe
// PATCH /:id/intern/:rowId) einmalig auf 'offen' heben, lazy beim Lesen – damit sie
// in Saldo-Berechnung und Abrechnung ankommen. Mutiert rows in-place, damit die
// Response sofort den korrigierten Wert zeigt.
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

const isHonk = req => req.query.shop === 'honk';
// PA2: leer = fehlt (null), 0 = bewusst 0. Frueher lieferte toFloat fuer leer 0.
const zahlOderNull = v => (v === null || v === undefined || String(v).trim() === '') ? null : toFloat(v);
const TAB_HK_ARTIKEL = 'HK_Partner_Artikel';

// ── GET /:id/artikel ─────────────────────────────────────────────────────────
router.get('/:id/artikel', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();

    if (isHonk(req)) {
      const { header, rows } = await readTab(sheets, sheetId, TAB_HK_ARTIKEL);
      const h = col => header.indexOf(col);
      return res.json(rows.map(r => ({
        produktId:   r[h('Produkt-ID')]   ?? '',
        artikelname: r[h('Artikelname')]  ?? '',
        ekPreis:     zahlOderNull(r[h('EK-Preis-Netto')]),
        druckkosten: zahlOderNull(r[h('Druckkosten')]),
        versandart:  (r[h('Versandart')] ?? 'P').toUpperCase(),
      })));
    }

    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Artikel');
    const h = col => header.indexOf(col);
    res.json(rows
      .filter(r => (r[h('Partner-ID')] ?? '') === req.params.id)
      .map(r => ({
        artikelnummer: r[h('Artikelnummer')] ?? '',
        produktId:     r[h('Produkt-ID')]    ?? '',
        artikelname:   r[h('Artikelname')]   ?? '',
        ekPreis:       zahlOderNull(r[h('EK-Preis-Netto')]),
        druckkosten:   zahlOderNull(r[h('Druckkosten')]),
        versandart:    (r[h('Versandart')] ?? 'P').toUpperCase(),
        lizenzProzent: toFloat(r[h('Lizenz-%')]),
        letzteSynchro: r[h('Letzte-Synchro')] ?? '',
      })));
  } catch (err) { next(err); }
});

// ── POST /:id/artikel/import ─────────────────────────────────────────────────
// Knopf "Aus WC importieren". Logik in lib/partnerArtikel.js (PA2): Dubletten
// ueber die Produkt-ID, EK/Druck leer statt 0, EK aus L-Shop wo moeglich.
// JFN: Hauptkategorie des Partners + Unterkategorien, alle Status.
// HonkShop (?shop=honk): alle veroeffentlichten Produkte -> HK_Partner_Artikel.
router.post('/:id/artikel/import', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();
    let partner;
    if (isHonk(req)) {
      partner = { id: req.params.id, shop: 'honk' };
    } else {
      const p = await loadPartner(sheets, sheetId, req.params.id);
      if (!p) return res.status(404).json({ error: 'Partner nicht gefunden.' });
      partner = { id: p.id, hauptkategorie: p.hauptkategorie, shop: 'jfn' };
    }
    const r = await importiereFuerPartner({ sheets, sheetId, partner, wc: getWcClient(req) });
    const ohneEk = r.neu.filter(n => n.ekFehlt).length;
    res.json({
      neu:       r.neu.length,
      vorhanden: r.vorhanden,
      ...(r.kategorien ? { kategorien: r.kategorien } : {}),
      ohneEk,
      message:   r.neu.length
        ? `${r.neu.length} neue Artikel importiert${r.kategorien ? ` aus ${r.kategorien} Kategorie(n)` : ''}.`
          + (ohneEk ? ` ${ohneEk} ohne EK (bitte eintragen).` : '') + ' Druckkosten bitte eintragen.'
        : 'Keine neuen Artikel – alle bereits vorhanden.',
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ── POST /artikel/abgleich ───────────────────────────────────────────────────
// Taeglicher Abgleich (sync-partner-daily.yml, VOR sync-all): fehlende
// Partnerartikel fuer alle aktiven Lizenz-Partner + HonkShop anlegen, danach
// eine Meldung in den Google-Chat-Space der Partnerbestellungen, wenn es
// Neues oder Offenes gibt. Nie Festpreis-Partner, nie eine vorhandene Zeile.
router.post('/artikel/abgleich', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();
    const bericht = await artikelAbgleich({ sheets, sheetId, wcFuer: shop => wcClientForShop(shop) });
    // PA6: chat = "gesendet" | "nichts zu melden" | "fehlgeschlagen" | "lebenszeichen gesendet".
    const chat = await abgleichMelden({
      bericht, notify, baueMeldung: buildArtikelAbgleichNachricht, baueLebenszeichen: buildAbgleichLebenszeichen,
    });
    res.json({ ...bericht, chat });
  } catch (err) { next(err); }
});

// ── PATCH /:id/artikel/:artikelnummer ────────────────────────────────────────
// HonkShop: :artikelnummer ist die Produkt-ID; kein Partner-ID-Filter.
router.patch('/:id/artikel/:artikelnummer', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();

    if (isHonk(req)) {
      const { header, rows } = await readTab(sheets, sheetId, TAB_HK_ARTIKEL);
      const h = col => header.indexOf(col);
      const rowIdx = rows.findIndex(r => (r[h('Produkt-ID')] ?? '') === req.params.artikelnummer);
      if (rowIdx === -1)
        return res.status(404).json({ error: 'Artikel nicht gefunden.' });

      const { ekPreis, druckkosten, versandart } = req.body;
      const colMap = {
        'EK-Preis-Netto': ekPreis,
        'Druckkosten':    druckkosten,
        'Versandart':     versandart ? versandart.toUpperCase() : undefined,
      };
      const sheetRow = rows[rowIdx]._sheetRow;
      const data = Object.entries(colMap)
        .filter(([, v]) => v !== undefined)
        .map(([col, value]) => ({
          range: `${TAB_HK_ARTIKEL}!${colLetter(h(col))}${sheetRow}`,
          majorDimension: 'ROWS', values: [[value]],
        }));
      if (data.length === 0)
        return res.status(400).json({ error: 'Keine Felder zum Aktualisieren.' });
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
      });
      return res.json({ produktId: req.params.artikelnummer, updated: Object.keys(colMap).filter(k => colMap[k] !== undefined) });
    }

    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Artikel');
    const h = col => header.indexOf(col);

    const rowIdx = rows.findIndex(r =>
      (r[h('Partner-ID')] ?? '')    === req.params.id &&
      (r[h('Artikelnummer')] ?? '') === req.params.artikelnummer
    );
    if (rowIdx === -1)
      return res.status(404).json({ error: 'Artikel nicht gefunden.' });

    // Lizenz-% wird hier nicht mehr geschrieben (B16): der Satz gilt je Partner
    // und steht im Partner-Reiter. Die Spalte bleibt im Sheet, wird aber weder
    // gelesen noch gepflegt.
    const { ekPreis, druckkosten, versandart, lizenzProzent } = req.body;
    const colMap = {
      'EK-Preis-Netto': ekPreis,
      'Druckkosten':    druckkosten,
      'Versandart':     versandart ? versandart.toUpperCase() : undefined,
    };
    if (lizenzProzent !== undefined && Object.values(colMap).every(v => v === undefined))
      return res.status(400).json({ error: 'Lizenz-% wird nicht je Artikel gerechnet – Satz im Partner-Reiter pflegen.' });

    const sheetRow = rows[rowIdx]._sheetRow;
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
      vkNetto:                   parseFloat(req.body.vkBrutto ?? 0),
      ekPreis:                   parseFloat(req.body.ekPreis ?? 0),
      druckkosten:               parseFloat(req.body.druckkosten ?? 0),
      versandart:                req.body.versandart ?? 'P',
      portoModell:               req.body.portoModell ?? 'geteilt-50-50',
      anzahlArtikelInBestellung: parseInt(req.body.anzahlArtikelInBestellung ?? 1, 10),
      stueckzahl:                parseInt(req.body.stueckzahl ?? 1, 10),
      lizenzProzent:            parseFloat(req.body.lizenzProzent ?? 0),
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

    // Auch FP-Partner zulassen (Festpreis-Reiter nutzt denselben Endpoint).
    if (!(await partnerIdExists(sheets, sheetId, req.params.id)))
      return res.status(404).json({ error: 'Partner nicht gefunden.' });

    const anz = toFloat(anzahl);
    const ep  = toFloat(einzelpreis);
    const summe = Math.round(anz * ep * 100) / 100;

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Partner_Interne_Bestellungen!A:G',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[
        req.params.id, datum || todayDE(), bezeichnung, anz, ep, summe, 'offen',
      ]] },
    });

    res.status(201).json({
      partnerId: req.params.id, datum: datum || todayDE(),
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
      .map((r) => ({
        rowId:       r._sheetRow,
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

// ── GET /interne-bestellungen ─────────────────────────────────────────────────
// Alle internen Bestellungen (alle Partner) inkl. Kanal-Spalte – für den
// Auftragsmonitor (Sektion "Partner-Eigenaufträge"). Admin-Endpunkt (requireApiKey).
router.get('/interne-bestellungen', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Interne_Bestellungen');
    await migrateNeuStatus(sheets, sheetId, header, rows);
    const h = col => header.indexOf(col);
    const fulIdx = h('Fulfillment');
    const nameMap = await loadPartnerNames(sheets, sheetId);

    res.json(rows.map((r) => ({
      rowId:       r._sheetRow,
      partnerId:   r[h('Partner-ID')]  ?? '',
      partnerName: nameMap[r[h('Partner-ID')]] ?? null,
      datum:       r[h('Datum')]       ?? '',
      bezeichnung: r[h('Bezeichnung')] ?? '',
      anzahl:      toFloat(r[h('Anzahl')]),
      einzelpreis: toFloat(r[h('Einzelpreis')]),
      summe:       toFloat(r[h('Summe')]),
      status:      r[h('Status')]      ?? '',
      kanal:       r[h('Kanal')]       ?? '',
      fulfillment: (fulIdx !== -1 ? r[fulIdx] : '') || 'Beauftragt',
    })));
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

// ── PATCH /:id/intern/:rowId/fulfillment ──────────────────────────────────────
// Fulfillment-Status (Beauftragt/Erledigt) – komplett unabhängig vom Abrechnungs-
// Status (Spalte 'Status'). Nur für den Auftragsmonitor, Admin-only.
router.patch('/:id/intern/:rowId/fulfillment', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();

    const { fulfillment } = req.body;
    const VALID = ['Beauftragt', 'Erledigt'];
    if (!VALID.includes(fulfillment))
      return res.status(400).json({ error: `Ungültiger Fulfillment-Status. Erlaubt: ${VALID.join(', ')}` });

    const sheetRow = parseInt(req.params.rowId, 10);
    if (!sheetRow || sheetRow < 2)
      return res.status(400).json({ error: 'Ungültige rowId.' });

    const { header } = await readTab(sheets, sheetId, 'Partner_Interne_Bestellungen');
    const fulIdx = await ensureFulfillmentColumn(sheets, sheetId, header);
    const fulCol = colLetter(fulIdx);

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Partner_Interne_Bestellungen!${fulCol}${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[fulfillment]] },
    });

    res.json({ partnerId: req.params.id, rowId: sheetRow, fulfillment });
  } catch (err) { next(err); }
});

// ── PATCH /:id/intern/:rowId ──────────────────────────────────────────────────
// Body: { datum?, bezeichnung?, anzahl?, einzelpreis? } – editiert die Felder einer
// internen Bestellung. Summe wird bei Anzahl/Einzelpreis-Änderung neu berechnet.
// Abgerechnete Einträge sind gesperrt (Teil einer freigegebenen Abrechnung).
router.patch('/:id/intern/:rowId', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Interne_Bestellungen');
    const h = col => header.indexOf(col);

    const sheetRow = parseInt(req.params.rowId, 10);
    if (!sheetRow || sheetRow < 2)
      return res.status(400).json({ error: 'Ungültige rowId.' });

    // Zielzeile über echten Sheet-Zeilenindex finden (leerzeilen-sicher)
    const row = rows.find(r => r._sheetRow === sheetRow);
    if (!row)
      return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
    if ((row[h('Partner-ID')] ?? '') !== req.params.id)
      return res.status(404).json({ error: 'Bestellung gehört nicht zu diesem Partner.' });
    if ((row[h('Status')] ?? '') === 'abgerechnet')
      return res.status(409).json({ error: 'Abgerechnete Bestellungen können nicht bearbeitet werden.' });

    const { datum, bezeichnung, anzahl, einzelpreis } = req.body;

    const newAnzahl = anzahl      !== undefined ? toFloat(anzahl)      : toFloat(row[h('Anzahl')]);
    const newEp     = einzelpreis !== undefined ? toFloat(einzelpreis) : toFloat(row[h('Einzelpreis')]);

    const colMap = {
      'Datum':       datum,
      'Bezeichnung': bezeichnung,
      'Anzahl':      anzahl      !== undefined ? newAnzahl : undefined,
      'Einzelpreis': einzelpreis !== undefined ? newEp     : undefined,
    };
    // Summe nur neu setzen, wenn Anzahl oder Einzelpreis geändert wurde
    if (anzahl !== undefined || einzelpreis !== undefined)
      colMap['Summe'] = Math.round(newAnzahl * newEp * 100) / 100;

    // Bugfix: Portal-Eigenaufträge starten mit Status 'Neu' (ohne Preis) und blieben
    // bisher auch nach Bepreisung durch den Admin auf 'Neu' hängen – dadurch flossen
    // sie nie in Saldo/Abrechnung ein. Bei Bepreisung Status auf 'offen' heben, außer
    // er ist es (durch die Sperre oben ausgeschlossen: 'abgerechnet') bereits.
    if (einzelpreis !== undefined && (row[h('Status')] ?? '') !== 'offen')
      colMap['Status'] = 'offen';

    const data = Object.entries(colMap)
      .filter(([, v]) => v !== undefined)
      .map(([col, value]) => ({
        range: `Partner_Interne_Bestellungen!${colLetter(h(col))}${sheetRow}`,
        majorDimension: 'ROWS', values: [[value]],
      }));

    if (data.length === 0)
      return res.status(400).json({ error: 'Keine Felder zum Aktualisieren.' });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data },
    });

    res.json({ partnerId: req.params.id, rowId: sheetRow, summe: colMap['Summe'] });
  } catch (err) { next(err); }
});

// ── DELETE /:id/intern/:zeilenId ──────────────────────────────────────────────
// Löscht die Zeile aus Partner_Interne_Bestellungen anhand des echten Sheet-
// Zeilenindex (_sheetRow). Abgerechnete Einträge sind gesperrt (Teil einer
// freigegebenen Abrechnung).
router.delete('/:id/intern/:zeilenId', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Interne_Bestellungen');
    const h = col => header.indexOf(col);

    const sheetRow = parseInt(req.params.zeilenId, 10);
    if (!sheetRow || sheetRow < 2)
      return res.status(400).json({ error: 'Ungültige Zeilen-ID.' });

    const row = rows.find(r => r._sheetRow === sheetRow);
    if (!row)
      return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
    if ((row[h('Partner-ID')] ?? '') !== req.params.id)
      return res.status(404).json({ error: 'Bestellung gehört nicht zu diesem Partner.' });
    if ((row[h('Status')] ?? '') === 'abgerechnet')
      return res.status(409).json({ error: 'Abgerechnete Bestellungen können nicht gelöscht werden.' });

    // Numerische sheetId (gridId) für deleteDimension holen.
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties' });
    const sheetGid = meta.data.sheets.find(s => s.properties.title === 'Partner_Interne_Bestellungen')?.properties.sheetId;
    if (sheetGid === undefined)
      return res.status(503).json({ error: 'Sheet "Partner_Interne_Bestellungen" nicht gefunden.' });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheetGid,
              dimension: 'ROWS',
              startIndex: sheetRow - 1, // 0-basiert inclusive
              endIndex:   sheetRow,     // 0-basiert exclusive
            },
          },
        }],
      },
    });

    res.json({ partnerId: req.params.id, rowId: sheetRow, deleted: true });
  } catch (err) { next(err); }
});

export default router;
