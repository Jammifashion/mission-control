import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const router = Router();

const TAB_VARIANTEN    = 'Varianten';
const VARIANTEN_COLS   = [
  'SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3',
  'Preis', 'Aktiv', 'WC_Variation_ID', 'Google_Farbe',
];
// 0-basierte Spalten-Indizes im Varianten-Reiter
const VI = Object.fromEntries(VARIANTEN_COLS.map((c, i) => [c, i]));

function sheetId() {
  if (!process.env.GOOGLE_SHEET_ID) {
    throw new Error('GOOGLE_SHEET_ID fehlt in .env');
  }
  return process.env.GOOGLE_SHEET_ID;
}

async function getSheets() {
  const auth = await getGoogleAuth();
  return google.sheets({ version: 'v4', auth });
}

function rowsToObjects(rows) {
  if (!rows?.length) return [];
  const [headers, ...data] = rows;
  return data
    .filter(row => row.some(cell => cell?.trim()))
    .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
}

function norm(s) { return String(s).toLowerCase().replace(/[\s\-_]+/g, ''); }

function normalizeAktiv(val) {
  if (typeof val === 'boolean') return val;
  const s = String(val).toUpperCase().trim();
  return s === 'TRUE' || s === 'WAHR';
}

// Baut eine Erfassungsmaske-Zeile – B-Slot-Spalten werden nicht mehr beschrieben (deprecated)
function buildRow(headers, body, ssotId) {
  const flat = {
    ...body,
    'SSOT-ID':      ssotId,
    'ID':           ssotId,
    'Status Shop':  body['Status Shop']  || body.statusShop  || '',
    'SEO_Status':   body['SEO_Status']   || body.seoStatus   || '',
    'Produkt-ID':   body['Produkt-ID']   || body.produktId   || '',
    'Datum':        body['Datum'] || new Date().toLocaleDateString('de-DE'),
  };
  delete flat.varianten;
  delete flat.row;

  function getField(header) {
    if (flat[header] !== undefined) return String(flat[header]);
    const hn  = norm(header);
    const hit = Object.entries(flat).find(([k]) => norm(k) === hn);
    return hit ? String(hit[1]) : '';
  }

  return headers.map(h => getField(h));
}

