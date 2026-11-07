// Auftrag VB1: "Artikel ändern" darf den Variantenbaum nicht zerstoeren.
// Befund 08.11.2026: Bei 5 Artikeln (globale Attribute Farbe/Groesse) standen nach dem Entfernen
// von 4XL/5XL alle Variationen auf "Beliebig". Ursache: Eltern-Attribute nur mit NAMEN geschickt
// -> WooCommerce legt lokale Attribute an und ersetzt die globalen; die Variationen (attribute_pa_*)
// passen auf nichts mehr. Dazu verlor die Maske die Variations-IDs (recomputeVariants).
//
// Die Attrappe bildet das gemessene WooCommerce-Verhalten nach:
//  - Produkt-PUT: Attribut mit id = global (pa_…), ohne id = lokal; die Liste ERSETZT alle.
//  - Variation: Werte stehen unter dem Schluessel des Eltern-Attributs (pa_farbe bzw. farbe);
//    gelesen werden nur Werte, deren Schluessel der Elternartikel (noch) hat.
//  - Variations-Update mit Attributen: nur Attribute, die der Elternartikel hat, werden gesetzt.
// Alle Werte sind erfunden.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: () => ({ spreadsheets: { values: { get: async () => ({ data: { values: [
    ['Term_ID', 'Name', 'Slug', 'Standard'], [21, 'ca. 5-6 Werktage', 'x', 'ja'],
  ] } }) } } }) },
}));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));
const wc = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient:   jest.fn(() => wc),
}));

const vb = await import('../utils/variantenbaum.js');
const QUELLE = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../routes/woocommerce.js'), 'utf8');
const html   = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block  = (a, e) => html.slice(html.indexOf(a), html.indexOf(e));
const fe = new Function(`${block('// ── Variantenbaum: Anfang', '// ── Variantenbaum: Ende ──')}\nreturn { vbWerteWeg };`)();

// ── Attrappe ────────────────────────────────────────────────────────────────
const GLOBAL = { 3: { name: 'Farbe', key: 'pa_farbe' }, 2: { name: 'Größe', key: 'pa_groesse' } };
const san = s => String(s).toLowerCase().replace(/ö/g, 'o').replace(/ä/g, 'a').replace(/ü/g, 'u').replace(/ß/g, 'ss');
let shop;   // { produkt: { attributes:[{key,id,name,options,variation}], default_attributes }, variationen: Map(id -> { status, sku, werte: {key: wert} }) }
const keyVon = a => (a.id ? GLOBAL[a.id].key : san(a.name));
const elternKey = (va) => {   // wie WC: id -> pa_…, sonst sanitize_title(name)
  const k = va.id ? GLOBAL[va.id]?.key : san(va.name);
  return shop.produkt.attributes.find(a => a.key === k && a.variation) ? k : null;
};
const leseVariation = (id, v) => ({ id, status: v.status, sku: v.sku, parent_id: 100,
  attributes: shop.produkt.attributes.filter(a => a.variation && v.werte[a.key] !== undefined)
    .map(a => ({ id: a.id, name: a.name, option: v.werte[a.key] })) });
