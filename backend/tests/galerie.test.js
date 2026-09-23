// Befehl GAL: Produktgalerie beim Anlegen fuellen, beim Aendern nur ergaenzen.
//
// GEMESSEN 23.09. an einem Entwurf (WC 21103, danach force-geloescht; die
// geliehenen Medien 21086/21087/21042 blieben an ihren Produkten):
//   POST products {"images":[{"id":21086}]}, Variationen mit image 21087/21042
//   -> images des Elternprodukts danach [21086] - Galerie leer.
//   PUT images [A,B,C] -> [A,B,C]; danach PUT images [A] -> [A]  (ERSETZT!)
//   PUT ohne images -> Bildliste bleibt.
// Der alte Aenderungspfad schickte bei jedem Speichern images [Hauptbild] und
// kuerzte damit jede im WP-Admin gepflegte Galerie.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const wc = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient:   jest.fn(() => wc),
}));

let request, app;
beforeAll(async () => {
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  app = express();
  app.use(express.json());
  app.use('/api/woocommerce', (await import('../routes/woocommerce.js')).default);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  wc.get.mockReset(); wc.post.mockReset(); wc.put.mockReset();
  wc.post.mockImplementation(async (pfad, body) => pfad === 'products'
    ? { data: { id: 100, status: 'draft', sku: body.sku, images: (body.images ?? []).map(i => ({ id: i.id })) } }
    : { data: { id: 555, meta_data: body.meta_data ?? [] } });
  wc.put.mockImplementation(async (_p, body) => ({ data: { id: 100, images: (body.images ?? [{ id: 1 }, { id: 2 }]).map(i => ({ id: i.id })) } }));
});
afterEach(() => jest.restoreAllMocks());

// ── Frontend-Block "Galerie" ausfuehren ─────────────────────────────────────
const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von  = html.indexOf('// ── Galerie: Anfang');
const bis  = html.indexOf('// ── Galerie: Ende ──');
const fe   = new Function(`${html.slice(von, bis)}
  return { galerieIds, galerieAnlage, galerieAenderung };`)();

