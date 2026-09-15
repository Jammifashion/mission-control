// Verkaeufe-Sync (GET /api/partner/verkaeufe/sync) gegen gemockte Sheets/WC.
//
// B16: Der Lizenzsatz kommt aus dem Partner-Reiter, nicht aus Partner_Artikel.
// Fixture ist Order 16941 (JFN, Produkt 5420): vier Zeilen zu 21,00 € netto je
// Stück, Mengen 1/2/3/1, EK 3,00, Druck 2,10. In Partner_Artikel steht noch der
// alte Satz 50 %, im Partner-Reiter 40 %.

import { jest } from '@jest/globals';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn() },
}));

jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: jest.fn(),
  getShopConfig: jest.fn(shop => shop === 'honk'
    ? { shop: 'honk', tabVerkaeufe: 'HK_Partner_Verkäufe', tabAbrechnungen: 'HK_Partner_Abrechnungen' }
    : { shop: 'jfn',  tabVerkaeufe: 'Partner_Verkäufe',    tabAbrechnungen: 'Partner_Abrechnungen' }),
  normalizeShop: jest.fn(s => s ?? 'jfn'),
}));

jest.unstable_mockModule('../lib/chatNotify.js', () => ({
  notify: jest.fn().mockResolvedValue(true),
  buildPartnerNachricht: jest.fn(() => 'partner'),
}));

const API_KEY = 'test-mc-key';

const PARTNER_HEADER = ['Partner-ID', 'Name', 'Token', 'Aktiv', 'Lizenz-%', 'Porto-Modell', 'Shop'];
const VERKAEUFE_HEADER = [
  'Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante',
  'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status', 'Produkt-ID',
  'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status',
];
const FIXKOSTEN = [
  ['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis'],
  ['Herstellungsnebenkosten', '0,8',  'EUR/Artikel',    '01.01.2022', ''],
  ['Versandnebenkosten B',    '0,9',  'EUR/Bestellung', '01.01.2022', ''],
  ['Versandnebenkosten P',    '1,41', 'EUR/Bestellung', '01.01.2022', ''],
  ['Porto B',                 '3',    'EUR/Bestellung', '01.01.2022', ''],
  ['Porto P',                 '6',    'EUR/Bestellung', '01.01.2022', ''],
  ['PayPal Prozent',          '2,49', '%',              '01.01.2022', ''],
  ['PayPal Pauschale',        '0,35', 'EUR/Bestellung', '01.01.2022', ''],
  ['MwSt',                    '19',   '%',              '01.01.2022', ''],
];

const ORDER_16941 = {
  id: 16941, status: 'processing', date_created: '2026-08-20T10:00:00',
  shipping_total: '0.00',
  line_items: [
    { name: 'Dorflove Shirt - 2XL, Schwarz', product_id: 5420, variation_id: 5440, quantity: 1, total: '21.00' },
    { name: 'Dorflove Shirt - M, Schwarz',   product_id: 5420, variation_id: 5431, quantity: 2, total: '42.00' },
    { name: 'Dorflove Shirt - L, Schwarz',   product_id: 5420, variation_id: 5434, quantity: 3, total: '63.00' },
    { name: 'Dorflove Shirt - XL, Schwarz',  product_id: 5420, variation_id: 5437, quantity: 1, total: '21.00' },
  ],
};

let request, app, mockValues, mockWcGet, tabs;

