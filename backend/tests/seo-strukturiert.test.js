// Befehl M1: strukturierte Faser/Grammatur (aus lib/lshop.js) hat Vorrang vor
// dem Eigenschaften-Freitext - in der Meta-Beschreibung (seo-meta.js) und im
// SEO-Prompt (seo-prompt.js). Ohne strukturierte Eingabe bleibt alles wie bisher.

import { metaEingaben } from '../lib/seo-meta.js';
import { buildSeoUserPrompt, strukturierteEingabe } from '../lib/seo-prompt.js';

const FREITEXT = [
  'Materialzusammensetzung\t100% Baumwolle',
  'Grammatur in g/m²\t180 g/m²',
  'Schnitt: gerade',
].join('\n');

describe('strukturierteEingabe', () => {
  test('keine Eingabe -> null', () => {
    expect(strukturierteEingabe(undefined)).toBeNull();
    expect(strukturierteEingabe(null)).toBeNull();
    expect(strukturierteEingabe('100% Polyester')).toBeNull();
    expect(strukturierteEingabe([])).toBeNull();
  });

  test('grammatur: Schluessel da zaehlt, auch mit null', () => {
    expect(strukturierteEingabe({ faser: ' 100% Polyester ', grammatur: null }))
      .toEqual({ faser: '100% Polyester', grammaturGesetzt: true, grammatur: null });
    expect(strukturierteEingabe({ faser: '' }))
      .toEqual({ faser: null, grammaturGesetzt: false, grammatur: null });
  });
});

describe('metaEingaben', () => {
  test('Vorrang: strukturierte Faser und Grammatur schlagen den Freitext', () => {
    expect(metaEingaben({
      eigenschaften: FREITEXT, farben: ['Black'], groessen: ['M'],
      strukturiert: { faser: '100% Polyester', grammatur: '150 g/m²' },
    })).toEqual({ faserangabe: '100% Polyester', faserMeldung: null, grammatur: '150 g/m²' });
  });

  test('Grammatur leer aus L-Shop: keine Grammatur, kein Freitext-Ersatz', () => {
    const r = metaEingaben({
      eigenschaften: FREITEXT, farben: ['Black/Red'],
      strukturiert: { faser: '100% Polyester', grammatur: null },
    });
    expect(r.grammatur).toBeNull();
    expect(r.faserangabe).toBe('100% Polyester');
  });

  test('Faser fehlt in der Struktur (z. B. 113 %): Freitext gilt', () => {
    const r = metaEingaben({
      eigenschaften: FREITEXT, farben: ['Ash'],
      strukturiert: { faser: null, grammatur: '150 g/m²' },
    });
    expect(r.faserangabe).toBe('100% Baumwolle');
    expect(r.grammatur).toBe('150 g/m²');
  });

  test('Fallback unveraendert: ohne strukturiert und mit {} dasselbe wie bisher', () => {
    const bisher = metaEingaben({ eigenschaften: FREITEXT, farben: ['Black'], groessen: ['M'] });
    expect(bisher).toEqual({ faserangabe: '100% Baumwolle', faserMeldung: null, grammatur: '180 g/m²' });
    expect(metaEingaben({ eigenschaften: FREITEXT, farben: ['Black'], groessen: ['M'], strukturiert: {} }))
      .toEqual(bisher);
  });

  test('Cap ohne Freitext: nur die Struktur', () => {
    expect(metaEingaben({
      eigenschaften: '', farben: ['Black/Kelly Green', 'Black/Red', 'Black/White'],
      strukturiert: { faser: '100% Polyester', grammatur: null },
    })).toEqual({ faserangabe: '100% Polyester', faserMeldung: null, grammatur: null });
  });
});

describe('buildSeoUserPrompt', () => {
  const basis = { produktname: 'Testartikel', farben: ['Black'], groessen: ['M'], eigenschaften: FREITEXT };

  test('Vorrang: Material aus der Struktur, Freitext-Grammatur ersetzt', () => {
    const { prompt, meldung, faserHinweis } = buildSeoUserPrompt({
      ...basis, strukturiert: { faser: '100% Polyester', grammatur: '150 g/m²' },
    });
    expect(prompt).toContain('- Material: 100% Polyester');
    expect(prompt).toContain('<li><strong>Material:</strong> 100% Polyester</li>');
    expect(prompt).toContain('<li>Grammatur: 150 g/m²</li>');
    expect(prompt).not.toContain('180 g/m²');
    expect(prompt).not.toContain('100% Baumwolle');
    expect(prompt).toContain('Schnitt: gerade');
    expect(meldung).toBeNull();
    expect(faserHinweis).toBeNull();
  });

  test('Grammatur leer aus L-Shop: keine Grammatur im Prompt', () => {
    const { prompt } = buildSeoUserPrompt({ ...basis, strukturiert: { faser: '100% Polyester', grammatur: '' } });
    expect(prompt).not.toMatch(/Grammatur/);
  });

  test('Fallback unveraendert: ohne strukturiert derselbe Prompt wie mit {}', () => {
    const ohne = buildSeoUserPrompt(basis);
    expect(ohne.prompt).toContain('- Material: 100% Baumwolle');
    expect(ohne.prompt).toContain('<li>Grammatur: 180 g/m²</li>');
    expect(buildSeoUserPrompt({ ...basis, strukturiert: {} })).toEqual(ohne);
  });
});
