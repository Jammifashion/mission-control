// Auftraege (AM-2), hinter requireApiKey. Logik in lib/auftraege.js + utils/auftraege.js.
// Nur Auftrag_Nr/Kunden_Nr und Zahlen im Log, nie Namen oder Freitexte.
import { Router } from 'express';
import {
  leseAuftraege, legeAuftragAn, bearbeiteAuftrag, wechsleStatus, setzePositionFertig, entfernePosition,
  legeAufgabeAn, bearbeiteAufgabe, wechsleAufgabeStatus, legeTodoAn, aendereTodo, verschiebeTodo, archiviereTodo,
  aktualisiereAngebot, setzeZustaendig, leseKundenHistorie,
} from '../lib/auftraege.js';
import { bereitstellenVorschau, bereitstellen, zuruecknehmen } from '../lib/auftragBereitstellen.js';

const router = Router();

const mitMeldung = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) {
    if ([404, 409, 422, 503].includes(err?.status)) return res.status(err.status).json({ error: err.message, code: err.code, probleme: err.probleme, knapp: err.knapp });
    next(err);
  }
};

// ── GET /api/auftraege ────────────────────────────────────────────────────────
// Alle Auftraege mit aktiven Positionen (L-Shop-Anzeige: Modell, Farbe, Groesse, Lieferbarkeit) und Zahlen.
router.get('/', mitMeldung(() => leseAuftraege()));

// ── AM-6: GET /api/auftraege/kunden/:kundenNr/historie ────────────────────────
// "Hatte bisher" je Modell + Farbe und freie Positionen eines Kunden (nur lesen, nichts ins Log).
router.get('/kunden/:kundenNr/historie', mitMeldung(req => leseKundenHistorie({ kundenNr: req.params.kundenNr })));

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
// BS4: POST /api/auftraege/position-entfernen { auftragNr, positionId, wiederherstellen } - markieren (Entfernt), nie loeschen
router.post('/position-entfernen', mitMeldung(req => entfernePosition({ eingabe: req.body ?? {} })));

// ── AM-3: Rohlinge bereitstellen (Korb + Lager) ───────────────────────────────
// POST /bereitstellen/vorschau { auftragNr, teilen, ortWahl } - schreibt nichts.
router.post('/bereitstellen/vorschau', mitMeldung(req => bereitstellenVorschau({ eingabe: req.body ?? {} })));
// POST /bereitstellen { auftragNr, stand, teilen, ortWahl, vorgang } - Korb, Lager, Positionen in einem Schritt.
router.post('/bereitstellen', mitMeldung(async req => {
  const r = await bereitstellen({ eingabe: req.body ?? {} });
  if (!r.schon) console.log(`Auftrag ${r.auftragNr} bereitgestellt: Korb ${r.korb} (${r.korbStueck} Stück), Lager ${r.lager} (${r.lagerStueck} Stück), geteilt ${r.geteilt}`);
  return r;
}));
// POST /zuruecknehmen { auftragNr, positionId, vorgang } - Korb abgewaehlt bzw. Lager-Gegenbuchung.
router.post('/zuruecknehmen', mitMeldung(async req => {
  const r = await zuruecknehmen({ eingabe: req.body ?? {} });
  if (!r.unveraendert) console.log(`Auftrag ${r.auftragNr}: Übergabe ${r.positionId} zurückgenommen`);
  return r;
}));

// ── AM-4: Aufgaben (AG) ───────────────────────────────────────────────────────
// POST /aufgabe/neu { Kurztitel, Notiz, Faellig, Fuer_Art, Fuer, Gehoert_Zu, vorgang }
router.post('/aufgabe/neu', mitMeldung(async req => {
  const r = await legeAufgabeAn({ eingabe: req.body ?? {} });
  if (!r.schon) console.log(`Aufgabe neu: ${r.aufgabeNr}`);
  return r;
}));
// POST /aufgabe/bearbeiten { aufgabeNr, stand, Kurztitel?, Notiz?, Faellig?, Fuer_Art?, Fuer?, Gehoert_Zu?, Wartet_Auf? }
router.post('/aufgabe/bearbeiten', mitMeldung(async req => {
  const r = await bearbeiteAufgabe({ eingabe: req.body ?? {} });
  if (!r.unveraendert) console.log(`Aufgabe bearbeitet: ${r.aufgabeNr}`);
  return r;
}));
// POST /aufgabe/status { aufgabeNr, stand, aktion: weiter | erledigt | zurueck | verwerfen | verwerfen_zurueck, wartetAuf? }
router.post('/aufgabe/status', mitMeldung(async req => {
  const r = await wechsleAufgabeStatus({ eingabe: req.body ?? {} });
  console.log(`Aufgabe ${r.aufgabeNr}: Status ${r.status}`);
  return r;
}));

// ── AM-4: To-dos je Auftrag/Aufgabe ───────────────────────────────────────────
// POST /todo/neu { bezug (AU-/AG-Nr.), text, faellig?, vorgang }
router.post('/todo/neu', mitMeldung(req => legeTodoAn({ eingabe: req.body ?? {} })));
// POST /todo/aendern { todoId, erledigt? | stand + text?/faellig? }
router.post('/todo/aendern', mitMeldung(req => aendereTodo({ eingabe: req.body ?? {} })));
// POST /todo/verschieben { todoId, richtung: hoch | runter }
router.post('/todo/verschieben', mitMeldung(req => verschiebeTodo({ eingabe: req.body ?? {} })));
// POST /todo/archivieren { todoId } - "entfernen", nie loeschen
router.post('/todo/archivieren', mitMeldung(req => archiviereTodo({ eingabe: req.body ?? {} })));

// ── AM-5: Angebotsstand, Zustaendig ───────────────────────────────────────────
// POST /angebot { auftragNr, stand } - aktuelle Summe als Angebotsstand festhalten.
router.post('/angebot', mitMeldung(async req => {
  const r = await aktualisiereAngebot({ eingabe: req.body ?? {} });
  console.log(`Auftrag ${r.auftragNr}: Angebotsstand aktualisiert`);   // nie Betraege
  return r;
}));
// POST /zustaendig { nr (AU-/AG-), zustaendig: Christian | Nicole | "" }
router.post('/zustaendig', mitMeldung(req => setzeZustaendig({ eingabe: req.body ?? {} })));

export default router;
