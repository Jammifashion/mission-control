import { Router } from 'express';
import { leseProblemliste } from '../lib/lieferbarkeitShop.js';

// Problemliste "Lieferbarkeit Shop" (BO7-3), hinter requireApiKey. Nur lesen.
const router = Router();

// ── GET /api/lieferbarkeit-shop[?shopStatus=1] ───────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    res.json(await leseProblemliste({ shopStatus: String(req.query.shopStatus ?? '') === '1' }));
  } catch (err) { next(err); }
});

export default router;
