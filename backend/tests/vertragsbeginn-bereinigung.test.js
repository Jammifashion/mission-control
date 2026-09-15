// POST /api/kalkulation/verkaeufe/vor-vertragsbeginn – Zeilen vor Vertrag-ab entfernen.
//
// Schutzregeln: Trockenlauf ist Standard; geloescht wird nur mit loeschen:true
// UND passender Erwartung (Zeilen + Summe) gegen den frisch gelesenen Stand;
// abgerechnete Zeilen oder fehlendes Vertrag-ab → kein Schreiben; ein
// batchUpdate von unten nach oben; danach Kontrolllesung. Die Zeilenliste
// steht in der Antwort, nie im Log.

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

const PH = ['Partner-ID', 'Name', 'Aktiv', 'Lizenz-%', 'Porto-Modell', 'Shop', 'Vertrag-ab'];
const VH = [
  'Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante',
  'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status', 'Produkt-ID',
  'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status',
];
const STORNO = 'Storniert/Rückerstattet';
const TAB = 'HK_Partner_Verkäufe';
const z = (partner, datum, order, artikel, stk, liz, status = 'offen', storno = '') =>
  [partner, datum, order, artikel, '1', stk, '20', liz, status, '1', '10', liz, '0', liz, storno];

// Sheet-Zeile im Kommentar (Kopfzeile = 1)
function verkaeufe() {
  return [
    VH,
    z('P-004', '25.11.2022', '880',  'Shirt A', '1',  '3,82'),                       // 2  weg
    z('P-004', '10.01.2025', '2100', 'Shirt B', '1',  '4,00'),                       // 3  bleibt
    z('P-004', '18.08.2023', '985',  'Shirt C', '1',  '4,60'),                       // 4  weg
    z('P-004', '12.01.2024', '985',  'Shirt C', '-1', '-4,60', 'offen', STORNO),     // 5  weg (Paar vor Stichtag)
    z('P-004', '01.02.2024', '1500', 'Shirt D', '1',  '5,00'),                       // 6  weg
    z('P-004', '03.02.2025', '1500', 'Shirt D', '-1', '-5,00', 'offen', STORNO),     // 7  weg (folgt Verkauf)
    z('P-005', '01.01.2022', '100',  'Fremd',   '1',  '9,99'),                       // 8  fremder Partner
    [],                                                                               // 9  Leerzeile
    z('P-004', '01.01.2025', '2000', 'Shirt E', '1',  '2,00'),                       // 10 Stichtag bleibt
    z('P-004', '05.05.2022', '700',  'Shirt F', '-1', '-1,00', 'offen', STORNO),     // 11 Waise bleibt
  ];
}

