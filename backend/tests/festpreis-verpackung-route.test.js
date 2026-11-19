// VP1: Verpackungspauschale in Vorschau (summary) und Abrechnung (POST).
// Fehlt der Wert in FP_Partner -> Abrechnung ohne Pauschale, status "fehlt" (laut); sonst eigene Zeile,
// Summe brutto von der Auszahlung abgezogen. Testbetrag frei gewählt.

import { jest } from '@jest/globals';
import { FIXKOSTEN_VOLL } from './hilfen/sheets-attrappe.js';

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
  // die Abrechnung prueft die Zielzeile (Raster) und schreibt alles in EINEM values.batchUpdate.
  const meta = { data: { sheets: [{ properties: { title: 'FP_Abrechnungen', sheetId: 7, gridProperties: { rowCount: 1000 } } }] } };
  google.sheets.mockReturnValue({ spreadsheets: { values: mockValues, get: jest.fn().mockResolvedValue(meta) } });
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
    Kalkulation_Fixkosten: FIXKOSTEN_VOLL.map(r => [...r]),
    Partner_Interne_Bestellungen: [['Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Einzelpreis', 'Summe', 'Status']],
  };
  mockValues.get.mockReset();
  mockValues.get.mockImplementation(async ({ range }) => {
    const [tab, bereich] = range.split('!');
    const werte = (tabs[tab.replace(/^'|'$/g, '')] ?? []).map(r => [...r]);
    const m = /^[A-Z]+(\d+):[A-Z]+(\d+)$/.exec(bereich ?? '');   // fester Zeilenbereich (Zielzeilen-Pruefung)
    return { data: { values: m ? werte.slice(Number(m[1]) - 1, Number(m[2])) : werte } };
  });
  mockValues.append.mockClear();
  mockValues.batchUpdate.mockClear();
});

const body = { partnerId: 'FP-001', vonDatum: '01.01.2026', bisDatum: '30.04.2026' };
// Positionen-JSON der zuletzt geschriebenen Abrechnungszeile (erster Eintrag des batchUpdate)
const abrechnungsJson = () => JSON.parse(mockValues.batchUpdate.mock.calls.at(-1)[0].requestBody.data[0].values[0][8]);

test('Abrechnung: eigene Zeile, 2 versendete Bestellungen ab 01.04., Abholung und März nicht', async () => {
  const res = await request(app).post('/api/festpreis/abrechnungen').send(body);
  expect(res.status).toBe(201);
  expect(res.body.verpackung).toMatchObject({ status: 'ok', anzahl: 2, summe: 4, abholung: 1, vorAb: 1 });
  const json = abrechnungsJson();
  expect(json.verpackung.anzahl).toBe(2);
});

test('Vorschau und Abrechnung rechnen dasselbe Brutto', async () => {
  const vor = await request(app).get('/api/festpreis/verkaeufe/summary').query({ partnerId: 'FP-001', vonDatum: body.vonDatum, bisDatum: body.bisDatum });
  const abr = await request(app).post('/api/festpreis/abrechnungen').send(body);
  expect(vor.body.verpackung.summe).toBe(4);
  expect(vor.body.gesamtBrutto).toBe(abr.body.gesamtBrutto);
  expect(vor.body.gesamtBrutto).toBeCloseTo(vor.body.auszahlungBrutto - 4, 2);
});

// Inhaber 19.11.: wie beim Porto sperrt "fehlt" die Abrechnung (vorher: ohne Pauschale). Vorschau zeigt den Punkt.
test('fehlender Betrag -> Abrechnung gesperrt (erst klaeren), nichts geschrieben; Vorschau zeigt den Punkt', async () => {
  tabs.FP_Partner = partner('', '');
  const res = await request(app).post('/api/festpreis/abrechnungen').send(body);
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('erst_klaeren');
  expect(res.body.klaeren.map(k => k.art)).toEqual(['verpackung']);
  expect(res.body.klaeren[0].weg).toMatch(/nicht berechnet/);
  expect(mockValues.batchUpdate).not.toHaveBeenCalled();
  const vor = await request(app).get('/api/festpreis/verkaeufe/summary').query({ partnerId: 'FP-001', vonDatum: body.vonDatum, bisDatum: body.bisDatum });
  expect(vor.body.verpackung.status).toBe('fehlt');
  expect(vor.body.klaeren.map(k => k.art)).toEqual(['verpackung']);
});

test('Spalten fehlen ganz -> ebenfalls gesperrt (nie 0 annehmen)', async () => {
  tabs.FP_Partner = [['Partner-ID', 'Name', 'Shop', 'Aktiv'], ['FP-001', 'X', 'jfn', 'Ja']];
  const res = await request(app).post('/api/festpreis/abrechnungen').send(body);
  expect(res.status).toBe(409);
  expect(res.body.klaeren[0].art).toBe('verpackung');
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

test('Bestandszeile ohne Versandmethode -> gesperrt, Hinweis im Klaer-Punkt', async () => {
  tabs['FP_Verkäufe'].push(zeile('05.04.2026', '103', 'A', ''));
  const res = await request(app).post('/api/festpreis/abrechnungen').send(body);
  expect(res.status).toBe(409);
  expect(res.body.klaeren[0]).toMatchObject({ art: 'verpackung' });
  expect(res.body.klaeren[0].weg).toMatch(/Versandmethode fehlt/);
});
