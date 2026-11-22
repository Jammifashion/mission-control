// MI1: Assistent "Mika" Stufe 0 (hinter requireApiKey). Duenner Aufrufer: Laden lib/mika.js, Regeln utils/mika.js.
// POST statt GET: die gesuchte Nummer steht so in keiner Adresse und keinem Anfrage-Log.
// Nutzung zaehlen: je Antwort GENAU eine Logzeile `mika_frage` { frage, wer, treffer } - keine Nummern, kein Suchtext.
// Fehler beantwortet die Route selbst mit festem Text (nie die Fehlermeldung, die eine Nummer enthalten kann).
// Laufstopps (Hoster-Pruefseite, Zeitueberschreitung) gehen an den Laufstopp-Handler (Chat-Meldung) - Nummer vorher entfernt.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { beantworteFrage, sucheNummer, LADER } from '../lib/mika.js';
import { HosterPruefseiteError, ShopZeitueberschreitungError } from '../lib/hosterPruefseite.js';
import { mikaLogZeile, FEHLER_TEXT } from '../utils/mika.js';

export const MIKA_MAX = 120;   // je IP in 15 min - Tippen ist gewollt, Dauerschleifen nicht
const bremse = rateLimit({
  windowMs: 15 * 60 * 1000, limit: MIKA_MAX, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Zu viele Fragen in kurzer Zeit – bitte kurz warten.', code: 'mika_bremse' },
});

const PERSONEN = ['inhaber', 'nicole'];

/** Handler als Funktion (Tests rufen ihn mit Attrappen). */
export const mikaHandler = (art, lader = LADER, log = console.log) => async (req, res, next) => {
  const wer = req.mcSchluessel;
  if (!PERSONEN.includes(wer)) return res.status(403).json({ error: 'Mika nur mit persönlicher Anmeldung (Inhaber oder Nicole).', code: 'mika_wer' });
  const frage = art === 'suche' ? 'suche' : String(req.body?.frage ?? '');
  try {
    const antwort = art === 'suche'
      ? await sucheNummer({ eingabe: { nummer: req.body?.nummer, shop: req.body?.shop }, lader })
      : await beantworteFrage({ frage, fuer: String(req.body?.fuer ?? ''), shop: String(req.query?.shop ?? req.body?.shop ?? '').toLowerCase(), lader });
    log(mikaLogZeile({ frage, wer, treffer: antwort.treffer }));
    res.json(antwort);
  } catch (err) {
    if (err instanceof HosterPruefseiteError || err instanceof ShopZeitueberschreitungError) return next(err);
    const status = err?.status === 422 ? 422 : 502;
    console.warn(`Mika: Fehler ${status} (${err?.code ?? 'mika_fehler'})`);
    // 422 = Eingabe (fester Text aus utils/mika.js, ohne die Eingabe); sonst immer der feste Mika-Text
    res.status(status).json({ error: status === 422 ? err.message : FEHLER_TEXT, code: status === 422 ? err.code : 'mika_fehler' });
  }
};

const router = Router();
// POST /api/mika/frage { frage: heute|dringend, fuer: ''|Christian|Nicole }  (?shop= haengt apiFetch an)
router.post('/frage', bremse, mikaHandler('frage'));
// POST /api/mika/suche { nummer, shop: jfn|honk }
router.post('/suche', bremse, mikaHandler('suche'));

export default router;
