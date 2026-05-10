import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();

const SYSTEM_PROMPT = `Du bist der KI-Assistent für das Mission Control Dashboard von Jammi Fashion.
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

    // Keep only last N turns to control token usage
    const trimmed = history.slice(-MAX_HISTORY);

    const response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: trimmed,
    });

    const reply = response.content[0]?.text ?? '';
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
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY nicht konfiguriert.' });
    }

    const { action, name, keywords, shop, properties, rules } = req.body;

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
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{ role: 'user', content: variantPrompt }],
      });

      const raw = response.content[0]?.text ?? '';
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

      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const geminiModel = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
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
      const { produktname, artikelnummer, lshopNr, kategorien, eigenschaften, hinweise } = req.body;
      if (!produktname) return res.status(400).json({ error: 'produktname ist erforderlich.' });

      const SEO_SYSTEM = `Du bist SEO-Texter für jammifashion.de. Der Artikel ist ein FERTIG BEDRUCKTES Textil – genau so wird er verkauft.

WICHTIG:
- NICHT schreiben: "individuell bedruckbar", "eigenes Design", "personalisierbar", "jetzt selbst gestalten"
- Schreibe als würdest du einen fertigen Markenartikel beschreiben – der Druck IST der Artikel
- Ton passt sich an: Verein=sportlich/motivierend, Party=locker/spaßig, Künstler=kreativ/einzigartig
- Faserzusammensetzung MUSS enthalten sein (EU-Textilkennzeichnungsverordnung)
- Wenn Material unbekannt: "[Material: bitte ergänzen]"
- HTML nur: <h1>, <h2>, <p>, <ul>, <li>, <strong> – KEIN Markdown, KEIN Codeblock
- Antworte NUR mit dem JSON-Objekt`;

      // Größen und Farben aus eigenschaften extrahieren
      const eigenschaftenLines = eigenschaften ? eigenschaften.split('\n').filter(Boolean) : [];
      const groessen = eigenschaftenLines.filter(l => /größe|size/i.test(l)).join(', ') || 'XS – 3XL';
      const farben   = eigenschaftenLines.filter(l => /farbe|color/i.test(l)).join(', ') || 'siehe Varianten';

      const userPrompt = `Erstelle Beschreibungen für folgenden FERTIGEN bedruckten Artikel:

KONTEXT & HINWEISE (PRIMÄR):
${hinweise || 'Keine besonderen Hinweise'}

PRODUKTDATEN:
- Artikelname: ${produktname}
- Kategorie: ${kategorien || 'Textilien'}
- Material: ${eigenschaftenLines.find(l => /material|baumwolle|polyester/i.test(l))?.trim() || '[Material: bitte ergänzen]'}
${eigenschaften ? `- Weitere Eigenschaften: ${eigenschaften}` : ''}

STRUKTUR der produktbeschreibung (EXAKT einhalten):

<h1>[Artikelbezeichnung] – [passender Slogan basierend auf Kontext]</h1>

<p>[Einleitung: 2-3 Sätze. WER trägt das + WANN/WARUM. Stimmung/Anlass aus Kontext oben. Basiere Ton auf den Hinweisen.]</p>

<h2>Produktdetails</h2>
<ul>
<li><strong>Material:</strong> ${eigenschaftenLines.find(l => /material|baumwolle|polyester/i.test(l))?.trim() || '[Material: bitte ergänzen]'}</li>
${eigenschaftenLines.filter(l => !/material|baumwolle|polyester/i.test(l)).slice(0, 5).map(p => `<li>${p.trim()}</li>`).join('\n')}
</ul>

<p>[Abschluss: 2 Sätze. Was macht diesen Artikel besonders? Direkte Kaufaufforderung – passend zur Stimmung aus den Hinweisen.]</p>

kurzbeschreibung: Plain Text, max. 160 Zeichen. Artikel + Highlight + CTA.
NICHT "individuell" oder "personalisierbar".

Antworte NUR mit diesem JSON (KEIN Markdown-Codeblock):
{
  "kurzbeschreibung": "...",
  "produktbeschreibung": "Valides HTML wie oben definiert"
}`;

      let raw;
      if (process.env.GEMINI_API_KEY) {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const geminiModel = genAI.getGenerativeModel({
          model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
          systemInstruction: SEO_SYSTEM,
        });
        const geminiResult = await geminiModel.generateContent(userPrompt);
        raw = geminiResult.response.text();
      } else if (process.env.ANTHROPIC_API_KEY) {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
          model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: SEO_SYSTEM,
          messages: [{ role: 'user', content: userPrompt }],
        });
        raw = response.content[0]?.text ?? '';
      } else {
        return res.status(503).json({ error: 'Weder GEMINI_API_KEY noch ANTHROPIC_API_KEY konfiguriert.' });
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

        parsed = JSON.parse(jsonMatch[0]);
        console.log('SEO parsed:', Object.keys(parsed));
      } catch (e) {
        console.error('SEO parsing error:', e.message, 'raw:', raw.substring(0, 300));
        return res.status(502).json({ error: 'KI-Antwort konnte nicht geparst werden: ' + e.message, raw: raw.substring(0, 500) });
      }

      return res.json({
        short_description: parsed.kurzbeschreibung || '',
        full_description:  parsed.produktbeschreibung || '',
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
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0]?.text ?? '';

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
