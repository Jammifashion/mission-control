// BO7-3: Problemliste "Lieferbarkeit Shop" - Shop-Artikel mit nicht lieferbarem L-Shop-Rohling. Nur lesen, nur Vorschlaege.
// Nur erfundene Daten (Nummern, Namen, IDs).

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { problemStufe, nachfolgerFuer, vorschlagFuer, baueProblemliste, merkmale, exportText, stufeText, NULL_AB_TAGE } from '../utils/lieferbarkeit-shop.js';
import { LIEFERBARKEIT_SPALTEN, LIEFERBARKEIT_TAB } from '../utils/lshop-lieferbarkeit.js';
import { leseProblemliste, _lieferbarkeitShopCacheLeeren } from '../lib/lieferbarkeitShop.js';
import { _lieferbarkeitCacheLeeren } from '../lib/lieferbarkeitLesen.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { machSheets } from './hilfen/korb-sheet.js';

const JETZT = new Date('2026-11-20T10:00:00Z');
const vor = tage => new Date(JETZT.getTime() - tage * 86_400_000 - 3_600_000).toISOString();   // knapp ueber n Tage
const L = (stufe, o = {}) => ({ stufe, stock: stufe === 'nicht_gefuehrt' ? null : stufe === 'lieferbar' ? 9 : 0, nullSeit: '', auslaufdatum: '', ...o });

describe('Stufe mit 14-Tage-Grenze', () => {
  test.each([[13, null], [14, 'null'], [15, 'null']])('0 seit %i Tagen -> %s', (tage, soll) => {
    expect(problemStufe(L('null', { nullSeit: vor(tage) }), JETZT)?.stufe ?? null).toBe(soll);
  });
  test('ohne Null_seit zaehlt 0 nie; laeuft aus und nicht gefuehrt sofort; lieferbar nie', () => {
    expect(problemStufe(L('null'), JETZT)).toBeNull();
    expect(problemStufe(L('auslauf', { auslaufdatum: '2026-12-31', stock: 5 }), JETZT)).toMatchObject({ stufe: 'auslauf', auslaufdatum: '2026-12-31' });
    expect(problemStufe(L('nicht_gefuehrt', { nullSeit: vor(1) }), JETZT)).toMatchObject({ stufe: 'nicht_gefuehrt' });
    expect(problemStufe(L('lieferbar'), JETZT)).toBeNull();
    expect(problemStufe(undefined, JETZT)).toBeNull();
    expect(NULL_AB_TAGE).toBe(14);
  });
  test('Vorschlaege: beobachten < 30 Tage, ab 30 Lieferzeit pruefen, nicht gefuehrt -> privat (Loeschliste)', () => {
    expect(vorschlagFuer({ stufe: 'null', tage: 20 })).toBe('beobachten');
    expect(vorschlagFuer({ stufe: 'null', tage: 30 })).toBe('Lieferzeit prüfen');
    expect(vorschlagFuer({ stufe: 'nicht_gefuehrt' })).toBe('Variation privat (Löschliste)');
    expect(vorschlagFuer({ stufe: 'auslauf' })).toBe('Nachfolger suchen');
  });
});

