import { Router } from 'express';
import { runBelegeAbruf } from '../lib/lshopBelege.js';

// Belege von L-Shop (BO4b-1), Knopf-Weg hinter requireApiKey. Eigener Router, damit
// routes/bestellen.js (EDI-Erzeugen, BO4a) frei von FTP bleibt (Test lshop-edi).
// Der Scheduler-Weg steht in routes/intern.js (OIDC).
const router = Router();

// ── POST /api/bestellen/lshop-belege/abruf  (Knopf "Belege jetzt abrufen") ───
// Body optional: { dryRun: true|false }. Liest den L-Shop-FTP nur (lib/lshopFtp.js); Trockenlauf
// schreibt nichts und meldet nichts. FTP-Fehler kommen als 200 mit ftp "fehler" (wie beim Scheduler).
router.post('/abruf', async (req, res, next) => {
  try {
    const r = await runBelegeAbruf({ dryRun: req.body?.dryRun === true, quelle: 'knopf' });
    console.log(`L-Shop-Belege ${r.lauf}${r.dryRun ? ' (DRY RUN)' : ''}: ftp=${r.ftp}${r.ftp === 'ok' ? ` neu=${r.neueZeilen} alarme=${r.alarme.length}` : ''}`);
    res.json(r);
  } catch (err) { next(err); }
});

export default router;
