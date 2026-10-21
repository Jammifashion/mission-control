// NAV3: Spalte "Shop" in Produktions_Status, LShop_Bestellungen, DTF_Bestellungen.
// Gleiche Bestellnummer + Position in JFN und HONK darf nicht kollidieren;
// Schreibpfade setzen den Shop, Leser trennen; ohne Spalte wie vor NAV3.

import { jest } from '@jest/globals';

// ── In-Memory-Sheet (mehrere Reiter) ────────────────────────────────────────
let tabs;
const tabAus = range => String(range).split('!')[0].replace(/'/g, '');
const zelle = a1 => {
  const m = String(a1).split('!')[1].match(/^([A-Z]+)(\d+)$/);
  const col = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { col, row: Number(m[2]) - 1 };
};
const setze = (range, wert) => {
  const t = tabs[tabAus(range)]; const { col, row } = zelle(range);
  while (t.length <= row) t.push([]);
  while (t[row].length <= col) t[row].push('');
  t[row][col] = wert;
};
const values = {
  get:    async ({ range }) => ({ data: { values: (tabs[tabAus(range)] ?? []).map(z => [...z]) } }),
  append: jest.fn(async ({ range, requestBody }) => { tabs[tabAus(range)].push(...requestBody.values.map(z => [...z])); return {}; }),
  update: async ({ range, requestBody }) => { setze(range, requestBody.values[0][0]); return {}; },
  batchUpdate: async ({ requestBody }) => { requestBody.data.forEach(d => setze(d.range, d.values[0][0])); return {}; },
};
jest.unstable_mockModule('googleapis', () => ({ google: { sheets: () => ({ spreadsheets: { values } }) } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));

// ── Zwei Shops mit derselben Bestellnummer 500 / Position 7 ────────────────
const bestellung = name => ({
  id: 500, billing: { first_name: name, last_name: '' },
  line_items: [{ id: 7, variation_id: 0, meta_data: [{ key: 'Größe', display_value: 'M' }] }],
});
const wcJe = { jfn: bestellung('J'), honk: bestellung('H') };
const norm = s => (String(s ?? '').toLowerCase().trim() === 'honk' ? 'honk' : 'jfn');
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  normalizeShop: norm,
  getShopConfig: s => ({ shop: norm(s) }),
  getWcClient: s => ({
    get: async (_pfad, p) => ({ data: p?.status === 'processing' ? [wcJe[norm(s)]] : [] }),
  }),
}));

const PS_KOPF  = ['WC_Order_ID', 'WC_Item_ID', 'Artikelname', 'SKU', 'Menge',
  'L-Shop_bestellt', 'DTF_bestellt', 'Gedruckt', 'Versendet', 'Notiz'];
