// FM2 (28.10.): Regeln 8 (Knappheitsfloskeln) und 9 (Faserangabe unvollstaendig)
// in lib/seo-pruefung.js. Anlass: Haiku schrieb "80 % Baumwolle, 280 g/m²" fuer
// einen 80/20-Hoodie und "bestell ihn, solange er da ist" - beides blieb ungemeldet.

import { pruefeGeneratorText, KNAPPHEIT, faserNamen, grundFaser } from '../lib/seo-pruefung.js';
import { SEO_SYSTEM_PROMPT } from '../lib/seo-prompt.js';

const lang = t => ({ kurzbeschreibung: '', produktbeschreibung: `<h2>Logo</h2><p>${t}</p>` });
const kurz = (t, faser) => ({ kurzbeschreibung: t, produktbeschreibung: '<h2>Logo</h2><p>Text.</p>', faser });

describe('8. Knappheitsfloskeln', () => {
  test.each([
    ['Bestell ihn, solange er da ist.',             'solange er da ist'],
    ['Nur solange der Vorrat reicht.',              'solange der Vorrat reicht'],
    ['Solange es ihn noch vorrätig gibt.',          'Solange es ihn noch vorrätig'],
    ['Hol ihn dir, bevor andere es tun.',           'bevor andere'],
    ['Komm den anderen zuvor? Jetzt zuvorkommen.',  'zuvorkommen'],
    ['Jetzt zuschlagen!',                           'zuschlagen'],
    ['Greif zu.',                                   'Greif zu'],
    ['Jetzt dein Exemplar sichern.',                'Jetzt dein Exemplar sichern'],
    ['Es gibt nur noch wenige.',                    'nur noch'],
    ['Eine begrenzte Auflage.',                     'begrenzte'],
    ['Limitiert auf diese Saison.',                 'Limitiert'],
    ['Die Limited Edition.',                        'Limited'],
    ['Bald ausverkauft.',                           'ausverkauft'],
  ])('%s -> Meldung', (satz, stelle) => {
    expect(pruefeGeneratorText(lang(satz))).toEqual([
      `Knappheitsfloskel "${stelle}" in Produktbeschreibung – wir drucken auf Bestellung, nichts ist knapp.`,
    ]);
  });

  test('Kurz- und Produktbeschreibung getrennt gemeldet', () => {
    const h = pruefeGeneratorText({ kurzbeschreibung: 'Jetzt zuschlagen.', produktbeschreibung: '<p>Schlag zu.</p>' });
    expect(h).toEqual([
      'Knappheitsfloskel "zuschlagen" in Kurzbeschreibung – wir drucken auf Bestellung, nichts ist knapp.',
      'Knappheitsfloskel "Schlag zu" in Produktbeschreibung – wir drucken auf Bestellung, nichts ist knapp.',
    ]);
  });

  test.each([
    'Größe wählen und jetzt bestellen.',
    'Trag ihn, solange du willst.',
    'Unbegrenzt kombinierbar mit Jeans.',
    'Der Druck ist sicher verarbeitet.',
    'Ein Hoodie für alle Fans.',
  ])('%s -> still', satz => {
    expect(pruefeGeneratorText(lang(satz))).toEqual([]);
  });

  test('Fundwort im Produktnamen = Motivtitel -> still (Scan: "Rentier war ausverkauft")', () => {
    const t = { ...lang('Der Rentier war ausverkauft Sweater in Deep Black.'), kurzbeschreibung: 'Rentier war ausverkauft Sweater.' };
    expect(pruefeGeneratorText({ ...t, produktname: 'Rentier war ausverkauft – Ugly Christmas Sweater Damen' })).toEqual([]);
    expect(pruefeGeneratorText({ ...t, produktname: 'Ugly Christmas Sweater' })).toHaveLength(2);
  });

  test('Muster stehen nicht im Systemprompt', () => {
    expect(KNAPPHEIT.length).toBeGreaterThan(5);
    expect(SEO_SYSTEM_PROMPT).not.toMatch(/zuschlagen|bevor andere|solange|limitiert|ausverkauft/i);
  });
});

describe('9. Faserangabe unvollstaendig', () => {
  const MISCH = '80% Baumwolle / 20% Polyester';

  test('faserNamen: Wort nach jeder Prozentzahl, ohne Dubletten', () => {
    expect(faserNamen(MISCH)).toEqual(['Baumwolle', 'Polyester']);
    expect(faserNamen('Body: 100% Baumwolle; Futter: 100% Baumwolle')).toEqual(['Baumwolle']);
    expect(faserNamen('60 % Bio-Baumwolle, 40 % Polyester (recycelt)')).toEqual(['Bio-Baumwolle', 'Polyester']);
    expect(faserNamen('')).toEqual([]);
  });

  test('FM2-Fall: nur eine Faser genannt -> Meldung', () => {
    expect(pruefeGeneratorText(kurz('Hoodie aus 80 % Baumwolle, 280 g/m².', MISCH))).toEqual([
      `Faserangabe unvollständig in Kurzbeschreibung: "80 % Baumwolle" – laut Artikel "${MISCH}", es fehlt Polyester.`,
    ]);
  });

  test('auch in der Produktbeschreibung', () => {
    expect(pruefeGeneratorText({ ...lang('Material: 80% Baumwolle.'), faser: MISCH })).toEqual([
      `Faserangabe unvollständig in Produktbeschreibung: "80% Baumwolle" – laut Artikel "${MISCH}", es fehlt Polyester.`,
    ]);
  });

  test('alle Fasern genannt -> still (Reihenfolge, Schreibweise egal)', () => {
    expect(pruefeGeneratorText(kurz('80 % Baumwolle, 20 % Polyester.', MISCH))).toEqual([]);
    expect(pruefeGeneratorText(kurz('Aus 20% polyester und 80% baumwolle.', MISCH))).toEqual([]);
  });

  test('keine Prozentangabe im Text -> still', () => {
    expect(pruefeGeneratorText(kurz('Weicher Hoodie aus Baumwolle.', MISCH))).toEqual([]);
  });

  test('reiner Stoff (eine Faser) -> nie', () => {
    expect(pruefeGeneratorText(kurz('Aus 100 % Baumwolle.', '100% Baumwolle'))).toEqual([]);
  });

  test('ohne Faserangabe des Artikels -> still', () => {
    expect(pruefeGeneratorText(kurz('Aus 80 % Baumwolle.', undefined))).toEqual([]);
  });

  test('grundFaser: Farb-Ausnahmen in Klammern fallen weg (Scan: 340 Fehlalarme "fehlt Viskose")', () => {
    expect(grundFaser('100% Baumwolle (Sports Grey: 85% Baumwolle / 15% Viskose)')).toBe('100% Baumwolle');
    expect(grundFaser('80% Baumwolle / 20% Polyester (Heather Grey: 75% Baumwolle / 21% Polyester / 4% Viskose), (Heather Mid Grey: 60% Baumwolle / 40% Polyester)'))
      .toBe('80% Baumwolle / 20% Polyester');
    expect(grundFaser('')).toBeNull();
    expect(grundFaser(null)).toBeNull();
  });
});
