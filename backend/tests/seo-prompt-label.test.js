// Befehl M2: Der SEO-Prompt erkennt Labels wie seo-meta.js seit 2ccbc5b - am
// ersten Doppelpunkt ODER Tab, ueber labelUndWert().
//
// Anlass (Bericht M, Teil c): Mit L-Shop-Zeilen im Tab-Format landeten im Prompt
// "Material: Materialzusammensetzung<TAB>100% Baumwolle", roh "Grammatur in
// g/m²<TAB>180 g/m²", eine Groessenzeile und eine Farbzeile mit "Sports Grey".
// Beim Oldschool-Shirt standen danach zwei leere <li> unter "Produktdetails".

import { jest } from '@jest/globals';

const getModel        = jest.fn();
const generateContent = jest.fn();
jest.unstable_mockModule('../lib/modelConfig.js', () => ({ getModel }));
jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: () => ({ generateContent }) })),
}));
jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => ({ messages: { create: jest.fn() } })),
}));

let lib, request, app;
beforeAll(async () => {
  lib = await import('../lib/seo-prompt.js');
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  const router  = (await import('../routes/claude.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/claude', router);
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  process.env.GEMINI_API_KEY = 'test-gemini';
  getModel.mockResolvedValue('gemini-3.5-flash-lite');
});
afterEach(() => jest.restoreAllMocks());

// ── Eigenschaftstext des Oldschool-Shirts (E3000), L-Shop-Datenblatt ─────────
// ECHT: abgeschrieben aus dem Screenshot der Maske vom 23.09. Der Trenner
// zwischen Label und Wert war optisch ein Tab - getestet werden Tab UND
// mehrere Leerzeichen (seit M3 beides ein Trenner), dazu die umgekehrte
// Reihenfolge von Material und Zusammensetzung (Jersey zuerst).
const TAB = '\t';
const oldschool = (t = TAB, jerseyZuerst = false) => {
  const zusammensetzung = `Materialzusammensetzung${t}100% Baumwolle (Sports Grey: 85% Baumwolle / 15% Viskose)`;
  const jersey          = `Material${t}Jersey`;
  return [
    ...(jerseyZuerst ? [jersey, zusammensetzung] : [zusammensetzung, jersey]),
    `Grammatur in g/m²${t}180 g/m²`,
    `Größenlauf${t}XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL, 6XL, 7XL, 8XL`,
    `Farbigkeit${t}1-farbig`,
  ].join('\n');
};
const OLDSCHOOL = oldschool();
// Der echte Text hat keine Farbzeile. Fuer die Farb-Tests eine eigene,
// ausdruecklich NACHGEBAUTE Zeile im selben Format.
const MIT_FARBZEILE = `${OLDSCHOOL}\nFarbe${TAB}Rot, Schwarz, Sports Grey`;
const FARBEN   = ['Rot', 'Schwarz'];
const GROESSEN = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];

const prompt = (extra = {}) => lib.buildSeoUserPrompt({
  produktname: 'Crocodiles Hamburg Oldschool T-Shirt Herren', modus: 'kollektion',
  eigenschaften: OLDSCHOOL, farben: FARBEN, groessen: GROESSEN, ...extra,
}).prompt;

