// Auftrag KI2: gemeinsamer Modellaufruf (lib/modellAufruf.js).
// Anbieterwahl ueber das Praefix, Parameter je Art, Abbruch bei max_tokens /
// refusal, Gemini-Weg weiter erreichbar, Routen seo_description und
// suggest_variants, Warnung zu Spalte C (modelConfig.js), Floskeln (seo-pruefung).
// Mocks VOR allen dynamischen Imports (ESM).

import { jest } from '@jest/globals';

const messagesCreate     = jest.fn();
const generateContent    = jest.fn();
const getGenerativeModel = jest.fn(() => ({ generateContent }));
const sheetsGet          = jest.fn();

jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => ({ messages: { create: messagesCreate } })),
}));
jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel })),
}));
jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn(() => ({ spreadsheets: { values: { get: sheetsGet } } })) },
}));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: jest.fn().mockResolvedValue({}) }));

const m = await import('../lib/modellAufruf.js');
const { anbieterVon, anbieterPasst, anthropicParameter, schluesselFehlt, textAufruf,
  KiAbgeschnittenError, KiAbgelehntError, ARTEN } = m;
const modelConfig = await import('../lib/modelConfig.js');
const { pruefeGeneratorText, FLOSKELN } = await import('../lib/seo-pruefung.js');

const SEO_JSON = JSON.stringify({
  kurzbeschreibung: 'Testshirt mit Motiv, jetzt bestellen.',
  produktbeschreibung: '<h2>Schnitt und Material</h2><p>Testshirt aus Baumwolle für den Alltag.</p>',
});
const antwort = (text, stop = 'end_turn') => ({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }], stop_reason: stop, usage: { input_tokens: 10, output_tokens: 20 } });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-anthropic';
  process.env.GEMINI_API_KEY    = 'test-gemini';
  process.env.BUSINESS_SHEET_ID = 'test-business';
  messagesCreate.mockResolvedValue(antwort(SEO_JSON));
  generateContent.mockResolvedValue({ response: { text: () => SEO_JSON, candidates: [{ finishReason: 'STOP' }] } });
});

describe('Anbieterwahl ueber das Praefix', () => {
  test('claude- / gemini- / unbekannt', () => {
    expect(anbieterVon('claude-haiku-5-5')).toBe('anthropic');
    expect(anbieterVon(' Gemini-3.5-flash-lite')).toBe('google');
    expect(anbieterVon('gpt-5')).toBeNull();
    expect(anbieterVon('')).toBeNull();
  });
  test('Spalte C: leer passt, passend passt, falsch passt nicht', () => {
    expect(anbieterPasst('claude-haiku-5-5', '')).toBe(true);
    expect(anbieterPasst('claude-haiku-5-5', 'Anthropic')).toBe(true);
    expect(anbieterPasst('gemini-3.5-flash-lite', 'google')).toBe(true);
    expect(anbieterPasst('claude-haiku-5-5', 'Google')).toBe(false);
  });
  test('fehlender Schluessel: Text mit Modell und Schluesselname', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(schluesselFehlt('claude-haiku-5-5', 'seo-text')).toBe('Rolle seo-text ist auf claude-haiku-5-5 konfiguriert, aber ANTHROPIC_API_KEY fehlt.');
    expect(schluesselFehlt('gemini-3.5-flash-lite', 'seo-text')).toBeNull();
    expect(schluesselFehlt('gpt-5', 'seo-text')).toMatch(/Anbieter unbekannt/);
  });
});

describe('Parameter je Art (eine Stelle)', () => {
  test('seo: Denken an, Effort low, 16000', () => {
    expect(anthropicParameter('seo')).toEqual({ max_tokens: 16000, output_config: { effort: 'low' } });
  });
  test('klassifizierung: Denken aus, 1024', () => {
    expect(anthropicParameter('klassifizierung')).toEqual({ max_tokens: 1024, thinking: { type: 'disabled' } });
  });
  test('Kopie, keine geteilte Referenz; unbekannte Art wirft', () => {
    anthropicParameter('seo').output_config.effort = 'max';
    expect(ARTEN.seo.anthropic.output_config.effort).toBe('low');
    expect(() => anthropicParameter('chat')).toThrow(/Unbekannte KI-Art/);
  });
});

