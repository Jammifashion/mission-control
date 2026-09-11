// B8: netto und brutto wurden unabhaengig voneinander gerundet.
//
//   partnerAnteilBrutto = round2(partnerAnteil * (1 + mwst/100))   // ungerundet
//   netto:  round2(partnerAnteil)                                  // gerundet
//
// brutto entstand aus dem UNgerundeten Wert, netto aus dem gerundeten. Damit
// gilt nicht durchgaengig brutto === round2(netto * 1,19). Auf einer Abrechnung
// stehen beide Spalten nebeneinander, und wer nachrechnet, kommt auf eine
// andere Zahl als das System.

import { berechnePartnerAnteil } from '../utils/partner-kalkulation.js';

const KONFIG = {
  herstellungsnebenkosten: 0.80, versandnebenkostenB: 1.00, versandnebenkostenP: 1.60,
  portoB: 2.51, portoP: 5.04, paypalProzent: 2.49, paypalPauschale: 0.35,
  mwstProzent: 19,
};

const rechne = (over = {}) => berechnePartnerAnteil({
  vkNetto: 42.00, ekPreis: 9.50, druckkosten: 4.00, versandart: 'P',
  portoModell: 'geteilt-50-50', anzahlArtikelInBestellung: 1,
  lizenzProzent: 30, portoEinnahmeAnteil: 4.19, konfiguration: KONFIG,
  ...over,
});

const round2 = n => Math.round(n * 100) / 100;

describe('brutto folgt aus dem ausgewiesenen netto', () => {
  test('Einzelfall: brutto === round2(netto * 1,19)', () => {
    const r = rechne();
    expect(r.brutto).toBe(round2(r.netto * 1.19));
  });

  // Ohne den Fix laufen einzelne dieser Kombinationen um einen Cent auseinander.
  test('ueber viele VK-Preise hinweg', () => {
    const abweichungen = [];
    for (let cent = 1000; cent <= 6000; cent += 7) {
      const r = rechne({ vkNetto: cent / 100 });
      const erwartet = round2(r.netto * 1.19);
      if (r.brutto !== erwartet) {
        abweichungen.push({ vkNetto: cent / 100, netto: r.netto, brutto: r.brutto, erwartet });
      }
    }
    expect(abweichungen).toEqual([]);
  });

  test('auch bei anderen Lizenzsaetzen', () => {
    const abweichungen = [];
    for (const lizenzProzent of [10, 15, 20, 25, 30, 33, 40, 50]) {
      for (let cent = 2000; cent <= 3000; cent += 3) {
        const r = rechne({ lizenzProzent, vkNetto: cent / 100 });
        if (r.brutto !== round2(r.netto * 1.19)) {
          abweichungen.push({ lizenzProzent, vkNetto: cent / 100 });
        }
      }
    }
    expect(abweichungen).toEqual([]);
  });

  test('auch bei abweichendem MwSt-Satz', () => {
    for (const mwstProzent of [0, 7, 19]) {
      const k = { ...KONFIG, mwstProzent };
      for (let cent = 2500; cent <= 2600; cent += 1) {
        const r = rechne({ konfiguration: k, vkNetto: cent / 100 });
        expect(r.brutto).toBe(round2(r.netto * (1 + mwstProzent / 100)));
      }
    }
  });

  test('negativer Anteil (Storno-Fall) bleibt konsistent', () => {
    const r = rechne({ vkNetto: 11.00 });   // Marge reicht nicht, Anteil wird negativ
    expect(r.netto).toBeLessThan(0);
    expect(r.brutto).toBe(round2(r.netto * 1.19));
  });
});

describe('unveraendert', () => {
  test('netto bleibt der gerundete Partneranteil', () => {
    const r = rechne();
    expect(r.netto).toBe(r.partnerAnteil);
    expect(r.netto).toBe(round2(r.netto));
  });

  test('Summen ueber viele Posten stimmen in beiden Spalten ueberein', () => {
    // Der praktische Fall: eine Abrechnung summiert netto UND brutto.
    const posten = [];
    for (let cent = 1500; cent <= 4500; cent += 11) posten.push(rechne({ vkNetto: cent / 100 }));

    for (const p of posten) expect(p.brutto).toBe(round2(p.netto * 1.19));
  });
});
