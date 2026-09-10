// Tier-1 – reine Datenaufbereitung für den SEO-Prompt, keine Mocks nötig.

import {
  filterMaterialFarben,
  parseFarben,
  buildSeoUserPrompt,
  resolveModus,
  MATERIAL_PLACEHOLDER,
  MODUS_KOLLEKTION,
} from '../lib/seo-prompt.js';

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
});
