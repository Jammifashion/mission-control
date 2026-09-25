// Befehl M3 an den Backend-Routen.
//
//  - POST /api/woocommerce/products: Versandklasse Pflicht (400, feld
//    shipping_class, nichts angelegt); jede neue Variation traegt
//    _wc_gla_color = Farbwert 1:1 ("Black/Kelly Green").
//  - PUT /api/woocommerce/products/:id: ohne Versandklasse wird gespeichert,
//    die Antwort traegt einen Hinweis (S2b-Muster).
//  - strukturiert ({ faser, grammatur } aus lib/lshop.js) kommt bei
//    /api/seo/meta-eingaben und seo_description im Ergebnis bzw. Prompt an.

import { jest } from '@jest/globals';

const clients = {};
const neuerClient = () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() });
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient:   jest.fn(() => clients.jfn),
}));
jest.unstable_mockModule('../lib/shopMarke.js', () => ({ markeFuerShop: jest.fn(async () => null) }));

const getModel        = jest.fn();
const generateContent = jest.fn();
jest.unstable_mockModule('../lib/modelConfig.js', () => ({ getModel }));
jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: () => ({ generateContent }) })),
}));
jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => ({ messages: { create: jest.fn() } })),
}));

let request, app;

beforeAll(async () => {
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  app = express();
  app.use(express.json());
  app.use('/api/woocommerce', (await import('../routes/woocommerce.js')).default);
  app.use('/api/claude',      (await import('../routes/claude.js')).default);
  app.use('/api/seo',         (await import('../routes/seo-meta.js')).default);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  clients.jfn = neuerClient();
  let varId = 700;
  clients.jfn.post.mockImplementation(async (pfad, body) => (pfad === 'products'
    ? { data: { id: 555, sku: body.sku, status: 'draft', meta_data: body.meta_data ?? [] } }
    : { data: { id: ++varId, meta_data: body.meta_data ?? [] } }));
  clients.jfn.put.mockResolvedValue({ data: { id: 100, sku: 'CB166R/CH-Matchday', meta_data: [] } });
  clients.jfn.get.mockResolvedValue({ data: { id: 100, sku: 'CB166R/CH-Matchday', attributes: [] } });
});
afterEach(() => jest.restoreAllMocks());

const DREI = ['Black/Kelly Green', 'Black/Red', 'Black/White'];
const CAP = {
  name: 'Match Day Cap Crocodiles Hamburg', sku: 'CB166R/CH-Matchday', type: 'variable',
  lieferzeit: '21', shipping_class: 'paket',
  attributes: [{ name: 'Farbe', options: DREI, variation: true, visible: true }],
  variations: DREI.map(f => ({ attributes: [{ name: 'Farbe', option: f }], regular_price: '25' })),
};
const varPosts = () => clients.jfn.post.mock.calls.filter(c => /\/variations$/.test(c[0])).map(c => c[1]);

describe('POST /products: Versandklasse Pflicht', () => {
  test.each([undefined, '', '   '])('shipping_class %p -> 400 mit Feldname, nichts angelegt', async (sc) => {
    const res = await request(app).post('/api/woocommerce/products').send({ ...CAP, shipping_class: sc });
    expect(res.status).toBe(400);
    expect(res.body.feld).toBe('shipping_class');
    expect(res.body.error).toMatch(/Versandklasse fehlt/);
    expect(clients.jfn.post).not.toHaveBeenCalled();
  });

  test('mit Versandklasse -> angelegt, Klasse am Elternartikel', async () => {
    const res = await request(app).post('/api/woocommerce/products').send(CAP);
    expect(res.status).toBe(201);
    expect(clients.jfn.post.mock.calls[0][1].shipping_class).toBe('paket');
  });
});

