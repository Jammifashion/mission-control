// BO7-1: Routen der Lieferbarkeit. Scheduler-Weg POST /api/intern/lshop-lieferbarkeit/abruf (OIDC wie CS1, Body
// ignoriert, Sperre -> 200 uebersprungen, FTP-Fehler = 200, 5xx bleibt 5xx mit Chat) und Knopf-Weg
// POST /api/bestellen/lshop-lieferbarkeit/abruf (API-Key, dryRun nur bei true).

import { jest } from '@jest/globals';

const verifyIdToken = jest.fn();
jest.unstable_mockModule('googleapis', () => ({
  google: { auth: { OAuth2: class { verifyIdToken(...a) { return verifyIdToken(...a); } } } },
}));
const LIEFERBARKEIT_BESCHAEFTIGT = 'Die Lieferbarkeit wird gerade abgerufen - bitte gleich noch einmal.';
const runLieferbarkeit = jest.fn();
jest.unstable_mockModule('../lib/lshopLieferbarkeit.js', () => ({ runLieferbarkeit, LIEFERBARKEIT_BESCHAEFTIGT }));
jest.unstable_mockModule('../lib/lshopBelege.js', () => ({ runBelegeAbruf: jest.fn(), BELEGE_BESCHAEFTIGT: 'x' }));
jest.unstable_mockModule('../lib/lshopKorb.js', () => ({ runKorbAbgleich: jest.fn(), BESCHAEFTIGT: 'z' }));
const notifyFehler = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('../lib/chatNotify.js', () => ({ notifyFehler, notify: jest.fn() }));

const AUD = 'https://backend.example/api/intern/lshop-korb/abgleich';   // dieselbe Audience wie CS1
const KONTO = 'korb-scheduler@projekt.iam.gserviceaccount.com';
const PFAD = '/api/intern/lshop-lieferbarkeit/abruf';
const ok = { lauf: 'LB-x', dryRun: false, ftp: 'ok', summen: { nummern: 3, null: 1, nichtGefuehrt: 0, auslauf: 1 }, wechsel: 0, chat: 'nichts zu melden' };

let request;
beforeAll(async () => {
  process.env.SCHEDULER_AUDIENCE = AUD;
  process.env.SCHEDULER_SA_EMAIL = KONTO;
  process.env.MC_API_KEY = 'test-api-key';
  const { default: supertest } = await import('supertest');
  const { default: express } = await import('express');
  const { requireApiKey } = await import('../middleware/auth.js');
  const { default: internRouter } = await import('../routes/intern.js');
  const { default: router } = await import('../routes/lshopLieferbarkeit.js');
  const app = express();
  app.use(express.json());
  app.use('/api/intern', internRouter);
  app.use(requireApiKey);
  app.use('/api/bestellen/lshop-lieferbarkeit', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  request = () => supertest(app);
});
beforeEach(() => {
  verifyIdToken.mockReset().mockResolvedValue({ getPayload: () => ({ aud: AUD, email: KONTO, email_verified: true }) });
  runLieferbarkeit.mockReset().mockResolvedValue(ok);
  notifyFehler.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
const post = () => request().post(PFAD).set('Authorization', 'Bearer t').send({ dryRun: true });

describe('POST /api/intern/lshop-lieferbarkeit/abruf', () => {
  test('ohne Token 401, MC_API_KEY oeffnet nicht', async () => {
    expect((await request().post(PFAD).send({})).status).toBe(401);
    expect((await request().post(PFAD).set('X-API-Key', 'test-api-key').send({})).status).toBe(401);
    expect(runLieferbarkeit).not.toHaveBeenCalled();
  });
  test('ohne Trockenlauf, Body ignoriert, Lauf-ID LB-<Zeit>', async () => {
    expect((await post()).status).toBe(200);
    expect(runLieferbarkeit).toHaveBeenCalledWith({ dryRun: false, quelle: 'scheduler', laufId: expect.stringMatching(/^LB-\d{4}-\d\d-\d\dT\d\d:\d\dZ$/) });
  });
  test('FTP-Fehler 200 ohne Chat; Sperre 200 uebersprungen; 5xx bleibt 5xx mit Chat', async () => {
    runLieferbarkeit.mockResolvedValueOnce({ lauf: 'LB-x', ftp: 'fehler', grund: 'FTP: ETIMEDOUT' });
    expect((await post()).body.ftp).toBe('fehler');
    expect(notifyFehler).not.toHaveBeenCalled();
    runLieferbarkeit.mockRejectedValueOnce(Object.assign(new Error(LIEFERBARKEIT_BESCHAEFTIGT), { status: 409 }));
    const r1 = await post();
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ uebersprungen: 'läuft schon' });
    runLieferbarkeit.mockRejectedValueOnce(Object.assign(new Error('Stand zu alt'), { status: 502 }));
    expect((await post()).status).toBe(502);
    expect(notifyFehler).toHaveBeenCalledWith(expect.objectContaining({ art: 'L-Shop-Lieferbarkeit', status: 502 }));
  });
});

describe('POST /api/bestellen/lshop-lieferbarkeit/abruf (Knopf)', () => {
  test('nur mit X-API-Key; dryRun nur bei true', async () => {
    expect((await request().post('/api/bestellen/lshop-lieferbarkeit/abruf').send({})).status).toBe(401);
    await request().post('/api/bestellen/lshop-lieferbarkeit/abruf').set('X-API-Key', 'test-api-key').send({ dryRun: true });
    await request().post('/api/bestellen/lshop-lieferbarkeit/abruf').set('X-API-Key', 'test-api-key').send({ dryRun: 'ja' });
    expect(runLieferbarkeit.mock.calls.map(c => c[0])).toEqual([{ dryRun: true, quelle: 'knopf' }, { dryRun: false, quelle: 'knopf' }]);
  });
});

describe('Frontend-Block Lieferbarkeit', () => {
  test('Knopf im Korb mit Mouse-over, ruft nur die eigene Route, ohne Trockenlauf', async () => {
    const { readFileSync } = await import('fs');
    const { resolve, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
    const block = html.slice(html.indexOf('// Block Lieferbarkeit: Anfang'), html.indexOf('// Block Lieferbarkeit: Ende'));
    expect(html).toContain('id="korb-lieferbarkeit-btn" type="button" data-hilfe="lieferbarkeit"');
    expect(html).toMatch(/'lieferbarkeit':\s+\{ name: '📦 Lieferbarkeit jetzt'/);
    expect([...block.matchAll(/\/api\/[\w/-]+/g)].map(m => m[0])).toEqual(['/api/bestellen/lshop-lieferbarkeit/abruf']);
    expect(block).toContain('JSON.stringify({ dryRun: false })');
    expect(block).not.toMatch(/ftp:\/\/|LSHOP_/);
  });
});
