// POST /api/woocommerce/products setzt die Marke je Shop selbst.
// PUT /api/woocommerce/products/:id bleibt unveraendert und schickt keine
// Marke - ein nicht leeres brands-Array ersetzt in WooCommerce alle vorhandenen
// Marken (wp_set_object_terms ohne append).

import { jest } from '@jest/globals';

const clients = {};
const neuerClient = () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() });

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(shop => shop === 'honk'
    ? { shop: 'honk', label: 'HonkShop', markenSlug: null }
    : { shop: 'jfn',  label: 'JammiFashion', markenSlug: 'jammifashion' }),
  getWcClient: jest.fn(shop => clients[shop === 'honk' ? 'honk' : 'jfn']),
}));

let request, app, _resetMarkenCache;

beforeAll(async () => {
  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');
  ({ _resetMarkenCache } = await import('../lib/shopMarke.js'));
  const { default: router } = await import('../routes/woocommerce.js');
  app = express();
  app.use(express.json());
  app.use('/api/woocommerce', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

// ID bewusst nicht 698: der Test beweist, dass sie aus WooCommerce kommt.
const TERM = { id: 4711, name: 'JammiFashion', slug: 'jammifashion' };

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  _resetMarkenCache();
  for (const shop of ['jfn', 'honk']) {
    clients[shop] = neuerClient();
    clients[shop].post.mockImplementation(async (pfad, body) => pfad === 'products'
      ? { data: { id: 100, status: 'draft', brands: (body.brands ?? []).map(b => ({ ...TERM, id: b.id })) } }
      : { data: { id: 555 } });
    clients[shop].put.mockResolvedValue({ data: { id: 100 } });
  }
  clients.jfn.get.mockResolvedValue({ data: [TERM] });
});

afterEach(() => jest.restoreAllMocks());

// sku muss seit S2 die Form <L-Shop-Nummer>/<Kurzbezeichnung> haben und wird
// vom Endpunkt geprueft - "JF-1" waere jetzt ein 400 und diese Suite wuerde
// die Markenlogik gar nicht mehr erreichen.
const BASIS = { name: 'Shirt', sku: 'JF/Shirt-01', type: 'variable', ssot_id: 'JFN-2026-0001' };
const produktPost = shop => clients[shop].post.mock.calls.filter(c => c[0] === 'products');

describe('POST /products – Marke', () => {
  test('jfn ohne Marke im Body → brands mit der ueber den Slug ermittelten ID', async () => {
    const res = await request(app).post('/api/woocommerce/products?shop=jfn').send(BASIS);
    expect(res.status).toBe(201);
    expect(clients.jfn.get).toHaveBeenCalledWith('products/brands', { slug: 'jammifashion' });
    expect(produktPost('jfn')[0][1].brands).toEqual([{ id: 4711 }]);
    expect(res.body.marke).toBe('JammiFashion');
  });

  test.each([
    [[{ id: 1 }]],
    [[]],
    [[4711, 12]],
    ['JammiFashion'],
  ])('jfn: brands aus dem Body (%j) wird durch die Shop-Marke ersetzt', async (brands) => {
    await request(app).post('/api/woocommerce/products?shop=jfn').send({ ...BASIS, brands });
    expect(produktPost('jfn')[0][1].brands).toEqual([{ id: 4711 }]);
  });

  test('ohne shop-Parameter gilt jfn wie bisher', async () => {
    await request(app).post('/api/woocommerce/products').send(BASIS);
    expect(produktPost('jfn')[0][1].brands).toEqual([{ id: 4711 }]);
  });

  test('Slug im Shop nicht gefunden → Fehler, kein Produkt angelegt', async () => {
    clients.jfn.get.mockResolvedValue({ data: [] });
    const res = await request(app).post('/api/woocommerce/products?shop=jfn')
      .send({ ...BASIS, variations: [{ attributes: [] }] });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/jammifashion/);
    expect(clients.jfn.post).not.toHaveBeenCalled();
  });

  test('honk → kein brands-Feld, auch wenn der Body eines schickt; marke leer', async () => {
    const res = await request(app).post('/api/woocommerce/products?shop=honk')
      .send({ ...BASIS, brands: [{ id: 3 }] });
    expect(res.status).toBe(201);
    expect(produktPost('honk')[0][1]).not.toHaveProperty('brands');
    expect(clients.honk.get).not.toHaveBeenCalled();
    expect(res.body.marke).toBe('');
  });

  test('SKU-Retry behaelt die Marke', async () => {
    clients.jfn.post
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { response: { data: { code: 'product_invalid_sku' } } }));
    const res = await request(app).post('/api/woocommerce/products?shop=jfn').send(BASIS);
    expect(res.status).toBe(201);
    const calls = produktPost('jfn');
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toMatchObject({ sku: 'JF/Shirt-01-v2', brands: [{ id: 4711 }] });
  });

  test('marke kommt aus der WooCommerce-Antwort, nicht aus der Annahme', async () => {
    clients.jfn.post.mockImplementation(async pfad => pfad === 'products'
      ? { data: { id: 100, status: 'draft', brands: [] } }
      : { data: { id: 555 } });
    const res = await request(app).post('/api/woocommerce/products?shop=jfn').send(BASIS);
    expect(res.body.marke).toBe('');
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/keine Marke/));
  });

  test('Varianten werden weiter angelegt, ohne Marke', async () => {
    await request(app).post('/api/woocommerce/products?shop=jfn')
      .send({ ...BASIS, variations: [{ attributes: [{ name: 'Farbe', option: 'Rot' }], regular_price: '20' }] });
    const v = clients.jfn.post.mock.calls.find(c => c[0] === 'products/100/variations');
    expect(v).toBeDefined();
    expect(v[1]).not.toHaveProperty('brands');
  });
});

describe('PUT /products/:id – unveraendert, ohne Marke', () => {
  test('schickt kein brands-Feld und fragt keine Marke ab', async () => {
    const res = await request(app).put('/api/woocommerce/products/100?shop=jfn')
      .send({ name: 'Neu', description: 'x' });
    expect(res.status).toBe(200);
    expect(clients.jfn.put).toHaveBeenCalledWith('products/100', { name: 'Neu', description: 'x' });
    expect(clients.jfn.put.mock.calls[0][1]).not.toHaveProperty('brands');
    expect(clients.jfn.get).not.toHaveBeenCalled();
  });

  test.each([
    ['jfn',  [{ id: 4711 }]],
    ['jfn',  []],
    ['honk', [3]],
  ])('%s: brands im Body (%j) geht nicht an WooCommerce', async (shop, brands) => {
    const res = await request(app).put(`/api/woocommerce/products/100?shop=${shop}`)
      .send({ name: 'Neu', brands });
    expect(res.status).toBe(200);
    expect(clients[shop].put).toHaveBeenCalledWith('products/100', { name: 'Neu' });
    expect(clients[shop].put.mock.calls[0][1]).not.toHaveProperty('brands');
    expect(clients[shop].get).not.toHaveBeenCalled();
  });
});
