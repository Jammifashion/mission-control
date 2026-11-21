// FB1: POST /api/feedback { text, kontext } - hinter requireApiKey.
// "Wer" kommt aus dem geprueften Schluessel (req.mcSchluessel, SI2), nie aus dem Body; der Automatik-Schluessel
// bekommt 403. Fehler werden HIER beantwortet (fester Text + Code), nie an den allgemeinen Fehlerhandler gereicht:
// der Feedback-Text darf in keinem Log stehen. Ins Log nur Nummer, Status, Code und Token-Zahlen.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { speichereFeedback } from '../lib/feedback.js';
import { werAus } from '../utils/feedback.js';

const router = Router();

export const FEEDBACK_MAX = 20;
const bremse = rateLimit({
  windowMs: 15 * 60 * 1000, limit: FEEDBACK_MAX, standardHeaders: true, legacyHeaders: false,
  message: { error: `Zu viele Rückmeldungen (höchstens ${FEEDBACK_MAX} in 15 Minuten) – bitte kurz warten.`, code: 'feedback_bremse' },
});

/** Handler als Funktion (Tests rufen ihn mit einer Attrappe fuer `speichern`). */
export const feedbackHandler = (speichern = speichereFeedback) => async (req, res) => {
  const wer = werAus(req.mcSchluessel);
  if (!wer) {
    console.warn('Feedback: abgelehnt 403 (feedback_wer)');
    return res.status(403).json({ error: 'Feedback nur mit persönlicher Anmeldung (Inhaber oder Nicole).', code: 'feedback_wer' });
  }
  try {
    const r = await speichern({ eingabe: { text: req.body?.text, kontext: req.body?.kontext }, wer });
    console.log(`Feedback: ${r.nr} gespeichert (${wer}, KI ${r.ki ? 'ok' : `leer: ${r.kiGrund}`}${r.nutzung ? `, Token ${r.nutzung.ein ?? '?'}/${r.nutzung.aus ?? '?'}` : ''})`);
    res.json({ nr: r.nr, ki: r.ki });
  } catch (err) {
    const status = [403, 422, 502, 503].includes(err?.status) ? err.status : 500;
    const meldung = status === 500 ? 'Feedback nicht gespeichert – bitte noch einmal senden.' : err.message;
    console.warn(`Feedback: Fehler ${status}${err?.code ? ` (${err.code})` : ''}`);
    res.status(status).json({ error: meldung, code: err?.code ?? 'feedback_fehler' });
  }
};

router.post('/', bremse, feedbackHandler());

export default router;
