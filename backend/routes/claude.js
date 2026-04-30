import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';

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

    if (action === 'seo_description') {
      const { produktname, artikelnummer, lshopNr, lshopUrl, kategorien, eigenschaften, instagram, tiktok, hinweise } = req.body;
      if (!produktname) return res.status(400).json({ error: 'produktname ist erforderlich.' });
      if (!lshopUrl?.trim()) return res.status(400).json({ error: 'Bitte L-Shop URL eintragen' });

      // ── L-Shop Seite abrufen und HTML zu Klartext reduzieren ─────────────
      let lshopText = '';
      try {
        const htmlRes = await fetch(lshopUrl.trim(), {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(15000),
        });
        if (!htmlRes.ok) throw new Error(`HTTP ${htmlRes.status}`);
        const html = await htmlRes.text();
        lshopText = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 8000);
      } catch (fetchErr) {
        return res.status(502).json({ error: `L-Shop Seite konnte nicht geladen werden: ${fetchErr.message}` });
      }

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const SEO_SYSTEM = `Du bist ein SEO-Texter für einen deutschen Textildruck-Onlineshop.
Schreibe verkaufsfördernde, SEO-optimierte Produktbeschreibungen auf Deutsch.
NICHT erwähnen: Herstellerfirma, L-Shop, Bedruckung, Merch, Druck.
Pflichtangaben (Materialzusammensetzung in %) immer einbauen.
Ausgabe als JSON: { "short_description": "...", "description": "..." }`;

      const socialPart = [
        instagram ? `Instagram: ${instagram}` : '',
        tiktok    ? `TikTok: ${tiktok}`       : '',
      ].filter(Boolean).join(' | ');

      const userPrompt = `Erstelle eine SEO-Produktbeschreibung für diesen Artikel.

PRODUKTDATEN (aus Hersteller-Katalogseite extrahieren):
${lshopText}

---
Produktname im Shop: ${produktname}
${artikelnummer ? `Artikelnummer: ${artikelnummer}` : ''}
${lshopNr       ? `L-Shop Nr.: ${lshopNr}`          : ''}
${kategorien    ? `Kategorien: ${kategorien}`        : ''}
${eigenschaften ? `Eigenschaften/Varianten: ${eigenschaften}` : ''}
${socialPart    ? `Social Media: ${socialPart}`      : ''}
${hinweise      ? `Shop-Hinweise: ${hinweise}`       : ''}

Extrahiere aus den Produktdaten: Material, Grammatur (g/m²), Schnitt/Passform, Pflegehinweise, Materialzusammensetzung in %.

HTML-Aufbau für "description":
<h2>[Produktname] – [SEO-Keyword]</h2>
<p>Einleitung: 2-3 Sätze emotional &amp; keyword-reich</p>
<h3>Artikeleigenschaften</h3>
<ul>
  <li>Material &amp; Grammatur</li>
  <li>Schnitt &amp; Passform</li>
  <li>Verfügbare Farben/Größen</li>
  <li>Pflegehinweise</li>
  <li>Pflichtangaben (Materialzusammensetzung in %)</li>
</ul>
${socialPart ? `<p>Abschluss: Social-Media Hinweis auf ${socialPart}</p>` : ''}

"short_description": 1-2 Sätze Teaser, SEO-Keyword am Anfang, kein HTML.

Nur JSON: { "short_description": "...", "description": "..." }`;

      const response = await client.messages.create({
        model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: 4096,
        system:     SEO_SYSTEM,
        messages:   [{ role: 'user', content: userPrompt }],
      });

      const raw = response.content.find(b => b.type === 'text')?.text ?? '';
      let parsed;
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      } catch {
        return res.status(502).json({ error: 'Claude-Antwort konnte nicht geparst werden.', raw });
      }

      return res.json({
        short_description: parsed.short_description || '',
        full_description:  parsed.description || parsed.full_description || '',
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
