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

import { requireHeader, findHeader } from './sheet-headers.js';

// Kontext fuer die Fehlermeldung, wenn eine Pflichtspalte fehlt.
const KONTEXT = 'Kalkulation_Fixkosten';

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

// Exportiert, damit die Fixkosten-API pro Zeile sagen kann, ob die Position
// ueberhaupt in eine Berechnung eingeht (Feld "bekannt"). Ohne das muesste das
// Frontend eine zweite Liste derselben Namen pflegen - und die waere genau die
// Quelle, aus der die wirkungslosen Zeilen ueberhaupt entstanden sind.
export const POSITION_MAP = {
  'Herstellungsnebenkosten': 'herstellungsnebenkosten',
  'Versandnebenkosten B':    'versandnebenkostenB',
  'Versandnebenkosten P':    'versandnebenkostenP',
  'Porto B':                 'portoB',
  'Porto P':                 'portoP',
  'PayPal Prozent':          'paypalProzent',
  'PayPal Pauschale':        'paypalPauschale',
  'MwSt':                    'mwstProzent',
};

// ── Porto-Modelle ───────────────────────────────────────────────────────────
//
// Die Aufteilung des Porto-Saldos haengt an einem Freitext aus dem Sheet. Vor
// der Normalisierung entschied ein exakter Vergleich: jeder abweichende Wert
// bedeutete still 50/50. Ein nachgestelltes Leerzeichen oder eine andere
// Unicode-Normalform des "ä" (NFD statt NFC - entsteht beim Kopieren aus macOS
// oder manchen PDFs) sieht im Tabellenblatt identisch aus, halbiert aber den
// Porto-Anteil des Partners.
export const PORTO_MODELL_DEFAULT = 'geteilt-50-50';
const PORTO_MODELLE = new Set(['partner-trägt', PORTO_MODELL_DEFAULT]);

// Einmal-Warnungen. Sie sollen auffallen, aber bei einem Sync ueber hunderte
// Zeilen nicht das Log fluten.
const gemeldetePortoModelle = new Set();
let positionenGemeldet = false;

// Nur fuer Tests.
export function _resetWarnungen() {
  gemeldetePortoModelle.clear();
  positionenGemeldet = false;
}

export function normalisierePortoModell(wert) {
  const roh = String(wert ?? '').trim();
  // Leer ist kein Fehler, sondern der dokumentierte Default.
  if (roh === '') return PORTO_MODELL_DEFAULT;

  const norm = roh.normalize('NFC').toLowerCase();
  if (PORTO_MODELLE.has(norm)) return norm;

  if (!gemeldetePortoModelle.has(roh)) {
    gemeldetePortoModelle.add(roh);
    console.warn(
      `[kalkulation] unbekanntes Porto-Modell ignoriert: "${roh}" - es gilt `
      + `${PORTO_MODELL_DEFAULT}. Erlaubt sind: ${[...PORTO_MODELLE].join(', ')}.`,
    );
  }
  return PORTO_MODELL_DEFAULT;
}

// Prueft, ob eine Position aus dem Sheet in eine Berechnung eingeht.
export function istBekanntePosition(position) {
  return Object.prototype.hasOwnProperty.call(
    POSITION_MAP, String(position ?? '').trim(),
  );
}

// Positionen im Fixkosten-Reiter, die in keiner POSITION_MAP stehen, werden
// ignoriert. Das ist richtig, soll aber nicht lautlos passieren: wer sie
// pflegt, nimmt sonst an, sie wirkten.
function meldeUnbekanntePositionen(rows, header) {
  if (positionenGemeldet) return;
  const posIdx = findHeader(header, 'Position');
  if (posIdx === -1) return;

  const unbekannt = [...new Set(
    rows.map(r => String(r[posIdx] ?? '').trim())
        .filter(p => p && !istBekanntePosition(p)),
  )];
  if (!unbekannt.length) return;

  positionenGemeldet = true;
  console.warn(`[kalkulation] unbekannte Position ignoriert: ${unbekannt.join(', ')}`);
}

/**
 * Liefert den gültigen Wert einer Fixkosten-Position zum angegebenen Datum.
 * Unterstützt das neue Schema (Wert | Gültig_ab | Gültig_bis).
 * Bei mehreren Treffern gewinnt die neueste Gültig_ab.
 */
