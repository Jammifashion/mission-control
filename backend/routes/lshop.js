import { Router } from 'express';
import { stammdatenLauf } from '../lib/lshopStammdaten.js';
import { notify, buildLShopStammdatenNachricht } from '../lib/chatNotify.js';

const router = Router();

// ── POST /api/lshop/stammdaten  (hinter requireApiKey) ───────────────────────
// Body: { modus: "trockenlauf" | "uebernehmen", datei?: "<Dateiname des Trockenlaufs>" }
// Logik in lib/lshopStammdaten.js. Trockenlauf schreibt nichts; Uebernehmen
// verweigert (409), wenn inzwischen eine andere Datei die neueste ist.
// Log: nur Zaehler, nie Inhalte der Datei (keine Preise).
router.post('/stammdaten', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const r = await stammdatenLauf({
      modus: body.modus, datei: body.datei,
      notify, baueMeldung: buildLShopStammdatenNachricht,
    });
    console.log(
      `L-Shop-Stammdaten ${r.modus} ${r.datei.name}: modelle=${r.modelle.gefunden}/${r.modelle.gebraucht} ` +
      `neu=${r.zeilen.neu} geaendert=${r.zeilen.geaendert} ausgelaufen=${r.zeilen.ausgelaufen} ` +
      `preisAenderungen=${r.preisAenderungen} ohneTreffer=${r.modelle.ohneTreffer}` +
      (r.rueckgelesen ? ` rueckgelesen=${r.rueckgelesen.ok ? 'ok' : 'ABWEICHUNG'}` : '') +
      (r.chat ? ` chat=${r.chat}` : ''),
    );
    res.json(r);
  } catch (err) {
    next(err);
  }
});

export default router;