let request, app, util, values, ss, tabs;

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';
  util = await import('../utils/vertragsbeginn-bereinigung.js');

  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');

  values = { get: jest.fn() };
  ss = { values, get: jest.fn(), batchUpdate: jest.fn() };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: ss });

  const { default: router } = await import('../routes/kalkulation.js');
  app = express();
  app.use(express.json());
  app.use('/api/kalkulation', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

beforeEach(() => {
  tabs = {
    Partner: [
      PH,
      ['P-004', 'Honk', 'Ja', '40', 'geteilt-50-50', 'honk', '01.01.2025'],
      ['P-005', 'X',    'Ja', '40', 'geteilt-50-50', 'honk', ''],
    ],
    [TAB]: verkaeufe(),
  };
  values.get.mockReset();
  values.get.mockImplementation(async ({ range }) => ({
    data: { values: (tabs[range.slice(0, range.indexOf('!'))] ?? []).map(r => [...r]) },
  }));
  ss.get.mockReset();
  ss.get.mockResolvedValue({ data: { sheets: [{ properties: { title: TAB, sheetId: 4711 } }] } });
  // Loeschungen im Mock wirklich ausfuehren - der Reihe nach, wie die Sheets-API.
  ss.batchUpdate.mockReset();
  ss.batchUpdate.mockImplementation(async ({ requestBody }) => {
    for (const { deleteDimension: { range } } of requestBody.requests) tabs[TAB].splice(range.startIndex, 1);
    return { data: {} };
  });
});

const post = (body, shop = 'honk') => request(app)
  .post(`/api/kalkulation/verkaeufe/vor-vertragsbeginn?shop=${shop}`)
  .send(body);
const LOESCHEN_OK = { partnerId: 'P-004', loeschen: true, erwarteteZeilen: 5, erwarteteSumme: '3,82' };

// ── Trockenlauf ──────────────────────────────────────────────────────────────

describe('Trockenlauf (Standard)', () => {
  test('200, Zeilenliste in der Antwort, nichts geschrieben, nichts geloggt', async () => {
    const log  = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post({ partnerId: 'P-004' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      partnerId: 'P-004', tab: TAB, vertragAb: '01.01.2025', geloescht: false,
      anzahl: 5, summe: 3.82, abgerechnet: 0, waisen: 1, bleiben: 3,
    });
    expect(res.body.zeilen.map(r => r.zeile)).toEqual([2, 4, 5, 6, 7]);
    expect(res.body.zeilen[0]).toEqual({
      zeile: 2, orderId: '880', datum: '25.11.2022', artikel: 'Shirt A', variante: '1',
      stueckzahl: 1, lizenzgebuehr: 3.82, status: 'offen', storno: false,
    });
    expect(res.body.zeilen.find(r => r.zeile === 7)).toMatchObject({ storno: true, lizenzgebuehr: -5 });
    expect(ss.batchUpdate).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    log.mockRestore(); warn.mockRestore();
  });

  test('Stichtag, fremder Partner und Gegenbuchung ohne Verkauf bleiben', async () => {
    const res = await post({ partnerId: 'P-004' });
    const nummern = res.body.zeilen.map(r => r.zeile);
    expect(nummern).not.toContain(3);
    expect(nummern).not.toContain(8);
    expect(nummern).not.toContain(10);
    expect(nummern).not.toContain(11);
  });

  test('loeschen:false ist ebenfalls Trockenlauf', async () => {
    const res = await post({ ...LOESCHEN_OK, loeschen: false });
    expect(res.status).toBe(200);
    expect(res.body.geloescht).toBe(false);
    expect(ss.batchUpdate).not.toHaveBeenCalled();
  });

  test('Shop bestimmt den Reiter', async () => {
    tabs['Partner_Verkäufe'] = [VH];
    const res = await post({ partnerId: 'P-004' }, 'jfn');
    expect(res.body).toMatchObject({ tab: 'Partner_Verkäufe', anzahl: 0 });
  });
});

// ── Löschen ──────────────────────────────────────────────────────────────────

describe('Löschen', () => {
  test('passende Erwartung: ein batchUpdate von unten nach oben, Kontrolllesung aus dem Sheet', async () => {
    const res = await post(LOESCHEN_OK);
    expect(res.status).toBe(200);
    expect(res.body.geloescht).toBe(true);

    expect(ss.batchUpdate).toHaveBeenCalledTimes(1);
    const { requests } = ss.batchUpdate.mock.calls[0][0].requestBody;
    expect(requests.map(q => q.deleteDimension.range.startIndex)).toEqual([6, 5, 4, 3, 1]);
    expect(requests.every(q => q.deleteDimension.range.sheetId === 4711)).toBe(true);

    // 3, 10, 11 bleiben: 4,00 + 2,00 − 1,00
    expect(res.body.kontrolle).toEqual({ zeilen: 3, summe: 5 });
    expect(tabs[TAB].filter(r => r[0] === 'P-005')).toHaveLength(1);
  });

  test('Summe als Zahl wird ebenso akzeptiert', async () => {
    const res = await post({ ...LOESCHEN_OK, erwarteteSumme: 3.82 });
    expect(res.body.geloescht).toBe(true);
  });

  test.each([
    [48, '192,61'], [4, '3,82'], [5, '3,81'], [5, '3,83'],
  ])('Erwartung %p / %p passt nicht → 409 ohne Schreiben, gefundene Werte in der Antwort', async (zeilen, summe) => {
    const res = await post({ ...LOESCHEN_OK, erwarteteZeilen: zeilen, erwarteteSumme: summe });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ geloescht: false, anzahl: 5, summe: 3.82 });
    expect(res.body.freigabe.grund).toMatch(/gefunden: 5 Zeilen, Summe 3,82 €/);
    expect(res.body.zeilen).toHaveLength(5);
    expect(ss.batchUpdate).not.toHaveBeenCalled();
  });

  test('abgerechnete Zeile in der Auswahl → 409 ohne Schreiben', async () => {
    tabs[TAB][1][8] = 'abgerechnet';
    const res = await post(LOESCHEN_OK);
    expect(res.status).toBe(409);
    expect(res.body.abgerechnet).toBe(1);
    expect(res.body.freigabe.grund).toMatch(/abgerechnete/);
    expect(ss.batchUpdate).not.toHaveBeenCalled();
  });

  test('Zeilennummern aus dem frischen Read – eingefügte Zeile verschiebt die Auswahl mit', async () => {
    tabs[TAB].splice(1, 0, z('P-005', '01.03.2026', '9999', 'Neu', '1', '1,00'));
    const res = await post(LOESCHEN_OK);
    const { requests } = ss.batchUpdate.mock.calls[0][0].requestBody;
    expect(requests.map(q => q.deleteDimension.range.endIndex)).toEqual([8, 7, 6, 5, 3]);
    expect(res.body.kontrolle).toEqual({ zeilen: 3, summe: 5 });
    expect(tabs[TAB].some(r => r[2] === '9999')).toBe(true);
  });

  test('Reiter nicht gefunden → 500 vor dem Löschen', async () => {
    ss.get.mockResolvedValue({ data: { sheets: [{ properties: { title: 'Anderer', sheetId: 1 } }] } });
    const res = await post(LOESCHEN_OK);
    expect(res.status).toBe(500);
    expect(ss.batchUpdate).not.toHaveBeenCalled();
  });
});

