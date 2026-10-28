import { Router } from 'express';
import { stammdatenLauf, mitStammdatenSperre } from '../lib/lshopStammdaten.js';
import { modelleAmpel, modellePruefen, modelleUebernehmen, modellZurueckziehen, zusatzListe } from '../lib/lshopModelle.js';
import { notify, buildLShopStammdatenNachricht, buildLShopModelleNachricht } from '../lib/chatNotify.js';

const router = Router();

// ── POST /api/lshop/stammdaten  (hinter requireApiKey) ───────────────────────
// Body: { modus: "trockenlauf" | "uebernehmen", datei?: "<Dateiname des Trockenlaufs>" }
// Logik in lib/lshopStammdaten.js. Trockenlauf schreibt nichts; Uebernehmen
// verweigert (409), wenn inzwischen eine andere Datei die neueste ist.
// LS4: unter der Stammdaten-Sperre (laeuft schon ein Lauf -> 409).
// Log: nur Zaehler, nie Inhalte der Datei (keine Preise).
router.post('/stammdaten', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const r = await mitStammdatenSperre(`Stammdaten ${body.modus === 'uebernehmen' ? 'Übernehmen' : 'Prüfen'}`, () => stammdatenLauf({
      modus: body.modus, datei: body.datei,
      notify, baueMeldung: buildLShopStammdatenNachricht,
    }));
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

// ── Ansicht "L-Shop-Modelle" (LS4), Logik lib/lshopModelle.js ────────────────
// Log nur Anzahl und Modellnummern, nie Inhalte der Datei, nie Notizen.

// POST /api/lshop/modelle/ampel { eingaben: string[] } - nur Sheets, schreibt nichts
router.post('/modelle/ampel', async (req, res, next) => {
  try { res.json(await modelleAmpel({ eingaben: req.body?.eingaben })); } catch (err) { next(err); }
});

// POST /api/lshop/modelle/pruefen { eingaben: string[] } - ein Lauf ueber die Stammdatei, schreibt nichts
router.post('/modelle/pruefen', async (req, res, next) => {
  try {
    const r = await modellePruefen({ eingaben: req.body?.eingaben });
    const zaehl = s => r.ergebnisse.filter(e => e.stufe === s).length;
    console.log(`L-Shop-Modelle pruefen ${r.datei.name}: eingaben=${r.ergebnisse.length} gefunden=${zaehl('gefunden')} `
      + `vorschlag=${zaehl('vorschlag')} nicht=${zaehl('nicht')} da=${zaehl('da')} fremd=${r.fremd.length}`);
    res.json(r);
  } catch (err) { next(err); }
});

// POST /api/lshop/modelle/uebernehmen { auswahl: [{ catalogNr, notiz }], datei }
router.post('/modelle/uebernehmen', async (req, res, next) => {
  try {
    const r = await modelleUebernehmen({
      auswahl: req.body?.auswahl, datei: req.body?.datei, notify, baueMeldung: buildLShopModelleNachricht,
    });
    console.log(`L-Shop-Modelle uebernommen ${r.datei.name}: ${r.modelle.join(', ')} zeilenNeu=${r.zeilenNeu} `
      + `rueckgelesen=${r.rueckgelesen ? 'ok' : 'ABWEICHUNG'}${r.chat ? ` chat=${r.chat}` : ''}`);
    res.json(r);
  } catch (err) { next(err); }
});

// POST /api/lshop/modelle/zurueckziehen { catalogNr } - Status "zurückgezogen", nie loeschen
router.post('/modelle/zurueckziehen', async (req, res, next) => {
  try {
    const r = await modellZurueckziehen({ catalogNr: req.body?.catalogNr });
    console.log(`L-Shop-Modelle zurueckgezogen: ${r.catalogNr}`);
    res.json(r);
  } catch (err) { next(err); }
});

// GET /api/lshop/modelle/liste - Eintraege der Liste (neueste zuerst)
router.get('/modelle/liste', async (req, res, next) => {
  try { res.json(await zusatzListe()); } catch (err) { next(err); }
});

export default router;
