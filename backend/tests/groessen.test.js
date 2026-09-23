// Befehl R: Groessen in WooCommerce aufsteigend.
//
// Anlass: Oldschool T-Shirt Herren (E3000, WC 21044). Gemessen 23.09. per GET:
// Groesse ist ein LOKALES Attribut (id 0), options =
//   ["4XL","3XL","2XL","XL","L","M","S","XS","5XL"]
// alle 18 Variationen menu_order 0. Der Aenderungspfad baute die Optionen aus
// der Variationsliste (neueste zuerst), 5XL kam danach hinten dran.
//
// Drei Ebenen wie sku.test.js:
//  1. backend/lib/groessen.js
//  2. der Block "Groessen" in index.html - muss dasselbe liefern
//  3. POST/PUT /api/woocommerce/products - was wirklich an WooCommerce geht

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const wc = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient:   jest.fn(() => wc),
}));

let lib, request, app;
beforeAll(async () => {
  lib = await import('../lib/groessen.js');
  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');
  const { default: router }  = await import('../routes/woocommerce.js');
  app = express();
  app.use(express.json());
  app.use('/api/woocommerce', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

let varId;
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  varId = 900;
  wc.get.mockReset(); wc.post.mockReset(); wc.put.mockReset();
  wc.post.mockImplementation(async (pfad, body) => pfad === 'products'
    ? { data: { id: 100, status: 'draft', sku: body.sku, meta_data: body.meta_data ?? [] } }
    : pfad.endsWith('/variations/batch') ? { data: {} }
    : { data: { id: ++varId, meta_data: body.meta_data ?? [] } });
  wc.put.mockImplementation(async () => ({ data: { id: 21044, meta_data: [] } }));
});
afterEach(() => jest.restoreAllMocks());

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von  = html.indexOf('// ── Groessen: Anfang');
const bis  = html.indexOf('// ── Groessen: Ende ──');
const fe   = new Function(`${html.slice(von, bis)}
  return { grIstGroessenAchse, grRang, grSortiere };`)();

// Jeder Fall laeuft durch Backend und Frontend-Spiegel.
function beide(werte) {
  const b = lib.sortiereGroessen(werte);
  expect(fe.grSortiere(werte)).toEqual(b);
  return b;
}

// ════════════════════════════════════════════════════════════════════════════
describe('Sortierfunktion (Backend = Frontend)', () => {
  test('Oldschool-Stand aus WooCommerce -> XS … 5XL', () => {
    expect(beide(['4XL', '3XL', '2XL', 'XL', 'L', 'M', 'S', 'XS', '5XL']).sortiert)
      .toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']);
  });

  test('ganze Leiter XXS … 8XL, unsortiert eingegeben', () => {
    const r = beide(['8XL', 'M', 'XXS', '3XL', 'S', '6XL', 'XL', 'XS', '2XL', 'L', '7XL', '5XL', '4XL']);
    expect(r.sortiert).toEqual(['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL', '7XL', '8XL']);
    expect(r.hinweis).toBeNull();
  });

  test('2XL und XXL sind gleichrangig und behalten die Eingabereihenfolge', () => {
    expect(beide(['XXL', 'L', '2XL']).sortiert).toEqual(['L', 'XXL', '2XL']);
    expect(beide(['XXXL', 'XXL']).sortiert).toEqual(['XXL', 'XXXL']);
  });

  test('Kindergroessen numerisch: 110/116 vor 122/128', () => {
    expect(beide(['134/146', '122/128', '98/104', '110/116', '152/164']).sortiert)
      .toEqual(['98/104', '110/116', '122/128', '134/146', '152/164']);
    expect(beide(['140', '92', '128']).sortiert).toEqual(['92', '128', '140']);
  });

  test('unbekannte Groesse -> ans Ende in Eingabereihenfolge, mit Hinweis', () => {
    const r = beide(['Einheitsgröße', 'L', 'Tall', 'S']);
    expect(r.sortiert).toEqual(['S', 'L', 'Einheitsgröße', 'Tall']);
    expect(r.unbekannt).toEqual(['Einheitsgröße', 'Tall']);
    expect(r.hinweis).toBe('Größe nicht einsortierbar (Einheitsgröße, Tall) – ans Ende gestellt.');
  });

  test('Buchstaben vor Zahlen', () => {
    expect(beide(['128', 'M', 'XS']).sortiert).toEqual(['XS', 'M', '128']);
  });

  test('Achsenname exakt: Größe/Groesse ja, Schuhgröße nein', () => {
    for (const n of ['Größe', 'größe', ' Groesse ', 'GRÖSSE']) {
      expect(lib.istGroessenAchse(n)).toBe(true);
      expect(fe.grIstGroessenAchse(n)).toBe(true);
    }
    for (const n of ['Schuhgröße', 'Farbe', 'Größen', '']) {
      expect(lib.istGroessenAchse(n)).toBe(false);
      expect(fe.grIstGroessenAchse(n)).toBe(false);
    }
  });

  test('Frontend-Block gefunden', () => {
    expect(von).toBeGreaterThan(-1);
    expect(bis).toBeGreaterThan(von);
  });
});

// ════════════════════════════════════════════════════════════════════════════
const v = (farbe, groesse, extra = {}) => ({
  attributes: [{ name: 'Farbe', option: farbe }, { name: 'Größe', option: groesse }],
  regular_price: '20', ...extra,
});
const groessenOptionen = body => body.attributes.find(a => a.name === 'Größe').options;
const varPosts = () => wc.post.mock.calls.filter(c => /\/variations$/.test(c[0])).map(c => c[1]);
const kurz     = b => b.attributes.map(a => a.option).join('-');

describe('Anlagepfad', () => {
  const EINGABE = {
    name: 'Shirt', sku: 'E3000/CH-Oldschool', type: 'variable', lieferzeit: '21',
    attributes: [
      { name: 'Farbe', options: ['Schwarz', 'Rot'], variation: true },
      { name: 'Größe', options: ['4XL', 'M', 'XS', 'L'], variation: true },
    ],
    variations: [v('Rot', 'L'), v('Schwarz', '4XL'), v('Rot', 'XS'), v('Schwarz', 'M'),
                 v('Schwarz', 'XS'), v('Rot', '4XL'), v('Schwarz', 'L'), v('Rot', 'M')],
  };

  test('unsortierte Eingabe -> Optionen sortiert, Variationen Farbe dann Groesse, menu_order fortlaufend', async () => {
    const res = await request(app).post('/api/woocommerce/products').send(EINGABE);
    expect(res.status).toBe(201);
    const produkt = wc.post.mock.calls.find(c => c[0] === 'products')[1];
    expect(groessenOptionen(produkt)).toEqual(['XS', 'M', 'L', '4XL']);
    expect(produkt.attributes.find(a => a.name === 'Farbe').options).toEqual(['Schwarz', 'Rot']);

    expect(varPosts().map(kurz)).toEqual([
      'Schwarz-XS', 'Schwarz-M', 'Schwarz-L', 'Schwarz-4XL',
      'Rot-XS', 'Rot-M', 'Rot-L', 'Rot-4XL',
    ]);
    expect(varPosts().map(b => b.menu_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('variation_ids und Varianten-SKUs bleiben am Index der Eingabe', async () => {
    const res = await request(app).post('/api/woocommerce/products').send(EINGABE);
    // Eingabe[0] = Rot-L wurde als 7. angelegt -> id 907
    expect(res.body.variation_ids[0]).toBe(907);
    expect(res.body.variation_ids[4]).toBe(901);                // Schwarz-XS zuerst
    const rotL = varPosts().find(b => kurz(b) === 'Rot-L');
    expect(rotL.sku).toBe('E3000/CH-Oldschool-rot-l');
  });

  test('unbekannte Groesse -> ans Ende, Hinweis in der Antwort', async () => {
    const res = await request(app).post('/api/woocommerce/products').send({
      ...EINGABE,
      attributes: [EINGABE.attributes[0], { name: 'Größe', options: ['Tall', 'L', 'S'], variation: true }],
      variations: [v('Schwarz', 'Tall'), v('Schwarz', 'L'), v('Schwarz', 'S')],
    });
    expect(res.status).toBe(201);
    expect(groessenOptionen(wc.post.mock.calls[0][1])).toEqual(['S', 'L', 'Tall']);
    expect(varPosts().map(kurz)).toEqual(['Schwarz-S', 'Schwarz-L', 'Schwarz-Tall']);
    expect(res.body.hinweis).toMatch(/Größe nicht einsortierbar \(Tall\)/);
  });

  test('Kindergroessen im Anlagepfad', async () => {
    await request(app).post('/api/woocommerce/products').send({
      ...EINGABE,
      attributes: [EINGABE.attributes[0], { name: 'Größe', options: ['122/128', '98/104', '110/116'], variation: true }],
      variations: [v('Schwarz', '122/128'), v('Schwarz', '98/104'), v('Schwarz', '110/116')],
    });
    expect(groessenOptionen(wc.post.mock.calls[0][1])).toEqual(['98/104', '110/116', '122/128']);
    expect(varPosts().map(kurz)).toEqual(['Schwarz-98/104', 'Schwarz-110/116', 'Schwarz-122/128']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Aenderungspfad (Oldschool + 5XL)', () => {
  // Wie der Aenderungspfad den Body baut: Optionen in Lieferreihenfolge der
  // Variationen (neueste zuerst), 5XL als neue Variante ohne id.
  const BESTAND = [
    [21060, 'Rot', '4XL'], [21059, 'Rot', '3XL'], [21058, 'Rot', '2XL'], [21057, 'Rot', 'XL'],
    [21056, 'Rot', 'L'], [21055, 'Rot', 'M'], [21054, 'Rot', 'S'], [21053, 'Rot', 'XS'],
    [21052, 'Schwarz', '4XL'], [21051, 'Schwarz', '3XL'], [21050, 'Schwarz', '2XL'], [21049, 'Schwarz', 'XL'],
    [21048, 'Schwarz', 'L'], [21047, 'Schwarz', 'M'], [21046, 'Schwarz', 'S'], [21045, 'Schwarz', 'XS'],
  ];
  const BODY = {
    name: 'Crocodiles Hamburg Oldschool T-Shirt Herren', status: 'draft',
    attributes: [
      { name: 'Farbe', options: ['Rot', 'Schwarz'], variation: true, visible: true },
      { name: 'Größe', options: ['4XL', '3XL', '2XL', 'XL', 'L', 'M', 'S', 'XS', '5XL'], variation: true, visible: true },
    ],
    variations: [
      ...BESTAND.map(([id, f, g]) => ({ id, ...v(f, g) })),
      v('Rot', '5XL'), v('Schwarz', '5XL'),
    ],
  };

  test('Optionen neu sortiert: 5XL hinter 4XL', async () => {
    const res = await request(app).put('/api/woocommerce/products/21044').send(BODY);
    expect(res.status).toBe(200);
    expect(groessenOptionen(wc.put.mock.calls[0][1]))
      .toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']);
    expect(wc.put.mock.calls[0][1].attributes.find(a => a.name === 'Farbe').options).toEqual(['Rot', 'Schwarz']);
  });

  test('neue Variationen: menu_order passend, "-1"; bestehende: kein menu_order, nichts Neues', async () => {
    await request(app).put('/api/woocommerce/products/21044').send(BODY);
    const batch = wc.post.mock.calls.find(c => c[0].endsWith('/variations/batch'))[1];

    // Rot zuerst (Farb-Optionen), je XS … 5XL: Rot-5XL = 9, Schwarz-5XL = 18
    expect(batch.create.map(b => [kurz(b), b.menu_order])).toEqual([['Rot-5XL', 9], ['Schwarz-5XL', 18]]);
    for (const b of batch.create) expect(b.meta_data).toEqual([{ key: '_lieferzeit', value: '-1' }]);

    expect(batch.update).toHaveLength(16);
    for (const b of batch.update) {
      expect(b.menu_order).toBeUndefined();
      expect(b.meta_data).toBeUndefined();
      expect(Object.keys(b).sort()).toEqual(['attributes', 'id', 'regular_price']);
    }
  });

  test('PUT ohne Attribute (z. B. nur Status) sortiert nichts und schickt keine Attribute', async () => {
    await request(app).put('/api/woocommerce/products/21044').send({ status: 'publish' });
    expect(wc.put.mock.calls[0][1]).toEqual({ status: 'publish' });
  });

  test('unbekannte Groesse im Aenderungspfad -> groessen_hinweis', async () => {
    const res = await request(app).put('/api/woocommerce/products/21044').send({
      attributes: [{ name: 'Farbe', options: ['Rot'] }, { name: 'Größe', options: ['Tall', 'M'] }],
    });
    expect(groessenOptionen(wc.put.mock.calls[0][1])).toEqual(['M', 'Tall']);
    expect(res.body.groessen_hinweis).toMatch(/Tall/);
  });
});
