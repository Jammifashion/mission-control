// Hauptbild (Artikelbild) des Elternartikels - optionales Feld in Block 1.
//
// Das Backend baut hier nichts: "images" faellt in POST /products unter
// ...rest und geht unveraendert an WooCommerce. Genau das pruefen die
// Route-Tests - samt der Zusicherung, dass Variantenbilder dabei nicht
// angefasst und nicht automatisch befuellt werden.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const clients = {};
const neuerClient = () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() });

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient:   jest.fn(() => clients.jfn),
}));

let request, app;

const SKU = 'JF/Hoodie-01';

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
  clients.jfn.post.mockImplementation(async (pfad, body) => pfad === 'products'
    ? { data: { id: 100, status: 'draft', sku: body.sku, images: body.images ?? [] } }
    : { data: { id: 555 } });
});

afterEach(() => jest.restoreAllMocks());

const anlegen = (body) => request(app).post('/api/woocommerce/products?shop=jfn')
  .send({ name: 'Hoodie', sku: SKU, type: 'variable', shipping_class: 'paket', ...body });

const produktPayload = () => clients.jfn.post.mock.calls.find(c => c[0] === 'products')?.[1];
const variantenPayloads = () => clients.jfn.post.mock.calls
  .filter(c => c[0] === 'products/100/variations').map(c => c[1]);

describe('Anlage ohne Hauptbild', () => {
  test('geht durch - images bleibt weg, kein leeres Feld', async () => {
    const res = await anlegen({});
    expect(res.status).toBe(201);
    expect(produktPayload()).not.toHaveProperty('images');
  });

  test('auch mit Varianten, die selbst kein Bild haben', async () => {
    const res = await anlegen({
      variations: [{ attributes: [{ name: 'Farbe', option: 'Navy' }], regular_price: '20' }],
    });
    expect(res.status).toBe(201);
    expect(produktPayload()).not.toHaveProperty('images');
    expect(variantenPayloads()[0]).not.toHaveProperty('image');
  });
});

describe('Anlage mit Hauptbild', () => {
  test('setzt es am Elternartikel', async () => {
    const res = await anlegen({ images: [{ id: 900 }] });
    expect(res.status).toBe(201);
    expect(produktPayload().images).toEqual([{ id: 900 }]);
  });

  test('Variantenbilder werden nicht ueberschrieben', async () => {
    await anlegen({
      images: [{ id: 900 }],
      variations: [
        { attributes: [{ name: 'Farbe', option: 'Navy' }],    regular_price: '20', image: { id: 111 } },
        { attributes: [{ name: 'Farbe', option: 'Schwarz' }], regular_price: '20', image: { id: 222 } },
      ],
    });

    const v = variantenPayloads();
    expect(v.map(x => x.image)).toEqual([{ id: 111 }, { id: 222 }]);
    // Das Hauptbild darf sich in keine Variante schleichen.
    expect(v.some(x => x.image?.id === 900)).toBe(false);
  });

  test('Varianten ohne eigenes Bild bekommen keines untergeschoben', async () => {
    await anlegen({
      images: [{ id: 900 }],
      variations: [
        { attributes: [{ name: 'Farbe', option: 'Navy' }],    regular_price: '20', image: { id: 111 } },
        { attributes: [{ name: 'Farbe', option: 'Schwarz' }], regular_price: '20' },
      ],
    });

    const v = variantenPayloads();
    expect(v[0].image).toEqual({ id: 111 });
    expect(v[1]).not.toHaveProperty('image');   // WooCommerce faellt selbst aufs Hauptbild zurueck
  });
});

describe('Frontend-Verdrahtung', () => {
  const html = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8',
  );

  test('Feld steht in Block 1 Stammdaten, vor Block 3', () => {
    const stamm = html.indexOf('1 — Stammdaten');
    const feld  = html.indexOf('id="pf-hauptbild-file"');
    const block3 = html.indexOf('3 — Artikeleigenschaften');
    expect(stamm).toBeGreaterThan(-1);
    expect(feld).toBeGreaterThan(stamm);
    expect(feld).toBeLessThan(block3);
  });

  test('Datei-Auswahl, Hochladen-Button und Hinweistext vorhanden', () => {
    // Attribut-Reihenfolge im Tag ist egal - geprueft wird das Tag als Ganzes.
    const dateiTag = html.match(/<input[^>]*id="pf-hauptbild-file"[^>]*>/)?.[0];
    expect(dateiTag).toBeDefined();
    expect(dateiTag).toContain('type="file"');
    expect(dateiTag).toContain('accept="image/*"');

    expect(html).toMatch(/<button[^>]*id="pf-hauptbild-upload"[^>]*>/);
    expect(html).toContain('Gilt für alle Varianten ohne eigenes Bild.');
    expect(html).toMatch(/Hauptbild \(Artikelbild\)[\s\S]{0,80}\(optional\)/);
  });

  test('gleiche Upload-Mechanik wie bei den Variantenbildern', () => {
    const start = html.indexOf("getElementById('pf-hauptbild-upload').addEventListener");
    const block = html.slice(start, start + 1400);
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('/api/artikel/media-upload');
    expect(block).toMatch(/fd\.append\('file', file\)/);
    expect(block).toMatch(/data\.attachmentId/);
    expect(block).toMatch(/data\.sourceUrl/);
  });

  test('beide Push-Pfade: ausdrueckliches Hauptbild gewinnt, sonst Altverhalten', () => {
    const treffer = [...html.matchAll(
      /const mainImageId = hauptbildId \?\? activeVariants\.find\(v => v\.imageId\)\?\.imageId;/g,
    )];
    expect(treffer).toHaveLength(2);   // Anlage und Aenderung
    expect(html).not.toMatch(/const mainImageId = activeVariants\.find/);
  });

  test('beim Bearbeiten wird das vorhandene Hauptbild uebernommen', () => {
    expect(html).toMatch(/const wcHauptbild = \(p\.images \|\| \[\]\)\[0\]/);
    expect(html).toMatch(/setzeHauptbild\(wcHauptbild\?\.id \?\? null, wcHauptbild\?\.src \?\? ''\)/);
  });

  test('kein automatisches Kopieren des Hauptbildes in die Varianten', () => {
    // Variantenbilder duerfen ausschliesslich aus v.imageId stammen.
    const varianten = [...html.matchAll(/image: \{ id: ([^}]+) \}/g)].map(m => m[1].trim());
    for (const quelle of varianten) expect(quelle).not.toContain('hauptbild');
  });

  test('resetForm leert das Feld', () => {
    const start = html.indexOf('function resetForm()');
    const block = html.slice(start, html.indexOf('\n      }', start));
    expect(block).toMatch(/setzeHauptbild\(null, ''\)/);
  });
});
