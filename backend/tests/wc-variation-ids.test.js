// Befehl VR2: WC_Variation_ID auch im Aenderungspfad zurueckschreiben.
//  - lib/wc-variation-ids.js (eine Quelle) und der Spiegel-Block "WC-IDs" in
//    frontend/index.html rechnen dieselben Faelle gleich.
//  - Zuordnung nur ueber die Attributkombination, nie ueber die Position.
//  - Andere Spalten der Varianten-Zeile bleiben byte-genau (baueVariantenZeilen).
//  - Routen: POST /products liefert `variationen`, PUT /products/:id liefert
//    `variationen_neu` aus der Batch-Antwort (vorher verworfen).
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
const wc = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient:   jest.fn(() => wc),
}));

const lib = await import('../lib/wc-variation-ids.js');
const { baueVariantenZeilen } = await import('../utils/varianten-zeilen.js');

const html  = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = (a, e) => {
  const i = html.indexOf(a), j = html.indexOf(e);
  if (i < 0 || j < 0) throw new Error(`Block fehlt: ${a}`);
  return html.slice(i, j);
};
const fe = new Function(`${block('// ── Farbachsen-Regel: Anfang', '// ── Farbachsen-Regel: Ende ──')}
${block('// ── L-Shop-Modell: Anfang', '// ── L-Shop-Modell: Ende ──')}
${block('// ── WC-IDs: Anfang', '// ── WC-IDs: Ende ──')}
return { ordneWcIdsZu, wcIdsMeldung, wcIdsUebernehmen, wcSchluessel, variantenZeile };`)();

// ── Fixtures ────────────────────────────────────────────────────────────────
const z = (farbe, groesse, id = '') => ({ paare: [['Farbe', farbe], ['Größe', groesse]], wcVariationId: id });
const w = (id, farbe, groesse) => ({ id, attributes: [{ name: 'Größe', option: groesse }, { name: 'Farbe', option: farbe }] });

// Bestand: Schwarz S/M/L mit IDs, neu: XL und 2XL (ohne ID).
const BESTAND = () => [z('Schwarz', 'S', 501), z('Schwarz', 'M', 502), z('Schwarz', 'L', 503), z('Schwarz', 'XL'), z('Schwarz', '2XL')];