// ── Abbrüche vor der Auswahl ────────────────────────────────────────────────

describe('Abbrüche', () => {
  test('Partner ohne Vertrag-ab → 409, auch im Trockenlauf', async () => {
    tabs.Partner[1][6] = '';
    const res = await post({ partnerId: 'P-004' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/kein Vertrag-ab/);
    expect(ss.batchUpdate).not.toHaveBeenCalled();
  });

  test.each([
    [{}, /partnerId/],
    [{ partnerId: 'P-004; x' }, /partnerId/],
    [{ partnerId: 'P-004', loeschen: 'true', erwarteteZeilen: 5, erwarteteSumme: 3.82 }, /Boolean/],
    [{ partnerId: 'P-004', loeschen: true }, /erwarteteZeilen/],
    [{ partnerId: 'P-004', loeschen: true, erwarteteZeilen: 5 }, /erwarteteSumme/],
    [{ partnerId: 'P-004', erwarteteZeilen: '4,8' }, /ganze Zahl/],
    [{ partnerId: 'P-004', erwarteteSumme: 'viel' }, /keine Zahl/],
  ])('%p → 400 vor jedem Sheet-Zugriff', async (body, meldung) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(meldung);
    expect(values.get).not.toHaveBeenCalled();
  });
});

// ── Reine Logik ──────────────────────────────────────────────────────────────

describe('pruefeFreigabe', () => {
  const auswahl = { anzahl: 48, summe: 192.61, abgerechnet: [] };

  test('ohne loeschen: Trockenlauf', () => {
    expect(util.pruefeFreigabe({ loeschen: false }, auswahl).loeschen).toBe(false);
  });

  test('Erwartung passt → löschen', () => {
    expect(util.pruefeFreigabe({ loeschen: true, erwarteteZeilen: 48, erwarteteSumme: 192.61 }, auswahl).loeschen).toBe(true);
  });

  test('keine Auswahl → nichts zu löschen, auch bei Erwartung 0', () => {
    const f = util.pruefeFreigabe({ loeschen: true, erwarteteZeilen: 0, erwarteteSumme: 0 }, { anzahl: 0, summe: 0, abgerechnet: [] });
    expect(f.loeschen).toBe(false);
  });
});

describe('baueLoeschRequests', () => {
  test('von unten nach oben', () => {
    const req = util.baueLoeschRequests(9, [2, 4, 5].map(n => ({ _sheetRow: n })));
    expect(req.map(r => r.deleteDimension.range.startIndex)).toEqual([4, 3, 1]);
  });

  test('doppelte Zeilennummer wirft', () => {
    expect(() => util.baueLoeschRequests(1, [{ _sheetRow: 3 }, { _sheetRow: 3 }])).toThrow(/Doppelte/);
  });
});

describe('betrag', () => {
  test.each([['3,82', 3.82], ['192.61', 192.61], ['1.234,56', 1234.56], ['-4,60', -4.6], [3.82, 3.82]])('%p → %p', (v, n) => {
    expect(util.betrag(v)).toBe(n);
  });
  test.each(['', 'x', null])('%p → NaN', v => {
    expect(util.betrag(v)).toBeNaN();
  });
});
