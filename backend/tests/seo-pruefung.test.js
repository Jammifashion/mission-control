// Befehl M4: deterministische Pruefung nach der Generierung (lib/seo-pruefung.js).
// Jede Regel positiv (meldet) und negativ (still). Die Regeln zu <h2> und
// Keyphrase stehen in lib/seo-prompt.js (pruefeSeoText) und sind hier fuer den
// Cap-Fall mitgeprueft.

import { pruefeGeneratorText, VERBOTENE_BEGRIFFE } from '../lib/seo-pruefung.js';
import { pruefeSeoText } from '../lib/seo-prompt.js';

const NAME = 'Match Day Cap Crocodiles Hamburg';
const KP   = 'Crocodiles Hamburg Match Day Cap';
const SAUBER = {
  kurzbeschreibung:    'Crocodiles Hamburg Match Day Cap mit Vereinslogo – jetzt bestellen.',
  produktbeschreibung: '<h2>Logo vorne, Kontrast am Schirm</h2><p>Die Crocodiles Hamburg Match Day Cap trägt das Vereinslogo.</p>',
};
const basis = over => ({
  ...SAUBER, produktname: NAME, keyphrase: KP,
  nurIntern: 'Carbon Cap', marken: ['Beechfield'], modellnummern: ['CB166R', 'B166R'], druck: true,
  ...over,
});
const lang = html => basis({ produktbeschreibung: `<h2>Logo vorne</h2><p>${html}</p>` });

describe('sauberer Text', () => {
  test('keine Meldung', () => {
    expect(pruefeGeneratorText(basis())).toEqual([]);
  });
});

describe('1. Nur_intern', () => {
  test('Wendung im Text -> Meldung', () => {
    expect(pruefeGeneratorText(lang('Wie die Carbon Cap, nur schlichter.')))
      .toEqual(['Interner Begriff "Carbon Cap" (Nur_intern) in Produktbeschreibung.']);
  });
  test('einzelnes eigenes Wort (ab 4 Zeichen, nicht im Namen) -> Meldung', () => {
    expect(pruefeGeneratorText(lang('Schirm im Carbon-Look.')))
      .toEqual(['Interner Begriff "Carbon" (aus Nur_intern "Carbon Cap") in Produktbeschreibung.']);
  });
  test('Wort aus dem Produktnamen ("Cap") meldet nicht', () => {
    expect(pruefeGeneratorText(lang('Eine Cap für jeden Spieltag.'))).toEqual([]);
  });
});

describe('2. Marke und Modellnummer', () => {
  test('Marke -> Meldung', () => {
    expect(pruefeGeneratorText(basis({ kurzbeschreibung: 'Cap von Beechfield mit Logo.' })))
      .toEqual(['Marke des Rohlings "Beechfield" in Kurzbeschreibung.']);
  });
  test('Modellnummern -> Meldung, auch Hersteller-Nr', () => {
    expect(pruefeGeneratorText(lang('Basis ist die CB166R (B166R).'))).toEqual([
      'Modellnummer "CB166R" in Produktbeschreibung.',
      'Modellnummer "B166R" in Produktbeschreibung.',
    ]);
  });
  test('Nummer als Teil eines Wortes meldet nicht', () => {
    expect(pruefeGeneratorText({ ...lang('Code XB166RZ'), modellnummern: ['B166R'] })).toEqual([]);
  });
});

