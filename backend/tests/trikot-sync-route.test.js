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
  'Zahlart',
];

const ORDERS = [
  {
    id: 100, date_created: '2026-09-09T10:00:00', customer_note: '',
    status: 'processing', payment_method_title: 'PayPal',
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

// Nur Order-ID, Status, Zahlart und eine Trikot-Position – für die Status-Tests.
const einfach = (id, status, zahlart) => ({
  id, date_created: '2026-09-10T09:00:00', customer_note: '', status,
  payment_method_title: zahlart, billing: {},
  line_items: [{ id: 1, product_id: 19365, sku: 'T-1', quantity: 1, name: 'Trikot', meta_data: [] }],
});

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
      zahlarten: { PayPal: 4 },
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
    expect(call.range).toBe("'Trikots'!A1");
    // A–O Skript, P–T null (= Zelle übersprungen), U Zahlart
    for (const r of call.requestBody.values) {
      expect(r).toHaveLength(21);
      expect(r.slice(15, 20)).toEqual([null, null, null, null, null]);
      expect(r[20]).toBe('PayPal');
    }
  });

  test('on-hold wird erfasst, pending und cancelled nicht', async () => {
    mockWcGet.mockResolvedValue({
      data: [einfach(201, 'on-hold', 'Vorkasse'), einfach(202, 'pending', 'PayPal'), einfach(203, 'cancelled', 'PayPal')],
      headers: { 'x-wp-totalpages': '1' },
    });
    const res = await request(app).post('/api/trikot/sync').send({ after: '2026-09-01' });
    expect(res.body).toMatchObject({ gelesen: 1, neu: 1, zahlarten: { Vorkasse: 1 } });
    const status = mockWcGet.mock.calls[0][1].status.split(',');
    expect(status).toContain('on-hold');
    expect(status).not.toContain('pending');
    expect(status).not.toContain('cancelled');
    const [zeile] = mockValues.append.mock.calls[0][0].requestBody.values;
    expect(zeile[0]).toBe('201|1|1');
    expect(zeile[20]).toBe('Vorkasse');
  });

  test('Zahlart Vorkasse und PayPal je Bestellung korrekt', async () => {
    mockWcGet.mockResolvedValue({
      data: [einfach(301, 'on-hold', 'Vorkasse'), einfach(302, 'processing', 'PayPal')],
      headers: { 'x-wp-totalpages': '1' },
    });
    const res = await request(app).post('/api/trikot/sync').send({ after: '2026-09-01' });
    expect(res.body.zahlarten).toEqual({ Vorkasse: 1, PayPal: 1 });
    const zeilen = mockValues.append.mock.calls[0][0].requestBody.values;
    expect(zeilen.map(r => [r[0], r[20]])).toEqual([['301|1|1', 'Vorkasse'], ['302|1|1', 'PayPal']]);
  });

  test('ohne after: 3 Tage vor jüngstem Bestelldatum, vorhandene Zeilen sind Dubletten', async () => {
    trikotRows = [HEADER, ['100|1|1', '', '2026-09-09T10:00:00'], ['100|2|1', '', '2026-09-09T10:00:00']];
    const res = await request(app).post('/api/trikot/sync').send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ neu: 2, dubletten: 2 });
    expect(mockWcGet.mock.calls[0][1].after).toBe('2026-09-06T00:00:00');
  });

  test('explizites after hat Vorrang vor der Überlappung', async () => {
    trikotRows = [HEADER, ['100|1|1', '', '2026-09-09T10:00:00']];
    await request(app).post('/api/trikot/sync').send({ after: '2026-09-08', dryRun: true });
    expect(mockWcGet.mock.calls[0][1].after).toBe('2026-09-08T00:00:00');
  });

  test('3 Tage Überlappung: alles schon im Reiter → 0 neue Zeilen, kein Append', async () => {
    // Bestand: alle Zeilen der Bestellung 100 plus eine jüngere Bestellung; WC liefert 100 erneut.
    trikotRows = [
      HEADER,
      ['100|1|1', '', '2026-09-09T10:00:00'], ['100|1|2', '', '2026-09-09T10:00:00'],
      ['100|2|1', '', '2026-09-09T10:00:00'], ['100|3|1', '', '2026-09-09T10:00:00'],
      ['105|1|1', '', '2026-09-11T08:00:00'],
    ];
    const res = await request(app).post('/api/trikot/sync').send({});
    expect(mockWcGet.mock.calls[0][1].after).toBe('2026-09-08T00:00:00');
    expect(res.body).toMatchObject({ gelesen: 1, neu: 0, dubletten: 4 });
    expect(mockValues.append).not.toHaveBeenCalled();
  });

  test('Bestandszeilen bleiben unverändert: nur Append, nie update/batchUpdate', async () => {
    const update = jest.fn(), batchUpdate = jest.fn();
    Object.assign(mockValues, { update, batchUpdate });
    trikotRows = [HEADER, ['100|1|1', '', '2026-09-09T10:00:00', 100, 1, 'A B', '', '', '', '', '', '', 1, 'addon', '', 'C1', '', '', 'offen', '', '']];
    const vorher = JSON.stringify(trikotRows);
    await request(app).post('/api/trikot/sync').send({});
    expect(update).not.toHaveBeenCalled();
    expect(batchUpdate).not.toHaveBeenCalled();
    expect(JSON.stringify(trikotRows)).toBe(vorher);
    const neu = mockValues.append.mock.calls[0][0].requestBody.values.map(r => r[0]);
    expect(neu).not.toContain('100|1|1');
    delete mockValues.update; delete mockValues.batchUpdate;
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
