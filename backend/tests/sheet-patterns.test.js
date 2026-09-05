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

// ══ Sheet-Audit 05.09.2026 – W1 / R1 / R3 ═══════════════════════════════════
// Import-Deklarationen werden in ESM gehoistet, die Position am Dateiende ist
// zulässig und hält den Audit-Block beisammen.

import {
  findHeader, findHeaderAny, requireHeader, requireHeaderAny, MissingHeaderError,
} from '../utils/sheet-headers.js';
import { buildRow, mergeRow } from '../utils/sheet-rows.js';

// Kopfzeile der Erfassungsmaske, Stand 05.09.2026: 13 Fachspalten + B-Slots.
const ERF_HEADER = [
  'ID', 'Status', 'Status Shop', 'Produkt-ID', 'SEO_Status', 'Produktname',
  'Produktart', 'L-Shop-Artikelnummer', 'Artikelkurzbezeichnung',
  'Artikelnummer', 'Lieferzeit', 'Versandklasse', 'Kategorien',
  'B1_E1', 'B1_V1', 'B1_Preis',
];

// ── R1: exakter Header-Vergleich statt Teilstring ────────────────────────────

describe('R1 – exakter Header-Vergleich', () => {
  test('Artikelnummer trifft J, nicht L-Shop-Artikelnummer (H)', () => {
    expect(findHeader(ERF_HEADER, 'Artikelnummer')).toBe(9);
    expect(ERF_HEADER[findHeader(ERF_HEADER, 'Artikelnummer')]).toBe('Artikelnummer');
  });

  test('der alte Substring-Regex traf nachweislich die falsche Spalte', () => {
    const alt = ERF_HEADER.findIndex(h => /artikelnummer/i.test(h));
    expect(alt).toBe(7);
    expect(ERF_HEADER[alt]).toBe('L-Shop-Artikelnummer');
    expect(alt).not.toBe(findHeader(ERF_HEADER, 'Artikelnummer'));
  });

  test('Auftragsmonitor liefert die interne Nummer, nicht die L-Shop-Nummer', () => {
    const row = [
      'JFN-2026-0042', 'Im Shop', 'Veroeffentlicht', '6807', 'Erledigt',
      'Ugly Sweater Yummy', 'Variabel', 'JH030', 'Ugly-Sweater-Yummy',
      'JH030/Ugly-Sweater-Yummy', 'ca. 5-6 Werktage', 'grossbrief',
      'Ugly Christmas Sweater', '', '', '',
    ];
    const artIdx = findHeader(ERF_HEADER, 'Artikelnummer');
    expect(row[artIdx]).toBe('JH030/Ugly-Sweater-Yummy');
    expect(row[artIdx]).not.toBe('JH030');
  });

  test('L-Shop-Artikelnummer bleibt weiterhin exakt auffindbar', () => {
    expect(findHeader(ERF_HEADER, 'L-Shop-Artikelnummer')).toBe(7);
  });

  test('normalisiert die Schreibweise, matcht aber nie als Teilstring', () => {
    expect(findHeader(ERF_HEADER, 'produkt id')).toBe(3);
    expect(findHeader(ERF_HEADER, 'SEO Status')).toBe(4);
    expect(findHeader(ERF_HEADER, 'nummer')).toBe(-1);
    expect(findHeader(ERF_HEADER, 'Artikel')).toBe(-1);
  });

  test('findHeaderAny nimmt die erste vorhandene Schreibweise', () => {
    expect(findHeaderAny(ERF_HEADER, ['SSOT-ID', 'ID'])).toBe(0);
    expect(findHeaderAny(ERF_HEADER, ['Gibts-Nicht', 'Auch-Nicht'])).toBe(-1);
  });
});

// ── R3: fehlender Pflicht-Header scheitert laut ──────────────────────────────

describe('R3 – fehlender Header wirft statt still zu leeren', () => {
  test('vorhandener Header liefert den Index', () => {
    expect(requireHeader(ERF_HEADER, 'SEO_Status', 'test')).toBe(4);
  });

  test('umbenannter Header wirft MissingHeaderError', () => {
    const umbenannt = ERF_HEADER.map(h => (h === 'SEO_Status' ? 'SEO-Zustand' : h));
    expect(() => requireHeader(umbenannt, 'SEO_Status', 'GET /api/sheets/erfassung/seo-pending'))
      .toThrow(MissingHeaderError);
  });

  test('Fehlermeldung nennt Spaltenname und Endpunkt', () => {
    const umbenannt = ERF_HEADER.map(h => (h === 'Produkt-ID' ? 'WC-ID' : h));
    const ctx = 'GET /api/sheets/erfassung/by-wc-id';
    expect(() => requireHeader(umbenannt, 'Produkt-ID', ctx)).toThrow(/Produkt-ID/);
    expect(() => requireHeader(umbenannt, 'Produkt-ID', ctx)).toThrow(/by-wc-id/);
  });

  test('Fehler traegt status 500 fuer den Express-Errorhandler', () => {
    expect.assertions(2);
    try {
      requireHeader([], 'Status', 'ctx');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingHeaderError);
      expect(err.status).toBe(500);
    }
  });

  test('ohne Guard waere es still ein leerer String geblieben', () => {
    const umbenannt = ERF_HEADER.map(h => (h === 'SEO_Status' ? 'SEO-Zustand' : h));
    const row = ['JFN-2026-0001', 'Entwurf', '', '17152', 'Ausstehend'];
    const stillerIdx = umbenannt.findIndex(h => h === 'SEO_Status');
    expect(stillerIdx).toBe(-1);
    // genau dieses Verhalten faellt mit requireHeader weg
    expect(row[stillerIdx] ?? '').toBe('');
  });

  test('requireHeaderAny wirft nur, wenn keine Schreibweise passt', () => {
    expect(requireHeaderAny(ERF_HEADER, ['SSOT-ID', 'ID'], 'ctx')).toBe(0);
    expect(() => requireHeaderAny(ERF_HEADER, ['SSOT-ID'], 'ctx')).toThrow(MissingHeaderError);
  });

  // Der Auftragsmonitor faellt jetzt ebenfalls laut aus: ein Monitor, der
  // stumm die L-Shop-Nummer zeigt, erzeugt Fehlbestellungen.
  test.each([
    'GET /api/auftragsmonitor/lshop/offen',
    'GET /api/auftragsmonitor/dtf/offen',
  ])('Auftragsmonitor %s wirft bei fehlender Artikelnummer', (ctx) => {
    const ohne = ERF_HEADER.filter(h => h !== 'Artikelnummer');
    expect(() => requireHeader(ohne, 'Artikelnummer', ctx)).toThrow(MissingHeaderError);
    expect(() => requireHeader(ohne, 'Artikelnummer', ctx)).toThrow(new RegExp(ctx.split(' ')[1]));
  });

  test('Auftragsmonitor-Pflichtspalten loesen gegen die echte Kopfzeile auf', () => {
    const ctx = 'GET /api/auftragsmonitor/lshop/offen';
    expect(requireHeaderAny(ERF_HEADER, ['SSOT-ID', 'ID'], ctx)).toBe(0);
    expect(requireHeader(ERF_HEADER, 'Artikelnummer', ctx)).toBe(9);
    expect(requireHeader(ERF_HEADER, 'Produktname', ctx)).toBe(5);
  });
});

