// CS1 – Cloud Scheduler ruft den L-Shop-Korb-Abgleich mit einem OIDC-Token auf.
// Geprueft: Middleware requireSchedulerOidc (Audience, Dienstkonto, email_verified,
// Ablauf, fehlendes Token), Route POST /api/intern/lshop-korb/abgleich (kein
// Trockenlauf, Body ignoriert, Sperre -> 200 "uebersprungen") und dass der
// API-Key-Weg unveraendert bleibt. Kein Token und kein Body im Log.

import { jest } from '@jest/globals';

const verifyIdToken = jest.fn();
jest.unstable_mockModule('googleapis', () => ({
  google: { auth: { OAuth2: class { verifyIdToken(...a) { return verifyIdToken(...a); } } } },
}));

const BESCHAEFTIGT = 'Der Warenkorb wird gerade aktualisiert (Abgleich läuft) - bitte gleich noch einmal.';
const runKorbAbgleich = jest.fn();
jest.unstable_mockModule('../lib/lshopKorb.js', () => ({
  runKorbAbgleich, BESCHAEFTIGT,
  leseKorb: jest.fn(), setzeStatus: jest.fn(), sucheLShopModelle: jest.fn(),
  lshopModellVarianten: jest.fn(), legeEigenePositionAn: jest.fn(),
  mitKorbSperre: jest.fn(),   // BO4a: lib/lshopEdi.js (ueber routes/bestellen.js) braucht den Export
}));

const notifyFehler = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('../lib/chatNotify.js', () => ({ notifyFehler }));

const AUD   = 'https://backend.example/api/intern/lshop-korb/abgleich';
const KONTO = 'korb-scheduler@projekt.iam.gserviceaccount.com';
const TOKEN = 'eyJ.geheimes-test-token.sig';
const PFAD  = '/api/intern/lshop-korb/abgleich';

const ticket = payload => ({ getPayload: () => payload });
const gueltig = (extra = {}) => ticket({ aud: AUD, email: KONTO, email_verified: true, iss: 'https://accounts.google.com', ...extra });

let request, app, logs;

beforeAll(async () => {
  process.env.SCHEDULER_AUDIENCE = AUD;
  process.env.SCHEDULER_SA_EMAIL = KONTO;
  process.env.MC_API_KEY = 'test-api-key';

  const { default: supertest } = await import('supertest');
  const { default: express } = await import('express');
  const { requireApiKey } = await import('../middleware/auth.js');
  const { default: internRouter } = await import('../routes/intern.js');
  const { default: bestellenRouter } = await import('../routes/bestellen.js');

  // Reihenfolge wie index.js: /api/intern vor requireApiKey.
  app = express();
  app.use(express.json());
  app.use('/api/intern', internRouter);
  app.use(requireApiKey);
  app.use('/api/bestellen', bestellenRouter);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  request = () => supertest(app);
});

beforeEach(() => {
  verifyIdToken.mockReset();
  runKorbAbgleich.mockReset().mockResolvedValue({ ok: true, lauf: 'CS-x', vorhanden: 3, shops: {}, schreiben: {} });
  notifyFehler.mockClear();
  logs = [];
  for (const art of ['log', 'warn', 'error']) {
    jest.spyOn(console, art).mockImplementation((...a) => { logs.push(a.join(' ')); });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
  // Kein Token und kein Body darf je im Log stehen.
  const alles = logs.join('\n');
  expect(alles).not.toContain(TOKEN);
  expect(alles).not.toContain('dryRun":true');
  expect(alles).not.toContain('test-api-key');
});

const post = (kopf = `Bearer ${TOKEN}`) => {
  const r = request().post(PFAD).send({ dryRun: true, quelle: 'knopf', laufId: 'X' });
  return kopf ? r.set('Authorization', kopf) : r;
};

describe('requireSchedulerOidc', () => {
  test('gueltiges Token: Abgleich laeuft, verifyIdToken mit der Audience aus der Umgebung', async () => {
    verifyIdToken.mockResolvedValue(gueltig());
    const res = await post();
    expect(res.status).toBe(200);
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: TOKEN, audience: AUD });
    expect(runKorbAbgleich).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['falsche Audience', () => gueltig({ aud: 'https://backend.example/api/anderes' })],
    ['falsches Dienstkonto', () => gueltig({ email: 'fremd@projekt.iam.gserviceaccount.com' })],
    ['email_verified false', () => gueltig({ email_verified: false })],
    ['email_verified fehlt', () => gueltig({ email_verified: undefined })],
  ])('%s -> 401 ohne Details, kein Abgleich', async (_name, payload) => {
    verifyIdToken.mockResolvedValue(payload());
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(runKorbAbgleich).not.toHaveBeenCalled();
  });

  test('abgelaufenes oder falsch signiertes Token (verifyIdToken wirft) -> 401', async () => {
    verifyIdToken.mockRejectedValue(new Error(`Token used too late, ${TOKEN}`));
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(runKorbAbgleich).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Scheduler-Anmeldung abgelehnt');
    expect(logs.join('\n')).toContain(PFAD);
  });

  test.each([
    ['fehlender Kopf', null],
    ['kein Bearer', `Basic ${TOKEN}`],
    ['leeres Bearer', 'Bearer '],
  ])('%s -> 401, verifyIdToken nicht aufgerufen', async (_name, kopf) => {
    const res = await post(kopf);
    expect(res.status).toBe(401);
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(runKorbAbgleich).not.toHaveBeenCalled();
  });

  test('MC_API_KEY allein oeffnet /api/intern nicht', async () => {
    const res = await request().post(PFAD).set('X-API-Key', 'test-api-key').send({});
    expect(res.status).toBe(401);
    expect(runKorbAbgleich).not.toHaveBeenCalled();
  });
});

