// NB1 Teil A: Teilerstattungen – reine Logik (utils/teilerstattung.js)
import { berechneTeilerstattung } from '../utils/teilerstattung.js';

const item = (id, product_id, quantity, variation_id = 0) => ({ id, product_id, variation_id, quantity });

describe('berechneTeilerstattung', () => {
  test('Teilmenge: 1 von 3 erstattet -> Gegenbuchung 1, Faktor 1/3', () => {
    const r = berechneTeilerstattung({
      items: [item(10, 500, 3)],
      refunds: [{ id: 900, lines: [{ product_id: 500, variation_id: 0, quantity: -1 }] }],
    });
    expect(r.hinweise).toEqual([]);
    expect(r.buchungen).toHaveLength(1);
    expect(r.buchungen[0]).toMatchObject({ refundId: '900', positionId: '10', menge: 1 });
    expect(r.buchungen[0].faktor).toBeCloseTo(1 / 3);
  });

  test('ganze Position erstattet -> Faktor 1', () => {
    const r = berechneTeilerstattung({
      items: [item(10, 500, 2, 77)],
      refunds: [{ id: 901, lines: [{ product_id: 500, variation_id: 77, quantity: -2 }] }],
    });
    expect(r.buchungen[0]).toMatchObject({ menge: 2, faktor: 1 });
  });

  test('mehrere Erstattungen derselben Position werden nie ueber die Originalmenge gebucht', () => {
    const r = berechneTeilerstattung({
      items: [item(10, 500, 3)],
      refunds: [
        { id: 1, lines: [{ product_id: 500, quantity: -2 }] },
        { id: 2, lines: [{ product_id: 500, quantity: -2 }] },
      ],
    });
    expect(r.buchungen.map(b => b.menge)).toEqual([2, 1]);
  });

  test('Wiederholungslauf: schon gegenbuchte Menge und Erstattung werden nicht erneut gebucht', () => {
    const args = {
      items: [item(10, 500, 3)],
      refunds: [{ id: 900, lines: [{ product_id: 500, quantity: -1 }] }],
    };
    const erster = berechneTeilerstattung(args);
    const zweiter = berechneTeilerstattung({
      ...args,
      gebucht: new Map([['10', 1]]),
      gebuchteRefunds: new Set(['900|10']),
    });
    expect(erster.buchungen).toHaveLength(1);
    expect(zweiter.buchungen).toEqual([]);
    expect(zweiter.hinweise).toEqual([]);
  });

  test('Erstattung ohne Position -> nur Hinweis, nichts gebucht', () => {
    const r = berechneTeilerstattung({
      items: [item(10, 500, 1)],
      refunds: [{ id: 902, lines: [] }],
    });
    expect(r.buchungen).toEqual([]);
    expect(r.hinweise).toEqual([{ refundId: '902', grund: 'ohne_position' }]);
  });

  test('Position unbekannt -> Hinweis "unbekannt", nicht geraten', () => {
    const r = berechneTeilerstattung({
      items: [item(10, 500, 1)],
      refunds: [{ id: 903, lines: [{ product_id: 999, quantity: -1 }] }],
    });
    expect(r.buchungen).toEqual([]);
    expect(r.hinweise[0]).toMatchObject({ refundId: '903', grund: 'unbekannt' });
  });

  test('gleiche Produkt-ID zweimal in der Bestellung -> mehrdeutig, nichts gebucht', () => {
    const r = berechneTeilerstattung({
      items: [item(10, 500, 1), item(11, 500, 1)],
      refunds: [{ id: 904, lines: [{ product_id: 500, quantity: -1 }] }],
    });
    expect(r.buchungen).toEqual([]);
    expect(r.hinweise[0]).toMatchObject({ grund: 'mehrdeutig' });
  });

  test('Menge der Erstattung wird auf den Rest der Position begrenzt', () => {
    const r = berechneTeilerstattung({
      items: [item(10, 500, 2)],
      refunds: [{ id: 905, lines: [{ product_id: 500, quantity: -5 }] }],
    });
    expect(r.buchungen[0].menge).toBe(2);
  });

  test('Versanderstattung ohne Position ist ein Hinweis, Positionen daneben bleiben buchbar', () => {
    const r = berechneTeilerstattung({
      items: [item(10, 500, 1)],
      refunds: [
        { id: 906, lines: [] },
        { id: 907, lines: [{ product_id: 500, quantity: -1 }] },
      ],
    });
    expect(r.hinweise).toEqual([{ refundId: '906', grund: 'ohne_position' }]);
    expect(r.buchungen.map(b => b.refundId)).toEqual(['907']);
  });
});
