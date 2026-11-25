// BO2-Fix: die offenen Bestellungen werden nacheinander gelesen
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

  test('Pruefseite (HTML) -> HosterPruefseite, genau ein Abruf', async () => {
    wcGet.mockResolvedValue({ data: '<html>One moment, please...</html>' });
    await expect(offeneBestellungen({ get: wcGet })).rejects.toMatchObject({ code: 'hoster_pruefseite' });
    expect(wcGet).toHaveBeenCalledTimes(1);
  });
});

// DT1: dtf/offen ist entfernt (DTF-Warenkorb, routes/dtf.js); die Produkt-ID-Gegenprobe prueft dort der Abgleich.
describe('alte DTF-Liste', () => {
  test('dtf/offen gibt es nicht mehr', async () => {
    expect((await request(app).get('/api/auftragsmonitor/dtf/offen?shop=jfn')).status).toBe(404);
  });
});
