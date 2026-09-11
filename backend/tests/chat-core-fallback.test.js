// callChatAgent: Verhalten, wenn das Modell die JSON-Huelle weglaesst.
//
// Sonnet 5 denkt adaptiv. Stellt es der Antwort einen thinking-Block voran,
// kommt die Antwort gelegentlich als reiner Fliesstext zurueck - inhaltlich
// richtig, nur nicht im geforderten Format. Das war ein harter 502; der Kunde
// sah einen Fehler statt einer brauchbaren Antwort.

import { jest } from '@jest/globals';

const mockCreate = jest.fn();

jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() { this.messages = { create: mockCreate }; }
  },
}));

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn(() => ({ spreadsheets: { values: {
    get: jest.fn().mockResolvedValue({ data: { values: [] } }),
  } } })) },
}));

jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule('../lib/modelConfig.js', () => ({
  getModel: jest.fn().mockResolvedValue('claude-sonnet-5'),
}));

let callChatAgent;

beforeAll(async () => {
  ({ callChatAgent } = await import('../lib/chatCore.js'));
});

beforeEach(() => {
  mockCreate.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

// content-Bloecke wie sie die API liefert
const antwort = (...bloecke) => ({ content: bloecke });
const text    = t => ({ type: 'text', text: t });
const denken  = () => ({ type: 'thinking', thinking: '...' });

const ruf = (sessionData = {}) => callChatAgent({
  messages: [{ role: 'user', content: 'Wie lange dauert der Versand?' }],
  sessionData, kbBase: 'Wissen.', history: [],
});

describe('Antwort ohne JSON-Huelle (thinking-Block vorangestellt)', () => {
  const PROSA = 'Standard sind bei uns **7–10 Werktage**. Der Grund: wir produzieren erst nach Bestelleingang.';

  test('Fliesstext wird als reply durchgereicht statt 502', async () => {
    mockCreate.mockResolvedValue(antwort(denken(), text(PROSA)));
    const res = await ruf({ step: 1, kanal: 'Homepage' });
    expect(res.reply).toBe(PROSA);
    expect(res.completed).toBe(false);
  });

  test('sessionData bleibt unveraendert', async () => {
    mockCreate.mockResolvedValue(antwort(denken(), text(PROSA)));
    const vorher = { step: 4, kundeName: 'Max Muster', menge: '30', kanal: 'Homepage' };
    const res = await ruf(vorher);
    expect(res.sessionData).toEqual(vorher);
  });

  test('fehlendes kanal wird wie im Normalfall ergaenzt', async () => {
    mockCreate.mockResolvedValue(antwort(text(PROSA)));
    const res = await ruf({ step: 2 });
    expect(res.sessionData).toEqual({ kanal: 'Homepage', step: 2 });
  });

  test('warnt mit Praefix [chat-fallback]', async () => {
    mockCreate.mockResolvedValue(antwort(denken(), text(PROSA)));
    await ruf();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[chat-fallback]'));
    // Kein Fehler-Log: das ist der geordnete Weg, nicht der Ausnahmefall.
    expect(console.error).not.toHaveBeenCalled();
  });

  test('auch mit Markdown-Zaun um den Fliesstext', async () => {
    mockCreate.mockResolvedValue(antwort(text('```\n' + PROSA + '\n```')));
    const res = await ruf();
    expect(res.reply).toBe(PROSA);
  });
});

describe('weiterhin 502', () => {
  test('leere Antwort', async () => {
    mockCreate.mockResolvedValue(antwort(denken()));
    await expect(ruf()).rejects.toMatchObject({ status: 502 });
  });

  test('nur Leerzeichen', async () => {
    mockCreate.mockResolvedValue(antwort(text('   \n  ')));
    await expect(ruf()).rejects.toMatchObject({ status: 502 });
  });

  // Kaputtes JSON ist kein Fliesstext: Bruchstuecke wie '{"reply": "Hallo...'
  // gehoeren nicht in ein Kundenfenster.
  test('abgeschnittenes JSON wird nicht als Text durchgereicht', async () => {
    mockCreate.mockResolvedValue(antwort(text('{"reply": "Moin, ich bin Jey und')));
    await expect(ruf()).rejects.toMatchObject({ status: 502 });
    expect(console.error).toHaveBeenCalled();
  });

  test('JSON ohne reply-Feld', async () => {
    mockCreate.mockResolvedValue(antwort(text('{"sessionData":{"step":2},"completed":false}')));
    await expect(ruf()).rejects.toMatchObject({ status: 502 });
  });
});

describe('Normalfall bleibt unveraendert', () => {
  test('gueltiges JSON wird geparst und sessionData zusammengefuehrt', async () => {
    mockCreate.mockResolvedValue(antwort(text(JSON.stringify({
      reply: 'Moin!',
      sessionData: { step: 2, menge: '30' },
      completed: false,
    }))));
    const res = await ruf({ step: 1, kundeName: 'Max' });
    expect(res.reply).toBe('Moin!');
    expect(res.sessionData).toEqual({ kanal: 'Homepage', step: 2, kundeName: 'Max', menge: '30' });
    expect(console.warn).not.toHaveBeenCalled();
  });

  test('completed wird durchgereicht', async () => {
    mockCreate.mockResolvedValue(antwort(text(JSON.stringify({
      reply: 'Danke!', sessionData: {}, completed: true,
    }))));
    expect((await ruf()).completed).toBe(true);
  });
});
