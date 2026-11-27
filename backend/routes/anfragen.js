import { Router } from 'express';
import { notify, buildAnfrageNachricht } from '../lib/chatNotify.js';
import { leseAnfragen, legeAnfrageAn, bearbeiteAnfrage, verknuepfeAuftrag } from '../lib/anfragen.js';

// Kundenanfragen Admin (hinter requireApiKey). KA1: duenne Aufrufer von lib/anfragen.js - kein values.append,
// Bearbeiten mit Stand wie gesehen (409), nie loeschen (Abschliessen/Ablehnen = Status, Loeschen macht der Loeschlauf).
const router = Router();

// Fehler mit Status (4xx/409) direkt beantworten; Texte nennen nur KA-/AU-Nummern und Feldnamen.
function antwortFehler(res, next, err) {
  if (err?.status && err.status < 500) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  return next(err);
}

// ── POST /neu ────────────────────────────────────────────────────────────────
router.post('/neu', async (req, res, next) => {
  try {
    const { anfrageId, anfrage } = await legeAnfrageAn({ eingabe: req.body ?? {}, kanalErsatz: 'Manuell' });
    // Mit await, vor der Antwort (Cloud Run drosselt die CPU danach). notify() wirft nie.
    await notify(buildAnfrageNachricht({
      anfrageId, kundeName: anfrage['Kunde-Name'], menge: anfrage.Menge, beschreibung: anfrage['Produkt-Beschreibung'],
    }));
    res.status(201).json({ anfrageId });
  } catch (err) { antwortFehler(res, next, err); }
});

// ── GET / ────────────────────────────────────────────────────────────────────
// Liste (Array wie bisher, fuer den Auftragsmonitor); je Anfrage `stand` und `auftragNr`. Spalten-Info im Kopf.
router.get('/', async (req, res, next) => {
  try {
    const { anfragen, spalten } = await leseAnfragen();
    const { status, kanal } = req.query;
    const result = anfragen.filter(a => (!status || a.status === status) && (!kanal || a.kanal === kanal))
      .map(({ zeile, ...a }) => a);
    res.set('X-Anfragen-Auftrag-Spalte', spalten.auftragNr ? 'ja' : 'nein');
    res.json(result);
  } catch (err) { antwortFehler(res, next, err); }
});

// ── POST /bearbeiten { anfrageId, stand, felder } ──────────────────────────
router.post('/bearbeiten', async (req, res, next) => {
  try {
    const { anfrage, unveraendert } = await bearbeiteAnfrage({ eingabe: req.body ?? {} });
    const { zeile, ...a } = anfrage;
    res.json({ anfrage: a, unveraendert });
  } catch (err) { antwortFehler(res, next, err); }
});

// ── POST /auftrag { anfrageId, auftragNr } ── Verknuepfung nachholen (der Auftrag wurde schon angelegt)
router.post('/auftrag', async (req, res, next) => {
  try {
    res.json(await verknuepfeAuftrag({ anfrageId: req.body?.anfrageId, auftragNr: req.body?.auftragNr }));
  } catch (err) { antwortFehler(res, next, err); }
});

export default router;