let naechsteId;
function setzeShop({ global = true, farben = ['Black', 'White'], groessen = ['S', 'M', '4XL', '5XL'] } = {}) {
  const fa = global ? { id: 3, key: 'pa_farbe', name: 'Farbe' } : { id: 0, key: 'farbe', name: 'Farbe' };
  const gr = global ? { id: 2, key: 'pa_groesse', name: 'Größe' } : { id: 0, key: 'grosse', name: 'Größe' };
  shop = { produkt: { attributes: [{ ...fa, options: [...farben], variation: true }, { ...gr, options: [...groessen], variation: true }],
    default_attributes: global ? [{ id: 3, name: 'Farbe', option: 'black' }] : [] }, variationen: new Map() };
  naechsteId = 500;
  for (const f of farben) for (const g of groessen)
    shop.variationen.set(++naechsteId, { status: 'publish', sku: `T/X-${f}-${g}`.toLowerCase(), werte: { [fa.key]: f, [gr.key]: g } });
}
function wcAttrappe() {
  wc.get.mockImplementation(async (pfad, params = {}) => {
    if (pfad.endsWith('/variations')) {
      const alle = [...shop.variationen].map(([id, v]) => leseVariation(id, v));
      const page = params.page ?? 1;
      return { data: alle.slice((page - 1) * 100, page * 100) };
    }
    const mv = pfad.match(/variations\/(\d+)$/);
    if (mv) { const v = shop.variationen.get(Number(mv[1])); return { data: v ? leseVariation(Number(mv[1]), v) : {} }; }
    return { data: { id: 100, sku: 'T/X', attributes: shop.produkt.attributes.map(({ key, ...a }) => a), default_attributes: shop.produkt.default_attributes } };
  });
  wc.put.mockImplementation(async (pfad, body) => {
    const mv = pfad.match(/variations\/(\d+)$/);
    if (mv) { const v = shop.variationen.get(Number(mv[1])); if (body.status) v.status = body.status; return { data: leseVariation(Number(mv[1]), v) }; }
    if (Array.isArray(body.attributes))   // ERSETZT alle; ohne id = lokal
      shop.produkt.attributes = body.attributes.map(a => ({ id: a.id ? Number(a.id) : 0, key: keyVon(a), name: a.id ? GLOBAL[a.id].name : a.name, options: [...a.options], variation: !!a.variation }));
    if (body.default_attributes) shop.produkt.default_attributes = body.default_attributes;
    return { data: { id: 100, meta_data: [], status: 'publish', images: [] } };
  });
  wc.post.mockImplementation(async (pfad, body) => {
    if (!pfad.endsWith('/variations/batch')) return { data: {} };
    const update = (body.update ?? []).map(u => {
      const v = shop.variationen.get(Number(u.id));
      if (!v) return { id: u.id, error: { message: 'gibt es nicht' } };
      if (u.status) v.status = u.status;
      if (Array.isArray(u.attributes)) {   // wie WC: set_attributes mit nur passenden Eltern-Attributen
        const neu = {};
        for (const a of u.attributes) { const k = elternKey(a); if (k) neu[k] = a.option; }
        v.werte = neu;
      }
      return { id: u.id };
    });
    const create = (body.create ?? []).map(c => {
      if ([...shop.variationen.values()].some(v => v.sku === c.sku)) return { id: 0, error: { message: 'SKU doppelt' } };
      const werte = {}; for (const a of c.attributes) { const k = elternKey(a); if (k) werte[k] = a.option; }
      const id = ++naechsteId; shop.variationen.set(id, { status: 'publish', sku: c.sku, werte });
      return leseVariation(id, shop.variationen.get(id));
    });
    return { data: { update, create } };
  });
}

