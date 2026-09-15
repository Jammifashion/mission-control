// Modell-Check: runCheck() liefert ein Ergebnisobjekt, POST /api/system/modell-check
// uebersetzt es in HTTP-Status. Der Workflow ruft nur noch den Endpunkt per curl -
// das Dienstkonto mit GOOGLE_CREDENTIALS_JSON hat seit 2026-09-15 keinen Zugriff.

import { jest } from '@jest/globals';

jest.unstable_mockModule('dotenv', () => ({
  default: { config: jest.fn() },
  config: jest.fn(),
}));

const mockValuesGet  = jest.fn();
const mockModelsList = jest.fn();

jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = { create: jest.fn() };
      this.models   = { list: mockModelsList };
    }
  },
}));

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn(() => ({ spreadsheets: { values: { get: mockValuesGet } } })) },
}));

jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient:   jest.fn(),
  getShopConfig: jest.fn(() => ({ shop: 'jfn' })),
  normalizeShop: jest.fn(s => s ?? 'jfn'),
}));

jest.unstable_mockModule('../lib/modelConfig.js', () => ({
  getModel: jest.fn().mockResolvedValue('claude-sonnet-5'),
}));

jest.unstable_mockModule('../utils/secrets.js', () => ({
  SECRET_KEYS: [],
  getSecret:   jest.fn(async key => process.env[key] ?? ''),
  loadAllSecrets: jest.fn(),
}));

const CONFIG = [
  ['Schlüssel', 'Wert', 'Beschreibung'],
  ['modell.chat-kunde',      'claude-sonnet-5'],
  ['modell.seo-text',        'claude-opus-5'],
  ['modell.klassifizierung', 'gemini-2.5-flash'],
];

const liveModels = ids => () => (async function* () {
  for (const id of ids) yield { id, display_name: id };
})();

let request, app, runCheck;

beforeAll(async () => {
  process.env.MC_API_KEY        = 'geheim';
  process.env.BUSINESS_SHEET_ID = 'business-id';
  process.env.ANTHROPIC_API_KEY = 'sk-test';

  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');

  ({ runCheck } = await import('../scripts/check-models.js'));
  const systemRoutes = await import('../routes/system.js');
  const { requireApiKey } = await import('../middleware/auth.js');

  // Aufbau wie in index.js: erst die Schranke, dann der Router.
  app = express();
  app.use(express.json());
  app.use(requireApiKey);
  app.use('/api/system', systemRoutes.default);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  mockValuesGet.mockReset().mockResolvedValue({ data: { values: CONFIG } });
  mockModelsList.mockReset().mockImplementation(
    liveModels(['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5-1']),
  );
});

afterEach(() => jest.restoreAllMocks());

const post = () => request(app).post('/api/system/modell-check').set('X-API-Key', 'geheim');

describe('runCheck() Ergebnisobjekt', () => {
  test('alles gueltig', async () => {
    const r = await runCheck();
    expect(r).toEqual({
      geprueft: 2,
      gueltig: [
        { rolle: 'chat-kunde', modell: 'claude-sonnet-5' },
        { rolle: 'seo-text',   modell: 'claude-opus-5' },
      ],
      fehlend: [],
      neu: ['claude-fable-5-1'],
    });
  });

  test('fehlendes Modell landet in fehlend[]', async () => {
    mockModelsList.mockImplementation(liveModels(['claude-sonnet-5']));
    const r = await runCheck();
    expect(r.fehlend).toEqual([{ rolle: 'seo-text', modell: 'claude-opus-5' }]);
    expect(r.gueltig).toHaveLength(1);
  });

  test('keine modell.*-Zeilen → leeres Ergebnis', async () => {
    mockValuesGet.mockResolvedValue({ data: { values: [['Schlüssel', 'Wert']] } });
    expect(await runCheck()).toEqual({ geprueft: 0, gueltig: [], fehlend: [], neu: [] });
  });

  test('Konsolenausgabe bleibt', async () => {
    await runCheck();
    const text = console.log.mock.calls.map(c => c.join(' ')).join('\n');
    expect(text).toContain('Modell-Check (Anthropic)');
    expect(text).toContain('Zusammenfassung: 2/2');
  });
});

describe('POST /api/system/modell-check', () => {
  test('ohne API-Key → 401, kein Sheet-Zugriff', async () => {
    const res = await request(app).post('/api/system/modell-check');
    expect(res.status).toBe(401);
    expect(mockValuesGet).not.toHaveBeenCalled();
  });

  test('alles gueltig → 200', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, geprueft: 2, fehlend: [], neu: ['claude-fable-5-1'] });
  });

  test('Modell fehlt → 422 mit fehlend[]', async () => {
    mockModelsList.mockImplementation(liveModels(['claude-sonnet-5']));
    const res = await post();
    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(res.body.fehlend).toEqual([{ rolle: 'seo-text', modell: 'claude-opus-5' }]);
  });

  test('Sheet-Fehler → 500', async () => {
    mockValuesGet.mockRejectedValue(new Error('The caller does not have permission'));
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/permission/);
  });

  test('Models-API-Fehler → 500', async () => {
    mockModelsList.mockImplementation(() => { throw new Error('401 invalid x-api-key'); });
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Anthropic Models API nicht erreichbar/);
  });
});
