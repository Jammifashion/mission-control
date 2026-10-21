// BO3b: Bestelluebersicht - Matrix je Modell aus der Antwort von GET /api/bestellen/lshop-korb.
// Prueft den Block "Matrix" in index.html (reine Logik) zusammen mit dem Groessen-Spiegel:
// nur offen, sperrende Hinweise nicht gezaehlt, unbezahlt markiert, Summen, Reihenfolgen,
// Einzelzellen-Modelle getrennt, eigene Positionen.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html  = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = (von, bis) => {
  const a = html.indexOf(von), b = html.indexOf(bis);
  if (a < 0 || b < a) throw new Error(`Block ${von} fehlt`);
  return html.slice(a, b);
};
const { baueMatrix, grSortiere } = new Function(
  `${block('// ── Groessen: Anfang', '// ── Groessen: Ende ──')}\n${block('// ── Matrix: Anfang', '// ── Matrix: Ende ──')}\n`
  + 'return { baueMatrix, grSortiere };',
)();

let nr = 0;
const pos = (o = {}) => ({ schluessel: `JFN:${++nr}:1`, status: 'offen', menge: 1, vorschlag: true, hinweis: '', herkunft: 'shop', ...o });
const buendel = (catalogNr, farbe, groesse, positionen, extra = {}) =>
  ({ articleNr: `10000${++nr}`, catalogNr, bezeichnung: `Name ${catalogNr}`, farbe, groesse, positionen, ...extra });

const matrix = b => baueMatrix(b, grSortiere);

describe('baueMatrix', () => {
  test('gruppiert nach Modell, Zeilen = Farben, Spalten = Groessen, Summen stimmen', () => {
    const mx = matrix([
      buendel('E3000', 'Fire Red', 'XXL', [pos()]),
      buendel('E3000', 'Black', '4XL', [pos({ menge: 2 })]),
      buendel('E3000', 'Black', 'M', [pos(), pos({ menge: 3 })]),
    ]);
    expect(mx).toMatchObject({ stueck: 7, modelle: 1, positionen: 4, gesperrt: 0 });
    const [m] = mx.matrizen;
    expect(m).toMatchObject({ modell: 'E3000', bezeichnung: 'Name E3000', stueck: 7 });
    expect(m.farben).toEqual(['Black', 'Fire Red']);
    expect(m.groessen).toEqual(['M', 'XXL', '4XL']);
    expect(m.raster.map(r => r.map(z => z?.stueck ?? null))).toEqual([[4, null, 2], [null, 1, null]]);
    expect(m.zeilenSumme).toEqual([6, 1]);
    expect(m.spaltenSumme).toEqual([4, 1, 2]);
    expect(m.raster[0][0].positionen).toHaveLength(2);
  });

  test('nur Status offen; abgewaehlt/bestellt zaehlen nicht, ein Buendel ohne offene faellt weg', () => {
    const mx = matrix([
      buendel('BY289', 'Soft Pink', 'M', [pos(), pos({ status: 'abgewählt' }), pos({ status: 'bestellt', menge: 5 })]),
      buendel('BY290', 'Soft Pink', 'XL', [pos({ status: 'abgewählt' })]),
    ]);
    expect(mx).toMatchObject({ stueck: 1, modelle: 1, positionen: 1 });
    expect(mx.einzeln[0].zellen[0].positionen).toHaveLength(1);
  });

  test('sperrender Hinweis (vorschlag false) zaehlt nicht, steht als gesperrt an der Zelle', () => {
    const mx = matrix([buendel('JH030F', 'Deep Black', 'XL', [pos({ menge: 2 }), pos({ vorschlag: false, hinweis: 'storniert' })])]);
    const z = mx.einzeln[0].zellen[0];
    expect(z).toMatchObject({ stueck: 2, gesperrt: 1 });
    expect(z.positionen).toHaveLength(2);
    expect(mx).toMatchObject({ stueck: 2, gesperrt: 1 });
  });

  test('nur gesperrte Positionen: Modell bleibt sichtbar mit 0 Stueck', () => {
    const mx = matrix([buendel('BG110', 'Bottle Green', '40 x 48 cm', [pos({ vorschlag: false, hinweis: 'erstattet' })])]);
    expect(mx.einzeln[0]).toMatchObject({ stueck: 0, gesperrt: 1 });
    expect(mx.stueck).toBe(0);
  });

  test('unbezahlt zaehlt mit und wird markiert (auch neben anderen Hinweisen)', () => {
    const mx = matrix([buendel('CB445', 'Bottle Green', 'One Size', [
      pos({ hinweis: 'noch nicht bezahlt' }), pos({ hinweis: 'Menge geändert · noch nicht bezahlt', menge: 2 }), pos(),
    ])]);
    expect(mx.einzeln[0].zellen[0]).toMatchObject({ stueck: 4, unbezahlt: 3 });
    expect(mx.unbezahlt).toBe(3);
  });

  test('Groessen ohne Rang (One Size, years, cm) stehen am Ende', () => {
    const mx = matrix([
      buendel('X1', 'Black', 'One Size', [pos()]),
      buendel('X1', 'Black', '5-6 years', [pos()]),
      buendel('X1', 'Black', 'L', [pos()]),
      buendel('X1', 'Black', '128', [pos()]),
      buendel('X1', 'Black', 'S', [pos()]),
    ]);
    expect(mx.matrizen[0].groessen).toEqual(['S', 'L', '128', 'One Size', '5-6 years']);
  });

  test('Kindergroessen L-Shop aufsteigend hinter Zahlen', () => {
    const mx = matrix([
      buendel('JH001K', 'Black', '9/11 (L)', [pos()]),
      buendel('JH001K', 'Black', '3/4 (XS)', [pos()]),
      buendel('JH001K', 'Black', '5/6 (S)', [pos()]),
    ]);
    expect(mx.matrizen[0].groessen).toEqual(['3/4 (XS)', '5/6 (S)', '9/11 (L)']);
  });

  test('Modelle nach Stueck absteigend, Gleichstand nach Modellnummer; Einzelzellen getrennt', () => {
    const mx = matrix([
      buendel('BY284', 'Black', 'M', [pos()]),
      buendel('AT533', 'Black', 'One Size', [pos()]),
      buendel('MRS5004', 'White/Green', '32/36', [pos({ menge: 2 })]),
      buendel('MRS5004', 'White/Black', '37/41', [pos()]),
      buendel('CB445', 'Bottle Green', 'One Size', [pos({ menge: 2 })]),
    ]);
    expect(mx.matrizen.map(m => m.modell)).toEqual(['MRS5004']);
    expect(mx.einzeln.map(m => m.modell)).toEqual(['CB445', 'AT533', 'BY284']);
    expect(mx).toMatchObject({ modelle: 4, stueck: 7 });
  });

  test('eine Farbe mit zwei Groessen ist eine Matrix, keine Einzelzelle', () => {
    const mx = matrix([buendel('BCWU02K', 'Black Pure', 'XXL', [pos()]), buendel('BCWU02K', 'Black Pure', '3XL', [pos()])]);
    expect(mx.matrizen).toHaveLength(1);
    expect(mx.einzeln).toHaveLength(0);
  });

  test('eigene Positionen zaehlen wie Shop-Positionen, die Referenz bleibt an der Position', () => {
    const mx = matrix([buendel('E3000', 'Black', 'M', [pos({ herkunft: 'eigen', referenz: 'Lager', menge: 4 })])]);
    expect(mx.einzeln[0].zellen[0].stueck).toBe(4);
    expect(mx.einzeln[0].zellen[0].positionen[0].referenz).toBe('Lager');
  });

  test('fehlende Angaben: Modell faellt auf die ArticleNr zurueck, Farbe/Groesse auf –', () => {
    const mx = matrix([{ articleNr: '1000099999', catalogNr: '', bezeichnung: '', farbe: '', groesse: '', positionen: [pos()] }]);
    expect(mx.einzeln[0]).toMatchObject({ modell: '1000099999', farben: ['–'], groessen: ['–'] });
  });

  test('Menge als Text und leere Eingabe', () => {
    expect(matrix([buendel('E3000', 'Black', 'M', [pos({ menge: '3' })])]).stueck).toBe(3);
    expect(matrix([])).toMatchObject({ stueck: 0, modelle: 0, matrizen: [], einzeln: [] });
    expect(matrix(undefined)).toMatchObject({ stueck: 0, modelle: 0 });
  });
});

