// Befehl VR3: Server-Sperre gegen doppelte Variationen.
//  - PUT /products/:id liest vor jedem create die Shop-Variationen (alle Seiten) und
//    legt Kombinationen, die es schon gibt, NICHT an -> `vorhanden` mit deren id.
//  - Doppel im Request: nur einmal anlegen -> `doppelt_im_request`.
//  - Shop-Liste nicht lesbar: nichts anlegen, 502 mit Grund (kein stiller Rueckfall).
//  - variationen-ergaenzen nutzt denselben Schluessel (wcSchluessel: Umlaute, ß, Gross/Klein).
//  - update bestehender Variationen bleibt, wie es war.
// Befund VR2 Stufe 3: Produkt 20996, Farbachse entfernt -> 7 Groessen als "neu" angelegt.
// Alle Werte sind Platzhalter.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: () => ({ spreadsheets: { values: { get: async () => ({ data: { values: [
    ['Term_ID', 'Name', 'Slug', 'Standard'], [21, 'ca. 5-6 Werktage', 'x', 'ja'],
  ] } }) } } }) },
}));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));
const wc = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient:   jest.fn(() => wc),
}));

const lib = await import('../lib/wc-variation-ids.js');

const html  = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = (a, e) => html.slice(html.indexOf(a), html.indexOf(e));
const fe = new Function(`${block('// ── Farbachsen-Regel: Anfang', '// ── Farbachsen-Regel: Ende ──')}
${block('// ── L-Shop-Modell: Anfang', '// ── L-Shop-Modell: Ende ──')}
${block('// ── WC-IDs: Anfang', '// ── WC-IDs: Ende ──')}
return { wcIdsUebernehmen };`)();

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

const G7 = ['3XL', '2XL', 'XL', 'L', 'M', 'S', 'XS'];
const nurGroesse = (id, g) => ({ id, attributes: [{ id: 2, name: 'Größe', option: g }] });
const fg = (id, farbe, g) => ({ id, attributes: [{ id: 1, name: 'Farbe', option: farbe }, { id: 2, name: 'Größe', option: g }] });
const neuG = g => ({ attributes: [{ name: 'Größe', option: g }], regular_price: '30' });
const neuFG = (farbe, g) => ({ attributes: [{ name: 'Farbe', option: farbe }, { name: 'Größe', option: g }], regular_price: '30' });

let shopVariationen;   // was GET products/:id/variations liefert (nach dem Produkt-PUT)
let getFehler;         // Fehler beim Lesen der Variationen
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  wc.get.mockReset(); wc.post.mockReset(); wc.put.mockReset();
  shopVariationen = []; getFehler = null;
  wc.get.mockImplementation(async (pfad, params = {}) => {
    if (pfad.endsWith('/variations')) {
      if (getFehler) throw getFehler;
      const page = params.page ?? 1;
      return { data: shopVariationen.slice((page - 1) * 100, page * 100) };
    }
    return { data: { id: 20996, sku: 'BCWW03Q/CH-Skyline', attributes: [{ id: 2, name: 'Größe', variation: true, visible: true, options: G7 }] } };
  });
  wc.put.mockImplementation(async (_p, body) => ({ data: { id: 20996, meta_data: [], ...body } }));
  let n = 30000;
  wc.post.mockImplementation(async (_p, body) => ({ data: {
    update: (body.update ?? []).map(u => ({ id: u.id })),
    create: (body.create ?? []).map(c => ({ id: ++n, attributes: c.attributes })),
  } }));
});
afterEach(() => jest.restoreAllMocks());

const batchBodies = () => wc.post.mock.calls.filter(c => c[0].endsWith('/variations/batch')).map(c => c[1]);
const put = body => request(app).put('/api/woocommerce/products/20996').send({ name: 'Skyline Zip Hoodie', ...body });

// ── Lib ─────────────────────────────────────────────────────────────────────
describe('sperreDoppelte (lib)', () => {
  test('Umlaut, ß, Gross/Klein, 2XL/2xl, Achsenreihenfolge -> vorhanden', () => {
    const shop = [fg(1, 'Weiß', '2XL'), { id: 2, attributes: [{ name: 'Groesse', option: 'M' }, { name: 'Farbe', option: 'Grün' }] }];
    const s = lib.sperreDoppelte([
      { attributes: [{ name: 'Größe', option: '2xl' }, { name: 'farbe', option: 'weiss' }] },
      { attributes: [{ name: 'GRÖSSE', option: 'm' }, { name: 'Farbe', option: 'gruen' }] },
      neuFG('Weiß', '3XL'),
    ], shop);
    expect(s.anlegen).toEqual([2]);
    expect(s.vorhanden.map(v => [v.index, v.id])).toEqual([[0, 1], [1, 2]]);
    expect(s.doppelt).toEqual([]);
  });

  test('Doppel im Request -> nur die erste anlegen', () => {
    const s = lib.sperreDoppelte([neuG('L'), neuG('l'), neuG('M')], []);
    expect(s.anlegen).toEqual([0, 2]);
    expect(s.doppelt).toEqual([{ index: 1, kombination: 'Größe=l' }]);
    expect(lib.sperreHinweis(s)).toBe('1 Varianten standen doppelt in der Anfrage – nur einmal angelegt (Größe=l).');
  });

  test('leseAlleVariationen: alle Seiten; keine Liste -> Fehler', async () => {
    shopVariationen = Array.from({ length: 150 }, (_, i) => nurGroesse(i + 1, `G${i}`));
    expect(await lib.leseAlleVariationen(wc, 1)).toHaveLength(150);
    wc.get.mockResolvedValueOnce({ data: { message: 'x' } });
    await expect(lib.leseAlleVariationen(wc, 1)).rejects.toThrow('Antwort ohne Liste');
  });
});

