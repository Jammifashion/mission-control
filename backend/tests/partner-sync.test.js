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
  ['Versandnebenkosten B',    '1',    'EUR/Bestellung', '01.01.2022', ''],
  ['Versandnebenkosten P',    '1,41', 'EUR/Bestellung', '01.01.2022', ''],
  ['Porto B',                 '2,51', 'EUR/Bestellung', '01.01.2022', ''],
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
      ['P-003', 'E3000 Dorflove', '5420', 'Dorflove Shirt', '3', '2,1', 'B', '50', '01.08.2026'],
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
    expect(rows.map(r => r[col('Lizenzgebühr')])).toEqual([5.53, 11.07, 16.60, 5.53]);
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

describe('Neu-Sync – schon stornierte Bestellungen entstehen als Paar', () => {
  const STORNO_MARKER = 'Storniert/Rückerstattet';
  const ERSTATTET = {
    id: 16950, status: 'refunded', date_created: '2026-08-22T10:00:00', date_paid: '2026-08-22T10:05:00',
    date_modified: '2026-08-25T09:00:00', shipping_total: '0.00',
    line_items: [{ name: 'Dorflove Shirt - S, Schwarz', product_id: 5420, variation_id: 5428, quantity: 2, total: '42.00' }],
  };
  const NIE_BEZAHLT = { ...ERSTATTET, id: 16951, status: 'cancelled', date_paid: null };
  const ZU_ALT      = { ...ERSTATTET, id: 16800, date_created: '2026-07-01T10:00:00' };

  beforeEach(() => {
    mockWcGet.mockImplementation(async (_path, params) => ({
      data: params.status === 'processing' ? [ORDER_16941]
          : params.status === 'refunded'   ? [ERSTATTET, ZU_ALT]
          : params.status === 'cancelled'  ? [NIE_BEZAHLT]
          : [],
    }));
  });

  test('erstattete, bezahlte Bestellung: Verkauf + Gegenbuchung in einem Lauf, Summe 0', async () => {
    const res = await sync('?after=2026-08-01T00:00:00');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ synced: 5, storniert: 1, stornoNachgeholt: 1 });

    const paar = geschrieben().filter(r => String(r[col('Order-ID')]) === '16950');
    expect(paar).toHaveLength(2);
    const [verkauf, gegen] = paar;
    expect(verkauf[col('Stückzahl')]).toBe(2);
    expect(gegen[col('Stückzahl')]).toBe(-2);
    expect(gegen[col('Storno-Status')]).toBe(STORNO_MARKER);
    expect(gegen[col('Datum')]).toBe('25.08.2026');
    expect(verkauf[col('Status')]).toBe('offen');
    expect(gegen[col('Status')]).toBe('offen');
    expect(verkauf[col('Lizenzgebühr')] + gegen[col('Lizenzgebühr')]).toBeCloseTo(0, 10);
    // Verkauf steht vor der Gegenbuchung
    expect(geschrieben().indexOf(verkauf)).toBeLessThan(geschrieben().indexOf(gegen));
  });

  test('nie bezahlte und vor after angelegte Stornos erzeugen nichts', async () => {
    await sync('?after=2026-08-01T00:00:00');
    const ids = geschrieben().map(r => String(r[col('Order-ID')]));
    expect(ids).not.toContain('16951');
    expect(ids).not.toContain('16800');
  });

  test('zweiter Lauf erzeugt keine Dubletten', async () => {
    await sync('?after=2026-08-01T00:00:00');
    tabs['Partner_Verkäufe'] = [VERKAEUFE_HEADER, ...geschrieben().map(r => r.map(v => String(v ?? '')))];
    mockValues.append.mockClear();

    const res = await sync('?after=2026-08-01T00:00:00');
    expect(res.body).toMatchObject({ synced: 0, storniert: 0 });
    expect(mockValues.append).not.toHaveBeenCalled();
  });

  test('HonkShop: gleiches Verhalten', async () => {
    tabs.Partner = [PARTNER_HEADER, ['P-004', 'Honk', 't4', 'Ja', '45', 'geteilt-50-50', 'honk']];
    tabs.HK_Partner_Artikel = [
      ['Produkt-ID', 'Artikelname', 'EK-Preis-Netto', 'Druckkosten', 'Versandart'],
      ['5420', 'Dorflove', '3', '2,1', 'P'],
    ];
    tabs['HK_Partner_Verkäufe'] = [VERKAEUFE_HEADER];
    const res = await sync('?shop=honk&after=2026-08-01T00:00:00');
    expect(res.body).toMatchObject({ synced: 5, storniert: 1 });
    const paar = geschrieben().filter(r => String(r[col('Order-ID')]) === '16950');
    expect(paar.map(r => r[col('Stückzahl')])).toEqual([2, -2]);
  });
});