// ════════════════════════════════════════════════════════════════════════════
describe('Anlage', () => {
  test('3 Farben mit je 1 Bild -> Hauptbild (erstes Variantenbild) + 2 Galeriebilder', () => {
    // Hauptbild-Regel 374097c: ohne ausdrueckliches Feld = erstes Variantenbild.
    const variantenBilder = [11, 11, 22, 22, 33, 33];            // Farbe x Groesse
    const hauptbild = variantenBilder.find(Boolean);
    expect(fe.galerieAnlage({ hauptbild, variantenBilder, hochgeladen: [11, 22, 33] })).toEqual([11, 22, 33]);
  });

  test('Hauptbild separat gewaehlt -> zuerst, nicht doppelt', () => {
    expect(fe.galerieAnlage({ hauptbild: 90, variantenBilder: [11, 22, 33], hochgeladen: [11, 90, 22, 33] }))
      .toEqual([90, 11, 22, 33]);
    // Hauptbild ist zugleich ein Variantenbild -> nur einmal
    expect(fe.galerieAnlage({ hauptbild: 22, variantenBilder: [11, 22, 33], hochgeladen: [11, 22, 33] }))
      .toEqual([22, 11, 33]);
  });

  test('Upload-Reihenfolge, nicht Variantenreihenfolge', () => {
    expect(fe.galerieAnlage({ hauptbild: 33, variantenBilder: [33, 11, 22], hochgeladen: [22, 33, 11] }))
      .toEqual([33, 22, 11]);
  });

  test('verworfene Uploads fallen weg, ohne Bilder leer', () => {
    expect(fe.galerieAnlage({ hauptbild: 11, variantenBilder: [11], hochgeladen: [99, 11] })).toEqual([11]);
    expect(fe.galerieAnlage({ hauptbild: undefined, variantenBilder: [null, null], hochgeladen: [] })).toEqual([]);
  });

  test('Route: images geht so an WooCommerce, Variationen behalten ihr image, Antwort nennt die Anzahl', async () => {
    const res = await request(app).post('/api/woocommerce/products').send({
      name: 'Shirt', sku: 'E3000/CH-Oldschool', type: 'variable', lieferzeit: '21',
      attributes: [{ name: 'Farbe', options: ['Rot', 'Schwarz'], variation: true }],
      images: [{ id: 11 }, { id: 22 }],
      variations: [
        { attributes: [{ name: 'Farbe', option: 'Rot' }],     regular_price: '20', image: { id: 11 } },
        { attributes: [{ name: 'Farbe', option: 'Schwarz' }], regular_price: '20', image: { id: 22 } },
      ],
    });
    expect(res.status).toBe(201);
    expect(wc.post.mock.calls.find(c => c[0] === 'products')[1].images).toEqual([{ id: 11 }, { id: 22 }]);
    expect(wc.post.mock.calls.filter(c => /\/variations$/.test(c[0])).map(c => c[1].image))
      .toEqual([{ id: 11 }, { id: 22 }]);
    expect(res.body.galerie).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Aenderung: nur ergaenzen', () => {
  test('neues Bild -> vorhandene Galerie bleibt, neues hinten', () => {
    expect(fe.galerieAenderung({ vorhanden: [1, 2, 3], hauptbild: 1, variantenBilder: [2, 44], hochgeladen: [44] }))
      .toEqual([1, 2, 3, 44]);
  });

  test('ohne neue Bilder -> null (images wird gar nicht mitgeschickt)', () => {
    expect(fe.galerieAenderung({ vorhanden: [1, 2, 3], hauptbild: 1, variantenBilder: [2, 3], hochgeladen: [] })).toBeNull();
  });

  test('alte Variantenbilder ausserhalb der Galerie wandern nicht ungefragt hinein', () => {
    expect(fe.galerieAenderung({ vorhanden: [1], hauptbild: 1, variantenBilder: [7, 8], hochgeladen: [] })).toBeNull();
  });

  test('neues Hauptbild rueckt nach vorn, nichts faellt weg', () => {
    expect(fe.galerieAenderung({ vorhanden: [1, 2, 3], hauptbild: 90, variantenBilder: [], hochgeladen: [90] }))
      .toEqual([90, 1, 2, 3]);
  });

  test('nie kleiner als vorher', () => {
    const faelle = [
      { vorhanden: [1, 2, 3], hauptbild: 2, variantenBilder: [], hochgeladen: [] },
      { vorhanden: [5, 6], hauptbild: 7, variantenBilder: [8], hochgeladen: [8, 7] },
      { vorhanden: [], hauptbild: 7, variantenBilder: [7], hochgeladen: [7] },
    ];
    for (const f of faelle) {
      const r = fe.galerieAenderung(f);
      if (r) for (const id of f.vorhanden) expect(r).toContain(id);
    }
  });

  test('Route PUT ohne images: kein images-Feld an WooCommerce', async () => {
    await request(app).put('/api/woocommerce/products/100').send({ name: 'Shirt', status: 'draft' });
    expect(wc.put.mock.calls[0][1]).not.toHaveProperty('images');
  });

  test('Route PUT mit images: Anzahl aus der WooCommerce-Antwort', async () => {
    const res = await request(app).put('/api/woocommerce/products/100')
      .send({ images: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 44 }] });
    expect(res.body.galerie).toBe(4);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Anbindung in index.html', () => {
  test('beide Pfade: kein images [Hauptbild] mehr, sondern die Galerie-Listen', () => {
    expect(html).not.toContain('images: [{ id: mainImageId }]');
    expect(html).toContain('...(galerieNeu.length ? { images: galerieNeu.map(id => ({ id })) } : {}),');
    expect(html).toContain('...(galerieUpd ? { images: galerieUpd.map(id => ({ id })) } : {}),');
  });

  test('Hauptbild-Regel aus 374097c unveraendert (beide Pfade)', () => {
    expect([...html.matchAll(/const mainImageId = hauptbildId \?\? activeVariants\.find\(v => v\.imageId\)\?\.imageId;/g)])
      .toHaveLength(2);
  });

  test('jeder Upload wird in Reihenfolge gemerkt, beim Laden die Shop-Galerie', () => {
    expect([...html.matchAll(/hochgeladeneBilder\.push\(data\.attachmentId\)/g)]).toHaveLength(4);
    expect(html).toContain('wcGalerieGeladen = galerieIds(p.images || []);');
  });

  test('Toast "Galerie: n Bilder" in beiden Pfaden', () => {
    expect([...html.matchAll(/showToast\(`Galerie: \$\{/g)]).toHaveLength(2);
  });
});
