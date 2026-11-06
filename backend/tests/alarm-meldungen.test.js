// AL1: Ein Ereignis = eine Meldung. Endet ein geplanter Lauf (oder der Korb-Abgleich per Knopf) mit
// Shop-Zeitueberschreitung oder Hoster-Pruefseite, meldet NUR die Middleware (eigener Titel mit der Ursache);
// die Route schickt keine zweite "Stoerung". Andere 5xx melden die Routen wie bisher, Titel "Störung".

import { jest } from '@jest/globals';

const verifyIdToken = jest.fn();
jest.unstable_mockModule('googleapis', () => ({
  google: { auth: { OAuth2: class { verifyIdToken(...a) { return verifyIdToken(...a); } } } },
}));

const runKorbAbgleich = jest.fn(), runBelegeAbruf = jest.fn(), runLieferbarkeit = jest.fn();
jest.unstable_mockModule('../lib/lshopKorb.js', () => ({
  runKorbAbgleich, BESCHAEFTIGT: 'korb-beschaeftigt',
  leseKorb: jest.fn(), setzeStatus: jest.fn(), sucheLShopModelle: jest.fn(),
  lshopModellVarianten: jest.fn(), legeEigenePositionAn: jest.fn(), legeEigenePositionenAn: jest.fn(), bearbeiteEigenePosition: jest.fn(),
  mitKorbSperre: jest.fn(), ladeKontext: jest.fn(), ladeProdukte: jest.fn(), leseEk: jest.fn(), leseStaffel: jest.fn(),
}));
jest.unstable_mockModule('../lib/lshopBelege.js', () => ({ runBelegeAbruf, BELEGE_BESCHAEFTIGT: 'belege-beschaeftigt', reiter: jest.fn(), haengeAn: jest.fn(), legeReiterAn: jest.fn() }));
jest.unstable_mockModule('../lib/lshopLieferbarkeit.js', () => ({ runLieferbarkeit, LIEFERBARKEIT_BESCHAEFTIGT: 'lb-beschaeftigt' }));

const notifyFehler = jest.fn().mockResolvedValue(true);
const notifyShopZeitueberschreitung = jest.fn().mockResolvedValue(true);
const notifyHosterPruefseite = jest.fn().mockResolvedValue(true);
jest.unstable_mockModule('../lib/chatNotify.js', () => ({ notifyFehler, notifyShopZeitueberschreitung, notifyHosterPruefseite, notify: jest.fn() }));

const { ShopZeitueberschreitungError, HosterPruefseiteError } = await import('../lib/hosterPruefseite.js');

const AUD = 'https://backend.example/api/intern/lshop-korb/abgleich';
const KONTO = 'korb-scheduler@projekt.iam.gserviceaccount.com';
let request;

beforeAll(async () => {
  process.env.SCHEDULER_AUDIENCE = AUD;
  process.env.SCHEDULER_SA_EMAIL = KONTO;
  process.env.MC_API_KEY = 'test-api-key';
  const { default: supertest } = await import('supertest');
  const { default: express } = await import('express');
  const { requireApiKey } = await import('../middleware/auth.js');
  const { hosterPruefseiteHandler } = await import('../middleware/hosterPruefseite.js');
  const { default: internRouter } = await import('../routes/intern.js');
  const { default: bestellenRouter } = await import('../routes/bestellen.js');
  // Reihenfolge wie index.js: /api/intern vor requireApiKey, Laufstopp-Handler vor dem allgemeinen.
  const app = express();
  app.use(express.json());
  app.use('/api/intern', internRouter);
  app.use(requireApiKey);
  app.use('/api/bestellen', bestellenRouter);
  app.use(hosterPruefseiteHandler);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  request = () => supertest(app);
});

beforeEach(() => {
  verifyIdToken.mockReset().mockResolvedValue({ getPayload: () => ({ aud: AUD, email: KONTO, email_verified: true, iss: 'https://accounts.google.com' }) });
  for (const f of [runKorbAbgleich, runBelegeAbruf, runLieferbarkeit]) f.mockReset();
  for (const f of [notifyFehler, notifyShopZeitueberschreitung, notifyHosterPruefseite]) f.mockClear();
  for (const art of ['log', 'warn', 'error']) jest.spyOn(console, art).mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const WEGE = [
  { name: 'Scheduler Korb-Abgleich', lauf: runKorbAbgleich, art: 'L-Shop-Korb-Abgleich', post: () => request().post('/api/intern/lshop-korb/abgleich').set('Authorization', 'Bearer t').send({}) },
  { name: 'Scheduler Belege', lauf: runBelegeAbruf, art: 'L-Shop-Belege', post: () => request().post('/api/intern/lshop-belege/abruf').set('Authorization', 'Bearer t').send({}) },
  { name: 'Scheduler Lieferbarkeit', lauf: runLieferbarkeit, art: 'L-Shop-Lieferbarkeit', post: () => request().post('/api/intern/lshop-lieferbarkeit/abruf').set('Authorization', 'Bearer t').send({}) },
  { name: 'Knopf Korb-Abgleich', lauf: runKorbAbgleich, art: 'L-Shop-Korb-Abgleich', post: () => request().post('/api/bestellen/lshop-korb/abgleich').set('X-API-Key', 'test-api-key').send({}) },
];
const zeitueberschreitung = () => new ShopZeitueberschreitungError({ shop: 'JFN', methode: 'get', pfad: 'orders', limitMs: 15000, zeit: new Date('2026-11-04T23:17:28Z') });

describe.each(WEGE)('$name', ({ lauf, art, post }) => {
  test('Shop-Zeitueberschreitung: genau eine Meldung (Middleware), keine "Stoerung"', async () => {
    lauf.mockRejectedValue(zeitueberschreitung());
    const res = await post();
    expect(res.status).toBe(504);
    expect(res.body.code).toBe('shop_timeout');
    expect(notifyShopZeitueberschreitung).toHaveBeenCalledTimes(1);
    expect(notifyFehler).not.toHaveBeenCalled();
  });

  test('Hoster-Pruefseite: genau eine Meldung (Middleware)', async () => {
    lauf.mockRejectedValue(new HosterPruefseiteError({ shop: 'JFN', pfad: 'orders', httpStatus: 200 }));
    const res = await post();
    expect(res.status).toBe(503);
    expect(notifyHosterPruefseite).toHaveBeenCalledTimes(1);
    expect(notifyFehler).not.toHaveBeenCalled();
  });

  test('anderer 5xx: eine "Störung" mit dem Ablauf als Art', async () => {
    lauf.mockRejectedValue(Object.assign(new Error('Sheets weg'), { status: 502 }));
    const res = await post();
    expect(res.status).toBe(502);
    expect(notifyFehler).toHaveBeenCalledTimes(1);
    expect(notifyFehler).toHaveBeenCalledWith(expect.objectContaining({ art, status: 502, titel: 'Störung' }));
    expect(notifyShopZeitueberschreitung).not.toHaveBeenCalled();
  });
});
