import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getModel } from '../lib/modelConfig.js';
import { sanitizeJsonControlChars, collectText } from '../utils/json-parse.js';
import { buildSeoUserPrompt, resolveModus } from '../lib/seo-prompt.js';

const router = Router();

const SYSTEM_PROMPT = `Du bist der KI-Assistent für das Mission Control Dashboard von JammiFashion.
Du hilfst dem Team bei Fragen zu Bestellungen, Produkten, Shop-Analysen und operativen Aufgaben.
Antworte präzise und auf Deutsch. Wenn du Zahlen oder Bestellinformationen nennst, formatiere sie übersichtlich.`;

const MAX_HISTORY = 10;
const conversationHistory = new Map();

// POST /api/claude/chat
router.post('/chat', async (req, res, next) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY nicht konfiguriert.' });
    }

    const { message, session_id = 'default' } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Nachricht darf nicht leer sein.' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: 'Nachricht zu lang (max. 4000 Zeichen).' });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const history = conversationHistory.get(session_id) || [];
    history.push({ role: 'user', content: message.trim() });

    // Keep only last N turns to control token usage.
    //
    // Der Schnitt muss auf einer user-Nachricht aufsetzen: die Messages-API
    // verlangt das an erster Stelle. Bei geradem MAX_HISTORY faellt der Schnitt
    // ab Runde 6 genau so, dass eine assistant-Nachricht vorne steht
    // ([u,a,…,u] mit 11 Eintraegen → slice(-10) beginnt bei a) - der Aufruf
    // scheiterte dann mit 400, und zwar ab da in jeder weiteren Runde.
    const trimmed = history.slice(-MAX_HISTORY);
    while (trimmed.length && trimmed[0].role !== 'user') trimmed.shift();

    const response = await client.messages.create({
      model: await getModel('agent-intern'),
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: trimmed,
    });

    const reply = collectText(response);
    if (!reply) {
      console.error('[claude/chat] Leere Antwort vom Modell, content-Typen:',
        (response.content ?? []).map(b => b.type).join(',') || '(keine)');
      return res.status(502).json({ error: 'Modell lieferte eine leere Antwort.' });
    }
    trimmed.push({ role: 'assistant', content: reply });
    conversationHistory.set(session_id, trimmed);

    res.json({ reply, session_id });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/claude/chat/:session_id  – clear history
router.delete('/chat/:session_id', (req, res) => {
  conversationHistory.delete(req.params.session_id);
  res.json({ cleared: true });
});

