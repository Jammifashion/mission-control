// Hat ein Artikel Variantenachsen, muss eine davon Farbe sein.
//
// Anlass: BCWU03K, am 22.09. ohne Farbachse angelegt - Varianten-SKU
// BCWU03K/CH-Skyline-4xl statt ...-schwarz-4xl.
//
// Zwei Ebenen, wie bei den SKU-Regeln:
//  1. backend/lib/varianten-achsen.js - die Regel selbst
//  2. der markierte Block in index.html - muss dieselben Ergebnisse liefern,
//     sonst meldet das Frontend etwas anderes als das Backend erzwingt

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import {
  FARB_ACHSE, istFarbAchse, achsenAusAttributen, achsenAusVarianten,
  achsenVon, achsenGleich, pruefeFarbAchse,
} from '../lib/varianten-achsen.js';

const html = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8',
);

// ── Frontend-Block herausschneiden und ausfuehren ───────────────────────────
const START = '// ── Farbachsen-Regel: Anfang';
const ENDE  = '// ── Farbachsen-Regel: Ende ──';
const von   = html.indexOf(START);
const bis   = html.indexOf(ENDE);
const block = html.slice(von, bis);

const fe = new Function(`${block}
  return { istFarbAchse, achsenAusVarianten, achsenGleich, pruefeFarbAchse };`)();

// Achsen als Varianten-Form, wie sie Frontend und Backend sehen.
const mitAchsen = (...namen) => [{ attrs: namen.map(n => ({ name: n, value: 'x' })) }];

test('der Frontend-Block wurde gefunden und benutzt nichts aus dem Seitenkontext', () => {
  expect(von).toBeGreaterThan(-1);
  expect(bis).toBeGreaterThan(von);
  expect(block).not.toMatch(/document\.|apiFetch|showToast|variants\b/);
});

// ── Die exakte Schreibweise ─────────────────────────────────────────────────
// Dritter Fall dieser Art im Projekt (ss/ss in den Groessen-Regexen,
// "Farbe(n):" im Label-Regex). Darum steht GENAU diese Schreibweise im Test,
// nicht eine aehnliche.
describe('Schreibweise "Farbe"', () => {
  test('exakt so, wie es in SSOT, Varianten-Reiter und WooCommerce steht', () => {
    expect(FARB_ACHSE).toBe('Farbe');
    expect(istFarbAchse('Farbe')).toBe(true);
    expect(fe.istFarbAchse('Farbe')).toBe(true);
  });

  test('Gross/Klein und Rand-Leerzeichen egal', () => {
    for (const form of ['farbe', 'FARBE', 'FaRbE', '  Farbe  ']) {
      expect(istFarbAchse(form)).toBe(true);
      expect(fe.istFarbAchse(form)).toBe(true);
    }
  });

  test('leer ist keine Farbachse', () => {
    for (const leer of ['', '   ', null, undefined]) {
      expect(istFarbAchse(leer)).toBe(false);
      expect(fe.istFarbAchse(leer)).toBe(false);
    }
  });
});

// ── Negativtests: die Rueckbausperre ────────────────────────────────────────
// Diese Faelle verhindern, dass die Erkennung spaeter auf einen Teilstring
// zurueckgebaut wird. Alle drei stehen echt in der SSOT und enthalten "farbe".
describe('andere Eigenschaften mit "farbe" im Namen erfuellen die Regel NICHT', () => {
  test.each([
    ['Druckfarbe'],
    ['Schriftfarbe'],
    ['Farbe des Wunschnamens'],
  ])('%s ist nicht die Artikelfarbe', (name) => {
    expect(istFarbAchse(name)).toBe(false);
    expect(fe.istFarbAchse(name)).toBe(false);
    // und erfuellt die Regel auch nicht zusammen mit einer echten Achse
    expect(pruefeFarbAchse(['Größe', name])).not.toBeNull();
    expect(fe.pruefeFarbAchse(['Größe', name])).toBeTruthy();
  });

  test('ein Teilstring-Vergleich wuerde hier durchrutschen', () => {
    // Genau das darf NICHT passieren: /farbe/i traefe alle drei.
    for (const name of ['Druckfarbe', 'Schriftfarbe', 'Farbe des Wunschnamens']) {
      expect(/farbe/i.test(name)).toBe(true);   // der alte, untaugliche Weg
      expect(istFarbAchse(name)).toBe(false);   // der neue, exakte
    }
  });
});

