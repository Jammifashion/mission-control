// Bestellseiten verwalten (KS1), hinter requireApiKey. Logik in lib/bestellseite.js + utils/bestellseite.js.
// Der Token-Klartext steht nur in der Antwort von /neu, /neuer-link und (LK1) /:zugangId/link (Kopieren-Knopf), nie im Log.
import { Router } from 'express';
import { leseZugaenge, legeZugangAn, bearbeiteZugang, neuerLink, zeigeLink, aktualisiereBilder, leseKategorien, bilderPlan, bilderStueck, bilderSchreiben } from '../lib/bestellseite.js';
import { leseEintraegeMc } from '../lib/bestellEintraege.js';   // KS2: nur ansehen
import { pruefeEintraege, aendereEintragMc, uebernahmeVorschau, uebernehmen, eintraegeZumAuftrag } from '../lib/bestellUebernahme.js';   // KS3
import { setzeFertig, setzeDa, setzeGeliefert, verschiebe } from '../lib/bestellStand.js';   // KS4
import { entwuerfeMc, entwurfBildMc, setzeEntwurfOrdner } from '../lib/bestellEntwuerfe.js';   // KS7

const router = Router();

const mitMeldung = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) {
    if ([404, 409, 413, 422, 502].includes(err?.status)) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    next(err);
  }
};

// GET /api/bestellseiten - alle Zugaenge (ohne Hash), Status, Termine, Stand der Bilder.
router.get('/', mitMeldung(() => leseZugaenge()));
// GET /api/bestellseiten/kategorien - Auswahl fuer das Sortiment (Nummer, Pfad).
router.get('/kategorien', mitMeldung(async () => ({ kategorien: (await leseKategorien()).map(k => ({ nr: k.nr, pfad: k.pfad })) })));
// ── KS7: Entwuerfe (Drive-Ordner) ──
// GET /api/bestellseiten/:zugangId/entwuerfe - Liste wie die Seite; GET .../entwurf/:nr?groesse= - Bild (Vorschau in MC)
router.get('/:zugangId/entwuerfe', mitMeldung(req => entwuerfeMc({ zugangId: req.params.zugangId })));
router.get('/:zugangId/entwurf/:nr', async (req, res, next) => {
  try {
    const b = await entwurfBildMc({ zugangId: req.params.zugangId, nr: req.params.nr, groesse: String(req.query.groesse ?? '') });
    res.set('Cache-Control', 'private, max-age=300'); res.set('Content-Type', b.typ); res.send(b.buf);
  } catch (err) {
    if ([404, 409, 413, 422, 502].includes(err?.status)) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    next(err);
  }
});
// POST /api/bestellseiten/entwuerfe/ordner { zugangId, stand, link | anlegen | entfernen }
router.post('/entwuerfe/ordner', mitMeldung(req => setzeEntwurfOrdner({ eingabe: req.body ?? {} })));
// GET /api/bestellseiten/:zugangId/eintraege - KS2: Eintraege des Zugangs nur ansehen (Rueckennamen nur in der Oberflaeche).
router.get('/:zugangId/eintraege', mitMeldung(req => leseEintraegeMc({ zugangId: req.params.zugangId })));
// ── KS3: pruefen, aendern, ablehnen, uebernehmen ──
// POST /api/bestellseiten/eintraege/pruefen { zugangId, aktion: geprueft|zurueck|ablehnen, auswahl:[{id,stand}], grund }
router.post('/eintraege/pruefen', mitMeldung(req => pruefeEintraege({ eingabe: req.body ?? {} })));
// POST /api/bestellseiten/eintraege/aendern { zugangId, eintrag, stand, menge?, id?, freitext?, groesse?, name?, nummer?, wunsch?, notiz? }
router.post('/eintraege/aendern', mitMeldung(req => aendereEintragMc({ eingabe: req.body ?? {} })));
// GET /api/bestellseiten/:zugangId/termin/:terminId/uebernahme - Vorschau (anhaengbare AU, Kandidaten "schon bestellt"), nur lesen
router.get('/:zugangId/termin/:terminId/uebernahme', mitMeldung(req => uebernahmeVorschau({ zugangId: req.params.zugangId, terminId: req.params.terminId })));
// POST /api/bestellseiten/uebernehmen { zugangId, terminId, auswahl, ziel, verknuepfen, vorgang, dryRun }
router.post('/uebernehmen', mitMeldung(req => uebernehmen({ eingabe: req.body ?? {} })));
// GET /api/bestellseiten/auftrag/:nr/eintraege - Kürzel/Notiz je Position (nur Anzeige)
router.get('/auftrag/:nr/eintraege', mitMeldung(req => eintraegeZumAuftrag({ auftragNr: req.params.nr })));
// ── KS4: fertig, an Fanshop geliefert, in anderen Termin verschieben ──
// POST /api/bestellseiten/fertig { positionIds, fertig } - Haken "fertig" fuer mehrere Positionen (auch Auftragsansicht). KS4-1: vorher /gedruckt
router.post('/fertig', mitMeldung(req => setzeFertig({ eingabe: req.body ?? {} })));
router.post('/gedruckt', mitMeldung(req => setzeFertig({ eingabe: req.body ?? {} })));   // alter Name (Oberflaeche bis zum Neuladen)
// KS4-2: POST /api/bestellseiten/da { positionIds, da } - "bei uns" von Hand (nur freie Positionen, noch zu besorgen)
router.post('/da', mitMeldung(req => setzeDa({ eingabe: req.body ?? {} })));
// POST /api/bestellseiten/geliefert { zugangId, terminId | auftragNr, zurueck } - Versendet je Position (+ Trikot-Eintraege), fertig -> übergeben
router.post('/geliefert', mitMeldung(req => setzeGeliefert({ eingabe: req.body ?? {} })));
// POST /api/bestellseiten/verschieben { zugangId, auswahl, zielTermin | neuesDatum, notiz, grund, vorgang, dryRun }
router.post('/verschieben', mitMeldung(req => verschiebe({ eingabe: req.body ?? {} })));
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
