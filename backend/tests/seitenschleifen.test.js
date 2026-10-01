// Seitenschleifen gegen die Hoster-Pruefseite (zweites Netz neben getWcClient):
// keine Liste -> genau ein Abruf, dann HosterPruefseiteError; nie mehr als
// MAX_SEITEN Seiten. Nur Mocks, kein Shop.

import { jest } from '@jest/globals';

jest.unstable_mockModule('googleapis', () => ({ google: { sheets: jest.fn() } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: jest.fn().mockResolvedValue({}) }));
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: jest.fn(),
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', tabVerkaeufe: 'Partner_Verkäufe', tabAbrechnungen: 'Partner_Abrechnungen' })),
  normalizeShop: jest.fn(s => s ?? 'jfn'),
}));
jest.unstable_mockModule('../lib/chatNotify.js', () => ({
  notify: jest.fn().mockResolvedValue(true),
  buildPartnerNachricht: jest.fn(() => 'partner'),
}));

const API_KEY = 'test-mc-key';
const PRUEFSEITE = '<!DOCTYPE html><html><title>One moment, please...</title></html>';
const hundert = () => Array.from({ length: 100 }, (_, i) => ({ id: i + 1, status: 'processing', line_items: [] }));

let request, app, mockValues, wcGet, hp, sheetTabs;

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';
  process.env.MC_API_KEY = API_KEY;
  ({ default: request } = await import('supertest'));
  const { default: express } = await import('express');

  mockValues = { get: jest.fn(), append: jest.fn().mockResolvedValue({ data: {} }) };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values: mockValues } });

  wcGet = jest.fn();
  const { getWcClient } = await import('../lib/shopConfig.js');
  getWcClient.mockReturnValue({ get: wcGet, shopLabel: 'JammiFashion' });

  hp = await import('../lib/hosterPruefseite.js');
  const { default: partnerRouter } = await import('../routes/partnerPortal.js');
  const { default: festpreisRouter } = await import('../routes/festpreis-portal.js');
  const { default: wcRouter } = await import('../routes/woocommerce.js');
  app = express();
  app.use(express.json());
  app.use('/api/partner', partnerRouter);
  app.use('/api/festpreis', festpreisRouter);
  app.use('/api/woocommerce', wcRouter);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message, code: err.code }));
});

