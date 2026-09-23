// Befehl L: German-Market-Lieferzeit (_lieferzeit) bei der Artikelanlage.
//
// Drei Ebenen:
//  1. backend/lib/lieferzeiten.js - Reiter lesen, Wert pruefen
//  2. der Block "Lieferzeit" in index.html - Auswahl, Vorbelegung, Aenderung
//  3. POST/PUT /api/woocommerce/products - was wirklich an WooCommerce geht
//
// Kopfzeile des Reiters Struktur_Lieferzeiten WOERTLICH (gelesen 23.09.,
// UNFORMATTED_VALUE - Term_ID kommt als Zahl):

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const REITER = [
  ['Term_ID', 'Name', 'Slug'],
  [21,  'ca. 5-6 Werktage', 'ca-5-6-werktage'],
  [22,  'ca. 14 Werktage', 'ca-14-werktage'],
  [20,  'ca. 3-4 Werktage', 'ca-3-4-werktage'],
  [666, 'ca. 5-6 Wochen (externe Dienstleistung)', 'ca-5-6-wochen-externe-dienstleistung'],
];

// ── Mocks: Sheets-API und WooCommerce ───────────────────────────────────────
let sheetAntwort;
jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: () => ({ spreadsheets: { values: { get: async () => sheetAntwort() } } }) },
}));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));

const wc = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient:   jest.fn(() => wc),
}));

let lib, request, app;

beforeAll(async () => {
  lib = await import('../lib/lieferzeiten.js');
  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');
  const { default: wcRouter }    = await import('../routes/woocommerce.js');
  const { default: sheetRouter } = await import('../routes/sheets.js');
  app = express();
  app.use(express.json());
  app.use('/api/woocommerce', wcRouter);
  app.use('/api/sheets', sheetRouter);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

// WooCommerce-Mock gibt meta_data so zurueck, wie es gesendet wurde - wie echt.
let varId;
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  varId = 900;
  wc.get.mockReset(); wc.post.mockReset(); wc.put.mockReset();
  wc.post.mockImplementation(async (pfad, body) => pfad === 'products'
    ? { data: { id: 100, status: 'draft', sku: body.sku, meta_data: body.meta_data ?? [] } }
    : pfad.endsWith('/variations/batch')
      ? { data: {} }
      : { data: { id: ++varId, meta_data: body.meta_data ?? [] } });
  wc.put.mockImplementation(async (_pfad, body) => ({ data: { id: 100, meta_data: body.meta_data ?? [{ key: '_lieferzeit', value: '92' }] } }));
  sheetAntwort = async () => ({ data: { values: REITER } });
});
afterEach(() => jest.restoreAllMocks());

// ── Frontend-Block herausschneiden und AUSFUEHREN ───────────────────────────
const html  = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von   = html.indexOf('// ── Lieferzeit: Anfang');
const bis   = html.indexOf('// ── Lieferzeit: Ende ──');
const fe    = new Function(`${html.slice(von, bis)}
  return { LZ_UNBEKANNT, lzWertAusMeta, lzOptionen, lzZuSenden, lzMeldung };`)();

const BASIS = {
  name: 'Shirt', sku: 'JF/Shirt-01', type: 'variable',
  attributes: [{ name: 'Farbe', options: ['Rot', 'Blau'], variation: true }],
  variations: [
    { attributes: [{ name: 'Farbe', option: 'Rot'  }], regular_price: '20' },
    { attributes: [{ name: 'Farbe', option: 'Blau' }], regular_price: '20' },
  ],
};
const produktBody = () => wc.post.mock.calls.find(c => c[0] === 'products')[1];
const varBodies   = () => wc.post.mock.calls.filter(c => /\/variations$/.test(c[0])).map(c => c[1]);
const lzVon       = body => (body.meta_data ?? []).filter(m => m.key === '_lieferzeit');

