// Kundenstamm (AM-1), hinter requireApiKey. Logik in lib/kunden.js + utils/kunden.js.
// Die Suche laeuft im Browser (der Suchbegriff geht nie an den Server, steht also in keinem Log).
// Log: nur Kunden_Nr, nie Namen.
import { Router } from 'express';
import { leseKunden, legeKundeAn, bearbeiteKunde, archiviereKunde, sperreKundeDsgvo } from '../lib/kunden.js';

const router = Router();

// 404/409/422/503 mit Code gehen als Meldung an den Browser (nichts geschrieben), der Rest an den Fehlerhandler.
const mitMeldung = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) {
    if ([404, 409, 422, 503].includes(err?.status) && err.code !== undefined) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    if ([404, 409, 422].includes(err?.status)) return res.status(err.status).json({ error: err.message });
    next(err);
  }
};

// ── GET /api/kunden ───────────────────────────────────────────────────────────
router.get('/', mitMeldung(() => leseKunden()));

// ── POST /api/kunden/neu ──────────────────────────────────────────────────────
// Body { Art, Name, Spitzname, Ansprechpartner, E-Mail, Telefon, Strasse, PLZ, Ort, Land, Notiz }; Quelle mc.
router.post('/neu', mitMeldung(async req => {
  const r = await legeKundeAn({ eingabe: req.body ?? {} });
  console.log(`Kunde neu: ${r.kundenNr}`);
  return r;
}));

// ── POST /api/kunden/bearbeiten ───────────────────────────────────────────────
// Body { kundenNr, stand (wie gesehen), …Felder }. Quelle lexoffice: nur Spitzname/Notiz.
router.post('/bearbeiten', mitMeldung(async req => {
  const r = await bearbeiteKunde({ eingabe: req.body ?? {} });
  if (!r.unveraendert) console.log(`Kunde bearbeitet: ${r.kundenNr}`);
  return r;
}));

// ── POST /api/kunden/archivieren ──────────────────────────────────────────────
// Body { kundenNr, stand, archivieren: true | false (= zurueckholen) }. Kein Loeschen.
router.post('/archivieren', mitMeldung(async req => {
  const r = await archiviereKunde({ eingabe: req.body ?? {} });
  if (!r.unveraendert) console.log(`Kunde ${req.body?.archivieren === false ? 'aktiv' : 'archiviert'}: ${r.kundenNr}`);
  return r;
}));

// ── POST /api/kunden/dsgvo-sperren ────────────────────────────────────────────
// Body { kundenNr, stand, bestaetigung (= Kunden-Nr. getippt) }. Personenfelder leer, Kunden_Nr bleibt.
router.post('/dsgvo-sperren', mitMeldung(async req => {
  const r = await sperreKundeDsgvo({ eingabe: req.body ?? {} });
  if (!r.unveraendert) console.log(`Kunde DSGVO gesperrt: ${r.kundenNr}`);
  return r;
}));

export default router;
