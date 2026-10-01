// Letzter guter Stand fuer selten aendernde Stammdaten (Versandklassen,
// Attribute + Begriffe, Kategorien): scheitert der Abruf, liefert die Route die
// letzte gueltige Liste mit Header X-MC-Stand. Nie bei Bestellungen.

import { jest } from '@jest/globals';

const wc = { get: jest.fn(), post: jest.fn(), put: jest.fn(), shopLabel: 'JammiFashion' };

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient: jest.fn(() => wc),
}));
jest.unstable_mockModule('../lib/chatNotify.js', () => ({
  notify: jest.fn().mockResolvedValue(true),
  notifyHosterPruefseite: jest.fn().mockResolvedValue(true),
  notifyShopZeitueberschreitung: jest.fn().mockResolvedValue(true),
}));

const PRUEFSEITE = '<!DOCTYPE html><html><title>One moment, please...</title></html>';
let request, app, vergessen, hp, chat;

beforeAll(async () => {
  ({ default: request } = await import('supertest'));
  const { default: express } = await import('express');
  const mod = await import('../routes/woocommerce.js');
  vergessen = mod._wcCacheVergessen;
  hp   = await import('../lib/hosterPruefseite.js');
  chat = await import('../lib/chatNotify.js');
  const { hosterPruefseiteHandler } = await import('../middleware/hosterPruefseite.js');
  app = express();
  app.use('/api/woocommerce', mod.default);
  app.use(hosterPruefseiteHandler);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message, code: err.code }));
});

beforeEach(() => {
  vergessen({ auchLetztenStand: true });
  wc.get.mockReset();
  chat.notifyHosterPruefseite.mockClear();
  chat.notifyShopZeitueberschreitung.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { console.warn.mockRestore(); console.error.mockRestore(); });

const KLASSEN = [{ id: 52, slug: 'paket', name: 'Paket' }];

describe('Versandklassen', () => {
  test('Abruf scheitert (Zeitueberschreitung) -> letzte gute Liste mit X-MC-Stand, Meldung', async () => {
    wc.get.mockResolvedValueOnce({ data: KLASSEN });
    const r1 = await request(app).get('/api/woocommerce/shipping-classes');
    expect(r1.status).toBe(200);
    expect(r1.headers['x-mc-stand']).toBeUndefined();

    vergessen();   // 30 min vorbei: frischer Speicher weg, letzter Stand bleibt
    wc.get.mockRejectedValueOnce(new hp.ShopZeitueberschreitungError({ shop: 'JammiFashion', methode: 'get', pfad: 'products/shipping_classes', limitMs: 15_000 }));
    const r2 = await request(app).get('/api/woocommerce/shipping-classes');
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual(KLASSEN);
    expect(r2.headers['x-mc-stand']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(chat.notifyShopZeitueberschreitung).toHaveBeenCalledTimes(1);

    // Danach nicht bei jedem Aufruf erneut beim Shop: Rueckfall gilt einige Minuten.
    const r3 = await request(app).get('/api/woocommerce/shipping-classes');
    expect(r3.headers['x-mc-stand']).toBe(r2.headers['x-mc-stand']);
    expect(wc.get).toHaveBeenCalledTimes(2);
  });

  test('Pruefseite ohne frueheren Stand -> 503 wie bisher, nichts gespeichert', async () => {
    wc.get.mockResolvedValueOnce({ data: PRUEFSEITE });
    const r = await request(app).get('/api/woocommerce/shipping-classes');
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('hoster_pruefseite');
  });
});

test('Kategorien: Pruefseite -> letzte gute Liste mit Stand', async () => {
  wc.get.mockResolvedValueOnce({ data: [{ id: 5, name: 'Shirts', parent: 0 }] });
  await request(app).get('/api/woocommerce/categories');
  vergessen();
  wc.get.mockResolvedValueOnce({ data: PRUEFSEITE });
  const r = await request(app).get('/api/woocommerce/categories');
  expect(r.status).toBe(200);
  expect(r.body).toEqual([{ Kategorienummer: '5', Kategoriename: 'Shirts', Kategorien: 'Shirts' }]);
  expect(r.headers['x-mc-stand']).toBeDefined();
  expect(chat.notifyHosterPruefseite).toHaveBeenCalledTimes(1);
});

test('Attribute: Fehler bei den Begriffen -> letzte gute Liste mit Stand', async () => {
  wc.get.mockImplementation(async pfad => (pfad === 'products/attributes'
    ? { data: [{ id: 1, name: 'Farbe' }] } : { data: [{ name: 'Schwarz' }] }));
  await request(app).get('/api/woocommerce/attributes');
  vergessen();
  wc.get.mockImplementation(async pfad => (pfad === 'products/attributes'
    ? { data: [{ id: 1, name: 'Farbe' }] } : { data: PRUEFSEITE }));
  const r = await request(app).get('/api/woocommerce/attributes');
  expect(r.status).toBe(200);
  expect(r.body).toEqual([{ eigenschaft: 'Farbe', begriffe: ['Schwarz'] }]);
  expect(r.headers['x-mc-stand']).toBeDefined();
});

test('Bestellungen: kein Zwischenstand, auch nach erfolgreichem Abruf', async () => {
  wc.get.mockResolvedValueOnce({ data: [{ id: 1, date_created: '2026-10-01T10:00:00' }] });
  const r1 = await request(app).get('/api/woocommerce/orders?status=processing');
  expect(r1.status).toBe(200);
  // So meldet der echte Client (getWcClient) einen haengenden Shop.
  wc.get.mockRejectedValueOnce(new hp.ShopZeitueberschreitungError({ shop: 'JammiFashion', methode: 'get', pfad: 'orders', limitMs: 15_000 }));
  const r2 = await request(app).get('/api/woocommerce/orders?status=processing');
  expect(r2.status).toBe(504);
  expect(r2.body.code).toBe('shop_timeout');
  expect(r2.headers['x-mc-stand']).toBeUndefined();
  expect(r2.body).not.toEqual(r1.body);
});

describe('Maske und CORS', () => {
  test('X-MC-Stand ist fuer den Browser lesbar (exposedHeaders)', async () => {
    const { readFileSync } = await import('fs');
    const { resolve, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const hier = dirname(fileURLToPath(import.meta.url));
    expect(readFileSync(resolve(hier, '../index.js'), 'utf8')).toMatch(/exposedHeaders:\s*\['X-MC-Stand'\]/);
    const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
    expect(html).toContain("res?.headers?.get?.('X-MC-Stand')");
    // Versandklassen, Attribute, Kategorien (Partnerportal) zeigen den Stand
    expect(html).toContain('ssot.versandStand = standHinweis(r);');
    expect(html).toMatch(/const st = standHinweis\(r\);\s*if \(st\) showToast\(`Attribute: \$\{st\}`/);
    expect(html).toMatch(/const st = window\.standHinweis\?\.\(r\);\s*if \(st\) window\.showToast\(`Kategorien: \$\{st\}`/);
  });
});
