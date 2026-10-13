// VP1: Verpackungspauschale in Vorschau (summary) und Abrechnung (POST).
// Fehlt der Wert in FP_Partner -> Abrechnung ohne Pauschale, status "fehlt" (laut); sonst eigene Zeile,
// Summe brutto von der Auszahlung abgezogen. Testbetrag frei gewählt.

import { jest } from '@jest/globals';

jest.unstable_mockModule('googleapis', () => ({ google: { sheets: jest.fn() } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: jest.fn().mockResolvedValue({}) }));
jest.unstable_mockModule('../lib/shopConfig.js', () => ({ getWcClient: jest.fn() }));

let request, app, mockValues, tabs;

const V_KOPF = ['Partner-ID', 'Datum', 'WC-Bestellnummer', 'Artikelname', 'Variante', 'Stückzahl', 'Festpreis-EK', 'Handling',
  'Porto-Einnahme', 'Porto-Kosten', 'Versandnebenkosten', 'PayPal-Kosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto',
  'Status Abrechnung', 'Produkt-ID', 'Storno-Status', 'Artikelkategorie', 'Festpreis', 'Mehrkosten', 'VK-Netto', 'Handlingskosten', 'Versandmethode'];
const zeile = (datum, oid, art, methode) =>
  ['FP-001', datum, oid, art, '0', '1', '0', '0', '0', '0', '0', '0', '10', '11,9', 'offen', '1', '', 'Shirt', '0', '0', '10', '0', methode];

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';
  ({ default: request } = await import('supertest'));
  const { default: express } = await import('express');
  mockValues = { get: jest.fn(), append: jest.fn().mockResolvedValue({ data: {} }), batchUpdate: jest.fn().mockResolvedValue({ data: {} }) };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values: mockValues } });
  app = express();
  app.use(express.json());
  app.use('/api/festpreis', (await import('../routes/festpreis-portal.js')).default);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

const partner = (betrag, ab) => [['Partner-ID', 'Name', 'Shop', 'Aktiv', 'Notiz', 'Token', 'Kategorien', 'Verpackung_je_Bestellung', 'Verpackung_ab'],
  ['FP-001', 'X', 'jfn', 'Ja', '', 't', '', betrag, ab]];

beforeEach(() => {
  tabs = {
    FP_Partner: partner('2', '01.04.2026'),
    'FP_Verkäufe': [V_KOPF,
      zeile('31.03.2026', '99', 'A', 'flat_rate'),
      zeile('02.04.2026', '100', 'A', 'flat_rate'),
      zeile('02.04.2026', '100', 'B', 'flat_rate'),
      zeile('03.04.2026', '101', 'A', 'local_pickup'),
      zeile('04.04.2026', '102', 'A', 'free_shipping')],
    FP_Abrechnungen: [['Abrechnungs-ID', 'Partner-ID']],
    Kalkulation_Fixkosten: [['Position', 'Wert', 'Gültig_ab', 'Gültig_bis'], ['MwSt', '19', '', '']],
    Partner_Interne_Bestellungen: [['Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Einzelpreis', 'Summe', 'Status']],
  };
  mockValues.get.mockReset();
  mockValues.get.mockImplementation(async ({ range }) => ({ data: { values: (tabs[range.split('!')[0]] ?? []).map(r => [...r]) } }));
  mockValues.append.mockClear();
  mockValues.batchUpdate.mockClear();
});

const body = { partnerId: 'FP-001', vonDatum: '01.01.2026', bisDatum: '30.04.2026' };

test('Abrechnung: eigene Zeile, 2 versendete Bestellungen ab 01.04., Abholung und März nicht', async () => {
  const res = await request(app).post('/api/festpreis/abrechnungen').send(body);
  expect(res.status).toBe(201);
  expect(res.body.verpackung).toMatchObject({ status: 'ok', anzahl: 2, summe: 4, abholung: 1, vorAb: 1 });
  const json = JSON.parse(mockValues.append.mock.calls[0][0].requestBody.values[0][8]);
  expect(json.verpackung.anzahl).toBe(2);
});

test('Vorschau und Abrechnung rechnen dasselbe Brutto', async () => {
  const vor = await request(app).get('/api/festpreis/verkaeufe/summary').query({ partnerId: 'FP-001', vonDatum: body.vonDatum, bisDatum: body.bisDatum });
  const abr = await request(app).post('/api/festpreis/abrechnungen').send(body);
  expect(vor.body.verpackung.summe).toBe(4);
  expect(vor.body.gesamtBrutto).toBe(abr.body.gesamtBrutto);
  expect(vor.body.gesamtBrutto).toBeCloseTo(vor.body.auszahlungBrutto - 4, 2);
});

test('fehlender Betrag -> Abrechnung OHNE Pauschale, laut (status fehlt), nie 0 abgezogen', async () => {
  const mit = await request(app).post('/api/festpreis/abrechnungen').send(body);
  tabs.FP_Partner = partner('', '');
  mockValues.append.mockClear();
  const res = await request(app).post('/api/festpreis/abrechnungen').send(body);
  expect(res.status).toBe(201);
  expect(res.body.verpackung.status).toBe('fehlt');
  expect(res.body.verpackung.hinweise[0]).toMatch(/nicht berechnet/);
  expect(res.body.gesamtBrutto).toBeCloseTo(mit.body.gesamtBrutto + 4, 2);
  const json = JSON.parse(mockValues.append.mock.calls[0][0].requestBody.values[0][8]);
  expect(json.verpackung.status).toBe('fehlt');
});

test('Spalten fehlen ganz -> ebenfalls status fehlt (nie 0 annehmen)', async () => {
  tabs.FP_Partner = [['Partner-ID', 'Name', 'Shop', 'Aktiv'], ['FP-001', 'X', 'jfn', 'Ja']];
  const res = await request(app).post('/api/festpreis/abrechnungen').send(body);
  expect(res.status).toBe(201);
  expect(res.body.verpackung.status).toBe('fehlt');
});

test('"nein" -> keine Pauschale, Abrechnung wie bisher', async () => {
  tabs.FP_Partner = partner('nein', '');
  const res = await request(app).post('/api/festpreis/abrechnungen').send(body);
  expect(res.status).toBe(201);
  expect(res.body.verpackung).toBeNull();
});

test('Zeitraumgrenze: bis 02.04. zählt nur Bestellung 100', async () => {
  const res = await request(app).post('/api/festpreis/abrechnungen').send({ ...body, bisDatum: '02.04.2026' });
  expect(res.body.verpackung.anzahl).toBe(1);
});

test('Bestandszeile ohne Versandmethode -> status fehlt mit Hinweis', async () => {
  tabs['FP_Verkäufe'].push(zeile('05.04.2026', '103', 'A', ''));
  const res = await request(app).post('/api/festpreis/abrechnungen').send(body);
  expect(res.status).toBe(201);
  expect(res.body.verpackung.status).toBe('fehlt');
  expect(res.body.verpackung.hinweise[0]).toMatch(/Versandmethode fehlt/);
});
