// VB2: Reparatur-Plan fuer kaputte Variantenbaeume (utils/variantenbaum-reparatur.js). Erfundene Werte.
import { planeReparatur, ausSkuEndung } from '../utils/variantenbaum-reparatur.js';

const globale = new Map([
  ['farbe', { id: 3, name: 'Farbe', terme: new Map([['black', 'Black'], ['white', 'White'], ['navy blue', 'Navy Blue']]) }],
  ['größe', { id: 2, name: 'Größe', terme: new Map(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'].map(g => [g.toLowerCase(), g])) }],
]);
const lokal = (opts) => [{ id: 0, name: 'Farbe', variation: true, visible: true, position: 0, options: opts.f },
  { id: 0, name: 'Größe', variation: true, visible: true, position: 1, options: opts.g }];

test('VB1-Muster: lokal, Variationen leer -> global, Werte aus der SKU', () => {
  const produkt = { sku: 'T/X-Motiv', attributes: lokal({ f: ['Black'], g: ['S', 'M'] }),
    default_attributes: [{ id: 3, name: 'Farbe', option: 'black' }] };
  const vars = [{ id: 11, sku: 'T/X-Motiv-black-s', status: 'publish', attributes: [] },
                { id: 12, sku: 'T/X-Motiv-black-m', status: 'publish', attributes: [] }];
  const p = planeReparatur(produkt, vars, globale);
  expect(p.automatisch).toBe(true);
  expect(p.attributes).toEqual([{ id: 3, position: 0, visible: true, variation: true, options: ['Black'] },
                                { id: 2, position: 1, visible: true, variation: true, options: ['S', 'M'] }]);
  expect(p.batch).toEqual([{ id: 11, attributes: [{ id: 3, option: 'Black' }, { id: 2, option: 'S' }] },
                           { id: 12, attributes: [{ id: 3, option: 'Black' }, { id: 2, option: 'M' }] }]);
  expect(p.default_attributes).toEqual([{ id: 3, option: 'Black' }]);
});

test('Karma-Muster: lokal, Werte gueltig -> global, Werte von heute', () => {
  const produkt = { sku: 'T/K', attributes: lokal({ f: ['Black'], g: ['S', 'M'] }), default_attributes: [] };
  const vars = [{ id: 21, sku: 'T/K-black-s', status: 'publish', attributes: [{ id: 0, name: 'Farbe', option: 'Black' }, { id: 0, name: 'Größe', option: 'S' }] },
                { id: 22, sku: 'x', status: 'publish', attributes: [{ id: 0, name: 'Farbe', option: 'Black' }, { id: 0, name: 'Größe', option: 'M' }] }];
  const p = planeReparatur(produkt, vars, globale);
  expect(p.zeilen.map(z => z.quelle)).toEqual(['heute', 'heute']);
  expect(p.batch).toHaveLength(2);
  expect(p.default_attributes).toEqual([]);
});

test('nicht ableitbar -> unklar, nicht automatisch', () => {
  const produkt = { sku: 'T/Y', attributes: lokal({ f: ['Black', 'White'], g: ['S'] }), default_attributes: [] };
  const p = planeReparatur(produkt, [{ id: 31, sku: 'ganz-anders', status: 'publish', attributes: [] }], globale);
  expect(p.automatisch).toBe(false);
  expect(p.unklar.map(u => u.id)).toEqual([31]);
});

test('Reiter Varianten vor SKU', () => {
  const produkt = { sku: 'T/Z', attributes: lokal({ f: ['Black'], g: ['S', 'M'] }), default_attributes: [] };
  const p = planeReparatur(produkt, [{ id: 41, sku: 'T/Z-black-s', status: 'publish', attributes: [] }], globale,
    new Map([['41', { Farbe: 'Black', 'Größe': 'M' }]]));
  expect(p.zeilen[0]).toMatchObject({ quelle: 'Reiter Varianten', werte: ['Black', 'M'] });
});

test('Mehrwort-Farbe in der SKU, private Variation bestimmt keine Optionen, nicht-variierende Attribute bleiben', () => {
  const produkt = { sku: 'T/N', default_attributes: [], attributes: [
    { id: 0, name: 'Farbe', variation: true, visible: true, position: 0, options: ['Navy Blue'] },
    { id: 0, name: 'Größe', variation: true, visible: true, position: 1, options: ['S', '4XL'] },
    { id: 9, name: 'Material', variation: false, visible: true, position: 2, options: ['Baumwolle'] }] };
  const vars = [{ id: 51, sku: 'T/N-navy-blue-s', status: 'publish', attributes: [] },
                { id: 52, sku: 'T/N-navy-blue-4xl', status: 'private', attributes: [] }];
  const p = planeReparatur(produkt, vars, globale);
  expect(p.optionen).toEqual([['Navy Blue'], ['S']]);
  expect(p.attributes[2]).toEqual({ id: 9, position: 2, visible: true, variation: false, options: ['Baumwolle'] });
  expect(p.batch.map(b => b.id)).toEqual([51, 52]);
});

test('fehlender globaler Term -> nicht automatisch', () => {
  const produkt = { sku: 'T/F', attributes: lokal({ f: ['Pink'], g: ['S'] }), default_attributes: [] };
  const p = planeReparatur(produkt, [{ id: 61, sku: 'T/F-pink-s', status: 'publish', attributes: [] }], globale);
  expect(p.fehlendeTerme).toEqual(['Farbe: Pink']);
  expect(p.automatisch).toBe(false);
});

test('ausSkuEndung: mehrdeutig -> null', () => {
  expect(ausSkuEndung('A-x-y-z', 'A', [{ options: ['x', 'x-y'] }, { options: ['y-z', 'z'] }])).toBeNull();
});
