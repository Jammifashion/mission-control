// Bestellseiten verwalten (KS1), hinter requireApiKey. Logik in lib/bestellseite.js + utils/bestellseite.js.
// Der Token-Klartext steht nur in der Antwort von /neu und /neuer-link (einmal, fuer den Kopieren-Knopf), nie im Log.
import { Router } from 'express';
import { leseZugaenge, legeZugangAn, bearbeiteZugang, neuerLink, aktualisiereBilder, leseKategorien } from '../lib/bestellseite.js';

const router = Router();

const mitMeldung = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) {
    if ([404, 409, 422].includes(err?.status)) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    next(err);
  }
};

// GET /api/bestellseiten - alle Zugaenge (ohne Hash), Status, Termine, Stand der Bilder.
router.get('/', mitMeldung(() => leseZugaenge()));
// GET /api/bestellseiten/kategorien - Auswahl fuer das Sortiment (Nummer, Pfad).
router.get('/kategorien', mitMeldung(async () => ({ kategorien: (await leseKategorien()).map(k => ({ nr: k.nr, pfad: k.pfad })) })));
// POST /api/bestellseiten/neu { art, auftragNr | kundenNr, sortiment, ablauf, hinweis, partnerId, designLinkZeigen, vorgang }
router.post('/neu', mitMeldung(req => legeZugangAn({ eingabe: req.body ?? {} })));
// POST /api/bestellseiten/bearbeiten { zugangId, stand, aktiv?, ablauf?, hinweis?, sortiment?, designLinkZeigen?, bestellschlussTage?, empfohlenTage? }
router.post('/bearbeiten', mitMeldung(req => bearbeiteZugang({ eingabe: req.body ?? {} })));
// POST /api/bestellseiten/neuer-link { zugangId, stand } - alter Link sofort ungueltig.
router.post('/neuer-link', mitMeldung(req => neuerLink({ eingabe: req.body ?? {} })));
// POST /api/bestellseiten/bilder { dryRun } - Knopf "Artikelliste aktualisieren" (Shop, 2-s-Takt).
router.post('/bilder', mitMeldung(req => aktualisiereBilder({ dryRun: req.body?.dryRun === true })));

export default router;
