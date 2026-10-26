// BO2-Fix: dtf/offen liest die offenen Bestellungen nacheinander
// mit Seitenschleife und pruefen die Produkt-ID der Varianten-Zeile gegen
// (HONK-Variations-IDs koennen JFN-Zeilen treffen, Befund BO1).

import { jest } from '@jest/globals';

let tabs;
const tabAus = range => String(range).split('!')[0].replace(/'/g, '');
const values = {
  get: async ({ range }) => ({ data: { values: (tabs[tabAus(range)] ?? []).map(z => [...z]) } }),
};
jest.unstable_mockModule('googleapis', () => ({ google: { sheets: () => ({ spreadsheets: { values } }) } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));

const wcGet = jest.fn();
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  normalizeShop: s => (String(s ?? '').toLowerCase() === 'honk' ? 'honk' : 'jfn'),
  getShopConfig: s => ({ shop: s }),
  getWcClient: () => ({ get: wcGet }),
}));

const PS_KOPF = ['WC_Order_ID', 'WC_Item_ID', 'Artikelname', 'SKU', 'Menge',
  'L-Shop_bestellt', 'DTF_bestellt', 'Gedruckt', 'Versendet', 'Notiz', 'Shop'];
const bestellung = (id, productId, variationId) => ({
  id, billing: {}, line_items: [{ id: 7, product_id: productId, variation_id: variationId, meta_data: [] }],
});

let request, app, offeneBestellungen;
beforeAll(async () => {
  process.env.GOOGLE_SHEET_ID = 'test';
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  const mod = await import('../routes/auftragsmonitor.js');
  offeneBestellungen = mod.offeneBestellungen;
  app = express();
  app.use('/api/auftragsmonitor', mod.default);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message, code: err.code }));
});

beforeEach(() => {
  wcGet.mockReset();
  tabs = {
    Produktions_Status: [PS_KOPF, ['900', '7', 'Shirt', 'X/Y', '1', 'FALSE', 'FALSE', 'FALSE', 'FALSE', '', 'HONK']],
    Varianten: [['SSOT-ID', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'WC_Variation_ID'],
      ['0001', 'Farbe', 'Schwarz', 'Größe', 'M', '', '', '555']],
    Erfassungsmaske: [['ID', 'Artikelnummer', 'Produktname', 'Produkt-ID'], ['0001', 'JH030/JFN-Shirt', 'JFN-Shirt', '111']],
  };
});

describe('offeneBestellungen', () => {
  test('Status nacheinander, Seite 2 nur bei voller Seite', async () => {
    const hundert = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const aktiv = { n: 0, max: 0 };
    wcGet.mockImplementation(async (_p, q) => {
      aktiv.n++; aktiv.max = Math.max(aktiv.max, aktiv.n);
      await new Promise(r => setTimeout(r, 1));
      aktiv.n--;
      return { data: q.status === 'processing' && q.page === 1 ? hundert : [] };
    });
    const liste = await offeneBestellungen({ get: wcGet });
    expect(liste).toHaveLength(100);
    expect(wcGet.mock.calls.map(([, q]) => `${q.status}:${q.page}`))
      .toEqual(['pending:1', 'processing:1', 'processing:2', 'on-hold:1']);
    expect(aktiv.max).toBe(1);
  });

  test('Pruefseite (HTML) -> genau ein Abruf, 503', async () => {
    wcGet.mockResolvedValue({ data: '<html>One moment, please...</html>' });
    const res = await request(app).get('/api/auftragsmonitor/dtf/offen?shop=honk');
    expect(res.status).toBe(503);
    expect(wcGet).toHaveBeenCalledTimes(1);
  });
});

describe('Produkt-ID-Gegenprobe', () => {
  test('dtf/offen: HONK-Position mit gleicher Variations-ID bekommt keine JFN-Daten', async () => {
    wcGet.mockImplementation(async (_p, q) => ({ data: q.status === 'on-hold' ? [bestellung(900, 222, 555)] : [] }));
    const res = await request(app).get('/api/auftragsmonitor/dtf/offen?shop=honk');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].ssotId).toBe('');
    expect(res.body[0].artikelnummer).toBe('X/Y');
  });

  test('gleiche Produkt-ID -> Varianten-Zeile wird genutzt', async () => {
    tabs.Produktions_Status[1][10] = 'JFN';
    wcGet.mockImplementation(async (_p, q) => ({ data: q.status === 'processing' ? [bestellung(900, 111, 555)] : [] }));
    const res = await request(app).get('/api/auftragsmonitor/dtf/offen?shop=jfn');
    expect(res.body[0].ssotId).toBe('0001');
    expect(res.body[0].variante).toBe('Schwarz·M');
  });
});

// Der alte L-Shop-Weg ist entfernt: keine Route /lshop/ mehr, kein Schreiben auf
// Produktions_Status!F (L-Shop_bestellt, nur noch Altstand) und LShop_Bestellungen.
describe('alter L-Shop-Weg entfernt', () => {
  test('Quelltext ohne /lshop/-Routen und ohne Schreibweg auf Spalte F', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(new URL('../routes/auftragsmonitor.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/router\.(get|post|put|patch|delete)\(\s*['"`]\/lshop\//);
    expect(src).not.toMatch(/!F\$\{/);
    expect(src).not.toMatch(/['"`]LShop_Bestellungen['"`]/);
  });

  test.each([
    ['get', '/lshop/offen'], ['get', '/lshop/protokoll'],
    ['post', '/lshop/bestellen'], ['post', '/lshop/bestellen-bulk'],
  ])('%s %s -> 404', async (methode, pfad) => {
    const res = await request(app)[methode](`/api/auftragsmonitor${pfad}?shop=jfn`);
    expect(res.status).toBe(404);
    expect(wcGet).not.toHaveBeenCalled();
  });
});