// Beide Implementierungen (Backend-Lib, Frontend-Spiegel) gegen dieselben Faelle.
describe.each([['lib', lib], ['Frontend-Block', fe]])('ordneWcIdsZu (%s)', (_name, m) => {
  test('Aenderungspfad: 2 neue Groessen -> genau diese 2 Zeilen, Rest unberuehrt', () => {
    const r = m.ordneWcIdsZu(BESTAND(), [w(601, 'Schwarz', 'XL'), w(602, 'Schwarz', '2XL')]);
    expect(r.zuordnung).toEqual([{ index: 3, id: '601' }, { index: 4, id: '602' }]);
    expect(r).toMatchObject({ schonGefuellt: 0, ohneTreffer: 0, mehrdeutig: 0, konflikt: 0, hinweise: [] });
    expect(m.wcIdsMeldung(r)).toBe('2 Variations-IDs zurückgeschrieben, 0 ohne Zuordnung');
  });

  test('Reihenfolge der WC-Antwort vertauscht -> Zuordnung bleibt richtig', () => {
    const r = m.ordneWcIdsZu(BESTAND(), [w(602, 'Schwarz', '2XL'), w(601, 'Schwarz', 'XL')]);
    expect(r.zuordnung).toEqual([{ index: 4, id: '602' }, { index: 3, id: '601' }]);
  });

  test('2XL/2xl, Größe/Groesse/GRÖSSE, Achsenreihenfolge egal -> trifft', () => {
    const zeilen = [{ paare: [['Groesse', '2xl'], ['farbe', 'schwarz']], wcVariationId: '' },
      { paare: [['GRÖSSE', 'M'], ['Farbe', 'Weiß']], wcVariationId: null }];
    const r = m.ordneWcIdsZu(zeilen, [w(700, 'Schwarz', '2XL'), w(701, 'Weiss', 'm')]);
    expect(r.zuordnung).toEqual([{ index: 0, id: '700' }, { index: 1, id: '701' }]);
    expect(m.wcSchluessel([['Größe', 'M']])).toBe(m.wcSchluessel([['Groesse', 'm']]));
  });

  test('doppelte Kombination im Sheet -> nichts geschrieben, Hinweis', () => {
    const r = m.ordneWcIdsZu([z('Schwarz', 'XL'), z('schwarz', 'xl')], [w(601, 'Schwarz', 'XL')], { ssotId: 'JFN-1' });
    expect(r.zuordnung).toEqual([]);
    expect(r.mehrdeutig).toBe(1);
    expect(r.hinweise).toEqual(['JFN-1: Variation 601 (Größe=XL, Farbe=Schwarz) passt auf 2 Zeilen – nicht geschrieben.']);
  });

  test('vorhandene abweichende ID -> nicht ueberschrieben, Hinweis; gleiche ID -> schon gefuellt', () => {
    const r = m.ordneWcIdsZu([z('Schwarz', 'S', 501), z('Schwarz', 'M', '502')],
      [w(999, 'Schwarz', 'S'), w(502, 'Schwarz', 'M')], { ssotId: 'JFN-1' });
    expect(r.zuordnung).toEqual([]);
    expect(r).toMatchObject({ konflikt: 1, schonGefuellt: 1 });
    expect(r.hinweise).toEqual(['JFN-1: Farbe=Schwarz, Größe=S hat schon WC_Variation_ID 501, Shop meldet 999 – nicht überschrieben.']);
    expect(m.wcIdsMeldung(r)).toBe('0 Variations-IDs zurückgeschrieben, 1 ohne Zuordnung');
  });

  test('ohne Treffer, WC-Fehlereintrag, schon vergebene ID', () => {
    const r = m.ordneWcIdsZu([z('Schwarz', 'XL'), z('Rot', 'XL', 601)],
      [w(800, 'Blau', 'XL'), { id: 0, error: 'term_exists' }, w(601, 'Schwarz', 'XL')]);
    expect(r).toMatchObject({ ohneTreffer: 1, fehlerWc: 1, konflikt: 1 });
    expect(r.zuordnung).toEqual([]);
  });

  test('Anlagepfad, Cap-Fall 21117: 3 Farben, keine Groessenachse -> 3 Zeilen, 3 IDs', () => {
    const zeilen = ['Black/Kelly Green', 'Black/Red', 'Black/White'].map(f => ({ paare: [['Farbe', f]], wcVariationId: null }));
    const wcv = [{ id: 21120, attributes: [{ name: 'Farbe', option: 'Black/White' }] },
      { id: 21118, attributes: [{ name: 'Farbe', option: 'Black/Kelly Green' }] },
      { id: 21119, attributes: [{ name: 'Farbe', option: 'Black/Red' }] }];
    const r = m.ordneWcIdsZu(zeilen, wcv);
    expect(r.zuordnung.sort((a, b) => a.index - b.index)).toEqual([{ index: 0, id: '21118' }, { index: 1, id: '21119' }, { index: 2, id: '21120' }]);
  });
});

describe('Frontend: Formularzustand und Varianten-Zeilen (Regel 6)', () => {
  const HEADER = ['SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'Preis', 'Aktiv',
    'WC_Variation_ID', 'Google_Farbe', 'LShop_ArticleNr', 'Notiz'];
  const ALT = [
    ['JFN-1', 1, 'Farbe', 'Schwarz', 'Größe', 'S', '', '', 22, true, 501, 'Schwarz', '1000311700', 'n1'],
    ['JFN-1', 2, 'Farbe', 'Schwarz', 'Größe', 'M', '', '', 22, true, 502, 'Schwarz', '1000311701', ''],
    ['JFN-1', 3, 'Farbe', 'Schwarz', 'Größe', 'L', '', '', 22, true, 503, 'Schwarz', '1000311702', ''],
  ];
  // Zustand nach dem Laden im Aenderungspfad (IDs aus dem Shop) + 2 neue Groessen.
  const zustand = () => [
    ...['S', 'M', 'L'].map((g, i) => ({ attrs: [{ name: 'Farbe', value: 'Schwarz' }, { name: 'Größe', value: g }], price: 22, wcVariationId: 501 + i, googleFarbe: 'Schwarz' })),
    ...['XL', '2XL'].map(g => ({ attrs: [{ name: 'Farbe', value: 'Schwarz' }, { name: 'Größe', value: g }], price: 24, googleFarbe: 'Schwarz' })),
  ];

  test('nur WC_Variation_ID der 2 neuen Zeilen aendert sich, alle anderen Zellen byte-genau', () => {
    const vorher = zustand();
    const nachher = zustand();
    const r = fe.wcIdsUebernehmen(nachher, [w(602, 'Schwarz', '2XL'), w(601, 'Schwarz', 'XL')], 'JFN-1');
    expect(r.zuordnung).toHaveLength(2);
    expect(nachher.map(v => v.wcVariationId)).toEqual([501, 502, 503, 601, 602]);

    const zeilenVorher  = baueVariantenZeilen(HEADER, 'JFN-1', vorher.map((v, i) => fe.variantenZeile(v, i)), ALT);
    const zeilenNachher = baueVariantenZeilen(HEADER, 'JFN-1', nachher.map((v, i) => fe.variantenZeile(v, i)), ALT);
    const wcSp = HEADER.indexOf('WC_Variation_ID');
    zeilenNachher.forEach((zeile, i) => zeile.forEach((zelle, j) => {
      if (j === wcSp && i >= 3) return;
      expect([i, j, zelle]).toEqual([i, j, zeilenVorher[i][j]]);
    }));
    expect(zeilenVorher.slice(3).map(z => z[wcSp])).toEqual(['', '']);
    expect(zeilenNachher.slice(3).map(z => z[wcSp])).toEqual([601, 602]);
    // LShop_ArticleNr und Notiz der Bestandszeilen kommen unveraendert aus dem Sheet.
    expect(zeilenNachher.slice(0, 3).map(z => [z[12], z[13]])).toEqual([['1000311700', 'n1'], ['1000311701', ''], ['1000311702', '']]);
  });
});

