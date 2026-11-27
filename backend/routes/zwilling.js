// HONK!-Zwilling (ZW1): POST /api/zwilling/anlegen { jfnId, ssotId } (nach der Anlage und - ZW1-2 - nachtraeglich aus
// "Artikel ändern"), GET /api/zwilling?jfnId= und GET /api/zwilling/pruefen?jfnId= (beide nur lesen).
// Hinter requireApiKey. Logik lib/zwilling.js, utils/zwilling.js.
import { Router } from 'express';
import { legeZwillingAn, leseZwilling, pruefeZwilling } from '../lib/zwilling.js';
import { istLaufStopp } from '../lib/hosterPruefseite.js';

const router = Router();

router.post('/anlegen', async (req, res, next) => {
  try {
    const { jfnId, ssotId } = req.body ?? {};
    res.status(201).json(await legeZwillingAn({ jfnId, ssotId }));
  } catch (err) {
    if (istLaufStopp(err) || !err.code || !err.status) return next(err);
    res.status(err.status).json({
      error: err.message, code: err.code,
      ...(err.gruende ? { gruende: err.gruende } : {}),
      ...(err.hochgeladen?.length ? { hochgeladen: err.hochgeladen } : {}),
      ...(err.honkId ? { honkId: err.honkId } : {}),
      ...(err.link ? { link: err.link } : {}),
    });
  }
});

router.get('/pruefen', async (req, res, next) => {
  try {
    res.json(await pruefeZwilling({ jfnId: req.query.jfnId }));
  } catch (err) {
    if (istLaufStopp(err) || !err.code || !err.status) return next(err);
    res.status(err.status).json({ error: err.message, code: err.code });
  }
});

router.get('/', async (req, res, next) => {
  try {
    const jfnId = Number(req.query.jfnId);
    if (!Number.isInteger(jfnId) || jfnId <= 0) return res.status(400).json({ error: 'jfnId fehlt.' });
    res.json(await leseZwilling({ jfnId }));
  } catch (err) { next(err); }
});

export default router;
