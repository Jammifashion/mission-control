// Hoster-Pruefseite: HTML statt JSON -> HosterPruefseiteError, ohne Wiederholung.
// Nur Mocks: der WC-Client bekommt einen axios-Adapter, fetch eine Response.

import { jest } from '@jest/globals';
import {
  HosterPruefseiteError, istPruefseite, pruefeFetchAntwort, pfadOhneQuery,
  HOSTER_PRUEFSEITE_CODE, HOSTER_PRUEFSEITE_TEXT,
} from '../lib/hosterPruefseite.js';
import { getWcClient } from '../lib/shopConfig.js';

const PRUEFSEITE = '<!DOCTYPE html>\n<html lang="en"><head><title>One moment, please...</title></head></html>';

beforeAll(() => {
  process.env.WC_URL    = 'https://shop.test';
  process.env.WC_KEY    = 'ck_geheim123';
  process.env.WC_SECRET = 'cs_geheim456';
});

// Client mit Adapter statt Netz; jeder Abruf wird gezaehlt.
function clientMit(antwort) {
  const wc = getWcClient('jfn');
  const adapter = jest.fn(async config => {
    const a = typeof antwort === 'function' ? antwort(config) : antwort;
    if (a.fehler) {
      const err = new Error(`HTTP ${a.status}`);
      err.response = { status: a.status, headers: a.headers, data: a.data, config };
      throw err;
    }
    return { status: a.status ?? 200, statusText: 'OK', headers: a.headers, data: a.data, config };
  });
  wc.axiosConfig = { adapter };
  return { wc, adapter };
}

describe('istPruefseite', () => {
  test('200 mit text/html -> Pruefseite', () => {
    expect(istPruefseite({ status: 200, contentType: 'text/html', body: PRUEFSEITE })).toBe(true);
  });
  test('JSON-Content-Type, aber Body beginnt mit < -> Pruefseite', () => {
    expect(istPruefseite({ status: 200, contentType: 'application/json', body: '  <html>' })).toBe(true);
  });
  test('Content-Type fehlt -> Pruefseite', () => {
    expect(istPruefseite({ status: 200, contentType: undefined, body: '[]' })).toBe(true);
  });
  test('JSON mit charset -> keine Pruefseite', () => {
    expect(istPruefseite({ status: 200, contentType: 'application/json; charset=UTF-8', body: [] })).toBe(false);
  });
  test('204 ohne Inhalt -> keine Pruefseite', () => {
    expect(istPruefseite({ status: 204, contentType: undefined, body: '' })).toBe(false);
  });
});

describe('HosterPruefseiteError', () => {
  test('Meldung: Shop, Pfad ohne Query, Uhrzeit; Code und Status', () => {
    const e = new HosterPruefseiteError({ shop: 'JammiFashion', pfad: 'orders?after=2026&consumer_key=ck_x', zeit: new Date('2026-10-01T09:15:17.123Z') });
    expect(e.message).toBe(`${HOSTER_PRUEFSEITE_TEXT} (Shop JammiFashion, Pfad orders, 2026-10-01T09:15:17Z).`);
    expect(e.code).toBe(HOSTER_PRUEFSEITE_CODE);
    expect(e.status).toBe(503);
  });
  test('pfadOhneQuery: URL -> nur Pfad', () => {
    expect(pfadOhneQuery('https://shop.test/wp-json/wp/v2/media?x=1#a')).toBe('/wp-json/wp/v2/media');
  });
});

