// FB1: Feedback speichern - POST /api/feedback { text, kontext }. Logik in utils/feedback.js.
//
// Eigenes Sheet "MC Feedback" (Secret FEEDBACK_SHEET_ID, NICHT in SECRET_KEYS: fehlt es, startet das Backend trotzdem und
// die Route antwortet 503). Schreiben: eine Sperre je Instanz, Reiter EINMAL lesen (naechste Nummer, Zielzeile, Titel fuer
// "aehnlich zu"), KI-Einordnung, dann genau eine Zeile ueber schreibeNeueZeilen (kein append, RAW, zurueckgelesen).
// Schlaegt die KI fehl, wird der Rohtext trotzdem gespeichert (KI-Spalten leer) - nichts geht verloren.
// Der Text steht nie im Log und nie in einer Fehlermeldung.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { getSecret } from '../utils/secrets.js';
import { getModel } from './modelConfig.js';
import { textAufruf, anbieterVon, schluesselFehlt } from './modellAufruf.js';
import { schreibeNeueZeilen } from './sheet-zeilen.js';
import {
  TAB, KI_SCHEMA, pruefeEingabe, systemPrompt, userPrompt, pruefeKiAntwort, standAus, zeileAus, nrText, datumBerlin,
} from '../utils/feedback.js';

export const SECRET = 'FEEDBACK_SHEET_ID';
export const ROLLE = 'feedback';
export const ZEITLIMIT_MS = 30_000;   // wie SA1, ohne Wiederholung

const fehler = (msg, status, code) => Object.assign(new Error(msg), { status, code });

async function sheetsClient() { return google.sheets({ version: 'v4', auth: await getGoogleAuth() }); }

/** Sheet-ID oder '' (fehlt, leer, nicht lesbar). Nie werfen: ohne Feedback-Sheet laeuft MC weiter. */
export async function feedbackSheetId({ lies = getSecret } = {}) {
  try { return String(await lies(SECRET) ?? '').trim(); } catch { return ''; }
}

// Eine Sperre je Instanz (max. 1 Instanz, FIX1): Nummer und Zielzeile werden nie doppelt vergeben.
let kette = Promise.resolve();
export function mitFeedbackSperre(fn) {
  const lauf = kette.then(fn, fn);
  kette = lauf.then(() => {}, () => {});
  return lauf;
}

/** KI-Einordnung; jeder Fehler = null + Grund (nur Code, nie Text). */
async function einordnen({ eingabe, titel, aufruf, modellLesen }) {
  try {
    const modellId = await modellLesen(ROLLE);
    if (anbieterVon(modellId) !== 'anthropic') return { ki: null, grund: 'ki_anbieter' };   // Text nur an Claude (Anthropic)
    if (schluesselFehlt(modellId, ROLLE)) return { ki: null, grund: 'ki_schluessel' };
    const r = await aufruf({
      modellId, system: systemPrompt(), prompt: userPrompt({ ...eingabe, titel }),
      art: 'schnell', rolle: ROLLE, jsonSchema: KI_SCHEMA, zeitlimitMs: ZEITLIMIT_MS,
    });
    const ki = pruefeKiAntwort(r?.text, titel.map(x => x.nr));
    return { ki, grund: ki ? '' : 'ki_unsinn', nutzung: r?.nutzung ?? null };
  } catch (e) {
    return { ki: null, grund: e?.code || (e?.status ? `ki_${e.status}` : 'ki_fehler') };
  }
}

/**
 * Feedback speichern.
 * @param {object} o { eingabe: { text, kontext }, wer (aus dem geprueften Schluessel), jetzt, aufruf, sheets, sheetIdLesen, modellLesen }
 * @returns {Promise<{ nr: string, ki: boolean, kiGrund: string, nutzung: object|null }>}
 */
export async function speichereFeedback({
  eingabe: roh, wer, jetzt = () => new Date(), aufruf = textAufruf, sheets: s, sheetIdLesen = feedbackSheetId, modellLesen = getModel,
} = {}) {
  if (!wer) throw fehler('Feedback nur mit persönlicher Anmeldung.', 403, 'feedback_wer');
  const eingabe = pruefeEingabe(roh);
  const spreadsheetId = await sheetIdLesen();
  if (!spreadsheetId) throw fehler('Feedback gerade nicht möglich – das Feedback-Sheet ist noch nicht eingerichtet.', 503, 'feedback_einrichtung');
  const sheets = s ?? await sheetsClient();

  return mitFeedbackSperre(async () => {
    // EIN Lesezugriff: ganzer Reiter (Nummer, Zielzeile, Titel der letzten Eintraege fuer "aehnlich zu")
    let alt;
    try {
      alt = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
    } catch (e) {
      throw fehler('Feedback gerade nicht möglich – das Feedback-Sheet ist nicht erreichbar.', 503, `feedback_sheet_${e?.code ?? e?.status ?? 'fehler'}`);
    }
    const stand = standAus(alt);
    const { ki, grund, nutzung = null } = await einordnen({ eingabe, titel: stand.titel, aufruf, modellLesen });
    const nr = nrText(stand.naechste);
    const zeile = zeileAus({ kopf: alt[0], nr, datum: datumBerlin(jetzt()), wer, eingabe, ki });
    try {
      await schreibeNeueZeilen(sheets, spreadsheetId, TAB, [zeile], { alt });
    } catch {
      // Meldung von schreibeNeueZeilen nennt nur Zeilen/Spalten - trotzdem fester Text nach aussen
      throw fehler('Feedback nicht gespeichert – bitte noch einmal senden.', 502, 'feedback_schreiben');
    }
    return { nr, ki: !!ki, kiGrund: grund, nutzung };
  });
}