// ── W1: overwrite darf nichts loeschen, was der Payload nicht kennt ──────────

describe('W1 – mergeRow erhaelt ungenannte Spalten', () => {
  // Bestandszeile mit gefuellter Produkt-ID (D), Lieferzeit (K) und B1-Spalten
  const BESTAND = [
    'JFN-2026-0042', 'Im Shop', 'Veroeffentlicht', '6807', 'Erledigt',
    'Ugly Sweater Yummy', 'Variabel', 'JH030', 'Ugly-Sweater-Yummy',
    'JH030/Ugly-Sweater-Yummy', 'ca. 5-6 Werktage', 'grossbrief',
    'Ugly Christmas Sweater', 'Farbe', 'Rot', '29.90',
  ];

  // Was buildSheetPayload() im Frontend tatsaechlich schickt – ohne Produkt-ID,
  // ohne Lieferzeit, ohne B-Spalten.
  const PAYLOAD = {
    'Produktname':            'Ugly Sweater Yummy',
    'Produktart':             'Variabel',
    'Artikelnummer':          'JH030/Ugly-Sweater-Yummy',
    'L-Shop-Artikelnummer':   'JH030',
    'Artikelkurzbezeichnung': 'Ugly-Sweater-Yummy',
    'Status':                 'Im Shop',
    'Status Shop':            'Veroeffentlicht',
    'SEO_Status':             'Erledigt',
    'Versandklasse':          'grossbrief',
    'Kategorien':             'Ugly Christmas Sweater',
    'Kurzbeschreibung':       'geht nur an WooCommerce',
    'Produktbeschreibung':    'geht nur an WooCommerce',
  };

  const merged = mergeRow(ERF_HEADER, PAYLOAD, 'JFN-2026-0042', BESTAND);

  test('Produkt-ID (D) bleibt erhalten', () => {
    expect(merged[3]).toBe('6807');
  });

  test('Lieferzeit (K) bleibt erhalten', () => {
    expect(merged[10]).toBe('ca. 5-6 Werktage');
  });

  test('B1-Spalten bleiben erhalten', () => {
    expect(merged.slice(13)).toEqual(['Farbe', 'Rot', '29.90']);
  });

  test('gesendete Felder werden geschrieben', () => {
    expect(merged[5]).toBe('Ugly Sweater Yummy');
    expect(merged[9]).toBe('JH030/Ugly-Sweater-Yummy');
    expect(merged[1]).toBe('Im Shop');
  });

  test('SSOT-ID landet in Spalte A', () => {
    expect(merged[0]).toBe('JFN-2026-0042');
  });

  test('Zeilenlaenge entspricht der Kopfzeile', () => {
    expect(merged).toHaveLength(ERF_HEADER.length);
  });

  test('ausdrueckliches Leeren funktioniert weiterhin', () => {
    const geleert = mergeRow(
      ERF_HEADER, { ...PAYLOAD, 'Lieferzeit': '' }, 'JFN-2026-0042', BESTAND);
    expect(geleert[10]).toBe('');
  });

  test('Felder ohne Sheet-Spalte fallen still weg', () => {
    // Kurzbeschreibung/Produktbeschreibung existieren nicht als Spalte
    expect(merged).not.toContain('geht nur an WooCommerce');
  });

  test('buildRow (neue Zeile) fuellt Unbekanntes weiterhin mit ""', () => {
    const neu = buildRow(ERF_HEADER, PAYLOAD, 'JFN-2026-0099');
    expect(neu[0]).toBe('JFN-2026-0099');
    expect(neu[10]).toBe('');                      // Lieferzeit: neue Zeile, leer ist richtig
    expect(neu.slice(13)).toEqual(['', '', '']);
  });

  test('der alte buildRow-Pfad haette genau die drei Felder geleert', () => {
    const alt = buildRow(ERF_HEADER, PAYLOAD, 'JFN-2026-0042');
    expect(alt[3]).toBe('');                       // Produkt-ID weg
    expect(alt[10]).toBe('');                      // Lieferzeit weg
    expect(alt.slice(13)).toEqual(['', '', '']);   // B-Spalten weg
  });
});
