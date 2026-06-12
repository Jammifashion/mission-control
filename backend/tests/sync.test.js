import { buildStornoRows, WC_STATES_VERKAUF, WC_STATES_STORNO, STORNO_MARKER } from '../utils/sync-logic.js';

// ── Spalten-Layout (A:O, identisch zum Append in partnerPortal) ───────────────
// 0=Partner-ID, 1=Datum, 2=Order-ID, 3=Artikelnummer, 4=Variante,
// 5=Stückzahl, 6=VK-Netto, 7=Lizenzgebühr, 8=Status, 9=Produkt-ID,
// 10=GewinnNetto, 11=LizenzAnteil, 12=PortoSaldo, 13=Brutto, 14=Storno-Status
const HEADER = [
  'Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante',
  'Stückzahl', 'VK-Netto', 'Lizenzgebühr', 'Status', 'Produkt-ID',
  'GewinnNetto', 'LizenzAnteil', 'PortoSaldo', 'Brutto', 'Storno-Status',
];
const vh = col => HEADER.indexOf(col);

function makeRow(overrides = {}) {
  const base = ['P-001', '01.06.2026', '12345', 'Shirt', '0', '2', '50', '15', 'offen', '999', '30', '9', '2', '17.85', ''];
  return Object.assign([...base], overrides);
}

const STORNO_ORDER = [{ id: '12345', date_modified: '2026-06-05T10:00:00Z', date_created: '2026-05-01T00:00:00Z' }];

// ── WC-Status-Konstanten ──────────────────────────────────────────────────────

describe('WC_STATES_VERKAUF', () => {
  test('enthält processing, completed und on-hold', () => {
    expect(WC_STATES_VERKAUF).toContain('processing');
    expect(WC_STATES_VERKAUF).toContain('completed');
    expect(WC_STATES_VERKAUF).toContain('on-hold');
  });

  test('enthält kein cancelled oder refunded', () => {
    expect(WC_STATES_VERKAUF).not.toContain('cancelled');
    expect(WC_STATES_VERKAUF).not.toContain('refunded');
  });
});

describe('WC_STATES_STORNO', () => {
  test('enthält cancelled und refunded', () => {
    expect(WC_STATES_STORNO).toContain('cancelled');
    expect(WC_STATES_STORNO).toContain('refunded');
  });

  test('enthält kein processing oder completed', () => {
    expect(WC_STATES_STORNO).not.toContain('processing');
    expect(WC_STATES_STORNO).not.toContain('completed');
  });
});

// ── Dedup-Key ─────────────────────────────────────────────────────────────────

describe('Dedup-Key – verhindert doppelte Einträge', () => {
  test('gleicher Order+Artikel+Variante+Partner wird nicht ein zweites Mal erfasst', () => {
    const varKey = v => (v === '' || v === null || v === undefined) ? '0' : String(v);
    const row = makeRow();
    const existingKeys = new Set([
      `${row[vh('Order-ID')]}|${row[vh('Artikelnummer')]}|${varKey(row[vh('Variante')])}|${row[vh('Partner-ID')]}`,
    ]);

    const dupKey = `12345|Shirt|0|P-001`;
    expect(existingKeys.has(dupKey)).toBe(true);
  });

  test('andere Order-ID ist kein Duplikat', () => {
    const existingKeys = new Set(['12345|Shirt|0|P-001']);
    expect(existingKeys.has('99999|Shirt|0|P-001')).toBe(false);
  });

  test('buildStornoRows: kein Gegeneintrag wenn Storno bereits vorhanden', () => {
    const alreadyStorno = makeRow({ 14: STORNO_MARKER });
    const result = buildStornoRows([alreadyStorno], vh, STORNO_ORDER, null);
    expect(result).toHaveLength(0);
  });
});

// ── buildStornoRows – Gegenbuchung ────────────────────────────────────────────