// ════════════════════════════════════════════════════════════════════════════
describe('Oldschool-Text im Tab-Format', () => {
  test('Material ohne Label, ohne nicht angebotene Farbe', () => {
    const p = prompt();
    expect(p).toContain('- Material: 100% Baumwolle\n');
    expect(p).toContain('<li><strong>Material:</strong> 100% Baumwolle</li>');
    expect(p).not.toMatch(/Materialzusammensetzung|Sports Grey|Viskose/);
  });

  test('"Material<TAB>Jersey" wird keine Faserangabe, steht als "Material: Jersey" in der Detailliste', () => {
    const r = lib.materialAusEigenschaften(OLDSCHOOL, FARBEN);
    expect(r.material).toBe('100% Baumwolle');
    expect(r.meldung).toBeNull();
    expect(prompt()).toContain('<li>Material: Jersey</li>');
  });

  test('Prompt-Zeilen des echten Textes, genau', () => {
    const zeilen = prompt().split('\n');
    expect(zeilen.filter(z => z.startsWith('- Material:') || z.startsWith('- Weitere'))).toEqual([
      '- Material: 100% Baumwolle',
      '- Weitere Eigenschaften: Material: Jersey; Grammatur: 180 g/m²',
    ]);
    expect(zeilen.filter(z => z.startsWith('<li>'))).toEqual([
      '<li><strong>Material:</strong> 100% Baumwolle</li>',
      '<li><strong>Farben:</strong> Rot, Schwarz</li>',
      '<li><strong>Größen:</strong> XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL</li>',
      '<li>Material: Jersey</li>',
      '<li>Grammatur: 180 g/m²</li>',
    ]);
  });

  test('Grammatur in der Detailliste als "Grammatur: 180 g/m²"', () => {
    const p = prompt();
    expect(p).toContain('<li>Grammatur: 180 g/m²</li>');
    expect(p).toContain('Grammatur: 180 g/m²');
    expect(p).not.toMatch(/Grammatur in g\/m²/);
  });

  test('Groessenlauf bis 8XL faellt raus - Groessen nur aus den Varianten', () => {
    const p = prompt();
    expect(p).not.toMatch(/8XL|Größenlauf/);
    expect(p).toContain('<li><strong>Größen:</strong> XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL</li>');
  });

  test('"Farbigkeit<TAB>1-farbig" faellt ueber die Sperrliste', () => {
    expect(prompt()).not.toMatch(/Farbigkeit|1-farbig/);
    expect(lib.filterEigenschaften([`Farbigkeit${TAB}1-farbig`])).toEqual([]);
  });

  test('Farbzeile mit "Sports Grey" (nachgebaut) faellt raus', () => {
    const p = prompt({ eigenschaften: MIT_FARBZEILE });
    expect(p).not.toMatch(/Sports Grey/);
    expect(p).toContain('<li><strong>Farben:</strong> Rot, Schwarz</li>');
  });

  test('Meta-Beschreibung mit dem echten Text unveraendert', async () => {
    const { metaEingaben, baueMetaBeschreibung } = await import('../lib/seo-meta.js');
    const e = metaEingaben({ eigenschaften: OLDSCHOOL, farben: FARBEN });
    expect(e).toEqual({ faserangabe: '100% Baumwolle', faserMeldung: null, grammatur: '180 g/m²' });
    expect(baueMetaBeschreibung({
      keyphrase: 'Crocodiles Hamburg Oldschool T-Shirt Herren', farben: FARBEN, ...e,
      groessen: GROESSEN, lieferzeit: '21',
    }).text).toBe(
      'Crocodiles Hamburg Oldschool T-Shirt Herren in Rot und Schwarz, 100% Baumwolle, 180 g/m². '
      + 'Größen XS bis 5XL, gedruckt nach Bestellung in Wrist.');
  });

  test('im Prompt steht kein Tab-Zeichen und kein leerer Listenpunkt', () => {
    const p = prompt();
    expect(p).not.toContain(TAB);
    expect(p).not.toMatch(/<li>\s*<\/li>/);
  });

  test.each([
    'Größe', 'Größen', 'Grösse', 'Grössen', 'Groesse', 'Groessen', 'Größenlauf', 'Groessenlauf', 'Size', 'Sizes',
  ])('Groessen-Label "%s" faellt raus, mit Tab und mit Doppelpunkt', label => {
    for (const trenner of [TAB, ': ']) {
      expect(lib.filterEigenschaften([`${label}${trenner}XS - 8XL`, 'Schnitt: Regular Fit']))
        .toEqual(['Schnitt: Regular Fit']);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Befehl M3: Tab UND Leerzeichen, jeweils Jersey vor und nach der
// Zusammensetzung. Ergebnis immer gleich.
describe.each([
  ['Tab', TAB, false], ['Tab', TAB, true],
  ['3 Leerzeichen', '   ', false], ['3 Leerzeichen', '   ', true],
  ['2 Leerzeichen', '  ', false], ['2 Leerzeichen', '  ', true],
])('echter Oldschool-Text, Trenner %s, Jersey zuerst: %s', (_name, trenner, jerseyZuerst) => {
  const text = oldschool(trenner, jerseyZuerst);

  test('Faserangabe immer "100% Baumwolle", keine Meldung', () => {
    const r = lib.materialAusEigenschaften(text, FARBEN);
    expect(r.material).toBe('100% Baumwolle');
    expect(r.meldung).toBeNull();
  });

  test('Prompt: Material, "Material: Jersey", Grammatur; Groessenlauf und Farbigkeit fallen', () => {
    const p = prompt({ eigenschaften: text });
    expect(p).toContain('- Material: 100% Baumwolle\n');
    expect(p).toContain('<li><strong>Material:</strong> 100% Baumwolle</li>');
    expect(p).toContain('<li>Material: Jersey</li>');
    expect(p).toContain('<li>Grammatur: 180 g/m²</li>');
    expect(p).not.toMatch(/Größenlauf|8XL|Farbigkeit|1-farbig|Materialzusammensetzung|Sports Grey/);
    expect(p).not.toContain(TAB);
    // "Jersey" steht nie als Faserangabe
    expect(p).not.toMatch(/- Material: Jersey|<strong>Material:<\/strong> Jersey/);
  });

  test('Meta zeichengenau wie bisher', async () => {
    const { metaEingaben, baueMetaBeschreibung } = await import('../lib/seo-meta.js');
    const e = metaEingaben({ eigenschaften: text, farben: FARBEN });
    expect(e).toEqual({ faserangabe: '100% Baumwolle', faserMeldung: null, grammatur: '180 g/m²' });
    expect(baueMetaBeschreibung({
      keyphrase: 'Crocodiles Hamburg Oldschool T-Shirt Herren', farben: FARBEN, ...e,
      groessen: GROESSEN, lieferzeit: '21',
    }).text).toBe(
      'Crocodiles Hamburg Oldschool T-Shirt Herren in Rot und Schwarz, 100% Baumwolle, 180 g/m². '
      + 'Größen XS bis 5XL, gedruckt nach Bestellung in Wrist.');
  });
});

describe('Trenner: Leerzeichen', () => {
  test('ein einzelnes Leerzeichen trennt nie', () => {
    expect(lib.labelUndWert('Grammatur 180 g/m²')).toBeNull();
    expect(lib.labelUndWert('Material Jersey')).toBeNull();
  });

  test('zwei und mehr Leerzeichen trennen, wenn links ein Label steht', () => {
    expect(lib.labelUndWert('Grammatur in g/m²  180 g/m²')).toEqual({ label: 'Grammatur in g/m²', wert: '180 g/m²' });
    expect(lib.labelUndWert('Material     Jersey')).toEqual({ label: 'Material', wert: 'Jersey' });
    expect(lib.labelUndWert('Farbe(n)  Schwarz')).toEqual({ label: 'Farbe(n)', wert: 'Schwarz' });
  });

  test('kein Label links: Prozent, Ziffer am Anfang, offene Klammer, ueber 40 Zeichen', () => {
    expect(lib.labelUndWert('100%  Baumwolle')).toBeNull();
    expect(lib.labelUndWert('180  g/m²')).toBeNull();
    expect(lib.labelUndWert('Baumwolle (Grau meliert  60% Baumwolle)')).toBeNull();
    expect(lib.labelUndWert(`${'a'.repeat(41)}  Wert`)).toBeNull();
  });

  test('erster Trenner gewinnt: Doppelpunkt vor Leerzeichenfolge', () => {
    expect(lib.labelUndWert('Pflege: 30 °C  Schonwaschgang'))
      .toEqual({ label: 'Pflege', wert: '30 °C  Schonwaschgang' });
  });

  test('ohne Faserzeile: bisheriges Verhalten, Material-Zeile als Material, Meldung der Nachbedingung', () => {
    const r = lib.materialAusEigenschaften(`Material${TAB}Jersey\nMaterial: Baumwolle gekämmt`, FARBEN);
    expect(r.material).toBe('Jersey');
    expect(r.detailLines).toEqual([]);            // weitere Material-Zeilen fallen weg wie bisher
  });

  test('Faserzeile ohne Label gewinnt ebenfalls', () => {
    const r = lib.materialAusEigenschaften(`Material${TAB}Jersey\n80 % Baumwolle, 20 % Polyester`, FARBEN);
    expect(r.material).toBe('80 % Baumwolle, 20 % Polyester');
    expect(r.detailLines).toEqual(['Material: Jersey']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Doppelpunkt-Format unveraendert', () => {
  const DOPPELPUNKT = [
    'Material: 80% Baumwolle, 20% Polyester',
    'Grammatur: 280 g/m²',
    'Stoffgewicht: 300 g/m²',
    'Schnitt:Regular Fit',
    'Farbe(n): Schwarz',
    'Größen: S - 5XL',
  ].join('\n');

  test('Zeilen bleiben woertlich, Farbe(n) und Groessen fallen wie bisher raus', () => {
    const p = lib.buildSeoUserPrompt({
      produktname: 'X', modus: 'kollektion', eigenschaften: DOPPELPUNKT, farben: ['Schwarz'], groessen: ['S'],
    }).prompt;
    expect(p).toContain('<li><strong>Material:</strong> 80% Baumwolle, 20% Polyester</li>');
    expect(p).toContain('<li>Grammatur: 280 g/m²</li>');
    expect(p).toContain('<li>Stoffgewicht: 300 g/m²</li>');
    expect(p).toContain('<li>Schnitt:Regular Fit</li>');
    expect(p).not.toMatch(/Farbe\(n\)|S - 5XL/);
  });

  test('Material ohne Prozent: "Material:" faellt wie bisher, anderes Label bleibt', () => {
    expect(lib.materialAusEigenschaften('Material: Baumwolle').materialRoh).toBe('Baumwolle');
    expect(lib.materialAusEigenschaften('Materialmix: Baumwolle').materialRoh).toBe('Materialmix: Baumwolle');
  });

  test('Klammer mit Doppelpunkt ist kein Label', () => {
    expect(lib.labelUndWert('Baumwolle (Grau meliert: 60% Baumwolle)')).toBeNull();
    expect(lib.labelUndWert('Farbe(n): Schwarz')).toEqual({ label: 'Farbe(n)', wert: 'Schwarz' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Rangfolge der Farben (Punkt 3)', () => {
  test('Variantenauswahl vorhanden -> Farbzeile aus den Eigenschaften zaehlt nicht', () => {
    expect(lib.materialAusEigenschaften(MIT_FARBZEILE, FARBEN).farbListe).toEqual(['Rot', 'Schwarz']);
  });

  test('keine Variantenauswahl -> Farbzeile zaehlt, auch im Tab-Format', () => {
    expect(lib.materialAusEigenschaften(MIT_FARBZEILE, []).farbListe).toEqual(['Rot', 'Schwarz', 'Sports Grey']);
    expect(lib.materialAusEigenschaften(MIT_FARBZEILE, undefined).farbListe).toEqual(['Rot', 'Schwarz', 'Sports Grey']);
  });

  test('ohne Variantenauswahl bleibt die Sports-Grey-Ausnahme im Material (Farbe angeboten)', () => {
    expect(lib.materialAusEigenschaften(MIT_FARBZEILE, []).material)
      .toBe('100% Baumwolle (Sports Grey: 85% Baumwolle / 15% Viskose)');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('leere Listenpunkte (Punkt 4)', () => {
  test.each([
    ['<li></li>'], ['<li> </li>'], ['<li>\n</li>'], ['<li><br></li>'], ['<li><br/></li>'],
    ['<li>&nbsp;</li>'], ['<li><strong></strong></li>'], ['<li><strong> </strong></li>'], ['<LI class="x"></LI>'],
  ])('%j wird entfernt', leer => {
    const r = lib.entferneLeereLi(`<ul>\n<li>A</li>\n${leer}\n<li>B</li>\n</ul>`);
    expect(r.html).toBe('<ul>\n<li>A</li>\n<li>B</li>\n</ul>');
    expect(r.entfernt).toBe(1);
  });

  test('Listenpunkte mit Inhalt bleiben, auch nur <strong>', () => {
    const html = '<ul><li><strong>Material:</strong> 100% Baumwolle</li><li><strong>X</strong></li></ul>';
    expect(lib.entferneLeereLi(html)).toEqual({ html, entfernt: 0 });
  });

  test('leer gewordene <ul> faellt mit', () => {
    expect(lib.entferneLeereLi('<p>a</p>\n<ul>\n<li></li>\n</ul>\n<p>b</p>').html).toBe('<p>a</p>\n<p>b</p>');
  });

  test('Route: leere <li> in Beschreibung UND Kurzbeschreibung entfernt, Hinweis gemeldet', async () => {
    const lang = '<h2>Retro-Vereinslogo im Brustdruck</h2><p>Crocodiles Hamburg Oldschool T-Shirt Herren mit Logo.</p>'
      + '<h3>Produktdetails</h3>\n<ul>\n<li><strong>Material:</strong> 100% Baumwolle</li>\n<li></li>\n<li> </li>\n</ul>';
    const kurz = '<p>Crocodiles Hamburg Oldschool T-Shirt Herren mit Logo.</p><ul><li><br></li></ul>';
    generateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify({ kurzbeschreibung: kurz, produktbeschreibung: lang }) } });

    const res = await request(app).post('/api/claude/generate-product').send({
      action: 'seo_description', produktname: 'Crocodiles Hamburg Oldschool T-Shirt Herren', modus: 'kollektion',
      eigenschaften: OLDSCHOOL, farben: FARBEN, groessen: GROESSEN,
    });

    expect(res.status).toBe(200);
    expect(res.body.full_description).not.toMatch(/<li>\s*<\/li>/);
    expect(res.body.full_description).toContain('<li><strong>Material:</strong> 100% Baumwolle</li>');
    expect(res.body.short_description).toBe('<p>Crocodiles Hamburg Oldschool T-Shirt Herren mit Logo.</p>');
    expect(res.body.hinweise).toContain('3 leere Listenpunkte entfernt.');
  });
});
