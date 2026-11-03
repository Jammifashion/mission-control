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

// HT1 (03.11.2026): Bestand nachgeruestet - jeder Knopf hat einen Mouse-over. Wiederkehrende Knoepfe teilen EINEN Text.
describe('HT1: gemeinsame Texte', () => {
  const von = html.indexOf('const KNOPF_HILFE = {'), bis = html.indexOf('const hilfeText = ');
  const block = html.slice(von, bis);
  const GEMEINSAM = ['dialog-abbrechen', 'dialog-schliessen', 'dialog-bestaetigen', 'dialog-speichern', 'liste-bearbeiten', 'zeile-speichern',
    'link-kopieren', 'token-neu', 'nav-bereich', 'nav-unterreiter', 'tab-offen', 'tab-protokoll',
    'editor-b', 'editor-i', 'editor-u', 'editor-h2', 'editor-h3', 'editor-ol', 'editor-ul', 'editor-link'];
  test('die Bestandsliste ist leer', () => expect(bestand.size).toBe(0));
  test('jeder gemeinsame Text steht genau einmal im Block und wird mehrfach benutzt', () => {
    for (const k of GEMEINSAM) {
      expect([k, block.split(`'${k}':`).length - 1]).toEqual([k, 1]);
      expect([k, (html.match(new RegExp(`data-hilfe="${k}"`, 'g')) ?? []).length >= 1]).toEqual([k, true]);
    }
    expect((html.match(/data-hilfe="dialog-abbrechen"/g) ?? []).length).toBeGreaterThanOrEqual(15);
    expect((html.match(/data-hilfe="liste-bearbeiten"/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });
  test('kein zweiter Eintrag mit demselben Text wie ein gemeinsamer (keine Kopien)', () => {
    const texte = [...block.matchAll(/'([a-z0-9-]+)':\s+\{ name: '(?:[^'\\]|\\.)*', text: '((?:[^'\\]|\\.)*)' \}/g)].map(m => [m[1], m[2]]);
    for (const k of GEMEINSAM) {
      const t = texte.find(([x]) => x === k)?.[1];
      expect([k, texte.filter(([x, y]) => y === t && x !== k).map(([x]) => x)]).toEqual([k, []]);
    }
  });
  test('Dialog-Knoepfe Abbrechen/Schließen aus HT1 nutzen den gemeinsamen Text', () => {
    for (const id of ['korb-eigen-abbrechen', 'senden-schliessen', 'anf-modal-cancel', 'pp-f-cancel', 'dp-x', 'fk-x', 'vk-x', 'art-x', 'sv-x', 'ab-x', 'int-x', 'fp-f-cancel', 'fpi-x', '_mc'])
      expect([id, html.match(new RegExp(`id="${id}"[^>]*data-hilfe="([a-z-]+)"`))?.[1]]).toEqual([id, 'dialog-abbrechen']);
    for (const id of ['edi-schliessen', 'we-schliessen', 'ks-schliessen', 'tr-schliessen', 'lager-schliessen', 'vor-x', 'fp-vor-x'])
      expect([id, html.match(new RegExp(`id="${id}"[^>]*data-hilfe="([a-z-]+)"`))?.[1]]).toEqual([id, 'dialog-schliessen']);
  });
});