beforeEach(() => {
  sheetTabs = {
    Partner: [['Partner-ID', 'Name', 'Token', 'Aktiv', 'Lizenz-%', 'Porto-Modell', 'Shop'], ['P-003', 'K', 't3', 'Ja', '40', 'geteilt-50-50', 'jfn']],
    Partner_Artikel: [['Partner-ID', 'Artikelnummer', 'Produkt-ID', 'Artikelname', 'EK-Preis-Netto', 'Druckkosten', 'Versandart', 'Lizenz-%', 'Letzte-Synchro'], ['P-003', 'E3000 Dorflove', '5420', 'Dorflove Shirt', '3', '2,1', 'B', '50', '01.08.2026']],
    Kalkulation_Fixkosten: [['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis']],
    'Partner_Verkäufe': [['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status', 'Produkt-ID']],
    FP_Partner: [['Partner-ID', 'Name', 'Aktiv', 'Shop'], ['F-001', 'FP', 'ja', 'jfn']],
    FP_Artikel: [['Partner-ID', 'Produkt-ID', 'Festpreis-EK-Netto', 'Handling-Gebühr', 'Versandart', 'Artikelkategorie'], ['F-001', '5420', '5', '1', 'P', 'Shirt']],
    FP_Artikel_Kategorie: [['Festpreispartner-ID', 'Kategorie', 'Festpreis', 'Handlingskosten']],
    'FP_Verkäufe': [['Partner-ID', 'Datum', 'Order-ID', 'Produkt-ID', 'Variante', 'Status']],
    Trikot_Artikel: [['Artikelnummer', 'Produkt-ID', 'Produktname', 'Aktiv'], ['', 19365, '', true]],
    Trikots: [['Zeilen-ID', 'Erfasst_Am', 'Bestelldatum', 'Order-ID', 'Order-Item-ID', 'Kunde', 'Artikelnummer', 'Produktname',
      'Groesse', 'Farbe', 'Name', 'Nummer', 'Stueck', 'Quelle', 'Rohtext', 'Charge', 'Bestellt_Am', 'Geliefert_Am', 'Status', 'Notiz', 'Zahlart']],
  };
  mockValues.get.mockReset();
  mockValues.get.mockImplementation(async ({ range }) => {
    const tab = range.replace(/'/g, '').split('!')[0];
    return { data: { values: sheetTabs[tab] ?? [] } };
  });
  wcGet.mockReset();
});

describe('Partner-Sync (fetchOrders)', () => {
  const sync = () => request(app).get('/api/partner/verkaeufe/sync?after=2026-08-01T00:00:00').set('x-api-key', API_KEY);

  test('HTML statt Liste -> genau ein WC-Abruf, dann 503 hoster_pruefseite', async () => {
    wcGet.mockResolvedValue({ data: PRUEFSEITE });
    const res = await sync();
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('hoster_pruefseite');
    expect(wcGet).toHaveBeenCalledTimes(1);
  });

  test('Obergrenze: immer volle Seiten -> Abbruch nach MAX_SEITEN, nie Seite 201', async () => {
    wcGet.mockImplementation(async () => ({ data: hundert() }));
    const res = await sync();
    expect(res.status).toBe(502);
    expect(res.body.error).toContain(`${hp.MAX_SEITEN} Seiten`);
    const seiten = wcGet.mock.calls.map(([, p]) => p.page);
    expect(Math.max(...seiten)).toBe(hp.MAX_SEITEN);
    // 3 Verkaufs-Status je Seite, nacheinander
    expect(wcGet).toHaveBeenCalledTimes(3 * hp.MAX_SEITEN);
  });
});

describe('Festpreis-Sync (fetchFpOrders)', () => {
  test('HTML statt Liste -> genau ein WC-Abruf, dann 503', async () => {
    wcGet.mockResolvedValue({ data: PRUEFSEITE });
    const res = await request(app).post('/api/festpreis/verkaeufe/sync').send({ after: '2026-08-01T00:00:00' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('hoster_pruefseite');
    expect(wcGet).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/woocommerce/orders mit mehreren Status', () => {
  test('HTML statt Liste -> genau ein WC-Abruf, dann 503', async () => {
    wcGet.mockResolvedValue({ data: PRUEFSEITE });
    const res = await request(app).get('/api/woocommerce/orders?status=processing,on-hold');
    expect(res.status).toBe(503);
    expect(wcGet).toHaveBeenCalledTimes(1);
  });
});

describe('Trikot-Sync (loadOrders)', () => {
  test('HTML statt Liste -> genau ein Abruf, HosterPruefseiteError', async () => {
    wcGet.mockResolvedValue({ data: PRUEFSEITE, headers: {} });
    const { runTrikotSync } = await import('../lib/trikotSync.js');
    await expect(runTrikotSync({ after: '2026-09-01', dryRun: true })).rejects.toBeInstanceOf(hp.HosterPruefseiteError);
    expect(wcGet).toHaveBeenCalledTimes(1);
  });
});

describe('leseAlleVariationen', () => {
  test('HTML -> genau ein Abruf, HosterPruefseiteError', async () => {
    wcGet.mockResolvedValue({ data: PRUEFSEITE });
    const { leseAlleVariationen } = await import('../lib/wc-variation-ids.js');
    await expect(leseAlleVariationen({ get: wcGet }, 1)).rejects.toBeInstanceOf(hp.HosterPruefseiteError);
    expect(wcGet).toHaveBeenCalledTimes(1);
  });

  test('Obergrenze: nach MAX_SEITEN Abrufen SeitenGrenzeError', async () => {
    wcGet.mockImplementation(async () => ({ data: hundert() }));
    const { leseAlleVariationen } = await import('../lib/wc-variation-ids.js');
    await expect(leseAlleVariationen({ get: wcGet }, 1)).rejects.toBeInstanceOf(hp.SeitenGrenzeError);
    expect(wcGet).toHaveBeenCalledTimes(hp.MAX_SEITEN);
  });
});

describe('seitenGrenze / seitenListe', () => {
  test('Seite MAX_SEITEN erlaubt, MAX_SEITEN + 1 nicht', () => {
    expect(() => hp.seitenGrenze(hp.MAX_SEITEN, { shop: 'X', pfad: 'orders' })).not.toThrow();
    expect(() => hp.seitenGrenze(hp.MAX_SEITEN + 1, { shop: 'X', pfad: 'orders' })).toThrow(hp.SeitenGrenzeError);
  });
  test('leere Liste ist gueltig, Text/undefined/Objekt nicht', () => {
    expect(hp.seitenListe([], { shop: 'X', pfad: 'p' })).toEqual([]);
    for (const d of [PRUEFSEITE, undefined, { message: 'x' }]) {
      expect(() => hp.seitenListe(d, { shop: 'X', pfad: 'p' })).toThrow(hp.HosterPruefseiteError);
    }
  });
});
