// GT1 Punkt 7 (antwort-GT1-1): Brutto = bezahltes Brutto je Position (Netto + Steuer aus WooCommerce), nicht Netto x 1,19.
// Gilt ab neuen Abrechnungen (Zeilen mit VK-Steuer); Altzeilen rechnen wie bisher. Nur ERFUNDENE Werte.
import { aggregateFpVerkaeufe } from '../utils/fp-abrechnung.js';
import { gutschriftPlan } from '../utils/gutschrift.js';
import { fpBetragsUebersicht } from '../utils/partner-uebersicht.js';
import { vkSteuerPlan } from '../utils/vk-steuer-nachtrag.js';
import { buildFpErstattungRows } from '../utils/teilerstattung.js';
import { fpVerkaufszeile, buildFpStornoRows, STEUER_INDEX } from '../routes/festpreis-portal.js';

const KOPF = ['Partner-ID', 'Datum', 'WC-Bestellnummer', 'Artikelname', 'Variante', 'Stückzahl', 'Festpreis-EK', 'Handling', 'Porto-Einnahme', 'Porto-Kosten',
  'Versandnebenkosten', 'PayPal-Kosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto', 'Status Abrechnung', 'Produkt-ID', 'Storno-Status', 'Artikelkategorie',
  'Festpreis', 'Mehrkosten', 'VK-Netto', 'Handlingskosten', 'Versandmethode', 'Sperre', 'Porto_Bestellung', 'Porto_Versandart', 'Positions-ID', 'VK-Steuer'];
const vh = n => KOPF.indexOf(n);
// Trikot: 75,00 brutto -> line_item.total 63,03 + total_tax 11,97
const trikot = (nr, steuer = 11.97) => { const r = Array(KOPF.length).fill(''); Object.assign(r, { 0: 'FP-901', 1: '01.12.2026', 2: String(nr), 3: 'Muster-Trikot', 4: 0, 5: 1, 14: 'offen',
  15: '777', 17: 'Trikots', 18: 30, 19: 0, 20: 63.03, 21: 1.5, 26: String(nr * 10) }); r[27] = steuer; return r; };

describe('Brutto je Kategorie = bezahltes Brutto', () => {
  const rows = Array.from({ length: 40 }, (_, i) => trikot(1000 + i));
  test('40 x Brutto 75,00 -> 3.000,00 (nicht 3.000,23 aus Netto x 1,19)', () => {
    const { produkteGruppen } = aggregateFpVerkaeufe(rows, vh);
    expect(produkteGruppen[0].vkBrutto).toBe(3000);
    expect(Math.round(produkteGruppen[0].vkNetto * 1.19 * 100) / 100).toBe(3000.23);   // so war es bisher
  });
  test('Gutschrift: Verkaufszeile 3.000,00, Rest als eigene Zeile "Rundungsdifferenz", Summe = Abrechnung auf den Cent', () => {
    const { produkteGruppen, summen } = aggregateFpVerkaeufe(rows, vh);
    const brutto = Math.round(summen.auszahlung * 1.19 * 100) / 100;   // wie fpAbrechnungErstellen (ohne Porto/Intern/Verpackung)
    const a = { id: 'FPA-0099', partnerId: 'FP-901', von: '01.12.2026', bis: '31.12.2026', brutto, status: 'freigegeben',
      positionen: JSON.stringify({ produkteGruppen, summen, intern: [], interneSumme: 0 }) };
    const p = gutschriftPlan({ abrechnung: a, mwstProzent: 19, kontaktId: '11111111-2222-4333-8444-555555555555', voucherDate: 'D' });
    expect(p.probleme).toEqual([]);
    expect(p.zeilen.find(z => z.art === 'verkauf')).toMatchObject({ name: 'Trikots', cent: 300000 });
    const rundung = p.zeilen.find(z => z.art === 'rundung');
    expect(rundung).toMatchObject({ name: 'Rundungsdifferenz' });
    expect(Math.abs(rundung.cent)).toBeLessThan(100);
    expect(p.summen.brutto).toBe(Math.round(brutto * 100));
    expect(p.payload.lineItems.find(x => x.name === 'Trikots')).toMatchObject({ quantity: 40, unitPrice: { grossAmount: 75 } });
  });
  test('Altzeilen ohne VK-Steuer (oder gemischt): wie bisher, kein vkBrutto, keine Rundungszeile', () => {
    const alt = rows.map(r => { const x = [...r]; x[27] = ''; return x; });
    expect(aggregateFpVerkaeufe(alt, vh).produkteGruppen[0].vkBrutto).toBeUndefined();
    const gemischt = [...rows.slice(0, 39), alt[39]];
    expect(aggregateFpVerkaeufe(gemischt, vh).produkteGruppen[0].vkBrutto).toBeUndefined();
    const { produkteGruppen, summen } = aggregateFpVerkaeufe(alt, vh);
    const a = { id: 'FPA-0098', partnerId: 'FP-901', von: '01.12.2026', bis: '31.12.2026', brutto: Math.round(summen.auszahlung * 1.19 * 100) / 100,
      status: 'freigegeben', positionen: JSON.stringify({ produkteGruppen, summen, intern: [], interneSumme: 0 }) };
    const p = gutschriftPlan({ abrechnung: a, mwstProzent: 19, kontaktId: '11111111-2222-4333-8444-555555555555', voucherDate: 'D' });
    expect(p.zeilen.some(z => z.art === 'rundung')).toBe(false);
  });
  test('Umsatz im Portal (PD2): mit Steuer das bezahlte Brutto', () => {
    const r = fpBetragsUebersicht({ header: KOPF, rows, partnerId: 'FP-901', heute: '2026-12-15', mwstProzent: 19 });
    expect(r.umsatzJahr).toBe(3000);
    expect(r.top10[0]).toMatchObject({ name: 'Muster-Trikot', stueck: 40, umsatz: 3000 });
  });
});

