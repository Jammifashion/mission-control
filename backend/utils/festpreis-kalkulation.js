// ── Festpreis-Kalkulation – Partner-Anteil bei Festpreismodell ───────────────
//
// Anders als das Lizenzmodell (%-Anteil vom Gewinn) zahlt die Plattform beim
// Festpreismodell einen fixen EK-Preis + Handling-Gebühr pro Artikel.
// Porto-Saldo (Einnahme − Kosten) geht 100% zum Partner ("partner-trägt").

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * Berechnet den Partner-Anteil für einen Festpreis-Artikel.
 *
 * @param {Object} input
 * @param {number} input.festpreisEK         Festpreis-EK-Netto (€)
 * @param {number} input.handlingGebuehr     Handling-Gebühr (€)
 * @param {number} input.portoEinnahmeAnteil Anteilige Porto-Einnahme (€)
 * @param {number} input.portoKostenAnteil   Anteilige Porto-Kosten (€)
 * @param {number} input.versandnkAnteil     Anteilige Versandnebenkosten (€)
 * @param {number} input.paypalKosten        PayPal-Kosten für diesen Artikel (€)
 * @param {number} input.mwstProzent         MwSt-Satz in % (z.B. 19)
 *
 * @returns {{ netto: number, brutto: number }}
 */
export function berechneFestpreisAnteil({
  festpreisEK = 0,        // Festpreis je Stück (netto)
  handlingskosten = 0,    // Handling je Stück (netto), wird ABGEZOGEN
  stueckzahl = 1,
  mehrkosten = 0,         // manueller Aufschlag je Zeile (z.B. 3XL), wird ADDIERT
  portoEinnahmeAnteil = 0,
  portoKostenAnteil = 0,
  versandnkAnteil = 0,
  paypalKosten = 0,
  mwstProzent = 19,
}) {
  // Auszahlung an Partner:
  //   (Festpreis − Handling) × Stückzahl + Mehrkosten
  //   + Porto-Einnahmen − Porto-Kosten − Versandnk − PayPal
  const netto = (festpreisEK - handlingskosten) * stueckzahl
              + mehrkosten
              + portoEinnahmeAnteil - portoKostenAnteil - versandnkAnteil - paypalKosten;
  const brutto = netto * (1 + mwstProzent / 100);
  return { netto: round2(netto), brutto: round2(brutto) };
}
