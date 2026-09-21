// Tier-1 – reine Datenaufbereitung für den SEO-Prompt, keine Mocks nötig.

import {
  filterMaterialFarben,
  filterEigenschaften,
  farbenAusEigenschaften,
  parseFarben,
  parseGroessen,
  hauptKeyword,
  pruefeSeoText,
  pruefeH2,
  h2KorrekturBlock,
  buildSeoUserPrompt,
  resolveModus,
  MATERIAL_PLACEHOLDER,
  MODUS_KOLLEKTION,
} from '../lib/seo-prompt.js';

// ── Doppelte Farbzeile (Befund 21.09.) ──────────────────────────────────────
// In der Detailliste stand "Farben: Farbe(n): Schwarz" und darunter noch einmal
// "Farbe(n): Schwarz". Zwei Ursachen: das Label "Farbe(n):" wurde vom alten
// Muster nicht abgeschnitten und blieb im Wert stehen, und dieselbe Zeile lief
// zusaetzlich ueber "Weitere Eigenschaften" durch.
describe('Farbzeile aus den Eigenschaften', () => {
  test.each([
    ['Farbe(n): Schwarz'],
    ['Farbe: Schwarz'],
    ['Farben: Schwarz'],
    ['Verfügbare Farben: Schwarz'],
  ])('%s – Wert wird sauber ausgelesen', (zeile) => {
    expect(farbenAusEigenschaften([zeile])).toEqual(['Schwarz']);
  });

  test('mehrere Farben und Trennzeichen', () => {
    expect(farbenAusEigenschaften(['Farbe(n): Schwarz, Navy / Grau meliert']))
      .toEqual(['Schwarz', 'Navy', 'Grau meliert']);
  });

  test('"Farbigkeit" ist keine Farbzeile – die faellt ueber die Sperrliste', () => {
    expect(farbenAusEigenschaften(['Farbigkeit: 1-farbig, Meliert'])).toEqual([]);
  });

  test('filterEigenschaften entfernt die Farbzeile, Singular wie Plural', () => {
    for (const zeile of ['Farbe(n): Schwarz', 'Farbe: Schwarz', 'Farben: Schwarz']) {
      expect(filterEigenschaften([zeile, 'Grammatur: 280 g/m²'])).toEqual(['Grammatur: 280 g/m²']);
    }
  });

  test.each([
    ['Farbe(n): Schwarz'],
    ['Farbe: Schwarz'],
  ])('fertiger Prompt mit "%s": Farbe genau einmal, Liste kommt an', (farbZeile) => {
    const prompt = buildSeoUserPrompt({
      produktname: 'Shirt',
      eigenschaften: `Material: 100% Baumwolle\n${farbZeile}\nGrammatur: 280 g/m²`,
    });

    // Die Farbliste ist trotz Entfernen der Zeile angekommen.
    expect(prompt).toContain('- FARBEN: Schwarz');
    expect(prompt).toContain('<li><strong>Farben:</strong> Schwarz</li>');

    // Kein doppeltes Label und keine zweite Zeile – beide Eintrittsstellen.
    expect(prompt).not.toMatch(/Farben:\s*Farbe/);
    expect(prompt).not.toContain('<li>Farbe(n): Schwarz</li>');
    expect(prompt).not.toContain('<li>Farbe: Schwarz</li>');
    const weitere = prompt.split('\n').find(z => z.startsWith('- Weitere Eigenschaften:'));
    expect(weitere).toBeDefined();
    expect(weitere).not.toMatch(/Farbe/);
    expect(weitere).toContain('Grammatur: 280 g/m²');

    // "Schwarz" steht genau zweimal: FARBEN-Zeile und <li>.
    expect(prompt.match(/Schwarz/g)).toHaveLength(2);
  });

  test('die Farbliste erreicht filterMaterialFarben', () => {
    const prompt = buildSeoUserPrompt({
      produktname: 'Shirt',
      eigenschaften: 'Material: 100% Baumwolle (Ash: 99% Baumwolle)\nFarbe(n): Schwarz',
    });

    // Ash ist nicht angeboten -> die Ausnahme muss verschwinden. Das gelingt
    // nur, wenn die Farbliste trotz entfernter Zeile bekannt ist.
    expect(prompt).not.toMatch(/Ash/);
    expect(prompt).toContain('- Material: 100% Baumwolle');
  });
});

