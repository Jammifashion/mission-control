// Befehl SP2: Struktur der Produktbeschreibung und Titelvergleich der <h2>.
// Anlass BL7 Lauf 2 (24.09.): 14 von 37 Beschreibungen begannen mit einem losen
// Keyphrase-Satz VOR der <h2>; bei 12623 trug die <h2> den Titel mit einem
// eingeschobenen Wort ("Jack Joker Fanart T-Shirt …" gegen "Jack/Joker T-Shirt").

import { jest } from '@jest/globals';

const getModel        = jest.fn();
const generateContent = jest.fn();
jest.unstable_mockModule('../lib/modelConfig.js', () => ({ getModel }));
jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: () => ({ generateContent }) })),
}));
jest.unstable_mockModule('@anthropic-ai/sdk', () => ({ default: jest.fn(() => ({ messages: { create: jest.fn() } })) }));

const { pruefeH2, pruefeSeoText, h2KorrekturBlock, buildSeoUserPrompt } = await import('../lib/seo-prompt.js');

let request, app;
beforeAll(async () => {
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  const router  = (await import('../routes/claude.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/claude', router);
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  process.env.GEMINI_API_KEY = 'test-gemini';
  getModel.mockResolvedValue('gemini-3.5-flash-lite');
});
afterEach(() => jest.restoreAllMocks());

const antwort = (kurz, lang) => JSON.stringify({ kurzbeschreibung: kurz, produktbeschreibung: lang });
const LOSER_SATZ = antwort('Testshirt mit Motiv, jetzt bestellen.',
  'Testshirt aus Baumwolle zeigt ein Motiv.\n<h2>Schnitt und Material</h2><p>Testshirt aus Baumwolle.</p>');
const SAUBER = antwort('Testshirt mit Motiv, jetzt bestellen.',
  '<h2>Schnitt und Material</h2><p>Testshirt aus Baumwolle für den Alltag.</p>');
const gemini = (...a) => { for (const x of a) generateContent.mockResolvedValueOnce({ response: { text: () => x } }); };
const post = () => request(app).post('/api/claude/generate-product')
  .send({ action: 'seo_description', produktname: 'Testshirt', modus: 'kollektion' });

describe('Beschreibung beginnt mit <h2>', () => {
  test('loser Satz vor <h2> -> Meldung aus pruefeH2', () => {
    const m = pruefeH2('Testshirt zeigt ein Motiv.<h2>Schnitt und Material</h2><p>x</p>', 'Testshirt');
    expect(m.some(x => /beginnt nicht mit <h2>/.test(x))).toBe(true);
  });

  test('Leerraum vor <h2> ist erlaubt', () => {
    expect(pruefeH2('\n  <h2>Schnitt und Material</h2><p>x</p>', 'Testshirt')).toEqual([]);
  });

  test('Route: loser Satz vor <h2> -> genau ein zweiter Versuch, der wird verwendet', async () => {
    gemini(LOSER_SATZ, SAUBER);
    const res = await post();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(res.body.versuch).toBe(2);
    expect(res.body.full_description.trim().startsWith('<h2>')).toBe(true);
    // Der Korrekturblock nennt den Verstoss.
    expect(generateContent.mock.calls[1][0]).toMatch(/beginnt nicht mit <h2>/);
  });

  test('Route: auch der zweite Versuch mit losem Satz -> kein dritter, erster Entwurf + Hinweis', async () => {
    gemini(LOSER_SATZ, LOSER_SATZ);
    const res = await post();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(res.body.versuch).toBe(1);
    expect(res.body.hinweise.some(h => /beginnt nicht mit <h2>/.test(h))).toBe(true);
  });

  test('Route: Titel-<h2> UND loser Satz teilen sich denselben einen Wiederholungslauf', async () => {
    const beides = antwort('Testshirt mit Motiv.', 'Satz davor.<h2>Testshirt für alle</h2><p>Testshirt.</p>');
    gemini(beides, beides);
    await post();
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  test('Korrekturblock enthaelt die Strukturregel', () => {
    const b = h2KorrekturBlock(['x']);
    expect(b).toMatch(/beginnt mit <h2>, davor steht nichts/);
    expect(b).toMatch(/ersten Satz des ersten <p> nach der <h2>/);
  });
});

describe('Keyphrase im ersten Satz des ersten <p> NACH der <h2>', () => {
  const pruefe = lang => pruefeSeoText({
    kurzbeschreibung: 'Jack Joker Fanart T-Shirt in Weiß, jetzt bestellen.',
    produktbeschreibung: lang, keyphrase: 'Jack Joker Fanart T-Shirt', produktname: 'Jack/Joker T-Shirt',
  }).filter(m => /ersten Satz/.test(m));

  test('Keyphrase im ersten <p> nach der <h2> -> ok', () => {
    expect(pruefe('<h2>Motiv vorne und hinten</h2><p>Das Jack Joker Fanart T-Shirt zeigt Hände. Mehr.</p>')).toEqual([]);
  });

  test('Keyphrase nur im losen Satz vor der <h2> -> Meldung', () => {
    expect(pruefe('Das Jack Joker Fanart T-Shirt zeigt Hände.<h2>Motiv vorne</h2><p>Hände und Karten.</p>')).toHaveLength(1);
  });

  test('ein <p> vor der <h2> zaehlt nicht als Einleitung', () => {
    expect(pruefe('<p>Jack Joker Fanart T-Shirt.</p><h2>Motiv vorne</h2><p>Hände und Karten.</p>')).toHaveLength(1);
  });

  test('Prompt nennt die Regel an beiden Stellen', () => {
    const p = buildSeoUserPrompt({ produktname: 'X', keyphrase: 'Jack Joker', modus: 'kollektion' }).prompt;
    expect(p).toContain('Der ERSTE SATZ des ersten <p> NACH der <h2> enthält ALLE Wörter der Keyphrase.');
    expect(p).toContain('Die produktbeschreibung beginnt IMMER mit <h2>. Vor der <h2> steht nichts.');
  });
});

describe('pruefeH2: Titelvergleich normalisiert', () => {
  const titelMeldung = (h2, name) => pruefeH2(`<h2>${h2}</h2><p>x</p>`, name).some(m => /enthält den Produkttitel/.test(m));

  test('Jack/Joker T-Shirt gegen "Jack Joker T-Shirt …" schlaegt an', () => {
    expect(titelMeldung('Jack Joker T-Shirt mit großem Motiv', 'Jack/Joker T-Shirt')).toBe(true);
  });

  test('BL7 12623: eingeschobenes Wort ("Jack Joker Fanart T-Shirt …") schlaegt an', () => {
    expect(titelMeldung('Jack Joker Fanart T-Shirt mit großem Motiv', 'Jack/Joker T-Shirt')).toBe(true);
  });

  test('"&", "und", Bindestrich, Gross/Klein, Mehrfach-Leerzeichen gleich', () => {
    expect(titelMeldung('jack & joker t shirt', 'Jack/Joker T-Shirt')).toBe(true);
    expect(titelMeldung('Jack und Joker T-Shirt', 'Jack/Joker T-Shirt')).toBe(true);
    expect(titelMeldung('JACK   JOKER   T-SHIRT', 'Jack/Joker T-Shirt')).toBe(true);
  });

  test('zu weit auseinander oder falsche Reihenfolge -> keine Titelmeldung', () => {
    expect(titelMeldung('Jack druckt eins zwei drei Joker auf T-Shirt', 'Jack/Joker T-Shirt')).toBe(false);
    expect(titelMeldung('T-Shirt mit Joker und Jack', 'Jack/Joker T-Shirt')).toBe(false);
    expect(titelMeldung('Mehrfarbiger Druck vorne und hinten', 'Jack/Joker T-Shirt')).toBe(false);
  });

  test('Wortzahl zaehlt "und" weiter mit (hoechstens 8)', () => {
    const m = pruefeH2('<h2>eins und zwei und drei und vier und fünf</h2><p>x</p>', 'Shirt');
    expect(m.some(x => /9 Wörter/.test(x))).toBe(true);
  });
});