export function getKostenSatz(rows, header, position, datum) {
  const d = datum instanceof Date ? datum : (_parseDate(datum) ?? new Date());

  // Pflichtspalten werfen, statt auf -1 zu laufen. Sonst liest r[-1] undefined,
  // kein Eintrag trifft, die Funktion liefert null - und parseKonfiguration
  // nimmt DEFAULT_KONFIG mit lauter Nullen. Der Partneranteil faellt dann zu
  // hoch aus, ohne Fehler, ohne Log, mit HTTP 200. Ein 500er ist hier deutlich
  // billiger als eine stille Fehlberechnung.
  const posIdx  = requireHeader(header, 'Position',   KONTEXT);
  const wertIdx = requireHeader(header, 'Wert',       KONTEXT);
  const abIdx   = requireHeader(header, 'Gültig_ab',  KONTEXT);
  // Gültig_bis ist optional: eine Fixkostenzeile ohne Enddatum ist der
  // Normalfall, und den Reiter gab es frueher ganz ohne diese Spalte.
  const bisIdx  = findHeader(header, 'Gültig_bis');

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
  meldeUnbekanntePositionen(rows, header);
  return result;
}

// ── Lizenzsatz (B16) ────────────────────────────────────────────────────────
//
// Der Satz gilt je Partner und steht im Partner-Reiter. Partner_Artikel hat
// ebenfalls eine Spalte Lizenz-% - die wurde beim Import einmal aus dem Partner
// kopiert und danach nie nachgezogen. Sie lief deshalb auseinander (50 % im
// Artikel, 40 % beim Partner) und der Sync rechnete mit dem veralteten Wert.
// Partner_Artikel.Lizenz-% wird nicht mehr gelesen.
//
// Ein fehlender Satz ist ein Fehler, keine 0: toFloat('') ergab frueher 0 %,
// der Partner bekam dann nur seinen Porto-Saldo, mit HTTP 200.
export function baueLizenzSaetze(header, rows) {
  const idIdx  = requireHeader(header, 'Partner-ID', 'Partner');
  const lizIdx = requireHeader(header, 'Lizenz-%',   'Partner');
  const roh = new Map();
  for (const r of rows ?? []) {
    const id = String(r[idIdx] ?? '').trim();
    if (id) roh.set(id, r[lizIdx]);
  }

  return function lizenzSatz(partnerId) {
    const id = String(partnerId ?? '').trim();
    if (!roh.has(id)) {
      throw Object.assign(
        new Error(`Lizenzsatz fehlt: Partner ${id || '(leer)'} steht nicht im Partner-Reiter.`),
        { status: 500 },
      );
    }
    const s = String(roh.get(id) ?? '').trim().replace('%', '').trim().replace(',', '.');
    const n = s === '' ? NaN : Number(s);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw Object.assign(
        new Error(`Lizenzsatz fehlt oder ist ungueltig für Partner ${id}: `
                + `Lizenz-% im Partner-Reiter ist "${roh.get(id) ?? ''}".`),
        { status: 500 },
      );
    }
    return n;
  };
}

