// GS1: Gutschrift an Festpreis-Partner aus der Abrechnung (Lexware-Entwurf). Hinter requireApiKey, eingehaengt unter
// /api/festpreis/gutschrift (eigener Router, damit routes/festpreis-portal.js unberuehrt bleibt). Logik lib/gutschrift.js.
import { Router } from 'express';
import { _fanshopKontoLeeren } from '../lib/fanshopKonto.js';
import { gutschriftListe, gutschriftVorschau, gutschriftAnlegen, gutschriftKennzeichen, gutschriftNachsehen } from '../lib/gutschrift.js';

const router = Router();
// GS2 Teil B: angelegte/geaenderte Gutschrift sofort im Fanshop-Konto (Belege) sichtbar
router.use((req, res, next) => { if (req.method === 'POST') res.on('finish', () => _fanshopKontoLeeren()); next(); });

const mitMeldung = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) {
    if ([404, 409, 422, 503].includes(err?.status)) return res.status(err.status).json({ error: err.message, code: err.code, probleme: err.probleme });
    next(err);
  }
};

router.get('/', mitMeldung(() => gutschriftListe()));
router.post('/vorschau', mitMeldung(req => gutschriftVorschau({ id: req.body?.id })));
router.post('/anlegen', mitMeldung(req => gutschriftAnlegen({ eingabe: req.body ?? {} })));
router.post('/kennzeichen', mitMeldung(req => gutschriftKennzeichen({ eingabe: req.body ?? {} })));
router.post('/nachsehen', mitMeldung(req => gutschriftNachsehen({ id: req.body?.id })));

export default router;
