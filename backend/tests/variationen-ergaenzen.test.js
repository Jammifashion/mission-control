// Befehl V: "Neue Varianten anlegen" ergaenzt, statt zu ersetzen.
//
// GEMESSEN 23.09. an einem Entwurf (WC 21082, danach force-geloescht):
//   lokales Attribut Groesse [S, M], zwei Variationen. Der alte Knopf schickte
//   PUT products/21082 {"attributes":[{"name":"Größe","options":["L"],...}]}
//   POST products/21082/variations {"attributes":[{"name":"Größe","option":"L"}],...}
//   -> options danach ["L"]. S und M waren aus dem Auswahlfeld verschwunden,
//   ihre Variationen blieben stehen. Alle drei ohne _lieferzeit, menu_order 0.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const wc = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient:   jest.fn(() => wc),
}));

let request, app;
beforeAll(async () => {
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  const { default: router } = await import('../routes/woocommerce.js');
  app = express();
  app.use(express.json());
  app.use('/api/woocommerce', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

const va = (id, farbe, groesse) => ({
  id, menu_order: 0, sku: '', regular_price: '20',
  attributes: [
    ...(farbe ? [{ id: 0, name: 'Farbe', option: farbe }] : []),
    { id: 0, name: 'Größe', option: groesse },
  ],
});
const neu = (farbe, groesse) => ({
  attributes: [
    ...(farbe ? [{ name: 'Farbe', option: farbe }] : []),
    { name: 'Größe', option: groesse },
  ],
  regular_price: '20',
});

let shop;   // { produkt, variationen }
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  wc.get.mockReset(); wc.post.mockReset(); wc.put.mockReset(); wc.delete.mockReset();
  wc.get.mockImplementation(async pfad => ({ data: pfad.endsWith('/variations') ? shop.variationen : shop.produkt }));
  wc.put.mockImplementation(async (_p, body) => ({ data: { id: shop.produkt.id, ...body } }));
  wc.post.mockImplementation(async (_p, body) => ({
    data: { create: (body.create ?? []).map((c, i) => ({ id: 9000 + i, ...c })) },
  }));
});
afterEach(() => jest.restoreAllMocks());

const post = body => request(app).post(`/api/woocommerce/products/${shop.produkt.id}/variationen-ergaenzen`).send(body);
const putBody   = () => wc.put.mock.calls[0]?.[1];
const batchBody = () => wc.post.mock.calls.find(c => c[0].endsWith('/variations/batch'))?.[1];
const optionen  = (name) => putBody().attributes.find(a => a.name === name).options;

// ════════════════════════════════════════════════════════════════════════════
describe('Messfall nachgestellt: [S, M] + L', () => {
  beforeEach(() => {
    shop = {
      produkt: {
        id: 21082, sku: 'TEST/Befehl-V',
        attributes: [{ id: 0, name: 'Größe', position: 0, visible: true, variation: true, options: ['S', 'M'] }],
      },
      variationen: [va(21084, null, 'M'), va(21083, null, 'S')],
    };
  });

  test('Optionen behalten S und M (frueher: nur ["L"])', async () => {
    const res = await post({ variations: [neu(null, 'L')] });
    expect(res.status).toBe(201);
    expect(optionen('Größe')).toEqual(['S', 'M', 'L']);
    expect(res.body.optionen).toEqual([{ name: 'Größe', options: ['S', 'M', 'L'] }]);
  });

  test('neue Variation traegt "-1", menu_order und Varianten-SKU', async () => {
    await post({ variations: [neu(null, 'L')] });
    const [c] = batchBody().create;
    expect(c.meta_data).toEqual([{ key: '_lieferzeit', value: '-1' }]);
    expect(c.menu_order).toBe(3);
    expect(c.sku).toBe('TEST/Befehl-V-l');
    expect(c.status).toBe('publish');
  });

  test('bestehende Variationen unangetastet: kein update, kein PUT auf Variationen', async () => {
    await post({ variations: [neu(null, 'L')] });
    expect(batchBody().update).toBeUndefined();
    expect(wc.put).toHaveBeenCalledTimes(1);                     // nur das Produkt
    expect(wc.put.mock.calls[0][0]).toBe('products/21082');
    expect(Object.keys(putBody())).toEqual(['attributes']);
    expect(wc.post.mock.calls.filter(c => /\/variations$/.test(c[0]))).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Oldschool: Farbe x Groesse, Shop-Optionen unsortiert, + 5XL', () => {
  beforeEach(() => {
    const groessen = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];
    let id = 21045;
    const vars = [];
    for (const f of ['Schwarz', 'Rot']) for (const g of groessen) vars.push(va(id++, f, g));
    shop = {
      produkt: {
        id: 21044, sku: 'E3000/CH-Oldschool',
        attributes: [
          { id: 0, name: 'Farbe', visible: true, variation: true, options: ['Rot', 'Schwarz'] },
          { id: 0, name: 'Größe', visible: true, variation: true, options: ['4XL', '3XL', '2XL', 'XL', 'L', 'M', 'S', 'XS'] },
        ],
      },
      variationen: vars.reverse(),                               // neueste zuerst, wie die REST
    };
  });

  test('Optionen vereinigt und sortiert, Farben unveraendert', async () => {
    const res = await post({ variations: [neu('Rot', '5XL'), neu('Schwarz', '5XL')] });
    expect(res.status).toBe(201);
    expect(optionen('Größe')).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']);
    expect(optionen('Farbe')).toEqual(['Rot', 'Schwarz']);
    expect(res.body.angelegt).toBe(2);
  });

  test('menu_order nach Platz in der Gesamtliste (Rot zuerst, XS … 5XL)', async () => {
    await post({ variations: [neu('Rot', '5XL'), neu('Schwarz', '5XL')] });
    expect(batchBody().create.map(c => [c.attributes.map(a => a.option).join('-'), c.menu_order, c.sku]))
      .toEqual([
        ['Rot-5XL', 9, 'E3000/CH-Oldschool-rot-5xl'],
        ['Schwarz-5XL', 18, 'E3000/CH-Oldschool-schwarz-5xl'],
      ]);
    for (const c of batchBody().create) expect(c.meta_data).toEqual([{ key: '_lieferzeit', value: '-1' }]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Randfaelle', () => {
  beforeEach(() => {
    shop = {
      produkt: {
        id: 500, sku: 'JH30F/UglySw01',
        attributes: [{ id: 2, name: 'Größe', visible: true, variation: true, options: ['M', 'S'] }],
      },
      variationen: [va(501, null, 'S'), va(502, null, 'M')],
    };
  });

  test('globales Attribut behaelt seine id', async () => {
    await post({ variations: [neu(null, 'L')] });
    expect(putBody().attributes[0]).toMatchObject({ id: 2, name: 'Größe', options: ['S', 'M', 'L'] });
  });

  test('schon vorhandene Kombination wird nicht doppelt angelegt', async () => {
    const res = await post({ variations: [neu(null, 'M'), neu(null, 'L')] });
    expect(res.body.doppelt).toBe(1);
    expect(batchBody().create).toHaveLength(1);
  });

  test('nur Vorhandenes -> nichts geschrieben', async () => {
    const res = await post({ variations: [neu(null, 'S')] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ angelegt: 0, doppelt: 1 });
    expect(wc.put).not.toHaveBeenCalled();
    expect(wc.post).not.toHaveBeenCalled();
  });

  test('regelwidrige Alt-Artikelnummer -> angelegt ohne SKU, mit Hinweis', async () => {
    shop.produkt.sku = 'VIEL-ZU-LANGE-ALTE-ARTIKELNUMMER-OHNE-SCHRAEGSTRICH-1234567890';
    const res = await post({ variations: [neu(null, 'L')] });
    expect(res.status).toBe(201);
    expect(batchBody().create[0].sku).toBeUndefined();
    expect(batchBody().create[0].meta_data).toEqual([{ key: '_lieferzeit', value: '-1' }]);
    expect(res.body.hinweis).toMatch(/Varianten-SKUs der neuen Varianten wurden deshalb nicht gesetzt/);
  });

  test('unbekannte Groesse -> ans Ende, groessen_hinweis', async () => {
    const res = await post({ variations: [neu(null, 'Tall')] });
    expect(optionen('Größe')).toEqual(['S', 'M', 'Tall']);
    expect(res.body.groessen_hinweis).toMatch(/Tall/);
  });

  test('leerer Body -> 400, nichts gelesen oder geschrieben', async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(wc.get).not.toHaveBeenCalled();
    expect(wc.put).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Frontend: der Knopf nutzt den neuen Weg', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const von  = html.indexOf("getElementById('btn-add-new-variants').addEventListener");
  const bis  = html.indexOf('// Tabelle neu laden', von);
  const handler = html.slice(von, bis);

  test('ein Aufruf an variationen-ergaenzen, kein PUT mit Attributen, kein Einzel-POST', () => {
    expect(von).toBeGreaterThan(-1);
    expect(handler).toContain('/variationen-ergaenzen');
    expect(handler).not.toMatch(/method:\s*'PUT'/);
    expect(handler).not.toMatch(/\/variations`/);
  });
});
