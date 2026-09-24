import { Router } from 'express';
import { runTrikotSync } from '../lib/trikotSync.js';

const router = Router();

// ── POST /api/trikot/sync  (hinter requireApiKey) ────────────────────────────
// Body optional: { after: "YYYY-MM-DD", dryRun: true|false }
// Aufrufer: .github/workflows/trikot-sync-daily.yml
router.post('/sync', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const r = await runTrikotSync({ after: body.after, dryRun: body.dryRun });
    console.log(
      `Trikot-Sync ab ${r.ab}${r.dryRun ? ' (DRY RUN)' : ''}: ` +
      `gelesen=${r.gelesen} neu=${r.neu} dubletten=${r.dubletten} quellen=${JSON.stringify(r.quellen)} ` +
      `zahlarten=${JSON.stringify(r.zahlarten)}`
    );
    res.json({ ok: true, gelesen: r.gelesen, neu: r.neu, dubletten: r.dubletten, quellen: r.quellen, zahlarten: r.zahlarten });
  } catch (err) {
    next(err);
  }
});

export default router;
