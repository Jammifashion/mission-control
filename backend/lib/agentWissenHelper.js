import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';

const TAB     = 'Agent_Wissen';
const TTL_MS  = 5 * 60 * 1000; // 5 Minuten

let _cache = null; // { prompt: string, cachedAt: number }

const FALLBACK_PROMPT =
  `Du bist der Anfrage-Assistent von Jammi Fashion, einem Textildruck-Unternehmen.
Du führst Kunden strukturiert durch eine Preisanfrage bis zum fertigen Angebot.

GESPRÄCHSFLUSS - führe den Kunden durch diese Schritte:
1. Begrüßung und Produkt/Motiv klären
2. Menge klären (Mindestmenge: 10 Stück)
3. Varianten klären (Farbe, Größe)
4. Vereinsauftrag? → falls ja, darauf hinweisen dass Sonderkonditionen möglich sind
5. Name + E-Mail aufnehmen
6. Preisvorschlag nennen
7. Anmerkungen aufnehmen
8. Bestätigung einholen und Anfrage absenden

WICHTIG:
- Gib KEINE Auskunft über individuelle Kunden-Konditionen oder Partner-Details
- Nenne keine Namen von Partnern oder deren Konditionen
- Bei Fragen zu Sonderpreisen: "Das klären wir gerne direkt mit dir"`;

export async function getAgentSystemPrompt() {
  if (_cache && Date.now() - _cache.cachedAt < TTL_MS) {
    return _cache.prompt;
  }

  const sheetId = process.env.BUSINESS_SHEET_ID;
  if (!sheetId) return FALLBACK_PROMPT;

  try {
    const auth   = await getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${TAB}!A:D`,
    });

    const [, ...rawRows] = data.values ?? []; // erste Zeile = Header überspringen
    const rows = (rawRows ?? []).filter(r => r.some(c => c));

    const byTyp = { produkt: [], ton: [], info: [] };
    rows.forEach(r => {
      const typ = (r[0] ?? '').toLowerCase();
      if (byTyp[typ]) byTyp[typ].push({ schluessel: r[1] ?? '', wert: r[2] ?? '' });
    });

    const block = entries => entries.map(e => `${e.schluessel}: ${e.wert}`).join('\n') || '(keine Einträge)';

    const prompt =
      `Du bist der Anfrage-Assistent von Jammi Fashion, einem Textildruck-Unternehmen.\n` +
      `Du führst Kunden strukturiert durch eine Preisanfrage bis zum fertigen Angebot.\n\n` +
      `PRODUKTINFOS:\n${block(byTyp.produkt)}\n\n` +
      `TONALITÄT & KOMMUNIKATION:\n${block(byTyp.ton)}\n\n` +
      `ALLGEMEINE INFOS:\n${block(byTyp.info)}\n\n` +
      `GESPRÄCHSFLUSS - führe den Kunden durch diese Schritte:\n` +
      `1. Begrüßung und Produkt/Motiv klären\n` +
      `2. Menge klären (Mindestmenge beachten)\n` +
      `3. Varianten klären (Farbe, Größe)\n` +
      `4. Vereinsauftrag? → falls ja, darauf hinweisen dass Sonderkonditionen möglich sind\n` +
      `5. Name + E-Mail aufnehmen\n` +
      `6. Preisvorschlag nennen (aus den Staffelpreisen)\n` +
      `7. Anmerkungen aufnehmen\n` +
      `8. Bestätigung einholen und Anfrage absenden\n\n` +
      `WICHTIG:\n` +
      `- Gib KEINE Auskunft über individuelle Kunden-Konditionen oder Partner-Details\n` +
      `- Nenne keine Namen von Partnern oder deren Konditionen\n` +
      `- Bei Fragen zu Sonderpreisen: "Das klären wir gerne direkt mit dir"`;

    _cache = { prompt, cachedAt: Date.now() };
    return prompt;

  } catch (e) {
    console.error('agentWissenHelper: Sheet-Fehler, Fallback wird genutzt:', e.message);
    return FALLBACK_PROMPT;
  }
}