// ════════════════════════════════════════════════════════════════════════════
describe('Reiter Struktur_Lieferzeiten lesen', () => {
  test('echte Kopfzeile -> Term-IDs als String, Reihenfolge wie im Reiter', () => {
    expect(lib.parseLieferzeiten(REITER)).toEqual([
      { id: '21',  name: 'ca. 5-6 Werktage', slug: 'ca-5-6-werktage' },
      { id: '22',  name: 'ca. 14 Werktage', slug: 'ca-14-werktage' },
      { id: '20',  name: 'ca. 3-4 Werktage', slug: 'ca-3-4-werktage' },
      { id: '666', name: 'ca. 5-6 Wochen (externe Dienstleistung)', slug: 'ca-5-6-wochen-externe-dienstleistung' },
    ]);
  });

  test.each(['Term_ID', 'Name'])('fehlende Pflichtspalte %s -> lauter Fehler mit Spaltenname', spalte => {
    const i    = REITER[0].indexOf(spalte);
    const rows = REITER.map(r => r.filter((_, k) => k !== i));
    expect(() => lib.parseLieferzeiten(rows)).toThrow(new RegExp(`Spalte "${spalte}" fehlt`));
  });

  test('leerer Reiter, leere ID, kaputte ID, doppelte ID -> Fehler', () => {
    expect(() => lib.parseLieferzeiten([])).toThrow(/Struktur_Lieferzeiten.*fehlt oder ist leer/);
    expect(() => lib.parseLieferzeiten([REITER[0]])).toThrow(/keine Lieferzeiten/);
    expect(() => lib.parseLieferzeiten([REITER[0], ['', 'x']])).toThrow(/Zeile 2: Spalte "Term_ID" ist leer/);
    expect(() => lib.parseLieferzeiten([REITER[0], ["'21", 'x']])).toThrow(/keine Zahl/);
    expect(() => lib.parseLieferzeiten([REITER[0], [21, 'a'], ['21', 'b']])).toThrow(/doppelt/);
  });

  test('GET /api/sheets/struktur-lieferzeiten liefert die Liste', async () => {
    const res = await request(app).get('/api/sheets/struktur-lieferzeiten');
    expect(res.status).toBe(200);
    expect(res.body.map(l => l.id)).toEqual(['21', '22', '20', '666']);
  });

  test('GET: fehlende Spalte -> 500 mit Spaltenname, keine Liste', async () => {
    sheetAntwort = async () => ({ data: { values: REITER.map(r => r.slice(0, 1)) } });
    const res = await request(app).get('/api/sheets/struktur-lieferzeiten');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Spalte "Name" fehlt/);
  });

  test('GET: fehlender Reiter -> 500 mit Reitername', async () => {
    sheetAntwort = async () => { throw new Error('Unable to parse range: Struktur_Lieferzeiten!A1:Z200'); };
    const res = await request(app).get('/api/sheets/struktur-lieferzeiten');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Reiter "Struktur_Lieferzeiten" fehlt/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Anlagepfad', () => {
  const LISTE = () => lib.parseLieferzeiten(REITER);

  test('ohne Aenderung vorbelegt mit der ersten Zeile (21)', () => {
    const opts = fe.lzOptionen(LISTE(), undefined);
    expect(opts.filter(o => o.selected).map(o => o.value)).toEqual(['21']);
    expect(opts.map(o => o.text)).toContain('ca. 5-6 Wochen (externe Dienstleistung)');
  });

  test('Anlage ohne Aenderung -> "21" am Eltern, "-1" an allen Variationen', async () => {
    const gewaehlt = fe.lzOptionen(LISTE(), undefined).find(o => o.selected).value;
    const res = await request(app).post('/api/woocommerce/products').send({ ...BASIS, lieferzeit: gewaehlt });
    expect(res.status).toBe(201);
    expect(lzVon(produktBody())).toEqual([{ key: '_lieferzeit', value: '21' }]);
    expect(varBodies()).toHaveLength(2);
    for (const b of varBodies()) expect(lzVon(b)).toEqual([{ key: '_lieferzeit', value: '-1' }]);
    expect(res.body.lieferzeit).toMatchObject({
      status: 'gesetzt', gesetzt: '21', variationen: { wie_eltern: 2, abweichend: [] },
    });
    expect(fe.lzMeldung(res.body.lieferzeit, LISTE())).toEqual({ typ: 'success', text: 'Lieferzeit gesetzt: ca. 5-6 Werktage (21)' });
  });

  test('Auswahl 666 -> "666"', async () => {
    const res = await request(app).post('/api/woocommerce/products').send({ ...BASIS, lieferzeit: '666' });
    expect(res.status).toBe(201);
    expect(lzVon(produktBody())).toEqual([{ key: '_lieferzeit', value: '666' }]);
    expect(res.body.lieferzeit.gesetzt).toBe('666');
  });

  test('Wert ist String, kein Apostroph - Zahl oder "\'21" -> 400, nichts angelegt', async () => {
    for (const falsch of [21, "'21", "'-1", '', '-1', 'ca. 5-6 Werktage']) {
      wc.post.mockClear();
      const res = await request(app).post('/api/woocommerce/products').send({ ...BASIS, lieferzeit: falsch });
      expect(res.status).toBe(400);
      expect(res.body.feld).toBe('lieferzeit');
      expect(wc.post).not.toHaveBeenCalled();
    }
    await request(app).post('/api/woocommerce/products').send({ ...BASIS, lieferzeit: '22' });
    const alle = [produktBody(), ...varBodies()].flatMap(lzVon).map(m => m.value);
    for (const v of alle) {
      expect(typeof v).toBe('string');
      expect(v.startsWith("'")).toBe(false);
    }
  });

  test('ohne lieferzeit im Body: Eltern ohne _lieferzeit, Antwort "nicht gesetzt" mit Grund', async () => {
    const res = await request(app).post('/api/woocommerce/products').send(BASIS);
    expect(res.status).toBe(201);
    expect(lzVon(produktBody())).toEqual([]);
    expect(res.body.lieferzeit).toMatchObject({ status: 'nicht gesetzt', grund: 'keine Lieferzeit übergeben' });
    expect(fe.lzMeldung(res.body.lieferzeit).typ).toBe('error');
  });

  test('WooCommerce meldet anderen Wert zurueck -> "abweichend", Toast mit Grund', async () => {
    wc.post.mockImplementation(async (pfad, body) => pfad === 'products'
      ? { data: { id: 100, status: 'draft', meta_data: [] } }
      : { data: { id: ++varId, meta_data: [] } });
    const res = await request(app).post('/api/woocommerce/products').send({ ...BASIS, lieferzeit: '21' });
    expect(res.body.lieferzeit.status).toBe('abweichend');
    expect(res.body.lieferzeit.variationen.abweichend).toHaveLength(2);
    expect(fe.lzMeldung(res.body.lieferzeit).text).toMatch(/nicht gesetzt: WooCommerce meldet "\(kein Wert\)" statt "21"/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Aenderungspfad', () => {
  const LISTE = () => lib.parseLieferzeiten(REITER);
  const PUT_BASIS = { name: 'Shirt', status: 'draft' };

  test('bekannter Shop-Wert wird angezeigt und ausgewaehlt', () => {
    const geladen = fe.lzWertAusMeta([{ key: '_lieferzeit', value: 22 }]);
    expect(geladen).toBe('22');
    const opts = fe.lzOptionen(LISTE(), geladen);
    expect(opts.find(o => o.selected).value).toBe('22');
    expect(opts.some(o => o.value === fe.LZ_UNBEKANNT)).toBe(false);
  });

  test.each([['-1', 'unbekannt (Wert -1)'], ['92', 'unbekannt (Wert 92)'], [null, 'unbekannt (Wert leer)']])(
    'unbekannter Wert %s -> Anzeige "%s", kein Schreiben', async (wert, text) => {
      const meta    = wert === null ? [] : [{ key: '_lieferzeit', value: wert }];
      const geladen = fe.lzWertAusMeta(meta);
      const opts    = fe.lzOptionen(LISTE(), geladen);
      expect(opts[0]).toEqual({ value: fe.LZ_UNBEKANNT, text, selected: true });

      // Nutzer aendert nichts -> Feld bleibt weg -> kein meta_data im PUT
      const senden = fe.lzZuSenden(geladen, opts.find(o => o.selected).value);
      expect(senden).toBeUndefined();
      const res = await request(app).put('/api/woocommerce/products/100')
        .send({ ...PUT_BASIS, ...(senden !== undefined ? { lieferzeit: senden } : {}) });
      expect(res.status).toBe(200);
      expect(wc.put.mock.calls[0][1].meta_data).toBeUndefined();
      expect(res.body.lieferzeit.status).toBe('unveraendert');
      expect(fe.lzMeldung(res.body.lieferzeit, LISTE()).typ).toBe('info');
    });

  test('bekannter Wert unveraendert -> nichts senden', () => {
    expect(fe.lzZuSenden('21', '21')).toBeUndefined();
  });

  test('Nutzer stellt um -> nur Eltern bekommt _lieferzeit, Variationen unberuehrt', async () => {
    const senden = fe.lzZuSenden('92', '666');
    expect(senden).toBe('666');
    const res = await request(app).put('/api/woocommerce/products/100').send({
      ...PUT_BASIS, lieferzeit: senden,
      variations: [{ id: 5, attributes: [{ name: 'Farbe', option: 'Rot' }], regular_price: '20' }],
    });
    expect(res.status).toBe(200);
    expect(wc.put.mock.calls[0][1].meta_data).toEqual([{ key: '_lieferzeit', value: '666' }]);
    const batch = wc.post.mock.calls.find(c => c[0].endsWith('/variations/batch'))[1];
    expect(batch.update[0].meta_data).toBeUndefined();
    expect(res.body.lieferzeit).toMatchObject({ status: 'gesetzt', gesetzt: '666' });
    expect(fe.lzMeldung(res.body.lieferzeit, LISTE()).text).toBe('Lieferzeit gesetzt: ca. 5-6 Wochen (externe Dienstleistung) (666)');
  });

  test('PUT mit kaputtem Wert -> 400, nichts geschrieben', async () => {
    const res = await request(app).put('/api/woocommerce/products/100').send({ ...PUT_BASIS, lieferzeit: "'-1" });
    expect(res.status).toBe(400);
    expect(wc.put).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Abgrenzung', () => {
  test('Lieferzeit geht nicht in den SEO-Prompt', () => {
    const prompt = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../lib/seo-prompt.js'), 'utf8');
    expect(prompt).not.toMatch(/_lieferzeit|lieferzeiten\.js|Struktur_Lieferzeiten/);
  });

  test('der Frontend-Block wurde gefunden', () => {
    expect(von).toBeGreaterThan(-1);
    expect(bis).toBeGreaterThan(von);
  });
});