describe('HonkShop – EK, Druck, Versandart aus HK_Partner_Artikel', () => {
  const HK_ORDER = {
    id: 9001, status: 'processing', date_created: '2026-08-21T10:00:00',
    shipping_total: '0.00',
    line_items: [
      { name: 'Honk Hoodie - L', product_id: 700, variation_id: 701, quantity: 2, total: '80.00' },
      { name: 'Unbekannt - M',   product_id: 999, variation_id: 0,   quantity: 1, total: '20.00' },
    ],
  };
  const HK_ARTIKEL_HEADER = ['Produkt-ID', 'Artikelname', 'EK-Preis-Netto', 'Druckkosten', 'Versandart'];

  beforeEach(() => {
    tabs.Partner = [
      PARTNER_HEADER,
      ['P-004', 'Honk', 't4', 'Ja', '45', 'geteilt-50-50', 'honk'],
    ];
    tabs.HK_Partner_Artikel = [
      HK_ARTIKEL_HEADER,
      ['700', 'Honk Hoodie', '12', '4,5', 'P'],
    ];
    tabs['HK_Partner_Verkäufe'] = [VERKAEUFE_HEADER];
    mockWcGet.mockImplementation(async (_path, params) => ({
      data: params.status === 'processing' ? [HK_ORDER] : [],
    }));
  });

  const honk = () => sync('?shop=honk&after=2026-08-01T00:00:00');

  test('bekannter Artikel: rechnet mit EK/Druck × Stückzahl und 45 % aus Partner', async () => {
    const { berechnePartnerAnteil, parseKonfiguration } = await import('../utils/partner-kalkulation.js');
    const res = await honk();
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(1);

    const [row] = geschrieben();
    expect(mockValues.append.mock.calls[0][0].range).toMatch(/^HK_Partner_Verkäufe!/);
    const erwartet = berechnePartnerAnteil({
      vkNetto: 80, ekPreis: 12, druckkosten: 4.5, versandart: 'P',
      portoModell: 'geteilt-50-50', bestellungsAnteil: 0.8, stueckzahl: 2,
      lizenzProzent: 45, portoEinnahmeAnteil: 0,
      konfiguration: parseKonfiguration(FIXKOSTEN.slice(1), FIXKOSTEN[0]),
    });
    expect(erwartet.herstellungspreis).toBe(34.6);            // (12 + 4,5 + 0,8) × 2
    expect(row[col('Gewinn-netto')]).toBe(erwartet.gewinnNetto);
    expect(row[col('Lizenzgebühr')]).toBe(erwartet.partnerAnteil);
    expect(row[col('Lizenz-Anteil')] / row[col('Gewinn-netto')]).toBeCloseTo(0.45, 3);
  });

  test('fehlender Artikel: Zeile nicht geschrieben, in Antwort und Log gemeldet', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await honk();
    expect(res.body.uebersprungen).toEqual([
      expect.objectContaining({ orderId: 9001, produktId: 999, artikel: 'Unbekannt - M' }),
    ]);
    expect(res.body.message).toMatch(/1 übersprungen/);
    expect(geschrieben()).toHaveLength(1);
    expect(geschrieben()[0][col('Produkt-ID')]).toBe(700);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Order 9001 \/ Produkt-ID 999/));
    warn.mockRestore();
  });

  test('übersprungene Position wird beim nächsten Sync nachgeholt, wenn der Artikel da ist', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await honk();
    const erstLauf = geschrieben();
    tabs['HK_Partner_Verkäufe'] = [VERKAEUFE_HEADER, ...erstLauf.map(r => r.map(String))];
    tabs.HK_Partner_Artikel.push(['999', 'Nachgetragen', '5', '1', 'P']);
    mockValues.append.mockClear();

    const res = await honk();
    expect(res.body.synced).toBe(1);
    expect(res.body.uebersprungen).toEqual([]);
    expect(geschrieben()[0][col('Produkt-ID')]).toBe(999);
    console.warn.mockRestore();
  });

  test('alle Positionen unbekannt: nichts geschrieben, alle gemeldet', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    tabs.HK_Partner_Artikel = [HK_ARTIKEL_HEADER];
    const res = await honk();
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(0);
    expect(res.body.uebersprungen).toHaveLength(2);
    expect(mockValues.append).not.toHaveBeenCalled();
    console.warn.mockRestore();
  });

  test('HonkShop-Partner ohne Lizenzsatz → Fehler mit Partner-ID', async () => {
    tabs.Partner[1][PARTNER_HEADER.indexOf('Lizenz-%')] = '';
    const res = await honk();
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('P-004');
    expect(mockWcGet).not.toHaveBeenCalled();
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