describe('pruefeH2 – eigene Funktion fuer den Wiederholungslauf', () => {
  const lang = h2 => `<h2>${h2}</h2><p>Text.</p>`;

  test('sauber: keine Meldung', () => {
    expect(pruefeH2(lang('Schnitt und Material'), 'Ugly Sweater Rentier')).toEqual([]);
  });

  test('Titel in der <h2>', () => {
    const m = pruefeH2(lang('Ugly Sweater Rentier für den Alltag'), 'Ugly Sweater Rentier');
    expect(m.some(x => /enthält den Produkttitel/.test(x))).toBe(true);
  });

  test('zu lang', () => {
    expect(pruefeH2(lang('Eins zwei drei vier fünf sechs sieben acht neun'), 'Shirt')
      .some(x => /höchstens 8/.test(x))).toBe(true);
  });

  test('fehlende <h2>', () => {
    expect(pruefeH2('<p>Nur Text.</p>', 'Shirt').some(x => /keine <h2>/.test(x))).toBe(true);
  });

  test('pruefeSeoText enthaelt dieselben Meldungen weiterhin', () => {
    const meldungen = pruefeSeoText({
      kurzbeschreibung: 'Ugly Sweater Rentier, jetzt bestellen.',
      produktbeschreibung: '<h2>Ugly Sweater Rentier</h2><p>Ugly Sweater Rentier aus Baumwolle.</p>',
      produktname: 'Ugly Sweater Rentier',
    });
    expect(meldungen.some(x => /enthält den Produkttitel/.test(x))).toBe(true);
  });
});

describe('h2KorrekturBlock', () => {
  test('nennt den Verstoss und beide Beispiele', () => {
    const block = h2KorrekturBlock(['Die <h2> enthält den Produkttitel ("X für alle").']);
    expect(block).toContain('KORREKTUR');
    expect(block).toContain('X für alle');
    expect(block).toContain('falsch:  "Das <Produkttitel> für den Alltag"');
    expect(block).toContain('richtig: "Mehrfarbiger Brustdruck auf schwarzem Jersey"');
  });
});