async function readRange(tab, range = 'A1:Z1000') {
  const sheets = await getSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${tab}!${range}`,
  });
  return data.values ?? [];
}

// Gibt die numerische sheetId des Varianten-Reiters zurück (für batchUpdate/deleteDimension)
async function getVariantenSheetId(sheets, spreadsheetId) {
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });
  const sheet = data.sheets.find(s => s.properties.title === TAB_VARIANTEN);
  if (!sheet) throw new Error(`Reiter "${TAB_VARIANTEN}" nicht gefunden`);
  return sheet.properties.sheetId;
}

// Löscht alle bestehenden Varianten-Zeilen für eine SSOT-ID und schreibt neue
async function writeVariantenForSsotId(sheets, spreadsheetId, ssotId, varianten) {
  if (!Array.isArray(varianten) || varianten.length === 0) return;

  const [tabSheetId, varRows] = await Promise.all([
    getVariantenSheetId(sheets, spreadsheetId),
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${TAB_VARIANTEN}!A1:L2000`,
    }).then(r => r.data.values ?? []),
  ]);

  // Zeilen-Indizes (0-basiert) mit dieser SSOT-ID finden (Index 0 = Header → überspringen)
  const toDelete = [];
  for (let i = 1; i < varRows.length; i++) {
    if ((varRows[i][VI['SSOT-ID']] ?? '').trim() === ssotId) {
      toDelete.push(i);
    }
  }

  // Absteigend löschen damit Indizes nicht verrutschen
  if (toDelete.length > 0) {
    const deleteRequests = toDelete
      .sort((a, b) => b - a)
      .map(rowIndex => ({
        deleteDimension: {
          range: {
            sheetId:    tabSheetId,
            dimension:  'ROWS',
            startIndex: rowIndex,
            endIndex:   rowIndex + 1,
          },
        },
      }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: deleteRequests },
    });
  }

  // Neue Zeilen aufbauen
  const newRows = varianten.map((v, i) => [
    ssotId,
    v.nr ?? (i + 1),
    v.e1 ?? '', v.v1 ?? '',
    v.e2 ?? '', v.v2 ?? '',
    v.e3 ?? '', v.v3 ?? '',
    v.preis ?? '',
    typeof v.aktiv === 'boolean' ? v.aktiv : true,
    v.wcVariationId ?? '',
    v.googleFarbe   ?? '',
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range:            `${TAB_VARIANTEN}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody:      { values: newRows },
  });
}

// ── GET /api/sheets/lieferzeiten ─────────────────────────────────────────────
router.get('/lieferzeiten', async (req, res, next) => {
  try {
    const rows = await readRange('Lieferzeit');
    const objects = rowsToObjects(rows);
    const key = objects[0] ? Object.keys(objects[0]).find(k => k.toLowerCase().includes('lieferzeit')) ?? Object.keys(objects[0])[0] : 'Lieferzeit';
    res.json(objects.map(r => r[key]).filter(Boolean));
  } catch (err) { next(err); }
});

// ── GET /api/sheets/versandklassen ───────────────────────────────────────────
router.get('/versandklassen', async (req, res, next) => {
  try {
    const rows = await readRange('Versandklasse');
    const objects = rowsToObjects(rows);
    const key = objects[0] ? Object.keys(objects[0]).find(k => k.toLowerCase().includes('versand')) ?? Object.keys(objects[0])[0] : 'Versandklasse';
    res.json(objects.map(r => r[key]).filter(Boolean));
  } catch (err) { next(err); }
});

// ── GET /api/sheets/kategorien ───────────────────────────────────────────────
router.get('/kategorien', async (req, res, next) => {
  try {
    const rows = await readRange('Struktur_Kategorien');
    const objects = rowsToObjects(rows);
    res.json(objects.filter(r => r['Kategoriename']?.trim()));
  } catch (err) { next(err); }
});

// ── GET /api/sheets/social-media?kategorieId={id} ────────────────────────────
router.get('/social-media', async (req, res, next) => {
  try {
    const kategorieId = (req.query.kategorieId ?? '').trim();
    if (!kategorieId) return res.json({ instagram: '', tiktok: '' });

    const rows    = await readRange('Struktur_Kategorien');
    const objects = rowsToObjects(rows);
    if (!objects.length) return res.json({ instagram: '', tiktok: '' });

    const first      = objects[0];
    const nummerKey  = Object.keys(first).find(k => k.toLowerCase().includes('kategorienummer')) ?? 'Kategorienummer';
    const instaKey   = Object.keys(first).find(k => k.toLowerCase().includes('instagram'))      ?? 'Instagram URL';
    const tiktokKey  = Object.keys(first).find(k => k.toLowerCase().includes('tiktok'))         ?? 'TikTok URL';

    const withUrls = objects.find(r =>
      String(r[nummerKey] ?? '').trim() === kategorieId &&
      (r[instaKey]?.trim() || r[tiktokKey]?.trim())
    );
    const match = withUrls || objects.find(r => String(r[nummerKey] ?? '').trim() === kategorieId);

    if (!match) return res.json({ instagram: '', tiktok: '' });

    res.json({
      instagram: match[instaKey]  ? match[instaKey].trim()  : '',
      tiktok:    match[tiktokKey] ? match[tiktokKey].trim() : '',
    });
  } catch (err) { next(err); }
});

// ── GET /api/sheets/attribute ────────────────────────────────────────────────
router.get('/attribute', async (req, res, next) => {
  try {
    const rows = await readRange('Struktur_Attribute');
    const objects = rowsToObjects(rows);

    const eigenschaftKey = Object.keys(objects[0] ?? {}).find(k => k.toLowerCase().includes('eigenschaft')) ?? 'Eigenschaft';
    const begriffKey     = Object.keys(objects[0] ?? {}).find(k => k.toLowerCase().includes('begriff'))     ?? 'Begriff';

    const grouped = objects.reduce((acc, row) => {
      const eigenschaft = row[eigenschaftKey]?.trim();
      const begriff     = row[begriffKey]?.trim();
      if (!eigenschaft) return acc;
      if (!acc[eigenschaft]) acc[eigenschaft] = [];
      if (begriff) acc[eigenschaft].push(begriff);
      return acc;
    }, {});

    res.json(
      Object.entries(grouped).map(([eigenschaft, begriffe]) => ({ eigenschaft, begriffe }))
    );
  } catch (err) { next(err); }
});

// ── GET /api/sheets/varianten?ssotId=JFN-2026-XXXX ──────────────────────────
router.get('/varianten', async (req, res, next) => {
  try {
    const ssotId = (req.query.ssotId ?? '').trim();
    if (!ssotId) return res.status(400).json({ error: 'ssotId fehlt' });

    const rows = await readRange(TAB_VARIANTEN, 'A1:L2000');
    if (!rows.length) return res.json({ ssotId, varianten: [] });

    const varianten = rows
      .slice(1)
      .filter(r => (r[VI['SSOT-ID']] ?? '').trim() === ssotId)
      .map(r => ({
        nr:           parseInt(r[VI['Varianten-Nr']] ?? '0', 10) || 0,
        e1:           r[VI['E1']]  ?? '',
        v1:           r[VI['V1']]  ?? '',
        e2:           r[VI['E2']]  ?? '',
        v2:           r[VI['V2']]  ?? '',
        e3:           r[VI['E3']]  ?? '',
        v3:           r[VI['V3']]  ?? '',
        preis:        parseFloat(r[VI['Preis']] ?? '') || 0,
        aktiv:        normalizeAktiv(r[VI['Aktiv']] ?? ''),
        wcVariationId: parseInt(r[VI['WC_Variation_ID']] ?? '', 10) || null,
        googleFarbe:  r[VI['Google_Farbe']] ?? '',
      }))
      .sort((a, b) => a.nr - b.nr);

    res.json({ ssotId, varianten });
  } catch (err) { next(err); }
});

// ── GET /api/sheets/erfassung/by-wc-id?id={wcId} ────────────────────────────
router.get('/erfassung/by-wc-id', async (req, res, next) => {
  try {
    const wcId = (req.query.id ?? '').trim();
    if (!wcId) return res.json({ ssotId: null });

    const sheets = await getSheets();
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId(),
      range: 'Erfassungsmaske!A1:BZ2000',
    });
    const rows    = data.values ?? [];
    const headers = rows[0] ?? [];

    const ssotIdx      = headers.findIndex(h => /ssot.?id|^id$/i.test(h));
    const produktIdIdx = headers.findIndex(h => norm(h) === norm('Produkt-ID'));
    const statusIdx    = headers.findIndex(h => norm(h) === norm('Status'));

    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][produktIdIdx] ?? '').trim() === wcId) {
        return res.json({
          ssotId: rows[i][ssotIdx]  ?? '',
          row:    i + 1,
          status: rows[i][statusIdx] ?? '',
        });
      }
    }
    res.json({ ssotId: null });
  } catch (err) { next(err); }
});

// ── GET /api/sheets/erfassung/list ───────────────────────────────────────────
router.get('/erfassung/list', async (req, res, next) => {
  try {
    const sheets = await getSheets();
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId(),
      range: 'Erfassungsmaske!A1:BZ2000',
    });
    const rows    = data.values ?? [];
    const headers = rows[0] ?? [];

    const statusIdx  = headers.findIndex(h => norm(h) === norm('Status'));
    const ssotIdx    = headers.findIndex(h => /ssot.?id|^id$/i.test(h));
    const artNrIdx   = headers.findIndex(h => norm(h) === norm('Artikelnummer'));
    const nameIdx    = headers.findIndex(h => norm(h) === norm('Produktname'));

    const drafts = [];
    rows.slice(1).forEach((row, i) => {
      const rowStatus = (row[statusIdx] ?? '').trim().toLowerCase();
      if (rowStatus !== 'entwurf' && rowStatus !== 'draft') return;
      const rowObj = Object.fromEntries(headers.map((h, hi) => [h, row[hi] ?? '']));
      drafts.push({
        row:           i + 2,
        ssotId:        row[ssotIdx]   ?? '',
        artikelnummer: row[artNrIdx]  ?? '',
        produktname:   row[nameIdx]   ?? '',
        data:          rowObj,
      });
    });

    res.json(drafts);
  } catch (err) { next(err); }
});

// ── GET /api/sheets/erfassung/seo-pending ────────────────────────────────────
router.get('/erfassung/seo-pending', async (req, res, next) => {
  try {
    const sheets = await getSheets();
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId(),
      range: 'Erfassungsmaske!A1:BZ2000',
    });
    const rows    = data.values ?? [];
    const headers = rows[0] ?? [];

    const seoStatusIdx = headers.findIndex(h => norm(h) === norm('SEO_Status'));
    const ssotIdx      = headers.findIndex(h => /ssot.?id|^id$/i.test(h));
    const artNrIdx     = headers.findIndex(h => norm(h) === norm('Artikelnummer'));
    const nameIdx      = headers.findIndex(h => norm(h) === norm('Produktname'));
    const wcIdIdx      = headers.findIndex(h => norm(h) === norm('Produkt-ID'));
    const lshopIdx     = headers.findIndex(h => norm(h) === norm('L-Shop-Artikelnummer'));
    const lshopUrlIdx  = headers.findIndex(h => norm(h) === norm('L-Shop URL'));

    const pending = [];
    rows.slice(1).forEach((row, i) => {
      const seoStatus = (row[seoStatusIdx] ?? '').trim().toLowerCase();
      if (seoStatus !== 'ausstehend') return;
      pending.push({
        row:           i + 2,
        ssotId:        row[ssotIdx]       ?? '',
        artikelnummer: row[artNrIdx]      ?? '',
        produktname:   row[nameIdx]       ?? '',
        wcId:          row[wcIdIdx]       ?? '',
        lshopNr:       lshopIdx    >= 0 ? (row[lshopIdx]    ?? '') : '',
        lshopUrl:      lshopUrlIdx >= 0 ? (row[lshopUrlIdx] ?? '') : '',
      });
    });

    res.json(pending);
  } catch (err) { next(err); }
});

// ── POST /api/sheets/erfassung ────────────────────────────────────────────────
// Stammdaten in Erfassungsmaske schreiben + Varianten-Reiter aktualisieren
router.post('/erfassung', async (req, res, next) => {
  try {
    const sheets         = await getSheets();
    const spreadsheetId  = sheetId();

    const { data: sheetData } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Erfassungsmaske!A1:BZ2000',
    });
    const rows    = sheetData.values ?? [];
    const headers = rows[0] ?? [];

    // ── Artikelnummer-Duplikat-Prüfung ────────────────────────────────────
    const artikelnummer = (req.body['Artikelnummer'] || '').trim();
    const artColIdx     = headers.findIndex(h => norm(h) === norm('Artikelnummer'));
    const ssotColIdx    = headers.findIndex(h => /ssot.?id|^id$/i.test(h));

    if (artikelnummer && artColIdx >= 0) {
      for (let i = 1; i < rows.length; i++) {
        if ((rows[i][artColIdx] ?? '').trim() === artikelnummer) {
          const existingSsotId = ssotColIdx >= 0 ? (rows[i][ssotColIdx] ?? '') : '';

          // Varianten aktualisieren auch bei bestehendem Artikel
          if (Array.isArray(req.body.varianten) && req.body.varianten.length > 0) {
            await writeVariantenForSsotId(sheets, spreadsheetId, existingSsotId, req.body.varianten);
          }

          return res.json({ success: true, ssotId: existingSsotId, exists: true, row: i + 1 });
        }
      }
    }

    // ── Neue SSOT-ID generieren ────────────────────────────────────────────
    const year   = new Date().getFullYear();
    const prefix = `JFN-${year}-`;
    let maxSeq   = 0;
    rows.slice(1).forEach(r => {
      const val = ssotColIdx >= 0 ? (r[ssotColIdx] ?? '') : '';
      if (val.startsWith(prefix)) {
        const n = parseInt(val.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    });
    const ssotId = `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;

    const row = buildRow(headers, req.body, ssotId);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range:            'Erfassungsmaske!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody:      { values: [row] },
    });

    if (Array.isArray(req.body.varianten) && req.body.varianten.length > 0) {
      await writeVariantenForSsotId(sheets, spreadsheetId, ssotId, req.body.varianten);
    }

    res.json({ success: true, ssotId, exists: false, row: rows.length + 1 });
  } catch (err) { next(err); }
});