describe('buildStornoRows – negative Gegenbuchung', () => {
  test('erzeugt einen Gegeneintrag für cancelled/refunded Order', () => {
    const row = makeRow();
    const result = buildStornoRows([row], vh, STORNO_ORDER, null);
    expect(result).toHaveLength(1);
  });

  test('monetäre Spalten werden negiert (NEG_COLS)', () => {
    const row = makeRow();
    const [storno] = buildStornoRows([row], vh, STORNO_ORDER, null);
    // Stückzahl (5), VK-Netto (6), Lizenzgebühr (7) → negiert
    expect(storno[5]).toBe(-2);
    expect(storno[6]).toBe(-50);
    expect(storno[7]).toBe(-15);
    // GewinnNetto (10), LizenzAnteil (11), PortoSaldo (12), Brutto (13)
    expect(storno[10]).toBe(-30);
    expect(storno[11]).toBe(-9);
    expect(storno[12]).toBe(-2);
    expect(storno[13]).toBeCloseTo(-17.85, 2);
  });

  test('Status bleibt "offen", Storno-Marker gesetzt', () => {
    const [storno] = buildStornoRows([makeRow()], vh, STORNO_ORDER, null);
    expect(storno[8]).toBe('offen');
    expect(storno[14]).toBe(STORNO_MARKER);
  });

  test('Datum wird auf Rückerstattungsdatum gesetzt', () => {
    const [storno] = buildStornoRows([makeRow()], vh, STORNO_ORDER, null);
    expect(storno[1]).toBe('05.06.2026');
  });

  test('kein Gegeneintrag für Orders die nicht storniert sind', () => {
    const result = buildStornoRows([makeRow()], vh, [{ id: '99999', date_modified: '2026-06-05T10:00:00Z' }], null);
    expect(result).toHaveLength(0);
  });

  test('partnerFilter schließt anderen Partner aus', () => {
    const row = makeRow(); // Partner-ID = 'P-001'
    const result = buildStornoRows([row], vh, STORNO_ORDER, new Set(['P-002']));
    expect(result).toHaveLength(0);
  });

  test('zweiter Sync erzeugt keinen doppelten Gegeneintrag', () => {
    const row = makeRow();
    const [stornoRow] = buildStornoRows([row], vh, STORNO_ORDER, null);
    // Beim zweiten Aufruf liegt der Gegeneintrag bereits in vRows
    const result = buildStornoRows([row, stornoRow], vh, STORNO_ORDER, null);
    expect(result).toHaveLength(0);
  });
});

// ── _sheetRow – Regression ────────────────────────────────────────────────────

describe('_sheetRow – gesetzt VOR filter() (Regression)', () => {
  // Zeigt den Bug: wenn _sheetRow NACH filter() gesetzt wird, haben Zeilen nach
  // Leerzeilen falsche Row-Indices und Status-Updates treffen die falsche Sheet-Zeile.

  const rawRows = [
    ['ORD-1', 'Shirt', '1'],   // Originalzeile 2
    [],                          // Originalzeile 3: leer
    ['ORD-2', 'Pants', '1'],   // Originalzeile 4
  ];

  test('korrekt: _sheetRow widerspiegelt Originalzeile auch nach Leerzeilen', () => {
    const rows = rawRows.map((r, i) => { r._sheetRow = i + 2; return r; });
    const filtered = rows.filter(r => r.some(c => c));

    expect(filtered).toHaveLength(2);
    expect(filtered[0]._sheetRow).toBe(2);
    expect(filtered[1]._sheetRow).toBe(4); // nicht 3!
  });

  test('bug-demo: _sheetRow NACH filter() wäre falsch für Zeile nach Leerzeile', () => {
    const filtered = rawRows.filter(r => r.some(c => c));
    filtered.forEach((r, i) => { r._sheetRow = i + 2; });

    // Falsche Implementierung gibt 3 statt 4 zurück
    expect(filtered[1]._sheetRow).toBe(3);
  });
});
