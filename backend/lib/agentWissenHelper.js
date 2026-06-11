import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';

const TAB_WISSEN = 'Agent_Wissen';
const TAB_VK     = 'Kalkulation_Verkaufspreise';
const TTL_MS     = 5 * 60 * 1000; // 5 Minuten

let _cache = null; // { prompt: string, cachedAt: number }

const FALLBACK_PROMPT =
  `Du bist der Anfrage-Assistent von JammiFashion, einem Textildruck-Unternehmen.
Du führst Kunden strukturiert durch eine Preisanfrage bis zum fertigen Angebot.

GESPRÄCHSFLUSS - führe den Kunden durch diese Schritte:
1. Begrüßung und Produkt/Motiv klären
2. Menge klären (Mindestmenge: 10 Stück)
3. Varianten klären (Farbe, Größe)
4. Druckposition klären (Brust, Rücken, Ärmel)
5. Vereinsauftrag? → falls ja: Sonderkonditionen möglich, direkt melden
6. Preisvorschlag berechnen und strukturiert anzeigen
7. Name + E-Mail aufnehmen — ERST nach dem Preis
8. Anmerkungen aufnehmen
9. Bestätigung einholen und Anfrage absenden

DRUCKTECHNIK:
- Drucktechnik wird NIE proaktiv erwähnt oder erfragt
- Falls der Kunde aktiv danach fragt: "JammiFashion nutzt DTF (Direct to Film) und Flexdruck — je nach Motiv und Material wird intern die beste Technik gewählt, ohne Auswirkung auf den Preis."
- In der Preisanzeige gibt es KEINE Zeile für Drucktechnik

WICHTIG:
- Gib KEINE Auskunft über individuelle Kunden-Konditionen oder Partner-Details
- Nenne keine Namen von Partnern oder deren Konditionen
- Bei Fragen zu Sonderpreisen: "Das klären wir gerne direkt mit dir"
- Frage niemals nach DTF, Siebdruck oder anderen Drucktechniken — das ist eine interne Entscheidung`;

async function getSheets() {
  const auth = await getGoogleAuth();
  return google.sheets({ version: 'v4', auth });
}

