// GET /api/health/full - Zugang und Kosten.
//
// Der Endpunkt ruft WooCommerce, Sheets UND das Modell auf. Offen und im
// Minutentakt des Dashboards waren das rund 1440 echte Modellaufrufe pro Tag
// und offenem Tab, fuer einen Statuspunkt in der Kopfzeile.

import { jest } from '@jest/globals';

const mockCreate = jest.fn();
const mockWcGet  = jest.fn();
const mockSheetsGet = jest.fn();

jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: class { constructor() { this.messages = { create: mockCreate }; } },
}));

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn(() => ({ spreadsheets: { values: { get: mockSheetsGet } } })) },
}));

jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient:   jest.fn(() => ({ get: mockWcGet })),
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

let request, app, _resetClaudeCache;

beforeAll(async () => {
  process.env.MC_API_KEY = 'geheim';

  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');

  const systemRoutes = await import('../routes/system.js');
  _resetClaudeCache = systemRoutes._resetClaudeCache;
  const { requireApiKey } = await import('../middleware/auth.js');

  // Derselbe Aufbau wie in index.js: erst die Schranke, dann der Router.
  app = express();
  app.use(express.json());
  app.use(requireApiKey);
  app.use('/api/health', systemRoutes.default);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

beforeEach(() => {
  _resetClaudeCache();
  mockCreate.mockReset().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
  mockWcGet.mockReset().mockResolvedValue({ data: {} });
  mockSheetsGet.mockReset().mockResolvedValue({ data: { values: [['x']] } });
});

const hole = key => {
  const r = request(app).get('/api/health/full');
  return key ? r.set('X-API-Key', key) : r;
};

// ── Zugang ──────────────────────────────────────────────────────────────────

describe('Zugang', () => {
  test('ohne API-Key → 401, und es wird nichts aufgerufen', async () => {
    const res = await hole(null);
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockWcGet).not.toHaveBeenCalled();
  });

  test('mit falschem API-Key → 401', async () => {
    expect((await hole('falsch')).status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('mit gueltigem API-Key → 200', async () => {
    const res = await hole('geheim');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── Kosten ──────────────────────────────────────────────────────────────────

describe('Claude-Check wird gehalten', () => {
  test('zweiter Aufruf kostet keinen Modellaufruf', async () => {
    await hole('geheim');
    await hole('geheim');
    await hole('geheim');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // WooCommerce und Sheets bleiben frisch - die kosten kein Token.
    expect(mockWcGet).toHaveBeenCalledTimes(3);
    expect(mockSheetsGet).toHaveBeenCalledTimes(3);
  });

  test('gehaltenes Ergebnis ist als solches gekennzeichnet', async () => {
    await hole('geheim');
    const res = await hole('geheim');
    expect(res.body.services.claude.cached).toBe(true);
  });

  test('ein Fehler wird kuerzer gehalten als ein Erfolg', async () => {
    const echt = Date.now;
    let jetzt = 1_700_000_000_000;
    Date.now = () => jetzt;
    try {
      mockCreate.mockRejectedValue(new Error('overloaded'));
      const res = await hole('geheim');
      expect(res.status).toBe(503);
      expect(res.body.services.claude.ok).toBe(false);

      jetzt += 30 * 1000;                       // innerhalb der Fehler-TTL
      await hole('geheim');
      expect(mockCreate).toHaveBeenCalledTimes(1);

      jetzt += 40 * 1000;                       // Fehler-TTL (60 s) abgelaufen
      mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
      const erholt = await hole('geheim');
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(erholt.body.services.claude.ok).toBe(true);
    } finally { Date.now = echt; }
  });

  test('nach Ablauf der Erfolgs-TTL wird neu geprueft', async () => {
    const echt = Date.now;
    let jetzt = 1_700_000_000_000;
    Date.now = () => jetzt;
    try {
      await hole('geheim');
      jetzt += 9 * 60 * 1000;
      await hole('geheim');
      expect(mockCreate).toHaveBeenCalledTimes(1);
      jetzt += 2 * 60 * 1000;                   // > 10 min
      await hole('geheim');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    } finally { Date.now = echt; }
  });
});
