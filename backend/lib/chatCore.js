import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { getModel } from './modelConfig.js';
import { sanitizeJsonControlChars, stripCodeFence } from '../utils/json-parse.js';

const TAB_ANFRAGEN = 'Kundenanfragen';

let _historyCache   = null;
let _historyCacheAt = 0;
const HISTORY_TTL   = 10 * 60 * 1000;

function getSheets() {
  return getGoogleAuth().then(auth => google.sheets({ version: 'v4', auth }));
}

export async function loadRecentAnfragen() {
  if (_historyCache && Date.now() - _historyCacheAt < HISTORY_TTL) return _historyCache;
  const sheetId = process.env.BUSINESS_SHEET_ID;
  if (!sheetId) return [];
  try {
    const sheets = await getSheets();
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId, range: `${TAB_ANFRAGEN}!A1:N`,
    });
    const [header, ...rawRows] = data.values ?? [];
    if (!header) return [];
    const rows = rawRows.filter(r => r.some(c => c) && !(r[0] ?? '').startsWith('//'));
    const h = c => header.indexOf(c);
    const completed = rows
      .filter(r => (r[h('Status')] ?? '') === 'Abgeschlossen')
      .slice(-20)
      .map(r => ({
        produkt:        r[h('Produkt-Beschreibung')] ?? '',
        menge:          r[h('Menge')] ?? '',
        preisvorschlag: r[h('Preisvorschlag')] ?? '',
      }))
      .filter(r => r.produkt || r.preisvorschlag);
    _historyCache   = completed;
    _historyCacheAt = Date.now();
    return completed;
  } catch { return []; }
}

export function buildSystemBlocks(kbBase, history, sessionData) {
  const examples = history.length
    ? history.map((a, i) =>
        `${i + 1}. ${a.produkt} | Menge: ${a.menge} | Preis: ${a.preisvorschlag}€`
      ).join('\n')
    : '(Noch keine Referenzdaten verfügbar)';

  const stateStr = sessionData && Object.keys(sessionData).length > 0
    ? `\nAKTUELLER FORMULARSTAND: ${JSON.stringify(sessionData)}`
    : '';

  return [
    {
      type: 'text',
      // Statischer Teil: kbBase + Beispiele bleiben 10 min konstant → Cache-Hit
      text: `${kbBase}\n\nREFERENZ-AUFTRÄGE (letzte abgeschlossene):\n${examples}`,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `Beantworte immer nur eine Frage pro Nachricht. Wenn die erste Nutzernachricht "__init__" lautet, starte direkt mit einer herzlichen Begrüßung.${stateStr}

ANTWORTFORMAT – Antworte NUR mit dem JSON-Objekt, ohne Präambel und ohne
Markdown-Codeblock. Kein Text außerhalb, keine \`\`\` davor oder danach. Das
erste Zeichen deiner Antwort ist {, das letzte }.
{
  "reply": "<Deine Antwort – darf einfaches Markdown enthalten>",
  "sessionData": {
    "step": <1–8>,
    "produktBeschreibung": "<Produkt und Motiv>",
    "menge": "<Menge>",
    "varianten": "<Farben/Größen>",
    "partnerId": "<Partner-ID oder leer>",
    "kundeName": "<Name>",
    "kundeEmail": "<E-Mail>",
    "preisvorschlag": "<Zahl ohne €, z.B. 580>",
    "anmerkungenKunde": "<Wünsche>",
    "kanal": "Homepage"
  },
  "completed": false
}
Setze "completed": true NUR wenn Kunde in Schritt 8 bestätigt hat.
Behalte ALLE bereits gesammelten sessionData-Werte – überschreibe sie nie mit leeren Strings.`,
    },
  ];
}

// Antworttext zu einem Objekt machen. Ohne den frueheren Assistant-Prefill
// ist nicht mehr garantiert, dass die Antwort mit "{" beginnt - deshalb erst
// einen etwaigen Markdown-Zaun abstreifen, dann das aeusserste Objekt suchen
// und rohe Steuerzeichen in String-Literalen escapen.
function parseAgentAntwort(rawText) {
  const versuche = [];
  const ohneZaun = stripCodeFence(rawText);
  versuche.push(ohneZaun);

  const m = ohneZaun.match(/\{[\s\S]*\}/);
  if (m) versuche.push(m[0]);

  for (const kandidat of versuche) {
    for (const text of [kandidat, sanitizeJsonControlChars(kandidat)]) {
      try {
        const obj = JSON.parse(text);
        if (obj && typeof obj === 'object') return obj;
      } catch { /* naechster Versuch */ }
    }
  }
  return null;
}

// Returns { reply, sessionData, completed }.
// Wirft, wenn die Antwort nicht als JSON lesbar ist - frueher wurde in dem
// Fall still null geliefert, was als "Agent konnte nicht antworten" durchging
// und die eigentliche Ursache verdeckt hat.
export async function callChatAgent({ messages, sessionData, kbBase, history }) {
  const systemBlocks = buildSystemBlocks(kbBase, history, sessionData);
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Kein Assistant-Prefill mehr: claude-sonnet-5 lehnt eine Konversation ab,
  // die nicht mit einer User-Nachricht endet ("does not support assistant
  // message prefill"). Das JSON-Format erzwingt jetzt allein der Prompt.
  const modell = await getModel('chat-kunde');

  const claudeRes = await anthropic.messages.create({
    model:      modell,
    max_tokens: 1536,
    system:     systemBlocks,
    messages,
  });

  // Nicht content[0] nehmen: sonnet-5 stellt der Antwort bei laengeren Prompts
  // einen thinking-Block voran, der Text steht dann erst dahinter.
  const rawText = (claudeRes.content ?? [])
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('');
  const parsed  = parseAgentAntwort(rawText);

  if (!parsed?.reply) {
    // Rohantwort ins Log, sonst ist der Fall nicht nachvollziehbar.
    console.error(
      `[chatCore] Antwort von ${modell} nicht als JSON lesbar. Rohantwort:`,
      rawText,
    );
    const err = new Error(
      `Antwort des Chat-Agenten (${modell}) war kein gueltiges JSON-Objekt mit "reply".`,
    );
    err.status = 502;   // wie bisher nach aussen: Fehler stammt vom Upstream
    throw err;
  }

  console.log(`[chatCore] Rolle chat-kunde -> Modell ${modell}, Antwort geparst (${rawText.length} Zeichen)`);

  const merged  = { kanal: 'Homepage', ...sessionData };
  const updated = parsed.sessionData ?? {};
  for (const [k, v] of Object.entries(updated)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      merged[k] = v;
    }
  }

  return {
    reply:       parsed.reply,
    sessionData: merged,
    completed:   !!parsed.completed,
  };
}
