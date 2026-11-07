// MK1: Maske - Kategorie zuerst, Kuerzel-Vorschlag, Hinweis bei fremdem Kuerzel (Spiegel von kuerzelHinweis). Nur erfundene Werte.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { kuerzelHinweis } from '../lib/vorschlaege.js';
import { vorschlagsListe } from '../scripts/setup-kategorie-kuerzel.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');

describe('MK1 Maske', () => {
  test('Kuerzel-Hinweis im Browser = Backend (Spiegel)', () => {
    const a = html.indexOf('// ── Kuerzel-Hinweis: Anfang'), b = html.indexOf('// ── Kuerzel-Hinweis: Ende ──');
    const f = new Function(`${html.slice(a, b)}\nreturn kuerzelHinweisText;`)();
    const faelle = [['CH-Neu', ['CH-']], ['ch-neu', ['CH-']], ['UCS-Elch', ['CH-', 'KaZu-']], ['Hoodie', ['CH-']], ['CH-Neu', []], ['', ['CH-']], ['KaZu-Tasche', ['KaZu-']]];
    for (const [k, u] of faelle) expect(f(k, u)).toBe(kuerzelHinweis(k, u));
  });
  test('Kategorien stehen vor Produktname und Kurzbezeichnung; neue Elemente mit Mouse-over, ohne title', () => {
    const kat = html.indexOf('id="pf-cats-wrap"'), name = html.indexOf('id="pf-name"'), kurz = html.indexOf('id="pf-short-name"');
    expect(kat).toBeGreaterThan(0);
    expect(kat).toBeLessThan(name);
    expect(name).toBeLessThan(kurz);
    expect(html).toMatch(/id="pf-short-name-kuerzel"[^>]*data-hilfe="kurz-kuerzel-hinweis"/);
    expect(html).toMatch(/id="pf-short-name-vorschlag"[^>]*data-hilfe="kurz-vorschlag"/);
    for (const k of ['kurz-vorschlag', 'kurz-kuerzel-hinweis']) expect(html).toMatch(new RegExp(`'${k}':\\s*\\{ name:`));
    expect(html).not.toMatch(/id="pf-short-name-kuerzel"[^>]*title=/);
  });
  test('Bearbeiten bestehender Artikel: keine Vorschlaege, kein Hinweis (editMode)', () => {
    const f = html.slice(html.indexOf('async function maskeVorschlaegeLaden()'), html.indexOf("document.getElementById('pf-name').addEventListener('change', maskeVorschlaegeLaden)"));
    expect(f).toMatch(/if \(editMode\) return;/);
    expect(html).toMatch(/const h = editMode \? null : kuerzelHinweisText/);
    // nie Getipptes ueberschreiben: weiter ueber vorschlagSetzen
    expect(f).toMatch(/vorschlagSetzen\(kurzFeld\.value, kurzVorschlagStand, d\.kurz\.wert\)/);
  });
});

describe('MK1 Setup-Vorschlagsliste (Trockenlauf)', () => {
  test('nur eindeutige Kuerzel aus dem Bestand der Kategorie selbst; festgelegte und gemischte bleiben', () => {
    const kategorien = [
      { nr: '1', pfad: 'Vereine', name: 'Vereine', kuerzel: '' },
      { nr: '2', pfad: 'Vereine > Verein A', name: 'Verein A', kuerzel: '' },
      { nr: '3', pfad: 'Weihnacht', name: 'Weihnacht', kuerzel: 'WX-' },
      { nr: '4', pfad: 'Vereine > Verein A > Jugend', name: 'Jugend A', kuerzel: '' },
    ];
    const erfassung = [{ kurz: 'VA-Hoodie', kategorien: 'Verein A' }, { kurz: 'VB-Shirt', kategorien: 'Vereine' }, { kurz: 'VA-Cap', kategorien: 'Vereine' }];
    const l = vorschlagsListe(erfassung, kategorien);
    expect(l.find(x => x.nr === '2')).toMatchObject({ vorschlag: 'VA-', schreiben: true });
    expect(l.find(x => x.nr === '1')).toMatchObject({ schreiben: false, grund: 'gemischt' });
    expect(l.find(x => x.nr === '3')).toMatchObject({ schreiben: false, grund: 'festgelegt', vorschlag: 'WX-' });
    expect(l.find(x => x.nr === '4')).toMatchObject({ schreiben: false, grund: 'eltern', vorschlag: 'VA-' });
  });
});