describe('POST /api/intern/lshop-korb/abgleich', () => {
  beforeEach(() => verifyIdToken.mockResolvedValue(gueltig()));

  test('ruft den Abgleich ohne Trockenlauf auf, Body wird ignoriert', async () => {
    await post();
    const [o] = runKorbAbgleich.mock.calls[0];
    expect(o).toEqual({ dryRun: false, quelle: 'scheduler', laufId: expect.stringMatching(/^CS-\d{4}-\d\d-\d\dT\d\d:\d\dZ$/) });
  });

  test('Sperre (409 laeuft schon) -> 200 uebersprungen, keine Chat-Meldung', async () => {
    runKorbAbgleich.mockRejectedValue(Object.assign(new Error(BESCHAEFTIGT), { status: 409 }));
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ uebersprungen: 'läuft schon' });
    expect(notifyFehler).not.toHaveBeenCalled();
  });

  test('anderes 409 (Zielzeilen belegt) bleibt 409', async () => {
    runKorbAbgleich.mockRejectedValue(Object.assign(new Error('Zielzeilen sind nicht leer'), { status: 409 }));
    const res = await post();
    expect(res.status).toBe(409);
    expect(notifyFehler).not.toHaveBeenCalled();
  });

  test('5xx bleibt 5xx und meldet im Chat', async () => {
    runKorbAbgleich.mockRejectedValue(Object.assign(new Error('Sheets weg'), { status: 502 }));
    const res = await post();
    expect(res.status).toBe(502);
    expect(notifyFehler).toHaveBeenCalledWith(expect.objectContaining({ art: 'L-Shop-Korb-Abgleich', status: 502 }));
  });

  test('503 Hoster-Pruefseite bleibt 503, ohne eigene Chat-Meldung', async () => {
    runKorbAbgleich.mockRejectedValue(Object.assign(new Error('Pruefseite'), { status: 503, code: 'hoster_pruefseite' }));
    const res = await post();
    expect(res.status).toBe(503);
    expect(notifyFehler).not.toHaveBeenCalled();
  });
});

describe('API-Key-Weg unveraendert', () => {
  test('POST /api/bestellen/lshop-korb/abgleich mit X-API-Key nimmt dryRun/quelle/laufId aus dem Body', async () => {
    const res = await request().post('/api/bestellen/lshop-korb/abgleich')
      .set('X-API-Key', 'test-api-key').send({ dryRun: true, quelle: 'workflow', laufId: 'GH-1' });
    expect(res.status).toBe(200);
    expect(runKorbAbgleich).toHaveBeenCalledWith({ dryRun: true, quelle: 'workflow', laufId: 'GH-1' });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  test('ohne X-API-Key weiter 401, ein Scheduler-Token oeffnet den Admin-Weg nicht', async () => {
    verifyIdToken.mockResolvedValue(gueltig());
    const res = await request().post('/api/bestellen/lshop-korb/abgleich')
      .set('Authorization', `Bearer ${TOKEN}`).send({});
    expect(res.status).toBe(401);
    expect(runKorbAbgleich).not.toHaveBeenCalled();
  });
});
