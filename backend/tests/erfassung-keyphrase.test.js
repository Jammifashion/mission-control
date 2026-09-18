// Spalte "Fokus_Keyphrase" in der Erfassungsmaske (Reiter "SEO Daten").
//
// Geschrieben wird sie beim Speichern im SEO-Flow ueber
// POST /erfassung/patch-fields - nicht ueber /overwrite. Fehlt die Spalte,
// muss patch-fields sie anlegen, sonst laeuft headers.map() an ihr vorbei und
// der Wert verschwindet still. Gelesen wird sie optional ueber findHeader.
//
// Nach WooCommerce/Yoast wird die Keyphrase bewusst NICHT geschrieben.

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

const setzeTab = rows => { tab = rows.map(r => [...r]); };

beforeEach(() => {
  values.get.mockReset().mockImplementation(async ({ range }) => {
    const teil = range.slice(range.indexOf('!') + 1);
    const [von, bis] = teil.split(':').map(Number);
    return { data: { values: tab.slice(von - 1, bis).map(r => [...r]) } };
  });
  for (const f of ['update', 'append', 'batchUpdate']) values[f].mockReset().mockResolvedValue({ data: {} });
});

const KOPF    = ['ID', 'SEO_Status', 'Produkt-ID', 'Produktname', 'Artikelnummer'];
const BESTAND = ['JFN-2026-0001', 'Ausstehend', '100', 'Shirt', 'JF-1'];

const patch = fields => request(app).post('/api/sheets/erfassung/patch-fields')
  .send({ row: 2, fields });

const kopfUpdates  = () => values.update.mock.calls.filter(c => /!\D+1$/.test(c[0].range));
const zeilenUpdate = () => values.update.mock.calls.find(c => c[0].range === 'Erfassungsmaske!A2')?.[0];

describe('POST /erfassung/patch-fields – Spalte Fokus_Keyphrase', () => {
  test('Spalte fehlt → wird hinten angehaengt, Wert steht in der Zeile', async () => {
    setzeTab([KOPF, BESTAND]);
    const res = await patch({ SEO_Status: 'Erledigt', Fokus_Keyphrase: 'weihnachtspullover herren' });
    expect(res.status).toBe(200);

    expect(kopfUpdates()).toHaveLength(1);
    expect(kopfUpdates()[0][0]).toMatchObject({
      range: 'Erfassungsmaske!F1',
      valueInputOption: 'RAW',
      requestBody: { values: [['Fokus_Keyphrase']] },
    });
    expect(zeilenUpdate().requestBody.values[0]).toEqual(
      ['JFN-2026-0001', 'Erledigt', '100', 'Shirt', 'JF-1', 'weihnachtspullover herren'],
    );
  });

  test('Bestandszeilen bleiben leer: nur Kopf und die eigene Zeile werden geschrieben', async () => {
    setzeTab([KOPF, BESTAND, BESTAND, BESTAND]);
    await patch({ Fokus_Keyphrase: 'ugly sweater' });
    const ranges = values.update.mock.calls.map(c => c[0].range);
    expect(ranges.sort()).toEqual(['Erfassungsmaske!A2', 'Erfassungsmaske!F1']);
    expect(values.batchUpdate).not.toHaveBeenCalled();
  });

  test('Spalte vorhanden → kein Anlegen, Wert an ihrer Position', async () => {
    setzeTab([['ID', 'Fokus_Keyphrase', ...KOPF.slice(1)], ['JFN-2026-0001', '', ...BESTAND.slice(1)]]);
    await patch({ Fokus_Keyphrase: 'ugly sweater' });
    expect(kopfUpdates()).toHaveLength(0);
    expect(zeilenUpdate().requestBody.values[0][1]).toBe('ugly sweater');
  });

  test('leere Keyphrase legt die Spalte ebenfalls an, Wert bleibt leer', async () => {
    setzeTab([KOPF, BESTAND]);
    await patch({ SEO_Status: 'Erledigt', Fokus_Keyphrase: '' });
    expect(kopfUpdates()).toHaveLength(1);
    expect(zeilenUpdate().requestBody.values[0][5]).toBe('');
  });

  test('fields ohne Keyphrase → keine Spalte angelegt', async () => {
    setzeTab([KOPF, BESTAND]);
    await patch({ SEO_Status: 'Erledigt' });
    expect(kopfUpdates()).toHaveLength(0);
  });
});

describe('GET /erfassung/seo-pending – Keyphrase ist optional', () => {
  test('ohne Spalte: 200, keyphrase leer', async () => {
    setzeTab([KOPF, BESTAND]);
    const res = await request(app).get('/api/sheets/erfassung/seo-pending');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].keyphrase).toBe('');
  });

  test('mit Spalte: Wert wird durchgereicht', async () => {
    setzeTab([[...KOPF, 'Fokus_Keyphrase'], [...BESTAND, 'weihnachtspullover herren']]);
    const res = await request(app).get('/api/sheets/erfassung/seo-pending');
    expect(res.body[0].keyphrase).toBe('weihnachtspullover herren');
  });
});

describe('Frontend: SEO-Flow reicht Keyphrase, Farben und Größen durch', () => {
  const html = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8',
  );
  const genStart = html.indexOf("getElementById('btn-seo-generate').addEventListener");
  const genBlock = html.slice(genStart, html.indexOf("getElementById('btn-seo-save')", genStart));
  const saveBlock = html.slice(html.indexOf("getElementById('btn-seo-save').addEventListener"));

  test('Eingabefeld existiert im Reiter SEO Daten', () => {
    expect(html).toMatch(/id="seo-keyphrase"/);
  });

  test('generate schickt keyphrase, farben und groessen', () => {
    expect(genStart).toBeGreaterThan(0);
    expect(genBlock).toMatch(/keyphrase:\s*document\.getElementById\('seo-keyphrase'\)\.value\.trim\(\)/);
    expect(genBlock).toMatch(/farben:\s*seoFarben\(\)/);
    expect(genBlock).toMatch(/groessen:\s*gr\.groessen/);
  });

  test('Größen kommen aus dem Varianten-Reiter, nicht aus den Eigenschaften', () => {
    // Die Quellenwahl selbst liegt in seo-groessen.test.js.
    expect(html).toMatch(/seoVarianten\s*=\s*v\.varianten/);
    expect(html).toMatch(/seoGroessenQuelle\(seoVarianten, seoWcProdukt, seoQuellenOk\)/);
  });

  test('Speichern schreibt Fokus_Keyphrase ins Sheet', () => {
    expect(saveBlock).toMatch(/'Fokus_Keyphrase':\s*document\.getElementById\('seo-keyphrase'\)\.value\.trim\(\)/);
  });

  test('die Keyphrase geht NICHT an WooCommerce', () => {
    const wcPut = saveBlock.slice(0, saveBlock.indexOf('erfassung/patch-fields'));
    expect(wcPut).not.toMatch(/keyphrase|yoast/i);
  });
});
