// Auftraege (AM-2), hinter requireApiKey. Logik in lib/auftraege.js + utils/auftraege.js.
// Nur Auftrag_Nr/Kunden_Nr und Zahlen im Log, nie Namen oder Freitexte.
import { Router } from 'express';
import { leseAuftraege, legeAuftragAn, bearbeiteAuftrag, wechsleStatus, setzePositionFertig } from '../lib/auftraege.js';

const router = Router();

const mitMeldung = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) {
    if ([404, 409, 422, 503].includes(err?.status)) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
};

// ── GET /api/auftraege ────────────────────────────────────────────────────────
// Alle Auftraege mit aktiven Positionen (L-Shop-Anzeige: Modell, Farbe, Groesse, Lieferbarkeit) und Zahlen.
router.get('/', mitMeldung(() => leseAuftraege()));

// ── POST /api/auftraege/neu ───────────────────────────────────────────────────
// Body { Kunden_Nr, Kurztitel, Kanal, Termin, Notiz, status: Anfrage|Angebot, vorgang,
//        positionen: [{ art: lshop|frei, articleNr | freitext, menge, motiv, druck, notiz }] }.
router.post('/neu', mitMeldung(async req => {
  const r = await legeAuftragAn({ eingabe: req.body ?? {} });
  if (!r.schon) console.log(`Auftrag neu: ${r.auftragNr} (${r.positionen} Positionen)`);
  return r;
}));

// ── POST /api/auftraege/bearbeiten ────────────────────────────────────────────
// Body { auftragNr, stand, Kurztitel?, Kanal?, Termin?, Notiz?, Kunden_Nr?, positionen? (ganze Liste, positionId je vorhandener) }.
router.post('/bearbeiten', mitMeldung(async req => {
  const r = await bearbeiteAuftrag({ eingabe: req.body ?? {} });
  if (!r.unveraendert) console.log(`Auftrag bearbeitet: ${r.auftragNr}`);
  return r;
}));

// ── POST /api/auftraege/status ────────────────────────────────────────────────
// Body { auftragNr, stand, aktion: weiter | zurueck | bezahlt | bezahlt_zurueck | stornieren | storno_zurueck }.
router.post('/status', mitMeldung(async req => {
  const r = await wechsleStatus({ eingabe: req.body ?? {} });
  console.log(`Auftrag ${r.auftragNr}: Status ${r.status}`);
  return r;
}));

// ── POST /api/auftraege/position-fertig ───────────────────────────────────────
// Body { auftragNr, positionId, fertig: true|false }.
router.post('/position-fertig', mitMeldung(req => setzePositionFertig({ eingabe: req.body ?? {} })));

export default router;