describe('Routen liefern die angelegten Variationen', () => {
  let request, app;
  beforeAll(async () => {
    ({ default: request } = await import('supertest'));
    const { default: express } = await import('express');
    const { default: wcRouter } = await import('../routes/woocommerce.js');
    app = express();
    app.use(express.json());
    app.use('/api/woocommerce', wcRouter);
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  });
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    wc.get.mockReset(); wc.post.mockReset(); wc.put.mockReset();
  });
  afterEach(() => jest.restoreAllMocks());

  test('PUT /products/:id: variationen_neu aus der Batch-Antwort (Reihenfolge egal, Fehler als id 0)', async () => {
    wc.put.mockResolvedValue({ data: { id: 100, meta_data: [] } });
    wc.post.mockResolvedValue({ data: {
      update: [{ id: 501 }],
      create: [
        { id: 602, attributes: [{ id: 3, name: 'Größe', option: '2XL' }, { id: 1, name: 'Farbe', option: 'Schwarz' }], price: '24' },
        { id: 0, error: { code: 'x', message: 'kaputt' } },
        { id: 601, attributes: [{ id: 3, name: 'Größe', option: 'XL' }, { id: 1, name: 'Farbe', option: 'Schwarz' }] },
      ],
    } });
    const res = await request(app).put('/api/woocommerce/products/100').send({
      name: 'Shirt', status: 'draft',
      variations: [
        { id: 501, attributes: [{ name: 'Farbe', option: 'Schwarz' }, { name: 'Größe', option: 'S' }], regular_price: '22' },
        { attributes: [{ name: 'Farbe', option: 'Schwarz' }, { name: 'Größe', option: 'XL' }], regular_price: '24' },
        { attributes: [{ name: 'Farbe', option: 'Schwarz' }, { name: 'Größe', option: '2XL' }], regular_price: '24' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.variationen_neu).toEqual([
      { id: 602, attributes: [{ name: 'Größe', option: '2XL' }, { name: 'Farbe', option: 'Schwarz' }] },
      { id: 0, error: 'kaputt' },
      { id: 601, attributes: [{ name: 'Größe', option: 'XL' }, { name: 'Farbe', option: 'Schwarz' }] },
    ]);
    expect(JSON.stringify(res.body.variationen_neu)).not.toMatch(/price/);
    // Und die Oberflaeche ordnet sie richtig zu.
    const r = fe.ordneWcIdsZu(BESTAND(), res.body.variationen_neu);
    expect(r.zuordnung).toEqual([{ index: 4, id: '602' }, { index: 3, id: '601' }]);
    expect(r.fehlerWc).toBe(1);
  });

  test('PUT /products/:id ohne neue Variationen -> variationen_neu leer', async () => {
    wc.put.mockResolvedValue({ data: { id: 100, meta_data: [] } });
    wc.post.mockResolvedValue({ data: { update: [{ id: 501 }] } });
    const res = await request(app).put('/api/woocommerce/products/100').send({
      name: 'Shirt', variations: [{ id: 501, attributes: [{ name: 'Farbe', option: 'Rot' }], regular_price: '22' }],
    });
    expect(res.body.variationen_neu).toEqual([]);
  });

  test('POST /products: variationen mit id + Attributen; variation_ids bleibt', async () => {
    let n = 900;
    wc.post.mockImplementation(async (pfad, body) => (pfad === 'products'
      ? { data: { id: 100, status: 'draft', sku: body.sku, meta_data: body.meta_data ?? [] } }
      : { data: { id: ++n, meta_data: body.meta_data ?? [], attributes: body.attributes } }));
    wc.put.mockImplementation(async () => ({ data: { id: 100, meta_data: [] } }));
    wc.get.mockResolvedValue({ data: [] });
    const res = await request(app).post('/api/woocommerce/products').send({
      name: 'Cap', sku: 'CB166R/CH-Matchday', type: 'variable', shipping_class: 'paket',
      attributes: [{ name: 'Farbe', options: ['Black/Red', 'Black/White'], variation: true }],
      variations: [
        { attributes: [{ name: 'Farbe', option: 'Black/Red' }], regular_price: '20' },
        { attributes: [{ name: 'Farbe', option: 'Black/White' }], regular_price: '20' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.variation_ids).toHaveLength(2);
    expect(res.body.variationen).toHaveLength(2);
    for (const v of res.body.variationen) expect(v).toEqual({ id: expect.any(Number), attributes: [{ name: 'Farbe', option: expect.any(String) }] });
    const zeilen = [{ paare: [['Farbe', 'Black/Red']], wcVariationId: null }, { paare: [['Farbe', 'Black/White']], wcVariationId: null }];
    const r = fe.ordneWcIdsZu(zeilen, res.body.variationen);
    const byFarbe = Object.fromEntries(res.body.variationen.map(v => [v.attributes[0].option, String(v.id)]));
    expect(r.zuordnung.sort((a, b) => a.index - b.index)).toEqual([{ index: 0, id: byFarbe['Black/Red'] }, { index: 1, id: byFarbe['Black/White'] }]);
  });
});

describe('Spiegel: Lib und Frontend-Block rechnen identisch (inkl. details)', () => {
  const faelle = [
    [BESTAND(), [w(602, 'Schwarz', '2XL'), w(601, 'Schwarz', 'XL'), w(501, 'Schwarz', 'S'), w(777, 'Blau', 'S')]],
    [[z('Schwarz', 'XL'), z('schwarz', 'xl'), z('Rot', 'M', 9)], [w(1, 'Schwarz', 'XL'), w(2, 'Rot', 'M'), { id: 0, error: 'x' }]],
    [[{ paare: [['Größe', 'M']], wcVariationId: '' }], [{ id: 5, attributes: [{ name: 'Groesse', option: 'm' }] }]],
  ];
  test.each(faelle.map((f, i) => [i, ...f]))('Fall %i', (_i, zeilen, wcv) => {
    expect(fe.ordneWcIdsZu(zeilen, wcv, { ssotId: 'S' })).toEqual(lib.ordneWcIdsZu(zeilen, wcv, { ssotId: 'S' }));
  });
});

describe('Nachtrag Bestand (Teil B): planeNachtrag / schreibeNachtrag', () => {
  const HEADER = ['SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'Preis', 'Aktiv', 'WC_Variation_ID', 'Google_Farbe', 'LShop_ArticleNr'];
  let tabs, updates;
  const sheets = { spreadsheets: { values: {
    get: jest.fn(async ({ range }) => ({ data: { values: tabs[range.replace(/'/g, '')].map(r => [...r]) } })),
    batchUpdate: jest.fn(async ({ requestBody }) => { updates.push(requestBody); for (const d of requestBody.data) {
      const [, sp, nr] = /!([A-Z]+)(\d+)$/.exec(d.range); tabs.Varianten[Number(nr) - 1][sp.charCodeAt(0) - 65] = d.values[0][0]; } return { data: {} }; }),
  } } };
  const shop = {
    100: [{ id: 501, attributes: [{ name: 'Farbe', option: 'Schwarz' }, { name: 'Größe', option: 'S' }] },
      { id: 601, attributes: [{ name: 'Farbe', option: 'Schwarz' }, { name: 'Größe', option: 'XL' }] },
      { id: 999, attributes: [{ name: 'Farbe', option: 'Schwarz' }, { name: 'Größe', option: 'M' }] }],
    200: [{ id: 700, attributes: [{ name: 'Farbe', option: 'Rot' }] }],
  };
  const wcMock = { get: jest.fn(async (pfad) => ({ data: shop[/products\/(\d+)\//.exec(pfad)[1]] ?? [] })) };
  beforeEach(() => {
    updates = [];
    tabs = {
      Varianten: [HEADER,
        ['JFN-1', 1, 'Farbe', 'Schwarz', 'Größe', 'S', '', '', 22, true, 501, 'Schwarz', '1000311700'],
        ['JFN-1', 2, 'Farbe', 'Schwarz', 'Größe', 'M', '', '', 22, true, 502, 'Schwarz', '1000311701'],
        ['JFN-1', 3, 'Farbe', 'Schwarz', 'Größe', 'XL', '', '', 24, true, '', 'Schwarz', '1000311703'],
        ['JFN-2', 1, 'Farbe', 'Rot', '', '', '', '', 20, true, '', 'Rot', ''],
        ['JFN-3', 1, 'Farbe', 'Blau', '', '', '', '', 20, true, '', 'Blau', '']],
      Erfassungsmaske: [['ID', 'Produkt-ID'], ['JFN-1', 100], ['JFN-2', 200], ['JFN-3', '']],
    };
  });

  test('Trockenlauf: Zaehler je SSOT-ID, nichts geschrieben', async () => {
    const d = [];
    const { plaene } = await lib.planeNachtrag({ sheets, wc: wcMock, spreadsheetId: 'x', drossel: async () => d.push(1) });
    const z = Object.fromEntries(plaene.map(p => [p.ssot, lib.nachtragZaehler(p)]));
    expect(z['JFN-1']).toMatchObject({ zuordenbar: 1, schonGefuellt: 1, konflikt: 1, ohneTreffer: 0, leerVorher: 1, leerDanach: 0 });
    expect(z['JFN-2']).toMatchObject({ zuordenbar: 1, leerDanach: 0 });
    expect(z['JFN-3'].fehlt).toBe('ohne Produkt-ID');
    expect(d).toHaveLength(2);                                  // ein GET je SSOT-ID mit Produkt-ID
    expect(sheets.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });

  test('--write: nur die leeren WC_Variation_ID-Zellen, alle anderen Zellen unveraendert', async () => {
    const vorher = tabs.Varianten.map(r => [...r]);
    const { plaene } = await lib.planeNachtrag({ sheets, wc: wcMock, spreadsheetId: 'x' });
    const w2 = await lib.schreibeNachtrag({ sheets, spreadsheetId: 'x', plaene });
    expect(w2).toEqual({ geschrieben: 2, uebersprungen: [] });
    expect(updates[0].valueInputOption).toBe('RAW');
    expect(updates[0].data.map(d => d.range)).toEqual(["'Varianten'!K4", "'Varianten'!K5"]);
    const wcSp = HEADER.indexOf('WC_Variation_ID');
    tabs.Varianten.forEach((r, i) => r.forEach((c, j) => {
      if (j === wcSp && (i === 3 || i === 4)) return;
      expect([i, j, c]).toEqual([i, j, vorher[i][j]]);
    }));
    expect([tabs.Varianten[3][wcSp], tabs.Varianten[4][wcSp]]).toEqual([601, 700]);
    expect(tabs.Varianten[2][wcSp]).toBe(502);                  // Konflikt (Shop 999) nicht ueberschrieben
  });

  test('--write prueft neu: inzwischen gefuellt oder Zeile geaendert -> uebersprungen', async () => {
    const { plaene } = await lib.planeNachtrag({ sheets, wc: wcMock, spreadsheetId: 'x' });
    tabs.Varianten[3][10] = 12345;                               // JFN-1 XL inzwischen gefuellt
    tabs.Varianten[4][3] = 'Gruen';                              // JFN-2 Kombination geaendert
    const w2 = await lib.schreibeNachtrag({ sheets, spreadsheetId: 'x', plaene });
    expect(w2.geschrieben).toBe(0);
    expect(w2.uebersprungen).toEqual(['JFN-1 Zeile 4: WC_Variation_ID inzwischen gefuellt', 'JFN-2 Zeile 5: Zeile hat sich geaendert']);
  });
});
