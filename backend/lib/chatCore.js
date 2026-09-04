import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { getModel } from './modelConfig.js';

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

ANTWORTFORMAT – Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, kein Text außerhalb:
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

// Returns { reply, sessionData, completed } or null on parse failure
export async function callChatAgent({ messages, sessionData, kbBase, history }) {
  const systemBlocks = buildSystemBlocks(kbBase, history, sessionData);
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const apiMessages = [...messages, { role: 'assistant', content: '{' }];

  const claudeRes = await anthropic.messages.create({
    model:      await getModel('chat-kunde'),
    max_tokens: 1536,
    system:     systemBlocks,
    messages:   apiMessages,
  });

  const rawText = '{' + (claudeRes.content[0]?.text ?? '');

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const m = rawText.match(/\{[\s\S]*\}/);
    try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  }

  if (!parsed?.reply) return null;

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
