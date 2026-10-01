// Zwischenspeicher und Hoster-Pruefseite: HTML wird nie gespeichert. Erster
// Abruf liefert die Pruefseite -> HosterPruefseiteError; der zweite liefert
// gueltige Daten und muss wieder beim Shop fragen (Speicher war leer).

import { jest } from '@jest/globals';

const wc = { get: jest.fn(), post: jest.fn(), put: jest.fn(), shopLabel: 'JammiFashion' };

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient: jest.fn(() => wc),
}));

const PRUEFSEITE = '<!DOCTYPE html><html><title>One moment, please...</title></html>';
let hp;

beforeAll(async () => { hp = await import('../lib/hosterPruefseite.js'); });
beforeEach(() => wc.get.mockReset());

test('Schlagwoerter: HTML -> Fehler, nichts gespeichert; danach neu geladen', async () => {
  const { ladeSchlagwoerter } = await import('../lib/schlagwoerter.js');
  wc.get.mockResolvedValueOnce({ data: PRUEFSEITE });
  await expect(ladeSchlagwoerter('jfn')).rejects.toBeInstanceOf(hp.HosterPruefseiteError);
  wc.get.mockResolvedValueOnce({ data: [{ id: 1, name: 'Malle', slug: 'malle', count: 3 }] });
  expect(await ladeSchlagwoerter('jfn')).toEqual([{ id: 1, name: 'Malle', slug: 'malle', count: 3 }]);
  expect(wc.get).toHaveBeenCalledTimes(2);
});

test('Keyphrasen (SE1): HTML -> Fehler, nichts gespeichert; danach neu geladen', async () => {
  const { keyphraseDubletten, _resetKeyphraseCache } = await import('../lib/seo-artikel.js');
  _resetKeyphraseCache();
  wc.get.mockResolvedValueOnce({ data: PRUEFSEITE, headers: {} });
  await expect(keyphraseDubletten(wc, 'malle shirt', 1)).rejects.toBeInstanceOf(hp.HosterPruefseiteError);
  wc.get.mockResolvedValueOnce({
    data: [{ id: 7, name: 'Shirt', meta_data: [{ key: '_yoast_wpseo_focuskw', value: 'Malle Shirt' }] }],
    headers: { 'x-wp-totalpages': '1' },
  });
  expect(await keyphraseDubletten(wc, 'malle shirt', 1)).toEqual([{ id: 7, name: 'Shirt', keyphrase: 'Malle Shirt' }]);
  expect(wc.get).toHaveBeenCalledTimes(2);
});

describe('wcCached (/api/woocommerce/categories)', () => {
  let request, app;
  beforeAll(async () => {
    ({ default: request } = await import('supertest'));
    const { default: express } = await import('express');
    const { default: router } = await import('../routes/woocommerce.js');
    app = express();
    app.use('/api/woocommerce', router);
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message, code: err.code }));
  });

  test('HTML -> 503, nichts gespeichert; danach neu geladen und gespeichert', async () => {
    wc.get.mockResolvedValueOnce({ data: PRUEFSEITE });
    const r1 = await request(app).get('/api/woocommerce/categories?shop=hosterTest');
    expect(r1.status).toBe(503);
    expect(r1.body.code).toBe('hoster_pruefseite');

    wc.get.mockResolvedValueOnce({ data: [{ id: 5, name: 'Shirts', parent: 0 }] });
    const r2 = await request(app).get('/api/woocommerce/categories?shop=hosterTest');
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual([{ Kategorienummer: '5', Kategoriename: 'Shirts', Kategorien: 'Shirts' }]);

    const r3 = await request(app).get('/api/woocommerce/categories?shop=hosterTest');   // jetzt aus dem Speicher
    expect(r3.body).toEqual(r2.body);
    expect(wc.get).toHaveBeenCalledTimes(2);
  });

  test('Attribute: HTML bei den Begriffen -> 503, kein weiterer Begriffe-Abruf', async () => {
    wc.get.mockImplementation(async pfad => (pfad === 'products/attributes'
      ? { data: [{ id: 1, name: 'Farbe' }, { id: 2, name: 'Größe' }] }
      : { data: PRUEFSEITE }));
    const r = await request(app).get('/api/woocommerce/attributes?shop=hosterAttr');
    expect(r.status).toBe(503);
    expect(wc.get).toHaveBeenCalledTimes(2);
  });
});
