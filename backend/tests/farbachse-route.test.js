// Farbachsen-Regel an den beiden Speicherpfaden.
//
// Anlage  -> streng: fehlt die Farbachse bei vorhandenen anderen Achsen, wird
//            nicht gespeichert (400 mit Feldname).
// Aenderung -> nachsichtig, Muster S2b: Achsen unveraendert gegenueber dem
//            SHOP-Stand gehen durch, mit Hinweis. Achsen angefasst -> volle Regel.
//
// Warum die Milde: mindestens fuenf Artikel im Shop haben heute keine
// Farbachse. Eine strenge Pruefung im Aenderungspfad legte sie bei der
// naechsten Preisaenderung still - genau der Fehler, den S2 am 21.09. gemacht
// hat, als Anlage und Aenderung dieselbe Pruefung teilten.

import { jest } from '@jest/globals';

const clients = {};
const neuerClient = () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() });

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient:   jest.fn(() => clients.jfn),
}));
jest.unstable_mockModule('../lib/shopMarke.js', () => ({
  markeFuerShop: jest.fn(async () => null),
}));

let request, app;

const SKU = 'JH30F/UglySw01';

// Varianten in WooCommerce-Form, wie das Frontend sie schickt.
const varianten = (...namen) => [{
  attributes:    namen.map(n => ({ name: n, option: 'x' })),
  regular_price: '39.90',
}];
const attribute = (...namen) => namen.map(n => ({ name: n, options: ['x'], variation: true }));

beforeAll(async () => {
  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');
  const { default: router }  = await import('../routes/woocommerce.js');
  app = express();
  app.use(express.json());
  app.use('/api/woocommerce', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  clients.jfn = neuerClient();
  clients.jfn.post.mockResolvedValue({ data: { id: 555, sku: SKU } });
  clients.jfn.put.mockResolvedValue({ data: { id: 100, sku: SKU } });
  clients.jfn.get.mockResolvedValue({ data: { id: 100, sku: SKU, attributes: attribute('Größe') } });
});

afterEach(() => jest.restoreAllMocks());

const post = (body) => request(app).post('/api/woocommerce/products?shop=jfn').send(body);
const put  = (body) => request(app).put('/api/woocommerce/products/100?shop=jfn').send(body);

// ── Anlagepfad: streng ──────────────────────────────────────────────────────
describe('Anlagepfad blockiert ohne Farbachse', () => {
  test('Groesse ohne Farbe -> 400 mit Feldname, nichts wird angelegt', async () => {
    const res = await post({ sku: SKU, attributes: attribute('Größe'), variations: varianten('Größe') });

    expect(res.status).toBe(400);
    expect(res.body.feld).toBe('Variantenachsen');
    expect(res.body.error).toMatch(/Farbe/);
    expect(clients.jfn.post).not.toHaveBeenCalled();
  });

  // Die Rueckbausperre: alle drei enthalten "farbe", keine ist die Artikelfarbe.
  test.each([
    ['Druckfarbe'],
    ['Schriftfarbe'],
    ['Farbe des Wunschnamens'],
  ])('Groesse + %s -> blockiert', async (name) => {
    const res = await post({
      sku: SKU, attributes: attribute('Größe', name), variations: varianten('Größe', name),
    });

    expect(res.status).toBe(400);
    expect(res.body.feld).toBe('Variantenachsen');
    expect(clients.jfn.post).not.toHaveBeenCalled();
  });
});

describe('Anlagepfad laesst gueltige Artikel durch', () => {
  test('Farbe und Groesse', async () => {
    const res = await post({
      sku: SKU, attributes: attribute('Farbe', 'Größe'), variations: varianten('Farbe', 'Größe'),
    });

    // 201, nicht 200: der Anlagepfad setzt sie ausdruecklich (woocommerce.js,
    // res.status(201) - Created). Der Aenderungspfad antwortet dagegen mit 200.
    expect(res.status).toBe(201);
    expect(clients.jfn.post).toHaveBeenCalled();
  });

  test('nur Farbe', async () => {
    const res = await post({ sku: SKU, attributes: attribute('Farbe'), variations: varianten('Farbe') });
    expect(res.status).toBe(201);
  });

  test('Groesse + Farbe + Druckfarbe - die Farbe ist da', async () => {
    const res = await post({
      sku:        SKU,
      attributes: attribute('Größe', 'Farbe', 'Druckfarbe'),
      variations: varianten('Größe', 'Farbe', 'Druckfarbe'),
    });
    expect(res.status).toBe(201);
  });

  test('GAR KEINE Achse - Puck, Kuscheltier, Fan-Schal bleiben gueltig', async () => {
    const res = await post({ sku: SKU, attributes: [], variations: [] });

    expect(res.status).toBe(201);
    expect(clients.jfn.post).toHaveBeenCalled();
  });
});

// ── Aenderungspfad: nachsichtig (S2b) ───────────────────────────────────────
describe('Aenderungspfad laesst Bestandsartikel ohne Farbachse durch', () => {
  test('Achsen unveraendert -> 200 mit sichtbarem Hinweis, kein Abbruch', async () => {
    // Shop-Stand: Groesse, keine Farbe. Der Body schickt dieselbe Achse.
    const res = await put({
      sku: SKU, attributes: attribute('Größe'), variations: varianten('Größe'),
    });

    expect(res.status).toBe(200);
    expect(res.body.hinweis).toBeTruthy();
    expect(res.body.hinweis).toMatch(/Achsen unveraendert uebernommen/);
    expect(clients.jfn.put).toHaveBeenCalled();
  });

  test('der SHOP-Stand entscheidet, nicht der Body', async () => {
    await put({ sku: SKU, attributes: attribute('Größe'), variations: varianten('Größe') });
    expect(clients.jfn.get).toHaveBeenCalledWith('products/100');
  });

  test('Achsen GEAENDERT -> volle Regel, 400 mit Feldname', async () => {
    // Shop hat "Größe", der Body bringt "Größe + Druckfarbe": angefasst.
    const res = await put({
      sku:        SKU,
      attributes: attribute('Größe', 'Druckfarbe'),
      variations: varianten('Größe', 'Druckfarbe'),
    });

    expect(res.status).toBe(400);
    expect(res.body.feld).toBe('Variantenachsen');
    expect(clients.jfn.put).not.toHaveBeenCalled();
  });

  test('Achsen geaendert und Farbe ergaenzt -> geht durch, ohne Hinweis', async () => {
    const res = await put({
      sku:        SKU,
      attributes: attribute('Größe', 'Farbe'),
      variations: varianten('Größe', 'Farbe'),
    });

    expect(res.status).toBe(200);
    expect(res.body.hinweis).toBeNull();
  });

  test('Shop-Stand nicht lesbar -> streng, statt eine Achsenaenderung durchzuwinken', async () => {
    clients.jfn.get.mockRejectedValue(new Error('WC down'));

    const res = await put({
      sku: SKU, attributes: attribute('Größe'), variations: varianten('Größe'),
    });

    expect(res.status).toBe(400);
    expect(res.body.feld).toBe('Variantenachsen');
  });

  test('Teil-Update ohne Achsen im Body wird nicht an der Regel gemessen', async () => {
    // Nur ein Preis. Die Achsen stehen gar nicht im Body - daran darf das
    // Speichern nicht scheitern.
    const res = await put({ regular_price: '42.00' });

    expect(res.status).toBe(200);
    expect(clients.jfn.put).toHaveBeenCalled();
  });
});
