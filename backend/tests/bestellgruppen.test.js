// BO3c: Bestelluebersicht "Gruppieren nach" Modell | Hersteller | Dringlichkeit.
// Prueft den Block "Gruppen" in index.html zusammen mit den Bloecken "Groessen" und "Matrix":
// Gruppen je Art, Summe der Gruppen = Gesamtsumme, eine Matrix in mehreren Gruppen,
// Reihenfolgen, Stufengrenzen genau, ohne Datum, eigene Positionen; dazu die Einbindung.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html  = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = (von, bis) => {
  const a = html.indexOf(von), b = html.indexOf(bis);
  if (a < 0 || b < a) throw new Error(`Block ${von} fehlt`);
  return html.slice(a, b);
};
const fe = new Function(
  [['// ── Groessen: Anfang', '// ── Groessen: Ende ──'], ['// ── Matrix: Anfang', '// ── Matrix: Ende ──'], ['// ── Gruppen: Anfang', '// ── Gruppen: Ende ──']]
    .map(([a, b]) => block(a, b)).join('\n') + '\nreturn { baueMatrix, gruppiere, tageSeit, grSortiere, GRUPPEN_ARTEN };',
)();
const { baueMatrix, gruppiere, tageSeit, grSortiere, GRUPPEN_ARTEN } = fe;

