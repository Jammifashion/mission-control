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
router.get('/kategorien', async (req, res, next) => {
  try {
    const rows = await readRange('Struktur_Kategorien');
    res.json(rowsToObjects(rows));
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

// ── POST /api/sheets/erfassung ───────────────────────────────────────────────
// Schreibt einen neuen Artikel als neue Zeile in den Reiter "Erfassungsmaske"
router.post('/erfassung', async (req, res, next) => {
  try {
    const sheets = await getSheets();
    const spreadsheetId = sheetId();

    // Erste Zeile holen um Header-Reihenfolge zu kennen
    const { data: headerData } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Erfassungsmaske!1:1',
    });
    const headers = headerData.values?.[0] ?? [];

    const payload = req.body;

    // Zeile in Header-Reihenfolge aufbauen – unbekannte Felder werden leer gelassen
    const row = headers.length
      ? headers.map(h => payload[h] ?? payload[h.toLowerCase().replace(/\s+/g, '_')] ?? '')
      : Object.values(payload);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Erfassungsmaske!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    res.json({ success: true, written: row });
  } catch (err) { next(err); }
});

export default router;
