import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import rateLimit from 'express-rate-limit';

const router = Router();

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte in 15 Minuten erneut versuchen.' },
});

const TAB = 'Kundenanfragen';

let _historyCache   = null;
let _historyCacheAt = 0;
const HISTORY_TTL   = 10 * 60 * 1000;

function todayDE() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function generateAnfrageId(existingIds, year) {
  const prefix = `KA-${year}-`;
  const max = existingIds
    .filter(id => id.startsWith(prefix))
    .map(id => parseInt(id.slice(prefix.length), 10))
    .filter(n => Number.isFinite(n))
    .reduce((acc, n) => Math.max(acc, n), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

function getSheets() {
  return getGoogleAuth().then(auth => google.sheets({ version: 'v4', auth }));
}

async function loadRecentAnfragen() {
  if (_historyCache && Date.now() - _historyCacheAt < HISTORY_TTL) return _historyCache;
  const sheetId = process.env.BUSINESS_SHEET_ID;
  if (!sheetId) return [];
  try {
    const sheets = await getSheets();
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId, range: `${TAB}!A1:N`,
    });
    const [header, ...rawRows] = data.values ?? [];
    if (!header) return [];
    const rows = rawRows.filter(r => r.some(c => c) && !(r[0] ?? '').startsWith('//'));
    const h = c => header.indexOf(c);
    const completed = rows
      .filter(r => (r[h('Status')] ?? '') === 'Abgeschlossen')
      .slice(-20)
      .map(r => ({
        produkt:       r[h('Produkt-Beschreibung')] ?? '',
        menge:         r[h('Menge')] ?? '',
        preisvorschlag: r[h('Preisvorschlag')] ?? '',
      }))
      .filter(r => r.produkt || r.preisvorschlag);
    _historyCache   = completed;
    _historyCacheAt = Date.now();
    return completed;
  } catch { return []; }
}

function buildSystemPrompt(history, sessionData) {
  const examples = history.length
    ? history.map((a, i) =>
        `${i + 1}. ${a.produkt} | Menge: ${a.menge} | Preis: ${a.preisvorschlag}€`
      ).join('\n')
    : '(Noch keine Referenzdaten verfügbar)';

  const stateStr = sessionData && Object.keys(sessionData).length > 0
    ? `\nAKTUELLER FORMULARSTAND: ${JSON.stringify(sessionData)}`
    : '';

  return `Du bist der freundliche Anfrage-Assistent von Jammi Fashion, einem deutschen Hersteller für individuell bedruckte Textilien und Merchandise.

Führe den Kunden auf Deutsch durch eine Anfrage in 10 Schritten. Beantworte immer nur eine Frage pro Nachricht. Sei herzlich, professionell und präzise.
Wenn die erste Nutzernachricht "__init__" lautet, starte direkt mit einer herzlichen Begrüßung (Schritt 1).${stateStr}

SCHRITTE:
1. Begrüße herzlich und frage was der Kunde möchte.
2. Kläre Produkt (T-Shirt, Hoodie, Tasse etc.) und Motiv/Aufdruck.
3. Frage nach der benötigten Menge.
4. Frage nach Varianten (Farben, Größen mit Stückzahlen).
5. Frage ob Vereins- oder Gruppenauftrag. Falls ja: bitte um die Partner-ID.
6. Frage nach Name und E-Mail-Adresse.
7. Berechne einen unverbindlichen Richtpreis und zeige ihn klar an.
8. Frage nach weiteren besonderen Wünschen.
9. Fasse ALLE Infos zusammen und bitte um Bestätigung mit "Ja" oder "Nein".
10. Bestätige den Eingang und erkläre nächste Schritte.

RICHTWERTE FÜR SCHRITT 7:
T-Shirts: 12–18 €/Stk | Hoodies: 22–38 €/Stk | Tassen: 6–10 €/Stk | Beutel: 5–9 €/Stk
Mengenstaffel: ≥20 Stk −10 % | ≥50 Stk −15 % | ≥100 Stk −20 %
Mehrfarbdruck oder komplexes Motiv: +1–2 €/Stk
Zeige Preis als "ca. X € gesamt (Y €/Stk)" – immer als unverbindlicher Richtpreis.

Referenz-Aufträge (letzte abgeschlossene):
${examples}

ANTWORTFORMAT – Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, kein Text außerhalb:
{
  "reply": "<Deine Antwort – darf einfaches Markdown enthalten>",
  "sessionData": {
    "step": <1–10>,
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
Setze "completed": true NUR wenn Kunde in Schritt 9 mit "Ja" o.Ä. bestätigt hat.
Behalte ALLE bereits gesammelten sessionData-Werte – überschreibe sie nie mit leeren Strings.`;
}

// ── POST /chat ────────────────────────────────────────────────────────────────
router.post('/chat', chatLimiter, async (req, res, next) => {
  try {
    const { messages = [], sessionData = {} } = req.body ?? {};

    if (!Array.isArray(messages) || messages.length > 42) {
      return res.status(400).json({ error: 'Ungültige Anfrage.' });
    }

    const validMsgs = messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));

    const history     = await loadRecentAnfragen();
    const systemPrompt = buildSystemPrompt(history, sessionData);

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Prefill with '{' forces JSON output from the model
    const apiMessages = [...validMsgs, { role: 'assistant', content: '{' }];

    const claudeRes = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:     systemPrompt,
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

    if (!parsed?.reply) {
      return res.status(502).json({ error: 'Agent konnte keine Antwort generieren.' });
    }

    // Merge sessionData – never overwrite existing values with empty
    const merged  = { kanal: 'Homepage', ...sessionData };
    const updated = parsed.sessionData ?? {};
    for (const [k, v] of Object.entries(updated)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        merged[k] = v;
      }
    }

    const completed = !!parsed.completed;
    let anfrageId   = null;

    if (completed && merged.kundeName && merged.kundeEmail) {
      try {
        const sheetId = process.env.BUSINESS_SHEET_ID;
        if (sheetId) {
          const sheets = await getSheets();
          const { data: idData } = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId, range: `${TAB}!A:A`,
          });
          const ids = (idData.values ?? []).flat();
          anfrageId = generateAnfrageId(ids, new Date().getFullYear());

          await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: `${TAB}!A:N`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
              values: [[
                anfrageId,
                todayDE(),
                merged.kanal || 'Homepage',
                merged.kundeName,
                merged.kundeEmail,
                merged.produktBeschreibung || '',
                merged.menge || '',
                merged.varianten || '',
                merged.partnerId || '',
                merged.preisvorschlag || '',
                merged.anmerkungenKunde || '',
                'Neu',
                '', '',
              ]],
            },
          });
        }
      } catch (err) {
        console.error('Chat-Anfrage Erstellung fehlgeschlagen:', err.message);
      }
    }

    res.json({
      reply: parsed.reply,
      sessionData: merged,
      completed,
      ...(anfrageId ? { anfrageId } : {}),
    });

  } catch (err) { next(err); }
});

export default router;
