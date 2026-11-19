// NB1 Teil A: Gegenbuchungen je Erstattung im Lizenz-Verkaeufe-Reiter und das Ganz-Storno danach.
// Nur erfundene Werte.
import { buildErstattungRows } from '../utils/teilerstattung.js';
import { buildStornoRows, STORNO_MARKER } from '../utils/sync-logic.js';

const KOPF = ['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr',
  'Status', 'Produkt-ID', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status', 'Sperre', 'Positions-ID'];
const vh = c => KOPF.indexOf(c);
const S = vh;
// Altzeilen ohne Positions-ID (wie die gemessenen), deutsches Zahlenformat wie aus dem Sheet.
const zeile = (art, vari, stueck, vk, liz, gew, la, porto, brutto, status = 'offen', pid = 'P-1') =>
  [pid, '01.10.2026', '500', art, String(vari), String(stueck), vk, liz, status, '10', gew, la, porto, brutto, '', '', ''];
const ORDER = {
  id: 500, date_created: '2026-10-01T10:00:00', shipping_total: '6.00',
  line_items: [
    { id: 1, name: 'Shirt', product_id: 10, variation_id: 11, quantity: 2, total: '20.00' },
    { id: 2, name: 'Cap',   product_id: 20, variation_id: 21, quantity: 1, total: '10.00' },
  ],
};
const refPos = (id, item, qty) => ({ id, date_created: '2026-10-05T09:00:00', line_items: [
  { product_id: item.product_id, variation_id: item.variation_id, quantity: -qty, total: '-1', meta_data: [{ key: '_refunded_item_id', value: String(item.id) }] },
], shipping_lines: [] });
const refVersand = id => ({ id, date_created: '2026-10-06T09:00:00', line_items: [], shipping_lines: [{ total: '-6.00' }] });
const lauf = (vRows, refunds, extra = {}) => buildErstattungRows({
  vRows, vh, bestellungen: [{ order: ORDER, refunds }], portoFaktor: () => 0.5, mwstFuer: () => 19, stornoMarker: STORNO_MARKER, ...extra,
});
const BASIS = [
  zeile('Shirt', 11, 2, '20,00', '4,00', '8,00', '2,00', '1,50', '4,76'),
  zeile('Cap', 21, 1, '10,00', '2,00', '4,00', '1,00', '0,75', '2,38'),
];
const betraege = z => ['Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto'].map(c => z[S(c)]);

describe('buildErstattungRows (Lizenz)', () => {
  test('Teilmenge 1 von 2: Betraege halbiert negiert, Marke mit Refund-ID, Datum der Erstattung', () => {
    const { rows, hinweise } = lauf(BASIS, [refPos(900, ORDER.line_items[0], 1)]);
    expect(hinweise).toEqual([]);
    expect(rows).toHaveLength(1);
    const z = rows[0];
    expect(betraege(z)).toEqual([-1, -10, -2, -4, -1, -0.75, -2.38]);
    expect(z[S('Storno-Status')]).toBe('Erstattung #900');
    expect(z[S('Datum')]).toBe('05.10.2026');
    expect(z[S('Status')]).toBe('offen');
    expect(z[S('Artikelnummer')]).toBe('Shirt');
  });

  test('Wiederholungslauf bucht nichts doppelt', () => {
    const erster = lauf(BASIS, [refPos(900, ORDER.line_items[0], 1)]);
    expect(lauf([...BASIS, ...erster.rows], [refPos(900, ORDER.line_items[0], 1)]).rows).toEqual([]);
  });

  test('zweite Erstattung derselben Position bucht nur den Rest', () => {
    const erster = lauf(BASIS, [refPos(900, ORDER.line_items[0], 1)]);
    const zweiter = lauf([...BASIS, ...erster.rows], [refPos(900, ORDER.line_items[0], 1), refPos(901, ORDER.line_items[0], 2)]);
    expect(zweiter.rows).toHaveLength(1);
    expect(zweiter.rows[0][S('Stückzahl')]).toBe(-1);
    expect(zweiter.rows[0][S('Storno-Status')]).toBe('Erstattung #901');
    expect(zweiter.hinweise.map(h => h.grund)).toEqual(['mehr_als_rest']);
  });

  test('Versanderstattung mindert Porto-Saldo und Lizenzgebuehr je Zeile nach Wertanteil (50/50), Brutto mit MwSt', () => {
    const { rows } = lauf(BASIS, [refVersand(902)]);
    expect(rows).toHaveLength(2);
    expect(betraege(rows[0])).toEqual([0, 0, -2, 0, 0, -2, -2.38]);    // 6 x 2/3 x 1/2
    expect(betraege(rows[1])).toEqual([0, 0, -1, 0, 0, -1, -1.19]);    // 6 x 1/3 x 1/2
    expect(rows[0][S('Storno-Status')]).toBe('Versanderstattung #902');
    expect(rows[0][S('Datum')]).toBe('06.10.2026');
    expect(lauf([...BASIS, ...rows], [refVersand(902)]).rows).toEqual([]);
  });

  test('partner-traegt: voller Porto-Anteil', () => {
    const { rows } = lauf(BASIS, [refVersand(903)], { portoFaktor: () => 1 });
    expect(rows.map(r => r[S('Porto-Saldo')])).toEqual([-4, -2]);
  });

  test('Erstattung einer fremden Position (keine Partner-Zeile) bucht nichts und meldet nichts', () => {
    const { rows, hinweise } = lauf([BASIS[0]], [refPos(904, ORDER.line_items[1], 1)]);
    expect(rows).toEqual([]);
    expect(hinweise).toEqual([]);
  });

  test('Zeile mit Positions-ID wird ueber die ID gefunden', () => {
    const mitPos = [...BASIS[0]]; mitPos[S('Positions-ID')] = '1'; mitPos[S('Artikelnummer')] = 'anderer Name';
    const { rows } = lauf([mitPos], [refPos(911, ORDER.line_items[0], 2)]);
    expect(rows).toHaveLength(1);
    expect(rows[0][S('Positions-ID')]).toBe('1');
    expect(rows[0][S('Lizenzgebühr')]).toBe(-4);
  });

  test('gesperrte Ursprungszeile: nichts gebucht, Hinweis', () => {
    const gesperrt = zeile('Shirt', 11, 2, '20,00', '', '', '', '', '', 'gesperrt');
    const { rows, hinweise } = lauf([gesperrt], [refPos(905, ORDER.line_items[0], 1), refVersand(906)]);
    expect(rows).toEqual([]);
    expect(hinweise.map(h => h.grund)).toEqual(['gesperrt', 'gesperrt']);
  });

  test('abgerechnete Ursprungszeile: Gegenbuchung offen + Hinweis Nachzuegler', () => {
    const abg = zeile('Shirt', 11, 2, '20,00', '4,00', '8,00', '2,00', '1,50', '4,76', 'abgerechnet');
    const { rows, hinweise } = lauf([abg], [refPos(907, ORDER.line_items[0], 2)]);
    expect(rows[0][S('Status')]).toBe('offen');
    expect(rows[0][S('Lizenzgebühr')]).toBe(-4);
    expect(hinweise).toEqual([expect.objectContaining({ grund: 'nachzuegler', refundId: '907' })]);
  });

  test('Erstattung ohne Position und ohne Versand -> Hinweis, nichts gebucht', () => {
    const { rows, hinweise } = lauf(BASIS, [{ id: 908, date_created: '2026-10-07T09:00:00', line_items: [], shipping_lines: [] }]);
    expect(rows).toEqual([]);
    expect(hinweise.map(h => h.grund)).toEqual(['ohne_position']);
  });

  test('ganz stornierte Position bekommt keine Teilerstattung', () => {
    const storno = [...BASIS[0]]; storno[S('Storno-Status')] = STORNO_MARKER; storno[S('Stückzahl')] = '-2';
    expect(lauf([BASIS[0], storno], [refPos(909, ORDER.line_items[0], 1)]).rows).toEqual([]);
  });

  test('Partner-Filter: andere Partner bleiben unberuehrt', () => {
    const fremd = zeile('Shirt', 11, 2, '20,00', '4,00', '8,00', '2,00', '1,50', '4,76', 'offen', 'P-2');
    const { rows } = lauf([BASIS[0], fremd], [refPos(912, ORDER.line_items[0], 1)], { partnerFilter: new Set(['P-1']) });
    expect(rows.map(r => r[S('Partner-ID')])).toEqual(['P-1']);
  });
});

describe('Ganz-Storno nach Teilerstattung', () => {
  const st = [{ id: 500, date_created: '2026-10-01', date_modified: '2026-10-10' }];
  const summeNull = zeilen => {
    for (const sp of ['Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto']) {
      const s = zeilen.reduce((a, r) => a + Number(String(r[S(sp)]).replace(',', '.')), 0);
      expect(Math.round(s * 100) / 100).toBe(0);
    }
  };

  test('Storno negiert nur, was noch nicht erstattet ist - Summe je Position 0', () => {
    const teil = lauf(BASIS, [refPos(900, ORDER.line_items[0], 1), refVersand(902)]).rows;
    const out = buildStornoRows([...BASIS, ...teil], vh, st, null);
    expect(out).toHaveLength(2);
    const shirt = out.find(r => r[S('Artikelnummer')] === 'Shirt');
    // Ursprung 2 Stk / 4 Lizenz / 1,5 Porto; erstattet 1 Stk (-2, -0,75) und Versand (-2, -2): Rest 1 / 0 / -1,25
    expect([shirt[S('Stückzahl')], shirt[S('Lizenzgebühr')], shirt[S('Porto-Saldo')]]).toEqual([-1, 0, 1.25]);
    expect(shirt[S('Storno-Status')]).toBe(STORNO_MARKER);
    summeNull([BASIS[0], ...teil.filter(r => r[S('Artikelnummer')] === 'Shirt'), shirt]);
    summeNull([BASIS[1], ...teil.filter(r => r[S('Artikelnummer')] === 'Cap'), out.find(r => r[S('Artikelnummer')] === 'Cap')]);
  });

  test('Teilerstattungs-Zeilen sperren das Storno nicht; Wiederholung bucht kein zweites Storno', () => {
    const teil = lauf(BASIS, [refPos(900, ORDER.line_items[0], 1)]).rows;
    const out = buildStornoRows([...BASIS, ...teil], vh, st, null);
    expect(out).toHaveLength(2);
    expect(buildStornoRows([...BASIS, ...teil, ...out], vh, st, null)).toEqual([]);
  });

  test('ganz per Teilerstattung zurueck: keine leere Storno-Zeile', () => {
    const teil = lauf([BASIS[1]], [refPos(910, ORDER.line_items[1], 1)]).rows;
    expect(buildStornoRows([BASIS[1], ...teil], vh, st, null)).toEqual([]);
  });

  test('ohne Teilerstattung unveraendert: Gegenbuchung = negierte Ursprungszeile', () => {
    const out = buildStornoRows([BASIS[0]], vh, st, null);
    expect(betraege(out[0])).toEqual([-2, -20, -4, -8, -2, -1.5, -4.76]);
  });
});