// ── POST /api/sheets/erfassung/overwrite ──────────────────────────────────────
// Stammdaten überschreiben + Varianten-Reiter neu schreiben für die SSOT-ID
router.post('/erfassung/overwrite', async (req, res, next) => {
  try {
    const { row: rowNum, ssotId, ...body } = req.body;
    if (!rowNum) return res.status(400).json({ error: 'row fehlt' });

    const sheets         = await getSheets();
    const spreadsheetId  = sheetId();

    const { data: headerData } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Erfassungsmaske!1:1',
    });
    const headers = headerData.values?.[0] ?? [];
    const rowData = buildRow(headers, body, ssotId);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range:            `Erfassungsmaske!A${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody:      { values: [rowData] },
    });

    if (Array.isArray(body.varianten) && body.varianten.length > 0) {
      await writeVariantenForSsotId(sheets, spreadsheetId, ssotId, body.varianten);
    }

    res.json({ success: true, ssotId });
  } catch (err) { next(err); }
});

// ── POST /api/sheets/erfassung/patch-fields ──────────────────────────────────
router.post('/erfassung/patch-fields', async (req, res, next) => {
  try {
    const { row: rowNum, fields } = req.body;
    if (!rowNum || !fields || typeof fields !== 'object') {
      return res.status(400).json({ error: 'row und fields erforderlich' });
    }

    const sheets        = await getSheets();
    const spreadsheetId = sheetId();

    const [headerResp, rowResp] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: 'Erfassungsmaske!1:1' }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: `Erfassungsmaske!A${rowNum}:BZ${rowNum}` }),
    ]);

    const headers    = headerResp.data.values?.[0] ?? [];
    const currentRow = rowResp.data.values?.[0]   ?? [];

    const updatedRow = headers.map((h, i) => {
      if (fields[h] !== undefined) return String(fields[h]);
      const hn  = norm(h);
      const hit = Object.entries(fields).find(([k]) => norm(k) === hn);
      return hit ? String(hit[1]) : (currentRow[i] ?? '');
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range:            `Erfassungsmaske!A${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody:      { values: [updatedRow] },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── PUT /api/sheets/varianten/:ssotId ────────────────────────────────────────
// Schreibt Varianten-Zeilen für eine SSOT-ID komplett neu (inkl. WC-IDs)
// Body: { varianten: [{ nr, e1, v1, e2, v2, e3, v3, preis, aktiv, wcVariationId, googleFarbe }] }
router.put('/varianten/:ssotId', async (req, res, next) => {
  try {
    const ssotId   = req.params.ssotId;
    const varianten = req.body.varianten;
    if (!Array.isArray(varianten) || varianten.length === 0) {
      return res.status(400).json({ error: 'varianten Array fehlt oder leer' });
    }
    const sheets = await getSheets();
    await writeVariantenForSsotId(sheets, sheetId(), ssotId, varianten);
    res.json({ success: true, written: varianten.length });
  } catch (err) { next(err); }
});

// ── PUT /api/sheets/varianten/:ssotId/wc-ids ─────────────────────────────────
// Schreibt nach WC-Push die WC_Variation_IDs zurück in den Varianten-Reiter
// Body: { mappings: [{ variantenNr: 1, wcVariationId: 12345 }, ...] }
router.put('/varianten/:ssotId/wc-ids', async (req, res, next) => {
  try {
    const ssotId   = req.params.ssotId;
    const mappings = req.body.mappings;
    if (!Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({ error: 'mappings Array fehlt oder leer' });
    }

    const sheets        = await getSheets();
    const spreadsheetId = sheetId();

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${TAB_VARIANTEN}!A1:L2000`,
    });
    const rows = data.values ?? [];

    // Baut Range-Wert-Paare für batchUpdate auf
    // Spalte K (Index 10) = WC_Variation_ID, 1-basierte Zeilennummer = i + 1 (da i=0 ist Header)
    const colLetter = 'K'; // Index 10 = Spalte K
    const data2Update = [];

    mappings.forEach(({ variantenNr, wcVariationId }) => {
      for (let i = 1; i < rows.length; i++) {
        const rowSsot = (rows[i][VI['SSOT-ID']]      ?? '').trim();
        const rowNr   = parseInt(rows[i][VI['Varianten-Nr']] ?? '', 10);
        if (rowSsot === ssotId && rowNr === variantenNr) {
          data2Update.push({
            range:  `${TAB_VARIANTEN}!${colLetter}${i + 1}`,
            values: [[wcVariationId ?? '']],
          });
          break;
        }
      }
    });

    if (data2Update.length === 0) {
      return res.status(404).json({ error: 'Keine passenden Varianten-Zeilen gefunden' });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data:             data2Update,
      },
    });

    res.json({ success: true, updated: data2Update.length });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
// PRODUKTIONS_STATUS
// ════════════════════════════════════════════════════════════════════════════

const TAB_PS  = 'Produktions_Status';
const PS_COLS = [
  'WC_Order_ID', 'WC_Item_ID', 'Artikelname', 'SKU', 'Menge',
  'L-Shop_bestellt', 'DTF_bestellt', 'Gedruckt', 'Versendet', 'Notiz',
];
const PI = Object.fromEntries(PS_COLS.map((c, i) => [c, i]));

// Felder-Map: JS-Name → Spalten-Header
const PS_FIELD_MAP = {
  lshopBestellt: 'L-Shop_bestellt',
  dtfBestellt:   'DTF_bestellt',
  gedruckt:      'Gedruckt',
  versendet:     'Versendet',
};

function normalizeBool(val) {
  if (typeof val === 'boolean') return val;
  const s = String(val).toUpperCase().trim();
  return s === 'TRUE' || s === 'WAHR';
}

function psRowToItem(row) {
  return {
    wcItemId:      (row[PI['WC_Item_ID']]       ?? '').trim(),
    artikelname:   (row[PI['Artikelname']]       ?? '').trim(),
    sku:           (row[PI['SKU']]               ?? '').trim(),
    menge:         parseInt(row[PI['Menge']]     ?? '1', 10) || 1,
    lshopBestellt: normalizeBool(row[PI['L-Shop_bestellt']] ?? false),
    dtfBestellt:   normalizeBool(row[PI['DTF_bestellt']]    ?? false),
    gedruckt:      normalizeBool(row[PI['Gedruckt']]        ?? false),
    versendet:     normalizeBool(row[PI['Versendet']]       ?? false),
    notiz:         (row[PI['Notiz']]             ?? '').trim(),
  };
}

// ── GET /api/sheets/produktions-status?orderId= ──────────────────────────────
router.get('/produktions-status', async (req, res, next) => {
  try {
    const orderId = (req.query.orderId ?? '').trim();
    if (!orderId) return res.status(400).json({ error: 'orderId fehlt' });

    const rows = await readRange(TAB_PS, 'A1:J5000');
    const items = rows
      .slice(1)
      .filter(r => (r[PI['WC_Order_ID']] ?? '').trim() === orderId)
      .map(psRowToItem);

    res.json({ orderId, items });
  } catch (err) { next(err); }
});

// ── POST /api/sheets/produktions-status/init ─────────────────────────────────
router.post('/produktions-status/init', async (req, res, next) => {
  try {
    const { orderId, items } = req.body;
    if (!orderId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'orderId und items erforderlich' });
    }

    const rows = await readRange(TAB_PS, 'A1:J5000');
    const existing = rows.slice(1).filter(r => (r[PI['WC_Order_ID']] ?? '').trim() === orderId);

    if (existing.length > 0) {
      return res.json({ created: false, itemCount: existing.length });
    }

    const newRows = items.map(item => [
      orderId,
      String(item.wcItemId ?? ''),
      item.artikelname ?? '',
      item.sku         ?? '',
      item.menge       ?? 1,
      false, false, false, false, // L-Shop_bestellt, DTF_bestellt, Gedruckt, Versendet
      '',                         // Notiz
    ]);

    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId:    sheetId(),
      range:            `${TAB_PS}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody:      { values: newRows },
    });

    res.json({ created: true, itemCount: newRows.length });
  } catch (err) { next(err); }
});

