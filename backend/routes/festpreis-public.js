// ── Festpreis Public – Token-Auth Endpunkte (kein API-Key erforderlich) ──────
// Registriert vor requireApiKey in index.js.
// Wird von partner-festpreis.html genutzt.

import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const router = Router();

const SHEETID = () => process.env.BUSINESS_SHEET_ID;
const TAB_FP_PARTNER      = 'FP_Partner';
const TAB_FP_VERKAEUFE    = 'FP_Verkäufe';
const TAB_FP_ABRECHNUNGEN = 'FP_Abrechnungen';

async function getSheets() {
  const auth = await getGoogleAuth();
  return google.sheets({ version: 'v4', auth });
}

async function readTab(sheets, sheetId, tabName) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${tabName}!A1:Z`,
  });
  const [header, ...rows] = data.values ?? [];
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}

function rowToObj(header, row) {
  const obj = {};
  header.forEach((h, i) => { obj[h] = row[i] ?? ''; });
  return obj;
}

async function resolvePartner(token) {
  const sheetId = SHEETID();
  if (!sheetId) throw Object.assign(new Error('BUSINESS_SHEET_ID nicht konfiguriert.'), { status: 503 });
  const sheets = await getSheets();
  const { header, rows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);
  const tokenIdx = header.indexOf('Token');
  const aktivIdx = header.indexOf('Aktiv');
  const row = rows.find(r => token && tokenIdx !== -1 && (r[tokenIdx] ?? '') === token);
  if (!row) throw Object.assign(new Error('Ungültiger Token.'), { status: 401 });
  if ((row[aktivIdx] ?? '').toLowerCase() !== 'ja')
    throw Object.assign(new Error('Partner ist nicht aktiv.'), { status: 403 });
  return { partner: rowToObj(header, row), sheets, sheetId };
}

// ── GET /api/festpreis-public/auth?token= ────────────────────────────────────
router.get('/auth', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partner } = await resolvePartner(token);
    res.json({ partnerId: partner['Partner-ID'], partnerName: partner['Name'] });
  } catch (err) { next(err); }
});

// ── GET /api/festpreis-public/verkaeufe?token= ───────────────────────────────
router.get('/verkaeufe', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partner, sheets, sheetId } = await resolvePartner(token);
    const partnerId = partner['Partner-ID'];

    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_VERKAEUFE);
    const pidIdx = header.indexOf('Partner-ID');
    const filtered = rows
      .filter(r => (r[pidIdx] ?? '') === partnerId)
      .map(r => rowToObj(header, r));
    res.json(filtered);
  } catch (err) { next(err); }
});

// ── GET /api/festpreis-public/abrechnungen?token= ────────────────────────────
router.get('/abrechnungen', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partner, sheets, sheetId } = await resolvePartner(token);
    const partnerId = partner['Partner-ID'];

    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_ABRECHNUNGEN);
    const pidIdx = header.indexOf('Partner-ID');
    const filtered = rows
      .filter(r => (r[pidIdx] ?? '') === partnerId && (r[header.indexOf('Status')] ?? '') !== 'entwurf')
      .map(r => rowToObj(header, r));
    res.json(filtered);
  } catch (err) { next(err); }
});

export default router;
