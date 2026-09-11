// Vorhaben_Code_Check_2026-09 3a: das bekannt-Flag der Fixkosten-API.
//
// Im Reiter Kalkulation_Fixkosten stehen Zeilen, die in keine Berechnung
// eingehen (Nebenkosten, Versandanteil, PayPal-Anteil). In der Tabelle sahen
// sie aus wie die acht echten Positionen - gleicher Betrag, gleiche Einheit,
// gleicher Bearbeiten-Button -, und eine Wertaenderung daran wurde brav ins
// Sheet geschrieben, ohne je eine Abrechnung zu beruehren.
//
// Ob eine Position gerechnet wird, entscheidet die POSITION_MAP. Genau das muss
// die API pro Zeile mitliefern: eine zweite Namensliste im Frontend waere die
// Quelle, aus der die Altlast ueberhaupt entstanden ist, und sie wuerde beim
// naechsten Umbenennen wieder auseinanderlaufen.

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

let request, app, mockValues, istBekanntePosition, POSITION_MAP;

// Kopfzeile und Positionsnamen wie live im Business-Sheet, inklusive der vier
// Altlast-Zeilen (Nebenkosten steht zweimal, mit zwei Gültig_ab).
const HEADER = ['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis'];
const SHEET = [
  HEADER,
  ['Nebenkosten',             '0,8',  'EUR/Artikel',    '01.01.2022', ''],
  ['Versandanteil',           '1,75', 'EUR/Artikel',    '01.01.2022', ''],
  ['PayPal-Anteil',           '0,66', '%/VK',           '01.01.2022', ''],
  ['Versandnebenkosten B',    '0,9',  'EUR/Bestellung', '01.01.2022', ''],
  ['Versandnebenkosten P',    '1,41', 'EUR/Bestellung', '01.01.2022', ''],
  ['Herstellungsnebenkosten', '0,8',  'EUR/Artikel',    '01.01.2022', ''],
  ['Porto B',                 '3',    'EUR/Bestellung', '01.01.2022', ''],
  ['PayPal Prozent',          '2,49', '%',              '01.01.2022', ''],
  ['Porto P',                 '6',    'EUR/Bestellung', '01.01.2022', ''],
  ['PayPal Pauschale',        '0,35', 'EUR/Bestellung', '01.01.2022', ''],
  ['MwSt',                    '19',   '%',              '01.01.2022', ''],
  ['Nebenkosten',             '0,8',  'EUR/Artikel',    '13.05.2026', ''],
];

const TOT = ['Nebenkosten', 'Versandanteil', 'PayPal-Anteil'];

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';

  ({ istBekanntePosition, POSITION_MAP } = await import('../utils/partner-kalkulation.js'));

  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');

  mockValues = { get: jest.fn(), append: jest.fn().mockResolvedValue({ data: {} }) };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values: mockValues } });

  const kalkRouter = await import('../routes/kalkulation.js').then(m => m.default);
  app = express();
  app.use(express.json());
  app.use('/api/kalkulation', kalkRouter);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

beforeEach(() => {
  mockValues.get.mockReset();
  mockValues.get.mockResolvedValue({ data: { values: SHEET } });
});

// ── istBekanntePosition ─────────────────────────────────────────────────────

describe('istBekanntePosition', () => {
  test('jede Position der POSITION_MAP ist bekannt', () => {
    for (const pos of Object.keys(POSITION_MAP)) {
      expect(istBekanntePosition(pos)).toBe(true);
    }
  });

  test('die drei Altlast-Positionen sind nicht bekannt', () => {
    for (const pos of TOT) expect(istBekanntePosition(pos)).toBe(false);
  });

  test('Leerraum um den Namen entscheidet nicht', () => {
    expect(istBekanntePosition('  Porto P  ')).toBe(true);
  });

  test('leer, null und undefined sind nicht bekannt', () => {
    for (const v of ['', '   ', null, undefined]) expect(istBekanntePosition(v)).toBe(false);
  });

  // Ein Praefix macht eine Zeile nicht wirksam - und auch nicht still.
  test('ALT_-Praefix bleibt unbekannt', () => {
    expect(istBekanntePosition('ALT_Nebenkosten')).toBe(false);
    expect(istBekanntePosition('ALT_Porto P')).toBe(false);
  });

  // Ein Objekt-Literal erbt toString, valueOf und Co. von Object.prototype -
  // ohne hasOwnProperty waeren das frei erfundene "bekannte" Positionen.
  test('geerbte Object-Eigenschaften gelten nicht als Position', () => {
    for (const v of ['toString', 'constructor', 'hasOwnProperty', 'valueOf']) {
      expect(istBekanntePosition(v)).toBe(false);
    }
  });
});

// ── GET /api/kalkulation/fixkosten ──────────────────────────────────────────

describe('GET /api/kalkulation/fixkosten - bekannt-Flag', () => {
  test('liefert bekannt je Zeile', async () => {
    const res = await request(app).get('/api/kalkulation/fixkosten');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(SHEET.length - 1);
    for (const row of res.body) {
      expect(typeof row.bekannt).toBe('boolean');
      expect(row.bekannt).toBe(istBekanntePosition(row.position));
    }
  });

  test('die vier Altlast-Zeilen kommen mit bekannt: false', async () => {
    const res = await request(app).get('/api/kalkulation/fixkosten');
    const tot = res.body.filter(r => TOT.includes(r.position));
    // Nebenkosten steht zweimal im Reiter, also vier Zeilen bei drei Namen.
    expect(tot).toHaveLength(4);
    expect(tot.every(r => r.bekannt === false)).toBe(true);
  });

  test('alle acht gerechneten Positionen kommen mit bekannt: true', async () => {
    const res = await request(app).get('/api/kalkulation/fixkosten');
    const echt = res.body.filter(r => r.bekannt === true).map(r => r.position);
    expect(echt.sort()).toEqual(Object.keys(POSITION_MAP).sort());
  });

  test('Betrag, Einheit und Gueltig_ab bleiben unveraendert', async () => {
    const res = await request(app).get('/api/kalkulation/fixkosten');
    const portoP = res.body.find(r => r.position === 'Porto P');
    expect(portoP).toMatchObject({
      betrag: 6, einheit: 'EUR/Bestellung', gueltigAb: '01.01.2022', bekannt: true,
    });
  });

  // Wenn jemand eine Position umbenennt, muss das Flag mitwandern - sonst graut
  // das Frontend die falsche Zeile aus.
  test('eine unbekannte Position im Reiter kippt nur ihre eigene Zeile', async () => {
    mockValues.get.mockResolvedValue({ data: { values: [
      HEADER,
      ['Porto P',     '6', 'EUR/Bestellung', '01.01.2022', ''],
      ['Porto Paket', '6', 'EUR/Bestellung', '01.01.2022', ''],
    ] } });
    const res = await request(app).get('/api/kalkulation/fixkosten');
    expect(res.body.find(r => r.position === 'Porto P').bekannt).toBe(true);
    expect(res.body.find(r => r.position === 'Porto Paket').bekannt).toBe(false);
  });
});
