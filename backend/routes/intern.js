import { Router } from 'express';
import { requireSchedulerOidc } from '../middleware/schedulerAuth.js';
import { runKorbAbgleich, BESCHAEFTIGT } from '../lib/lshopKorb.js';
import { setzeAutoBestellt } from '../lib/auftraege.js';
import { notifyFehler } from '../lib/chatNotify.js';
import { istLaufStopp } from '../lib/hosterPruefseite.js';
import { runBelegeAbruf, BELEGE_BESCHAEFTIGT } from '../lib/lshopBelege.js';
import { runLieferbarkeit, LIEFERBARKEIT_BESCHAEFTIGT } from '../lib/lshopLieferbarkeit.js';

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
    // AM-3: Auftraege, deren Rohlinge jetzt alle bestellt/ausgebucht sind, auf "bestellt" (nur nach vorn). Fehler hier
    // brechen den Abgleich nicht ab - der naechste Lauf oder der naechste Blick in die Auftraege holt es nach.
    try {
      const gesetzt = await setzeAutoBestellt();
      if (gesetzt.length) console.log(`Aufträge automatisch bestellt: ${gesetzt.join(', ')}`);
      r.auftraegeBestellt = gesetzt.length;
    } catch (e) { console.warn(`Aufträge auto-bestellt übersprungen: ${e?.code ?? e?.status ?? 'Fehler'}`); }
    res.json(r);
  } catch (err) {
    if (err?.status === 409 && err?.message === BESCHAEFTIGT) {
      console.log(`L-Shop-Korb-Abgleich ${laufId}: uebersprungen (laeuft schon)`);
      return res.json({ uebersprungen: 'läuft schon', lauf: laufId });
    }
    // AL1: Hoster-Pruefseite und Shop-Zeitueberschreitung meldet die Middleware (eine Meldung je Ereignis).
    if (!istLaufStopp(err) && err?.code !== 'hoster_pruefseite' && (err?.status ?? 500) >= 500) {
      await notifyFehler({ art: 'L-Shop-Korb-Abgleich', status: err?.status ?? 500, text: err?.message, titel: 'Störung' });
    }
    next(err);
  }
});

// ── POST /api/intern/lshop-belege/abruf  (Job lshop-belege-abruf, :07 und :37 Europe/Berlin, BO4b-1) ──
// Body wird ignoriert. FTP-Fehler (Server wackelt) sind 200 mit ftp "fehler" - die Chat-Meldung
// kommt erst ab 3 Fehllaeufen in Folge (lib/lshopBelege.js). Andere Fehler bleiben 5xx (Chat + Log-Alarm).
router.post('/lshop-belege/abruf', async (_req, res, next) => {
  const laufId = `BA-${new Date().toISOString().slice(0, 16)}Z`;
  try {
    const r = await runBelegeAbruf({ dryRun: false, quelle: 'scheduler', laufId });
    console.log(
      `L-Shop-Belege ${r.lauf}: ftp=${r.ftp}` +
      (r.ftp === 'ok' ? ` ordner=${JSON.stringify(r.ordner)} neu=${r.neueZeilen} alarme=${r.alarme.length} ab=${r.abErkannt.length}`
                      : ` grund="${r.grund}" inFolge=${r.inFolge} gemeldet=${r.gemeldet}`)
    );
    res.json(r);
  } catch (err) {
    if (err?.status === 409 && err?.message === BELEGE_BESCHAEFTIGT) {
      console.log(`L-Shop-Belege ${laufId}: uebersprungen (laeuft schon)`);
      return res.json({ uebersprungen: 'läuft schon', lauf: laufId });
    }
    if (!istLaufStopp(err) && (err?.status ?? 500) >= 500) {
      await notifyFehler({ art: 'L-Shop-Belege', status: err?.status ?? 500, text: err?.message, titel: 'Störung' });
    }
    next(err);
  }
});

// ── POST /api/intern/lshop-lieferbarkeit/abruf  (Job lshop-lieferbarkeit, stuendlich :47 Europe/Berlin, BO7-1) ──
// Body wird ignoriert. FTP-Fehler = 200 ftp "fehler"; erst wenn der letzte Stand aelter als 6 h ist, 502
// (Chat + Log-Alarm). Sperre = 200 "uebersprungen".
router.post('/lshop-lieferbarkeit/abruf', async (_req, res, next) => {
  const laufId = `LB-${new Date().toISOString().slice(0, 16)}Z`;
  try {
    const r = await runLieferbarkeit({ dryRun: false, quelle: 'scheduler', laufId });
    console.log(`L-Shop-Lieferbarkeit ${r.lauf}: ftp=${r.ftp}` + (r.ftp === 'ok'
      ? ` nummern=${r.summen.nummern} null=${r.summen.null} nichtGefuehrt=${r.summen.nichtGefuehrt} auslauf=${r.summen.auslauf} wechsel=${r.wechsel} chat=${r.chat}`
      : ` grund="${r.grund}"`));
    res.json(r);
  } catch (err) {
    if (err?.status === 409 && err?.message === LIEFERBARKEIT_BESCHAEFTIGT) {
      console.log(`L-Shop-Lieferbarkeit ${laufId}: uebersprungen (laeuft schon)`);
      return res.json({ uebersprungen: 'läuft schon', lauf: laufId });
    }
    if (!istLaufStopp(err) && (err?.status ?? 500) >= 500) {
      await notifyFehler({ art: 'L-Shop-Lieferbarkeit', status: err?.status ?? 500, text: err?.message, titel: 'Störung' });
    }
    next(err);
  }
});

export default router;