// ── Vertragsbeginn je Partner (Spalte Vertrag-ab) ──────────────────────────
//
// Ab wann gilt die Vereinbarung mit einem Partner? Bestellungen davor gehoeren
// ihm nicht. Ohne diese Grenze holte ein Neu-Sync mit fruehem after die ganze
// Shop-Historie (P-004: Bestellungen ab 2022, Vereinbarung ab 01.01.2025).
//
// Leer = keine Grenze. Fehlt die Spalte ganz, gilt fuer niemanden eine Grenze -
// fuer bestehende Partner aendert sich damit nichts. Ein nicht leerer, aber
// ungueltiger Wert ist ein Fehler: still "keine Grenze" waere genau der Fall,
// den die Spalte verhindern soll.
export function parseVertragAb(wert, partnerId = '', status = 400) {
  const s = String(wert ?? '').trim();
  if (s === '') return null;
  let t, m, j, treffer;
  if ((treffer = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) [, t, m, j] = treffer;
  else if ((treffer = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [, j, m, t] = treffer;
  const d = treffer ? new Date(Date.UTC(+j, +m - 1, +t)) : null;
  // 31.02.2025 wuerde Date still auf den 03.03. rollen - das ist kein gueltiges Datum.
  if (!d || d.getUTCDate() !== +t || d.getUTCMonth() !== +m - 1) {
    throw Object.assign(
      new Error(`Vertrag-ab ist ungültig für Partner ${partnerId || '(unbekannt)'}: "${s}" (erwartet TT.MM.JJJJ).`),
      { status },
    );
  }
  return d;
}

export function baueVertragsbeginne(header, rows) {
  const idIdx = requireHeader(header, 'Partner-ID', 'Partner');
  const vIdx  = findHeader(header, 'Vertrag-ab');
  const roh = new Map();
  if (vIdx !== -1) {
    for (const r of rows ?? []) {
      const id = String(r[idIdx] ?? '').trim();
      if (id) roh.set(id, r[vIdx]);
    }
  }
  // Im Sync/Abrechnungs-Kontext ist ein kaputter Wert ein Serverfehler (500).
  return partnerId => parseVertragAb(roh.get(String(partnerId ?? '').trim()), partnerId, 500);
}

// Welcher Satz steckt in einer gespeicherten Verkaufszeile? Abgeleitet aus
// Lizenz-Anteil ÷ Gewinn-netto der Zeile selbst, nicht aus dem aktuellen
// Partner-Satz: eine Zeile, die mit 50 % gerechnet wurde, zeigt auch nach der
// Umstellung auf 40 % weiter 50 %. null, wenn die Zeile das nicht hergibt
// (Altzeilen ohne Aufschluesselung, Gewinn 0).
export function lizenzSatzAusZeile(gewinnNetto, lizenzAnteil) {
  // Sheet liefert deutsch formatierte Strings ("7,5"); Number("7,5") waere NaN.
  const zahl = v => (typeof v === 'number' ? v : Number(String(v ?? '').trim().replace(',', '.')));
  const g = zahl(gewinnNetto);
  const a = zahl(lizenzAnteil);
  if (!Number.isFinite(g) || !Number.isFinite(a) || Math.abs(g) < 0.005) return null;
  return Math.round((a / g) * 1000) / 10; // eine Nachkommastelle
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
 * @param {number}  [input.stueckzahl]              Stückzahl der Zeile (WC item.quantity), Default 1.
 *                                                   vkNetto ist der Zeilenwert (item.total), also
 *                                                   gehen EK, Druck und Herstellungsnebenkosten
 *                                                   ebenfalls je Stück ein. Versandnebenkosten,
 *                                                   Porto und PayPal bleiben beim Wertanteil.
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
  portoModell, anzahlArtikelInBestellung, bestellungsAnteil, stueckzahl = 1,
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

  // B15: vkNetto ist der Wert der ganzen Zeile (item.total = Stückpreis × Menge).
  // Die Herstellung wurde frueher nur einmal abgezogen - bei 3 Stueck zahlte der
  // Partner also nur ein Shirt, die Lizenz fiel zu hoch aus. Negativ ist erlaubt
  // (Storno-Zeilen tragen -Stückzahl), nur ein fehlender Wert faellt auf 1.
  const menge = Number.isFinite(Number(stueckzahl)) && stueckzahl !== null && stueckzahl !== ''
    ? Number(stueckzahl)
    : 1;

  // WC item.total ist Netto – kein MwSt-Abzug erforderlich
  const herstellungspreis = ((ekPreis || 0) + (druckkosten || 0) + k.herstellungsnebenkosten) * menge; // (netto)

  const versandnebenkostenTotal = va === 'B' ? k.versandnebenkostenB : k.versandnebenkostenP;
  const versandnebenkosten      = versandnebenkostenTotal * anteil; // (netto)

  const portoKostenTotal  = va === 'B' ? k.portoB : k.portoP;
  const portoKostenAnteil = portoKostenTotal * anteil; // (netto)

  // PayPal berechnet die Gebühr auf den Brutto-Betrag, den der Kunde zahlt.
  const paypalKosten = (vkNetto * (1 + k.mwstProzent / 100)) * (k.paypalProzent / 100)
                     + (k.paypalPauschale * anteil); // (netto Pauschale)

  // gewinnNetto = reine Artikel-Marge ohne Porto.
  const gewinnNetto            = vkNetto - herstellungspreis - versandnebenkosten - paypalKosten; // (netto)
  const partnerAnteilVomGewinn = gewinnNetto * (lizenzProzent || 0) / 100; // (netto)

  // Porto-Saldo (Einnahme − Kosten) aufteilen. Alle Werte netto (WC shipping_total ist netto).
  //   partner-trägt   → Partner bekommt 100 % des Saldos
  //   geteilt-50-50   → Partner bekommt 50 % des Saldos
  const portoSaldoArtikel   = (portoEinnahmeAnteil || 0) - portoKostenAnteil; // (netto)
  const portoSaldoPartner   = normalisierePortoModell(portoModell) === 'partner-trägt'
    ? portoSaldoArtikel
    : portoSaldoArtikel / 2;
  const portoSaldoPlattform = portoSaldoArtikel - portoSaldoPartner;

  const partnerAnteil = partnerAnteilVomGewinn + portoSaldoPartner; // (netto)
  const eigenAnteil   = (gewinnNetto - partnerAnteilVomGewinn) + portoSaldoPlattform; // (netto)

  // Brutto folgt aus dem netto, das auch ausgewiesen wird - nicht aus dem
  // ungerundeten Zwischenwert. Sonst gilt nicht durchgaengig
  // brutto === round2(netto * (1 + MwSt)), und auf einer Abrechnung, die beide
  // Spalten nebeneinander zeigt, kommt jeder Nachrechnende auf eine andere Zahl.
  const partnerAnteilNetto  = round2(partnerAnteil);
  const partnerAnteilBrutto = round2(partnerAnteilNetto * (1 + k.mwstProzent / 100)); // (brutto)

  return {
    herstellungspreis:   round2(herstellungspreis),
    versandnebenkosten:  round2(versandnebenkosten),
    portoKostenAnteil:   round2(portoKostenAnteil),
    portoEinnahmeAnteil: round2(portoEinnahmeAnteil || 0),
    portoSaldoPartner:   round2(portoSaldoPartner),
    paypalKosten:        round2(paypalKosten),
    gewinnNetto:         round2(gewinnNetto),
    partnerAnteil:       partnerAnteilNetto,
    eigenAnteil:         round2(eigenAnteil),
    netto:               partnerAnteilNetto,
    brutto:              partnerAnteilBrutto,
  };
}

// ── Betraege einer Verkaufszeile (PA2 Teil B) ───────────────────────────────
//
// EINE Rechnung fuer den Sync (neue Zeile) und das Entsperren (erste Rechnung
// einer gesperrten Zeile): dieselben Eingaben aus der WC-Bestellung, damit eine
// spaet gerechnete Zeile genau so aussieht, als haette der Sync sie gleich
// gerechnet. toFloat hier mit Komma, wie in sync-logic.js.
const _num = v => { if (v === null || v === undefined || v === '') return 0; const n = parseFloat(String(v).replace(',', '.')); return Number.isNaN(n) ? 0 : n; };

/**
 * @param {object} o
 * @param {object} o.order  WC-Bestellung (line_items, shipping_total)
 * @param {object} o.item   Position der Bestellung
 * @param {object} o.eintrag { ekPreis, druckkosten }
 * @param {'B'|'P'} o.versandart  Versandart der Bestellung
 * @param {string} o.portoModell
 * @param {number} o.lizenzProzent
 * @param {object} o.konfiguration
 * @returns {{ vkNetto, lizenz, gewinnNetto, lizenzAnteil, portoSaldo, brutto }}
 */
export function verkaufsBetraege({ order, item, eintrag, versandart, portoModell, lizenzProzent, konfiguration }) {
  const shippingNetto = _num(order.shipping_total);
  const orderNetto    = (order.line_items ?? []).reduce((s, i) => s + _num(i.total), 0);
  const vkNetto       = _num(item.total);
  const anteil        = orderNetto > 0 ? vkNetto / orderNetto : 0;
  const calc = berechnePartnerAnteil({
    vkNetto, ekPreis: eintrag.ekPreis, druckkosten: eintrag.druckkosten, versandart,
    portoModell, bestellungsAnteil: anteil, stueckzahl: item.quantity,
    lizenzProzent, portoEinnahmeAnteil: shippingNetto * anteil, konfiguration,
  });
  return {
    vkNetto,
    lizenz:       calc.partnerAnteil,
    gewinnNetto:  calc.gewinnNetto,
    lizenzAnteil: calc.gewinnNetto * (lizenzProzent || 0) / 100,
    portoSaldo:   calc.portoSaldoPartner,
    brutto:       calc.brutto,
  };
}
