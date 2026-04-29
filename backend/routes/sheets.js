import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const router = Router();

const SPREADSHEET_NAME = 'JF_Master_Inventur_SSoT';
const SSOT_SHEET_TAB   = 'SSoT';
const SSOT_RANGE       = 'A1:Z1000';

/**
 * Finds the spreadsheet ID by name in Google Drive.
 * Cached per process lifetime to avoid repeated Drive API calls.
 */
let cachedSpreadsheetId = null;

async function resolveSpreadsheetId(auth) {
  if (cachedSpreadsheetId) return cachedSpreadsheetId;

  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.list({
    q: `name='${SPREADSHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 1,
  });

  const file = res.data.files?.[0];
  if (!file) throw new Error(`Spreadsheet "${SPREADSHEET_NAME}" nicht gefunden.`);

  cachedSpreadsheetId = file.id;
  return cachedSpreadsheetId;
}

/**
 * Converts a 2D array of rows (first row = headers) to an array of objects.
 */
function rowsToObjects(rows) {
  if (!rows?.length) return [];
  const [headers, ...data] = rows;
  return data.map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))
  );
}

// GET /api/sheets/ssot
router.get('/ssot', async (req, res, next) => {
  try {
    const auth           = await getGoogleAuth();
    const spreadsheetId  = await resolveSpreadsheetId(auth);
    const sheets         = google.sheets({ version: 'v4', auth });

    const range = `${SSOT_SHEET_TAB}!${SSOT_RANGE}`;
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range });

    const records = rowsToObjects(data.values);

    res.json({
      spreadsheet_id: spreadsheetId,
      sheet:          SSOT_SHEET_TAB,
      count:          records.length,
      records,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/sheets/ssot/:ssotId  – single record lookup
router.get('/ssot/:ssotId', async (req, res, next) => {
  try {
    const auth          = await getGoogleAuth();
    const spreadsheetId = await resolveSpreadsheetId(auth);
    const sheets        = google.sheets({ version: 'v4', auth });

    const range = `${SSOT_SHEET_TAB}!${SSOT_RANGE}`;
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range });

    const records = rowsToObjects(data.values);
    const record  = records.find(r =>
      Object.values(r).some(v => v === req.params.ssotId)
    );

    if (!record) {
      return res.status(404).json({ error: `SSOT-ID "${req.params.ssotId}" nicht gefunden.` });
    }

    res.json(record);
  } catch (err) {
    next(err);
  }
});

export default router;