describe('Nachfolger nur mit lieferbarer Alternative', () => {
  const modelle = [
    { articleNr: '9000000001', catalogNr: 'X1', farbe: 'Black', size: 'M', marke: 'Muster' },
    { articleNr: '9000000002', catalogNr: 'X1', farbe: 'Navy', size: 'M', marke: 'Muster' },
    { articleNr: '9000000003', catalogNr: 'X1', farbe: 'Red', size: 'M', marke: 'Muster' },
    { articleNr: '9000000004', catalogNr: 'X1', farbe: 'Navy', size: 'L', marke: 'Muster' },
    { articleNr: '9000000005', catalogNr: 'Y2', farbe: 'Black', size: 'M', marke: 'Muster' },
    { articleNr: '9000000006', catalogNr: 'Z3', farbe: 'Black', size: 'M', marke: 'Andere' },
  ];
  test('gleiches Modell andere Farbe (gleiche Groesse) + Modell derselben Marke - nur wenn lieferbar', () => {
    const je = new Map([['9000000002', L('lieferbar')], ['9000000003', L('null')], ['9000000004', L('lieferbar')], ['9000000005', L('lieferbar')], ['9000000006', L('lieferbar')]]);
    const n = nachfolgerFuer('9000000001', modelle, je);
    expect(n).toEqual({ farben: ['Navy'], modelle: ['Y2'], marke: 'Muster' });
    expect(vorschlagFuer({ stufe: 'auslauf' }, n)).toBe('Nachfolger suchen – lieferbar: gleiches Modell in Navy · Muster: Y2 (nur Hinweis)');
  });
  test('keine lieferbare Alternative (oder unbekannt) -> kein Hinweis', () => {
    expect(nachfolgerFuer('9000000001', modelle, new Map([['9000000002', L('auslauf')]]))).toEqual({ farben: [], modelle: [], marke: 'Muster' });
    expect(nachfolgerFuer('9999999999', modelle, new Map())).toEqual({ farben: [], modelle: [] });
  });
});

// ── Liste ────────────────────────────────────────────────────────────────────
const zeile = (ssot, vid, nr, farbe, groesse, aktiv = 'TRUE') => ({ 'SSOT-ID': ssot, Aktiv: aktiv, WC_Variation_ID: vid, LShop_ArticleNr: nr, E1: 'Farbe', V1: farbe, E2: 'Größe', V2: groesse });
const varianten = [
  zeile('0001', '501', '9000000101', 'Black', 'M'), zeile('0001', '502', '9000000102', 'Black', 'L'), zeile('0001', '503', '9000000103', 'Navy', 'M'),
  zeile('0001', '504', '9000000104', 'Navy', 'L'), zeile('0001', '505', '9000000105', 'Red', 'M', 'FALSE'),
  zeile('0002', '601', '9000000201', 'White', 'S'), zeile('0002', '602', '9000000202', 'White', 'M'),
  zeile('0003', '701', '9000000301', 'Black', 'M'),   // Artikel im Entwurf
];
const je = new Map([
  ['9000000101', L('auslauf', { auslaufdatum: '2026-12-31', stock: 3 })], ['9000000102', L('auslauf', { auslaufdatum: '2026-12-31', stock: 1 })],
  ['9000000103', L('null', { nullSeit: vor(20) })], ['9000000104', L('lieferbar')], ['9000000105', L('nicht_gefuehrt')],
  ['9000000201', L('nicht_gefuehrt')], ['9000000202', L('null', { nullSeit: vor(40) })], ['9000000301', L('nicht_gefuehrt')],
]);
const produktJeSsot = new Map([['0001', '100'], ['0002', '200'], ['0003', '300']]);
const produkte = new Map([
  ['100', { status: 'publish', name: 'Muster Hoodie', permalink: 'https://shop.example/hoodie', kategorien: ['Hoodies'], lieferzeit: '21' }],
  ['200', { status: 'publish', name: 'Muster Shirt', permalink: 'https://shop.example/shirt', kategorien: ['Shirts'], lieferzeit: '' }],
  ['300', { status: 'draft', name: 'Entwurf', permalink: '', kategorien: [], lieferzeit: '' }],
]);