describe('filterMaterialFarben', () => {
  test('(a) Ausnahmen für nicht gewählte Farben verschwinden', () => {
    const material = '85% Baumwolle, 15% Viskose (Grau meliert: 60% Baumwolle, 40% Polyester)';
    const result = filterMaterialFarben(material, ['Schwarz', 'Navy']);

    expect(result).toBe('85% Baumwolle, 15% Viskose');
    expect(result).not.toMatch(/Grau/i);
    expect(result).not.toMatch(/Polyester/i);
  });

  test('(b) Ausnahmen für gewählte Farben bleiben erhalten', () => {
    const material = '85% Baumwolle, 15% Viskose (Grau meliert: 60% Baumwolle, 40% Polyester)';
    const result = filterMaterialFarben(material, ['Schwarz', 'Grau meliert']);

    expect(result).toBe('85% Baumwolle, 15% Viskose (Grau meliert: 60% Baumwolle, 40% Polyester)');
  });

  test('(c) leeres Material ergibt den Platzhalter', () => {
    expect(filterMaterialFarben('', ['Schwarz'])).toBe(MATERIAL_PLACEHOLDER);
    expect(filterMaterialFarben('   ', ['Schwarz'])).toBe(MATERIAL_PLACEHOLDER);
    expect(filterMaterialFarben(undefined, ['Schwarz'])).toBe(MATERIAL_PLACEHOLDER);
    expect(filterMaterialFarben(null, [])).toBe(MATERIAL_PLACEHOLDER);
  });

  test('mehrere Ausnahmen in einer Klammer: nur die angebotene bleibt', () => {
    const material =
      '100% Baumwolle (Ash: 99% Baumwolle, 1% Viskose; Sport Grey: 85% Baumwolle, 15% Viskose)';
    const result = filterMaterialFarben(material, ['Sport Grey', 'Schwarz']);

    expect(result).toBe('100% Baumwolle (Sport Grey: 85% Baumwolle, 15% Viskose)');
    expect(result).not.toMatch(/Ash/);
  });

  test('mehrere Klammern werden einzeln geprüft', () => {
    const material = '100% Baumwolle (Ash: 99% Baumwolle) (Navy: 95% Baumwolle, 5% Elasthan)';
    expect(filterMaterialFarben(material, ['Navy'])).toBe(
      '100% Baumwolle (Navy: 95% Baumwolle, 5% Elasthan)',
    );
  });

  test('Klausel für mehrere Farben wird auf die angebotenen eingekürzt', () => {
    const material = '100% Baumwolle (Ash und Sport Grey: 90% Baumwolle, 10% Viskose)';
    expect(filterMaterialFarben(material, ['Sport Grey'])).toBe(
      '100% Baumwolle (Sport Grey: 90% Baumwolle, 10% Viskose)',
    );
  });

  test('Klammer ohne Farbbezug bleibt unangetastet', () => {
    const material = '100% Baumwolle (vorgeschrumpft)';
    expect(filterMaterialFarben(material, ['Navy'])).toBe('100% Baumwolle (vorgeschrumpft)');
  });

  test('Sachlabel wie "Pflege" wird nicht als unbekannte Farbe gelöscht', () => {
    const material = '100% Baumwolle (Pflege: 30°C Schonwaschgang)';
    expect(filterMaterialFarben(material, ['Navy'])).toBe('100% Baumwolle (Pflege: 30°C Schonwaschgang)');
  });

  test('gemischte Klammer: Sachangabe bleibt, fremde Farbe fliegt raus', () => {
    const material = '100% Baumwolle (vorgeschrumpft; Ash: 99% Baumwolle, 1% Viskose)';
    expect(filterMaterialFarben(material, ['Navy'])).toBe('100% Baumwolle (vorgeschrumpft)');
  });

  test('ohne bekannte Farbliste wird nichts entfernt', () => {
    const material = '100% Baumwolle (Ash: 99% Baumwolle, 1% Viskose)';
    expect(filterMaterialFarben(material, [])).toBe(material);
  });

  test('Farbvergleich ignoriert Schreibweise, Umlaute und Bindestriche', () => {
    const material = '100% Baumwolle (Grau-Meliert: 90% Baumwolle, 10% Polyester)';
    expect(filterMaterialFarben(material, ['grau meliert'])).toMatch(/Grau-Meliert/);
    expect(filterMaterialFarben('100% Baumwolle (Weiss: 100% Baumwolle)', ['Weiß'])).toMatch(/Weiss/);
  });

  test('Material, das nur aus einer fremden Ausnahme besteht, ergibt den Platzhalter', () => {
    expect(filterMaterialFarben('(Ash: 99% Baumwolle)', ['Navy'])).toBe(MATERIAL_PLACEHOLDER);
  });
});

describe('resolveModus', () => {
  test('unbekannter MODUS -> kollektion + Warnung gesetzt', () => {
    const { modus, warnung } = resolveModus('Auftraggeber');

    expect(modus).toBe(MODUS_KOLLEKTION);
    expect(warnung).toBeTruthy();
    expect(warnung).toContain('Auftraggeber');   // empfangener Wert steht drin
    expect(warnung).toMatch(/kollektion, auftrag/);
  });

  test('fehlender MODUS -> kollektion + Warnung gesetzt', () => {
    for (const eingabe of [undefined, null, '', '   ']) {
      const { modus, warnung } = resolveModus(eingabe);
      expect(modus).toBe(MODUS_KOLLEKTION);
      expect(warnung).toMatch(/MODUS fehlt/);
    }
  });

  test('gültige Werte kommen ohne Warnung durch, Schreibweise egal', () => {
    expect(resolveModus('kollektion')).toEqual({ modus: 'kollektion', warnung: null });
    expect(resolveModus('auftrag')).toEqual({ modus: 'auftrag', warnung: null });
    expect(resolveModus('  Auftrag  ')).toEqual({ modus: 'auftrag', warnung: null });
  });

  test('Warnung benennt die Folge: kein Freigabe-Hinweis', () => {
    expect(resolveModus('tippfehler').warnung).toMatch(/kein Freigabe-Hinweis/);
  });
});

