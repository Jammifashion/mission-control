// BO3d: In den Positionszeilen (Warenkorb und Bestelluebersicht) ist die Menge rot,
// wenn sie groesser als 1 ist. Prueft den Block "Korb-Menge" in index.html und dass
// korbPositionZeile ihn benutzt.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html  = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von   = html.indexOf('// ── Korb-Menge: Anfang');
const bis   = html.indexOf('// ── Korb-Menge: Ende ──');
const { korbMengeHtml } = new Function(`${html.slice(von, bis)}\nreturn { korbMengeHtml };`)();
const ROT = 'class="korb-menge-viel"';

describe('korbMengeHtml', () => {
  test.each([[2, '×2'], [10, '×10'], ['3', '×3']])('Menge %p -> rot', (menge, text) => {
    expect(korbMengeHtml(menge)).toBe(`<span ${ROT}>${text}</span>`);
  });

  test.each([[1, '×1'], ['1', '×1'], [0, '×0'], ['', '×'], [undefined, '×'], [null, '×'], ['abc', '×abc'], [1.5 - 0.5, '×1']])(
    'Menge %p -> wie bisher, ohne Klasse', (menge, text) => {
      expect(korbMengeHtml(menge)).toBe(text);
    });

  test('Ungueltiges wird maskiert', () => {
    expect(korbMengeHtml('<b>')).toBe('×&#60;b&#62;');
  });
});

describe('Einbindung', () => {
  test('korbPositionZeile nutzt korbMengeHtml statt ×${p.menge}', () => {
    const fn = html.slice(html.indexOf('function korbPositionZeile('), html.indexOf('function korbKopfText('));
    expect(fn).toContain('korbMengeHtml(p.menge)');
    expect(fn).not.toContain('×${p.menge}');
  });

  test('Klasse mit Fehlerrot im CSS', () => {
    expect(html).toMatch(/\.korb-menge-viel\s*\{[^}]*color:\s*var\(--danger\)/);
  });
});
