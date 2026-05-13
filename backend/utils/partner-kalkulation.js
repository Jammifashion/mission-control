// ── Partner-Kalkulation – Live-Berechnung Lizenz-Anteil pro Artikel ──────────
//
// Konfiguration wird aus Kalkulation_Fixkosten gelesen.
// Neues Schema (ab Phase 0.1): Position | Wert | Einheit | Gültig_ab | Gültig_bis
//
// Position-Namen:
//   Herstellungsnebenkosten   EUR/Artikel
//   Versandnebenkosten B      EUR/Bestellung
//   Versandnebenkosten P      EUR/Bestellung
//   Porto B                   EUR/Bestellung
//   Porto P                   EUR/Bestellung
//   PayPal Prozent            %  (von VK-Brutto)
//   PayPal Pauschale          EUR/Bestellung
//   MwSt                      %

function _parseDate(str) {
  if (!str) return null;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    const [d, m, y] = str.split('.');
    return new Date(`${y}-${m}-${d}T00:00:00Z`);
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function _toFloat(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(val.toString().replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}

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

/**
 * Liefert den gültigen Wert einer Fixkosten-Position zum angegebenen Datum.
 * Unterstützt das neue Schema (Wert | Gültig_ab | Gültig_bis).
 * Bei mehreren Treffern gewinnt die neueste Gültig_ab.
 */
export function getKostenSatz(rows, header, position, datum) {
  const d = datum instanceof Date ? datum : (_parseDate(datum) ?? new Date());
  const posIdx  = header.indexOf('Position');
  const wertIdx = header.indexOf('Wert');
  const abIdx   = header.indexOf('Gültig_ab');
  const bisIdx  = header.indexOf('Gültig_bis');

  const matches = [];
  for (const r of rows) {
    if ((r[posIdx] ?? '') !== position) continue;
    const ab = _parseDate(r[abIdx] ?? '');
    if (!ab || ab > d) continue;
    if (bisIdx !== -1 && r[bisIdx] && r[bisIdx].trim() !== '') {
      const bis = _parseDate(r[bisIdx]);
      if (bis && bis < d) continue;
    }
    matches.push({ val: _toFloat(r[wertIdx]), ab });
  }
  if (!matches.length) return null;
  matches.sort((a, b) => b.ab - a.ab);
  return matches[0].val;
}

/**
 * Baut das Konfigurations-Objekt für berechnePartnerAnteil auf.
 * datum (optional, Default: today) bestimmt, welche Version der Fixkosten gilt.
 */
export function parseKonfiguration(rows, header, datum = new Date()) {
  const result = { ...DEFAULT_KONFIG };
  for (const [pos, key] of Object.entries(POSITION_MAP)) {
    const val = getKostenSatz(rows, header, pos, datum);
    if (val !== null) result[key] = val;
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
 * @param {number}  input.vkNetto                    VK-Preis netto aus WC item.total (€)
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
 *                     gewinnNetto, partnerAnteil, eigenAnteil, netto, brutto }
 */
export function berechnePartnerAnteil({
  vkNetto, ekPreis, druckkosten, versandart,
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

  // WC item.total ist Netto – kein MwSt-Abzug erforderlich
  const herstellungspreis = (ekPreis || 0) + (druckkosten || 0) + k.herstellungsnebenkosten; // (netto)

  const versandnebenkostenTotal = va === 'B' ? k.versandnebenkostenB : k.versandnebenkostenP;
  const versandnebenkosten      = versandnebenkostenTotal * anteil; // (netto)

  const portoKostenTotal  = va === 'B' ? k.portoB : k.portoP;
  const portoKostenAnteil = portoKostenTotal * anteil; // (netto)

  const paypalKosten = (vkNetto * k.paypalProzent / 100) + (k.paypalPauschale * anteil); // (netto)

  // gewinnNetto = reine Artikel-Marge ohne Porto.
  const gewinnNetto            = vkNetto - herstellungspreis - versandnebenkosten - paypalKosten; // (netto)
  const partnerAnteilVomGewinn = gewinnNetto * (lizenzProzent || 0) / 100; // (netto)

  // Porto-Saldo (Einnahme − Kosten) aufteilen. Alle Werte netto (WC shipping_total ist netto).
  //   partner-trägt   → Partner bekommt 100 % des Saldos
  //   geteilt-50-50   → Partner bekommt 50 % des Saldos
  const portoSaldoArtikel   = (portoEinnahmeAnteil || 0) - portoKostenAnteil; // (netto)
  const portoSaldoPartner   = portoModell === 'partner-trägt'
    ? portoSaldoArtikel
    : portoSaldoArtikel / 2;
  const portoSaldoPlattform = portoSaldoArtikel - portoSaldoPartner;

  const partnerAnteil = partnerAnteilVomGewinn + portoSaldoPartner; // (netto)
  const eigenAnteil   = (gewinnNetto - partnerAnteilVomGewinn) + portoSaldoPlattform; // (netto)

  const partnerAnteilBrutto = round2(partnerAnteil * (1 + k.mwstProzent / 100)); // (brutto)

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
    netto:               round2(partnerAnteil),
    brutto:              partnerAnteilBrutto,
  };
}