describe('3. feste Liste', () => {
  test('Liste steht als Konstante im Code', () => {
    expect(VERBOTENE_BEGRIFFE).toEqual(['L-Shop', 'Printequipment', 'Sublistar', 'OEKO-TEX', 'offiziell', 'Jammi Fashion']);
  });
  test.each([
    ['Rohling aus dem L-Shop.', 'L-Shop'],
    ['Rohling aus dem LShop.', 'L-Shop'],
    ['Gedruckt mit Printequipment.', 'Printequipment'],
    ['Sublistar-Folie.', 'Sublistar'],
    ['Zertifiziert nach Oeko-Tex.', 'OEKO-TEX'],
    ['Das offizielle Merch.', 'offiziell'],
    ['Von Jammi Fashion aus Wrist.', 'Jammi Fashion'],
  ])('%s -> "%s"', (satz, begriff) => {
    expect(pruefeGeneratorText(lang(satz))).toEqual([`Begriff "${begriff}" in Produktbeschreibung.`]);
  });
  test('"JammiFashion" zusammengeschrieben ist erlaubt', () => {
    expect(pruefeGeneratorText(lang('Gedruckt bei JammiFashion.'))).toEqual([]);
  });
});

describe('4. Zeitangabe mit Zahl', () => {
  test.each(['in 3-4 Werktagen', 'nach 5 Tagen', 'in 2 Wochen', 'ca. 5–6 Werktage'])('"%s" -> Meldung', satz => {
    const h = pruefeGeneratorText(lang(`Lieferung ${satz}.`));
    expect(h).toHaveLength(1);
    expect(h[0]).toMatch(/^Zeitangabe ".+" in Produktbeschreibung – keine Liefer- oder Bearbeitungszeiten nennen\.$/);
  });
  test('Zahl ohne Zeiteinheit oder Einheit ohne Zahl meldet nicht', () => {
    expect(pruefeGeneratorText(lang('Seit 1990 im Verein, für alle Spieltage der Woche.'))).toEqual([]);
  });
});

describe('5. <h1>', () => {
  test('<h1> -> Meldung', () => {
    expect(pruefeGeneratorText(basis({ produktbeschreibung: '<h1>Cap</h1><h2>Logo</h2><p>Text</p>' })))
      .toEqual(['<h1> in Produktbeschreibung – die H1 ist der Produkttitel der Seite.']);
  });
  test('<h2>/<h3> melden nicht', () => {
    expect(pruefeGeneratorText(basis({ produktbeschreibung: '<h2>Logo</h2><h3>Details</h3><p>x</p>' }))).toEqual([]);
  });
});

describe('6. Stick bei Druck', () => {
  test.each(['Das Logo ist bestickt.', 'Mit Stick vorne.', 'Hochwertige Stickerei.'])('"%s" -> Meldung', satz => {
    expect(pruefeGeneratorText(lang(satz)))
      .toEqual(['Das Motiv ist gedruckt, der Text spricht von Stick/bestickt in Produktbeschreibung.']);
  });
  test('ohne Druck-Motiv keine Meldung; "Sticker" nie', () => {
    expect(pruefeGeneratorText({ ...lang('Das Logo ist bestickt.'), druck: false })).toEqual([]);
    expect(pruefeGeneratorText(lang('Mit Sticker-Set.'))).toEqual([]);
  });
});

describe('bestehende Pruefungen fuer die Cap (seo-prompt.js)', () => {
  const kurz = { produktname: NAME, keyphrase: KP, farben: [], groessen: [] };
  test('sauber -> keine Meldung', () => {
    expect(pruefeSeoText({ ...kurz, ...SAUBER })).toEqual([]);
  });
  test('Text vor der <h2> -> Meldung', () => {
    expect(pruefeSeoText({ ...kurz, ...SAUBER, produktbeschreibung: `Vorab. ${SAUBER.produktbeschreibung}` }).join(' '))
      .toMatch(/beginnt nicht mit <h2>/);
  });
  test('Keyphrase fehlt in Kurzbeschreibung und erstem <p> -> Meldungen', () => {
    const m = pruefeSeoText({ ...kurz, kurzbeschreibung: 'Schicke Kappe.',
      produktbeschreibung: '<h2>Logo vorne</h2><p>Eine Kappe für Fans.</p>' }).join(' ');
    expect(m).toMatch(/ersten 10 Wörtern der Kurzbeschreibung/);
    expect(m).toMatch(/erstes <p> nach der <h2>/);
  });
});
