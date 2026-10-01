// Partner-, Festpreis-, Trikot-Sync und Artikel-Abgleich enden bei der
// Hoster-Pruefseite mit 503 + Code "hoster_pruefseite" (Workflow rot) und
// einer Chat-Meldung. sync-all antwortete vorher 200 mit errors.

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
  notifyHosterPruefseite: jest.fn().mockResolvedValue(true),
  buildPartnerNachricht: jest.fn(() => 'partner'),
  buildArtikelAbgleichNachricht: jest.fn(() => 'abgleich'),
  buildAbgleichLebenszeichen: jest.fn(() => 'lebenszeichen'),
}));

const API_KEY = 'test-mc-key';
const PRUEFSEITE = '<!DOCTYPE html><html><title>One moment, please...</title></html>';
let request, app, mockValues, wcGet, chat, tabs;

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';
  process.env.GOOGLE_SHEET_ID = 'ssot';
  process.env.MC_API_KEY = API_KEY;
  ({ default: request } = await import('supertest'));
  const { default: express } = await import('express');

  mockValues = { get: jest.fn(), append: jest.fn().mockResolvedValue({ data: {} }), batchGet: jest.fn(), batchUpdate: jest.fn() };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values: mockValues } });

  wcGet = jest.fn();
  const { getWcClient } = await import('../lib/shopConfig.js');
  getWcClient.mockReturnValue({ get: wcGet, shopLabel: 'JammiFashion' });

  chat = await import('../lib/chatNotify.js');
  const { hosterPruefseiteHandler } = await import('../middleware/hosterPruefseite.js');
  app = express();
  app.use(express.json());
  app.use('/api/partner', (await import('../routes/partnerPortal.js')).default);
  app.use('/api/partner', (await import('../routes/partner-artikel.js')).default);
  app.use('/api/festpreis', (await import('../routes/festpreis-portal.js')).default);
  app.use('/api/trikot', (await import('../routes/trikot.js')).default);
  app.use(hosterPruefseiteHandler);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

beforeEach(() => {
  tabs = {
    Partner: [['Partner-ID', 'Name', 'Token', 'Aktiv', 'Lizenz-%', 'Porto-Modell', 'Shop', 'Hauptkategorie'], ['P-003', 'K', 't3', 'Ja', '40', 'geteilt-50-50', 'jfn', 'Malle Prinz']],
    Partner_Artikel: [['Partner-ID', 'Artikelnummer', 'Produkt-ID', 'Artikelname', 'EK-Preis-Netto', 'Druckkosten', 'Versandart', 'Lizenz-%', 'Letzte-Synchro'],
      ['P-003', 'E3000 Dorflove', '5420', 'Dorflove Shirt', '3', '2,1', 'B', '50', '01.08.2026']],
    HK_Partner_Artikel: [['Produkt-ID', 'Artikelname', 'EK-Preis-Netto', 'Druckkosten', 'Versandart']],
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
    return { data: { values: tabs[tab] ?? [] } };
  });
  wcGet.mockReset();
  wcGet.mockResolvedValue({ data: PRUEFSEITE, headers: {} });
  chat.notifyHosterPruefseite.mockClear();
  consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
let consoleSpy;
afterEach(() => consoleSpy.mockRestore());

const pruefe503 = res => {
  expect(res.status).toBe(503);
  expect(res.body.code).toBe('hoster_pruefseite');
  expect(wcGet).toHaveBeenCalledTimes(1);
  expect(chat.notifyHosterPruefseite).toHaveBeenCalledTimes(1);
};

test('Partner-Sync sync-all: 503 statt 200 mit errors', async () => {
  pruefe503(await request(app).post('/api/partner/verkaeufe/sync-all?shop=jfn').set('x-api-key', API_KEY));
});

test('Festpreis-Sync: 503', async () => {
  pruefe503(await request(app).post('/api/festpreis/verkaeufe/sync').send({ after: '2026-08-01T00:00:00' }));
});

test('Trikot-Sync: 503', async () => {
  pruefe503(await request(app).post('/api/trikot/sync').send({ after: '2026-09-01', dryRun: true }));
});

test('Artikel-Abgleich (erster Workflow-Schritt): 503, kein weiterer Partner', async () => {
  pruefe503(await request(app).post('/api/partner/artikel/abgleich').set('x-api-key', API_KEY));
});
