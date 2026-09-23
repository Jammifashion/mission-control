// Tier-1 – reine Datenaufbereitung für den SEO-Prompt, keine Mocks nötig.

import {
  filterMaterialFarben,
  filterMaterialFarbenMitMeldung,
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

// buildSeoUserPrompt liefert seit Punkt 1 { prompt, meldung }. Die meisten
// Tests hier pruefen nur den Text – dieser Helfer haelt sie schlank. Dass die
// Meldung wirklich nach oben gereicht wird, prueft ein eigener Block unten.
const promptVon = (args) => buildSeoUserPrompt(args).prompt;

// Die Materialangabe so, wie sie im FERTIGEN Prompt beim Modell ankommt.
// Geprueft wird der fertige Prompt, nicht nur die Filterfunktion: ein
// gefilterter Wert, der ueber ein Sammelfeld doch wieder hineinlaeuft, faellt
// sonst nicht auf.
const PRAEFIX = '- Material: ';
const materialImPrompt = (materialZeile, farben) =>
  promptVon({ produktname: 'Shirt', eigenschaften: materialZeile, farben })
    .split('\n')
    .find(z => z.startsWith(PRAEFIX))
    ?.slice(PRAEFIX.length);

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
    // F1: getrennt wird nur an "," und ";" - "/" gehoert zum Namen.
    expect(farbenAusEigenschaften(['Farbe(n): Schwarz, Navy / Grau meliert']))
      .toEqual(['Schwarz', 'Navy / Grau meliert']);
    expect(farbenAusEigenschaften(['Farbe(n): Schwarz; Navy']))
      .toEqual(['Schwarz', 'Navy']);
  });

  test('F1: "Farbe(n): Weiß/Pink, Schwarz" sind zwei Farben', () => {
    expect(farbenAusEigenschaften(['Farbe(n): Weiß/Pink, Schwarz']))
      .toEqual(['Weiß/Pink', 'Schwarz']);
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
    const prompt = promptVon({
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
    const prompt = promptVon({
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

  // Bleibt nach dem Filtern gar nichts uebrig, greift der Platzhalter – das
  // Verhalten von vor 12f2ea5. Dazu kommt nur die Meldung; der ungefilterte
  // Wert wird NICHT wiederhergestellt.
  test('Material, das nur aus einer fremden Ausnahme besteht: Platzhalter + Meldung', () => {
    const { material, meldung } = filterMaterialFarbenMitMeldung('(Ash: 99% Baumwolle)', ['Navy']);

    expect(material).toBe(MATERIAL_PLACEHOLDER);
    expect(meldung).toMatch(/keine vollständige Faserangabe/);
    expect(material).not.toMatch(/Ash/);
  });

  test('wirklich leeres Material ergibt weiterhin den Platzhalter, ohne Meldung', () => {
    // Die Nachbedingung spannt sich nur auf, wenn im AUSGANGSWERT eine
    // Faserangabe stand. Bei leerer Eingabe gab es nichts zu verlieren.
    expect(filterMaterialFarbenMitMeldung('', ['Navy']))
      .toEqual({ material: MATERIAL_PLACEHOLDER, meldung: null });
  });
});

// ── Nachbedingung: melden, nicht wiederherstellen ───────────────────────────
// Die Auslesemenge der Nachbedingung ist genau die Menge, in der der Filter
// KORREKT gearbeitet hat: die einzige Faserangabe gehoerte zu einer nicht
// angebotenen Farbe. Den ungefilterten Wert wiederherzustellen holte dort
// fremdes Material zurueck – genau die Falle, gegen die der Filter gebaut ist.
describe('Punkt 1 – Nachbedingung meldet, ohne wiederherzustellen', () => {
  test('einzige Faserangabe gehoert zu nicht angebotener Farbe: gefiltert + Meldung', () => {
    const roh = 'Baumwolle mit Elasthan (Ash: 99% Baumwolle)';
    const { material, meldung } = filterMaterialFarbenMitMeldung(roh, ['Navy']);

    // Das GEFILTERTE Ergebnis bleibt stehen, auch wenn es unvollstaendig ist.
    expect(material).toBe('Baumwolle mit Elasthan');
    expect(meldung).toMatch(/keine vollständige Faserangabe/);

    // Der ungefilterte Rohwert taucht im Ergebnis NICHT auf.
    expect(material).not.toBe(roh);
    expect(material).not.toMatch(/Ash|99%/);
  });

  test('nach dem Filtern gar nichts mehr uebrig: Platzhalter', () => {
    const { material, meldung } = filterMaterialFarbenMitMeldung(
      '(Ash: 80% Baumwolle / 20% Polyester)', ['Navy']);

    expect(material).toBe(MATERIAL_PLACEHOLDER);
    expect(meldung).toMatch(/keine vollständige Faserangabe/);
  });

  test('Regression: eine von zwei Angaben entfernt, eine vollstaendige bleibt – keine Meldung', () => {
    expect(filterMaterialFarbenMitMeldung(
      '100% Baumwolle (Ash: 99% Baumwolle)', ['Navy'],
    )).toEqual({ material: '100% Baumwolle', meldung: null });
  });

  test('die Meldung behauptet keine Wiederherstellung', () => {
    const { meldung } = filterMaterialFarbenMitMeldung('(Ash: 99% Baumwolle)', ['Navy']);

    expect(meldung).toBe(
      'Nach dem Filtern steht keine vollständige Faserangabe mit Prozentwerten ' +
      'mehr im Material — bitte prüfen.');
    expect(meldung).not.toMatch(/ungefiltert|wiederhergestellt|verwendet/i);
  });

  test('der Wrapper VERWIRFT die Meldung – darum gehoert er nicht in den Produktionspfad', () => {
    const roh = '(Ash: 80% Baumwolle / 20% Polyester)';

    expect(filterMaterialFarben(roh, ['Navy'])).toBe(MATERIAL_PLACEHOLDER);   // nur der String
    expect(filterMaterialFarbenMitMeldung(roh, ['Navy']).meldung).toBeTruthy();
  });

  // Ohne diesen Test greift beim naechsten Umbau jemand zum kuerzeren Namen
  // und die Meldung erreicht niemanden mehr.
  test('buildSeoUserPrompt reicht die Meldung nach oben', () => {
    const { prompt, meldung } = buildSeoUserPrompt({
      produktname: 'Shirt',
      eigenschaften: 'Material: (Ash: 99% Baumwolle)\nFarbe(n): Navy',
    });

    expect(meldung).toMatch(/keine vollständige Faserangabe/);
    expect(prompt).toContain(`- Material: ${MATERIAL_PLACEHOLDER}`);
    // Zweite Eintrittsstelle: der Rohwert darf auch nicht ueber "Weitere
    // Eigenschaften" in den Prompt zurueckkommen.
    expect(prompt).not.toMatch(/Ash/);
  });

  test('ohne Befund bleibt die Meldung null', () => {
    const { prompt, meldung } = buildSeoUserPrompt({
      produktname: 'Shirt',
      eigenschaften: 'Material: 100% Baumwolle (Ash: 99% Baumwolle)\nFarbe(n): Navy',
    });

    expect(meldung).toBeNull();
    expect(prompt).toContain('- Material: 100% Baumwolle');
  });
});

// ── Punkt 2 – Sachlabels auf Wortgrenzen ────────────────────────────────────
describe('Punkt 2 – Sachlabel ohne blindes Teilstring-Matching', () => {
  test('"Materialzusammensetzung" faellt ueber den zusammengesetzten Kopf unter Material', () => {
    const roh = '(Materialzusammensetzung: 80% Baumwolle / 20% Polyester)';
    expect(filterMaterialFarbenMitMeldung(roh, ['Navy']))
      .toEqual({ material: roh, meldung: null });
  });

  test('"Black Smoke" wird nicht dadurch zum Sachlabel, dass es "Stoff"-aehnlich klingt', () => {
    expect(filterMaterialFarben('100% Baumwolle (Black Smoke: 70% Baumwolle)', ['Navy']))
      .toBe('100% Baumwolle');
  });

  test('zwei Netze: Punkt 2 haelt, was Punkt 1 nicht faengt', () => {
    // KONSTRUIERT – so existiert kein Artikel. Der Punkt: waere die
    // Sachlabel-Pruefung nicht da, loeschte der Filter hier die Angabe eines
    // BAUTEILS und liesse die des Produkts stehen. Die Nachbedingung
    // schwiege, weil eine Faserangabe uebrig bleibt.
    const roh = '80% Baumwolle / 20% Polyester (Bündchen: 95% Baumwolle / 5% Elasthan)';
    expect(filterMaterialFarbenMitMeldung(roh, ['Navy']))
      .toEqual({ material: roh, meldung: null });
  });
});

// ── Punkte 3 und 4 an echten Shop-Texten ────────────────────────────────────
// Quelle: mc-wc-backup/material-rest-2026-09-21T20-04-45-409Z.json
// Materialzeilen aus der Sicherung, nicht abgetippt.
describe('echte Shop-Texte – verschachtelte Klammern (Punkt 3)', () => {
  test('13270 – "(Charcoal (Heather): …)" wird entfernt', () => {
    // ⚠️ Die Grundangabe lautet im Shop "0% Baumwolle" – ein echter
    // Datenfehler, am 21.09. korrigiert. Testdaten aus der Sicherung, damit
    // der Test nicht mit dem Shop wandert.
    const roh =
      '0% Baumwolle / 20% Polyester (Charcoal (Heather): 52% Baumwolle / 48% Polyester), ' +
      '(Heather Grey: 75% Baumwolle / 25% Polyester), (Black Smoke: 70% Baumwolle / 30% Polyester)';
    const { material, meldung } = filterMaterialFarbenMitMeldung(roh, ['Anthrazit', 'Navy']);

    expect(material).toBe('0% Baumwolle / 20% Polyester');
    expect(meldung).toBeNull();
    expect(materialImPrompt(roh, ['Anthrazit', 'Navy'])).toBe('0% Baumwolle / 20% Polyester');
  });

  test('18390 – zwei Klammerklauseln, Normalfall: beide entfernt', () => {
    const roh =
      'Material: 80% Baumwolle / 20% Polyester (Heather Grey: 75% Baumwolle / 21% Polyester / ' +
      '4% Viskose), (Heather Mid Grey: 60% Baumwolle / 40% Polyester)';

    expect(materialImPrompt(roh, ['Schwarz', 'Weiß'])).toBe('80% Baumwolle / 20% Polyester');
  });

  test('16951 – verschachtelte Klammer mitten im Fliesstext', () => {
    const roh =
      'Stil und Bequemlichkeit : Arenal Asozial Jogginghose Zertifizierung Vegan Faire ' +
      'Arbeitsbedingungen OEKO-TEX® STANDARD 100 Grammatur in g/m² 280 g/m² ' +
      'Materialzusammensetzung 80% Baumwolle / 20% Polyester (Charcoal (Heather): 52% Baumwolle / ' +
      '48% Polyester), (Heather Grey: 75% Baumwolle / 25% Polyester) OEKO-TEX® OEKO-TEX® ' +
      'STANDARD 100: 23.HPK.70888 Hohenstein Polybeutel Nein Farbigkeit 1-farbig Meliert ' +
      'Hosen (Art) Jogginghosen Einsatzgebiet Sport Beine Lange Hose mit Bündchen ' +
      'Pflegehinweis 30 °C waschbar Trockner geeignet Bügeln erlaubt Passform Regular ' +
      '(normal geschnitten) Verarbeitung Innen angeraut';
    const { material, meldung } = filterMaterialFarbenMitMeldung(roh, ['Weiß', 'Bunt']);

    expect(material).not.toMatch(/Charcoal|Heather/);
    expect(material).toContain('80% Baumwolle / 20% Polyester');
    expect(material).toContain('(Art)');                    // Klammer ohne Farbbezug bleibt
    expect(material).toContain('(normal geschnitten)');
    expect(meldung).toBeNull();
  });
});

describe('echte Shop-Texte – freie Klauseln (Punkt 4)', () => {
  test('13251 – freie Klausel UND unbalancierte Klammer: entfernt', () => {
    const roh = '70% Baumwolle / 30% Polyester (Heather Grey: 65% Baumwolle / 35% Polyester';
    const { material, meldung } = filterMaterialFarbenMitMeldung(roh, ['Anthrazit', 'Navy']);

    expect(material).toBe('70% Baumwolle / 30% Polyester');
    expect(material).not.toMatch(/\(/);                     // die offene Klammer ist mit weg
    expect(meldung).toBeNull();
    expect(materialImPrompt(roh, ['Anthrazit', 'Navy'])).toBe('70% Baumwolle / 30% Polyester');
  });

  test('19192 – die freie Klausel IST die Pflichtangabe und bleibt stehen', () => {
    // ⚠️ Das fuehrende "Material:" schuetzt NICHTS – "Sports Grey:" erfuellt
    // (a) und (b). Diesen Artikel rettet AUSSCHLIESSLICH (c), die
    // Nachbedingung. Er ist NICHT doppelt geschuetzt.
    const ohneLabel = 'Sports Grey: 85% Baumwolle / 15% Viskose';

    expect(filterMaterialFarbenMitMeldung(ohneLabel, ['Schwarz']))
      .toEqual({ material: ohneLabel, meldung: null });
    expect(materialImPrompt(`Material: ${ohneLabel}`, ['Schwarz'])).toBe(ohneLabel);
  });

  test('19192 – mit der echten (leeren) Farbliste greift schon die alte Regel', () => {
    // In der Sicherung steht angeboten: []. Dann wird ohnehin nichts entfernt.
    const roh = 'Material: Sports Grey: 85% Baumwolle / 15% Viskose';
    expect(materialImPrompt(roh, [])).toBe('Sports Grey: 85% Baumwolle / 15% Viskose');
  });

  test('5831 – Sachlabel mit gueltiger Angabe in Klammern: nichts wird entfernt', () => {
    // Der Audit hatte 5831 als Befund gefuehrt – Fehlalarm des Audit-Parsers,
    // der ueber eine Satzgrenze gelesen hat.
    const roh =
      'Hochwertige Materialien: Unsere Kapuzen-Sweat-Jacke besteht aus einem weichen und ' +
      'strapazierfähigen Baumwoll-Polyester-Gemisch (80% Baumwolle / 20% Polyester), das sich ' +
      'angenehm auf der Haut anfühlt und gleichzeitig langlebig ist.';
    const { material, meldung } = filterMaterialFarbenMitMeldung(
      roh, ['Grün', 'Navy', 'Pink', 'Schwarz', 'Royal']);

    expect(material).toBe(roh);
    expect(meldung).toBeNull();
  });

  test('7963 – Farbe hinter dem Sachlabel bleibt unangetastet', () => {
    const roh =
      'Füllung Ausführung: Kissenbezug Farbe: Off-White Materialzusammensetzung: 100 % Polyester ' +
      'Naht: gekändelt Oberfläche: Flauschig-weich Waschbar: bei 30 °C Zertifizierung: ' +
      'Entspricht REACH Verordnung (EG) Nr.';
    const { material, meldung } = filterMaterialFarbenMitMeldung(
      roh, ['Weiß', 'Schwarze Rückseite']);

    expect(material).toBe(roh);
    expect(meldung).toBeNull();
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
    // F1: getrennt wird nur an "," und ";" - "/" gehoert zum Namen.
    expect(parseFarben('Farben: Schwarz, Navy / Grau meliert')).toEqual([
      'Schwarz', 'Navy / Grau meliert',
    ]);
    expect(parseFarben('')).toEqual([]);
  });

  test('F1: ein Array wird nicht weiter getrennt – die Variantenauswahl ist die Wahrheit', () => {
    expect(parseFarben(['Weiß/Pink'])).toEqual(['Weiß/Pink']);
    expect(parseFarben(['Weiß | Pink'])).toEqual(['Weiß | Pink']);
    expect(parseFarben([' Weiß/Pink ', '', '  ', 'Schwarz'])).toEqual(['Weiß/Pink', 'Schwarz']);
  });

  test('F1: im Text trennen "/" und "|" nicht mehr', () => {
    expect(parseFarben('Weiß/Pink, Schwarz')).toEqual(['Weiß/Pink', 'Schwarz']);
    expect(parseFarben('Weiß|Pink; Schwarz')).toEqual(['Weiß|Pink', 'Schwarz']);
  });

  test('F1: SEO-Prompt enthaelt "FARBEN: Weiß/Pink"', () => {
    const prompt = promptVon({
      produktname: 'Oldschool Hoodie', eigenschaften: 'Material: 100% Baumwolle',
      farben: ['Weiß/Pink'], groessen: ['XL'],
    });
    expect(prompt).toContain('- FARBEN: Weiß/Pink');
    expect(prompt).toContain('<li><strong>Farben:</strong> Weiß/Pink</li>');
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
    const prompt = promptVon({ ...basis, modus: 'kollektion' });

    expect(prompt).toContain('MODUS: kollektion');
    expect(prompt).not.toMatch(/Freigabe/i);
  });

  test('MODUS "auftrag" erzeugt den Freigabe-Hinweis', () => {
    const prompt = promptVon({ ...basis, modus: 'auftrag' });

    expect(prompt).toContain('MODUS: auftrag');
    expect(prompt).toMatch(/FREIGABE:/);
  });

  test('ohne MODUS gilt kollektion – kein Freigabe-Hinweis', () => {
    const prompt = promptVon(basis);

    expect(prompt).toContain('MODUS: kollektion');
    expect(prompt).not.toMatch(/Freigabe/i);
  });

  test('unbekannter MODUS verspricht keine Freigabe, sondern fällt auf kollektion', () => {
    const prompt = promptVon({ ...basis, modus: 'Auftraggeber' });

    expect(prompt).toContain('MODUS: kollektion');
    expect(prompt).not.toMatch(/Freigabe/i);
  });

  test('MOTIV wird übernommen, sonst Platzhalter statt Erfindung', () => {
    expect(promptVon({ ...basis, motiv: 'Rentier mit Sonnenbrille' }))
      .toContain('- MOTIV: Rentier mit Sonnenbrille');
    expect(promptVon(basis)).toMatch(/- MOTIV: keine Angabe – Motiv nicht erfinden/);
  });

  test('Material wird vor dem Prompt gefiltert, FARBEN werden gelistet', () => {
    const prompt = promptVon(basis);

    expect(prompt).toContain('- FARBEN: Navy, Schwarz');
    expect(prompt).toContain('- Material: 100% Baumwolle');
    expect(prompt).not.toMatch(/Ash/);
    expect(prompt).not.toMatch(/Viskose/);
  });

  test('"Weitere Eigenschaften" reicht den ungefilterten Materialstring nicht durch', () => {
    const prompt = promptVon(basis);
    const weitere = prompt.split('\n').find(z => z.startsWith('- Weitere Eigenschaften:'));

    expect(weitere).toBeDefined();
    expect(weitere).not.toMatch(/Ash|Viskose/);
    expect(weitere).toContain('Grammatur: 280 g/m²');
  });

  test('farben aus dem Request schlagen die Eigenschaften-Zeile', () => {
    const prompt = promptVon({ ...basis, farben: ['Ash'] });

    expect(prompt).toContain('- FARBEN: Ash');
    expect(prompt).toContain('(Ash: 99% Baumwolle, 1% Viskose)');
  });

  test('fehlendes Material ergibt den Platzhalter im Prompt und im <li>', () => {
    const prompt = promptVon({ produktname: 'Shirt', eigenschaften: 'Farben: Navy' });

    expect(prompt).toContain(`- Material: ${MATERIAL_PLACEHOLDER}`);
    expect(prompt).toContain(`<li><strong>Material:</strong> ${MATERIAL_PLACEHOLDER}</li>`);
  });

  test('kein <h1> in der Strukturvorgabe', () => {
    const prompt = promptVon(basis);

    expect(prompt).not.toContain('<h1>');
    expect(prompt).toContain('<h2>');
    expect(prompt).toContain('<h3>Produktdetails</h3>');
  });

  test('Material-Label wird im <li> nicht doppelt gesetzt', () => {
    const prompt = promptVon(basis);

    expect(prompt).not.toMatch(/<strong>Material:<\/strong> Material:/);
  });

  test('Farben stehen als eigene Zeile in der Detailliste', () => {
    expect(promptVon(basis)).toContain('<li><strong>Farben:</strong> Navy, Schwarz</li>');
  });

  test('Strukturvorgabe verlangt keinen Titel und keinen Slogan in der <h2>', () => {
    const prompt = promptVon(basis);

    expect(prompt).not.toMatch(/\[Artikelbezeichnung\]/);
    expect(prompt).not.toMatch(/Slogan basierend auf Kontext/);
    expect(prompt).toMatch(/NICHT der Produkttitel/);
  });

  test('Regel gegen erfundene Fakten steht im Prompt', () => {
    const prompt = promptVon(basis);

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
    const prompt = promptVon({ produktname: 'Shirt', eigenschaften });

    expect(prompt).not.toMatch(/Farbigkeit/i);
    expect(prompt).not.toMatch(/Veredelungsangabe/i);
    expect(prompt).not.toMatch(/Verarbeitung/i);
    expect(prompt).toContain('Grammatur: 280 g/m²');
  });
});

describe('Größen kommen nur aus der Variantenauswahl', () => {
  const eigenschaften = 'Material: 100% Baumwolle\nGrößen: S bis 5XL';

  test('Variantengrößen stehen im Prompt, die Katalogzeile nicht', () => {
    const prompt = promptVon({ produktname: 'Shirt', eigenschaften, groessen: ['M', 'L'] });

    expect(prompt).toContain('- GRÖSSEN: M, L');
    expect(prompt).toContain('<li><strong>Größen:</strong> M, L</li>');
    expect(prompt).not.toMatch(/5XL/);
  });

  test('ohne Größen-Variante keine Größenzeile', () => {
    const prompt = promptVon({ produktname: 'Shirt', eigenschaften });

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

  // F1: vorher zerfiel "110/116" in "110" und "116" - aus zwei Kindergroessen
  // wurden vier Zahlen, und der Prompt nannte Groessen, die es nicht gibt.
  test('F1: Kindergroessen bleiben ganz – zwei Groessen, nicht vier', () => {
    expect(parseGroessen(['110/116', '146/152'])).toEqual(['110/116', '146/152']);
    expect(parseGroessen('Größen: 110/116, 146/152')).toEqual(['110/116', '146/152']);

    const prompt = promptVon({ produktname: 'Kinder Hoodie', eigenschaften, groessen: ['110/116', '146/152'] });
    expect(prompt).toContain('- GRÖSSEN: 110/116, 146/152');
    expect(prompt).toContain('<li><strong>Größen:</strong> 110/116, 146/152</li>');
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
    expect(promptVon({ produktname: 'Shirt', keyphrase: 'Weihnachtspullover Herren' }))
      .toContain('FOKUS-KEYPHRASE: Weihnachtspullover Herren');
    expect(promptVon({ produktname: 'Ugly Sweater Navy', farben: ['Navy'] }))
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
