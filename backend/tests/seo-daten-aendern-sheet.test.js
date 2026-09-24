// Nachtrag SE1b: der Sheet-Weg, den "SEO-Daten aendern" nutzt -
// POST /api/sheets/erfassung/patch-fields mit Fokus_Keyphrase und
// Fokus_Synonyme. Header-basiert; SEO_Status und alle anderen Spalten bleiben.

import { jest } from '@jest/globals';

const KOPF = ['ID', 'Status', 'Status Shop', 'Produkt-ID', 'SEO_Status', 'Produktname', 'Artikelnummer',
  'Fokus_Keyphrase', 'Fokus_Synonyme'];
let zeilen;
const update = jest.fn(async ({ range, requestBody }) => {
  const m = range.match(/Erfassungsmaske!A(\d+)/);
  if (m) zeilen[Number(m[1]) - 1] = requestBody.values[0];
  return {};
});
jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: () => ({ spreadsheets: { values: {
    get: async ({ range }) => {
      if (range === 'Erfassungsmaske!1:1') return { data: { values: [zeilen[0]] } };
      const m = range.match(/Erfassungsmaske!(\d+):\d+/);
      return { data: { values: [zeilen[Number(m[1]) - 1]] } };
    },
    update,
  } } }) },
}));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));

let request, app;
beforeAll(async () => {
  process.env.GOOGLE_SHEET_ID = 'test-sheet';
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  app = express();
  app.use(express.json());
  app.use('/api/sheets', (await import('../routes/sheets.js')).default);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});
beforeEach(() => {
  zeilen = [KOPF,
    ['JFN-2026-0040', 'Im Shop', 'Veröffentlicht', '21044', 'Erledigt', 'Oldschool T-Shirt Herren', 'E3000/CH-Oldschool',
     'Oldschool T-Shirt Herren', 'Oldschool Shirt']];
  update.mockClear();
});

test('mit SSOT-Zeile: beide Spalten aktualisiert, SEO_Status und alles andere unveraendert', async () => {
  const vorher = [...zeilen[1]];
  const res = await request(app).post('/api/sheets/erfassung/patch-fields').send({
    row: 2,
    fields: { Fokus_Keyphrase: 'Crocodiles Hamburg Oldschool T-Shirt Herren', Fokus_Synonyme: 'Oldschool Shirt, Retro T-Shirt' },
  });
  expect(res.status).toBe(200);
  const nachher = zeilen[1];
  const i = n => KOPF.indexOf(n);
  expect(nachher[i('Fokus_Keyphrase')]).toBe('Crocodiles Hamburg Oldschool T-Shirt Herren');
  expect(nachher[i('Fokus_Synonyme')]).toBe('Oldschool Shirt, Retro T-Shirt');
  expect(nachher[i('SEO_Status')]).toBe('Erledigt');
  for (const n of KOPF.filter(n => !n.startsWith('Fokus_'))) expect(nachher[i(n)]).toBe(vorher[i(n)]);
});

test('nur Keyphrase -> Synonyme bleiben stehen', async () => {
  await request(app).post('/api/sheets/erfassung/patch-fields')
    .send({ row: 2, fields: { Fokus_Keyphrase: 'Neu' } });
  expect(zeilen[1][KOPF.indexOf('Fokus_Synonyme')]).toBe('Oldschool Shirt');
  expect(zeilen[1][KOPF.indexOf('SEO_Status')]).toBe('Erledigt');
});

test('Sheet-Fehler kommt als Fehler zurueck (das Frontend meldet "Yoast geschrieben, Sheet nicht")', async () => {
  update.mockRejectedValueOnce(new Error('Sheets API down'));
  const res = await request(app).post('/api/sheets/erfassung/patch-fields')
    .send({ row: 2, fields: { Fokus_Keyphrase: 'Neu' } });
  expect(res.status).toBe(500);
  expect(res.body.error).toMatch(/Sheets API down/);
});
