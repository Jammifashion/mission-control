import { Router } from 'express';
import {
  runKorbAbgleich, leseKorb, setzeStatus, sucheLShopModelle, lshopModellVarianten, legeEigenePositionAn,
} from '../lib/lshopKorb.js';
import { notifyFehler } from '../lib/chatNotify.js';
import { ediVorschau, ediErzeugen, ediAlsGesendet } from '../lib/lshopEdi.js';
import { leseLShopBestellungen } from '../lib/lshopBestellungen.js';

const router = Router();

// ── POST /api/bestellen/lshop-korb/abgleich  (hinter requireApiKey) ──────────
// Body optional: { dryRun: true|false, quelle: "knopf"|"workflow", laufId }
// Aufrufer: Knopf "Abgleich jetzt" und .github/workflows/lshop-korb-abgleich.yml (von Hand);
// stuendlich ruft Cloud Scheduler routes/intern.js auf (CS1, OIDC statt API-Key).
// Fehler sind laut: Chat-Meldung (gedrosselt 1/h je Art), dann der Fehlerhandler.
router.post('/lshop-korb/abgleich', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const r = await runKorbAbgleich({ dryRun: body.dryRun ?? false, quelle: body.quelle, laufId: body.laufId });
    console.log(
      `L-Shop-Korb-Abgleich ${r.lauf}${r.dryRun ? ' (DRY RUN)' : ''}: vorhanden=${r.vorhanden} ` +
      `shops=${JSON.stringify(r.shops)} geschrieben=${JSON.stringify(r.schreiben)}`
    );
    res.json(r);
  } catch (err) {
    // Hoster-Pruefseite meldet ihre eigene Middleware; 409 (laeuft schon / Zielzeilen belegt) ist kein Ausfall.
    if (err?.code !== 'hoster_pruefseite' && (err?.status ?? 500) >= 500) {
      await notifyFehler({ art: 'L-Shop-Korb-Abgleich', status: err?.status ?? 500, text: err?.message });
    }
    next(err);
  }
});

// ── POST /api/bestellen/lshop-korb/status  (BO3) ─────────────────────────────
// Body: { auswahl: [{ schluessel, status }], ziel: "abgewählt"|"offen", grund, notiz }
// status = was der Browser gesehen hat; weicht die Zeile ab -> 409, nichts geschrieben.
router.post('/lshop-korb/status', async (req, res, next) => {
  try {
    const { auswahl, ziel, grund, notiz } = req.body ?? {};
    const r = await setzeStatus({ auswahl, ziel, grund, notiz });
    console.log(`L-Shop-Korb Status -> ${r.ziel}: ${r.geaendert} Position(en)`);
    res.json(r);
  } catch (err) { next(err); }
});

// ── GET /api/bestellen/lshop-korb/modelle?q=  (BO3, Auswahl eigene Position) ──
// Eine Suchzeile ueber LShop_Modelle: ArticleNr, Modell, L-Shop-Name, Hersteller.
router.get('/lshop-korb/modelle', async (req, res, next) => {
  try { res.json(await sucheLShopModelle({ q: req.query.q })); } catch (err) { next(err); }
});

// ── GET /api/bestellen/lshop-korb/modelle/:catalogNr/varianten  (BO3) ────────
router.get('/lshop-korb/modelle/:catalogNr/varianten', async (req, res, next) => {
  try { res.json(await lshopModellVarianten({ catalogNr: req.params.catalogNr })); } catch (err) { next(err); }
});

// ── POST /api/bestellen/lshop-korb/eigen  (BO3) ──────────────────────────────
// Body: { articleNr, menge, referenz, notiz }. SSOT-ID bleibt leer; Nummer EIGEN:<Jahr>-NNNN vergibt der Server.
router.post('/lshop-korb/eigen', async (req, res, next) => {
  try {
    const r = await legeEigenePositionAn({ eingabe: req.body ?? {} });
    console.log(`L-Shop-Korb eigene Position ${r.schluessel} (Zeile ${r.zeile})`);
    res.json(r);
  } catch (err) { next(err); }
});

// ── POST /api/bestellen/lshop-korb/edi/vorschau  (BO4a) ──────────────────────
// ── POST /api/bestellen/lshop-korb/edi/erzeugen  (BO4a) ──────────────────────
// Body: { auswahl: [{ schluessel, status }], commission, versandart }. Erzeugt nur die EDI-Datei fuer
// den Browser (Vorschau/Download) - es gibt hier keinen Versand an L-Shop. Vorschau schreibt nichts;
// Erzeugen vergibt die order_id und schreibt eine Protokollzeile. Pruefbericht rot -> 422 + pruefung.
// versandart fehlt -> Vorgabe aus Config (BO4e).
router.post('/lshop-korb/edi/vorschau', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    res.json(await ediVorschau({ auswahl: b.auswahl, commission: b.commission, versandart: b.versandart }));
  } catch (err) { next(err); }
});

router.post('/lshop-korb/edi/erzeugen', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const r = await ediErzeugen({ auswahl: b.auswahl, commission: b.commission, versandart: b.versandart });
    console.log(`EDI-Datei erzeugt: ${r.orderId} (${r.items.length} Positionen, ${r.stueck} Stueck, Protokollzeile ${r.protokollZeile})`);
    res.json(r);
  } catch (err) {
    if (err?.status === 422 && err.pruefung) return res.status(422).json({ error: err.message, pruefung: err.pruefung });
    next(err);
  }
});

// ── POST /api/bestellen/lshop-korb/edi/gesendet  (BO4e) ──────────────────────
// Body: { orderId }. Markiert einen Entwurf als gesendet (von Hand in ORDER gelegt): EDI-Status + Korb-
// Positionen in einem Schreibaufruf. Keine Uebertragung an L-Shop. Position nicht offen -> 422 + probleme.
router.post('/lshop-korb/edi/gesendet', async (req, res, next) => {
  try {
    const r = await ediAlsGesendet({ orderId: req.body?.orderId });
    console.log(`EDI-Datei als gesendet markiert: ${r.orderId} (${r.positionen} Positionen)`);
    res.json(r);
  } catch (err) {
    if (err?.status === 422 && err.probleme) return res.status(422).json({ error: err.message, probleme: err.probleme });
    next(err);
  }
});

// ── GET /api/bestellen/lshop-korb?shop=jfn|honk[&mit=bestelldatum] ───────────
// Liest NUR den Reiter Warenkorb_LShop, gebuendelt nach LShop_ArticleNr, ohne Kundennamen.
// BO3c: mit=bestelldatum liest zusaetzlich das Bestelldatum (nur der Tag) der offenen
// Shop-Positionen aus WooCommerce - fuer "Gruppieren nach Dringlichkeit".
router.get('/lshop-korb', async (req, res, next) => {
  try {
    res.json(await leseKorb({ shop: req.query.shop, mit: req.query.mit }));
  } catch (err) { next(err); }
});

// ── GET /api/bestellen/lshop-bestellungen?shop=  (BO4d) ──────────────────────
// Unterreiter "L-Shop-Bestellungen": je EDI-Bestellung (ab "gesendet") Kopf, Status, Positionen,
// Lieferscheine mit Paketen/Tracking; dazu Portal-Sendungen. Nur lesen, nur Sheets, nur JFN.
router.get('/lshop-bestellungen', async (req, res, next) => {
  try {
    res.json(await leseLShopBestellungen({ shop: req.query.shop }));
  } catch (err) { next(err); }
});

export default router;
