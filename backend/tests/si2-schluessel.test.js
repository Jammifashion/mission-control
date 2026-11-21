// SI2: drei API-Schluessel (Inhaber, Nicole, Automatik), je einzeln widerrufbar, keine Rechte-Unterschiede.
// Fehlende Secrets werden uebersprungen; der Name geht nur ins Log. Workflows nehmen den Automatik-Schluessel,
// solange er fehlt den alten.

import { jest } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

jest.unstable_mockModule('../utils/secrets.js', () => ({
  SECRET_KEYS: [],
  getSecret: jest.fn(async key => {
    if (key === 'MC_API_KEY_WIRFT') throw new Error('NOT_FOUND');
    return process.env[key] ?? '';
  }),
  loadAllSecrets: jest.fn(),
}));

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(backend, '..');

let request, express, requireApiKey, apiSchluesselName, API_SCHLUESSEL, fehlerKurz;

beforeAll(async () => {
  ({ default: request } = await import('supertest'));
  ({ default: express } = await import('express'));
  ({ requireApiKey, apiSchluesselName, API_SCHLUESSEL } = await import('../middleware/auth.js'));
  ({ fehlerKurz } = await import('../middleware/fehlerHandler.js'));
});

const NAMEN = ['MC_API_KEY', 'MC_API_KEY_NICOLE', 'MC_API_KEY_AUTOMATION'];
afterEach(() => { for (const n of NAMEN) delete process.env[n]; });

describe('Schluessel-Liste', () => {
  test('genau drei Eintraege mit festen Namen', () => {
    expect(API_SCHLUESSEL).toEqual([
      { secret: 'MC_API_KEY', name: 'inhaber' },
      { secret: 'MC_API_KEY_NICOLE', name: 'nicole' },
      { secret: 'MC_API_KEY_AUTOMATION', name: 'automation' },
    ]);
  });

  test('jeder Schluessel oeffnet und liefert seinen Namen', async () => {
    process.env.MC_API_KEY = 'k-inhaber';
    process.env.MC_API_KEY_NICOLE = 'k-nicole';
    process.env.MC_API_KEY_AUTOMATION = 'k-auto';
    expect(await apiSchluesselName('k-inhaber')).toBe('inhaber');
    expect(await apiSchluesselName('k-nicole')).toBe('nicole');
    expect(await apiSchluesselName('k-auto')).toBe('automation');
    expect(await apiSchluesselName('k-fremd')).toBeNull();
    expect(await apiSchluesselName(undefined)).toBeNull();
    expect(await apiSchluesselName('')).toBeNull();
  });

  test('fehlende Secrets werden uebersprungen (nur der alte Schluessel da)', async () => {
    process.env.MC_API_KEY = 'k-inhaber';
    expect(await apiSchluesselName('k-inhaber')).toBe('inhaber');
    expect(await apiSchluesselName('')).toBeNull();   // leeres Secret oeffnet nie
  });

  test('widerrufen = Secret leer: dieser Schluessel geht nicht mehr, die anderen schon', async () => {
    process.env.MC_API_KEY = 'k-inhaber';
    process.env.MC_API_KEY_NICOLE = '';
    expect(await apiSchluesselName('k-inhaber')).toBe('inhaber');
    expect(await apiSchluesselName('')).toBeNull();
  });
});

describe('requireApiKey mit drei Schluesseln', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(requireApiKey);
    app.get('/x', (req, res) => res.json({ wer: req.mcSchluessel }));
  });

  test('Nicole und Automatik kommen durch, falscher Schluessel 401', async () => {
    process.env.MC_API_KEY = 'k-inhaber';
    process.env.MC_API_KEY_NICOLE = 'k-nicole';
    process.env.MC_API_KEY_AUTOMATION = 'k-auto';
    expect((await request(app).get('/x').set('X-API-Key', 'k-nicole')).body).toEqual({ wer: 'nicole' });
    expect((await request(app).get('/x').set('X-API-Key', 'k-auto')).body).toEqual({ wer: 'automation' });
    expect((await request(app).get('/x').set('X-API-Key', 'k-nicolE')).status).toBe(401);
  });

  test('Log-Kurzform traegt nur den Namen, nie den Schluessel', () => {
    const k = fehlerKurz(new Error('x'), { method: 'GET', baseUrl: '/api', path: '/y', mcSchluessel: 'nicole',
      headers: { 'x-api-key': 'k-nicole' } });
    expect(k.wer).toBe('nicole');
    expect(JSON.stringify(k)).not.toContain('k-nicole');
  });
});

describe('Quelltext', () => {
  test('Partner-Sync-Routen nutzen die Liste', () => {
    const pp = readFileSync(resolve(backend, 'routes/partnerPortal.js'), 'utf8');
    expect(pp).not.toMatch(/process\.env\.MC_API_KEY\b/);
  });

  test('Workflows: Automatik-Schluessel mit Rueckfall auf den alten, nie nur der alte', () => {
    const dir = resolve(repo, '.github/workflows');
    let gesehen = 0;
    for (const f of readdirSync(dir).filter(n => n.endsWith('.yml'))) {
      const q = readFileSync(resolve(dir, f), 'utf8');
      for (const zeile of q.split('\n').filter(z => z.includes('secrets.MC_API_KEY'))) {
        gesehen++;
        expect(`${f}: ${zeile.trim()}`).toMatch(/secrets\.MC_API_KEY_AUTOMATION \|\| secrets\.MC_API_KEY \}\}/);
      }
    }
    expect(gesehen).toBeGreaterThan(5);
  });
});

describe('GET /api/system/wer', () => {
  test('liefert nur den Namen des Schluessels, no-store; falscher Schluessel 401 schon in requireApiKey', async () => {
    const { default: system } = await import('../routes/system.js');
    const app = express();
    app.use(requireApiKey);
    app.use('/api/system', system);
    process.env.MC_API_KEY = 'k-inhaber';
    process.env.MC_API_KEY_NICOLE = 'k-nicole';
    const r = await request(app).get('/api/system/wer').set('X-API-Key', 'k-nicole');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ wer: 'nicole' });
    expect(r.headers['cache-control']).toBe('no-store');
    expect((await request(app).get('/api/system/wer').set('X-API-Key', 'falsch')).status).toBe(401);
  }, 60000);
});
