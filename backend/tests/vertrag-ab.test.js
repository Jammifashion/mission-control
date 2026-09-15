// Vertrag-ab: Startdatum der Vereinbarung je Partner (neue Spalte im Partner-Reiter).
//
// P-004: Vereinbarung ab 01.01.2025, der Neu-Sync holte aber Bestellungen ab
// 2022. Leer = keine Grenze, fuer alle anderen Partner aendert sich nichts.

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

const HEADER_ALT = ['Partner-ID', 'Name', 'Hauptkategorie', 'Token', 'Aktiv', 'Lizenz-%', 'Porto-Modell', 'Notiz', 'Shop'];

let request, app, values, tabs, parseVertragAb, baueVertragsbeginne;

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';
  ({ parseVertragAb, baueVertragsbeginne } = await import('../utils/partner-kalkulation.js'));

  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');

  values = { get: jest.fn(), append: jest.fn(), batchUpdate: jest.fn(), update: jest.fn() };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values } });

  const { default: router } = await import('../routes/kalkulation.js');
  app = express();
  app.use(express.json());
  app.use('/api/kalkulation', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

beforeEach(() => {
  tabs = {
    Partner: [
      HEADER_ALT,
      ['P-003', 'Honk JFN', '', 't3', 'Ja', '40', 'geteilt-50-50', '', 'jfn'],
      ['P-004', 'Honk Shop', '', 't4', 'Ja', '40', 'geteilt-50-50', '', 'honk'],
    ],
  };
  values.get.mockReset();
  values.get.mockImplementation(async ({ range }) => ({
    data: { values: (tabs[range.slice(0, range.indexOf('!'))] ?? []).map(r => [...r]) },
  }));
  for (const f of ['append', 'batchUpdate', 'update']) {
    values[f].mockReset();
    values[f].mockResolvedValue({ data: {} });
  }
});

describe('parseVertragAb', () => {
  test.each([
    ['01.01.2025', Date.UTC(2025, 0, 1)],
    ['1.1.2025',   Date.UTC(2025, 0, 1)],
    [' 01.01.2025 ', Date.UTC(2025, 0, 1)],
    ['2025-01-01', Date.UTC(2025, 0, 1)],
    ['29.02.2024', Date.UTC(2024, 1, 29)],
  ])('%p → Datum', (wert, ms) => {
    expect(parseVertragAb(wert, 'P-004').getTime()).toBe(ms);
  });

  test.each(['', '   ', null, undefined])('%p → keine Grenze (null)', (wert) => {
    expect(parseVertragAb(wert, 'P-004')).toBeNull();
  });

  test.each(['31.02.2025', '29.02.2025', '01/01/2025', 'ab Januar', '2025', '13.13.2025'])(
    '%p wirft mit Partner-ID', (wert) => {
      expect(() => parseVertragAb(wert, 'P-004')).toThrow(/P-004/);
    },
  );
});

describe('baueVertragsbeginne', () => {
  test('Spalte fehlt → für niemanden eine Grenze', () => {
    const vb = baueVertragsbeginne(HEADER_ALT, tabs.Partner.slice(1));
    expect(vb('P-003')).toBeNull();
    expect(vb('P-004')).toBeNull();
  });

  test('P-004 mit Datum, P-003 leer, unbekannter Partner ohne Grenze', () => {
    const header = [...HEADER_ALT, 'Vertrag-ab'];
    const rows = [
      [...tabs.Partner[1], ''],
      [...tabs.Partner[2], '01.01.2025'],
    ];
    const vb = baueVertragsbeginne(header, rows);
    expect(vb('P-004').getTime()).toBe(Date.UTC(2025, 0, 1));
    expect(vb('P-003')).toBeNull();
    expect(vb('P-999')).toBeNull();
  });

  test('kaputter Wert im Sheet → 500 mit Partner-ID', () => {
    const header = [...HEADER_ALT, 'Vertrag-ab'];
    const vb = baueVertragsbeginne(header, [[...tabs.Partner[2], '31.02.2025']]);
    expect(() => vb('P-004')).toThrow(expect.objectContaining({ status: 500, message: expect.stringMatching(/P-004/) }));
  });
});

describe('Partner-API – Vertrag-ab', () => {
  test('PATCH legt die Spalte an und schreibt das Datum als TT.MM.JJJJ', async () => {
    const res = await request(app).patch('/api/kalkulation/partner/P-004').send({ vertragAb: '2025-01-01' });
    expect(res.status).toBe(200);
    expect(res.body.updated).toContain('Vertrag-ab');

    // Kopfzeile: neue Spalte J (Index 9) hinter "Shop"
    expect(values.update).toHaveBeenCalledWith(expect.objectContaining({
      range: 'Partner!J1', requestBody: { values: [['Vertrag-ab']] },
    }));
    const data = values.batchUpdate.mock.calls[0][0].requestBody.data;
    expect(data).toEqual([{ range: 'Partner!J3', majorDimension: 'ROWS', values: [['01.01.2025']] }]);
  });

  test('vorhandene Spalte wird nicht neu angelegt', async () => {
    tabs.Partner = [[...HEADER_ALT, 'Vertrag-ab'], [...tabs.Partner[1], ''], [...tabs.Partner[2], '']];
    await request(app).patch('/api/kalkulation/partner/P-004').send({ vertragAb: '01.01.2025' });
    expect(values.update).not.toHaveBeenCalled();
    expect(values.batchUpdate.mock.calls[0][0].requestBody.data)
      .toEqual([{ range: 'Partner!J3', majorDimension: 'ROWS', values: [['01.01.2025']] }]);
  });

  test('ungültiges Datum → 400, nichts geschrieben, nicht einmal gelesen', async () => {
    const res = await request(app).patch('/api/kalkulation/partner/P-004').send({ vertragAb: '31.02.2025' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/P-004/);
    expect(values.get).not.toHaveBeenCalled();
    expect(values.update).not.toHaveBeenCalled();
    expect(values.batchUpdate).not.toHaveBeenCalled();
  });

  test('leerer Wert bei fehlender Spalte (Formular ohne Eingabe) verändert das Sheet nicht', async () => {
    const res = await request(app).patch('/api/kalkulation/partner/P-003').send({ name: 'Honk JFN', vertragAb: '' });
    expect(res.status).toBe(200);
    expect(values.update).not.toHaveBeenCalled();
    const ranges = values.batchUpdate.mock.calls[0][0].requestBody.data.map(d => d.range);
    expect(ranges).toEqual(['Partner!B2']);
  });

  test('leerer Wert bei vorhandener Spalte leert das Feld', async () => {
    tabs.Partner = [[...HEADER_ALT, 'Vertrag-ab'], [...tabs.Partner[1], ''], [...tabs.Partner[2], '01.01.2025']];
    await request(app).patch('/api/kalkulation/partner/P-004').send({ vertragAb: '' });
    expect(values.batchUpdate.mock.calls[0][0].requestBody.data)
      .toEqual([{ range: 'Partner!J3', majorDimension: 'ROWS', values: [['']] }]);
  });

  test('GET liefert vertragAb, leer bei fehlender Spalte', async () => {
    let res = await request(app).get('/api/kalkulation/partner?shop=honk');
    expect(res.body[0]).toMatchObject({ id: 'P-004', vertragAb: '' });

    tabs.Partner = [[...HEADER_ALT, 'Vertrag-ab'], [...tabs.Partner[1], ''], [...tabs.Partner[2], '01.01.2025']];
    res = await request(app).get('/api/kalkulation/partner?shop=honk');
    expect(res.body[0]).toMatchObject({ id: 'P-004', vertragAb: '01.01.2025' });
  });

  test('POST mit Vertrag-ab legt Spalte an und schreibt den Wert in die neue Zeile', async () => {
    const res = await request(app).post('/api/kalkulation/partner').send({ name: 'Neu', vertragAb: '15.3.2026' });
    expect(res.status).toBe(201);
    expect(res.body.vertragAb).toBe('15.03.2026');
    const zeile = values.append.mock.calls[0][0].requestBody.values[0];
    expect(zeile).toHaveLength(10);
    expect(zeile[9]).toBe('15.03.2026');
  });
});
