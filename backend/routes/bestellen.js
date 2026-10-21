import { Router } from 'express';
import {
  runKorbAbgleich, leseKorb, setzeStatus, sucheArtikel, artikelVarianten, legeEigenePositionAn,
} from '../lib/lshopKorb.js';
import { notifyFehler } from '../lib/chatNotify.js';

const router = Router();

// ── POST /api/bestellen/lshop-korb/abgleich  (hinter requireApiKey) ──────────
// Body optional: { dryRun: true|false, quelle: "knopf"|"workflow", laufId }
// Aufrufer: Knopf "Abgleich jetzt" und .github/workflows/lshop-korb-abgleich.yml
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

// ── GET /api/bestellen/lshop-korb/artikel?q=  (BO3, Auswahl eigene Position) ──
router.get('/lshop-korb/artikel', async (req, res, next) => {
  try { res.json(await sucheArtikel({ q: req.query.q })); } catch (err) { next(err); }
});

// ── GET /api/bestellen/lshop-korb/artikel/:ssotId/varianten  (BO3) ───────────
router.get('/lshop-korb/artikel/:ssotId/varianten', async (req, res, next) => {
  try { res.json(await artikelVarianten({ ssotId: req.params.ssotId })); } catch (err) { next(err); }
});

// ── POST /api/bestellen/lshop-korb/eigen  (BO3) ──────────────────────────────
// Body: { ssotId, wcVariationId, menge, referenz, notiz }. Nummer EIGEN:<Jahr>-NNNN vergibt der Server.
router.post('/lshop-korb/eigen', async (req, res, next) => {
  try {
    const r = await legeEigenePositionAn({ eingabe: req.body ?? {} });
    console.log(`L-Shop-Korb eigene Position ${r.schluessel} (Zeile ${r.zeile})`);
    res.json(r);
  } catch (err) { next(err); }
});

// ── GET /api/bestellen/lshop-korb?shop=jfn|honk ──────────────────────────────
// Liest NUR den Reiter Warenkorb_LShop, gebuendelt nach LShop_ArticleNr, ohne Kundennamen.
router.get('/lshop-korb', async (req, res, next) => {
  try {
    res.json(await leseKorb({ shop: req.query.shop }));
  } catch (err) { next(err); }
});

export default router;
