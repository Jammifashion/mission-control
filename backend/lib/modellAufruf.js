// Ein Text-Aufruf an ein Sprachmodell - eine Stelle fuer Anbieterwahl und
// Aufrufparameter (Auftrag KI2).
//
// Anlass (bericht-KI1, 10.10.): Der Config-Reiter stellte seo-text und
// klassifizierung auf claude-haiku-5-5 um. Haiku 5.5 denkt standardmaessig
// (adaptiv, Effort medium) und verbrauchte das max_tokens 2048 der SEO-Route:
// 4 von 6 Laeufen endeten mit stop_reason "max_tokens", die Route meldete nur
// "kein JSON". suggest_variants war fest auf Gemini verdrahtet und schickte die
// Claude-ID an Google.
//
// Regeln:
//  - Anbieter NUR ueber das Praefix der Modell-ID: "claude-" -> Anthropic,
//    "gemini-" -> Google. Spalte C "Anbieter" im Config-Reiter ist Information
//    (modelConfig.js warnt, wenn sie nicht passt), nie die Quelle.
//  - Parameter je Art an EINER Stelle (ARTEN). Neue Arten hier eintragen.
//  - stop_reason immer pruefen: "max_tokens" -> KiAbgeschnittenError (502),
//    "refusal" -> KiAbgelehntError (502). Kein Weiterreichen halber Antworten.
//
// Nutzer: routes/claude.js (seo_description, suggest_variants). Chat (chatCore),
// agent-intern-Routen und der Health-Ping rufen weiter selbst auf (KI2: nur
// aufgelistet, nicht umgebaut).

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { collectText } from '../utils/json-parse.js';

// Anthropic-Parameter je Art (Entscheidung Inhaber 10.10., Messung KI1):
//  seo:             Denken an, Effort low, Platz fuer Denken + Text (3/3 gueltig,
//                   ~1,9k Ausgabe-Token, keine erfundenen Angaben gefunden).
//  klassifizierung: Denken aus, kleine Antwort (nur JSON mit Keys).
// Gemini: keine Zusatzparameter (Verhalten wie bisher).
export const ARTEN = {
  seo:             { anthropic: { max_tokens: 16000, output_config: { effort: 'low' } } },
  klassifizierung: { anthropic: { max_tokens: 1024, thinking: { type: 'disabled' } } },
};

export const ANBIETER = {
  anthropic: { praefix: 'claude-', name: 'Anthropic', schluessel: 'ANTHROPIC_API_KEY' },
  google:    { praefix: 'gemini-', name: 'Google',    schluessel: 'GEMINI_API_KEY' },
};

export const KI_ABGESCHNITTEN_CODE = 'ki_abgeschnitten';
export const KI_ABGELEHNT_CODE     = 'ki_abgelehnt';

export class KiAbgeschnittenError extends Error {
  constructor({ modellId, art, maxTokens }) {
    super(`KI-Antwort abgeschnitten (${modellId}, Art ${art}: Grenze von ${maxTokens ?? '?'} Ausgabe-Token erreicht) – nichts übernommen, bitte erneut versuchen.`);
    this.name = 'KiAbgeschnittenError';
    this.code = KI_ABGESCHNITTEN_CODE;
    this.status = 502;
  }
}

export class KiAbgelehntError extends Error {
  constructor({ modellId, kategorie }) {
    super(`KI hat die Anfrage abgelehnt (${modellId}${kategorie ? `, ${kategorie}` : ''}).`);
    this.name = 'KiAbgelehntError';
    this.code = KI_ABGELEHNT_CODE;
    this.status = 502;
  }
}

/** 'anthropic' | 'google' | null - nur ueber das Praefix der Modell-ID. */
export function anbieterVon(modellId) {
  const id = String(modellId ?? '').trim().toLowerCase();
  for (const [key, a] of Object.entries(ANBIETER)) if (id.startsWith(a.praefix)) return key;
  return null;
}

/**
 * Passt Spalte C ("Anbieter") zur Modell-ID? Leer = keine Aussage = passt.
 * @returns {boolean}
 */
export function anbieterPasst(modellId, anbieterSpalte) {
  const c = String(anbieterSpalte ?? '').trim().toLowerCase();
  if (!c) return true;
  const a = anbieterVon(modellId);
  return !!a && ANBIETER[a].name.toLowerCase() === c;
}

/** Anthropic-Parameter einer Art. Unbekannte Art -> Fehler (keine stillen Defaults). */
export function anthropicParameter(art) {
  const p = ARTEN[art]?.anthropic;
  if (!p) throw new Error(`Unbekannte KI-Art "${art}" – in lib/modellAufruf.js (ARTEN) eintragen.`);
  return structuredClone(p);
}

/**
 * Fehlt der Schluessel fuer den Anbieter dieser Modell-ID? Liefert den
 * Fehlertext (fuer 503) oder null. Unbekanntes Praefix -> Fehlertext.
 */
export function schluesselFehlt(modellId, rolle) {
  const a = anbieterVon(modellId);
  if (!a) return `Rolle ${rolle} ist auf "${modellId}" konfiguriert – Anbieter unbekannt (erwartet claude-… oder gemini-…).`;
  const name = ANBIETER[a].schluessel;
  return process.env[name] ? null : `Rolle ${rolle} ist auf ${modellId} konfiguriert, aber ${name} fehlt.`;
}

/**
 * Ein Text-Aufruf.
 * @param {object} o
 * @param {string} o.modellId  aus getModel(rolle)
 * @param {string} o.system    Systemprompt
 * @param {string} o.prompt    User-Prompt
 * @param {string} o.art       Schluessel in ARTEN ('seo', 'klassifizierung')
 * @returns {Promise<{ text: string, anbieter: string, stopReason: string|null, nutzung: object }>}
 * Wirft KiAbgeschnittenError / KiAbgelehntError; fehlender Schluessel -> Error mit status 503.
 */
export async function textAufruf({ modellId, system, prompt, art, rolle = art }) {
  const fehlt = schluesselFehlt(modellId, rolle);
  if (fehlt) throw Object.assign(new Error(fehlt), { status: 503 });
  const anbieter = anbieterVon(modellId);

  if (anbieter === 'google') {
    if (!ARTEN[art]) throw new Error(`Unbekannte KI-Art "${art}" – in lib/modellAufruf.js (ARTEN) eintragen.`);
    const modell = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      .getGenerativeModel({ model: modellId, systemInstruction: system });
    const res = await modell.generateContent(prompt);
    const grund = res.response?.candidates?.[0]?.finishReason ?? null;
    if (grund === 'MAX_TOKENS') throw new KiAbgeschnittenError({ modellId, art });
    const u = res.response?.usageMetadata ?? {};
    return { text: res.response.text(), anbieter, stopReason: grund, nutzung: { ein: u.promptTokenCount, aus: u.candidatesTokenCount } };
  }

  const parameter = anthropicParameter(art);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: modellId,
    system,
    messages: [{ role: 'user', content: prompt }],
    ...parameter,
  });
  if (res?.stop_reason === 'max_tokens') throw new KiAbgeschnittenError({ modellId, art, maxTokens: parameter.max_tokens });
  if (res?.stop_reason === 'refusal') throw new KiAbgelehntError({ modellId, kategorie: res.stop_details?.category });
  return {
    text: collectText(res),
    anbieter,
    stopReason: res?.stop_reason ?? null,
    nutzung: { ein: res?.usage?.input_tokens, aus: res?.usage?.output_tokens },
  };
}
