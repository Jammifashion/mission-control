// B1: Fehlende Spalten in Kalkulation_Fixkosten duerfen nicht still auf 0
// zurueckfallen.
//
// getKostenSatz loeste Position/Wert/Gueltig_ab ueber header.indexOf() auf,
// ohne -1 zu pruefen. Bei einer umbenannten Spalte liefert r[-1] undefined,
// kein Eintrag trifft, die Funktion gibt null zurueck - und
// parseKonfiguration nimmt DEFAULT_KONFIG mit lauter Nullen. Der Partnerteil
// wird dann zu hoch berechnet, ohne Fehler, ohne Log, mit HTTP 200.
//
// Genau dieser Fehlermodus steht in utils/sheet-headers.js als Regel 2
// beschrieben; requireHeader() existiert, um ihn zu verhindern.

import {
  getKostenSatz, parseKonfiguration, berechnePartnerAnteil,
} from '../utils/partner-kalkulation.js';
import { MissingHeaderError } from '../utils/sheet-headers.js';

const HEADER = ['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis'];
const ROWS = [
  ['Herstellungsnebenkosten', '0,55', 'EUR/Artikel',    '01.01.2026', ''],
  ['Versandnebenkosten P',    '0,40', 'EUR/Bestellung', '01.01.2026', ''],
  ['Porto P',                 '4,50', 'EUR/Bestellung', '01.01.2026', ''],
  ['PayPal Prozent',          '2,49', '%',              '01.01.2026', ''],
  ['PayPal Pauschale',        '0,35', 'EUR/Bestellung', '01.01.2026', ''],
  ['MwSt',                    '19',   '%',              '01.01.2026', ''],
];

describe('vollstaendige Kopfzeile - unveraendertes Verhalten', () => {
  test('liest die Werte', () => {
    expect(getKostenSatz(ROWS, HEADER, 'Porto P', new Date('2026-06-01'))).toBe(4.5);
    expect(getKostenSatz(ROWS, HEADER, 'MwSt', new Date('2026-06-01'))).toBe(19);
  });

  test('unbekannte Position liefert weiterhin null', () => {
    expect(getKostenSatz(ROWS, HEADER, 'Gibtsnicht', new Date('2026-06-01'))).toBeNull();
  });

  test('parseKonfiguration uebernimmt die Sheet-Werte', () => {
    const k = parseKonfiguration(ROWS, HEADER, new Date('2026-06-01'));
    expect(k.herstellungsnebenkosten).toBe(0.55);
    expect(k.portoP).toBe(4.5);
    expect(k.paypalProzent).toBe(2.49);
    expect(k.mwstProzent).toBe(19);
  });
});

describe('fehlende Pflichtspalte bricht ab, statt still 0 zu rechnen', () => {
  test.each(['Position', 'Wert', 'Gültig_ab'])(
    'Spalte %s fehlt -> MissingHeaderError', (fehlend) => {
      const kaputt = HEADER.map(h => (h === fehlend ? `${h}_alt` : h));
      expect(() => getKostenSatz(ROWS, kaputt, 'Porto P', new Date('2026-06-01')))
        .toThrow(MissingHeaderError);
    },
  );

  test('parseKonfiguration reicht den Fehler durch', () => {
    const kaputt = HEADER.map(h => (h === 'Gültig_ab' ? 'Gueltig_ab' : h));
    expect(() => parseKonfiguration(ROWS, kaputt, new Date('2026-06-01')))
      .toThrow(MissingHeaderError);
  });

  test('der Fehler nennt Spalte und Reiter', () => {
    const kaputt = HEADER.map(h => (h === 'Wert' ? 'Betrag' : h));
    try {
      parseKonfiguration(ROWS, kaputt, new Date('2026-06-01'));
      throw new Error('haette werfen muessen');
    } catch (e) {
      expect(e).toBeInstanceOf(MissingHeaderError);
      expect(e.message).toContain('Wert');
      expect(e.message).toContain('Kalkulation_Fixkosten');
      expect(e.status).toBe(500);
    }
  });

  // Gültig_bis ist optional - eine Fixkostenzeile ohne Enddatum ist der
  // Normalfall, und der Reiter hatte die Spalte frueher gar nicht.
  test('Gültig_bis darf fehlen', () => {
    const ohne = ['Position', 'Wert', 'Einheit', 'Gültig_ab'];
    const rows = ROWS.map(r => r.slice(0, 4));
    expect(getKostenSatz(rows, ohne, 'Porto P', new Date('2026-06-01'))).toBe(4.5);
  });
});

// Das eigentliche Risiko in Zahlen: so weit lag der Partnerteil daneben.
describe('Auswirkung auf den Partneranteil', () => {
  const ARTIKEL = {
    vkNetto: 25.00, ekPreis: 7.80, druckkosten: 3.20,
    versandart: 'P', portoModell: 'geteilt-50-50',
    anzahlArtikelInBestellung: 1, lizenzProzent: 30,
    portoEinnahmeAnteil: 4.19,
  };

  test('mit echten Fixkosten vs. stillem Nullfall', () => {
    const echt = berechnePartnerAnteil({
      ...ARTIKEL, konfiguration: parseKonfiguration(ROWS, HEADER, new Date('2026-06-01')),
    });
    // Der Zustand vor dem Fix: alle Positionen 0, nur MwSt aus DEFAULT_KONFIG.
    const still = berechnePartnerAnteil({
      ...ARTIKEL,
      konfiguration: {
        herstellungsnebenkosten: 0, versandnebenkostenB: 0, versandnebenkostenP: 0,
        portoB: 0, portoP: 0, paypalProzent: 0, paypalPauschale: 0, mwstProzent: 19,
      },
    });

    expect(still.partnerAnteil).toBeGreaterThan(echt.partnerAnteil);
    // Belegt, dass es nicht um Rundungsrauschen geht.
    expect(still.partnerAnteil - echt.partnerAnteil).toBeGreaterThan(1);
  });
});
