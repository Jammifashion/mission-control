// Lizenz-Abrechnungen (kalkulation.js) gegen gemockte Sheets.
//
// Punkt 4: Der angezeigte Lizenzsatz einer Verkaufszeile kommt aus ihren
// gespeicherten Werten (Lizenz-Anteil ÷ Gewinn-netto), nicht aus dem aktuellen
// Partner-Satz. Alte 50-%-Zeilen muessen weiter 50 % zeigen.

import { jest } from '@jest/globals';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn() },
}));

jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: jest.fn(),
  getShopConfig: jest.fn().mockReturnValue({
    shop: 'jfn', label: 'JFN', wcUrl: '', wcKey: '', wcSecret: '',
    tabVerkaeufe: 'Partner_Verkäufe', tabAbrechnungen: 'Partner_Abrechnungen',
  }),
  normalizeShop: jest.fn(s => s ?? 'jfn'),
}));

const VH = [
  'Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante',
  'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status', 'Produkt-ID',
  'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status',
];
const AH = ['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Verkaufs-Guthaben', 'Saldo', 'Status', 'Erstellt-Am', 'Notiz', 'Positionen'];
const IH = ['Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Einzelpreis', 'Summe', 'Status'];

let request, app, values, tabs, lizenzSatzAusZeile;

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';
  ({ lizenzSatzAusZeile } = await import('../utils/partner-kalkulation.js'));

  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');

  values = { get: jest.fn(), append: jest.fn(), batchUpdate: jest.fn() };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values, get: jest.fn(), batchUpdate: jest.fn() } });

  const { default: router } = await import('../routes/kalkulation.js');
  app = express();
  app.use(express.json());
  app.use('/api/kalkulation', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

beforeEach(() => {
  tabs = {
    Partner: [
      ['Partner-ID', 'Name', 'Aktiv', 'Lizenz-%', 'Porto-Modell'],
      ['P-001', 'Test', 'Ja', '40', 'geteilt-50-50'],
    ],
    Partner_Artikel: [
      ['Partner-ID', 'Artikelnummer', 'Produkt-ID', 'Artikelname', 'EK-Preis-Netto', 'Druckkosten', 'Versandart', 'Lizenz-%'],
      ['P-001', 'S1', '1', 'Shirt', '3', '2', 'P', '50'],
    ],
    Kalkulation_Fixkosten: [['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis'], ['MwSt', '19', '%', '01.01.2022', '']],
    'Partner_Verkäufe': [
      VH,
      // Altzeile, mit 50 % gerechnet
      ['P-001', '01.06.2026', '100', 'Shirt', '0', '1', '21', '7,5', 'offen', '1', '15', '7,5', '0', '8,93', ''],
      // neue Zeile, mit 40 % gerechnet
      ['P-001', '02.06.2026', '101', 'Shirt', '0', '2', '42', '11,2', 'offen', '1', '28', '11,2', '0', '13,33', ''],
      // Altsync ohne Aufschluesselung
      ['P-001', '03.06.2026', '102', 'Shirt', '0', '1', '21', '6', 'offen', '1', '', '', '', '', ''],
    ],
    Partner_Interne_Bestellungen: [IH],
    Partner_Abrechnungen: [AH],
  };
  values.get.mockReset();
  values.get.mockImplementation(async ({ range }) => ({
    data: { values: tabs[range.slice(0, range.indexOf('!'))] ?? [] },
  }));
  values.append.mockReset();
  values.append.mockResolvedValue({ data: {} });
  values.batchUpdate.mockReset();
  values.batchUpdate.mockResolvedValue({ data: {} });
});

describe('lizenzSatzAusZeile', () => {
  test.each([
    [15, 7.5, 50], [28, 11.2, 40], [14.23, 5.690528, 40], [-28, -11.2, 40], [10, 4.5, 45],
  ])('Gewinn %p, Anteil %p → %p %', (g, a, erwartet) => {
    expect(lizenzSatzAusZeile(g, a)).toBe(erwartet);
  });

  test.each([[0, 0], ['', ''], [undefined, undefined], ['x', 1]])('nicht ableitbar (%p, %p) → null', (g, a) => {
    expect(lizenzSatzAusZeile(g, a)).toBeNull();
  });
});

describe('POST /abrechnung/erstellen – Satz im Positions-Detail', () => {
  test('alte 50-%-Zeile zeigt 50 %, neue 40 %, Altsync fällt auf den Partner-Satz', async () => {
    const res = await request(app).post('/api/kalkulation/abrechnung/erstellen')
      .send({ partnerId: 'P-001', zeitraumVon: '01.06.2026', zeitraumBis: '30.06.2026' });
    expect(res.status).toBe(201);

    const zeile = values.append.mock.calls[0][0].requestBody.values[0];
    const positionen = JSON.parse(zeile[AH.indexOf('Positionen')]);
    expect(positionen.verkaeufe.map(v => v.detail.lizenzProzent)).toEqual([50, 40, 40]);
  });

  test('Partner-Satz 40 % ändert gespeicherte Lizenzbeträge nicht', async () => {
    const res = await request(app).post('/api/kalkulation/abrechnung/erstellen')
      .send({ partnerId: 'P-001', zeitraumVon: '01.06.2026', zeitraumBis: '30.06.2026' });
    expect(res.body.lizenzSumme).toBe(24.7); // 7,5 + 11,2 + 6 aus dem Sheet
  });
});
