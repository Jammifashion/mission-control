// POST /api/trikot/sync – Route + lib/trikotSync.js gegen gemockte Sheets/WC.
// Die reine Zeilenlogik prüft trikot-logic.test.js; hier geht es um Optionen,
// Dedup gegen den Bestand, Append-Parameter und die Antwortform.

import { jest } from '@jest/globals';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn() },
}));

jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: jest.fn(),
}));

const ARTIKEL = [
  ['Artikelnummer', 'Produkt-ID', 'Produktname', 'Aktiv'],
  ['', 19365, '', true],
];

const HEADER = [
  'Zeilen-ID', 'Erfasst_Am', 'Bestelldatum', 'Order-ID', 'Order-Item-ID',
  'Kunde', 'Artikelnummer', 'Produktname', 'Groesse', 'Farbe',
  'Name', 'Nummer', 'Stueck', 'Quelle', 'Rohtext',
  'Charge', 'Bestellt_Am', 'Geliefert_Am', 'Status', 'Notiz',
];

const ORDERS = [
  {
    id: 100, date_created: '2026-09-09T10:00:00', customer_note: '',
    billing: { first_name: 'A', last_name: 'B' },
    line_items: [
      { id: 1, product_id: 19365, variation_id: 5, sku: 'T-1', quantity: 2, name: 'Trikot',
        meta_data: [{ key: 'Wunschname', value: 'Max' }, { key: 'pa_groesse', display_key: 'Größe', value: 'l', display_value: 'L' }] },
      { id: 2, product_id: 19365, variation_id: 6, sku: 'T-1', quantity: 1, name: 'Trikot',
        meta_data: [{ key: 'pa_name-nummer', display_key: 'Name - Nummer', value: 'x', display_value: 'BRUNS - 15' }] },
      { id: 3, product_id: 19365, variation_id: 7, sku: 'T-1', quantity: 1, name: 'Trikot',
        meta_data: [{ key: 'pa_name-nummer', display_key: 'Name - Nummer', value: 'x', display_value: 'WUNSCHNAME - WUNSCHNUMMER' }] },
      { id: 4, product_id: 999, variation_id: 0, sku: 'X', quantity: 1, name: 'Tasse', meta_data: [] },
    ],
  },
];

let request, app, mockValues, mockWcGet, trikotRows;

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';

  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');

  mockValues = { get: jest.fn(), append: jest.fn() };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values: mockValues } });

  mockWcGet = jest.fn();
  const { getWcClient } = await import('../lib/shopConfig.js');
  getWcClient.mockReturnValue({ get: mockWcGet });

  const { default: trikotRouter } = await import('../routes/trikot.js');
  app = express();
  app.use(express.json());
  app.use('/api/trikot', trikotRouter);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

beforeEach(() => {
  trikotRows = [HEADER];
  mockValues.get.mockReset();
  mockValues.get.mockImplementation(async ({ range }) => ({
    data: { values: range.includes('Trikot_Artikel') ? ARTIKEL : trikotRows },
  }));
  mockValues.append.mockReset();
  mockValues.append.mockResolvedValue({ data: {} });
  mockWcGet.mockReset();
  mockWcGet.mockResolvedValue({ data: ORDERS, headers: { 'x-wp-totalpages': '1' } });
});

describe('POST /api/trikot/sync', () => {
  test('Antwortform und Quellen, Dry Run schreibt nichts', async () => {
    const res = await request(app).post('/api/trikot/sync').send({ after: '2026-09-01', dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true, gelesen: 1, neu: 4, dubletten: 0,
      quellen: { addon: 2, variante: 1, notiz: 1 },
    });
    expect(mockValues.append).not.toHaveBeenCalled();
    expect(mockWcGet).toHaveBeenCalledWith('orders', expect.objectContaining({
      after: '2026-09-01T00:00:00', status: 'processing,on-hold,completed',
    }));
  });

  test('echter Lauf: append RAW + INSERT_ROWS, manuelle Spalten nicht im Payload', async () => {
    const res = await request(app).post('/api/trikot/sync').send({ after: '2026-09-01' });
    expect(res.status).toBe(200);
    expect(mockValues.append).toHaveBeenCalledTimes(1);
    const call = mockValues.append.mock.calls[0][0];
    expect(call.valueInputOption).toBe('RAW');
    expect(call.insertDataOption).toBe('INSERT_ROWS');
    expect(call.requestBody.values).toHaveLength(4);
    expect(call.requestBody.values.every(r => r.length === 15)).toBe(true);
  });

  test('ohne after: ab jüngstem Bestelldatum, vorhandene Zeilen sind Dubletten', async () => {
    trikotRows = [HEADER, ['100|1|1', '', '2026-09-09T10:00:00'], ['100|2|1', '', '2026-09-09T10:00:00']];
    const res = await request(app).post('/api/trikot/sync').send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ neu: 2, dubletten: 2 });
    expect(mockWcGet.mock.calls[0][1].after).toBe('2026-09-09T00:00:00');
  });

  test('ohne Body funktioniert wie {}', async () => {
    trikotRows = [HEADER, ['100|1|1', '', '2026-09-09T10:00:00']];
    const res = await request(app).post('/api/trikot/sync');
    expect(res.status).toBe(200);
  });

  test('leerer Reiter ohne after → 400', async () => {
    const res = await request(app).post('/api/trikot/sync').send({ dryRun: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/after/);
    expect(mockWcGet).not.toHaveBeenCalled();
  });

  test.each([
    [{ after: '01.09.2026' }],
    [{ after: '2026-02-30' }],
    [{ after: 20260901 }],
    [{ dryRun: 'true' }],
  ])('ungültige Optionen %j → 400', async (body) => {
    const res = await request(app).post('/api/trikot/sync').send(body);
    expect(res.status).toBe(400);
    expect(mockValues.get).not.toHaveBeenCalled();
  });
});
