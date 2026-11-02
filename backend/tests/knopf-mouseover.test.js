// Dauerregel (Inhaber 02.11., BO5-4): Jedes neue Bedienelement bekommt einen Mouse-over - Text im Block "Knopf-Hilfe",
// am Element data-hilfe (bzw. data-hilfe-gruppe fuer das ⓘ). knopf-hilfe.test.js prueft nur bestimmte Knoepfe; dieser Test
// prueft JEDEN <button> in index.html. Knoepfe, die es vor der Regel schon ohne Mouse-over gab, stehen im Bestand
// hilfen/knopf-ohne-hilfe-bestand.json (Nachruesten = eigener Auftrag; dann die Zeile dort streichen).

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { knoepfeOhneHilfe } from './hilfen/knopf-ohne-hilfe.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const bestand = new Set(JSON.parse(readFileSync(resolve(hier, 'hilfen/knopf-ohne-hilfe-bestand.json'), 'utf8')));

describe('Mouse-over an jedem Knopf', () => {
  test('kein NEUER Knopf ohne data-hilfe (Bestand ausgenommen)', () => {
    const neu = [...new Set(knoepfeOhneHilfe(html))].filter(k => !bestand.has(k));
    expect(neu).toEqual([]);
  });
  test('der Erkenner findet Knoepfe ohne Hilfe und laesst Knoepfe mit Hilfe oder ⓘ in Ruhe', () => {
    const probe = '<button id="a" data-hilfe="x">A</button><button class="hilfe-i" data-hilfe-gruppe="g">ⓘ</button>'
      + '<button id="b">B</button><button type="button" data-foo="1">Text ${x}</button>';
    expect(knoepfeOhneHilfe(probe)).toEqual(['#b', 'data-foo|Text …']);
  });
  test('die neuen Knoepfe aus BO5-4 haben einen Mouse-over (stehen nicht im Bestand)', () => {
    for (const k of ['#lo-ok', '#lo-abbrechen', 'data-ks-rest|', 'data-tr-lager|', 'data-lager-ziel|', 'data-lager-lb|', 'data-lager-tr|']) {
      expect([k, [...bestand].some(b => b.startsWith(k))]).toEqual([k, false]);
    }
  });
});