// ── PUT /api/sheets/produktions-status ───────────────────────────────────────
// Body: { orderId, wcItemId, field: "lshopBestellt"|"dtfBestellt"|"gedruckt"|"versendet", value: bool }
router.put('/produktions-status', async (req, res, next) => {
  try {
    const { orderId, wcItemId, field, value } = req.body;
    if (!orderId || !wcItemId || !field) {
      return res.status(400).json({ error: 'orderId, wcItemId und field erforderlich' });
    }
    const colHeader = PS_FIELD_MAP[field];
    if (!colHeader) {
      return res.status(400).json({ error: `Unbekanntes field: ${field}` });
    }

    const rows = await readRange(TAB_PS, 'A1:J5000');
    let targetRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (
        (rows[i][PI['WC_Order_ID']] ?? '').trim() === String(orderId) &&
        (rows[i][PI['WC_Item_ID']]  ?? '').trim() === String(wcItemId)
      ) {
        targetRowIndex = i;
        break;
      }
    }
    if (targetRowIndex < 0) {
      return res.status(404).json({ error: 'Zeile nicht gefunden' });
    }

    const colIndex  = PI[colHeader];
    const colLetter = String.fromCharCode(65 + colIndex); // A=65
    const sheetRow  = targetRowIndex + 1;

    const sheets = await getSheets();
    await sheets.spreadsheets.values.update({
      spreadsheetId:    sheetId(),
      range:            `${TAB_PS}!${colLetter}${sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody:      { values: [[Boolean(value)]] },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── PUT /api/sheets/produktions-status/notiz ──────────────────────────────────
// Body: { orderId, wcItemId, notiz }
router.put('/produktions-status/notiz', async (req, res, next) => {
  try {
    const { orderId, wcItemId, notiz } = req.body;
    if (!orderId || !wcItemId) {
      return res.status(400).json({ error: 'orderId und wcItemId erforderlich' });
    }

    const rows = await readRange(TAB_PS, 'A1:J5000');
    let targetRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (
        (rows[i][PI['WC_Order_ID']] ?? '').trim() === String(orderId) &&
        (rows[i][PI['WC_Item_ID']]  ?? '').trim() === String(wcItemId)
      ) {
        targetRowIndex = i;
        break;
      }
    }
    if (targetRowIndex < 0) {
      return res.status(404).json({ error: 'Zeile nicht gefunden' });
    }

    const colLetter = String.fromCharCode(65 + PI['Notiz']); // J
    const sheetRow  = targetRowIndex + 1;

    const sheets = await getSheets();
    await sheets.spreadsheets.values.update({
      spreadsheetId:    sheetId(),
      range:            `${TAB_PS}!${colLetter}${sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody:      { values: [[notiz ?? '']] },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
