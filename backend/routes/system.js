import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const router = Router();

function getWc() {
  return new WooCommerceRestApi.default({
    url: process.env.WC_URL, consumerKey: process.env.WC_KEY,
    consumerSecret: process.env.WC_SECRET, version: 'wc/v3', queryStringAuth: true,
  });
}

async function checkWooCommerce() {
  const t0 = Date.now();
  await getWc().get('system_status');
  return { ok: true, ms: Date.now() - t0 };
}

async function checkSheet() {
  const t0 = Date.now();
  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'Erfassungsmaske!A1',
  });
  return { ok: true, ms: Date.now() - t0 };
}

async function checkClaude() {
  const t0     = Date.now();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 10,
    messages:   [{ role: 'user', content: 'ping' }],
  });
  return { ok: true, ms: Date.now() - t0 };
}

// ── GET /api/health/full ──────────────────────────────────────────────────────
router.get('/full', async (req, res, next) => {
  try {
    const [woocommerce, sheet, claude] = await Promise.all([
      checkWooCommerce().catch(err => ({ ok: false, ms: 0, error: err.message })),
      checkSheet().catch(err        => ({ ok: false, ms: 0, error: err.message })),
      checkClaude().catch(err       => ({ ok: false, ms: 0, error: err.message })),
    ]);

    const ok = woocommerce.ok && sheet.ok && claude.ok;

    if (!ok && process.env.NTFY_TOPIC) {
      const failed = { woocommerce, sheet, claude };
      await Promise.allSettled(
        Object.entries(failed)
          .filter(([, v]) => !v.ok)
          .map(([name]) => fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
            method:  'POST',
            body:    `Mission Control: ${name} nicht erreichbar`,
            headers: { 'Title': 'Mission Control Alert', 'Priority': 'high' },
          }))
      );
    }

    res.status(ok ? 200 : 503).json({ ok, services: { woocommerce, sheet, claude } });
  } catch (err) { next(err); }
});

// ── POST /api/system/log ──────────────────────────────────────────────────────
router.post('/log', async (req, res, next) => {
  try {
    const { level = 'INFO', service = '', message = '', details = '' } = req.body;
    if (!message) return res.status(400).json({ error: 'message erforderlich' });

    const auth   = await getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId:    process.env.GOOGLE_SHEET_ID,
      range:            'System_Log!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[
        new Date().toISOString(),
        String(level).toUpperCase(),
        service,
        message,
        typeof details === 'object' ? JSON.stringify(details) : String(details),
      ]] },
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
