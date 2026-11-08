// VB2: SC-Team "mit Namen" Ja/Nein je Farbe + Groesse (scripts/sc-team-mit-namen.js). Erfundene Werte.
import { planeMitNamen } from '../scripts/sc-team-mit-namen.js';

const produkt = { attributes: [
  { id: 3, name: 'Farbe', variation: true, options: ['Navy'] },
  { id: 2, name: 'Größe', variation: true, options: ['S', 'M'] },
  { id: 5, name: 'mit Namen', variation: true, options: ['Ja', 'Nein'] }] };
const v = (id, g, extra = []) => ({ id, sku: `T/SC-navy-${g.toLowerCase()}`, status: 'publish', menu_order: id, regular_price: '30',
  tax_class: 'parent', tax_status: 'taxable', shipping_class: 'grossbrief',
  attributes: [{ id: 3, name: 'Farbe', option: 'Navy' }, { id: 2, name: 'Größe', option: g }, ...extra] });

test('bestehende -> Nein, neue mit Ja: gleicher Preis, SKU -ja, Lieferzeit -1, Google-Farbe', () => {
  const p = planeMitNamen(produkt, [v(1, 'S'), v(2, 'M')]);
  expect(p.probleme).toEqual([]);
  expect(p.update[0]).toEqual({ id: 1, attributes: [{ id: 3, option: 'Navy' }, { id: 2, option: 'S' }, { id: 5, option: 'Nein' }] });
  expect(p.create[1]).toMatchObject({ sku: 'T/SC-navy-m-ja', regular_price: '30', menu_order: 4, shipping_class: 'grossbrief',
    attributes: [{ id: 3, option: 'Navy' }, { id: 2, option: 'M' }, { id: 5, option: 'Ja' }],
    meta_data: [{ key: '_lieferzeit', value: '-1' }, { key: '_wc_gla_color', value: 'Navy' }] });
});

test('schon gesetzter Wert oder vorhandene -ja-SKU -> Problem, nichts fuer diese Variation', () => {
  const p = planeMitNamen(produkt, [v(1, 'S', [{ id: 5, name: 'mit Namen', option: 'Ja' }]), v(2, 'M'), { ...v(9, 'M'), sku: 'T/SC-navy-m-ja', status: 'private' }]);
  expect(p.probleme).toHaveLength(2);
  expect(p.create).toHaveLength(0);
});

test('"mit Namen" lokal -> Problem', () => {
  const lok = { attributes: produkt.attributes.map(a => (a.name === 'mit Namen' ? { ...a, id: 0 } : a)) };
  expect(planeMitNamen(lok, [v(1, 'S')]).probleme[0]).toMatch(/lokal/);
});
