// B9: portoModell wurde nicht validiert.
//
//   portoModell === 'partner-trägt' ? voller Saldo : halber Saldo
//
// Jeder andere Wert bedeutete still 50/50. Ein Tippfehler, ein nachgestelltes
// Leerzeichen oder eine abweichende Unicode-Normalform des "ä" (NFD statt NFC,
// entsteht beim Kopieren aus macOS oder manchen PDFs) sieht im Tabellenblatt
// identisch aus, halbiert aber den Porto-Anteil des Partners.

import { jest } from '@jest/globals';
import {
  berechnePartnerAnteil, parseKonfiguration, _resetWarnungen,
} from '../utils/partner-kalkulation.js';

const KONFIG = {
  herstellungsnebenkosten: 0.80, versandnebenkostenB: 1.00, versandnebenkostenP: 1.60,
  portoB: 2.51, portoP: 5.04, paypalProzent: 2.49, paypalPauschale: 0.35,
  mwstProzent: 19,
};

const BASIS = {
  vkNetto: 42.00, ekPreis: 9.50, druckkosten: 4.00, versandart: 'P',
  anzahlArtikelInBestellung: 1, lizenzProzent: 30,
  portoEinnahmeAnteil: 4.19, konfiguration: KONFIG,
};

const anteilMit = m => berechnePartnerAnteil({ ...BASIS, portoModell: m }).portoSaldoPartner;

let warnSpy;
beforeEach(() => {
  _resetWarnungen();   // Einmal-Warnungen sind prozessweit, sonst faerben Tests ab
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('anerkannte Werte', () => {
  test("'partner-trägt' gibt den vollen Saldo", () => {
    // Saldo = Einnahme 4.19 - Kosten 5.04 = -0.85
    expect(anteilMit('partner-trägt')).toBeCloseTo(-0.85, 2);
  });

  // round2 rundet den halben Saldo (-0.425) auf -0.42: Math.round(-42.5) ist
  // in JS -42, also Richtung +unendlich. Siehe B8 zum Rundungsverhalten.
  test("'geteilt-50-50' gibt den halben Saldo", () => {
    expect(anteilMit('geteilt-50-50')).toBeCloseTo(-0.42, 2);
  });

  test('keiner der beiden warnt', () => {
    anteilMit('partner-trägt');
    anteilMit('geteilt-50-50');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('Schreibweisen, die dasselbe meinen', () => {
  test.each([
    ['partner-trägt '],            // nachgestelltes Leerzeichen
    [' partner-trägt'],
    ['Partner-trägt'],             // Grossschreibung
    ['PARTNER-TRÄGT'],
    ['partner-trägt'],       // NFD: a + kombinierendes Trema
  ])('%p wird wie partner-trägt behandelt', (wert) => {
    expect(anteilMit(wert)).toBeCloseTo(-0.85, 2);
  });

  test.each([
    ['geteilt-50-50 '],
    ['Geteilt-50-50'],
  ])('%p wird wie geteilt-50-50 behandelt', (wert) => {
    expect(anteilMit(wert)).toBeCloseTo(-0.42, 2);
  });
});

describe('unbekannte Werte', () => {
  test('fallen weiterhin auf 50/50, aber mit Warnung', () => {
    expect(anteilMit('partner-traegt')).toBeCloseTo(-0.42, 2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[kalkulation]'),
    );
    expect(warnSpy.mock.calls.at(-1).join(' ')).toContain('partner-traegt');
  });

  test('leer und undefined warnen nicht - das ist der dokumentierte Default', () => {
    expect(anteilMit(undefined)).toBeCloseTo(-0.42, 2);
    expect(anteilMit('')).toBeCloseTo(-0.42, 2);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ── Unbekannte Positionen im Fixkosten-Reiter ───────────────────────────────
//
// Im Reiter stehen Zeilen, die in keiner POSITION_MAP vorkommen
// (Nebenkosten, Versandanteil, PayPal-Anteil). Sie werden ignoriert - das ist
// richtig, soll aber nicht lautlos passieren: wer sie pflegt, denkt sonst,
// sie wirken.

describe('unbekannte Fixkosten-Positionen', () => {
  const HEADER = ['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis'];
  const ROWS = [
    ['MwSt',          '19',   '%',           '01.01.2022', ''],
    ['Porto P',       '5,04', 'EUR/Best.',   '01.01.2022', ''],
    ['Nebenkosten',   '0,8',  'EUR/Artikel', '13.05.2026', ''],
    ['Versandanteil', '1,75', 'EUR/Artikel', '01.01.2022', ''],
    ['PayPal-Anteil', '0,66', '%/VK',        '01.01.2022', ''],
  ];

  test('werden gemeldet, aber nicht zum Fehler', () => {
    const k = parseKonfiguration(ROWS, HEADER, new Date('2026-09-01'));
    expect(k.portoP).toBe(5.04);
    expect(k.mwstProzent).toBe(19);

    const log = warnSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(log).toContain('[kalkulation]');
    expect(log).toContain('unbekannte Position ignoriert');
    for (const p of ['Nebenkosten', 'Versandanteil', 'PayPal-Anteil']) {
      expect(log).toContain(p);
    }
  });

  test('bekannte Positionen tauchen in der Warnung nicht auf', () => {
    parseKonfiguration(ROWS, HEADER, new Date('2026-09-01'));
    const log = warnSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(log).not.toContain('Porto P');
    expect(log).not.toContain('MwSt');
  });

  test('nur einmal pro Prozess, nicht bei jedem Aufruf', () => {
    parseKonfiguration(ROWS, HEADER, new Date('2026-09-01'));
    const nachErstem = warnSpy.mock.calls.length;
    expect(nachErstem).toBeGreaterThan(0);
    parseKonfiguration(ROWS, HEADER, new Date('2026-09-01'));
    parseKonfiguration(ROWS, HEADER, new Date('2026-09-01'));
    expect(warnSpy.mock.calls.length).toBe(nachErstem);
  });

  test('ohne unbekannte Positionen keine Warnung', () => {
    const nurBekannt = ROWS.slice(0, 2);
    parseKonfiguration(nurBekannt, HEADER, new Date('2026-09-01'));
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
