import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const router = Router();

const TAB          = 'Agent_Wissen';
const SPREADSHEET_ID = () => process.env.BUSINESS_SHEET_ID;

function getSheets() {
  return getGoogleAuth().then(auth => google.sheets({ version: 'v4', auth }));
}

function requireSheetId(res) {
  const id = SPREADSHEET_ID();
  if (!id) {
    res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });
    return null;
  }
  return id;
}

async function readAllRows(sheets, sheetId) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${TAB}!A:D`,
  });
  const [header, ...rest] = data.values ?? [];
  if (!header) return [];
  return rest.filter(r => r.some(c => c));
}

// ── GET /api/agent-wissen ────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  const sheetId = requireSheetId(res);
  if (!sheetId) return;
  try {
    const sheets = await getSheets();
    const rows   = await readAllRows(sheets, sheetId);
    const result = rows.map(r => ({
      typ:       r[0] ?? '',
      schluessel: r[1] ?? '',
      wert:      r[2] ?? '',
      notiz:     r[3] ?? '',
    }));
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// ── POST /api/agent-wissen ───────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  const sheetId = requireSheetId(res);
  if (!sheetId) return;

  const { typ, schluessel, wert, notiz = '' } = req.body ?? {};
  if (!typ || !schluessel || wert === undefined) {
    return res.status(400).json({ error: 'typ, schluessel und wert sind erforderlich.' });
  }

  try {
    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId:    sheetId,
      range:            `${TAB}!A:D`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[typ, schluessel, wert, notiz]] },
    });
    res.status(201).json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ── PATCH /api/agent-wissen/:schluessel ──────────────────────────────────────
router.patch('/:schluessel', async (req, res, next) => {
  const sheetId = requireSheetId(res);
  if (!sheetId) return;

  const { schluessel } = req.params;
  const { wert, notiz } = req.body ?? {};
  if (wert === undefined) {
    return res.status(400).json({ error: 'wert ist erforderlich.' });
  }

  try {
    const sheets = await getSheets();
    const rows   = await readAllRows(sheets, sheetId);

    // Zeile 1 = Header → Daten beginnen bei Sheet-Zeile 2
    const idx = rows.findIndex(r => (r[1] ?? '') === schluessel);
    if (idx === -1) {
      return res.status(404).json({ error: `Schlüssel "${schluessel}" nicht gefunden.` });
    }

    const sheetRow = idx + 2; // +1 für 1-basiert, +1 für Header-Zeile
    const data = [{ range: `${TAB}!C${sheetRow}`, values: [[wert]] }];
    if (notiz !== undefined) data.push({ range: `${TAB}!D${sheetRow}`, values: [[notiz]] });
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody:   { valueInputOption: 'RAW', data },
    });
    res.json({ success: true, row: sheetRow });
  } catch (e) {
    next(e);
  }
});

export default router;