describe('parseFarben', () => {
  test('liest Array, Label-Zeile und Trennzeichen', () => {
    expect(parseFarben(['Schwarz', 'Navy'])).toEqual(['Schwarz', 'Navy']);
    expect(parseFarben('Farben: Schwarz, Navy / Grau meliert')).toEqual([
      'Schwarz', 'Navy', 'Grau meliert',
    ]);
    expect(parseFarben('')).toEqual([]);
  });

  test('entfernt Dubletten unabhängig von der Schreibweise', () => {
    expect(parseFarben('Schwarz, schwarz, SCHWARZ')).toEqual(['Schwarz']);
  });
});

describe('buildSeoUserPrompt', () => {
  const basis = {
    produktname: 'Ugly Sweater Rentier',
    eigenschaften: 'Material: 100% Baumwolle (Ash: 99% Baumwolle, 1% Viskose)\nFarben: Navy, Schwarz\nGrammatur: 280 g/m²',
    hinweise: 'Weihnachtsfeier, Kollegen',
  };

  test('(d) MODUS "kollektion" erzeugt keinen Freigabe-Hinweis', () => {
    const prompt = buildSeoUserPrompt({ ...basis, modus: 'kollektion' });

    expect(prompt).toContain('MODUS: kollektion');
    expect(prompt).not.toMatch(/Freigabe/i);
  });

  test('MODUS "auftrag" erzeugt den Freigabe-Hinweis', () => {
    const prompt = buildSeoUserPrompt({ ...basis, modus: 'auftrag' });

    expect(prompt).toContain('MODUS: auftrag');
    expect(prompt).toMatch(/FREIGABE:/);
  });

  test('ohne MODUS gilt kollektion – kein Freigabe-Hinweis', () => {
    const prompt = buildSeoUserPrompt(basis);

    expect(prompt).toContain('MODUS: kollektion');
    expect(prompt).not.toMatch(/Freigabe/i);
  });

  test('unbekannter MODUS verspricht keine Freigabe, sondern fällt auf kollektion', () => {
    const prompt = buildSeoUserPrompt({ ...basis, modus: 'Auftraggeber' });

    expect(prompt).toContain('MODUS: kollektion');
    expect(prompt).not.toMatch(/Freigabe/i);
  });

  test('MOTIV wird übernommen, sonst Platzhalter statt Erfindung', () => {
    expect(buildSeoUserPrompt({ ...basis, motiv: 'Rentier mit Sonnenbrille' }))
      .toContain('- MOTIV: Rentier mit Sonnenbrille');
    expect(buildSeoUserPrompt(basis)).toMatch(/- MOTIV: keine Angabe – Motiv nicht erfinden/);
  });

  test('Material wird vor dem Prompt gefiltert, FARBEN werden gelistet', () => {
    const prompt = buildSeoUserPrompt(basis);

    expect(prompt).toContain('- FARBEN: Navy, Schwarz');
    expect(prompt).toContain('- Material: 100% Baumwolle');
    expect(prompt).not.toMatch(/Ash/);
    expect(prompt).not.toMatch(/Viskose/);
  });

  test('"Weitere Eigenschaften" reicht den ungefilterten Materialstring nicht durch', () => {
    const prompt = buildSeoUserPrompt(basis);
    const weitere = prompt.split('\n').find(z => z.startsWith('- Weitere Eigenschaften:'));

    expect(weitere).toBeDefined();
    expect(weitere).not.toMatch(/Ash|Viskose/);
    expect(weitere).toContain('Grammatur: 280 g/m²');
  });

  test('farben aus dem Request schlagen die Eigenschaften-Zeile', () => {
    const prompt = buildSeoUserPrompt({ ...basis, farben: ['Ash'] });

    expect(prompt).toContain('- FARBEN: Ash');
    expect(prompt).toContain('(Ash: 99% Baumwolle, 1% Viskose)');
  });

  test('fehlendes Material ergibt den Platzhalter im Prompt und im <li>', () => {
    const prompt = buildSeoUserPrompt({ produktname: 'Shirt', eigenschaften: 'Farben: Navy' });

    expect(prompt).toContain(`- Material: ${MATERIAL_PLACEHOLDER}`);
    expect(prompt).toContain(`<li><strong>Material:</strong> ${MATERIAL_PLACEHOLDER}</li>`);
  });

  test('kein <h1> in der Strukturvorgabe', () => {
    const prompt = buildSeoUserPrompt(basis);

    expect(prompt).not.toContain('<h1>');
    expect(prompt).toContain('<h2>');
    expect(prompt).toContain('<h3>Produktdetails</h3>');
  });

  test('Material-Label wird im <li> nicht doppelt gesetzt', () => {
    const prompt = buildSeoUserPrompt(basis);

    expect(prompt).not.toMatch(/<strong>Material:<\/strong> Material:/);
  });

  test('Farben stehen als eigene Zeile in der Detailliste', () => {
    expect(buildSeoUserPrompt(basis)).toContain('<li><strong>Farben:</strong> Navy, Schwarz</li>');
  });

  test('Strukturvorgabe verlangt keinen Titel und keinen Slogan in der <h2>', () => {
    const prompt = buildSeoUserPrompt(basis);

    expect(prompt).not.toMatch(/\[Artikelbezeichnung\]/);
    expect(prompt).not.toMatch(/Slogan basierend auf Kontext/);
    expect(prompt).toMatch(/NICHT der Produkttitel/);
  });

  test('Regel gegen erfundene Fakten steht im Prompt', () => {
    const prompt = buildSeoUserPrompt(basis);

    expect(prompt).toMatch(/keine Orte/);
    expect(prompt).toMatch(/Bestellschlussdaten/);
  });
});

