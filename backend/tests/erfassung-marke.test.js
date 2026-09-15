// Spalte "Marke" in der Erfassungsmaske.
//
// Ablauf im Frontend (index.html, btn-create-wc): die Zeile entsteht VOR dem
// WooCommerce-Push (saveDraft → POST /erfassung) und wird NACH der Antwort
// ueber POST /erfassung/overwrite nachgetragen. Dort kommt die Marke aus der
// WooCommerce-Antwort (data1.marke). Fehlt die Spalte, legt overwrite sie an.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn() },
}));

jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

let request, app, values, tab;

beforeAll(async () => {
  process.env.GOOGLE_SHEET_ID = 'ssot-test';
  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');

  values = { get: jest.fn(), update: jest.fn(), append: jest.fn(), batchUpdate: jest.fn() };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values } });

  const { default: router } = await import('../routes/sheets.js');
  app = express();
  app.use(express.json());
  app.use('/api/sheets', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

// Zeile 1 = Kopf, danach Bestand. Das Mock bedient '1:1', 'N:N' und '1:2000'.
const setzeTab = rows => { tab = rows.map(r => [...r]); };

beforeEach(() => {
  values.get.mockReset().mockImplementation(async ({ range }) => {
    const teil = range.slice(range.indexOf('!') + 1);
    const [von, bis] = teil.split(':').map(Number);
    return { data: { values: tab.slice(von - 1, bis).map(r => [...r]) } };
  });
  for (const f of ['update', 'append', 'batchUpdate']) values[f].mockReset().mockResolvedValue({ data: {} });
});

const KOPF    = ['ID', 'Status', 'Produkt-ID', 'Produktname', 'Artikelnummer'];
const BESTAND = ['JFN-2026-0001', 'Entwurf', '', 'Shirt', 'JF-1'];
const ALT     = ['JFN-2025-0099', 'Im Shop', '6807', 'Alt', 'JF-0'];

const overwrite = body => request(app).post('/api/sheets/erfassung/overwrite')
  .send({ row: 2, ssotId: 'JFN-2026-0001', ...body });

const kopfUpdates  = () => values.update.mock.calls.filter(c => /!\D+1$/.test(c[0].range));
const zeilenUpdate = () => values.update.mock.calls.find(c => c[0].range === 'Erfassungsmaske!A2')?.[0];

describe('POST /erfassung/overwrite – Spalte Marke', () => {
  test('Spalte fehlt → wird hinten angehaengt, Wert steht in der Zeile', async () => {
    setzeTab([KOPF, BESTAND, ALT]);
    const res = await overwrite({ 'Produkt-ID': '100', Marke: 'JammiFashion' });
    expect(res.status).toBe(200);

    expect(kopfUpdates()).toHaveLength(1);
    expect(kopfUpdates()[0][0]).toMatchObject({
      range: 'Erfassungsmaske!F1', valueInputOption: 'RAW', requestBody: { values: [['Marke']] },
    });
    expect(zeilenUpdate().requestBody.values[0]).toEqual(
      ['JFN-2026-0001', 'Entwurf', '100', 'Shirt', 'JF-1', 'JammiFashion'],
    );
  });

  test('Bestandszeilen bleiben leer: nur Kopf und die eigene Zeile werden geschrieben', async () => {
    setzeTab([KOPF, BESTAND, ALT, ALT]);
    await overwrite({ Marke: 'JammiFashion' });
    const ranges = values.update.mock.calls.map(c => c[0].range);
    expect(ranges.sort()).toEqual(['Erfassungsmaske!A2', 'Erfassungsmaske!F1']);
    expect(values.batchUpdate).not.toHaveBeenCalled();
    expect(values.append).not.toHaveBeenCalled();
  });

  test('honk: leere Marke legt die Spalte ebenfalls an, Wert bleibt leer', async () => {
    setzeTab([KOPF, BESTAND]);
    await overwrite({ Marke: '' });
    expect(kopfUpdates()).toHaveLength(1);
    expect(zeilenUpdate().requestBody.values[0][5]).toBe('');
  });

  test.each([
    [['Marke', ...KOPF], 0],
    [['ID', 'Status', 'Marke', 'Produkt-ID', 'Produktname', 'Artikelnummer'], 2],
    [[...KOPF, 'Notiz', 'Marke'], 6],
  ])('Marke-Spalte an beliebiger Position → kein Anlegen, Wert an Index %#', async (kopf, idx) => {
    const zeile = kopf.map(h => BESTAND[KOPF.indexOf(h)] ?? '');
    setzeTab([kopf, zeile]);
    await overwrite({ Marke: 'JammiFashion' });
    expect(kopfUpdates()).toHaveLength(0);
    const neu = zeilenUpdate().requestBody.values[0];
    expect(neu[idx]).toBe('JammiFashion');
    expect(neu.filter(v => v === 'JammiFashion')).toHaveLength(1);
  });

  test('Body ohne Marke → keine Spalte angelegt, Zeile wie bisher', async () => {
    setzeTab([KOPF, BESTAND]);
    await overwrite({ Status: 'Im Shop' });
    expect(kopfUpdates()).toHaveLength(0);
    expect(zeilenUpdate().requestBody.values[0]).toEqual(['JFN-2026-0001', 'Im Shop', '', 'Shirt', 'JF-1']);
  });

  test('Body ohne Marke behaelt einen vorhandenen Markenwert', async () => {
    setzeTab([[...KOPF, 'Marke'], [...BESTAND, 'JammiFashion']]);
    await overwrite({ Status: 'Im Shop' });
    expect(zeilenUpdate().requestBody.values[0][5]).toBe('JammiFashion');
  });
});

describe('Lesen: Marke ist optional', () => {
  test('GET /erfassung/list ohne Marke-Spalte wirft nicht', async () => {
    setzeTab([KOPF, BESTAND]);
    const res = await request(app).get('/api/sheets/erfassung/list');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('POST /erfassung (neue Zeile vor dem Push) ohne Marke-Spalte wirft nicht und legt keine an', async () => {
    setzeTab([KOPF, ALT]);
    const res = await request(app).post('/api/sheets/erfassung').send({ Artikelnummer: 'JF-NEU', Produktname: 'Neu' });
    expect(res.status).toBe(200);
    expect(kopfUpdates()).toHaveLength(0);
  });
});

describe('Frontend: Marke kommt aus der WooCommerce-Antwort', () => {
  const html = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8',
  );
  const start = html.indexOf("getElementById('btn-create-wc').addEventListener");
  const block = html.slice(start, html.indexOf('resetForm();', start));

  test('Anlage-Block gefunden, POST products vor overwrite', () => {
    expect(start).toBeGreaterThan(0);
    expect(block.indexOf('/api/woocommerce/products`')).toBeGreaterThan(-1);
    expect(block.indexOf('/api/woocommerce/products`')).toBeLessThan(block.indexOf('/api/sheets/erfassung/overwrite'));
  });

  test("overwrite nach dem Push schickt 'Marke': data1.marke", () => {
    expect(block).toMatch(/'Marke':\s*data1\.marke \?\? ''/);
  });

  test('POST products schickt selbst keine Marke', () => {
    const post = block.slice(block.indexOf('/api/woocommerce/products`'), block.indexOf('const data1'));
    expect(post).not.toMatch(/brands/);
  });
});
