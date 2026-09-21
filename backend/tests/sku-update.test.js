// S2b - der Aenderungspfad ist milder als die Anlage.
//
// Nach S2 liess sich kein Bestandsartikel mit Alt-SKU mehr speichern, auch
// nicht fuer eine reine Preisaenderung. Das haette genau die Migration
// erzwungen, die S2 Punkt 7 ausschliesst - und weil die Artikelnummer der
// Upsert-Schluessel der Erfassungsmaske ist, legt jede SKU-Aenderung dort eine
// zweite Zeile an.
//
// Regel: unveraendert gegenueber dem SHOP-Stand -> durchlassen und melden;
// geaendert -> volle Regeln; Anlage -> unveraendert streng.

import { jest } from '@jest/globals';

const clients = {};
const neuerClient = () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() });

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient:   jest.fn(() => clients.jfn),
}));

let request, app;

// So sah eine SKU vor S2 aus: Titel hinter dem "/", 67 Zeichen.
const ALT_SKU  = 'JH30F/Nothing-Butt-A-Merry-Christmas-–-Ugly-Christmas-Sweater-Damen';
const NEU_SKU  = 'JH30F/UglySw01';

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
  // Shop-Stand: das Produkt traegt die alte SKU.
  clients.jfn.get.mockResolvedValue({ data: { id: 100, sku: ALT_SKU } });
  clients.jfn.put.mockResolvedValue({ data: { id: 100, sku: ALT_SKU } });
  clients.jfn.post.mockResolvedValue({ data: { id: 555 } });
});

afterEach(() => jest.restoreAllMocks());

const put = (body) => request(app).put('/api/woocommerce/products/100?shop=jfn').send(body);
const variationsBatch = () =>
  clients.jfn.post.mock.calls.find(c => c[0] === 'products/100/variations/batch')?.[1];

describe('Alt-SKU bleibt unveraendert', () => {
  test('reine Preisaenderung: 200 mit Hinweis, kein Abbruch', async () => {
    const res = await put({
      sku: ALT_SKU,
      regular_price: '39.90',
      variations: [{ id: 1, attributes: [{ name: 'Farbe', option: 'Navy' }], regular_price: '39.90' }],
    });

    expect(res.status).toBe(200);
    expect(res.body.hinweis).toBeTruthy();
    expect(res.body.hinweis).toMatch(/Unveraendert uebernommen/);
    expect(res.body.hinweis).toMatch(/kuerzen/);
    expect(clients.jfn.put).toHaveBeenCalled();
  });

  test('der Shop-Stand wird dafuer gelesen, nicht der Body geglaubt', async () => {
    await put({ sku: ALT_SKU, regular_price: '39.90' });
    expect(clients.jfn.get).toHaveBeenCalledWith('products/100');
  });

  test('Varianten-SKUs bleiben unangetastet - sonst reissen sie die 50 Zeichen', async () => {
    await put({
      sku: ALT_SKU,
      variations: [
        { id: 1, attributes: [{ name: 'Farbe', option: 'Navy' }], regular_price: '39.90' },
        { id: 2, attributes: [{ name: 'Farbe', option: 'Schwarz' }], regular_price: '39.90' },
      ],
    });

    const batch = variationsBatch();
    expect(batch).toBeDefined();
    expect(batch.update).toHaveLength(2);
    for (const v of batch.update) expect(v).not.toHaveProperty('sku');
  });

  test('ohne lesbaren Shop-Stand bleibt es streng', async () => {
    clients.jfn.get.mockRejectedValue(new Error('WC nicht erreichbar'));
    const res = await put({ sku: ALT_SKU, regular_price: '39.90' });
    expect(res.status).toBe(400);
    expect(res.body.feld).toBe('sku');
  });
});

describe('Alt-SKU wird geaendert', () => {
  test('auf eine gueltige: 200 und Varianten-SKUs werden gesetzt', async () => {
    clients.jfn.put.mockResolvedValue({ data: { id: 100, sku: NEU_SKU } });
    const res = await put({
      sku: NEU_SKU,
      variations: [
        { id: 1, attributes: [{ name: 'Farbe', option: 'Navy' }, { name: 'Größe', option: 'XL' }], regular_price: '39.90' },
        { id: 2, attributes: [{ name: 'Farbe', option: 'Grau meliert' }, { name: 'Größe', option: 'XL' }], regular_price: '39.90' },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.hinweis).toBeFalsy();

    const batch = variationsBatch();
    expect(batch.update.map(v => v.sku)).toEqual([
      'JH30F/UglySw01-navy-xl',
      'JH30F/UglySw01-grau-meliert-xl',
    ]);
  });

  test('auf eine ungueltige: 400 mit Feldname', async () => {
    const res = await put({ sku: 'JH30F/Viel Zu Lang Und Mit Leerzeichen', regular_price: '39.90' });
    expect(res.status).toBe(400);
    expect(res.body.feld).toBe('sku');
    expect(res.body.error).toBeTruthy();
    expect(clients.jfn.put).not.toHaveBeenCalled();
  });

  test('gueltige Nummer, aber zwei Varianten ergeben dieselbe SKU: 400', async () => {
    const res = await put({
      sku: NEU_SKU,
      variations: [
        { id: 1, attributes: [{ name: 'Farbe', option: 'Navy' }], regular_price: '1' },
        { id: 2, attributes: [{ name: 'Farbe', option: 'navy' }], regular_price: '1' },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dieselbe SKU/);
    expect(clients.jfn.put).not.toHaveBeenCalled();
  });
});

describe('PUT ohne sku im Body bleibt wie bisher', () => {
  test('keine Pruefung, kein GET, keine Varianten-SKUs', async () => {
    const res = await put({ name: 'Nur der Name' });
    expect(res.status).toBe(200);
    expect(clients.jfn.get).not.toHaveBeenCalled();
    expect(res.body.hinweis).toBeFalsy();
  });
});

describe('Der Anlage-Pfad bleibt streng', () => {
  test('Anlage mit Alt-SKU-Muster: 400 wie bisher', async () => {
    const res = await request(app).post('/api/woocommerce/products?shop=jfn')
      .send({ name: 'Neu', sku: ALT_SKU, type: 'variable' });

    expect(res.status).toBe(400);
    expect(res.body.feld).toBe('sku');
    expect(clients.jfn.post).not.toHaveBeenCalled();
  });

  test('Anlage ohne sku: 400, keine leere SKU im Shop', async () => {
    const res = await request(app).post('/api/woocommerce/products?shop=jfn')
      .send({ name: 'Neu', type: 'variable' });

    expect(res.status).toBe(400);
    expect(res.body.feld).toBe('sku');
  });
});