let request, app;
beforeAll(async () => {
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  const { default: router } = await import('../routes/woocommerce.js');
  app = express(); app.use(express.json()); app.use('/api/woocommerce', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  wc.get.mockReset(); wc.post.mockReset(); wc.put.mockReset(); wc.delete.mockReset();
  setzeShop(); wcAttrappe();
});
afterEach(() => jest.restoreAllMocks());

// Body wie die Maske ihn baut. mitIds=false = alter Stand (vor VB1): nur Namen.
function maskenBody({ farben, groessen, mitIds = true, privat } = {}) {
  const id = n => (mitIds ? { id: n === 'Farbe' ? 3 : 2 } : {});
  const vars = [...shop.variationen].map(([vid, v]) => leseVariation(vid, v))
    .filter(v => v.status !== 'private' && farben.includes(v.attributes[0]?.option) && groessen.includes(v.attributes[1]?.option));
  return {
    name: 'Testartikel',
    attributes: [{ ...id('Farbe'), name: 'Farbe', options: farben, variation: true, visible: true },
                 { ...id('Größe'), name: 'Größe', options: groessen, variation: true, visible: true }],
    variations: vars.map(v => ({ id: v.id, regular_price: '20',
      attributes: v.attributes.map(a => ({ ...(mitIds ? { id: a.id } : {}), name: a.name, option: a.option })) })),
    ...(privat ? { privat } : {}),
  };
}
const gelesen = () => [...shop.variationen].map(([id, v]) => leseVariation(id, v));
const sichtbar = () => gelesen().filter(v => v.status !== 'private');
const put = body => request(app).put('/api/woocommerce/products/100').send(body);

// ── Fall Groesse: 4XL/5XL weg ───────────────────────────────────────────────
test('Groesse raus: uebrige Variationen behalten Farbe + Groesse, 4XL/5XL privat, Attribute bleiben global', async () => {
  const res = await put(maskenBody({ farben: ['Black', 'White'], groessen: ['S', 'M'] }));
  expect(res.status).toBe(200);
  expect(shop.produkt.attributes.map(a => a.key)).toEqual(['pa_farbe', 'pa_groesse']);
  expect(sichtbar()).toHaveLength(4);
  for (const v of sichtbar()) expect(v.attributes.map(a => a.option)).toHaveLength(2);
  expect(gelesen().filter(v => v.status === 'private')).toHaveLength(4);
  expect(res.body.privat_gesetzt).toHaveLength(4);
  expect(res.body.entfallene_werte).toEqual([{ name: 'Größe', id: 2, werte: ['4XL', '5XL'] }]);
  expect(shop.variationen.size).toBe(8);                 // nichts geloescht
  expect(wc.delete).not.toHaveBeenCalled();
});

test('alter Body ohne ids (Maske vor VB1, z. B. aus dem Zwischenspeicher): Backend ergaenzt die ids', async () => {
  const res = await put(maskenBody({ farben: ['Black', 'White'], groessen: ['S', 'M'], mitIds: false }));
  expect(res.status).toBe(200);
  expect(shop.produkt.attributes.map(a => a.key)).toEqual(['pa_farbe', 'pa_groesse']);
  for (const v of sichtbar()) expect(v.attributes).toHaveLength(2);
});

test('Nachweis Ursache: ohne Schutz (direkt an die Attrappe) stehen alle Variationen auf "Beliebig"', async () => {
  // genau der Body der alten Maske, an WooCommerce durchgereicht
  const body = maskenBody({ farben: ['Black', 'White'], groessen: ['S', 'M'], mitIds: false });
  await wc.put('products/100', { attributes: body.attributes });
  await wc.post('products/100/variations/batch', { update: body.variations });
  expect(shop.produkt.attributes.map(a => a.key)).toEqual(['farbe', 'grosse']);   // global -> lokal
  // Variationen ohne passendes Update (4XL/5XL) haben gar keine Werte mehr
  expect(gelesen().filter(v => v.attributes.length === 0).length).toBeGreaterThan(0);
});

// ── Fall Farbe komplett weg ─────────────────────────────────────────────────
test('Farbe raus: White-Variationen privat, Black behaelt alle Werte, Vorblendung bleibt gueltig', async () => {
  const res = await put(maskenBody({ farben: ['Black'], groessen: ['S', 'M', '4XL', '5XL'] }));
  expect(res.status).toBe(200);
  expect(sichtbar()).toHaveLength(4);
  expect(sichtbar().every(v => v.attributes[0].option === 'Black' && v.attributes.length === 2)).toBe(true);
  expect(gelesen().filter(v => v.status === 'private').every(v => v.attributes[0].option === 'White')).toBe(true);
  expect(shop.produkt.default_attributes).toEqual([{ id: 3, name: 'Farbe', option: 'black' }]);
});

test('Vorblendung mit entfallener Farbe faellt weg', async () => {
  await put(maskenBody({ farben: ['White'], groessen: ['S', 'M', '4XL', '5XL'] }));
  expect(shop.produkt.default_attributes).toEqual([]);
});

test('beides (Farbe + Groessen raus) in einem Zug', async () => {
  const res = await put(maskenBody({ farben: ['White'], groessen: ['S'] }));
  expect(res.status).toBe(200);
  expect(sichtbar().map(v => v.attributes.map(a => a.option))).toEqual([['White', 'S']]);
  expect(res.body.privat_gesetzt).toHaveLength(7);
});

// ── Fall Kombination ────────────────────────────────────────────────────────
test('einzelne Kombination privat (Body privat): nur diese, Werte bleiben in den Optionen', async () => {
  const blk4 = gelesen().find(v => v.sku === 't/x-black-4xl').id;
  const body = maskenBody({ farben: ['Black', 'White'], groessen: ['S', 'M', '4XL', '5XL'] });
  body.variations = body.variations.filter(v => v.id !== blk4);
  const res = await put({ ...body, privat: [blk4] });
  expect(res.status).toBe(200);
  expect(gelesen().filter(v => v.status === 'private').map(v => v.id)).toEqual([blk4]);
  expect(sichtbar().every(v => v.attributes.length === 2)).toBe(true);
});

test('privat mit fremder Variation: 422, nichts geschrieben', async () => {
  const res = await put({ ...maskenBody({ farben: ['Black', 'White'], groessen: ['S', 'M'] }), privat: [999999] });
  expect(res.status).toBe(422);
  expect(wc.put).not.toHaveBeenCalled();
  expect(wc.post).not.toHaveBeenCalled();
});

test('Shop-Stand nicht lesbar: 502, nichts geschrieben', async () => {
  wc.get.mockImplementation(async () => { const e = new Error('weg'); e.response = { status: 500 }; throw e; });
  const res = await put(maskenBody({ farben: ['Black'], groessen: ['S'] }));
  expect(res.status).toBe(502);
  expect(res.body.code).toBe('shop_stand');
  expect(wc.put).not.toHaveBeenCalled();
});

test('lokale Attribute bleiben lokal (keine erfundene id)', async () => {
  setzeShop({ global: false });
  const res = await put(maskenBody({ farben: ['Black', 'White'], groessen: ['S', 'M'], mitIds: false }));
  expect(res.status).toBe(200);
  expect(shop.produkt.attributes.map(a => [a.id, a.key])).toEqual([[0, 'farbe'], [0, 'grosse']]);
  expect(sichtbar()).toHaveLength(4);
  for (const v of sichtbar()) expect(v.attributes).toHaveLength(2);
});

test('Teil-Update ohne Attribute/Varianten (nur Name) liest keinen Shop-Stand', async () => {
  const res = await put({ name: 'nur Name' });
  expect(res.status).toBe(200);
  expect(wc.get).not.toHaveBeenCalled();
});

// ── Knopf "privat stellen" ──────────────────────────────────────────────────
test('POST …/variations/:id/privat stellt privat, loescht nie', async () => {
  const id = gelesen()[0].id;
  const res = await request(app).post(`/api/woocommerce/products/100/variations/${id}/privat`);
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('private');
  expect(shop.variationen.get(id).status).toBe('private');
  expect(wc.delete).not.toHaveBeenCalled();
});

test('es gibt keine Route mehr, die Variationen loescht', () => {
  expect(QUELLE).not.toMatch(/router\.delete\(\s*'\/products\/:id\/variations/);
  expect(QUELLE).not.toMatch(/wc\.delete\(`products\/\$\{[^}]+\}\/variations/);
});

// ── Logik ───────────────────────────────────────────────────────────────────
test('attributeMitIds: Name passt auf globales Attribut (Gross/Klein, ö/oe)', () => {
  const r = vb.attributeMitIds([{ name: 'groesse', options: ['S'] }, { name: 'Motiv', options: ['A'] }],
    [{ id: 2, name: 'Größe' }, { id: 0, name: 'Motiv' }]);
  expect(r.attribute).toEqual([{ id: 2, name: 'Größe', options: ['S'] }, { name: 'Motiv', options: ['A'] }]);
  expect(r.ergaenzt).toBe(1);
});

test('variationenMitEntfallenemWert ueberspringt private und aktualisierte', () => {
  const body = [{ id: 2, name: 'Größe', options: ['S'] }];
  const vars = [
    { id: 1, status: 'publish', attributes: [{ id: 2, name: 'Größe', option: 'S' }] },
    { id: 2, status: 'publish', attributes: [{ id: 2, name: 'Größe', option: 'XL' }] },
    { id: 3, status: 'private', attributes: [{ id: 2, name: 'Größe', option: 'XL' }] },
    { id: 4, status: 'publish', attributes: [{ id: 2, name: 'Größe', option: 'XL' }] },
  ];
  expect(vb.variationenMitEntfallenemWert(vars, body, new Set(['4']))).toEqual([2]);
});

// ── Frontend ────────────────────────────────────────────────────────────────
test('Maske: vbWerteWeg nennt entfallende Werte', () => {
  const shopV = [{ attrs: [{ name: 'Farbe', value: 'Black' }, { name: 'Größe', value: '4XL' }] },
                 { attrs: [{ name: 'Farbe', value: 'White' }, { name: 'Größe', value: 'S' }] }];
  const aktiv = [{ attrs: [{ name: 'Farbe', value: 'Black' }, { name: 'Größe', value: 'S' }] }];
  expect(fe.vbWerteWeg(shopV, aktiv)).toEqual(['Größe 4XL', 'Farbe White']);
});

test('Maske: Laden behaelt Attribut-ids, recomputeVariants behaelt die Variations-ID, Speichern schickt ids', () => {
  expect(html).toMatch(/wcAttrIdsGeladen = new Map\(\(p\.attributes \|\| \[\]\)\.filter\(a => a\.id\)/);
  const rc = html.slice(html.indexOf('function recomputeVariants'), html.indexOf('function renderVariants'));
  expect(rc).toMatch(/wcVariationId: v\.wcVariationId/);
  expect(rc).toMatch(/existing\?\.wcVariationId/);
  expect(html).toMatch(/\.\.\.\(attrIdVon\(name\) \? \{ id: attrIdVon\(name\) \} : \{\}\), name, options/);
  expect(html).not.toMatch(/variations\/\$\{[^}]+\}`, \{ method: 'DELETE' \}/);
});