describe('getWcClient: Pruefung an jedem Request', () => {
  test('Pruefseite mit Status 200 und HTML-Body -> HosterPruefseiteError, genau ein Abruf', async () => {
    const { wc, adapter } = clientMit({ status: 200, headers: { 'content-type': 'text/html' }, data: PRUEFSEITE });
    const p = wc.get('orders', { after: '2026-09-01T00:00:00', per_page: 100 });
    await expect(p).rejects.toBeInstanceOf(HosterPruefseiteError);
    await p.catch(e => {
      expect(e.message).toContain('Shop JammiFashion');
      expect(e.message).toContain('Pfad orders');
      expect(e.message).not.toMatch(/after|per_page|ck_|cs_|geheim/);
    });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  test('gilt auch fuer POST', async () => {
    const { wc } = clientMit({ status: 200, headers: { 'content-type': 'text/html' }, data: PRUEFSEITE });
    await expect(wc.post('products', { name: 'x' })).rejects.toBeInstanceOf(HosterPruefseiteError);
  });

  test('HTML-Fehlerseite (403) -> HosterPruefseiteError', async () => {
    const { wc } = clientMit({ fehler: true, status: 403, headers: { 'content-type': 'text/html' }, data: '<HTML><TITLE>403 Forbidden</TITLE></HTML>' });
    await expect(wc.get('orders')).rejects.toBeInstanceOf(HosterPruefseiteError);
  });

  test('JSON-Antwort -> unveraendert', async () => {
    const { wc } = clientMit({ status: 200, headers: { 'content-type': 'application/json; charset=UTF-8' }, data: '[{"id":1}]' });
    const { data } = await wc.get('orders');
    expect(data).toEqual([{ id: 1 }]);
  });

  test('JSON-Fehler (404) -> Originalfehler bleibt', async () => {
    const { wc } = clientMit({ fehler: true, status: 404, headers: { 'content-type': 'application/json' }, data: { code: 'woocommerce_rest_invalid_id' } });
    const err = await wc.get('orders/1').catch(e => e);
    expect(err).not.toBeInstanceOf(HosterPruefseiteError);
    expect(err.response.status).toBe(404);
  });

  test('Netzwerkfehler ohne Antwort -> Originalfehler bleibt', async () => {
    const wc = getWcClient('jfn');
    wc.axiosConfig = { adapter: async () => { throw new Error('ECONNREFUSED'); } };
    const err = await wc.get('orders').catch(e => e);
    expect(err).not.toBeInstanceOf(HosterPruefseiteError);
    expect(err.message).toBe('ECONNREFUSED');
  });
});

describe('pruefeFetchAntwort (WordPress)', () => {
  test('200 mit HTML -> HosterPruefseiteError', async () => {
    const res = new Response(PRUEFSEITE, { status: 200, headers: { 'content-type': 'text/html' } });
    await expect(pruefeFetchAntwort(res, { shop: 'JammiFashion', pfad: '/wp-json/wp/v2/media' }))
      .rejects.toBeInstanceOf(HosterPruefseiteError);
  });
  test('JSON -> geparstes Objekt', async () => {
    const res = new Response('{"id":7,"source_url":"https://x/y.jpg"}', { status: 201, headers: { 'content-type': 'application/json' } });
    expect(await pruefeFetchAntwort(res, { shop: 'JammiFashion', pfad: '/wp-json/wp/v2/media' }))
      .toEqual({ id: 7, source_url: 'https://x/y.jpg' });
  });
});

describe('POST /api/artikel/media-upload', () => {
  test('WordPress liefert Pruefseite (200) -> 503, ein Abruf', async () => {
    const { default: express } = await import('express');
    const { default: request } = await import('supertest');
    const { default: artikelRouter } = await import('../routes/artikel.js');
    process.env.WP_APP_PASSWORD = 'wp_geheim';
    const app = express();
    app.use('/api/artikel', artikelRouter);
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));

    const fetchOrig = global.fetch;
    global.fetch = jest.fn(async () => new Response(PRUEFSEITE, { status: 200, headers: { 'content-type': 'text/html' } }));
    try {
      const r = await request(app).post('/api/artikel/media-upload').attach('file', Buffer.from('x'), 'bild.jpg');
      expect(r.status).toBe(503);
      expect(r.body.error).toContain(HOSTER_PRUEFSEITE_TEXT);
      expect(r.body.error).not.toContain('wp_geheim');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally { global.fetch = fetchOrig; }
  });
});
