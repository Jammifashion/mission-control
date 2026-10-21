import { Router } from 'express';
import { runKorbAbgleich, leseKorb } from '../lib/lshopKorb.js';
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

// ── GET /api/bestellen/lshop-korb?shop=jfn|honk ──────────────────────────────
// Liest NUR den Reiter Warenkorb_LShop, gebuendelt nach LShop_ArticleNr, ohne Kundennamen.
router.get('/lshop-korb', async (req, res, next) => {
  try {
    res.json(await leseKorb({ shop: req.query.shop }));
  } catch (err) { next(err); }
});

export default router;
