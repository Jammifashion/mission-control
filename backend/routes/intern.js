import { Router } from 'express';
import { requireSchedulerOidc } from '../middleware/schedulerAuth.js';
import { runKorbAbgleich, BESCHAEFTIGT } from '../lib/lshopKorb.js';
import { notifyFehler } from '../lib/chatNotify.js';

// Endpunkte fuer Google Cloud Scheduler (CS1). Stehen VOR requireApiKey und nur
// hinter requireSchedulerOidc - ein MC_API_KEY oeffnet sie nicht.
const router = Router();
router.use(requireSchedulerOidc);

// ── POST /api/intern/lshop-korb/abgleich  (Job lshop-korb-abgleich, stuendlich :17) ──
// Body wird ignoriert: kein Trockenlauf, keine Optionen aus dem Scheduler.
// Antworten fuer die Wiederholung im Scheduler: Sperre (laeuft schon) = 200
// "uebersprungen", sonst wuerde er unnoetig wiederholen; 5xx bleibt 5xx (Chat-Meldung
// wie der API-Key-Weg); 503 Hoster-Pruefseite meldet ihre eigene Middleware.
router.post('/lshop-korb/abgleich', async (_req, res, next) => {
  const laufId = `CS-${new Date().toISOString().slice(0, 16)}Z`;
  try {
    const r = await runKorbAbgleich({ dryRun: false, quelle: 'scheduler', laufId });
    console.log(
      `L-Shop-Korb-Abgleich ${r.lauf}: vorhanden=${r.vorhanden} ` +
      `shops=${JSON.stringify(r.shops)} geschrieben=${JSON.stringify(r.schreiben)}`
    );
    res.json(r);
  } catch (err) {
    if (err?.status === 409 && err?.message === BESCHAEFTIGT) {
      console.log(`L-Shop-Korb-Abgleich ${laufId}: uebersprungen (laeuft schon)`);
      return res.json({ uebersprungen: 'läuft schon', lauf: laufId });
    }
    if (err?.code !== 'hoster_pruefseite' && (err?.status ?? 500) >= 500) {
      await notifyFehler({ art: 'L-Shop-Korb-Abgleich', status: err?.status ?? 500, text: err?.message });
    }
    next(err);
  }
});

export default router;
