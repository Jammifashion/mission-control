// Lager (BO5-1), hinter requireApiKey. Logik in lib/lager.js + utils/lager.js.
import { Router } from 'express';
import {
  leseBestand, sucheRohling, rohlingVarianten, sucheFertig, fertigVarianten, trikotAuswahl, fremdAuswahl,
  bucheLager, gegenbuchung, neuerOrt, neuerArtikel,
} from '../lib/lager.js';

const router = Router();

// 409/422 mit Problemen gehen als Meldung an den Browser (nichts geschrieben), der Rest an den Fehlerhandler.
const mitMeldung = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) {
    if ([404, 409, 422].includes(err?.status) && (err.probleme || err.code)) {
      return res.status(err.status).json({ error: err.message, probleme: err.probleme ?? [], code: err.code, vorhanden: err.vorhanden });
    }
    next(err);
  }
};

// ── GET /api/lager/bestand ────────────────────────────────────────────────────
// Bestand je Schluessel + Ort (auch 0), Verlauf (neueste oben), Orte, Freitext-Artikel. 60 s Zwischenspeicher,
// jede Buchung leert ihn. Nur lesen, nur Sheets.
router.get('/bestand', mitMeldung(() => leseBestand()));

// ── Auswahl im Dialog (nur lesen) ─────────────────────────────────────────────
router.get('/auswahl/rohling', mitMeldung(req => sucheRohling({ q: req.query.q })));
router.get('/auswahl/rohling/:catalogNr', mitMeldung(req => rohlingVarianten({ catalogNr: req.params.catalogNr })));
router.get('/auswahl/fertig', mitMeldung(req => sucheFertig({ q: req.query.q })));
router.get('/auswahl/fertig/:ssotId', mitMeldung(req => fertigVarianten({ ssotId: req.params.ssotId })));
router.get('/auswahl/trikot', mitMeldung(() => trikotAuswahl()));
router.get('/auswahl/fremd', mitMeldung(() => fremdAuswahl()));

// ── POST /api/lager/buchen ────────────────────────────────────────────────────
// Body { aktion: einbuchen|ausbuchen|umlagern|zaehlung|start, art, ort, zielOrt, grund, bezug, notiz,
//        posten: [{ schluessel, menge }], vorgang }. Alles oder nichts; nie negativ; derselbe vorgang bucht nur einmal.
router.post('/buchen', mitMeldung(async req => {
  const r = await bucheLager({ eingabe: req.body ?? {} });
  console.log(`Lager ${req.body?.aktion}: ${r.zeilen} Zeile(n)${r.schonGebucht ? ' (schon gebucht)' : ''}`);
  return r;
}));

// ── POST /api/lager/gegenbuchung { buchungId, vorgang } ───────────────────────
router.post('/gegenbuchung', mitMeldung(async req => {
  const r = await gegenbuchung({ eingabe: req.body ?? {} });
  console.log(`Lager Gegenbuchung ${req.body?.buchungId}: ${r.zeilen} Zeile(n)${r.schonGebucht ? ' (schon gebucht)' : ''}`);
  return r;
}));

// ── POST /api/lager/orte { ort, notiz } · POST /api/lager/artikel { bezeichnung, warenart, … } ──
router.post('/orte', mitMeldung(req => neuerOrt({ eingabe: req.body ?? {} })));
router.post('/artikel', mitMeldung(req => neuerArtikel({ eingabe: req.body ?? {} })));

export default router;