const HEUTE = '2026-10-21';
let nr = 0;
const pos = (o = {}) => ({ schluessel: `JFN:${++nr}:1`, status: 'offen', menge: 1, vorschlag: true, hinweis: '', herkunft: 'shop', ...o });
const tagVor = n => new Date(Date.parse(`${HEUTE}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
const b = (catalogNr, marke, farbe, groesse, positionen) =>
  ({ articleNr: `10000${++nr}`, catalogNr, marke, bezeichnung: `Name ${catalogNr}`, farbe, groesse, positionen });
const gr = (buendel, art) => gruppiere(buendel, art, { heute: HEUTE, sortiere: grSortiere });
const summe = (gruppen, k) => gruppen.reduce((n, g) => n + g[k], 0);

describe('tageSeit', () => {
  test('Kalendertage, ungueltiges -> null', () => {
    expect(tageSeit('2026-10-21', HEUTE)).toBe(0);
    expect(tageSeit('2026-10-14', HEUTE)).toBe(7);
    expect(tageSeit('2026-03-29', '2026-03-30')).toBe(1);   // Zeitumstellung zaehlt nicht
    expect(tageSeit('', HEUTE)).toBeNull();
    expect(tageSeit(null, HEUTE)).toBeNull();
    expect(tageSeit('21.10.2026', HEUTE)).toBeNull();
  });
});

describe('gruppiere', () => {
  test('Arten: Modell, Hersteller, Dringlichkeit (keine Druckart)', () => {
    expect(GRUPPEN_ARTEN).toEqual(['modell', 'hersteller', 'dringlichkeit']);
  });

  test('Modell: eine Gruppe ohne Namen, gleich baueMatrix', () => {
    const daten = [b('E3000', 'Promodoro', 'Black', 'M', [pos({ menge: 2 })]), b('BY284', 'Build Your Brand', 'Black', 'M', [pos()])];
    const g = gr(daten, 'modell');
    expect(g).toHaveLength(1);
    expect(g[0].name).toBeNull();
    expect(g[0]).toMatchObject({ stueck: 3, modelle: 2 });
    expect(g[0].einzeln.map(m => m.modell)).toEqual(baueMatrix(daten, grSortiere).einzeln.map(m => m.modell));
    expect(gr(daten, 'unbekannt')).toHaveLength(1);   // unbekannte Art -> wie Modell
  });

  test('Hersteller: Gruppen nach Stueck, ohne Hersteller zuletzt, Namen wie L-Shop', () => {
    const g = gr([
      b('BY284', 'Build Your Brand', 'Black', 'M', [pos()]),
      b('BY289', 'Build Your Brand Basic', 'Pink', 'M', [pos()]),
      b('MRS5004', 'MR. SOCKS', 'White', '32/36', [pos({ menge: 3 })]),
      b('X1', '', 'Black', 'M', [pos({ menge: 5 })]),
      b('BY290', 'Build Your Brand', 'Pink', 'XL', [pos({ menge: 2 })]),
    ], 'hersteller');
    expect(g.map(x => [x.name, x.stueck])).toEqual([
      ['Build Your Brand', 3], ['MR. SOCKS', 3], ['Build Your Brand Basic', 1], ['ohne Hersteller', 5],
    ]);
  });

  test('Dringlichkeit: Stufen, Grenzen 3 und 7 mittig, 8 und 31, ohne Datum zuletzt', () => {
    const tage = [0, 2, 3, 7, 8, 30, 31, 138];
    const daten = tage.map((n, i) => b(`M${i}`, 'X', 'Black', 'M', [pos({ bestelldatum: tagVor(n) })]));
    daten.push(b('M-ohne', 'X', 'Black', 'M', [pos({ bestelldatum: null })]));
    const g = gr(daten, 'dringlichkeit');
    expect(g.map(x => [x.name, x.einzeln.map(m => m.wartet)])).toEqual([
      ['> 30 Tage', [138, 31]],
      ['> 7 Tage',  [30, 8]],
      ['3–7 Tage',  [7, 3]],
      ['< 3 Tage',  [2, 0]],
      ['ohne Datum', [null]],
    ]);
  });

  test('eine Matrix in mehreren Gruppen, jeweils nur mit deren Positionen; Summe = Gesamtsumme', () => {
    const daten = [
      b('E3000', 'Promodoro', 'Black', 'M', [pos({ bestelldatum: tagVor(40), menge: 2 }), pos({ bestelldatum: tagVor(1) })]),
      b('E3000', 'Promodoro', 'Black', 'XL', [pos({ bestelldatum: tagVor(5) })]),
      b('E3000', 'Promodoro', 'Red', 'M', [pos({ bestelldatum: tagVor(40) }), pos({ status: 'abgewählt', bestelldatum: tagVor(40) })]),
      b('CB445', 'Beechfield', 'Green', 'One Size', [pos({ bestelldatum: tagVor(10), vorschlag: false, hinweis: 'storniert' })]),
    ];
    const gesamt = baueMatrix(daten, grSortiere);
    for (const art of ['modell', 'hersteller', 'dringlichkeit']) {
      const g = gr(daten, art);
      expect([art, summe(g, 'stueck'), summe(g, 'positionen'), summe(g, 'gesperrt')]).toEqual([art, gesamt.stueck, gesamt.positionen, gesamt.gesperrt]);
    }
    const d = gr(daten, 'dringlichkeit');
    const e3000 = name => [...d.find(x => x.name === name).matrizen, ...d.find(x => x.name === name).einzeln].find(m => m.modell === 'E3000');
    expect(e3000('> 30 Tage')).toMatchObject({ stueck: 3, wartet: 40 });
    expect(e3000('> 30 Tage').farben).toEqual(['Black', 'Red']);
    expect(e3000('3–7 Tage')).toMatchObject({ stueck: 1, wartet: 5 });
    expect(e3000('< 3 Tage')).toMatchObject({ stueck: 1, wartet: 1 });
    expect(d.find(x => x.name === '> 7 Tage')).toMatchObject({ stueck: 0, gesperrt: 1 });   // nur gesperrt: sichtbar, 0 Stueck
  });

  test('wartet je Zelle = aelteste Position, Modelle in der Stufe aelteste zuerst', () => {
    const d = gr([
      b('A', 'X', 'Black', 'M', [pos({ bestelldatum: tagVor(9), menge: 5 })]),
      b('B', 'X', 'Black', 'M', [pos({ bestelldatum: tagVor(20) }), pos({ bestelldatum: tagVor(12) })]),
    ], 'dringlichkeit');
    expect(d[0].einzeln.map(m => [m.modell, m.wartet, m.zellen[0].wartet])).toEqual([['B', 20, 20], ['A', 9, 9]]);
  });

  test('eigene Positionen nehmen ihr Bestelldatum (Angelegt vom Server) wie alle anderen', () => {
    const d = gr([b('E3000', 'Promodoro', 'Black', 'M', [pos({ herkunft: 'eigen', referenz: 'Lager', bestelldatum: tagVor(4), menge: 3 })])], 'dringlichkeit');
    expect(d.map(x => [x.name, x.stueck])).toEqual([['3–7 Tage', 3]]);
  });

  test('nicht offene Positionen und leere Eingabe', () => {
    expect(gr([b('A', 'X', 'Black', 'M', [pos({ status: 'bestellt' })])], 'hersteller')).toEqual([]);
    expect(gr([], 'dringlichkeit')).toEqual([]);
    expect(gr(undefined, 'modell')[0]).toMatchObject({ stueck: 0, modelle: 0 });
  });
});

describe('Einbindung in index.html', () => {
  const sec = block('// ── SECTION: L-Shop-Bestellübersicht ──', '// ── SECTION: Artikelerfassung ──');

  test('Umschalter mit genau drei Arten, keine Druckart', () => {
    const knoepfe = [...html.matchAll(/data-gruppe="([a-z]+)"/g)].map(m => m[1]);
    expect(knoepfe).toEqual(['modell', 'hersteller', 'dringlichkeit']);
    expect(html).not.toMatch(/data-gruppe="druckart"/);
    expect(sec).not.toMatch(/[Dd]ruckart/);
  });

  test('Gruppierung im Browser (localStorage), nicht in der Adresse; Zaehlliste-Haekchen nie gespeichert', () => {
    expect(sec).toContain("UEBERSICHT_GRUPPE_KEY = 'mc_uebersicht_gruppe'");
    expect((sec.match(/localStorage\.\w+\(/g) ?? []).sort()).toEqual(['localStorage.getItem(', 'localStorage.setItem(']);
    expect(sec).not.toMatch(/location\.hash|history\.(push|replace)State/);
  });

  test('Bestelldatum nur mit ?mit=bestelldatum und nur fuer die Dringlichkeit; kein eigener Abruf in der SECTION', () => {
    expect(html).toContain("/api/bestellen/lshop-korb${mitDatum ? '?mit=bestelldatum' : ''}");
    expect(sec).toMatch(/uebersichtBrauchtDatum = \(\) => uebersichtAktiv\(\) && uebersichtZustand\.gruppe === 'dringlichkeit'/);
    expect(sec).not.toMatch(/apiFetch|\/api\//);
  });
});