// ── Die Regel ───────────────────────────────────────────────────────────────
describe('pruefeFarbAchse', () => {
  test('Groesse ohne Farbe -> Fehler mit Feldname', () => {
    const f = pruefeFarbAchse(['Größe']);
    expect(f).not.toBeNull();
    expect(f.feld).toBe('Variantenachsen');
    expect(f.fehler).toMatch(/Farbe/);
    expect(fe.pruefeFarbAchse(['Größe'])).toBeTruthy();
  });

  test('Farbe und Groesse -> geht durch', () => {
    expect(pruefeFarbAchse(['Farbe', 'Größe'])).toBeNull();
    expect(fe.pruefeFarbAchse(['Farbe', 'Größe'])).toBeNull();
  });

  test('nur Farbe -> geht durch', () => {
    expect(pruefeFarbAchse(['Farbe'])).toBeNull();
    expect(fe.pruefeFarbAchse(['Farbe'])).toBeNull();
  });

  test('Groesse + Farbe + Druckfarbe -> geht durch, die Farbe ist ja da', () => {
    expect(pruefeFarbAchse(['Größe', 'Farbe', 'Druckfarbe'])).toBeNull();
    expect(fe.pruefeFarbAchse(['Größe', 'Farbe', 'Druckfarbe'])).toBeNull();
  });

  test('GAR KEINE Achse -> Regel greift nicht (Puck, Kuscheltier, Fan-Schal)', () => {
    for (const ohne of [[], null, undefined, ['', '  ']]) {
      expect(pruefeFarbAchse(ohne)).toBeNull();
      expect(fe.pruefeFarbAchse(ohne)).toBeNull();
    }
  });

  test('der Fehlertext nennt die gefundenen Achsen und warnt vor den Namensvettern', () => {
    const f = pruefeFarbAchse(['Größe', 'Druckfarbe']);
    expect(f.fehler).toMatch(/Größe/);
    expect(f.fehler).toMatch(/Druckfarbe/);
    expect(f.fehler).toMatch(/zaehlen NICHT|zählen NICHT/);
  });
});

// ── Achsen einsammeln ───────────────────────────────────────────────────────
describe('achsenVon', () => {
  test('aus den Produkt-Attributen', () => {
    expect(achsenAusAttributen([{ name: 'Farbe' }, { name: 'Größe' }])).toEqual(['Farbe', 'Größe']);
  });

  test('ein Attribut mit variation:false ist keine Achse', () => {
    // Datenblatt-Zeile am Produkt - darf die Regel weder erfuellen noch ausloesen.
    expect(achsenAusAttributen([{ name: 'Material', variation: false }])).toEqual([]);
    expect(pruefeFarbAchse(achsenVon({ attribute: [{ name: 'Material', variation: false }] }))).toBeNull();
  });

  test('aus den Varianten, beide Schreibweisen', () => {
    expect(achsenAusVarianten([{ attrs: [{ name: 'Farbe' }] }])).toEqual(['Farbe']);
    expect(achsenAusVarianten([{ attributes: [{ name: 'Größe' }] }])).toEqual(['Größe']);
    expect(fe.achsenAusVarianten(mitAchsen('Farbe', 'Größe'))).toEqual(['Farbe', 'Größe']);
  });

  test('Dubletten fallen weg, Schreibweise egal', () => {
    expect(achsenAusVarianten([
      { attrs: [{ name: 'Farbe' }] },
      { attrs: [{ name: 'farbe' }] },
    ])).toEqual(['Farbe']);
  });

  test('Attribute und Varianten zusammen', () => {
    expect(achsenVon({
      attribute: [{ name: 'Farbe' }],
      varianten: [{ attributes: [{ name: 'Größe' }] }],
    })).toEqual(['Farbe', 'Größe']);
  });
});

describe('achsenGleich - Grundlage des Aenderungspfads', () => {
  test('Reihenfolge und Schreibweise egal', () => {
    expect(achsenGleich(['Farbe', 'Größe'], ['größe', 'FARBE'])).toBe(true);
    expect(fe.achsenGleich(['Farbe', 'Größe'], ['größe', 'FARBE'])).toBe(true);
  });

  test('eine Achse mehr oder weniger ist nicht gleich', () => {
    expect(achsenGleich(['Größe'], ['Größe', 'Farbe'])).toBe(false);
    expect(achsenGleich(['Größe'], ['Druckfarbe'])).toBe(false);
    expect(fe.achsenGleich(['Größe'], ['Größe', 'Farbe'])).toBe(false);
  });
});