describe('filterEigenschaften – Sperrliste vor dem Prompt', () => {
  test('Sperrbegriffe fliegen zeilenweise raus', () => {
    const lines = [
      'Farbigkeit: 1-farbig, Meliert, Pastell',
      'Veredelungsangabe: Siebdruck möglich',
      'Verarbeitung: doppelt vernäht',
      'Grammatur: 280 g/m²',
    ];

    expect(filterEigenschaften(lines)).toEqual(['Grammatur: 280 g/m²']);
  });

  test('Größenzeilen aus dem Katalog fliegen raus, auch "Größenlauf"', () => {
    const lines = ['Größen: S bis 5XL', 'Größenlauf: S-XXL', 'Sizes: S-XL', 'Schnitt: Regular Fit'];

    expect(filterEigenschaften(lines)).toEqual(['Schnitt: Regular Fit']);
  });

  test('eine Zeile, die Größe nur im Wert erwähnt, bleibt stehen', () => {
    expect(filterEigenschaften(['Passform: fällt eine Größe kleiner aus']))
      .toEqual(['Passform: fällt eine Größe kleiner aus']);
  });
});

describe('Sperrliste im fertigen Prompt – beide Eintrittsstellen', () => {
  // Nicht nur die Filterfunktion prüfen: gefilterte Zeilen tauchen sonst über
  // das Sammelfeld "Weitere Eigenschaften" wieder im Prompt auf.
  const eigenschaften = [
    'Material: 100% Baumwolle',
    'Farbigkeit: 1-farbig, Meliert, Pastell',
    'Veredelungsangabe: Siebdruck',
    'Verarbeitung: doppelt vernäht',
    'Grammatur: 280 g/m²',
  ].join('\n');

  test('weder im Sammelfeld noch in der <li>-Liste', () => {
    const prompt = buildSeoUserPrompt({ produktname: 'Shirt', eigenschaften });

    expect(prompt).not.toMatch(/Farbigkeit/i);
    expect(prompt).not.toMatch(/Veredelungsangabe/i);
    expect(prompt).not.toMatch(/Verarbeitung/i);
    expect(prompt).toContain('Grammatur: 280 g/m²');
  });
});