describe('baueProblemliste', () => {
  const l = baueProblemliste({ varianten, produktJeSsot, je, produkte, lieferzeitName: new Map([['21', 'Muster-Lieferzeit']]), jetzt: JETZT });

  test('gruppiert nach Artikel; Entwurf und inaktive Zeilen nicht drin, aber gezaehlt', () => {
    expect(l.artikel.map(a => a.produktId)).toEqual(['200', '100']);   // nicht gefuehrt zuerst
    expect(l.zaehler.ausgeblendet).toMatchObject({ entwurf: 1, inaktiv: 1, privat: 0 });
    expect(l.zaehler).toMatchObject({ artikel: 2, variationen: 5, nicht_gefuehrt: { variationen: 1, artikel: 1 }, auslauf: { variationen: 2, artikel: 1 }, null: { variationen: 2, artikel: 2 } });
  });
  test('je Artikel: x von y, ganze Farbe, Lieferzeit mit Name, Kategorie, Link', () => {
    const h = l.artikel.find(a => a.produktId === '100');
    expect(h).toMatchObject({ name: 'Muster Hoodie', betroffen: 3, gesamt: 4, farbenKomplett: ['Black'], lieferzeit: { id: '21', name: 'Muster-Lieferzeit' }, kategorien: ['Hoodies'], permalink: 'https://shop.example/hoodie' });
    expect(l.artikel.find(a => a.produktId === '200')).toMatchObject({ betroffen: 2, gesamt: 2, farbenKomplett: ['White'], lieferzeit: null });
  });
  test('Sortierung innen: nicht gefuehrt -> laeuft aus (Datum) -> 0 am laengsten', () => {
    expect(l.artikel[0].variationen.map(v => [v.stufe, v.tage])).toEqual([['nicht_gefuehrt', null], ['null', 40]]);
    expect(l.artikel[1].variationen.map(v => v.stufe)).toEqual(['auslauf', 'auslauf', 'null']);
    expect(l.artikel[0].variationen[1].vorschlag).toBe('Lieferzeit prüfen');
    expect(l.artikel[1].variationen[2].vorschlag).toBe('beobachten');
  });
  test('Shop-Status geprueft: private Variation ausgeblendet und gezaehlt', () => {
    const p = baueProblemliste({ varianten, produktJeSsot, je, produkte, varStatus: new Map([['601', 'private'], ['602', 'publish'], ['501', 'publish']]), jetzt: JETZT });
    expect(p.zaehler.ausgeblendet.privat).toBe(1);
    expect(p.zaehler.shopStatusGeprueft).toBe(true);
    expect(p.artikel.find(a => a.produktId === '200').variationen.map(v => v.variationId)).toEqual(['602']);
  });
  test('Merkmale aus E/V', () => expect(merkmale(varianten[0])).toEqual({ farbe: 'Black', groesse: 'M', text: 'Black / M' }));
  test('Export: Artikel-ID, Variation-ID, Stufe, Vorschlag - ohne Preise', () => {
    const text = exportText(l, { stand: '10:30' });
    expect(text.split('\n')[0]).toBe('Lieferbarkeit Shop – 2 Artikel, 5 Variationen (Stand 10:30)');
    expect(text).toContain('Artikel 100 · Muster Hoodie · 3 von 4 Variationen · ganze Farbe: Black · Lieferzeit 21 (Muster-Lieferzeit)');
    expect(text).toContain('  Variation 501 · Black / M · L-Shop 9000000101 · läuft aus bis 31.12.2026 · Nachfolger suchen');
    expect(text).not.toMatch(/€|EUR|Preis|price/i);
    expect(stufeText({ stufe: 'null', nullSeit: '2026-10-31T09:00:00Z', tage: 20 })).toBe('bei L-Shop 0 seit 31.10.2026 (20 Tage)');
  });
});

// ── Lib gegen In-Memory-Sheet + Shop-Attrappe ───────────────────────────────
const lbZeile = (nr, stock, o = {}) => ({ ArticleNr: nr, CatalogNr: 'X1', stock, Stand_Datei: '2026-11-20T09:30:00.000Z', Auslauf: 'nein', Auslaufdatum: '',
  Quelle_Liste: 'Auslaufartikel - Stand 13.11.2026.de.xlsx', Geaendert_Am: 'x', Null_seit: '', ...o });