describe('POST /products: _wc_gla_color je neuer Variation', () => {
  test('= Farbwert 1:1, neben _lieferzeit "-1"', async () => {
    await request(app).post('/api/woocommerce/products').send(CAP);
    const metas = varPosts().map(b => b.meta_data);
    expect(metas).toEqual(DREI.map(f => [
      { key: '_lieferzeit', value: '-1' },
      { key: '_wc_gla_color', value: f },
    ]));
  });

  test('ohne Farbachse kein _wc_gla_color', async () => {
    await request(app).post('/api/woocommerce/products').send({
      ...CAP, sku: 'X1/Ohne-Farbe', attributes: [], variations: [{ attributes: [], regular_price: '5' }],
    });
    expect(varPosts()[0].meta_data).toEqual([{ key: '_lieferzeit', value: '-1' }]);
  });
});

describe('PUT /products/:id: Versandklasse nachsichtig', () => {
  test('leer -> gespeichert, Hinweis in der Antwort', async () => {
    const res = await request(app).put('/api/woocommerce/products/100').send({ name: 'Alt', shipping_class: '' });
    expect(res.status).toBe(200);
    expect(clients.jfn.put).toHaveBeenCalled();
    expect(res.body.hinweis).toMatch(/keine Versandklasse gesetzt/);
  });

  test('gesetzt oder nicht mitgeschickt -> kein Versand-Hinweis', async () => {
    for (const body of [{ name: 'Alt', shipping_class: 'paket' }, { name: 'Alt' }]) {
      const res = await request(app).put('/api/woocommerce/products/100').send(body);
      expect(String(res.body.hinweis ?? '')).not.toMatch(/Versandklasse/);
    }
  });
});

describe('strukturiert wird durchgereicht', () => {
  test('POST /api/seo/meta-eingaben: Struktur schlaegt Freitext', async () => {
    const res = await request(app).post('/api/seo/meta-eingaben').send({
      eigenschaften: 'Material: 100% Baumwolle\nGrammatur: 180 g/m²',
      farben: DREI, groessen: [],
      strukturiert: { faser: '100% Polyester', grammatur: null },
    });
    expect(res.body).toEqual({ faserangabe: '100% Polyester', faserMeldung: null, grammatur: null });
  });

  test('seo_description: Material aus der Struktur im Prompt', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini';
    getModel.mockResolvedValue('gemini-3.5-flash-lite');
    generateContent.mockResolvedValue({ response: { text: () => JSON.stringify({
      kurzbeschreibung: 'Match Day Cap Crocodiles Hamburg, jetzt bestellen.',
      produktbeschreibung: '<h2>Schirm und Stoff</h2><p>Match Day Cap Crocodiles Hamburg aus Polyester.</p>',
    }) } });
    const res = await request(app).post('/api/claude/generate-product').send({
      action: 'seo_description', produktname: 'Match Day Cap Crocodiles Hamburg', modus: 'kollektion',
      eigenschaften: 'Material: 100% Baumwolle', farben: DREI, groessen: [],
      strukturiert: { faser: '100% Polyester', grammatur: null },
    });
    expect(res.status).toBe(200);
    const prompt = JSON.stringify(generateContent.mock.calls[0]);
    expect(prompt).toContain('- Material: 100% Polyester');
    expect(prompt).not.toContain('100% Baumwolle');
  });
});

describe('Farbwoerter mit L-Shop-Namen (Punkt 7, bestehender Filter unveraendert)', () => {
  let filter;
  beforeAll(async () => { ({ filterMaterialFarbenMitMeldung: filter } = await import('../lib/seo-prompt.js')); });
  const m = (t, f) => filter(t, f).material;

  test('Klammer mit Kurzname trifft die L-Shop-Farbe mit Zusatz', () => {
    const t = '100% Baumwolle (Sports Grey: 85% Baumwolle / 15% Viskose)';
    expect(m(t, ['Sports Grey (Heather)'])).toBe(t);
    expect(m(t, ['Black'])).toBe('100% Baumwolle');
  });

  test('Zweifarbige Werte: Teilfarbe haelt die Klammer, fremde faellt', () => {
    const t = '100% Polyester (Kelly Green: 80% Polyester / 20% Baumwolle)';
    expect(m(t, ['Black/Kelly Green'])).toBe(t);
    expect(m(t, ['Black/Red'])).toBe('100% Polyester');
    expect(m('100% Polyester', DREI)).toBe('100% Polyester');
  });
});