describe('textAufruf – Anthropic', () => {
  test('sendet Modell, System, Prompt und die Parameter der Art; Text ohne thinking-Block', async () => {
    const r = await textAufruf({ modellId: 'claude-haiku-5-5', system: 'S', prompt: 'P', art: 'seo' });
    expect(messagesCreate).toHaveBeenCalledWith({
      model: 'claude-haiku-5-5', system: 'S', messages: [{ role: 'user', content: 'P' }],
      max_tokens: 16000, output_config: { effort: 'low' },
    });
    expect(r).toMatchObject({ text: SEO_JSON, anbieter: 'anthropic', stopReason: 'end_turn', nutzung: { ein: 10, aus: 20 } });
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });
  test('klassifizierung schickt thinking disabled', async () => {
    await textAufruf({ modellId: 'claude-haiku-5-5', system: 'S', prompt: 'P', art: 'klassifizierung' });
    expect(messagesCreate.mock.calls[0][0]).toMatchObject({ max_tokens: 1024, thinking: { type: 'disabled' } });
  });
  test('stop_reason max_tokens -> KiAbgeschnittenError (502), kein halber Text', async () => {
    messagesCreate.mockResolvedValue(antwort('{"kurzbeschreibung": "abgesch', 'max_tokens'));
    const err = await textAufruf({ modellId: 'claude-haiku-5-5', system: 'S', prompt: 'P', art: 'seo' }).catch(e => e);
    expect(err).toBeInstanceOf(KiAbgeschnittenError);
    expect(err).toMatchObject({ status: 502, code: 'ki_abgeschnitten' });
    expect(err.message).toMatch(/KI-Antwort abgeschnitten.*16000/);
  });
  test('stop_reason refusal -> KiAbgelehntError', async () => {
    messagesCreate.mockResolvedValue({ content: [], stop_reason: 'refusal', stop_details: { category: 'cyber' } });
    await expect(textAufruf({ modellId: 'claude-haiku-5-5', system: 'S', prompt: 'P', art: 'seo' })).rejects.toBeInstanceOf(KiAbgelehntError);
  });
  test('ohne Schluessel: 503, kein Aufruf', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const err = await textAufruf({ modellId: 'claude-haiku-5-5', system: 'S', prompt: 'P', art: 'seo', rolle: 'seo-text' }).catch(e => e);
    expect(err.status).toBe(503);
    expect(messagesCreate).not.toHaveBeenCalled();
  });
});

describe('textAufruf – Gemini-Weg bleibt erreichbar', () => {
  test('gemini- geht an Google mit systemInstruction, nicht an Anthropic', async () => {
    const r = await textAufruf({ modellId: 'gemini-3.5-flash-lite', system: 'S', prompt: 'P', art: 'klassifizierung' });
    expect(getGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-3.5-flash-lite', systemInstruction: 'S' });
    expect(generateContent).toHaveBeenCalledWith('P');
    expect(r).toMatchObject({ text: SEO_JSON, anbieter: 'google' });
    expect(messagesCreate).not.toHaveBeenCalled();
  });
  test('finishReason MAX_TOKENS -> abgeschnitten', async () => {
    generateContent.mockResolvedValue({ response: { text: () => '{', candidates: [{ finishReason: 'MAX_TOKENS' }] } });
    await expect(textAufruf({ modellId: 'gemini-3.5-flash-lite', system: 'S', prompt: 'P', art: 'seo' })).rejects.toBeInstanceOf(KiAbgeschnittenError);
  });
});

describe('Routen', () => {
  let request, app;
  beforeAll(async () => {
    request = (await import('supertest')).default;
    const express = (await import('express')).default;
    const router = (await import('../routes/claude.js')).default;
    app = express(); app.use(express.json()); app.use('/api/claude', router);
  });
  const post = body => request(app).post('/api/claude/generate-product').send(body);
  // modelConfig liest das Sheet ueber googleapis (gemockt): Config-Reiter je Test.
  const config = (rolle, wert, anbieter = '') => sheetsGet.mockResolvedValue({ data: { values: [
    ['Schlüssel', 'Wert', 'Anbieter'], [`modell.${rolle}`, wert, anbieter]] } });
  beforeEach(() => modelConfig.invalidateCache());

  test('seo_description mit Haiku: Art seo (16000, Effort low)', async () => {
    config('seo-text', 'claude-haiku-5-5', 'Anthropic');
    const res = await post({ action: 'seo_description', produktname: 'Testshirt' });
    expect(res.status).toBe(200);
    expect(messagesCreate.mock.calls[0][0]).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 16000, output_config: { effort: 'low' } });
  });

  test('seo_description: abgeschnitten -> 502 mit klarer Meldung und Code', async () => {
    config('seo-text', 'claude-haiku-5-5');
    messagesCreate.mockResolvedValue(antwort('{"kurz', 'max_tokens'));
    const res = await post({ action: 'seo_description', produktname: 'Testshirt' });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: 'ki_abgeschnitten' });
    expect(res.body.error).toMatch(/KI-Antwort abgeschnitten/);
  });

  test('suggest_variants mit Haiku: Anthropic, Denken aus, 1024', async () => {
    config('klassifizierung', 'claude-haiku-5-5');
    messagesCreate.mockResolvedValue(antwort('{ "unusual": ["Farbe=Pink|Größe=5XL"] }'));
    const res = await post({ action: 'suggest_variants', name: 'Testshirt', combos: [{ label: 'Pink 5XL', key: 'Farbe=Pink|Größe=5XL' }] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unusual: ['Farbe=Pink|Größe=5XL'] });
    expect(messagesCreate.mock.calls[0][0]).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 1024, thinking: { type: 'disabled' } });
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });

  test('suggest_variants mit Gemini: weiter ueber Google', async () => {
    config('klassifizierung', 'gemini-3.5-flash-lite');
    generateContent.mockResolvedValue({ response: { text: () => '{ "unusual": [] }', candidates: [{ finishReason: 'STOP' }] } });
    const res = await post({ action: 'suggest_variants', name: 'Testshirt', combos: [{ label: 'a', key: 'k' }] });
    expect(res.status).toBe(200);
    expect(getGenerativeModel).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.5-flash-lite' }));
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  test('suggest_variants ohne Schluessel: 503 mit Modell und Schluesselname', async () => {
    config('klassifizierung', 'claude-haiku-5-5');
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post({ action: 'suggest_variants', name: 'Testshirt', combos: [{ label: 'a', key: 'k' }] });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('claude-haiku-5-5');
    expect(res.body.error).toContain('ANTHROPIC_API_KEY');
  });
});

