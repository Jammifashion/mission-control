import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient } from '../lib/shopConfig.js';
import { getModel } from '../lib/modelConfig.js';
import { runCheck } from '../scripts/check-models.js';

// Zwei Router statt einem, der doppelt eingehaengt war (/api/system und
// /api/health): so gab es auch /api/system/full und /api/health/modell-check.
// healthRouter -> /api/health  (GET /full, Statuspunkt im Dashboard)
// default      -> /api/system  (POST /modell-check, Workflow modell-check.yml)
const router = Router();
export const healthRouter = Router();

async function checkWooCommerce(shop) {
  const t0 = Date.now();
  await getWcClient(shop).get('system_status');
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

// Der Claude-Check kostet einen echten Modellaufruf. Ungecacht und im
// Minutentakt des Dashboards waren das rund 1440 Aufrufe pro Tag und offenem
// Tab - fuer einen Statuspunkt. Das Ergebnis wird deshalb gehalten:
// Erfolg lange, Fehler kurz, damit eine Erholung schnell sichtbar wird.
const CLAUDE_TTL_OK_MS     = 10 * 60 * 1000;
const CLAUDE_TTL_FEHLER_MS =      60 * 1000;
let _claudeCache = null;   // { wert, at, ttl }

export function _resetClaudeCache() { _claudeCache = null; }

async function checkClaude() {
  if (_claudeCache && Date.now() - _claudeCache.at < _claudeCache.ttl) {
    return { ..._claudeCache.wert, cached: true };
  }

  const t0 = Date.now();
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    await client.messages.create({
      model:      await getModel('agent-intern'),
      max_tokens: 10,
      messages:   [{ role: 'user', content: 'ping' }],
    });
    const wert = { ok: true, ms: Date.now() - t0 };
    _claudeCache = { wert, at: Date.now(), ttl: CLAUDE_TTL_OK_MS };
    return wert;
  } catch (err) {
    const wert = { ok: false, ms: Date.now() - t0, error: err.message };
    _claudeCache = { wert, at: Date.now(), ttl: CLAUDE_TTL_FEHLER_MS };
    return wert;
  }
}

// ── GET /api/health/full ──────────────────────────────────────────────────────
healthRouter.get('/full', async (req, res, next) => {
  try {
    const [woocommerce, sheet, claude] = await Promise.all([
      checkWooCommerce(req.query.shop).catch(err => ({ ok: false, ms: 0, error: err.message })),
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

// ── POST /api/system/modell-check  (hinter requireApiKey) ────────────────────
// Konfigurierte Anthropic-Modell-IDs (Business-Sheet, Reiter Config) gegen die
// Models API. 200 alles gültig, 422 mindestens ein Modell fehlt, 500 bei
// Sheet- oder API-Fehler (über den Error-Handler).
// Aufrufer: .github/workflows/modell-check.yml
router.post('/modell-check', async (_req, res, next) => {
  try {
    const r = await runCheck();
    const ok = r.fehlend.length === 0;
    res.status(ok ? 200 : 422).json({ ok, ...r });
  } catch (err) { next(err); }
});

export default router;
