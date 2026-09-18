// Tier-2 – action=seo_description: welche Rolle, welches Modell, welcher Anbieter.
// Hintergrund: Eine Modell-Zelle im Config-Sheet, die nicht wirkt, ist dieselbe
// Fehlerklasse wie eine hartkodierte Modell-ID. Früher hing der Anbieter am
// gesetzten API-Key, und der Anthropic-Zweig lief unter der Rolle agent-intern –
// lokal ohne GEMINI_API_KEY testete man damit gegen ein anderes Modell als in
// Produktion.
// Mocks müssen VOR allen dynamischen Imports deklariert werden (ESM-Anforderung).

import { jest } from '@jest/globals';

const getModel         = jest.fn();
const generateContent  = jest.fn();
const messagesCreate   = jest.fn();
const getGenerativeModel = jest.fn(() => ({ generateContent }));

jest.unstable_mockModule('../lib/modelConfig.js', () => ({ getModel }));

jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel })),
}));

jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => ({ messages: { create: messagesCreate } })),
}));

let request, app;

// Die Antwort muss die Nachprüfung aus pruefeSeoText() bestehen, sonst steht in
// jedem Testfall ein Hinweis und diese Tests prüfen nicht mehr die Modellwahl.
// Ohne Fokus-Keyphrase ist das Hauptkeyword der Produkttitel ("Testshirt").
const ANTWORT = JSON.stringify({
  kurzbeschreibung:   'Testshirt mit Motiv, jetzt bestellen.',
  produktbeschreibung:
    '<h2>Schnitt und Material</h2><p>Testshirt aus Baumwolle für den Alltag.</p>',
});

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
  process.env.GEMINI_API_KEY    = 'test-gemini';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic';
  generateContent.mockResolvedValue({ response: { text: () => ANTWORT } });
  messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: ANTWORT }] });
});

function post(body = {}) {
  return request(app)
    .post('/api/claude/generate-product')
    .send({ action: 'seo_description', produktname: 'Testshirt', ...body });
}

describe('seo_description – Modellwahl', () => {
  test('Gemini-Modell aus dem Sheet wird genau so verwendet', async () => {
    getModel.mockResolvedValue('gemini-3.5-flash-lite');

    const res = await post();

    expect(res.status).toBe(200);
    expect(getModel).toHaveBeenCalledWith('seo-text');
    expect(getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.5-flash-lite' }),
    );
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  test('Claude-Modell aus dem Sheet geht an Anthropic – nicht an agent-intern', async () => {
    getModel.mockResolvedValue('claude-sonnet-5');

    const res = await post();

    expect(res.status).toBe(200);
    expect(getModel).toHaveBeenCalledWith('seo-text');
    expect(getModel).not.toHaveBeenCalledWith('agent-intern');
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-5' }),
    );
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });

  test('der Anbieter folgt der Modell-ID, nicht dem vorhandenen API-Key', async () => {
    // Beide Keys gesetzt, Sheet sagt Claude -> es darf NICHT Gemini gewinnen,
    // nur weil GEMINI_API_KEY zufällig da ist.
    getModel.mockResolvedValue('claude-sonnet-5');

    await post();

    expect(getGenerativeModel).not.toHaveBeenCalled();
    expect(messagesCreate).toHaveBeenCalled();
  });

  test('Gemini-Modell ohne GEMINI_API_KEY: 503 mit Modellname, kein stiller Wechsel', async () => {
    delete process.env.GEMINI_API_KEY;
    getModel.mockResolvedValue('gemini-3.5-flash-lite');

    const res = await post();

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('gemini-3.5-flash-lite');
    expect(res.body.error).toContain('GEMINI_API_KEY');
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  test('Claude-Modell ohne ANTHROPIC_API_KEY: 503 mit Modellname', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    getModel.mockResolvedValue('claude-sonnet-5');

    const res = await post();

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('claude-sonnet-5');
    expect(res.body.error).toContain('ANTHROPIC_API_KEY');
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });
});

describe('seo_description – MODUS in der Antwort', () => {
  beforeEach(() => getModel.mockResolvedValue('gemini-3.5-flash-lite'));

  test('unbekannter MODUS: hinweis gesetzt, modus auf kollektion', async () => {
    const res = await post({ modus: 'Auftraggeber' });

    expect(res.status).toBe(200);
    expect(res.body.modus).toBe('kollektion');
    expect(res.body.hinweis).toContain('Auftraggeber');
  });

  test('gültiger MODUS: kein hinweis', async () => {
    const res = await post({ modus: 'auftrag' });

    expect(res.body.modus).toBe('auftrag');
    expect(res.body.hinweis).toBeNull();
  });
});