function tabs({ mitLieferbarkeit = true } = {}) {
  const VS = ['SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'Aktiv', 'WC_Variation_ID', 'LShop_ArticleNr'];
  return {
    Varianten: [VS, ...varianten.map(z => VS.map(n => z[n] ?? ''))],
    Erfassungsmaske: [['ID', 'Produkt-ID', 'Produktname'], ['0001', '100', 'Muster Hoodie'], ['0002', '200', 'Muster Shirt'], ['0003', '300', 'Entwurf']],
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Brand', 'Discontinued', 'Status'],
      ...[...je.keys()].map(nr => [nr, 'X1', 'Black', '', 'M', '', '', 'Muster', '0', 'aktiv'])],
    Struktur_Lieferzeiten: [['Term_ID', 'Name', 'Slug', 'Standard'], ['21', 'Muster-Lieferzeit', 'm', 'ja']],
    ...(mitLieferbarkeit ? { [LIEFERBARKEIT_TAB]: [LIEFERBARKEIT_SPALTEN, ...[
      lbZeile('9000000101', 3, { Auslauf: 'ja', Auslaufdatum: '2026-12-31' }), lbZeile('9000000102', 1, { Auslauf: 'ja' }),
      lbZeile('9000000103', 0, { Null_seit: vor(20) }), lbZeile('9000000104', 9), lbZeile('9000000105', ''),
      lbZeile('9000000201', ''), lbZeile('9000000202', 0, { Null_seit: vor(40) }), lbZeile('9000000301', ''),
    ].map(z => LIEFERBARKEIT_SPALTEN.map(n => z[n] ?? ''))] } : {}),
  };
}
function machWc() {
  const aufrufe = [];
  const prod = { 100: { id: 100, name: 'Muster Hoodie', status: 'publish', permalink: 'https://shop.example/hoodie', categories: [{ name: 'Hoodies' }], meta_data: [{ key: '_lieferzeit', value: '21' }] },
    200: { id: 200, name: 'Muster Shirt', status: 'publish', permalink: 'https://shop.example/shirt', categories: [{ name: 'Shirts' }], meta_data: [] },
    300: { id: 300, name: 'Entwurf', status: 'draft', permalink: '', categories: [], meta_data: [] } };
  const c = {
    get: jest.fn(async (pfad, q) => {
      aufrufe.push(pfad);
      if (pfad === 'products') return { data: q.include.split(',').map(id => prod[id]).filter(Boolean) };
      const m = pfad.match(/^products\/(\d+)\/variations$/);
      if (m) return { data: m[1] === '200' ? [{ id: 601, status: 'private' }, { id: 602, status: 'publish' }] : [{ id: 501, status: 'publish' }, { id: 502, status: 'publish' }, { id: 503, status: 'publish' }] };
      throw new Error(`unerwartet: ${pfad}`);
    }),
    post: jest.fn(), put: jest.fn(), delete: jest.fn(),
  };
  return { wcFuer: () => c, c, aufrufe };
}

describe('leseProblemliste (nur lesen)', () => {
  beforeEach(() => { process.env.GOOGLE_SHEET_ID = 'ssot'; _lieferbarkeitShopCacheLeeren(); _lieferbarkeitCacheLeeren(); _resetLShopCache(); });

  test('Liste mit Shop-Daten; kein Schreibaufruf in Sheet oder Shop; Produkte aus dem Zwischenspeicher', async () => {
    const { sheets, aufrufe } = machSheets(tabs());
    const w = machWc();
    const r = await leseProblemliste({ sheets, wcFuer: w.wcFuer, jetzt: JETZT });
    expect(r.zaehler).toMatchObject({ artikel: 2, variationen: 5, shopStatusGeprueft: false });
    expect(r.artikel.find(a => a.produktId === '100').lieferzeit).toEqual({ id: '21', name: 'Muster-Lieferzeit' });
    expect(r.stand).toMatchObject({ datei: '2026-11-20T09:30:00.000Z' });
    expect(w.aufrufe).toEqual(['products']);
    expect([w.c.post, w.c.put, w.c.delete].every(f => f.mock.calls.length === 0)).toBe(true);
    expect(aufrufe).toEqual({ append: 0, update: [], batchUpdate: [], struktur: [] });
    await leseProblemliste({ sheets, wcFuer: w.wcFuer, jetzt: JETZT });
    expect(w.aufrufe).toEqual(['products']);   // 10 min Zwischenspeicher
  });

  test('Shop-Status pruefen: je veroeffentlichtem Artikel ein Abruf mit Takt, private ausgeblendet', async () => {
    const { sheets } = machSheets(tabs());
    const w = machWc();
    const warte = jest.fn(async () => {});
    const r = await leseProblemliste({ sheets, wcFuer: w.wcFuer, jetzt: JETZT, shopStatus: true, warte });
    expect(w.aufrufe.filter(a => a.includes('/variations')).sort()).toEqual(['products/100/variations', 'products/200/variations']);
    expect(warte).toHaveBeenCalledWith(2000);
    expect(r.zaehler).toMatchObject({ shopStatusGeprueft: true, variationen: 4, ausgeblendet: { privat: 1 } });
  });

  test('ohne Reiter LShop_Lieferbarkeit: Hinweis, kein Shop-Abruf', async () => {
    const { sheets } = machSheets(tabs({ mitLieferbarkeit: false }));
    const w = machWc();
    const r = await leseProblemliste({ sheets, wcFuer: w.wcFuer, jetzt: JETZT });
    expect(r).toMatchObject({ artikel: [], zaehler: null, stand: null });
    expect(r.hinweis).toMatch(/noch nicht eingerichtet/);
    expect(w.aufrufe).toEqual([]);
  });
});

