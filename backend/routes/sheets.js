import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const router = Router();

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

// Normalisiert einen Key für tolerantes Matching (Leerzeichen/Bindestriche/Unterstriche weg)
function norm(s) { return String(s).toLowerCase().replace(/[\s\-_]+/g, ''); }

// Baut eine Zeile in Header-Reihenfolge aus payload + ssotId + varianten
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

  const varianten = Array.isArray(body.varianten) ? body.varianten.slice(0, 50) : [];
  const bData = {};
  varianten.forEach((v, bi) => {
    const b     = `B${bi + 1}`;
    const attrs = Array.isArray(v.attrs) ? v.attrs : [];
    for (let ai = 0; ai < 3; ai++) {
      bData[`${b}_E${ai + 1}`] = attrs[ai]?.name  ?? '';
      bData[`${b}_V${ai + 1}`] = attrs[ai]?.value ?? '';
    }
    bData[`${b}_Preis`]        = v.price ?? '';
    bData[`${b}_Google_Farbe`] = '';
  });

  return headers.map(h => (bData[h] !== undefined ? bData[h] : getField(h)));
}

async function readRange(tab, range = 'A1:Z1000') {
  const sheets = await getSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${tab}!${range}`,
  });
  return data.values ?? [];
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
// Spalten: Kategorienummer | Kategorien | Kategoriename | Instagram URL | TikTok URL
router.get('/kategorien', async (req, res, next) => {
  try {
    const rows = await readRange('Struktur_Kategorien');
    const objects = rowsToObjects(rows);
    res.json(objects.filter(r => r['Kategoriename']?.trim()));
  } catch (err) { next(err); }
});

// ── GET /api/sheets/social-media?kategorieId={id} ────────────────────────────
// Gibt { instagram, tiktok } für die erste Kategorie mit gesetzten URLs zurück
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

    // Erste Kategorie mit gesetzten URLs gewinnt; Fallback: erste Übereinstimmung ohne URLs
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
// Erwartet Spalten: Eigenschaft, Begriff (oder ähnlich)
// Gibt zurück: [{ eigenschaft: "Farbe", begriffe: ["Schwarz", "Weiß", ...] }, ...]
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

// ── GET /api/sheets/erfassung/by-wc-id?id={wcId} ────────────────────────────
// Sucht in Spalte "Produkt-ID" nach der WC-ID → gibt { ssotId, row, status } zurück
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
// Gibt alle Zeilen mit Status "Entwurf" zurück (inkl. vollständiger Zeilendaten).
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
        row:          i + 2,             // 1-basiert (Zeile 1 = Header)
        ssotId:       row[ssotIdx]   ?? '',
        artikelnummer:row[artNrIdx]  ?? '',
        produktname:  row[nameIdx]   ?? '',
        data:         rowObj,
      });
    });

    res.json(drafts);
  } catch (err) { next(err); }
});

// ── POST /api/sheets/erfassung ────────────────────────────────────────────────
// Prüft ob Artikelnummer bereits existiert.
// Wenn nicht: neue SSOT-ID generieren + Zeile anhängen → { success, ssotId, exists: false }
// Wenn ja:    nichts schreiben               → { success, ssotId, exists: true, row }
router.post('/erfassung', async (req, res, next) => {
  try {
    const sheets = await getSheets();
    const spreadsheetId = sheetId();

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
      range: 'Erfassungsmaske!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    // rows enthält Header + alle Datenzeilen vor dem Append → neue Zeile = rows.length + 1
    res.json({ success: true, ssotId, exists: false, row: rows.length + 1 });
  } catch (err) { next(err); }
});

// ── POST /api/sheets/erfassung/overwrite ──────────────────────────────────────
// Überschreibt eine bestehende Zeile komplett (row = 1-basierte Sheet-Zeilennummer).
router.post('/erfassung/overwrite', async (req, res, next) => {
  try {
    const { row: rowNum, ssotId, ...body } = req.body;
    if (!rowNum) return res.status(400).json({ error: 'row fehlt' });

    const sheets = await getSheets();
    const spreadsheetId = sheetId();

    const { data: headerData } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Erfassungsmaske!1:1',
    });
    const headers = headerData.values?.[0] ?? [];
    const rowData = buildRow(headers, body, ssotId);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Erfassungsmaske!A${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowData] },
    });

    res.json({ success: true, ssotId });
  } catch (err) { next(err); }
});

// ── GET /api/sheets/erfassung/seo-pending ────────────────────────────────────
// Gibt alle Zeilen zurück wo SEO_Status = "Ausstehend"
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

// ── POST /api/sheets/erfassung/patch-fields ──────────────────────────────────
// Aktualisiert nur bestimmte Felder einer Zeile (liest restliche Werte aus Sheet)
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

export default router;
