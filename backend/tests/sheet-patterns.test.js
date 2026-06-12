// Tier-2 – Kritische Sheet-Schreib/Lese-Patterns isoliert (kein HTTP, kein Mock).
// Importiert nur module ohne externe Abhängigkeiten.

import { WC_STATES_VERKAUF, WC_STATES_STORNO } from '../utils/sync-logic.js';

// ── Header-basiertes Lesen ─────────────────────────────────────────────────────

describe('Header-basiertes Lesen', () => {
  const header = ['Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Einzelpreis', 'Status'];
  const h = col => header.indexOf(col);

  test('h() gibt korrekten Index zurück', () => {
    expect(h('Partner-ID')).toBe(0);
    expect(h('Datum')).toBe(1);
    expect(h('Status')).toBe(5);
  });

  test('unbekannte Spalte gibt -1 (kein stiller Fehler)', () => {
    expect(h('Unbekannte-Spalte')).toBe(-1);
    expect(h('')).toBe(-1);
  });

  test('Zellwert über Index korrekt gelesen', () => {
    const row = ['P-001', '12.06.2026', 'T-Shirts', '50', '9.90', 'offen'];
    expect(row[h('Partner-ID')]).toBe('P-001');
    expect(row[h('Anzahl')]).toBe('50');
    expect(row[h('Status')]).toBe('offen');
  });

  test('h("Unbekannt") → -1 schützt vor falschem Spaltenzugriff', () => {
    const row = ['P-001', '12.06.2026', 'T-Shirts'];
    const val = row[h('Nicht-Existente-Spalte')];
    // row[-1] ist undefined in JavaScript
    expect(val).toBeUndefined();
  });
});

// ── VISIBLE-Filter (freigegeben + bezahlt) ────────────────────────────────────

describe('VISIBLE-Filter Abrechnungen', () => {
  const VISIBLE = new Set(['freigegeben', 'bezahlt']);

  test('freigegeben passiert den Filter', () => {
    expect(VISIBLE.has('freigegeben')).toBe(true);
  });

  test('bezahlt passiert den Filter', () => {
    expect(VISIBLE.has('bezahlt')).toBe(true);
  });

  test('entwurf wird herausgefiltert', () => {
    expect(VISIBLE.has('entwurf')).toBe(false);
  });

  test('Filter auf Array: nur sichtbare Abrechnungen durchgelassen', () => {
    const abrechnungen = [
      { id: 'AB-001', status: 'freigegeben' },
      { id: 'AB-002', status: 'entwurf' },
      { id: 'AB-003', status: 'bezahlt' },
      { id: 'AB-004', status: 'entwurf' },
    ];
    const sichtbar = abrechnungen.filter(a => VISIBLE.has(a.status));
    expect(sichtbar).toHaveLength(2);
    expect(sichtbar.map(a => a.id)).toEqual(['AB-001', 'AB-003']);
  });
});

// ── Kanal-Filter ──────────────────────────────────────────────────────────────

describe('Kanal-Filter interne Bestellungen', () => {
  const eintraege = [
    { kanal: 'Portal',   bezeichnung: 'T-Shirts 50 Stk' },
    { kanal: 'Manuell',  bezeichnung: 'Hoodies 20 Stk' },
    { kanal: 'Portal',   bezeichnung: 'Caps 30 Stk' },
    { kanal: 'Manuell',  bezeichnung: 'Jacken 10 Stk' },
  ];

  test('nur Portal-Einträge nach Kanal-Filter', () => {
    const portal = eintraege.filter(e => e.kanal === 'Portal');
    expect(portal).toHaveLength(2);
    expect(portal.every(e => e.kanal === 'Portal')).toBe(true);
  });

  test('Manuell-Einträge werden herausgefiltert', () => {
    const portal = eintraege.filter(e => e.kanal === 'Portal');
    expect(portal.some(e => e.kanal === 'Manuell')).toBe(false);
  });
});

// ── WC_STATES Konstanten ──────────────────────────────────────────────────────

describe('WC_STATES_VERKAUF + WC_STATES_STORNO', () => {
  test('keine Überschneidung zwischen VERKAUF und STORNO', () => {
    const overlap = WC_STATES_VERKAUF.filter(s => WC_STATES_STORNO.includes(s));
    expect(overlap).toHaveLength(0);
  });

  test('alle relevanten WC-Status sind in einer der beiden Gruppen', () => {
    const all = new Set([...WC_STATES_VERKAUF, ...WC_STATES_STORNO]);
    expect(all.has('processing')).toBe(true);
    expect(all.has('completed')).toBe(true);
    expect(all.has('on-hold')).toBe(true);
    expect(all.has('cancelled')).toBe(true);
    expect(all.has('refunded')).toBe(true);
  });
});

// ── Platzhalter-Auflösung ─────────────────────────────────────────────────────

describe('Platzhalter-Auflösung im System-Prompt', () => {
  // Lokale Nachbildung der resolvePlaceholders-Logik aus agentWissenHelper.js
  function resolvePlaceholders(geruest, bloecke) {
    const map = {
      '{{PRODUKTINFOS}}':     bloecke.produktinfos,
      '{{STAFFELPREISE}}':    bloecke.staffelpreise,
      '{{TONALITAET}}':       bloecke.tonalitaet,
      '{{ALLGEMEINE_INFOS}}': bloecke.allgemeineInfos,
    };
    return Object.entries(map).reduce(
      (t, [ph, val]) => t.split(ph).join(val),
      geruest
    );
  }

  const BLOECKE = {
    produktinfos:    'T-Shirts, Hoodies, Caps',
    staffelpreise:   'ab 10 Stück: 9.90 EUR',
    tonalitaet:      'freundlich und professionell',
    allgemeineInfos: 'Lieferzeit 5–7 Werktage',
  };

  test('alle vier Platzhalter werden vollständig ersetzt', () => {
    const geruest =
      '{{PRODUKTINFOS}}\n{{STAFFELPREISE}}\n{{TONALITAET}}\n{{ALLGEMEINE_INFOS}}';
    const result = resolvePlaceholders(geruest, BLOECKE);
    expect(result).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  test('Inhalte aus bloecke erscheinen im aufgelösten Prompt', () => {
    const geruest = 'Produkte: {{PRODUKTINFOS}} | Preise: {{STAFFELPREISE}}';
    const result = resolvePlaceholders(geruest, BLOECKE);
    expect(result).toContain('T-Shirts, Hoodies, Caps');
    expect(result).toContain('ab 10 Stück: 9.90 EUR');
  });

  test('fehlender Platzhalter im gerüst lässt anderen Inhalt unberührt', () => {
    const geruest = 'Nur: {{PRODUKTINFOS}}';
    const result = resolvePlaceholders(geruest, BLOECKE);
    expect(result).toBe('Nur: T-Shirts, Hoodies, Caps');
    expect(result).not.toContain('{{');
  });
});
