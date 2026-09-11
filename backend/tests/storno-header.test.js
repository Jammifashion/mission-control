// B3: buildStornoRows mischte Header-Aufloesung und feste Spaltenindizes.
//
// ordIdx/artIdx/varIdx/pIdx kamen aus vh(), NEG_COLS/STATUS_COL/DATE_COL/
// STORNO_COL waren fest verdrahtet. Solange die Kopfzeile unveraendert bleibt,
// stimmt beides. Wird eine Spalte eingefuegt, wandern die vh()-Lookups mit, die
// festen Indizes nicht: die Gegenbuchung negiert dann fremde Zellen, Status und
// Storno-Marker landen falsch, und die Duplikaterkennung greift daneben - also
// werden Stornos zusaetzlich doppelt gebucht.

import { buildStornoRows, STORNO_MARKER } from '../utils/sync-logic.js';

// Das echte Layout von Partner_Verkäufe (15 Spalten, gegen das Sheet geprueft).
const HEADER = [
  'Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Stückzahl',
  'VK-Preis-Brutto', 'Lizenzgebühr', 'Status', 'Produkt-ID', 'Gewinn-netto',
  'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status',
];

const NEGATIV = ['Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr',
                 'Gewinn-netto', 'Lizenz-Anteil', 'Anteil-Brutto'];

// Baut eine Verkaufszeile passend zur uebergebenen Kopfzeile.
function zeile(header, werte) {
  const r = new Array(header.length).fill('');
  for (const [spalte, wert] of Object.entries(werte)) {
    const i = header.indexOf(spalte);
    if (i === -1) throw new Error(`Testfehler: Spalte ${spalte} fehlt`);
    r[i] = wert;
  }
  return r;
}

const VERKAUF = {
  'Partner-ID': 'P-001', 'Datum': '02.09.2026', 'Order-ID': '12345',
  'Artikelnummer': 'ART-1', 'Variante': 'M', 'Stückzahl': '2',
  'VK-Preis-Brutto': '49,90', 'Lizenzgebühr': '7,50', 'Status': 'offen',
  'Produkt-ID': '999', 'Gewinn-netto': '12,00', 'Lizenz-Anteil': '3,60',
  'Porto-Saldo': '1,20', 'Anteil-Brutto': '4,28', 'Storno-Status': '',
};

const ORDERS = [{ id: 12345, date_modified: '2026-09-05T10:00:00' }];

const laufen = (header, rows, orders = ORDERS, filter = null) =>
  buildStornoRows(rows, col => header.indexOf(col), orders, filter);

// Liest einen Wert der Gegenbuchung ueber den Spaltennamen.
const feld = (header, row, spalte) => row[header.indexOf(spalte)];

describe('unveraendertes Layout', () => {
  test('negiert genau die Betragsspalten', () => {
    const [gegen] = laufen(HEADER, [zeile(HEADER, VERKAUF)]);
    for (const sp of NEGATIV) {
      expect(feld(HEADER, gegen, sp)).toBeLessThan(0);
    }
  });

  test('Status, Storno-Marker und Datum sitzen richtig', () => {
    const [gegen] = laufen(HEADER, [zeile(HEADER, VERKAUF)]);
    expect(feld(HEADER, gegen, 'Status')).toBe('offen');
    expect(feld(HEADER, gegen, 'Storno-Status')).toBe(STORNO_MARKER);
    expect(feld(HEADER, gegen, 'Datum')).toBe('05.09.2026');
  });

  test('Schluesselspalten bleiben unveraendert', () => {
    const [gegen] = laufen(HEADER, [zeile(HEADER, VERKAUF)]);
    expect(feld(HEADER, gegen, 'Partner-ID')).toBe('P-001');
    expect(feld(HEADER, gegen, 'Order-ID')).toBe('12345');
    expect(feld(HEADER, gegen, 'Artikelnummer')).toBe('ART-1');
    expect(feld(HEADER, gegen, 'Produkt-ID')).toBe('999');
  });

  test('bereits stornierte Zeile wird nicht erneut gebucht', () => {
    const schon = zeile(HEADER, { ...VERKAUF, 'Storno-Status': STORNO_MARKER });
    expect(laufen(HEADER, [schon])).toHaveLength(0);
  });
});

// ── Der eigentliche Befund ──────────────────────────────────────────────────

describe('eingefuegte Spalte verschiebt nichts', () => {
  // Eine neue Spalte an Position 2, wie sie beim Erweitern des Reiters entsteht.
  const VERSCHOBEN = [
    'Partner-ID', 'Datum', 'Shop', 'Order-ID', 'Artikelnummer', 'Variante',
    'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status', 'Produkt-ID',
    'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto',
    'Storno-Status',
  ];
  const VERKAUF_V = { ...VERKAUF, 'Shop': 'jfn' };

  test('negiert weiterhin genau die Betragsspalten', () => {
    const [gegen] = laufen(VERSCHOBEN, [zeile(VERSCHOBEN, VERKAUF_V)]);
    for (const sp of NEGATIV) {
      expect(feld(VERSCHOBEN, gegen, sp)).toBeLessThan(0);
    }
  });

  test('negiert KEINE fremden Spalten', () => {
    const [gegen] = laufen(VERSCHOBEN, [zeile(VERSCHOBEN, VERKAUF_V)]);
    // Produkt-ID ist eine Kennung, kein Betrag - sie darf nie negativ werden.
    expect(feld(VERSCHOBEN, gegen, 'Produkt-ID')).toBe('999');
    expect(feld(VERSCHOBEN, gegen, 'Shop')).toBe('jfn');
    expect(feld(VERSCHOBEN, gegen, 'Partner-ID')).toBe('P-001');
    expect(feld(VERSCHOBEN, gegen, 'Artikelnummer')).toBe('ART-1');
  });

  test('Status und Storno-Marker sitzen in ihren Spalten', () => {
    const [gegen] = laufen(VERSCHOBEN, [zeile(VERSCHOBEN, VERKAUF_V)]);
    expect(feld(VERSCHOBEN, gegen, 'Status')).toBe('offen');
    expect(feld(VERSCHOBEN, gegen, 'Storno-Status')).toBe(STORNO_MARKER);
    expect(feld(VERSCHOBEN, gegen, 'Datum')).toBe('05.09.2026');
  });

  test('die Gegenbuchung ist so breit wie die Kopfzeile', () => {
    const [gegen] = laufen(VERSCHOBEN, [zeile(VERSCHOBEN, VERKAUF_V)]);
    expect(gegen).toHaveLength(VERSCHOBEN.length);
  });

  // Die Duplikaterkennung liest Storno-Status. Auf dem falschen Index sieht sie
  // dort einen leeren Wert und bucht denselben Storno erneut.
  test('bereits stornierte Zeile wird auch verschoben nicht doppelt gebucht', () => {
    const schon = zeile(VERSCHOBEN, { ...VERKAUF_V, 'Storno-Status': STORNO_MARKER });
    expect(laufen(VERSCHOBEN, [schon])).toHaveLength(0);
  });
});

describe('fehlende Pflichtspalte', () => {
  test('wirft, statt auf Index -1 zu schreiben', () => {
    const ohneStorno = HEADER.filter(h => h !== 'Storno-Status');
    expect(() => laufen(ohneStorno, [zeile(ohneStorno, { ...VERKAUF, 'Storno-Status': undefined })]))
      .toThrow(/Storno-Status/);
  });
});
