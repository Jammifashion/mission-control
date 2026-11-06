// DB1: Dashboard (hinter requireApiKey). Duenner Aufrufer, Logik in lib/dashboard.js + utils/dashboard.js.
import { Router } from 'express';
import { leseDashboard, setzeHinweisGelesen } from '../lib/dashboard.js';

const router = Router();
const mitMeldung = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) {
    if ([409, 422, 502].includes(err?.status)) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    next(err);   // Pruefseite -> middleware/hosterPruefseite (503)
  }
};

// GET /api/dashboard?wer=Christian|Nicole (leer = alle)
router.get('/', mitMeldung(req => leseDashboard({ wer: String(req.query.wer ?? '') })));
// POST /api/dashboard/hinweis-gelesen { shop, nr, pruef, wer }
router.post('/hinweis-gelesen', mitMeldung(req => setzeHinweisGelesen({ eingabe: req.body ?? {} })));

export default router;