// ── PUT /products/:id ───────────────────────────────────────────────────────
describe('PUT /products/:id - Sperre vor dem create', () => {
  test('Fall 20996: Achse entfernt, 7 "neue" Groessen treffen vorhandene -> 0 angelegt, 7 vorhanden', async () => {
    // Nach dem Produkt-PUT ohne Farbachse meldet WooCommerce den Bestand nur mit Groesse.
    shopVariationen = G7.map((g, i) => nurGroesse(21003 - i, g));
    const res = await put({ attributes: [{ name: 'Größe', options: G7, variation: true, visible: true }], variations: G7.map(neuG) });
    expect(res.status).toBe(200);
    expect(batchBodies()).toEqual([]);                       // kein create, kein update
    expect(res.body.variationen_neu).toEqual([]);
    expect(res.body.vorhanden).toHaveLength(7);
    expect(res.body.vorhanden[0]).toEqual({ kombination: 'Größe=3XL', id: 21003, attributes: [{ name: 'Größe', option: '3XL' }] });
    expect(res.body.variationen_hinweis).toMatch(/^7 Varianten existierten bereits – nicht doppelt angelegt/);
    // Reihenfolge: erst Produkt-PUT, dann Liste lesen.
    const putOrder = wc.put.mock.invocationCallOrder[0];
    const getOrder = wc.get.mock.invocationCallOrder[wc.get.mock.calls.findIndex(c => c[0].endsWith('/variations'))];
    expect(putOrder).toBeLessThan(getOrder);

    // Oberflaeche: vorhandene IDs ueber denselben Helfer (nur leere IDs).
    const variants = G7.map(g => ({ attrs: [{ name: 'Größe', value: g }], wcVariationId: null }));
    const r = fe.wcIdsUebernehmen(variants, res.body.vorhanden.map(v => ({ id: v.id, attributes: v.attributes })), 'JFN-2026-0089');
    expect(r.zuordnung).toHaveLength(7);
    expect(variants.map(v => v.wcVariationId)).toEqual([21003, 21002, 21001, 21000, 20999, 20998, 20997]);
  });

  test('Mischfall: 1 neu, 2 vorhanden -> 1 angelegt', async () => {
    shopVariationen = [fg(501, 'Schwarz', 'S'), fg(502, 'Schwarz', 'M')];
    const res = await put({ variations: [neuFG('Schwarz', 'S'), neuFG('Schwarz', 'M'), neuFG('Schwarz', 'L')] });
    expect(res.status).toBe(200);
    const [b] = batchBodies();
    expect(b.create).toHaveLength(1);
    expect(b.create[0].attributes).toEqual([{ name: 'Farbe', option: 'Schwarz' }, { name: 'Größe', option: 'L' }]);
    expect(b.update).toBeUndefined();
    expect(res.body.variationen_neu).toHaveLength(1);
    expect(res.body.vorhanden.map(v => v.id)).toEqual([501, 502]);
  });

  test('Doppel im Request -> nur einmal angelegt, Hinweis', async () => {
    const res = await put({ variations: [neuFG('Rot', 'XL'), neuFG('rot', 'xl'), neuFG('Rot', '2XL')] });
    const [b] = batchBodies();
    expect(b.create.map(c => c.attributes[1].option)).toEqual(['XL', '2XL']);
    expect(res.body.doppelt_im_request).toEqual([{ kombination: 'Farbe=rot, Größe=xl' }]);
    expect(res.body.vorhanden).toEqual([]);
  });

  test('Umlaut/ß/2XL-Schreibweisen im Request treffen den Bestand', async () => {
    shopVariationen = [fg(701, 'Weiß', '2XL'), fg(702, 'Grün', 'M')];
    const res = await put({ variations: [
      { attributes: [{ name: 'Groesse', option: '2xl' }, { name: 'Farbe', option: 'Weiss' }], regular_price: '30' },
      { attributes: [{ name: 'GRÖSSE', option: 'M' }, { name: 'farbe', option: 'grün' }], regular_price: '30' },
    ] });
    expect(batchBodies()).toEqual([]);
    expect(res.body.vorhanden.map(v => v.id)).toEqual([701, 702]);
  });

  test('Variation auf Seite 2 der Shop-Liste wird gefunden', async () => {
    shopVariationen = [...Array.from({ length: 100 }, (_, i) => fg(1000 + i, `F${i}`, 'S')), fg(5555, 'Blau', 'L')];
    const res = await put({ variations: [neuFG('Blau', 'L')] });
    expect(batchBodies()).toEqual([]);
    expect(res.body.vorhanden.map(v => v.id)).toEqual([5555]);
    expect(wc.get.mock.calls.filter(c => c[0].endsWith('/variations')).map(c => c[1].page)).toEqual([1, 2]);
  });

  test('Shop-Liste nicht lesbar -> nichts angelegt, 502 mit Grund; update laeuft wie bisher', async () => {
    getFehler = Object.assign(new Error('timeout'), { response: { status: 504 } });
    const res = await put({ variations: [
      { id: 501, attributes: [{ name: 'Farbe', option: 'Schwarz' }, { name: 'Größe', option: 'S' }], regular_price: '22' },
      neuFG('Schwarz', 'L'),
    ] });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Neue Varianten nicht angelegt: Variationen im Shop nicht lesbar \(504\)/);
    const bodies = batchBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].create).toBeUndefined();
    expect(bodies[0].update.map(u => u.id)).toEqual([501]);
  });

  test('ohne neue Variationen: kein Lesen der Liste, update unveraendert', async () => {
    const res = await put({ variations: [{ id: 501, attributes: [{ name: 'Farbe', option: 'Rot' }], regular_price: '22' }] });
    expect(res.status).toBe(200);
    expect(wc.get.mock.calls.filter(c => c[0].endsWith('/variations'))).toHaveLength(0);
    expect(batchBodies()).toEqual([{ update: [{ id: 501, attributes: [{ name: 'Farbe', option: 'Rot' }], regular_price: '22' }] }]);
    expect(res.body).toMatchObject({ vorhanden: [], doppelt_im_request: [], variationen_hinweis: null });
  });

  test('Bestand mit update im selben Batch zaehlt mit den NEUEN Attributen', async () => {
    shopVariationen = [fg(501, 'Schwarz', 'S')];
    // 501 wird auf M umgestellt, S kommt als neue Variation -> S darf angelegt werden.
    const res = await put({ variations: [
      { id: 501, attributes: [{ name: 'Farbe', option: 'Schwarz' }, { name: 'Größe', option: 'M' }], regular_price: '22' },
      neuFG('Schwarz', 'S'),
    ] });
    const [b] = batchBodies();
    expect(b.create).toHaveLength(1);
    expect(res.body.vorhanden).toEqual([]);
  });
});