const LSB_KOPF = ['Bestell-ID', 'Bestelldatum', 'SSOT-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'KW', 'Betroffene_Orders'];
const DTF_KOPF = ['Bestell-ID', 'Bestelldatum', 'SSOT-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'Betroffene_Orders'];
const psZeile  = (sku, shop) => ['500', '7', 'Shirt', sku, '1', 'FALSE', 'FALSE', 'FALSE', 'FALSE', '', shop];

function sheetMitSpalte() {
  tabs = {
    Produktions_Status: [[...PS_KOPF, 'Shop'], psZeile('JF/A', 'JFN'), psZeile('HK/B', 'HONK')],
    LShop_Bestellungen: [[...LSB_KOPF, 'Shop']],
    DTF_Bestellungen:   [[...DTF_KOPF, 'Shop']],
    Varianten:          [['SSOT-ID', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'WC_Variation_ID']],
    Erfassungsmaske:    [['ID', 'Artikelnummer', 'Produktname', 'Produkt-ID']],
  };
}

let request, app, lib;
beforeAll(async () => {
  process.env.GOOGLE_SHEET_ID = 'test';
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  lib = await import('../utils/shop-spalte.js');
  app = express();
  app.use(express.json());
  app.use('/api/sheets', (await import('../routes/sheets.js')).default);
  app.use('/api/auftragsmonitor', (await import('../routes/auftragsmonitor.js')).default);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
});
beforeEach(() => { sheetMitSpalte(); values.append.mockClear(); });

// ── Hilfe ───────────────────────────────────────────────────────────────────
describe('utils/shop-spalte.js', () => {
  test('leer = JFN, Wert ohne Gross/Klein, ohne Spalte kein Filter', () => {
    expect(lib.shopDerZeile(['x', ''], 1)).toBe('jfn');
    expect(lib.shopDerZeile(['x', 'Honk'], 1)).toBe('honk');
    expect(lib.gleicherShop(['x'], -1, 'honk')).toBe(true);
    expect(lib.gleicherShop(['x', ''], 1, 'honk')).toBe(false);
  });
  test('zeileMitShop fuellt bis zur Spalte auf und schreibt JFN/HONK', () => {
    expect(lib.zeileMitShop(['a'], 3, 'honk')).toEqual(['a', '', '', 'HONK']);
    expect(lib.zeileMitShop(['a'], -1, 'honk')).toEqual(['a']);
  });
});

// ── Produktions_Status (routes/sheets.js) ───────────────────────────────────
describe('Produktions_Status', () => {
  test('GET trennt gleiche Bestellnummer nach Shop', async () => {
    const j = await request(app).get('/api/sheets/produktions-status?orderId=500&shop=jfn');
    const h = await request(app).get('/api/sheets/produktions-status?orderId=500&shop=honk');
    expect(j.body.items.map(i => i.sku)).toEqual(['JF/A']);
    expect(h.body.items.map(i => i.sku)).toEqual(['HK/B']);
  });

  test('init schreibt den Shop; eine JFN-Bestellung sperrt die HONK-Anlage nicht', async () => {
    tabs.Produktions_Status = [[...PS_KOPF, 'Shop'], psZeile('JF/A', 'JFN')];
    const r = await request(app).post('/api/sheets/produktions-status/init?shop=honk')
      .send({ orderId: '500', items: [{ wcItemId: 7, artikelname: 'Shirt', sku: 'HK/B', menge: 1 }] });
    expect(r.body.created).toBe(true);
    const neu = tabs.Produktions_Status.at(-1);
    expect(neu[0]).toBe('500');
    expect(neu[10]).toBe('HONK');
    // zweiter Aufruf legt nichts mehr an
    const r2 = await request(app).post('/api/sheets/produktions-status/init?shop=honk')
      .send({ orderId: '500', items: [{ wcItemId: 7 }] });
    expect(r2.body.created).toBe(false);
  });

  test('PUT setzt das Haekchen nur in der Zeile des Shops', async () => {
    await request(app).put('/api/sheets/produktions-status?shop=honk')
      .send({ orderId: '500', wcItemId: '7', field: 'dtfBestellt', value: true });
    expect(tabs.Produktions_Status[1][6]).toBe('FALSE');   // JFN unberuehrt
    expect(tabs.Produktions_Status[2][6]).toBe(true);      // HONK
  });

  test('leere Shop-Zelle zaehlt als JFN', async () => {
    tabs.Produktions_Status[1][10] = '';
    const j = await request(app).get('/api/sheets/produktions-status?orderId=500&shop=jfn');
    expect(j.body.items.map(i => i.sku)).toEqual(['JF/A']);
  });

  test('ohne Spalte "Shop": Verhalten wie vor NAV3 (kein Filter, kein Shop-Wert)', async () => {
    tabs.Produktions_Status = [PS_KOPF, psZeile('JF/A').slice(0, 10)];
    const r = await request(app).post('/api/sheets/produktions-status/init?shop=honk')
      .send({ orderId: '500', items: [{ wcItemId: 7 }] });
    expect(r.body.created).toBe(false);                    // wie bisher: Bestellung schon da
    tabs.Produktions_Status = [PS_KOPF];
    await request(app).post('/api/sheets/produktions-status/init?shop=honk')
      .send({ orderId: '501', items: [{ wcItemId: 8 }] });
    expect(tabs.Produktions_Status[1]).toHaveLength(10);   // kein Shop-Wert angehaengt
  });
});

// ── Auftragsmonitor ─────────────────────────────────────────────────────────
describe('Auftragsmonitor', () => {
  test('offen: HONK sieht nur HONK-Zeilen, JFN nur JFN-Zeilen', async () => {
    const h = await request(app).get('/api/auftragsmonitor/lshop/offen?shop=honk');
    const j = await request(app).get('/api/auftragsmonitor/dtf/offen?shop=jfn');
    expect(h.body.map(g => g.artikelnummer)).toEqual(['HK/B']);
    expect(j.body.map(g => g.artikelnummer)).toEqual(['JF/A']);
  });

  test('bestellen: Protokoll mit Shop, Haekchen nur im eigenen Shop', async () => {
    const r = await request(app).post('/api/auftragsmonitor/lshop/bestellen?shop=honk').send({
      artikelnummer: 'HK/B', variante: 'M', stueck: 1, orderIds: ['500'], wcItemIds: [{ orderId: '500', wcItemId: '7' }],
    });
    expect(r.body.updated).toBe(1);
    expect(tabs.LShop_Bestellungen[1][8]).toBe('HONK');
    expect(tabs.Produktions_Status[1][5]).toBe('FALSE');   // JFN
    expect(tabs.Produktions_Status[2][5]).toBe(true);      // HONK
  });

  test('bestellen-bulk DTF: gleiche Nummer ohne Positionspaar trifft nur den eigenen Shop', async () => {
    await request(app).post('/api/auftragsmonitor/dtf/bestellen-bulk?shop=jfn').send({
      bestellungen: [{ artikelnummer: 'JF/A', variante: 'M', stueck: 1, orderIds: ['500'] }],
    });
    expect(tabs.DTF_Bestellungen[1][7]).toBe('JFN');
    expect(tabs.Produktions_Status[1][6]).toBe(true);      // JFN
    expect(tabs.Produktions_Status[2][6]).toBe('FALSE');   // HONK
  });

  test('protokoll: nur Zeilen des Shops, mit Feld shop', async () => {
    const heute = new Date().toISOString();
    tabs.LShop_Bestellungen.push(
      ['LSB-1', heute, '', 'JF/A', 'M', '1', '', '500', 'JFN'],
      ['LSB-2', heute, '', 'HK/B', 'M', '1', '', '500', 'HONK'],
      ['LSB-0', heute, '', 'ALT', 'M', '1', '', '400'],          // Altbestand ohne Shop = JFN
    );
    const h = await request(app).get('/api/auftragsmonitor/lshop/protokoll?shop=honk');
    const j = await request(app).get('/api/auftragsmonitor/lshop/protokoll?shop=jfn');
    expect(h.body.map(e => [e.bestellId, e.shop])).toEqual([['LSB-2', 'HONK']]);
    expect(j.body.map(e => e.bestellId).sort()).toEqual(['LSB-0', 'LSB-1']);
  });
});

// ── keyphrasePruefung: Status "entfernt" ───────────────────────────────────
describe('keyphrasePruefung', () => {
  test('Karte-Zeilen mit Status "entfernt" zaehlen nicht als Kollision', async () => {
    const { keyphrasePruefung } = await import('../lib/seo-ssot.js');
    const zeilen = [
      { typ: 'Artikel', name: 'Alt', wcId: '1', ist: 'Crocodiles Hoodie', soll: '', status: 'entfernt' },
      { typ: 'Artikel', name: 'Neu', wcId: '2', ist: 'Crocodiles Hoodie', soll: '', status: 'geschrieben' },
      { typ: 'Artikel', name: 'Ohne', wcId: '3', ist: 'crocodiles hoodie', soll: '' },
    ];
    const r = keyphrasePruefung(zeilen, 'Crocodiles Hoodie', { wcId: '9' });
    expect(r.kollisionen.map(k => k.wcId)).toEqual(['2', '3']);
    const gross = keyphrasePruefung([{ ...zeilen[0], status: ' Entfernt ' }], 'Crocodiles Hoodie');
    expect(gross.kollisionen).toEqual([]);
  });
});
