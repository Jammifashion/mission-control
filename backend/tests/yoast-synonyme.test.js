// Keyphrase-Synonyme im Format, das Yoast tatsaechlich liest.
//
// 79e1ccd schrieb die nackte Zeichenkette. Der Wert stand im Feld, die REST
// las ihn zurueck - und die Yoast-Oberflaeche zeigte das Feld trotzdem LEER.
//
// ⚠️ GEMESSEN am 22.09. ueber die REST, nicht angenommen:
//
//   (a) 20996, BCWW03Q/CH-Skyline, von Hand in Yoast gepflegt:
//       ["Crocodiles Skyline Kapuzenjacke Damen, … Zip Hoodie Damen"]
//       -> JSON-Array mit GENAU EINEM String-Element, Synonyme darin
//          kommagetrennt. JSON.parse ergibt ein Array der Laenge 1.
//          Alle sieben gepflegten Skyline-Artikel sehen so aus.
//
//   (b) 21004, BCWU02K/CH-Oldschool, von Mission Control geschrieben:
//       "Crocodiles Oldschool Kapuzenpullover Herren, …"
//       -> nackte Zeichenkette, kein gueltiges JSON.
//
// Das Zielformat ist (a). NICHT ["eins","zwei","drei"] - diese Form kommt im
// Shop nirgends vor. Wer den Block darauf umbaut, misst vorher neu.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8',
);

// ── Frontend-Block herausschneiden und AUSFUEHREN ───────────────────────────
const START = '// ── Keyphrase-Synonyme: Anfang';
const ENDE  = '// ── Keyphrase-Synonyme: Ende ──';
const von   = html.indexOf(START);
const bis   = html.indexOf(ENDE);
const block = html.slice(von, bis);

const fe = new Function(`${block}
  return { synonymeTeile, synonymeZuYoast, synonymeAusYoast, synonymeAnzahl };`)();

// Die gemessenen Rohwerte, wortgetreu.
const YOAST_20996 = '["Crocodiles Skyline Kapuzenjacke Damen, Crocodiles Hamburg Skyline Sweatjacke Damen, Eishockey Skyline Zip Hoodie Damen"]';
const ALT_21004   = 'Crocodiles Oldschool Kapuzenpullover Herren, Crocodiles Hamburg Oldschool Pullover Herren, Eishockey Oldschool Hoodie Herren';

test('der Block wurde gefunden und benutzt nichts aus dem Seitenkontext', () => {
  expect(von).toBeGreaterThan(-1);
  expect(bis).toBeGreaterThan(von);
  expect(block).not.toMatch(/document\.|apiFetch|showToast|seoCurrentItem/);
});

// ── Schreiben ───────────────────────────────────────────────────────────────
describe('Schreiben: Maske -> Yoast-Format', () => {
  test('ein Synonym', () => {
    expect(fe.synonymeZuYoast('Ugly Sweater Herren')).toBe('["Ugly Sweater Herren"]');
  });

  test('drei Synonyme landen in EINEM Array-Element, kommagetrennt', () => {
    const roh = fe.synonymeZuYoast('eins, zwei, drei');
    expect(roh).toBe('["eins, zwei, drei"]');
    // genau die gemessene Form: Array der Laenge 1
    const arr = JSON.parse(roh);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(1);
    expect(arr[0]).toBe('eins, zwei, drei');
  });

  test('Umlaute und Eszett bleiben stehen, nicht escaped', () => {
    const roh = fe.synonymeZuYoast('Größe, Weiß, Öl, Ärmel');
    expect(roh).toBe('["Größe, Weiß, Öl, Ärmel"]');
    expect(roh).not.toMatch(/\\u00/);
    expect(JSON.parse(roh)[0]).toBe('Größe, Weiß, Öl, Ärmel');
  });

  test('ueberfluessige Leerzeichen um die Kommas fallen weg', () => {
    expect(fe.synonymeZuYoast('  eins ,  zwei  ,drei   ')).toBe('["eins, zwei, drei"]');
  });

  test('leere Teile zwischen Kommas fallen weg', () => {
    expect(fe.synonymeZuYoast('eins,,zwei, ,drei')).toBe('["eins, zwei, drei"]');
  });

  // Punkt 4: am 22.09. live bestanden, darf nicht kippen.
  test('leeres Feld -> null, also KEIN Schreibversuch', () => {
    for (const leer of ['', '   ', ',', ' , , ', null, undefined]) {
      expect(fe.synonymeZuYoast(leer)).toBeNull();
    }
  });
});

