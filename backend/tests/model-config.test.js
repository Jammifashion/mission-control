// Tier-2 – getModel() mit gemockten Google-Sheets-Abhängigkeiten.
// Mocks müssen VOR allen dynamischen Imports deklariert werden (ESM-Anforderung).

import { jest } from '@jest/globals';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn() },
}));

jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

let getModel, getModelInfo, invalidateCache, DEFAULT_MODELS, mockValuesGet, google;

const HEADER = ['Schlüssel', 'Wert', 'Anbieter', 'Beschreibung', 'Geändert-Am'];

function sheetResponse(rows) {
  return { data: { values: [HEADER, ...rows] } };
}

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';

  ({ google } = await import('googleapis'));
  mockValuesGet = jest.fn();
  google.sheets.mockReturnValue({ spreadsheets: { values: { get: mockValuesGet } } });

  ({ getModel, getModelInfo, invalidateCache, DEFAULT_MODELS } = await import('../lib/modelConfig.js'));
});

beforeEach(() => {
  invalidateCache();
  mockValuesGet.mockReset();
});

// ── Fall 1: gültiger Sheet-Wert ────────────────────────────────────────────────

describe('getModel – gültiger Sheet-Wert', () => {
  test('übernimmt den Wert aus dem Sheet, wenn er gegen das Modell-Pattern matcht', async () => {
    mockValuesGet.mockResolvedValue(sheetResponse([
      ['modell.chat-kunde', 'claude-opus-5', 'Anthropic', '', '01.01.2026'],
    ]));

    const model = await getModel('chat-kunde');
    expect(model).toBe('claude-opus-5');
  });

  test('akzeptiert auch gemini-Werte', async () => {
    mockValuesGet.mockResolvedValue(sheetResponse([
      ['modell.klassifizierung', 'gemini-3.5-flash-lite', 'Google', '', '01.01.2026'],
    ]));

    const model = await getModel('klassifizierung');
    expect(model).toBe('gemini-3.5-flash-lite');
  });

  test('nachlaufende/führende Leerzeichen im Sheet-Wert werden vor der Validierung getrimmt', async () => {
    mockValuesGet.mockResolvedValue(sheetResponse([
      ['modell.chat-kunde', '  claude-opus-5  ', 'Anthropic', '', '01.01.2026'],
    ]));

    const model = await getModel('chat-kunde');
    expect(model).toBe('claude-opus-5');
  });
});

// ── Fall 2: ungültiges Format im Sheet ─────────────────────────────────────────

describe('getModel – ungültiges Format im Sheet', () => {
  test('fällt auf DEFAULT_MODELS zurück und warnt, wenn der Wert nicht matcht', async () => {
    mockValuesGet.mockResolvedValue(sheetResponse([
      ['modell.chat-kunde', 'gpt-4-turbo', 'OpenAI', '', '01.01.2026'],
    ]));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const model = await getModel('chat-kunde');

    expect(model).toBe(DEFAULT_MODELS['chat-kunde']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('chat-kunde'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('gpt-4-turbo'));
    warnSpy.mockRestore();
  });

  test('leerer Wert im Sheet fällt still auf Default zurück', async () => {
    mockValuesGet.mockResolvedValue(sheetResponse([
      ['modell.seo-text', '', 'Google', '', '01.01.2026'],
    ]));

    const model = await getModel('seo-text');
    expect(model).toBe(DEFAULT_MODELS['seo-text']);
  });
});

// ── Fall 3: unbekannte Rolle ────────────────────────────────────────────────────

describe('getModel – unbekannte Rolle', () => {
  test('gibt niemals undefined zurück, sondern den Fallback-Rolle-Wert', async () => {
    mockValuesGet.mockResolvedValue(sheetResponse([]));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const model = await getModel('voellig-unbekannte-rolle');

    expect(model).toBeDefined();
    expect(model).toBe(DEFAULT_MODELS['agent-intern']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('voellig-unbekannte-rolle'));
    warnSpy.mockRestore();
  });
});

// ── Fall 4: Sheet nicht erreichbar ─────────────────────────────────────────────

describe('getModel – Sheet-Fehler', () => {
  test('wirft nicht, sondern fällt auf DEFAULT_MODELS zurück und warnt', async () => {
    mockValuesGet.mockRejectedValue(new Error('Network timeout'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const model = await getModel('agent-intern');

    expect(model).toBe(DEFAULT_MODELS['agent-intern']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nicht erreichbar'), expect.any(String));
    warnSpy.mockRestore();
  });

  test('fehlende BUSINESS_SHEET_ID fällt ebenfalls auf Default zurück, ohne zu werfen', async () => {
    const prev = process.env.BUSINESS_SHEET_ID;
    delete process.env.BUSINESS_SHEET_ID;

    await expect(getModel('klassifizierung')).resolves.toBe(DEFAULT_MODELS['klassifizierung']);

    process.env.BUSINESS_SHEET_ID = prev;
  });
});

// ── getModelInfo – Quelle mitführen ────────────────────────────────────────────

describe('getModelInfo', () => {
  test('quelle "sheet", wenn ein gültiger Sheet-Wert übernommen wird', async () => {
    mockValuesGet.mockResolvedValue(sheetResponse([
      ['modell.chat-kunde', 'claude-opus-5', 'Anthropic', '', '01.01.2026'],
    ]));

    const info = await getModelInfo('chat-kunde');
    expect(info).toEqual({ rolle: 'chat-kunde', modell: 'claude-opus-5', quelle: 'sheet' });
  });

  test('quelle "fallback", wenn kein Sheet-Eintrag existiert', async () => {
    mockValuesGet.mockResolvedValue(sheetResponse([]));

    const info = await getModelInfo('agent-intern');
    expect(info).toEqual({ rolle: 'agent-intern', modell: DEFAULT_MODELS['agent-intern'], quelle: 'fallback' });
  });

  test('quelle "fallback", wenn der Sheet-Wert ungültig ist', async () => {
    mockValuesGet.mockResolvedValue(sheetResponse([
      ['modell.seo-text', 'gpt-4-turbo', 'OpenAI', '', '01.01.2026'],
    ]));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const info = await getModelInfo('seo-text');
    expect(info).toEqual({ rolle: 'seo-text', modell: DEFAULT_MODELS['seo-text'], quelle: 'fallback' });
    warnSpy.mockRestore();
  });

  test('unbekannte Rolle wird auf die Fallback-Rolle "agent-intern" aufgelöst', async () => {
    mockValuesGet.mockResolvedValue(sheetResponse([]));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const info = await getModelInfo('nicht-deklarierte-rolle');
    expect(info.rolle).toBe('agent-intern');
    expect(info.modell).toBe(DEFAULT_MODELS['agent-intern']);
    expect(info.quelle).toBe('fallback');
    warnSpy.mockRestore();
  });
});