describe('Größen kommen nur aus der Variantenauswahl', () => {
  const eigenschaften = 'Material: 100% Baumwolle\nGrößen: S bis 5XL';

  test('Variantengrößen stehen im Prompt, die Katalogzeile nicht', () => {
    const prompt = buildSeoUserPrompt({ produktname: 'Shirt', eigenschaften, groessen: ['M', 'L'] });

    expect(prompt).toContain('- GRÖSSEN: M, L');
    expect(prompt).toContain('<li><strong>Größen:</strong> M, L</li>');
    expect(prompt).not.toMatch(/5XL/);
  });

  test('ohne Größen-Variante keine Größenzeile', () => {
    const prompt = buildSeoUserPrompt({ produktname: 'Shirt', eigenschaften });

    expect(prompt).not.toMatch(/- GRÖSSEN:/);
    expect(prompt).not.toMatch(/<strong>Größen:<\/strong>/);
    expect(prompt).not.toMatch(/5XL/);
    expect(prompt).toMatch(/NENNE KEINE Größen/);
  });

  test('parseGroessen liest Array, Label-Zeile und Dubletten weg', () => {
    expect(parseGroessen(['M', 'L'])).toEqual(['M', 'L']);
    expect(parseGroessen('Größen: M, L')).toEqual(['M', 'L']);
    expect(parseGroessen('M, m, M')).toEqual(['M']);
    expect(parseGroessen('')).toEqual([]);
  });
});

describe('hauptKeyword', () => {
  test('gesetzte Keyphrase gewinnt', () => {
    const k = hauptKeyword({ keyphrase: 'Weihnachtspullover Herren', produktname: 'Ugly Sweater' });

    expect(k.text).toBe('Weihnachtspullover Herren');
    expect(k.ausTitel).toBe(false);
    expect(k.woerter).toEqual(['weihnachtspullover', 'herren']);
  });

  test('leere Keyphrase: Produkttitel ohne Farbe und Größe', () => {
    const k = hauptKeyword({
      keyphrase: '',
      produktname: 'Ugly Sweater Rentier Navy XL',
      farben: ['Navy'],
      groessen: ['XL'],
    });

    expect(k.text).toBe('Ugly Sweater Rentier');
    expect(k.ausTitel).toBe(true);
  });

  test('nur Leerzeichen zählt als leer', () => {
    expect(hauptKeyword({ keyphrase: '   ', produktname: 'Shirt' }).ausTitel).toBe(true);
  });

  test('Keyphrase steht im Prompt, sonst die Ableitung aus dem Titel', () => {
    expect(buildSeoUserPrompt({ produktname: 'Shirt', keyphrase: 'Weihnachtspullover Herren' }))
      .toContain('FOKUS-KEYPHRASE: Weihnachtspullover Herren');
    expect(buildSeoUserPrompt({ produktname: 'Ugly Sweater Navy', farben: ['Navy'] }))
      .toContain('FOKUS-KEYPHRASE (aus dem Produkttitel abgeleitet): Ugly Sweater');
  });
});