describe('Spalte C "Anbieter" (modelConfig.js)', () => {
  beforeEach(() => modelConfig.invalidateCache());
  test('passt nicht -> Warnung, Modell-ID gilt trotzdem', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    sheetsGet.mockResolvedValue({ data: { values: [['Schlüssel', 'Wert', 'Anbieter'], ['modell.seo-text', 'claude-haiku-5-5', 'Google']] } });
    expect(await modelConfig.getModel('seo-text')).toBe('claude-haiku-5-5');
    expect(warn.mock.calls.flat().join(' ')).toMatch(/Spalte "Anbieter" \(Google\) passt nicht zu modell.seo-text/);
    warn.mockRestore();
  });
  test('passt -> keine Warnung', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    sheetsGet.mockResolvedValue({ data: { values: [['Schlüssel', 'Wert', 'Anbieter'], ['modell.seo-text', 'claude-haiku-5-5', 'Anthropic']] } });
    await modelConfig.getModel('seo-text');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('Floskeln (seo-pruefung, Regel 7)', () => {
  const lang = t => ({ kurzbeschreibung: '', produktbeschreibung: `<p>${t}</p>` });
  test('Grenzfaelle aus KI1 werden gemeldet', () => {
    expect(pruefeGeneratorText(lang('Jetzt in deiner Größe sichern.'))).toEqual(['Floskel "in deiner Größe sichern" in Produktbeschreibung.']);
    expect(pruefeGeneratorText(lang('Das Shirt ist sofort einsatzbereit.'))).toEqual(['Floskel "sofort einsatzbereit" in Produktbeschreibung.']);
  });
  test('Schreibweisen: Bindestrich/Leerzeichen, Wortanfang Lieblings', () => {
    expect(pruefeGeneratorText(lang('Ein Must have.'))).toHaveLength(1);
    expect(pruefeGeneratorText(lang('Dein Lieblingshoodie.'))).toEqual(['Floskel "Lieblings…" in Produktbeschreibung.']);
  });
  test('normale Kaufaufforderung bleibt frei, Teilwort meldet nicht', () => {
    expect(pruefeGeneratorText(lang('Größe wählen und jetzt bestellen.'))).toEqual([]);
    expect(pruefeGeneratorText(lang('Ein Blickfangmotiv.'))).toEqual([]);
  });
  test('die neuen Wendungen stehen nicht im Systemprompt (Verbote im Prompt landen im Text)', async () => {
    const { SEO_SYSTEM_PROMPT } = await import('../lib/seo-prompt.js');
    expect(FLOSKELN).toEqual(expect.arrayContaining(['in deiner Größe sichern', 'sofort einsatzbereit']));
    expect(SEO_SYSTEM_PROMPT).not.toMatch(/einsatzbereit|in deiner Größe sichern/i);
  });
});
