// Oeffentlicher Router der Bestellseite (KS1): /api/bestellseite, VOR requireApiKey, hinter dem allgemeinen Limiter.
// Kein eigener Limiter je Token (Inhaber 07.11.: meist traegt eine Person nach dem Spiel ein) - nur eine kleine
// Fehlversuchs-Bremse je IP, die ausschliesslich unbekannte Tokens (401) zaehlt.
// Token nur aus `Authorization: Bearer`, nie aus Adresse oder Body; nie im Log, nie im Fehlertext.

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { leseSeite } from '../lib/bestellseite.js';
import { tokenAusHeader } from '../utils/bestellseite.js';

export const FEHLVERSUCHE_MAX = 20;
export const FEHLVERSUCHE_FENSTER_MS = 15 * 60 * 1000;

export function bauRouter({ seite = leseSeite } = {}) {
  const router = Router();
  const bremse = rateLimit({
    windowMs: FEHLVERSUCHE_FENSTER_MS,
    max: FEHLVERSUCHE_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,   // nur unbekannte Tokens zaehlen
    message: { error: 'Zu viele Versuche – bitte in 15 Minuten noch einmal.', code: 'bremse' },
  });
  router.use(bremse);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); });

  router.get('/zugang', async (req, res, next) => {
    try {
      const token = tokenAusHeader(req.headers.authorization);
      if (!token) return res.status(401).json({ error: 'Bestellseite nicht gefunden.', code: 'unbekannt' });
      res.json(await seite({ token }));
    } catch (err) {
      if ([401, 403].includes(err.status)) return res.status(err.status).json({ error: err.message, code: err.code });
      next(err);
    }
  });
  return router;
}

export default bauRouter();
