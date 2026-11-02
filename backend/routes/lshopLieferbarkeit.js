import { Router } from 'express';
import { runLieferbarkeit } from '../lib/lshopLieferbarkeit.js';

// Lieferbarkeit L-Shop (BO7-1), Knopf-Weg hinter requireApiKey. Eigener Router, damit routes/bestellen.js
// frei von FTP bleibt. Der Scheduler-Weg steht in routes/intern.js (OIDC).
const router = Router();

// ── POST /api/bestellen/lshop-lieferbarkeit/abruf  (Knopf "Lieferbarkeit jetzt") ───
// Body optional: { dryRun: true|false }. Trockenlauf schreibt nichts und meldet nichts.
router.post('/abruf', async (req, res, next) => {
  try {
    const r = await runLieferbarkeit({ dryRun: req.body?.dryRun === true, quelle: 'knopf' });
    console.log(`L-Shop-Lieferbarkeit ${r.lauf}${r.dryRun ? ' (DRY RUN)' : ''}: ftp=${r.ftp}${r.ftp === 'ok' ? ` nummern=${r.summen.nummern} wechsel=${r.wechsel} chat=${r.chat}` : ''}`);
    res.json(r);
  } catch (err) { next(err); }
});

export default router;