describe('pruefeSeoText', () => {
  const gut = {
    keyphrase:   'Weihnachtspullover Herren',
    produktname: 'Ugly Sweater Rentier Herren',
    kurzbeschreibung: 'Weihnachtspullover Herren mit Rentier – jetzt bestellen.',
    produktbeschreibung:
      '<h2>Schnitt und Material</h2><p>Der Weihnachtspullover Herren sitzt locker.</p>',
  };

  test('alles erfüllt → keine Meldung', () => {
    expect(pruefeSeoText(gut)).toEqual([]);
  });

  test('Keyphrase fehlt im ersten Satz → Meldung', () => {
    const meldungen = pruefeSeoText({
      ...gut,
      produktbeschreibung:
        '<h2>Schnitt und Material</h2><p>Der Pulli sitzt locker. Weihnachtspullover Herren kommen später.</p>',
    });

    expect(meldungen).toHaveLength(1);
    expect(meldungen[0]).toMatch(/ersten Satz/);
    expect(meldungen[0]).toContain('Weihnachtspullover Herren');
  });

  test('Keyphrase zu spät in der Kurzbeschreibung → Meldung', () => {
    const meldungen = pruefeSeoText({
      ...gut,
      kurzbeschreibung: 'Eins zwei drei vier fünf sechs sieben acht neun zehn Weihnachtspullover Herren.',
    });

    expect(meldungen.some(m => /ersten 10 Wörtern/.test(m))).toBe(true);
  });

  test('<h2> mit dem Produkttitel → Meldung', () => {
    const meldungen = pruefeSeoText({
      ...gut,
      produktbeschreibung:
        '<h2>Ugly Sweater Rentier Herren</h2><p>Der Weihnachtspullover Herren sitzt locker.</p>',
    });

    expect(meldungen.some(m => /enthält den Produkttitel/.test(m))).toBe(true);
  });

  test('<h2> mit dem Titel ohne Zielgruppe → Meldung', () => {
    const meldungen = pruefeSeoText({
      ...gut,
      produktbeschreibung:
        '<h2>ugly sweater rentier</h2><p>Der Weihnachtspullover Herren sitzt locker.</p>',
    });

    expect(meldungen.some(m => /enthält den Produkttitel/.test(m))).toBe(true);
  });

  test('<h2> mit mehr als 8 Wörtern → Meldung', () => {
    const meldungen = pruefeSeoText({
      ...gut,
      produktbeschreibung:
        '<h2>Eins zwei drei vier fünf sechs sieben acht neun</h2>' +
        '<p>Der Weihnachtspullover Herren sitzt locker.</p>',
    });

    expect(meldungen.some(m => /höchstens 8/.test(m))).toBe(true);
  });

  test('fehlende <h2> wird gemeldet', () => {
    const meldungen = pruefeSeoText({
      ...gut,
      produktbeschreibung: '<p>Der Weihnachtspullover Herren sitzt locker.</p>',
    });

    expect(meldungen.some(m => /keine <h2>/.test(m))).toBe(true);
  });

  test('leere Keyphrase: geprüft wird gegen den Titel ohne Farbe/Größe', () => {
    const meldungen = pruefeSeoText({
      keyphrase:   '',
      produktname: 'Ugly Sweater Rentier Navy',
      farben:      ['Navy'],
      kurzbeschreibung:    'Schickes Teil für die Feier.',
      produktbeschreibung: '<h2>Schnitt und Material</h2><p>Sitzt locker.</p>',
    });

    expect(meldungen.some(m => /Hauptkeyword \(aus dem Titel\)/.test(m))).toBe(true);
    expect(meldungen.some(m => m.includes('Ugly Sweater Rentier'))).toBe(true);
    expect(meldungen.every(m => !m.includes('Navy'))).toBe(true);
  });

  test('Groß/Klein und Umlaute sind egal, verglichen wird auf ganzen Wörtern', () => {
    expect(pruefeSeoText({
      ...gut,
      keyphrase: 'WEIHNACHTSPULLOVER HERREN',
    })).toEqual([]);

    // "pullover" darf nicht als Teilstring in "Weihnachtspullover" treffen.
    expect(pruefeSeoText({ ...gut, keyphrase: 'Pullover' }).length).toBeGreaterThan(0);
  });
});