describe('Einbindung in index.html', () => {
  test('Unterreiter, Panel und BEREICHE-Zeile direkt hinter dem Warenkorb', () => {
    const tabs = [...html.matchAll(/data-subtab="(tab-[a-z-]+)">/g)].map(m => m[1]);
    expect(tabs.indexOf('tab-lshop-uebersicht')).toBe(tabs.indexOf('tab-lshop-korb') + 1);
    expect(html).toContain('<div id="tab-lshop-uebersicht" class="sub-tab-panel">');
    const nav = block('// ── Navigation-Tabelle: Anfang ──', '// ── Navigation-Tabelle: Ende ──');
    expect(nav.indexOf("id: 'lshop-uebersicht'")).toBeGreaterThan(nav.indexOf("id: 'lshop-korb'"));
  });

  test('SECTION-Anker vorhanden; kein neuer Endpunkt in der Uebersicht', () => {
    const sec = block('// ── SECTION: L-Shop-Bestellübersicht ──', '// ── SECTION: Artikelerfassung ──');
    expect(sec).not.toMatch(/apiFetch|\/api\//);
  });

  test('Zaehlliste speichert keine Haekchen (localStorage nur fuer die Gruppierung, BO3c)', () => {
    const sec = block('// ── SECTION: L-Shop-Bestellübersicht ──', '// ── SECTION: Artikelerfassung ──');
    expect(sec).not.toMatch(/sessionStorage/);
    const zugriffe = [...sec.matchAll(/localStorage\.(\w+)\(([^,)]*)/g)].map(m => [m[1], m[2].trim()]);
    expect(zugriffe).toEqual([['getItem', 'UEBERSICHT_GRUPPE_KEY'], ['setItem', 'UEBERSICHT_GRUPPE_KEY']]);
  });
});
