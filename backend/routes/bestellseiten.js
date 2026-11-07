// Bestellseiten verwalten (KS1), hinter requireApiKey. Logik in lib/bestellseite.js + utils/bestellseite.js.
// Der Token-Klartext steht nur in der Antwort von /neu, /neuer-link und (LK1) /:zugangId/link (Kopieren-Knopf), nie im Log.
import { Router } from 'express';
import { leseZugaenge, legeZugangAn, bearbeiteZugang, neuerLink, zeigeLink, aktualisiereBilder, leseKategorien, bilderPlan, bilderStueck, bilderSchreiben } from '../lib/bestellseite.js';
import { leseEintraegeMc } from '../lib/bestellEintraege.js';   // KS2: nur ansehen

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
// GET /api/bestellseiten/:zugangId/eintraege - KS2: Eintraege des Zugangs nur ansehen (Rueckennamen nur in der Oberflaeche).
router.get('/:zugangId/eintraege', mitMeldung(req => leseEintraegeMc({ zugangId: req.params.zugangId })));
// POST /api/bestellseiten/neu { art, auftragNr | kundenNr, sortiment, ablauf, hinweis, partnerId, designLinkZeigen, vorgang }
router.post('/neu', mitMeldung(req => legeZugangAn({ eingabe: req.body ?? {} })));
// POST /api/bestellseiten/bearbeiten { zugangId, stand, aktiv?, ablauf?, hinweis?, sortiment?, designLinkZeigen?, bestellschlussTage?, empfohlenTage? }
router.post('/bearbeiten', mitMeldung(req => bearbeiteZugang({ eingabe: req.body ?? {} })));
// POST /api/bestellseiten/neuer-link { zugangId, stand } - alter Link sofort ungueltig.
router.post('/neuer-link', mitMeldung(req => neuerLink({ eingabe: req.body ?? {} })));
// GET /api/bestellseiten/:zugangId/link - LK1: Token fuer "Link kopieren" (entschluesselt, no-store); Altbestand 409 link_alt.
router.get('/:zugangId/link', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, mitMeldung(req => zeigeLink({ zugangId: req.params.zugangId })));
// POST /api/bestellseiten/bilder { dryRun } - alles in einem Zug (nur noch fuer Trockenlauf/Tests; dauert Minuten).
router.post('/bilder', mitMeldung(req => aktualisiereBilder({ dryRun: req.body?.dryRun === true })));
// KS2-2: Knopf "Artikelliste aktualisieren" in Stuecken (kein Browser-Abbruch, kein Cloud-Run-Zeitlimit):
// POST /bilder/plan -> { stuecke, vorherStand, stand, produkte, trikots } (nur Sheet)
router.post('/bilder/plan', mitMeldung(() => bilderPlan()));
// POST /bilder/stueck { ids, ohneVariationen } -> { zeilen, abrufe } (Shop, hoechstens 6 Produkte, schreibt nichts)
router.post('/bilder/stueck', mitMeldung(req => bilderStueck({ ids: req.body?.ids, ohneVariationen: req.body?.ohneVariationen })));
// POST /bilder/schreiben { zeilen, vorherStand, stand, produkte, trikots, abrufe } -> Rueckmeldung (Stand gleich, sonst 409)
router.post('/bilder/schreiben', mitMeldung(req => bilderSchreiben({ ...(req.body ?? {}), dryRun: false })));

export default router;
