// ── Partner-Kalkulation – Live-Berechnung Lizenz-Anteil pro Artikel ──────────
//
// Konfiguration wird aus Kalkulation_Fixkosten gelesen.
// Position-Namen (Header "Position", Wert "Betrag"):
//   Herstellungsnebenkosten   €/Artikel
//   Versandnebenkosten B      €/Bestellung
//   Versandnebenkosten P      €/Bestellung
//   Porto B                   €/Bestellung
//   Porto P                   €/Bestellung
//   PayPal Prozent            %  (von VK-Brutto)
//   PayPal Pauschale          €/Bestellung
//   MwSt                      %

const DEFAULT_KONFIG = {
  herstellungsnebenkosten: 0,
  versandnebenkostenB:     0,
  versandnebenkostenP:     0,
  portoB:                  0,
  portoP:                  0,
  paypalProzent:           0,
  paypalPauschale:         0,
  mwstProzent:             19,
};

const POSITION_MAP = {
  'Herstellungsnebenkosten': 'herstellungsnebenkosten',
  'Versandnebenkosten B':    'versandnebenkostenB',
  'Versandnebenkosten P':    'versandnebenkostenP',
  'Porto B':                 'portoB',
  'Porto P':                 'portoP',
  'PayPal Prozent':          'paypalProzent',
  'PayPal Pauschale':        'paypalPauschale',
  'MwSt':                    'mwstProzent',
};

export function parseKonfiguration(rows, header) {
  const h = col => header.indexOf(col);
  const result = { ...DEFAULT_KONFIG };
  for (const r of rows) {
    const pos = r[h('Position')];
    const key = POSITION_MAP[pos];
    if (!key) continue;
    const val = parseFloat((r[h('Betrag')] ?? '0').toString().replace(',', '.'));
    if (!Number.isNaN(val)) result[key] = val;
  }
  return result;
}

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * Berechnet den Partner-Anteil für einen einzelnen Verkaufsartikel.
 *
 * Porto-Modelle:
 *   - 'geteilt-50-50' (Default): Plattform und Partner teilen Porto-Kosten und
 *     Porto-Einnahmen je 50/50.
 *   - 'partner-trägt': Partner zahlt Porto-Kosten vollständig und bekommt
 *     Porto-Einnahme vollständig (Saldo komplett zum Partner-Anteil addiert).
 *
 * Lizenz-Aufteilung gilt nur für die Artikel-Marge (Gewinn vor Porto). Porto wird
 * separat zwischen Plattform und Partner verrechnet und am Ende auf die Anteile
 * aufgeschlagen.
 *
 * @param {Object}  input
 * @param {number}  input.vkBrutto                   VK-Preis inkl. MwSt (€)
 * @param {number}  input.ekPreis                    EK-Preis netto (€)
 * @param {number}  input.druckkosten                Druckkosten (€)
 * @param {'B'|'P'} input.versandart                 Versandart der Bestellung
 * @param {'geteilt-50-50'|'partner-trägt'} input.portoModell
 * @param {number}  input.anzahlArtikelInBestellung  Anzahl Artikel in der gesamten Bestellung
 *                                                   (Fallback wenn kein bestellungsAnteil)
 * @param {number}  [input.bestellungsAnteil]        Anteil dieses Artikels an der Bestellung
 *                                                   (0..1, z.B. item.total / order.total).
 *                                                   Überschreibt 1/anzahlArtikelInBestellung.
 * @param {number}  input.lizenzProzent              Lizenz-% des Partners (z.B. 30)
 * @param {number}  [input.portoEinnahmeAnteil]      Anteilige Porto-Einnahme aus WC shipping_total
 *                                                   für DIESEN Artikel (default 0 für Preview)
 * @param {Object}  input.konfiguration              Fixkosten-Konfiguration (siehe parseKonfiguration)
 *
 * @returns {Object} { herstellungspreis, versandnebenkosten, portoKostenAnteil,
 *                     portoEinnahmeAnteil, portoSaldoPartner, paypalKosten,
 *                     gewinnNetto, partnerAnteil, eigenAnteil }
 */
export function berechnePartnerAnteil({
  vkBrutto, ekPreis, druckkosten, versandart,
  portoModell, anzahlArtikelInBestellung, bestellungsAnteil,
  lizenzProzent, portoEinnahmeAnteil = 0, konfiguration,
}) {
  const k = { ...DEFAULT_KONFIG, ...(konfiguration ?? {}) };
  const anzahl = Math.max(1, anzahlArtikelInBestellung || 1);
  const va = (versandart || 'P').toUpperCase();
  // Anteil dieses Artikels an pro-Bestellung-Kosten:
  //   - Sync übergibt bestellungsAnteil (anteilig nach Artikelwert)
  //   - Preview ohne Aufteilung → 1/anzahl (Gleichverteilung)
  const anteil = (typeof bestellungsAnteil === 'number' && bestellungsAnteil >= 0)
    ? bestellungsAnteil
    : (1 / anzahl);

  const vkNetto           = vkBrutto / (1 + k.mwstProzent / 100);
  const herstellungspreis = (ekPreis || 0) + (druckkosten || 0) + k.herstellungsnebenkosten;

  const versandnebenkostenTotal = va === 'B' ? k.versandnebenkostenB : k.versandnebenkostenP;
  const versandnebenkosten      = versandnebenkostenTotal * anteil;

  const portoKostenTotal  = va === 'B' ? k.portoB : k.portoP;
  const portoKostenAnteil = portoKostenTotal * anteil;

  const paypalKosten = (vkBrutto * k.paypalProzent / 100) + (k.paypalPauschale * anteil);

  // gewinnNetto = reine Artikel-Marge ohne Porto.
  const gewinnNetto            = vkNetto - herstellungspreis - versandnebenkosten - paypalKosten;
  const partnerAnteilVomGewinn = gewinnNetto * (lizenzProzent || 0) / 100;

  // Porto-Saldo (Einnahme − Kosten) aufteilen.
  //   partner-trägt   → Partner bekommt 100 % des Saldos
  //   geteilt-50-50   → Partner bekommt 50 % des Saldos
  const portoSaldoArtikel = (portoEinnahmeAnteil || 0) - portoKostenAnteil;
  const portoSaldoPartner = portoModell === 'partner-trägt'
    ? portoSaldoArtikel
    : portoSaldoArtikel / 2;
  const portoSaldoPlattform = portoSaldoArtikel - portoSaldoPartner;

  const partnerAnteil = partnerAnteilVomGewinn + portoSaldoPartner;
  const eigenAnteil   = (gewinnNetto - partnerAnteilVomGewinn) + portoSaldoPlattform;

  return {
    herstellungspreis:   round2(herstellungspreis),
    versandnebenkosten:  round2(versandnebenkosten),
    portoKostenAnteil:   round2(portoKostenAnteil),
    portoEinnahmeAnteil: round2(portoEinnahmeAnteil || 0),
    portoSaldoPartner:   round2(portoSaldoPartner),
    paypalKosten:        round2(paypalKosten),
    gewinnNetto:         round2(gewinnNetto),
    partnerAnteil:       round2(partnerAnteil),
    eigenAnteil:         round2(eigenAnteil),
  };
}
