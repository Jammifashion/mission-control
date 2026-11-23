// Druckmasse (DK1) - Pflege-Ansicht Artikel -> Druckmasse und "als Druckmass merken" aus dem Auftrag. Hinter requireApiKey.
// Nie Betraege ins Log; kein Loeschen (nur inaktiv).
import { Router } from 'express';
import { leseDruckmasse, legeDruckmassAn, aendereDruckmass, merkeDruckmasse } from '../lib/druckmasse.js';

const router = Router();
const mitMeldung = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) {
    if ([404, 409, 422, 503].includes(err?.status)) return res.status(err.status).json({ error: err.message, code: err.code, anders: err.anders });
    next(err);
  }
};

router.get('/', mitMeldung(() => leseDruckmasse()));
router.post('/neu', mitMeldung(req => legeDruckmassAn({ eingabe: req.body ?? {} })));
router.post('/aendern', mitMeldung(req => aendereDruckmass({ eingabe: req.body ?? {} })));
router.post('/merken', mitMeldung(req => merkeDruckmasse({ eingabe: req.body ?? {} })));

export default router;