// ── variationen-ergaenzen ───────────────────────────────────────────────────
describe('POST /products/:id/variationen-ergaenzen - wcSchluessel', () => {
  const ergaenzen = body => request(app).post('/api/woocommerce/products/20996/variationen-ergaenzen').send(body);

  test('Größe im Shop, Groesse im Request -> nicht angelegt (frueher: trim/klein, doppelt angelegt)', async () => {
    shopVariationen = [nurGroesse(20999, 'M')];
    const res = await ergaenzen({ variations: [{ attributes: [{ name: 'Groesse', option: 'm' }], regular_price: '30' }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ angelegt: 0, doppelt: 1 });
    expect(res.body.vorhanden).toEqual([{ kombination: 'Groesse=m', id: 20999, attributes: [{ name: 'Größe', option: 'M' }] }]);
    expect(res.body.hinweis).toMatch(/1 Varianten existierten bereits – nicht doppelt angelegt/);
    expect(batchBodies()).toEqual([]);
    expect(wc.put).not.toHaveBeenCalled();
  });

  test('Doppel im Request -> nur einmal angelegt', async () => {
    const res = await ergaenzen({ variations: [neuG('4XL'), neuG('4xl')] });
    expect(res.status).toBe(201);
    expect(batchBodies()[0].create).toHaveLength(1);
    expect(res.body.doppelt_im_request).toEqual([{ kombination: 'Größe=4xl' }]);
  });

  test('Shop-Liste nicht lesbar -> nichts angelegt, 502 mit Grund', async () => {
    getFehler = new Error('ECONNRESET');
    const res = await ergaenzen({ variations: [neuG('4XL')] });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Keine Varianten angelegt: Variationen im Shop nicht lesbar (ECONNRESET).');
    expect(wc.put).not.toHaveBeenCalled();
    expect(wc.post).not.toHaveBeenCalled();
  });
});