// ── Lesen ───────────────────────────────────────────────────────────────────
describe('Lesen: beide Formen, keine darf scheitern', () => {
  test('(a) Yoast-Format wird zur lesbaren Zeile', () => {
    expect(fe.synonymeAusYoast(YOAST_20996)).toBe(
      'Crocodiles Skyline Kapuzenjacke Damen, Crocodiles Hamburg Skyline Sweatjacke Damen, Eishockey Skyline Zip Hoodie Damen',
    );
    // keine Klammern, keine Anfuehrungszeichen in der Maske
    expect(fe.synonymeAusYoast(YOAST_20996)).not.toMatch(/[[\]"]/);
  });

  test('(b) alte Zeichenkette wird unveraendert lesbar', () => {
    expect(fe.synonymeAusYoast(ALT_21004)).toBe(ALT_21004);
  });

  test('leer bleibt leer', () => {
    for (const leer of ['', '   ', null, undefined]) expect(fe.synonymeAusYoast(leer)).toBe('');
  });

  test('kaputtes JSON scheitert nicht, sondern wird als Zeichenkette behandelt', () => {
    // Punkt 3: das Lesen darf an keinem Wert werfen.
    expect(() => fe.synonymeAusYoast('["unvollstaendig')).not.toThrow();
    expect(() => fe.synonymeAusYoast('[]')).not.toThrow();
    expect(fe.synonymeAusYoast('[]')).toBe('');
  });

  test('mehrelementiges Array wird ebenfalls verkraftet', () => {
    // Kommt im Shop nicht vor, waere aber kein Grund zu scheitern.
    expect(fe.synonymeAusYoast('["eins","zwei"]')).toBe('eins, zwei');
  });
});

// ── Zaehlen ─────────────────────────────────────────────────────────────────
describe('Anzahl: Komma-Teile, nicht Array-Laenge', () => {
  test('das gemessene Format enthaelt drei Synonyme, nicht eins', () => {
    // Die Array-Laenge waere 1 und damit als Meldung wertlos.
    expect(JSON.parse(YOAST_20996)).toHaveLength(1);
    expect(fe.synonymeAnzahl(YOAST_20996)).toBe(3);
  });

  test('alte Zeichenkette wird genauso gezaehlt', () => {
    expect(fe.synonymeAnzahl(ALT_21004)).toBe(3);
  });

  test('leer ergibt 0 – die Zahl, die auffallen soll', () => {
    expect(fe.synonymeAnzahl('')).toBe(0);
    expect(fe.synonymeAnzahl(null)).toBe(0);
  });
});

// ── Rundlauf ────────────────────────────────────────────────────────────────
describe('Rundlauf schreiben -> lesen -> schreiben', () => {
  test.each([
    ['ein Synonym',        'Ugly Sweater Herren'],
    ['drei Synonyme',      'eins, zwei, drei'],
    ['Umlaute und Eszett', 'Größe, Weiß, Öl'],
    ['unsaubere Eingabe',  '  eins ,  zwei ,, drei  '],
  ])('%s veraendert den Wert nicht', (_name, eingabe) => {
    const einmal  = fe.synonymeZuYoast(eingabe);
    const gelesen = fe.synonymeAusYoast(einmal);
    const zweimal = fe.synonymeZuYoast(gelesen);
    expect(zweimal).toBe(einmal);
  });

  test('auch aus der ALTEN Form heraus ist der Rundlauf stabil', () => {
    // Ein Bestandsartikel wird geladen, unveraendert gespeichert, neu geladen.
    const gelesen = fe.synonymeAusYoast(ALT_21004);
    const neu     = fe.synonymeZuYoast(gelesen);
    expect(neu).toBe(JSON.stringify([ALT_21004]));
    expect(fe.synonymeAusYoast(neu)).toBe(gelesen);
  });
});

// ── Einbau im SEO-Flow ──────────────────────────────────────────────────────
describe('Frontend: die Funktionen sind auch verdrahtet', () => {
  const saveBlock = html.slice(html.indexOf("getElementById('btn-seo-save').addEventListener"));

  test('die Maske bekommt die lesbare Zeile, nicht den Rohwert', () => {
    expect(html).toMatch(/getElementById\('seo-synonyme'\)\.value\s*=\s*synonymeAusYoast\(/);
  });

  test('geschrieben wird das konvertierte Format', () => {
    expect(saveBlock).toMatch(/yoastSynonyme\s*=\s*synonymeZuYoast\(/);
    expect(saveBlock).toMatch(/if \(yoastSynonyme\)\s*yoastMeta\.push/);
  });

  test('die Rueckmeldung nennt die Anzahl', () => {
    expect(saveBlock).toMatch(/synonymeAnzahl\(/);
    expect(saveBlock).toMatch(/Synonym\$\{synAnzahl === 1 \? '' : 'e'\}/);
  });
});
