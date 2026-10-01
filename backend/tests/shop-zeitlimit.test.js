// Zeitlimit je Zugriff (lib/hosterPruefseite.js, getWcClient): Lesen 15 s,
// Schreiben und /batch 60 s. Ablauf -> ShopZeitueberschreitungError (504,
// shop_timeout), ohne Wiederholung. Schreibzugriff: "Ergebnis unklar".
// Nur Mocks: axios-Adapter statt Netz.

import { jest } from '@jest/globals';
import {
  ShopZeitueberschreitungError, ZEITLIMIT_LESEN_MS, ZEITLIMIT_SCHREIBEN_MS, SHOP_TIMEOUT_TEXT_SCHREIBEN,
  zeitlimitFuer, wirfWennPruefseite, istLaufStopp, fetchMitZeitlimit,
} from '../lib/hosterPruefseite.js';
import { getWcClient } from '../lib/shopConfig.js';

beforeAll(() => {
  process.env.WC_URL    = 'https://shop.test';
  process.env.WC_KEY    = 'ck_geheim123';
  process.env.WC_SECRET = 'cs_geheim456';
});

const JSON_OK = { status: 200, headers: { 'content-type': 'application/json' }, data: '[]' };

// axios meldet das eigene Zeitlimit als ECONNABORTED "timeout of …ms exceeded".
const timeoutFehler = config => Object.assign(new Error(`timeout of ${config.timeout}ms exceeded`), { code: 'ECONNABORTED', config });

function client(adapterFn) {
  const wc = getWcClient('jfn');
  const adapter = jest.fn(async config => {
    const a = await adapterFn(config);
    return { statusText: 'OK', config, ...a };
  });
  wc.axiosConfig = { adapter };
  return { wc, adapter };
}

describe('zeitlimitFuer', () => {
  test('Lesen 15 s, Schreiben 60 s, /batch 60 s', () => {
    expect(ZEITLIMIT_LESEN_MS).toBe(15_000);
    expect(ZEITLIMIT_SCHREIBEN_MS).toBe(60_000);
    expect(zeitlimitFuer('get', 'orders')).toBe(15_000);
    expect(zeitlimitFuer('options', 'orders')).toBe(15_000);
    for (const m of ['post', 'put', 'delete']) expect(zeitlimitFuer(m, 'products/1')).toBe(60_000);
    expect(zeitlimitFuer('post', 'products/1/variations/batch')).toBe(60_000);
    expect(zeitlimitFuer('get', 'products/1/variations/batch?x=1')).toBe(60_000);
  });
});

describe('getWcClient: Zeitlimit an jedem Request', () => {
  test('GET laeuft nach 15 s ab, POST/PUT/DELETE/batch erst nach 60 s', async () => {
    const { wc, adapter } = client(async () => JSON_OK);
    await wc.get('orders');
    await wc.post('products', { name: 'x' });
    await wc.put('products/1', { name: 'x' });
    await wc.delete('products/1/variations/2', { force: true });
    await wc.post('products/1/variations/batch', { create: [] });
    expect(adapter.mock.calls.map(([c]) => [c.method, c.timeout])).toEqual([
      ['get', 15_000], ['post', 60_000], ['put', 60_000], ['delete', 60_000], ['post', 60_000],
    ]);
  });

  test('gleichzeitige Aufrufe behalten jeweils ihr eigenes Limit', async () => {
    const { wc, adapter } = client(async () => JSON_OK);
    await Promise.all([wc.get('orders'), wc.put('products/1', {}), wc.get('products')]);
    expect(adapter.mock.calls.map(([c]) => c.timeout)).toEqual([15_000, 60_000, 15_000]);
  });

  test('Lesen: Ablauf -> ShopZeitueberschreitungError, genau ein Abruf, nicht unklar', async () => {
    const { wc, adapter } = client(async config => { throw timeoutFehler(config); });
    const e = await wc.get('orders', { after: '2026-10-01', per_page: 100 }).catch(x => x);
    expect(e).toBeInstanceOf(ShopZeitueberschreitungError);
    expect(e).toMatchObject({ status: 504, code: 'shop_timeout', ergebnisUnklar: false, methode: 'GET', pfad: 'orders', limitMs: 15_000 });
    expect(e.message).toMatch(/^Shop hat nicht rechtzeitig geantwortet, Lauf gestoppt \(Shop JammiFashion, GET orders, nach 15 s, /);
    expect(e.message).not.toMatch(/after|per_page|ck_|cs_/);
    expect(adapter).toHaveBeenCalledTimes(1);   // keine Wiederholung
  });

  test('Schreiben: Ablauf -> "Ergebnis unklar, bitte nachlesen", genau ein Abruf', async () => {
    const { wc, adapter } = client(async config => { throw timeoutFehler(config); });
    const e = await wc.put('products/4711', { regular_price: '20' }).catch(x => x);
    expect(e).toBeInstanceOf(ShopZeitueberschreitungError);
    expect(e).toMatchObject({ ergebnisUnklar: true, schreibend: true, methode: 'PUT', limitMs: 60_000 });
    expect(e.message.startsWith(SHOP_TIMEOUT_TEXT_SCHREIBEN)).toBe(true);
    expect(SHOP_TIMEOUT_TEXT_SCHREIBEN).toBe('Shop hat nicht rechtzeitig geantwortet, Ergebnis unklar, bitte nachlesen.');
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  test('TCP-Timeout (ETIMEDOUT) zaehlt ebenso', async () => {
    const { wc } = client(async () => { throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }); });
    await expect(wc.get('orders')).rejects.toBeInstanceOf(ShopZeitueberschreitungError);
  });

  test('anderer Netzwerkfehler bleibt unveraendert', async () => {
    const { wc } = client(async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); });
    const e = await wc.get('orders').catch(x => x);
    expect(e).not.toBeInstanceOf(ShopZeitueberschreitungError);
    expect(e.code).toBe('ECONNREFUSED');
  });
});

describe('Durchreichen', () => {
  test('wirfWennPruefseite wirft die Zeitueberschreitung weiter, andere Fehler nicht', () => {
    const t = new ShopZeitueberschreitungError({ shop: 'X', methode: 'get', pfad: 'orders', limitMs: 15_000 });
    expect(istLaufStopp(t)).toBe(true);
    expect(() => wirfWennPruefseite(t)).toThrow(t);
    expect(() => wirfWennPruefseite(new Error('anders'))).not.toThrow();
  });
});

describe('fetchMitZeitlimit (WordPress)', () => {
  test('Upload (POST) mit 60 s; Ablauf -> Ergebnis unklar', async () => {
    const orig = global.fetch;
    let signal;
    global.fetch = jest.fn(async (_url, o) => { signal = o.signal; throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); });
    try {
      const e = await fetchMitZeitlimit('https://shop.test/wp-json/wp/v2/media', { method: 'POST' }, { shop: 'JammiFashion', pfad: '/wp-json/wp/v2/media' }).catch(x => x);
      expect(e).toBeInstanceOf(ShopZeitueberschreitungError);
      expect(e).toMatchObject({ ergebnisUnklar: true, limitMs: 60_000 });
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally { global.fetch = orig; }
  });
});
