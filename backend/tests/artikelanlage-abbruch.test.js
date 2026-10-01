// POST /api/woocommerce/products: ohne Produkt-ID keine Variationen; die
// Hoster-Pruefseite beim Anlegen einer Variation stoppt die Schleife, jeder
// andere Fehler einer Variation bleibt wie bisher (melden, naechste Variante).

import { jest } from '@jest/globals';
import { HosterPruefseiteError } from '../lib/hosterPruefseite.js';

const wc = { get: jest.fn(), post: jest.fn(), put: jest.fn() };

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'honk', label: 'HonkShop', markenSlug: null })),
  getWcClient: jest.fn(() => wc),
}));

let request, app;

beforeAll(async () => {
  ({ default: request } = await import('supertest'));
  const { default: express } = await import('express');
  const { default: router } = await import('../routes/woocommerce.js');
  app = express();
  app.use(express.json());
  app.use('/api/woocommerce', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message, code: err.code }));
});

const groesse = g => ({ attributes: [{ name: 'Farbe', option: 'Schwarz' }, { name: 'Größe', option: g }], regular_price: '20' });
const BODY = {
  name: 'Shirt', sku: 'JF/Shirt-01', type: 'variable', ssot_id: 'JFN-2026-0001', shipping_class: 'paket',
  attributes: [{ name: 'Farbe', options: ['Schwarz'], variation: true }, { name: 'Größe', options: ['S', 'M', 'L'], variation: true }],
  variations: [groesse('S'), groesse('M'), groesse('L')],
};
const anlegen = () => request(app).post('/api/woocommerce/products?shop=honk').send(BODY);
const variationsPosts = () => wc.post.mock.calls.filter(c => c[0] !== 'products');

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  wc.post.mockReset();
});
afterEach(() => jest.restoreAllMocks());

test('Produkt ohne id -> Abbruch 502, keine einzige Variation angelegt', async () => {
  wc.post.mockImplementation(async pfad => (pfad === 'products' ? { data: { status: 'draft' } } : { data: { id: 9 } }));
  const res = await anlegen();
  expect(res.status).toBe(502);
  expect(res.body.error).toMatch(/keine Produkt-ID/);
  expect(variationsPosts()).toHaveLength(0);
});

test('Hoster-Pruefseite bei der ersten Variation -> 503, keine weitere Variation', async () => {
  wc.post.mockImplementation(async pfad => {
    if (pfad === 'products') return { data: { id: 100, status: 'draft' } };
    throw new HosterPruefseiteError({ shop: 'HonkShop', pfad });
  });
  const res = await anlegen();
  expect(res.status).toBe(503);
  expect(res.body.code).toBe('hoster_pruefseite');
  expect(variationsPosts()).toHaveLength(1);
});

test('anderer Fehler bei einer Variation -> wie bisher: gemeldet, die anderen werden angelegt', async () => {
  let n = 0;
  wc.post.mockImplementation(async (pfad, body) => {
    if (pfad === 'products') return { data: { id: 100, status: 'draft' } };
    if (++n === 1) throw new Error('invalid sku');
    return { data: { id: 500 + n, attributes: body.attributes } };
  });
  const res = await anlegen();
  expect(res.status).toBe(201);
  expect(variationsPosts()).toHaveLength(3);
  expect(res.body).toMatchObject({ variations_created: 2, variations_failed: 1, variation_errors: ['invalid sku'] });
});

test('Zeitueberschreitung bei der ersten Variation -> 504, Ergebnis unklar, keine weitere Variation', async () => {
  const { ShopZeitueberschreitungError } = await import('../lib/hosterPruefseite.js');
  wc.post.mockImplementation(async pfad => {
    if (pfad === 'products') return { data: { id: 100, status: 'draft' } };
    throw new ShopZeitueberschreitungError({ shop: 'HonkShop', methode: 'post', pfad, limitMs: 60_000 });
  });
  const res = await anlegen();
  expect(res.status).toBe(504);
  expect(res.body).toMatchObject({ code: 'shop_timeout' });
  expect(res.body.error).toMatch(/^Shop hat nicht rechtzeitig geantwortet, Ergebnis unklar, bitte nachlesen\./);
  expect(variationsPosts()).toHaveLength(1);
});
