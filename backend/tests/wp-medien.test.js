// HW3: lib/wpMedien.js - Upload in die WordPress-Mediathek (eine Stelle fuer
// Route /api/artikel/media-upload und das Halloween-Skript).

import { jest } from '@jest/globals';
import { ladeMedienHoch, setzeMedienText, medienTitel } from '../lib/wpMedien.js';
import { HosterPruefseiteError } from '../lib/hosterPruefseite.js';

const fetchOrig = global.fetch;
beforeEach(() => {
  process.env.WC_URL = 'https://shop.test/';
  process.env.WC_KEY = 'k'; process.env.WC_SECRET = 's';
  process.env.WP_APP_PASSWORD = 'wp_geheim';
});
afterEach(() => { global.fetch = fetchOrig; });

const json = (body, status = 201) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('Upload mit Dateiname, Titel und ALT als Abfrageparameter', async () => {
  global.fetch = jest.fn(async () => json({ id: 77, source_url: 'https://shop.test/x.jpg', title: { raw: 'T' }, alt_text: 'T' }));
  const r = await ladeMedienHoch({ buffer: Buffer.from('x'), dateiname: 'a"b.jpg', mimetype: 'image/jpeg', titel: 'Halloween Shirt Herren Free Hugs', alt: 'Halloween Shirt Herren Free Hugs' });
  expect(r).toMatchObject({ ok: true, status: 201, data: { id: 77 } });
  const [url, opt] = global.fetch.mock.calls[0];
  expect(url).toBe('https://shop.test/wp-json/wp/v2/media?title=Halloween+Shirt+Herren+Free+Hugs&alt_text=Halloween+Shirt+Herren+Free+Hugs');
  expect(opt.headers['Content-Disposition']).toBe('attachment; filename="ab.jpg"');
  expect(opt.headers['Content-Type']).toBe('image/jpeg');
  expect(JSON.stringify(opt.headers)).not.toContain('wp_geheim');   // nur Base64 im Authorization-Header
});

test('ohne Titel kein Abfrageteil (Route media-upload unveraendert)', async () => {
  global.fetch = jest.fn(async () => json({ id: 1 }));
  await ladeMedienHoch({ buffer: Buffer.from('x'), dateiname: 'b.jpg' });
  expect(global.fetch.mock.calls[0][0]).toBe('https://shop.test/wp-json/wp/v2/media');
});

test('Pruefseite (HTML, 200) wirft, ein Abruf', async () => {
  global.fetch = jest.fn(async () => new Response('<html><title>One moment, please...</title></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  await expect(ladeMedienHoch({ buffer: Buffer.from('x'), dateiname: 'b.jpg' })).rejects.toBeInstanceOf(HosterPruefseiteError);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('fehlende Zugangsdaten -> fehlt, kein Abruf', async () => {
  delete process.env.WP_APP_PASSWORD;
  global.fetch = jest.fn();
  expect(await ladeMedienHoch({ buffer: Buffer.from('x'), dateiname: 'b.jpg' })).toMatchObject({ ok: false, status: 503, fehlt: true });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('Titel/ALT nachtraeglich setzen', async () => {
  global.fetch = jest.fn(async () => json({ id: 5, title: { raw: 'Neu' }, alt_text: 'Neu' }, 200));
  const r = await setzeMedienText({ id: 5, titel: 'Neu', alt: 'Neu' });
  const [url, opt] = global.fetch.mock.calls[0];
  expect(url).toBe('https://shop.test/wp-json/wp/v2/media/5');
  expect(JSON.parse(opt.body)).toEqual({ title: 'Neu', alt_text: 'Neu' });
  expect(medienTitel(r.data)).toBe('Neu');
});
