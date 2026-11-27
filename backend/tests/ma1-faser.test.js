// MA1 (27.11.): Faserangaben, die L-Shop liefert, nicht mehr verwerfen; ehrlicher Grund am Pflichtfeld;
// Regel 13 "Materialangabe ohne Quelle". Nur erfundene Nummern.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { prozentAbschnitte, pruefeHundertProzent, lshopAuswertung } from '../lib/lshop.js';
import { pruefeGeneratorText } from '../lib/seo-pruefung.js';
import { materialAusEigenschaften, MATERIAL_PLACEHOLDER } from '../lib/seo-prompt.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const route = readFileSync(resolve(hier, '../routes/claude.js'), 'utf8');

const zeile = (articleNr, catalogNr, color1, size, consistence) =>
  ({ articleNr, catalogNr, color1, color2: '', size, consistence, grammage: '' });

describe('MA1a: Teilangaben ohne Klammer', () => {
  test.each([
    ['Außen: 100% Nylon Innen: 100% Polyester', [100, 100]],
    ['100% Nylon Futter: 100% Polyester', [100, 100]],
    ['80% Baumwolle / 20% Polyester Oberstoff: 100% Baumwolle', [100, 100]],
    ['100% Baumwolle Ribbündchen: 65% Polyester / 35% Baumwolle', [100, 100]],
    ['78% Polyester / 22% Elasthan Schulter Panel: 86% Polyester / 14% Elasthan', [100, 100]],
    ['Außen: 90% Polyester / 10% Elasthan Innen: 95% Polyester / 5% Elasthan', [100, 100]],
  ])('%s geht auf', (faser, summen) => {
    expect(prozentAbschnitte(faser).map(a => a.summe)).toEqual(summen);
    expect(pruefeHundertProzent(faser)).toBeNull();
  });

  test('echter Fehler bleibt Fehler (Klammer und ohne Klammer)', () => {
    expect(pruefeHundertProzent('100% Baumwolle (Ash: 98% Baumwolle / 15% Viskose)')).toMatch(/= 113 %/);
    expect(pruefeHundertProzent('Außen: 100% Nylon Innen: 90% Polyester')).toMatch(/= 90 %/);
  });

  test('Klammern wie bisher', () => {
    expect(prozentAbschnitte('100% Baumwolle (Sports Grey: 85% Baumwolle / 15% Viskose)')).toEqual([
      { teil: '100% Baumwolle', summe: 100 },
      { teil: 'Sports Grey: 85% Baumwolle / 15% Viskose', summe: 100 },
    ]);
  });

  test('Auswertung uebernimmt die Faser jetzt', () => {
    const F = 'Außen: 100% Polyester Innen: 95% Baumwolle / 5% Elasthan';
    const r = lshopAuswertung([zeile('9900000001', 'XX1', 'Black', 'M', F), zeile('9900000002', 'XX1', 'Navy', 'M', F)],
      { farben: ['Black'] });
    expect(r.faser).toBe(F);
    expect(r.hinweise).toEqual([]);
  });

  test('ohne Farben = alle Farben des Modells (MA1b, Backend-Seite)', () => {
    const r = lshopAuswertung([
      zeile('9900000011', 'XX2', 'Red', 'M', '80% Baumwolle / 20% Polyester (Grey: 75% Baumwolle / 25% Polyester)'),
      zeile('9900000012', 'XX2', 'Grey', 'M', '80% Baumwolle / 20% Polyester (Grey: 75% Baumwolle / 25% Polyester)'),
    ]);
    expect(r.faser).toBe('80% Baumwolle / 20% Polyester (Grey: 75% Baumwolle / 25% Polyester)');
  });
});

describe('MA1b: SEO-Reiter', () => {
  const block = html.slice(html.indexOf('async function seoLshopStruktur'), html.indexOf('async function seoMetaEingabenHolen'));
  test('ohne Farben wird das Modell trotzdem gefragt', () => {
    expect(block).not.toMatch(/if \(!nr \|\| !f\.length\) return null/);
    expect(block).toMatch(/!f\.length \|\| \(d\.farben/);
  });
  test('Grund getrennt von strukturiert, ehrliche Texte', () => {
    expect(block).toMatch(/erg = \{ faser: d\.faser \?\? null, grammatur: d\.grammatur \?\? null \};/);
    for (const g of ['unklar', 'fehlt', 'farben', 'kein_modell', 'nicht_lesbar']) expect(block).toMatch(new RegExp(`${g}:\\s+'`));
    expect(html).toMatch(/seoMaterialGrundText\(seoCurrentItem\?\.lshopNr, seoFarben\(\)\)/);
    expect(html).not.toMatch(/: 'fehlt im L-Shop-Modell';\s*\n/);
  });
});

describe('MA1c: Regel 13 Materialangabe ohne Quelle', () => {
  const TEXT = { kurzbeschreibung: '<p>Warmer Sweater.</p>', produktbeschreibung: '<h2>Sweater</h2><ul><li>80 % Baumwolle / 20 % Polyester</li></ul>' };
  test('Modell bekam nur den Platzhalter -> Hinweis', () => {
    const h = pruefeGeneratorText({ ...TEXT, faserQuelle: MATERIAL_PLACEHOLDER });
    expect(h.filter(x => /ohne Quelle/.test(x))).toEqual([
      expect.stringMatching(/^Materialangabe "80 % Baumwolle, 20 % Polyester" in Produktbeschreibung ohne Quelle/),
    ]);
  });
  test('Quelle vorhanden oder unbekannt -> still', () => {
    expect(pruefeGeneratorText({ ...TEXT, faserQuelle: '80% Baumwolle / 20% Polyester' }).some(x => /ohne Quelle/.test(x))).toBe(false);
    expect(pruefeGeneratorText({ ...TEXT }).some(x => /ohne Quelle/.test(x))).toBe(false);
  });
  test('Text ohne Prozent -> still', () => {
    expect(pruefeGeneratorText({ kurzbeschreibung: '<p>Sweater</p>', produktbeschreibung: '<p>aus Baumwolle</p>', faserQuelle: '' })
      .some(x => /ohne Quelle/.test(x))).toBe(false);
  });
  test('Quelle = dieselbe Materialrechnung wie der Prompt', () => {
    expect(materialAusEigenschaften('', ['Red'], { groessen: ['M'] }).material).toBe(MATERIAL_PLACEHOLDER);
    expect(route).toMatch(/faserQuelle: materialAusEigenschaften\(eigenschaftenMitExtern\(eigenschaften, extern\)/);
  });
});