describe('Sync schreibt die Steuer je Position (Spalte AB)', () => {
  const k = { mwstProzent: 19, paypalProzent: 0, paypalPauschale: 0, portoB: 0, portoP: 0, versandnebenkostenB: 0, versandnebenkostenP: 0 };
  const order = { id: 5001, date_created: '2026-12-01T10:00:00', shipping_total: '0', shipping_lines: [], line_items: [{ id: 51, product_id: 777, variation_id: 0, quantity: 1, total: '63.03', total_tax: '11.97', name: 'Muster-Trikot' }] };
  const e = { partnerId: 'FP-901', festpreisEK: '', handlingGebuehr: '', versandart: 'P', artikelkategorie: 'Trikots' };
  test('neue Zeile: AB = total_tax', () => {
    const { zeile } = fpVerkaufszeile({ order, item: order.line_items[0], e, k, zuordnungen: new Map() });
    expect(STEUER_INDEX).toBe(27);
    expect(zeile[27]).toBe(11.97);
    expect(zeile[20]).toBe(63.03);
  });
  test('Storno negiert die Steuer (Altzeile ohne Steuer bleibt leer)', () => {
    const z = trikot(5001); z[2] = '5001';
    const [s] = buildFpStornoRows([z], [{ id: 5001, date_created: '2026-12-02T09:00:00' }]);
    expect(s[27]).toBe(-11.97);
    expect(s[20]).toBe(-63.03);
    const alt = [...z]; alt[27] = '';
    expect(buildFpStornoRows([alt], [{ id: 5001, date_created: '2026-12-02T09:00:00' }])[0][27]).toBeUndefined();
  });
  test('Teilerstattung: Steuer anteilig', () => {
    const z = trikot(5002); z[2] = '5002'; z[5] = 2; z[20] = 126.06; z[27] = 23.94; z[26] = '52';
    const order2 = { id: 5002, line_items: [{ id: 52, product_id: 777, variation_id: 0, quantity: 2, total: '126.06', name: 'Muster-Trikot' }] };
    const refunds = [{ id: 9, date_created: '2026-12-03T09:00:00', line_items: [{ product_id: 777, variation_id: 0, quantity: -1, total: '-63.03', meta_data: [{ key: '_refunded_item_id', value: '52' }] }], shipping_lines: [] }];
    const { rows } = buildFpErstattungRows({ vRows: [z], vh, bestellungen: [{ order: order2, refunds }], mwstFuer: () => 19, stornoMarker: 'Storniert/Rückerstattet' });
    expect(rows).toHaveLength(1);
    expect(rows[0][27]).toBe(-11.97);
  });
});

describe('Nachtrag fuer offene Zeilen', () => {
  test('nur offene Zeilen mit Positions-ID und leerer Steuer; anteilig, Vorzeichen wie VK-Netto', () => {
    const z = (st, vk, pos, steuer = '') => { const r = trikot(6000); r[2] = '6000'; r[14] = st; r[20] = vk; r[26] = pos; r[27] = steuer; return r; };
    const zeilen = [z('offen', 63.03, '61'), z('offen', -63.03, '61'), z('abgerechnet', 63.03, '61'), z('offen', 63.03, '61', 11.97), z('offen', 63.03, ''), z('offen', 63.03, '99')];
    zeilen.forEach((r, i) => { r._zeile = i + 2; });
    const best = new Map([['6000', { line_items: [{ id: 61, total: '63.03', total_tax: '11.97' }] }]]);
    const p = vkSteuerPlan({ kopf: KOPF, zeilen, bestellungen: best });
    expect(p.plan.map(x => [x.zeile, x.wert])).toEqual([[2, 11.97], [3, -11.97]]);
    expect(p).toMatchObject({ nichtOffen: 1, schonDa: 1, ohnePosition: 1, ohneShop: 1 });
  });
});