// ── Frontend ─────────────────────────────────────────────────────────────────
describe('Frontend-Block Lieferbarkeit-Shop', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const block = html.slice(html.indexOf('// ── Lieferbarkeit-Shop: Anfang'), html.indexOf('// ── Lieferbarkeit-Shop: Ende ──'));
  const F = new Function(`${block}\nreturn { lfbsStufeText, lfbsFiltern, lfbsKategorien, lfbsZaehlen, lfbsExport };`)();
  const l = baueProblemliste({ varianten, produktJeSsot, je, produkte, lieferzeitName: new Map([['21', 'Muster-Lieferzeit']]), jetzt: JETZT });

  test('Spiegel: Stufentext und Export wie im Backend', () => {
    for (const v of l.artikel.flatMap(a => a.variationen)) expect(F.lfbsStufeText(v)).toBe(stufeText(v));
    expect(F.lfbsExport(l.artikel, { stand: '10:30' })).toBe(exportText(l, { stand: '10:30' }));
  });
  test('Filter Stufe, Kategorie, Suche (jedes Wort); Zaehler der gezeigten Liste', () => {
    expect(F.lfbsFiltern(l.artikel, { stufe: 'auslauf' }).map(a => a.produktId)).toEqual(['100']);
    expect(F.lfbsFiltern(l.artikel, { kategorie: 'Shirts' }).map(a => a.produktId)).toEqual(['200']);
    expect(F.lfbsFiltern(l.artikel, { suche: 'hoodie navy' })[0].variationen.map(v => v.variationId)).toEqual(['503']);
    expect(F.lfbsKategorien(l.artikel)).toEqual(['Hoodies', 'Shirts']);
    expect(F.lfbsZaehlen(l.artikel)).toEqual({ artikel: 2, variationen: 5, nicht_gefuehrt: 1, auslauf: 2, null: 2 });
  });
  test('Verdrahtung: Unterpunkt artikel/lieferbarkeit, Modus-Knopf mit Mouse-over, Maske-Hinweis, nichts Schreibendes', () => {
    expect(html).toContain("{ id: 'lieferbarkeit', panel: 'products', knopf: '#mode-btn-lieferbarkeit', neuLaden: true }");
    expect(html).toContain('id="mode-btn-lieferbarkeit" data-hilfe="lfbs-modus"');
    expect(html).toContain('lfbsMaskeHinweis(p.id);');
    const sektion = html.slice(html.indexOf('// ── SECTION: Lieferbarkeit Shop (BO7-3)'), html.indexOf('// ── SECTION: SEO-Daten aendern'));
    expect(new Set([...sektion.matchAll(/\/api\/[\w/-]+/g)].map(m => m[0]))).toEqual(new Set(['/api/lieferbarkeit-shop']));   // nur dieser Lese-Weg
    expect(sektion).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
  });
});