// POST /api/claude/generate-product
router.post('/generate-product', async (req, res, next) => {
  try {
    const { action, name, keywords, shop, properties, rules } = req.body;

    // seo_description und suggest_variants wählen ihren Anbieter selbst (Rolle
    // im Config-Sheet) und prüfen den passenden Key dort. Der pauschale Guard
    // hätte den Gemini-Pfad blockiert, obwohl er keinen Anthropic-Key braucht.
    const brauchtAnthropic = action !== 'seo_description' && action !== 'suggest_variants';
    if (brauchtAnthropic && !process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY nicht konfiguriert.' });
    }

    if (action === 'generate_variants') {
      if (!name || !properties) {
        return res.status(400).json({ error: 'Felder name und properties sind erforderlich.' });
      }

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const variantPrompt = `Erstelle alle Varianten für folgendes WooCommerce-Produkt:

Produktname: ${name}
Eigenschaften:
${properties}
${rules ? `\nVariantenregeln:\n${rules}` : ''}

Antworte ausschließlich als valides JSON-Array. Jedes Element repräsentiert eine Variante:
[
  {"attributes": [{"name": "Farbe", "option": "Rot"}, {"name": "Größe", "option": "S"}]},
  {"attributes": [{"name": "Farbe", "option": "Rot"}, {"name": "Größe", "option": "M"}]}
]

Bilde alle sinnvollen Kombinationen der Eigenschaften. Berücksichtige Variantenregeln falls angegeben.
Gib nur das JSON-Array zurück, keinen weiteren Text.`;

      const response = await client.messages.create({
        model: await getModel('agent-intern'),
        max_tokens: 2048,
        messages: [{ role: 'user', content: variantPrompt }],
      });

      const raw = collectText(response);
      if (!raw) {
        console.error('[generate_variants] Leere Antwort vom Modell, content-Typen:',
          (response.content ?? []).map(b => b.type).join(',') || '(keine)');
      }
      let variants;
      try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        variants = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      } catch {
        return res.status(502).json({ error: 'Claude-Antwort konnte nicht als JSON geparst werden.', raw });
      }

      return res.json({ variants });
    }

    if (action === 'suggest_variants') {
      const { name, combos } = req.body;
      if (!name || !Array.isArray(combos) || !combos.length) {
        return res.status(400).json({ error: 'name und combos sind erforderlich.' });
      }
      if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({ error: 'GEMINI_API_KEY nicht konfiguriert.' });
      }

      const SUGGEST_SYSTEM = `Du analysierst Produktvarianten für einen deutschen Modeshop und erkennst unübliche Kombinationen.
Antworte ausschließlich als JSON: { "unusual": ["key1", "key2"] }
Die Keys haben das Format "Attribut=Wert|Attribut=Wert" (alphabetisch sortierte Attribute, | als Trennzeichen).`;

      const userPrompt = `Produkt: ${name}

Alle Varianten-Kombinationen:
${combos.map(c => `- ${c.label}  (Key: ${c.key})`).join('\n')}

Welche dieser Kombinationen sind für dieses Produkt in einem deutschen Modeshop unüblich oder werden sehr selten bestellt?
Antworte als JSON: { "unusual": ["key1", "key2", ...] }
Gib nur die Keys zurück, keinen weiteren Text.`;

      const genAI  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const modellId = await getModel('klassifizierung');
      console.log(`suggest_variants: Rolle klassifizierung -> ${modellId}`);
      const geminiModel = genAI.getGenerativeModel({
        model: modellId,
        systemInstruction: SUGGEST_SYSTEM,
      });

      const geminiResult = await geminiModel.generateContent(userPrompt);
      const raw = geminiResult.response.text();

      let parsed;
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      } catch {
        return res.status(502).json({ error: 'Gemini-Antwort konnte nicht geparst werden.', raw });
      }

      return res.json({ unusual: Array.isArray(parsed.unusual) ? parsed.unusual : [] });
    }

    if (action === 'seo_description') {
      const { produktname, kategorien, eigenschaften, hinweise, motiv, modus, farben } = req.body;
      if (!produktname) return res.status(400).json({ error: 'produktname ist erforderlich.' });

      const SEO_SYSTEM = `Du bist SEO-Texter für jammifashion.de. Der Artikel ist ein FERTIG BEDRUCKTES
Textil – genau so wird er verkauft.

WICHTIG:
- NICHT schreiben: "individuell bedruckbar", "personalisierbar",
  "jetzt selbst gestalten"
- Schreibe als würdest du einen fertigen Markenartikel beschreiben –
  der Druck IST der Artikel
- Beschreibe das MOTIV: was ist darauf zu sehen. Bei einem fertig bedruckten
  Artikel ist das Motiv das Produkt, nicht der Stoff.
- Ton: duzen, norddeutsch-direkt, trocken. Zielgruppe aus den Hinweisen ableiten.
- VERBOTENE FLOSKELN, nie verwenden: "Must-have", "Party-Kracher",
  "absoluter Hingucker", "Blickfang", "hochwertige Qualität",
  "maximaler Tragekomfort", "schnell und zuverlässig", "sichere dir jetzt",
  "Lieblings-". Prüfung: Lässt sich ein Satz streichen, ohne dass Information
  verloren geht, gehört er gestrichen.
- Höchstens ein Ausrufezeichen im ganzen Text, lieber keins.
- Konkrete Zahlen schlagen Adjektive: "280 g/m², innen angeraut" statt
  "kuschelig warm".

MATERIAL – Rechtspflicht (EU-Verordnung 1007/2011):
- Faserzusammensetzung MUSS enthalten sein, mit Prozentangaben und nur mit
  offiziellen Faserbezeichnungen
- Übernimm NUR Angaben zu Farben, die unter FARBEN gelistet sind.
  Farbspezifische Ausnahmen für nicht angebotene Farben werden weggelassen.
- Übernimm keine Herstellerkatalogfelder, die diesen Artikel nicht beschreiben
  (z.B. "Farbigkeit: 1-farbig, Meliert, Pastell")
- Wenn Material unbekannt: "[Material: bitte ergänzen]". Niemals raten,
  niemals plausibel ergänzen.

WEITERES:
- Keine AGB erwähnen – es gibt bewusst keine
- Keine konkreten Liefer- oder Bestellschlussdaten. Lieferzeit nur als Spanne.
- Keine fremden Marken, Filmtitel oder geschützten Figuren, auch nicht
  nachempfunden oder angedeutet
- HTML nur: <h2>, <h3>, <p>, <ul>, <li>, <strong> – KEIN <h1>, KEIN Markdown,
  KEIN Codeblock
- JSON-Output MUSS valides JSON sein: Zeilenumbrüche und Anführungszeichen in
  HTML escapen
- KEINE echten/rohen Zeilenumbrüche, Tabs oder Steuerzeichen innerhalb der
  JSON-Strings – ausschließlich escaped (\\n, \\r, \\t)
- Antworte NUR mit dem JSON-Objekt`;

      // MODUS entscheidet, ob der Freigabe-Satz im Text landet. Ein stiller
      // Fallback würde dem Kunden einen Prozess versprechen, den es für einen
      // Kollektionsartikel nicht gibt – also laut melden.
      const { modus: modusWert, warnung: modusWarnung } = resolveModus(modus);
      if (modusWarnung) {
        console.warn(`[seo_description] ${modusWarnung} (empfangen: ${JSON.stringify(modus)})`);
      }

      const userPrompt = buildSeoUserPrompt({
        produktname,
        kategorien,
        eigenschaften,
        hinweise,
        motiv,
        modus: modusWert,
        farben,
      });

      // Der Anbieter folgt der Modell-ID aus dem Config-Sheet, nicht dem
      // zufällig gesetzten API-Key. Sonst läuft lokal ohne GEMINI_API_KEY eine
      // andere Rolle als in Produktion, und man schließt vom falschen Ergebnis
      // auf den Live-Betrieb.
      const modellId = await getModel('seo-text');
      console.log(`seo_description: Rolle seo-text -> ${modellId}`);

      let raw;
      if (modellId.startsWith('gemini-')) {
        if (!process.env.GEMINI_API_KEY) {
          return res.status(503).json({
            error: `Rolle seo-text ist auf ${modellId} konfiguriert, aber GEMINI_API_KEY fehlt.`,
          });
        }
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const geminiModel = genAI.getGenerativeModel({
          model: modellId,
          systemInstruction: SEO_SYSTEM,
        });
        const geminiResult = await geminiModel.generateContent(userPrompt);
        raw = geminiResult.response.text();
      } else {
        if (!process.env.ANTHROPIC_API_KEY) {
          return res.status(503).json({
            error: `Rolle seo-text ist auf ${modellId} konfiguriert, aber ANTHROPIC_API_KEY fehlt.`,
          });
        }
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
          model: modellId,
          max_tokens: 2048,
          system: SEO_SYSTEM,
          messages: [{ role: 'user', content: userPrompt }],
        });
        raw = collectText(response);
      }

      if (!raw || !raw.trim()) {
        console.error('[seo_description] Leere Antwort vom Modell - nichts zu parsen.');
        return res.status(502).json({ error: 'Modell lieferte eine leere Antwort.' });
      }

      let parsed;
      try {
        let cleaned = raw.trim();
        console.log('SEO raw response:', cleaned.substring(0, 200));

        // Markdown-Codeblock entfernen falls vorhanden (json ... oder ... oder ```json)
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');

        // JSON-Objekt extrahieren (alles von { bis })
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error('Kein JSON-Match gefunden in:', cleaned.substring(0, 300));
          throw new Error('Kein JSON-Objekt in Antwort gefunden');
        }

        let jsonStr = sanitizeJsonControlChars(jsonMatch[0]);
        try {
          parsed = JSON.parse(jsonStr);
        } catch (parseErr) {
          // Fallback: Versuche, ungültige Anführungszeichen in HTML-Strings zu escapen
          console.warn('JSON Parse failed, attempting cleanup:', parseErr.message);
          // Vereinfachter Fix: ersetze unescapte Anführungszeichen INNERHALB von HTML-Tags
          jsonStr = jsonStr.replace(/(<[^>]*)"([^>]*>)/g, '$1\\"$2');
          parsed = JSON.parse(jsonStr);
          console.log('SEO parsed after cleanup:', Object.keys(parsed));
        }
      } catch (e) {
        console.error('SEO parsing error:', e.message, 'raw:', raw.substring(0, 500));
        return res.status(502).json({ error: 'KI-Antwort konnte nicht geparst werden: ' + e.message, raw: raw.substring(0, 500) });
      }

      return res.json({
        short_description: parsed.kurzbeschreibung || '',
        full_description:  parsed.produktbeschreibung || '',
        modus:             modusWert,
        hinweis:           modusWarnung,
      });
    }

    if (action !== 'generate_description') {
      return res.status(400).json({ error: 'Unbekannte action. Erwartet: generate_description, seo_description oder generate_variants' });
    }
    if (!name || !keywords || !shop) {
      return res.status(400).json({ error: 'Felder name, keywords und shop sind erforderlich.' });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `Erstelle eine verkaufsstarke WooCommerce-Produktbeschreibung für folgenden Artikel:

Produktname: ${name}
Keywords / Eigenschaften: ${keywords}
Shop / Marke: ${shop}

Antworte ausschließlich als valides JSON-Objekt mit diesen zwei Feldern:
- "short_description": Ein einzelner, knackiger Einleitungssatz (max. 20 Wörter), der das Produkt emotional und prägnant beschreibt. Kein HTML.
- "full_description": Eine vollständige HTML-Produktbeschreibung mit:
  1. Einem kurzen emotionalen Einleitungssatz als <p>
  2. Einer <ul>-Liste mit 4–6 prägnanten Highlight-Bulletpoints (<li>)
  3. Einem abschließenden SEO-Absatz als <p> (~100 Wörter) mit natürlicher Keyword-Integration

Ton: selbstbewusst, urban, zielgruppenorientiert (Streetwear/Fanmerch). Sprache: Deutsch.
Gib nur das JSON zurück, keinen weiteren Text.`;

    const response = await client.messages.create({
      model: await getModel('agent-intern'),
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = collectText(response);
    if (!raw) {
      console.error('[generate_description] Leere Antwort vom Modell, content-Typen:',
        (response.content ?? []).map(b => b.type).join(',') || '(keine)');
    }

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      return res.status(502).json({ error: 'Claude-Antwort konnte nicht als JSON geparst werden.', raw });
    }

    if (!parsed.short_description || !parsed.full_description) {
      return res.status(502).json({ error: 'Antwort enthält nicht alle erwarteten Felder.', raw: parsed });
    }

    res.json({
      short_description: parsed.short_description,
      full_description: parsed.full_description,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
