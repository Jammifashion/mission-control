import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import {
  getAgentSystemPrompt,
  getPromptInfo,
  buildPromptWithGeruest,
  invalidateCache,
  DEFAULT_PROMPT_GERUEST,
} from '../lib/agentWissenHelper.js';
import { loadRecentAnfragen, callChatAgent } from '../lib/chatCore.js';

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
  // Echten Sheet-Zeilenindex (_sheetRow) anhängen BEVOR Leerzeilen gefiltert werden,
  // damit Updates die korrekte Zeile treffen (sonst verschiebt jede Leerzeile alles).
  rest.forEach((r, i) => { r._sheetRow = i + 2; });
  return rest.filter(r => r.some(c => c));
}

// Returns the internal integer sheetId for the Agent_Wissen tab (needed for row deletion).
async function getGSheetId(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find(s => s.properties?.title === TAB);
  if (!sheet) throw new Error(`Tab "${TAB}" nicht gefunden.`);
  return sheet.properties.sheetId;
}

// ── GET /api/agent-wissen ────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  const sheetId = requireSheetId(res);
  if (!sheetId) return;
  try {
    const sheets = await getSheets();
    const rows   = await readAllRows(sheets, sheetId);
    const result = rows.map(r => ({
      typ:        r[0] ?? '',
      schluessel: r[1] ?? '',
      wert:       r[2] ?? '',
      notiz:      r[3] ?? '',
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

    const idx = rows.findIndex(r => (r[1] ?? '') === schluessel);
    if (idx === -1) {
      return res.status(404).json({ error: `Schlüssel "${schluessel}" nicht gefunden.` });
    }

    const sheetRow = rows[idx]._sheetRow;
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

// ── GET /api/agent-wissen/prompt ─────────────────────────────────────────────
router.get('/prompt', async (req, res, next) => {
  try {
    const info = await getPromptInfo();
    res.json(info);
  } catch (e) {
    next(e);
  }
});

// ── PUT /api/agent-wissen/prompt ──────────────────────────────────────────────
router.put('/prompt', async (req, res, next) => {
  const sheetId = requireSheetId(res);
  if (!sheetId) return;

  const { geruest } = req.body ?? {};
  if (typeof geruest !== 'string' || !geruest.trim()) {
    return res.status(400).json({ error: 'geruest muss ein nicht-leerer String sein.' });
  }
  if (geruest.length > 50_000) {
    return res.status(400).json({ error: 'geruest überschreitet das Zeichenlimit (50.000).' });
  }

  try {
    const sheets = await getSheets();
    const rows   = await readAllRows(sheets, sheetId);
    const spRow  = rows.find(r => (r[0] ?? '').toLowerCase() === 'system_prompt');

    if (spRow) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: [{ range: `${TAB}!C${spRow._sheetRow}`, values: [[geruest.trim()]] }],
        },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId:    sheetId,
        range:            `${TAB}!A:D`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [['system_prompt', '', geruest.trim(), '']] },
      });
    }

    invalidateCache();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ── DELETE /api/agent-wissen/prompt ───────────────────────────────────────────
router.delete('/prompt', async (req, res, next) => {
  const sheetId = requireSheetId(res);
  if (!sheetId) return;

  try {
    const sheets = await getSheets();
    const rows   = await readAllRows(sheets, sheetId);
    const spRow  = rows.find(r => (r[0] ?? '').toLowerCase() === 'system_prompt');

    if (!spRow) {
      return res.status(404).json({ error: 'Kein system_prompt-Override vorhanden.' });
    }

    const gSheetId = await getGSheetId(sheets, sheetId);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId:    gSheetId,
              dimension:  'ROWS',
              startIndex: spRow._sheetRow - 1, // 0-based
              endIndex:   spRow._sheetRow,
            },
          },
        }],
      },
    });

    invalidateCache();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ── POST /api/agent-wissen/prompt/test ───────────────────────────────────────
router.post('/prompt/test', async (req, res, next) => {
  try {
    const { messages = [], sessionData = {}, geruestOverride } = req.body ?? {};

    if (!Array.isArray(messages) || messages.length > 20) {
      return res.status(400).json({ error: 'messages muss ein Array mit max. 20 Einträgen sein.' });
    }

    if (geruestOverride !== undefined) {
      if (typeof geruestOverride !== 'string' || !geruestOverride.trim()) {
        return res.status(400).json({ error: 'geruestOverride muss ein nicht-leerer String sein.' });
      }
      if (geruestOverride.length > 50_000) {
        return res.status(400).json({ error: 'geruestOverride überschreitet das Zeichenlimit (50.000).' });
      }
    }

    const validMsgs = messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 500) }));

    const [history, kbBase] = await Promise.all([
      loadRecentAnfragen(),
      geruestOverride
        ? buildPromptWithGeruest(geruestOverride.trim())
        : getAgentSystemPrompt(),
    ]);

    const result = await callChatAgent({ messages: validMsgs, sessionData, kbBase, history });

    if (!result) {
      return res.status(502).json({ error: 'Agent konnte keine Antwort generieren.' });
    }

    // Kein Schreiben ins Kundenanfragen-Sheet, auch nicht wenn completed=true
    res.json({
      reply:       result.reply,
      sessionData: result.sessionData,
      completed:   result.completed,
    });

  } catch (e) { next(e); }
});

export default router;
