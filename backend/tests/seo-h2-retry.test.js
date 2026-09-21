// Ein automatischer zweiter Versuch - nur fuer die <h2>-Regel.
//
// Anlass: Am 21.09. lieferte der Generator zweimal hintereinander eine <h2>,
// die den Produkttitel enthaelt. Die Nachpruefung hat das korrekt gemeldet -
// nur musste danach ein Mensch von Hand nacharbeiten. Jetzt wiederholt der
// Endpunkt EINMAL und gibt den konkreten Verstoss in den Prompt.
//
// Ausdruecklich NICHT fuer die Keyphrase-Pruefung: die ist laut Framework ein
// Hinweis, kein Fehler.

import { jest } from '@jest/globals';

const getModel           = jest.fn();
const generateContent    = jest.fn();
const messagesCreate     = jest.fn();
const getGenerativeModel = jest.fn(() => ({ generateContent }));

jest.unstable_mockModule('../lib/modelConfig.js', () => ({ getModel }));
jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel })),
}));
jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => ({ messages: { create: messagesCreate } })),
}));

let request, app;

const antwort = (kurz, lang) => JSON.stringify({
  kurzbeschreibung: kurz, produktbeschreibung: lang,
});

// Produktname im Test: "Testshirt".
const H2_SCHLECHT = antwort(
  'Testshirt mit Motiv, jetzt bestellen.',
  '<h2>Testshirt für den Alltag</h2><p>Testshirt aus Baumwolle für den Alltag.</p>',
);
const H2_GUT = antwort(
  'Testshirt mit Motiv, jetzt bestellen.',
  '<h2>Schnitt und Material</h2><p>Testshirt aus Baumwolle für den Alltag.</p>',
);
// <h2> sauber, aber die Keyphrase fehlt in der Kurzbeschreibung.
const NUR_KEYPHRASE = antwort(
  'Schickes Teil, jetzt bestellen.',
  '<h2>Schnitt und Material</h2><p>Testshirt aus Baumwolle für den Alltag.</p>',
);

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
  process.env.GEMINI_API_KEY    = 'test-gemini';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic';
  getModel.mockResolvedValue('gemini-3.5-flash-lite');
});

afterEach(() => jest.restoreAllMocks());

const gemini = (...antworten) => {
  for (const a of antworten) generateContent.mockResolvedValueOnce({ response: { text: () => a } });
};
// modus ausdruecklich mitgeben: ohne ihn meldet resolveModus() "MODUS fehlt",
// und dieser Hinweis steht dann in jeder Antwort - die Tests koennten
// "kein Hinweis" nicht mehr von "<h2> sauber" unterscheiden.
const post = (body = {}) => request(app)
  .post('/api/claude/generate-product')
  .send({ action: 'seo_description', produktname: 'Testshirt', modus: 'kollektion', ...body });

describe('erster Lauf fehlerhaft, zweiter sauber', () => {
  test('der zweite wird verwendet und im Statusfeld genannt', async () => {
    gemini(H2_SCHLECHT, H2_GUT);

    const res = await post();

    expect(res.status).toBe(200);
    expect(res.body.versuch).toBe(2);
    expect(res.body.full_description).toContain('<h2>Schnitt und Material</h2>');
    expect(res.body.full_description).not.toContain('Testshirt für den Alltag');
    expect(res.body.hinweis).toBeNull();
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  test('der zweite Prompt nennt den konkreten Verstoss, nicht nur die Regel', async () => {
    gemini(H2_SCHLECHT, H2_GUT);

    await post();

    const zweiterPrompt = generateContent.mock.calls[1][0];
    expect(zweiterPrompt).toContain('KORREKTUR');
    expect(zweiterPrompt).toContain('Testshirt für den Alltag');   // die gelieferte <h2>
    expect(zweiterPrompt).toMatch(/enthält den Produkttitel/);
    expect(zweiterPrompt).toContain('richtig: "Mehrfarbiger Brustdruck auf schwarzem Jersey"');
  });
});

describe('zweimal fehlerhaft', () => {
  test('heutiges Verhalten: Text kommt, Meldung steht, versuch bleibt 1', async () => {
    gemini(H2_SCHLECHT, H2_SCHLECHT);

    const res = await post();

    expect(res.status).toBe(200);
    expect(res.body.versuch).toBe(1);
    expect(res.body.hinweis).toMatch(/enthält den Produkttitel/);
    expect(res.body.full_description).toContain('Testshirt für den Alltag');
  });

  test('genau zwei Modellaufrufe - kein dritter, keine Schleife', async () => {
    gemini(H2_SCHLECHT, H2_SCHLECHT);

    await post();

    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});

describe('die Keyphrase loest keinen zweiten Versuch aus', () => {
  test('nur ein Modellaufruf, Hinweis steht trotzdem', async () => {
    gemini(NUR_KEYPHRASE);

    const res = await post();

    expect(res.status).toBe(200);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(res.body.versuch).toBe(1);
    expect(res.body.hinweis).toMatch(/Kurzbeschreibung/);
  });
});

describe('Robustheit des Wiederholungslaufs', () => {
  test('unbrauchbare zweite Antwort: erster Entwurf bleibt, kein 502', async () => {
    gemini(H2_SCHLECHT, 'kein JSON weit und breit');

    const res = await post();

    expect(res.status).toBe(200);
    expect(res.body.versuch).toBe(1);
    expect(res.body.full_description).toContain('Testshirt für den Alltag');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  test('sauberer erster Lauf: kein zweiter Aufruf', async () => {
    gemini(H2_GUT);

    const res = await post();

    expect(res.body.versuch).toBe(1);
    expect(res.body.hinweis).toBeNull();
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