function sheetGet({ range }) {
  const tab = range.slice(0, range.indexOf('!'));
  return { data: { values: tabs[tab] ?? [] } };
}

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';
  process.env.MC_API_KEY = API_KEY;

  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');

  mockValues = { get: jest.fn(), append: jest.fn() };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values: mockValues } });

  mockWcGet = jest.fn();
  const { getWcClient } = await import('../lib/shopConfig.js');
  getWcClient.mockReturnValue({ get: mockWcGet });

  const { default: router } = await import('../routes/partnerPortal.js');
  app = express();
  app.use(express.json());
  app.use('/api/partner', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

beforeEach(() => {
  tabs = {
    Partner: [
      PARTNER_HEADER,
      ['P-003', 'Kreisligalegende', 't3', 'Ja', '40', 'geteilt-50-50', 'jfn'],
    ],
    Partner_Artikel: [
      ['Partner-ID', 'Artikelnummer', 'Produkt-ID', 'Artikelname', 'EK-Preis-Netto', 'Druckkosten', 'Versandart', 'Lizenz-%', 'Letzte-Synchro'],
      ['P-003', 'E3000 Dorflove', '5420', 'Dorflove Shirt', '3', '2,1', 'P', '50', '01.08.2026'],
    ],
    Kalkulation_Fixkosten: FIXKOSTEN,
    'Partner_Verkäufe': [VERKAEUFE_HEADER],
  };
  mockValues.get.mockReset();
  mockValues.get.mockImplementation(async (args) => sheetGet(args));
  mockValues.append.mockReset();
  mockValues.append.mockResolvedValue({ data: {} });
  mockWcGet.mockReset();
  mockWcGet.mockImplementation(async (_path, params) => ({
    data: params.status === 'processing' ? [ORDER_16941] : [],
  }));
});

const sync = (query = '') => request(app)
  .get(`/api/partner/verkaeufe/sync${query}`)
  .set('x-api-key', API_KEY);

const geschrieben = () => mockValues.append.mock.calls[0][0].requestBody.values;
const col = name => VERKAEUFE_HEADER.indexOf(name);

describe('B16 – Lizenzsatz aus dem Partner-Reiter (JFN)', () => {
  test('rechnet mit 40 % aus Partner, nicht mit 50 % aus Partner_Artikel', async () => {
    const res = await sync('?after=2026-08-01T00:00:00');
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(4);

    const rows = geschrieben();
    expect(rows.map(r => r[col('Lizenzgebühr')])).toEqual([5.26, 10.52, 15.79, 5.26]);
    for (const r of rows) {
      expect(r[col('Lizenz-Anteil')] / r[col('Gewinn-netto')]).toBeCloseTo(0.40, 3);
    }
  });

  test('Stückzahl landet in der Zeile', async () => {
    await sync('?after=2026-08-01T00:00:00');
    expect(geschrieben().map(r => r[col('Stückzahl')])).toEqual([1, 2, 3, 1]);
  });

  test.each([
    ['leer',      ''],
    ['Text',      'vierzig'],
    ['über 100',  '140'],
  ])('Satz im Partner-Reiter %s → Fehler mit Partner-ID, nichts geschrieben', async (_, wert) => {
    tabs.Partner[1][PARTNER_HEADER.indexOf('Lizenz-%')] = wert;
    const res = await sync('?after=2026-08-01T00:00:00');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('P-003');
    expect(mockValues.append).not.toHaveBeenCalled();
  });

  test('Partner fehlt im Partner-Reiter → Fehler mit Partner-ID', async () => {
    tabs.Partner = [PARTNER_HEADER];
    const res = await sync('?after=2026-08-01T00:00:00');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('P-003');
    expect(mockValues.append).not.toHaveBeenCalled();
  });

  test('ein Partner ohne Satz, aber ohne Verkauf, blockiert den Sync nicht', async () => {
    tabs.Partner.push(['P-009', 'Ohne Satz', 't9', 'Ja', '', 'geteilt-50-50', 'jfn']);
    const res = await sync('?after=2026-08-01T00:00:00');
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(4);
  });
});

describe('baueLizenzSaetze', () => {
  let baueLizenzSaetze;
  beforeAll(async () => {
    ({ baueLizenzSaetze } = await import('../utils/partner-kalkulation.js'));
  });

  const satz = wert => baueLizenzSaetze(['Partner-ID', 'Lizenz-%'], [['P-1', wert]])('P-1');

  test.each([
    ['40', 40], ['45', 45], ['40%', 40], [' 45 % ', 45], ['42,5', 42.5], ['0', 0], [40, 40],
  ])('%p → %p', (wert, erwartet) => {
    expect(satz(wert)).toBe(erwartet);
  });

  test.each(['', '  ', undefined, 'abc', '-5', '101'])('%p wirft', (wert) => {
    expect(() => satz(wert)).toThrow(/P-1/);
  });

  test('fehlende Spalte Lizenz-% wirft beim Aufbau', () => {
    expect(() => baueLizenzSaetze(['Partner-ID'], [])).toThrow(/Lizenz-%/);
  });
});
