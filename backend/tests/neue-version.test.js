// NAV6: Zurueck-Taste bleibt in MC (Verlaufseintraege je Ansicht) und kein automatisches Neuladen mitten in der Arbeit.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const nav = new Function(`${html.slice(html.indexOf('// ── Navigation-Tabelle: Anfang ──'), html.indexOf('// ── Navigation-Tabelle: Ende ──'))}
  return { verlaufSchritt };`)();
const nv = new Function(`${html.slice(html.indexOf('// ── Neue-Version: Anfang'), html.indexOf('// ── Neue-Version: Ende ──'))}
  return { NV_DIALOG, nvOffeneEingaben, nvDarfAutomatisch };`)();

describe('Zurueck-Taste: Verlauf je Ansicht', () => {
  test('Wechsel durch den Nutzer = neuer Eintrag, gleiche Ansicht = nichts', () => {
    expect(nav.verlaufSchritt('#dashboard', '#auftraege/liste')).toBe('push');
    expect(nav.verlaufSchritt('#auftraege/liste', '#auftraege/liste')).toBe('');
  });
  test('Start/Lesezeichen und die Zurueck-Taste selbst ersetzen nur', () => {
    expect(nav.verlaufSchritt('', '#dashboard')).toBe('replace');
    expect(nav.verlaufSchritt('#bestellen/lshop', '#bestellen/lshop-bestellungen', { verlauf: false })).toBe('replace');
  });
  test('Start, hashchange und Klick sind so verdrahtet', () => {
    expect(html).toMatch(/oeffneAnsicht\(start\.bereich, start\.punkt, \{ verlauf: false \}\)/);
    const hc = html.match(/addEventListener\('hashchange'[\s\S]*?\n      \}\);/)?.[0] ?? '';
    expect(hc).toContain('oeffneAnsicht(a.bereich, a.punkt, { verlauf: false })');
    expect(hc).toContain('document.querySelector(NV_DIALOG)');   // offener Dialog: Ansicht bleibt
    expect(html).toContain("if (schritt === 'push') history.pushState(null, '', h);");
    expect(html).not.toMatch(/if \(location\.hash !== h\) history\.replaceState/);
  });
});

describe('Neue Version: Hinweis statt Neuladen', () => {
  const feld = (type, value, defaultValue, disabled = false) => ({ type, value, defaultValue, disabled });
  const wurzel = felder => ({ querySelectorAll: () => felder });
  test('Eingaben = Wert anders als beim Laden; Haken, Knoepfe, gesperrte Felder zaehlen nicht', () => {
    expect(nv.nvOffeneEingaben(wurzel([feld('text', '', '')]))).toBe(false);
    expect(nv.nvOffeneEingaben(wurzel([feld('text', 'abc', '')]))).toBe(true);
    expect(nv.nvOffeneEingaben(wurzel([feld('textarea', 'Notiz', '')]))).toBe(true);
    expect(nv.nvOffeneEingaben(wurzel([feld('checkbox', 'on', 'x'), feld('text', 'a', '', true)]))).toBe(false);
  });
  test('automatisch nur im Hintergrund, ohne Dialog, ohne Eingaben', () => {
    expect(nv.nvDarfAutomatisch({ versteckt: true, dialogOffen: false, eingaben: false })).toBe(true);
    expect(nv.nvDarfAutomatisch({ versteckt: false, dialogOffen: false, eingaben: false })).toBe(false);
    expect(nv.nvDarfAutomatisch({ versteckt: true, dialogOffen: true, eingaben: false })).toBe(false);
    expect(nv.nvDarfAutomatisch({ versteckt: true, dialogOffen: false, eingaben: true })).toBe(false);
  });
  test('Dialog-Erkennung deckt alle Fensterarten ab', () => {
    for (const s of ['.edi-dialog:not([hidden])', '.modal-backdrop', '.anf-side-panel.is-open', '.anf-modal-backdrop.is-open', '#shop-modal-overlay.active']) {
      expect(nv.NV_DIALOG).toContain(s);
    }
  });
  test('Hinweis-Leiste mit zwei Knoepfen, Knopf fragt bei Eingaben nach', () => {
    expect(html).toMatch(/<div id="neue-version" class="neue-version" role="status" hidden>/);
    expect(html).toContain('data-hilfe="neue-version-laden"');
    expect(html).toContain('data-hilfe="neue-version-spaeter"');
    const knopf = html.match(/getElementById\('neue-version-laden'\)[\s\S]*?\n      \}\);/)?.[0] ?? '';
    expect(knopf).toContain('showConfirm(');
    expect(html).toMatch(/document\.addEventListener\('visibilitychange', nvPruefeAutomatisch\)/);
  });
});
