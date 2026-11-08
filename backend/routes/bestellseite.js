// Oeffentlicher Router der Bestellseite (KS1/KS2): /api/bestellseite, VOR requireApiKey, hinter dem allgemeinen Limiter.
// Kein eigener Limiter je Token (Inhaber 07.11.: meist traegt eine Person nach dem Spiel ein) - nur die Fehlversuchs-Bremse
// je IP, die ausschliesslich unbekannte Tokens (401) zaehlt. KS2: derselbe Baustein wie die Partnerportale
// (middleware/tokenBremse.js, PPS1), aber mit eigenem Zaehler.
// Token nur aus `Authorization: Bearer` (auch beim Schreiben), nie aus Adresse oder Body; nie im Log, nie im Fehlertext.

import { Router } from 'express';
import { baueTokenBremse, FEHLVERSUCHE_MAX as MAX } from '../middleware/tokenBremse.js';
import { leseSeite, schliesseAb } from '../lib/bestellseite.js';
import { leseEintraege, legeTerminAn, sendeAb, aendereEintragSeite, storniereEintragSeite } from '../lib/bestellEintraege.js';
import { tokenAusHeader } from '../utils/bestellseite.js';

export const FEHLVERSUCHE_MAX = MAX;

export function bauRouter({ seite = leseSeite, eintraege = leseEintraege, termin = legeTerminAn, absenden = sendeAb,
  aendern = aendereEintragSeite, stornieren = storniereEintragSeite, abschliessen = schliesseAb } = {}) {
  const router = Router();
  router.use(baueTokenBremse());
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); });

  // 401/403/404/409/422 gehen mit Text an die Seite (nie mit Token oder Eingabewerten), der Rest an den Fehlerhandler.
  const weg = fn => async (req, res, next) => {
    try {
      const token = tokenAusHeader(req.headers.authorization);
      if (!token) return res.status(401).json({ error: 'Bestellseite nicht gefunden.', code: 'unbekannt' });
      res.json(await fn(token, req));
    } catch (err) {
      if ([401, 403, 404, 409, 422].includes(err.status)) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
      next(err);
    }
  };

  router.get('/zugang', weg(token => seite({ token })));
  // KS2
  router.get('/eintraege', weg((token, req) => eintraege({ token, termin: String(req.query.termin ?? '') })));
  router.post('/termin', weg((token, req) => termin({ token, eingabe: req.body ?? {} })));
  router.post('/absenden', weg((token, req) => absenden({ token, eingabe: req.body ?? {} })));
  router.post('/aendern', weg((token, req) => aendern({ token, eingabe: req.body ?? {} })));
  router.post('/stornieren', weg((token, req) => stornieren({ token, eingabe: req.body ?? {} })));
  router.post('/abschliessen', weg(token => abschliessen({ token })));   // KS6: "Bestellung abschließen" (nur Art auftrag, wenn erlaubt)
  return router;
}

export default bauRouter();
