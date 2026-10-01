// Sichtbarkeit der Hoster-Pruefseite: zentraler Handler (503 + Code) und
// gedrosselte Chat-Meldung "Hoster-Prüfseite, Lauf gestoppt".

import { jest } from '@jest/globals';

jest.unstable_mockModule('../utils/secrets.js', () => ({
  SECRET_KEYS: [],
  getSecret:   jest.fn(async key => process.env[key] ?? ''),
  loadAllSecrets: jest.fn(),
}));

const { notifyHosterPruefseite, _resetAlarme, _resetWarnung } = await import('../lib/chatNotify.js');
const { hosterPruefseiteHandler } = await import('../middleware/hosterPruefseite.js');
const { HosterPruefseiteError } = await import('../lib/hosterPruefseite.js');
const { default: express } = await import('express');
const { default: request } = await import('supertest');

let fetchMock;
const gesendeterText = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body).text;

beforeEach(() => {
  _resetAlarme();
  _resetWarnung();
  process.env.GCHAT_WEBHOOK_URL = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t';
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  global.fetch = fetchMock;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.GCHAT_WEBHOOK_URL; });

describe('notifyHosterPruefseite', () => {
  test('meldet einmal, zweiter Aufruf in derselben Stunde gedrosselt', async () => {
    expect(await notifyHosterPruefseite({ ablauf: 'POST /api/trikot/sync', shop: 'JammiFashion', pfad: 'orders', httpStatus: 200, titel: 'One moment, please...', zeit: '2026-10-01T09:15:17Z' })).toBe(true);
    expect(await notifyHosterPruefseite({ ablauf: 'POST /api/partner/verkaeufe/sync-all' })).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const text = gesendeterText();
    expect(text).toContain('Hoster-Prüfseite, Lauf gestoppt');
    expect(text).toContain('POST /api/trikot/sync · Shop JammiFashion · Pfad orders · HTTP 200 · Titel "One moment, please..." · 2026-10-01T09:15:17Z');
  });
});

describe('hosterPruefseiteHandler', () => {
  const app = express();
  app.get('/pruefseite', (_req, _res, next) => next(new HosterPruefseiteError({ shop: 'JammiFashion', pfad: 'orders?after=x', httpStatus: 403, titel: '403 Forbidden' })));
  app.get('/anders', (_req, _res, next) => next(Object.assign(new Error('kaputt'), { status: 500 })));
  app.use(hosterPruefseiteHandler);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));

  test('HosterPruefseiteError -> 503, Code hoster_pruefseite, eine Chat-Meldung', async () => {
    const r = await request(app).get('/pruefseite');
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('hoster_pruefseite');
    expect(r.body.error).toContain('Pfad orders');
    expect(r.body.error).not.toContain('after');
    expect(r.body.error).toContain('HTTP 403, Titel "403 Forbidden"');
    expect(gesendeterText()).toContain('HTTP 403 · Titel "403 Forbidden"');
    await request(app).get('/pruefseite');
    expect(fetchMock).toHaveBeenCalledTimes(1);          // gedrosselt
  });

  test('anderer Fehler -> unveraendert an den naechsten Handler, keine Meldung', async () => {
    const r = await request(app).get('/anders');
    expect(r.status).toBe(500);
    expect(r.body.code).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Zeitueberschreitung', () => {
  test('504 shop_timeout mit ergebnisUnklar, eine gedrosselte Chat-Meldung', async () => {
    const { ShopZeitueberschreitungError } = await import('../lib/hosterPruefseite.js');
    const app = express();
    app.put('/schreiben', (_req, _res, next) => next(new ShopZeitueberschreitungError({ shop: 'JammiFashion', methode: 'put', pfad: 'products/1?x=1', limitMs: 60_000 })));
    app.use(hosterPruefseiteHandler);
    const r = await request(app).put('/schreiben');
    expect(r.status).toBe(504);
    expect(r.body).toMatchObject({ code: 'shop_timeout', ergebnisUnklar: true });
    expect(r.body.error).toContain('Ergebnis unklar, bitte nachlesen.');
    expect(r.body.error).not.toContain('x=1');
    const text = gesendeterText();
    expect(text).toContain('Shop antwortet nicht (Zeitüberschreitung), Lauf gestoppt');
    expect(text).toContain('PUT products/1 · nach 60 s');
    expect(text).toContain('Ergebnis unklar, bitte im Shop nachlesen');
    await request(app).put('/schreiben');
    expect(fetchMock).toHaveBeenCalledTimes(1);          // gedrosselt
  });
});
