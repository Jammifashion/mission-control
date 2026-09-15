// B15: Herstellungskosten je Stück.
//
// vkNetto ist item.total, also der Wert der ganzen Zeile (Stückpreis × Menge).
// EK, Druck und Herstellungsnebenkosten wurden aber nur einmal abgezogen. Bei
// einer Zeile mit 3 Shirts rechnete die Lizenz mit 63 € Umsatz gegen die
// Herstellung von einem Shirt.
//
// Fixture: Order 16941 (JFN, Produkt 5420), vier Zeilen zum Stückpreis 21,00 €
// netto mit den Mengen 1, 2, 3 und 1. EK 3,00, Druck 2,10, Lizenz 40 %,
// kostenloser Versand. Fixkosten wie im Business-Sheet.

import { berechnePartnerAnteil } from '../utils/partner-kalkulation.js';

const KONFIG = {
  herstellungsnebenkosten: 0.80,
  versandnebenkostenB: 0.90, versandnebenkostenP: 1.41,
  portoB: 3, portoP: 6,
  paypalProzent: 2.49, paypalPauschale: 0.35,
  mwstProzent: 19,
};

const STUECKPREIS = 21.00;
const ORDER_16941 = [1, 2, 3, 1].map(menge => ({ menge, total: STUECKPREIS * menge }));
const ORDER_NETTO = ORDER_16941.reduce((s, z) => s + z.total, 0); // 147,00

const zeile = ({ menge, total }, over = {}) => berechnePartnerAnteil({
  vkNetto: total, ekPreis: 3.00, druckkosten: 2.10, versandart: 'P',
  portoModell: 'geteilt-50-50',
  bestellungsAnteil: total / ORDER_NETTO,
  stueckzahl: menge,
  lizenzProzent: 40, portoEinnahmeAnteil: 0, konfiguration: KONFIG,
  ...over,
});

// Unabhaengig nachgerechnet, nicht aus der Funktion abgeleitet.
function erwartet(menge) {
  const vk      = STUECKPREIS * menge;
  const anteil  = vk / ORDER_NETTO;
  const herst   = (3.00 + 2.10 + 0.80) * menge;
  const vnk     = 1.41 * anteil;
  const paypal  = vk * 1.19 * 0.0249 + 0.35 * anteil;
  const gewinn  = vk - herst - vnk - paypal;
  const porto   = (0 - 6 * anteil) / 2;
  return { herst, gewinn, partner: gewinn * 0.40 + porto };
}

const round2 = n => Math.round(n * 100) / 100;

describe('B15 – Herstellung je Stück (Order 16941)', () => {
  test.each([1, 2, 3])('Menge %i: Herstellungspreis = (EK + Druck + HNK) × Menge', (menge) => {
    const r = zeile({ menge, total: STUECKPREIS * menge });
    expect(r.herstellungspreis).toBe(round2(5.90 * menge));
    expect(r.gewinnNetto).toBe(round2(erwartet(menge).gewinn));
    expect(r.partnerAnteil).toBe(round2(erwartet(menge).partner));
  });

  test('konkrete Werte je Zeile', () => {
    const werte = ORDER_16941.map(z => zeile(z).partnerAnteil);
    expect(werte).toEqual([5.26, 10.52, 15.79, 5.26]);
  });

  // Alles in der Formel ist proportional zur Menge: Stückkosten direkt,
  // Versand-NK, Porto und PayPal über den Wertanteil. Eine Zeile mit 3 Stück
  // ist also so viel wert wie drei Zeilen mit je 1 Stück.
  test('3 Stück in einer Zeile = 3 × 1 Stück (ungerundet)', () => {
    const e1 = erwartet(1);
    const e3 = erwartet(3);
    expect(e3.partner).toBeCloseTo(3 * e1.partner, 10);
    expect(zeile({ menge: 3, total: 63 }).partnerAnteil).toBeCloseTo(3 * e1.partner, 2);
  });

  test('ohne Stückzahl gilt 1 (Vorschau, Altaufrufer)', () => {
    const mit  = zeile({ menge: 1, total: 21 });
    const ohne = zeile({ menge: 1, total: 21 }, { stueckzahl: undefined });
    expect(ohne).toEqual(mit);
  });

  test('Summe der Order über alle vier Zeilen', () => {
    const summe = round2(ORDER_16941.reduce((s, z) => s + zeile(z).partnerAnteil, 0));
    expect(summe).toBe(36.83);
  });
});

describe('B15 – was sich NICHT ändert', () => {
  test('Versand-NK, Porto und PayPal hängen nur am Wertanteil, nicht an der Menge', () => {
    const a = zeile({ menge: 1, total: 42 }, { bestellungsAnteil: 42 / ORDER_NETTO });
    const b = zeile({ menge: 2, total: 42 }, { bestellungsAnteil: 42 / ORDER_NETTO });
    expect(b.versandnebenkosten).toBe(a.versandnebenkosten);
    expect(b.portoKostenAnteil).toBe(a.portoKostenAnteil);
    expect(b.paypalKosten).toBe(a.paypalKosten);
    expect(b.portoSaldoPartner).toBe(a.portoSaldoPartner);
    // nur die Herstellung verdoppelt sich
    expect(b.herstellungspreis).toBe(round2(2 * a.herstellungspreis));
  });

  test('Storno mit negativer Menge spiegelt die Verkaufszeile', () => {
    const verkauf = zeile({ menge: 3, total: 63 }, { bestellungsAnteil: 1, versandart: 'P' });
    const storno  = berechnePartnerAnteil({
      vkNetto: -63, ekPreis: 3.00, druckkosten: 2.10, versandart: 'P',
      portoModell: 'geteilt-50-50', bestellungsAnteil: 1, stueckzahl: -3,
      lizenzProzent: 40, konfiguration: { ...KONFIG, versandnebenkostenP: 0, portoP: 0, paypalPauschale: 0 },
    });
    const verkaufOhneFix = berechnePartnerAnteil({
      vkNetto: 63, ekPreis: 3.00, druckkosten: 2.10, versandart: 'P',
      portoModell: 'geteilt-50-50', bestellungsAnteil: 1, stueckzahl: 3,
      lizenzProzent: 40, konfiguration: { ...KONFIG, versandnebenkostenP: 0, portoP: 0, paypalPauschale: 0 },
    });
    expect(verkauf.herstellungspreis).toBe(17.70);
    expect(storno.herstellungspreis).toBe(-17.70);
    expect(storno.partnerAnteil).toBe(-verkaufOhneFix.partnerAnteil);
  });
});
