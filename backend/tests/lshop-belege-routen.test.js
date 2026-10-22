// BO4b-1: Routen des Beleg-Abrufs. Scheduler-Weg POST /api/intern/lshop-belege/abruf (OIDC wie CS1,
// Body ignoriert, Sperre -> 200 uebersprungen, FTP-Fehler = 200, 5xx bleibt 5xx mit Chat) und
// Knopf-Weg POST /api/bestellen/lshop-belege/abruf (API-Key, dryRun nur bei true). Frontend-Block.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const verifyIdToken = jest.fn();
jest.unstable_mockModule('googleapis', () => ({
  google: { auth: { OAuth2: class { verifyIdToken(...a) { return verifyIdToken(...a); } } } },
}));

const BELEGE_BESCHAEFTIGT = 'Der Beleg-Abruf läuft gerade - bitte gleich noch einmal.';
const runBelegeAbruf = jest.fn();
jest.unstable_mockModule('../lib/lshopBelege.js', () => ({ runBelegeAbruf, BELEGE_BESCHAEFTIGT }));
jest.unstable_mockModule('../lib/lshopKorb.js', () => ({ runKorbAbgleich: jest.fn(), BESCHAEFTIGT: 'x' }));
const notifyFehler = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('../lib/chatNotify.js', () => ({ notifyFehler, notify: jest.fn() }));

const AUD = 'https://backend.example/api/intern/lshop-korb/abgleich';   // dieselbe Audience wie CS1
const KONTO = 'korb-scheduler@projekt.iam.gserviceaccount.com';
const PFAD = '/api/intern/lshop-belege/abruf';
const ok = { lauf: 'BA-x', dryRun: false, ftp: 'ok', ordner: {}, neueZeilen: 0, alarme: [], abErkannt: [] };

let request;
beforeAll(async () => {
  process.env.SCHEDULER_AUDIENCE = AUD;
  process.env.SCHEDULER_SA_EMAIL = KONTO;
  process.env.MC_API_KEY = 'test-api-key';
  const { default: supertest } = await import('supertest');
  const { default: express } = await import('express');
  const { requireApiKey } = await import('../middleware/auth.js');
  const { default: internRouter } = await import('../routes/intern.js');
  const { default: lshopBelegeRouter } = await import('../routes/lshopBelege.js');
  const app = express();
  app.use(express.json());
  app.use('/api/intern', internRouter);
  app.use(requireApiKey);
  app.use('/api/bestellen/lshop-belege', lshopBelegeRouter);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  request = () => supertest(app);
});

beforeEach(() => {
  verifyIdToken.mockReset().mockResolvedValue({ getPayload: () => ({ aud: AUD, email: KONTO, email_verified: true }) });
  runBelegeAbruf.mockReset().mockResolvedValue(ok);
  notifyFehler.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const post = () => request().post(PFAD).set('Authorization', 'Bearer t').send({ dryRun: true });

describe('POST /api/intern/lshop-belege/abruf', () => {
  test('ohne Token 401, MC_API_KEY oeffnet nicht', async () => {
    expect((await request().post(PFAD).send({})).status).toBe(401);
    expect((await request().post(PFAD).set('X-API-Key', 'test-api-key').send({})).status).toBe(401);
    expect(runBelegeAbruf).not.toHaveBeenCalled();
  });

  test('ruft ohne Trockenlauf auf, Body ignoriert, Lauf-ID BA-<Zeit>', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(runBelegeAbruf).toHaveBeenCalledWith({ dryRun: false, quelle: 'scheduler', laufId: expect.stringMatching(/^BA-\d{4}-\d\d-\d\dT\d\d:\d\dZ$/) });
  });

  test('FTP-Fehler ist 200 (Zaehlung im Reiter), kein Chat von der Route', async () => {
    runBelegeAbruf.mockResolvedValue({ lauf: 'BA-x', ftp: 'fehler', grund: 'FTP: ETIMEDOUT', inFolge: 1, gemeldet: false });
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.ftp).toBe('fehler');
    expect(notifyFehler).not.toHaveBeenCalled();
  });

  test('Sperre -> 200 uebersprungen; 5xx bleibt 5xx mit Chat', async () => {
    runBelegeAbruf.mockRejectedValueOnce(Object.assign(new Error(BELEGE_BESCHAEFTIGT), { status: 409 }));
    const r1 = await post();
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ uebersprungen: 'läuft schon' });
    runBelegeAbruf.mockRejectedValueOnce(Object.assign(new Error('Sheets weg'), { status: 500 }));
    const r2 = await post();
    expect(r2.status).toBe(500);
    expect(notifyFehler).toHaveBeenCalledWith(expect.objectContaining({ art: 'L-Shop-Belege', status: 500 }));
  });
});

describe('POST /api/bestellen/lshop-belege/abruf (Knopf)', () => {
  test('nur mit X-API-Key; dryRun nur bei true', async () => {
    expect((await request().post('/api/bestellen/lshop-belege/abruf').send({})).status).toBe(401);
    await request().post('/api/bestellen/lshop-belege/abruf').set('X-API-Key', 'test-api-key').send({ dryRun: true });
    await request().post('/api/bestellen/lshop-belege/abruf').set('X-API-Key', 'test-api-key').send({ dryRun: 'ja' });
    expect(runBelegeAbruf.mock.calls.map(c => c[0])).toEqual([{ dryRun: true, quelle: 'knopf' }, { dryRun: false, quelle: 'knopf' }]);
  });
});

describe('Frontend-Block Belege-Abruf', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const block = html.slice(html.indexOf('// Block Belege-Abruf: Anfang'), html.indexOf('// Block Belege-Abruf: Ende'));
  test('Knopf im Korb, ruft nur die eigene Route, kein echter Trockenlauf-Schalter noetig', () => {
    expect(html).toContain('id="korb-belege-btn"');
    expect(block.length).toBeGreaterThan(100);
    const pfade = [...block.matchAll(/\/api\/[\w/-]+/g)].map(m => m[0]);
    expect(pfade).toEqual(['/api/bestellen/lshop-belege/abruf']);
    expect(block).not.toMatch(/ftp:\/\/|LSHOP_/);
  });
});
