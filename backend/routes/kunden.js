// Kundenstamm (AM-1), hinter requireApiKey. Logik in lib/kunden.js + utils/kunden.js.
// Die Suche laeuft im Browser (der Suchbegriff geht nie an den Server, steht also in keinem Log).
// Log: nur Kunden_Nr, nie Namen.
import { Router } from 'express';
import {
  leseKunden, legeKundeAn, bearbeiteKunde, archiviereKunde, sperreKundeDsgvo, leseKundenZahlen, sucheInLexoffice, uebernehmeAusLexoffice,
} from '../lib/kunden.js';
import { leseAuftragZahlen } from '../lib/auftraege.js';

const router = Router();

// 404/409/422/503 mit Code gehen als Meldung an den Browser (nichts geschrieben), der Rest an den Fehlerhandler.
const mitMeldung = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) {
    if ([404, 409, 422, 502, 503].includes(err?.status) && err.code !== undefined) {   // 502 lexware: Pfad + Status, nie Inhalt
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    if ([404, 409, 422].includes(err?.status)) return res.status(err.status).json({ error: err.message });
    next(err);
  }
};

// ── GET /api/kunden ───────────────────────────────────────────────────────────
router.get('/', mitMeldung(() => leseKunden()));

// ── GET /api/kunden/zahlen ────────────────────────────────────────────────────
// Nur Zahlen (Dashboard-Kachel "Aufträge"): gesamt, aktiv, archiviert, gesperrt, firmen, vereine, personen.
// AM-2: dazu `auftraege` { offen, terminBald, fertigNichtBezahlt } (Reiter fehlen -> ohne).
router.get('/zahlen', mitMeldung(async () => {
  const z = await leseKundenZahlen();
  try { return { ...z, auftraege: await leseAuftragZahlen() }; } catch { return z; }
}));

// ── POST /api/kunden/lexoffice-suche ──────────────────────────────────────────
// Body { feld: name | email | number, q }. POST, damit der Suchbegriff nie in einer Adresse/einem Zugriffslog steht.
// Nur lesen bei Lexware, eine Seite (25), kein Zwischenspeicher, kein Log.
router.post('/lexoffice-suche', mitMeldung(req => sucheInLexoffice({ feld: req.body?.feld, q: req.body?.q })));

// ── POST /api/kunden/lexoffice-uebernehmen ────────────────────────────────────
// Body { lexofficeId }. Legt genau diesen Kunden an (Quelle lexoffice); schon da -> { schon: true }, nichts doppelt.
router.post('/lexoffice-uebernehmen', mitMeldung(async req => {
  const r = await uebernehmeAusLexoffice({ lexofficeId: req.body?.lexofficeId });
  if (!r.schon) console.log(`Kunde aus Lexoffice übernommen: ${r.kundenNr}`);
  return r;
}));

// ── POST /api/kunden/neu ──────────────────────────────────────────────────────
// Body { Art, Name, Spitzname, Ansprechpartner, E-Mail, Telefon, Strasse, PLZ, Ort, Land, Notiz }; Quelle mc.
router.post('/neu', mitMeldung(async req => {
  const r = await legeKundeAn({ eingabe: req.body ?? {} });
  console.log(`Kunde neu: ${r.kundenNr}`);
  return r;
}));

// ── POST /api/kunden/bearbeiten ───────────────────────────────────────────────
// Body { kundenNr, stand (wie gesehen), …Felder }. Quelle lexoffice: nur Spitzname/Ansprechpartner/Notiz.
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