export async function getStaffelpreise() {
  const sheetId = process.env.BUSINESS_SHEET_ID;
  if (!sheetId) return '';
  try {
    const sheets = await getSheets();
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${TAB_VK}!A:E`,
    });

    const [header, ...rawRows] = data.values ?? [];
    if (!header) return '';

    const rows = rawRows.filter(r => r.some(c => c));
    const hi = col => header.indexOf(col);

    // Gruppieren nach Produkttyp, sortiert nach Ab-Menge
    const byTyp = {};
    rows.forEach(r => {
      const typ    = r[hi('Produkttyp')] ?? '';
      const menge  = parseInt(r[hi('Ab-Menge')] ?? '0', 10);
      const preis  = parseFloat(String(r[hi('VK-Brutto')] ?? '').replace(',', '.'));
      if (!typ || !Number.isFinite(menge) || !Number.isFinite(preis)) return;
      if (!byTyp[typ]) byTyp[typ] = [];
      byTyp[typ].push({ menge, preis });
    });

    const lines = Object.entries(byTyp).map(([typ, staffeln]) => {
      const sorted = staffeln.sort((a, b) => a.menge - b.menge);
      const preise = sorted.map(s => `  ab ${s.menge} Stück: ${s.preis.toFixed(2)} EUR`).join('\n');
      return `${typ}:\n${preise}`;
    });

    return lines.join('\n\n');
  } catch (e) {
    console.error('agentWissenHelper: Staffelpreise-Fehler:', e.message);
    return '';
  }
}

export async function getAgentSystemPrompt() {
  if (_cache && Date.now() - _cache.cachedAt < TTL_MS) {
    return _cache.prompt;
  }

  const sheetId = process.env.BUSINESS_SHEET_ID;
  if (!sheetId) return FALLBACK_PROMPT;

  try {
    const sheets = await getSheets();

    const [wissenRes, staffelText] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${TAB_WISSEN}!A:D`,
      }),
      getStaffelpreise(),
    ]);

    const [, ...rawRows] = wissenRes.data.values ?? [];
    const rows = (rawRows ?? []).filter(r => r.some(c => c));

    const byTyp = { produkt: [], ton: [], info: [] };
    rows.forEach(r => {
      const typ = (r[0] ?? '').toLowerCase();
      if (byTyp[typ]) byTyp[typ].push({ schluessel: r[1] ?? '', wert: r[2] ?? '' });
    });

    const block = entries => entries.map(e => `${e.schluessel}: ${e.wert}`).join('\n') || '(keine Einträge)';

    const staffelBlock = staffelText
      ? `STAFFELPREISE:\n${staffelText}\n\n`
      : '';

    const prompt =
      `Du bist der Anfrage-Assistent von JammiFashion, einem Textildruck-Unternehmen.\n` +
      `Du führst Kunden strukturiert durch eine Preisanfrage bis zum fertigen Angebot.\n\n` +
      `PRODUKTINFOS:\n${block(byTyp.produkt)}\n\n` +
      staffelBlock +
      `TONALITÄT & KOMMUNIKATION:\n${block(byTyp.ton)}\n\n` +
      `ALLGEMEINE INFOS:\n${block(byTyp.info)}\n\n` +
      `GESPRÄCHSMODUS - erkenne zuerst, was der Kunde will:\n\n` +
      `A) ALLGEMEINE FRAGE (z.B. "Macht ihr Hoodies?", "Wie lange dauert der Versand?",\n` +
      `   "Welche Größen gibt es?"):\n` +
      `   → Beantworte die Frage freundlich und kompetent aus deinem Wissen.\n` +
      `   → Lade danach sanft zum Angebot ein, z.B.:\n` +
      `     "Möchtest du, dass ich dir dafür ein unverbindliches Angebot zusammenstelle?"\n` +
      `   → Wenn ja: wechsle in den AUFTRAGS-FLUSS (siehe unten).\n` +
      `   → Bleibe locker - dränge niemanden in eine Anfrage.\n\n` +
      `B) AUFTRAGS-ABSICHT (z.B. "Ich brauche 30 Trikots", "Wir wollen Vereinsshirts\n` +
      `   bedrucken lassen"):\n` +
      `   → Starte direkt mit dem AUFTRAGS-FLUSS.\n\n` +
      `Im Zweifel: erst die konkrete Frage beantworten, dann zum Angebot überleiten.\n\n` +
      `WICHTIG für den JSON-Stand: Wenn der Kunde nur eine allgemeine Frage stellt\n` +
      `(Modus A, noch kein Auftrag), bleibt sessionData.step bei 1 und die Auftrags-Felder\n` +
      `bleiben leer. Erst beim Wechsel in den AUFTRAGS-FLUSS beginnt die Schritt-Zählung.\n\n` +
      `AUFTRAGS-FLUSS - führe den Kunden durch diese Schritte:\n` +
      `1. Begrüßung und Produkt/Motiv klären\n` +
      `2. Menge klären (Mindestmenge beachten)\n` +
      `3. Varianten klären (Farbe, Größe)\n` +
      `4. Druckposition klären (Brust, Rücken, Ärmel)\n` +
      `5. Vereinsauftrag? → falls ja: Sonderkonditionen möglich, direkt melden\n` +
      `6. Preisvorschlag berechnen und strukturiert anzeigen (siehe PREISANZEIGE-FORMAT)\n` +
      `7. Name + E-Mail aufnehmen — ERST nach dem Preis, mit dem Übergang aus dem Format\n` +
      `8. Anmerkungen aufnehmen\n` +
      `9. Bestätigung einholen und Anfrage absenden\n\n` +
      `PREISANZEIGE-FORMAT - verwende exakt dieses Format in Schritt 6:\n` +
      `📋 Deine Anfrage im Überblick:\n` +
      `─────────────────────────\n` +
      `Produkt:        [Produkt]\n` +
      `Menge:          [X Stück]\n` +
      `Varianten:      [Farbe, Größen]\n` +
      `Druckposition:  [Position]\n` +
      `─────────────────────────\n` +
      `Geschätzter Preis: ca. [X],00 EUR\n` +
      `─────────────────────────\n` +
      `⚠️ Bitte beachte: Dieser Preis ist eine automatische Schätzung.\n` +
      `JammiFashion schickt dir im Anschluss ein verbindliches Angebot per E-Mail.\n\n` +
      `Direkt nach dem Preisblock folgst du mit:\n` +
      `"Klingt das für dich interessant? Dann brauche ich noch kurz deinen Namen und deine E-Mail-Adresse für das verbindliche Angebot."\n\n` +
      `DRUCKTECHNIK:\n` +
      `- Drucktechnik wird NIE proaktiv erwähnt oder erfragt\n` +
      `- Falls der Kunde aktiv danach fragt: "JammiFashion nutzt DTF (Direct to Film) und Flexdruck — je nach Motiv und Material wird intern die beste Technik gewählt, ohne Auswirkung auf den Preis."\n` +
      `- In der Preisanzeige gibt es KEINE Zeile für Drucktechnik\n\n` +
      `WICHTIG:\n` +
      `- Gib KEINE Auskunft über individuelle Kunden-Konditionen oder Partner-Details\n` +
      `- Nenne keine Namen von Partnern oder deren Konditionen\n` +
      `- Bei Fragen zu Sonderpreisen: "Das klären wir gerne direkt mit dir"\n` +
      `- Frage niemals nach DTF, Siebdruck oder anderen Drucktechniken — das ist eine interne Entscheidung`;

    _cache = { prompt, cachedAt: Date.now() };
    return prompt;

  } catch (e) {
    console.error('agentWissenHelper: Sheet-Fehler, Fallback wird genutzt:', e.message);
    return FALLBACK_PROMPT;
  }
}
