// FIX3: Backup-Rueckweg - Fallen erkennen, Ziel pruefen, vergleichen. Nur erfundene Werte.
import { falle, analyse, vergleiche, zielPruefen, spalte } from '../utils/backup-restore.js';

describe('falle', () => {
  test.each([
    ['1.234,50', 'zahl_text'], ['12,5', 'zahl_text'], ['19 %', 'zahl_text'], ['4,90 €', 'zahl_text'], ['-3,20', 'zahl_text'],
    ['12', 'zahl_text'], ['1234567890', 'zahl_text'],
    ['03581', 'fuehrende_null'], ['0123456789', 'fuehrende_null'],
    ['01.10.2026', 'datum'], ['2026-10-01', 'datum'], ['2026-11-19T18:53:18.838Z', 'datum'], ['3-4', 'datum'], ['01.10.2026 14:05', 'datum'],
  ])('%p -> %p', (w, f) => expect(falle(w)).toBe(f));
  test.each(['Text', 'P-001', 'AU-2026-0001', '', 'ja', 'E3000'])('%p -> keine Falle', w => expect(falle(w)).toBeNull());
});

test('analyse: je Reiter Zeilen, Zellen, Fallen, Beispiel-Adressen ohne Werte', () => {
  const r = analyse({ tabs: { A: [['Kopf', 'Preis'], ['03581', '1,50'], ['x', '01.10.2026']] } });
  expect(r).toEqual([{ titel: 'A', zeilen: 3, zellen: 6, fallen: { zahl_text: 1, fuehrende_null: 1, datum: 1 },
    beispiele: { zahl_text: ['B2'], fuehrende_null: ['A2'], datum: ['B3'] } }]);
});

test('vergleiche: Abweichungen nach Falle', () => {
  const v = vergleiche([['03581', '1,50', 'Text', 'neu']], [['3581', '1,5', 'Text', 'anders']]);
  expect(v).toEqual({ gleich: 1, abweichungen: { zahl_text: 1, fuehrende_null: 1, datum: 0, sonst: 1 }, beispiele: ['A1', 'B1', 'D1'] });
});

describe('zielPruefen', () => {
  test('Original verweigert', () => expect(zielPruefen({ zielId: 'orig', originale: ['orig', 'b'], reiter: [] })).toMatch(/Original/));
  test('nicht leer verweigert', () => expect(zielPruefen({ zielId: 'neu', originale: ['orig'], reiter: [{ titel: 'Tabelle1', zellen: 3 }] })).toMatch(/nicht leer/));
  test('leer ok', () => expect(zielPruefen({ zielId: 'neu', originale: ['orig'], reiter: [{ titel: 'Tabelle1', zellen: 0 }] })).toBeNull());
  test('fehlt', () => expect(zielPruefen({ zielId: '', originale: [] })).toMatch(/fehlt/));
});

test('spalte', () => expect([0, 25, 26, 27].map(spalte)).toEqual(['A', 'Z', 'AA', 'AB']));
