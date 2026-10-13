// ── Verpackungspauschale je Bestellung (Festpreis, VP1) ──────────────────────
//
// Je WC-Bestellung (nicht je Artikel) eine Pauschale BRUTTO, nur für versendete
// Bestellungen ab "gültig ab". Abholungen (method_id local_pickup*, z. B. Stadion)
// zählen nicht. Gemischte Bestellungen (Partner-Artikel + andere) zählen einmal,
// sobald mindestens eine Zeile des Partners in der Abrechnung steht.
//
// Der Betrag ist eine Partnerkondition und steht NUR im Business-Sheet
// (FP_Partner, Spalten VERPACKUNG_BETRAG / VERPACKUNG_AB). Leer = fehlt, nie 0
// annehmen; "nein" = bewusst keine Pauschale; 0 = bewusst 0.

export const VERPACKUNG_BETRAG = 'Verpackung_je_Bestellung';
export const VERPACKUNG_AB     = 'Verpackung_ab';
export const VERSANDMETHODE    = 'Versandmethode';   // FP_Verkäufe, additiv hinter V
export const OHNE_VERSAND      = '-';                // Bestellung ohne shipping_lines

const round2 = n => Math.round(n * 100) / 100;

function parseZahl(val) {
  const s = String(val ?? '').trim();
  if (!/^-?\d+([.,]\d+)?$/.test(s)) return null;
  return Number(s.replace(',', '.'));
}

function parseDatumDE(str) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(str ?? '').trim());
  if (!m) return null;
  const d = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
  return isNaN(d) ? null : d;
}

/**
 * Versandmethode einer Bestellung für die Spalte "Versandmethode":
 * method_id der ersten Versandzeile, ohne Versandzeile OHNE_VERSAND.
 */
export function versandmethodeAus(order) {
  const lines = Array.isArray(order?.shipping_lines) ? order.shipping_lines : [];
  const id = String(lines[0]?.method_id ?? '').trim();
  return id || OHNE_VERSAND;
}

/** 'versendet' | 'abholung' | 'ohne_versand' | 'unbekannt' (Spalte leer). */
export function versandArt(methode) {
  const m = String(methode ?? '').trim();
  if (!m) return 'unbekannt';
  if (m === OHNE_VERSAND) return 'ohne_versand';
  if (/^(local_pickup|pickup_location)/i.test(m)) return 'abholung';
  return 'versendet';
}

/**
 * Liest die Kondition aus einer FP_Partner-Zeile (Objekt Kopf -> Wert).
 * @returns {{ status: 'ok', betrag: number, ab: Date, abText: string }
 *         | { status: 'keine' }
 *         | { status: 'fehlt', grund: string }}
 */
export function verpackungsKondition(partner) {
  const roh = String(partner?.[VERPACKUNG_BETRAG] ?? '').trim();
  const abText = String(partner?.[VERPACKUNG_AB] ?? '').trim();
  if (roh.toLowerCase() === 'nein') return { status: 'keine' };
  if (!roh) return { status: 'fehlt', grund: `${VERPACKUNG_BETRAG} ist leer` };
  const betrag = parseZahl(roh);
  if (betrag === null || betrag < 0) return { status: 'fehlt', grund: `${VERPACKUNG_BETRAG} ist keine Zahl >= 0` };
  const ab = parseDatumDE(abText);
  if (!ab) return { status: 'fehlt', grund: `${VERPACKUNG_AB} fehlt oder ist kein Datum TT.MM.JJJJ` };
  return { status: 'ok', betrag, ab, abText };
}

/**
 * Berechnet die Pauschale für die Zeilen EINER Abrechnung (dieselben Zeilen,
 * die auf 'abgerechnet' gesetzt werden, inkl. Storno-Gegenbuchungen).
 *
 * Je Bestellung: +1, wenn Originalzeilen dabei sind, −1, wenn Storno-
 * Gegenbuchungen dabei sind (beides im selben Zeitraum = 0). Gezählt wird nur
 * "versendet" mit Bestelldatum (Originalzeile, sonst Zeilendatum) >= ab.
 *
 * @param {Array<Array>} zeilen   FP_Verkäufe-Zeilen
 * @param {Function}     vh       Spaltenname -> Index
 * @param {Object}       kondition Ergebnis von verpackungsKondition
 * @param {Array<Array>} [alleZeilen] alle FP_Verkäufe-Zeilen (Bestelldatum für Stornos)
 * @returns {{ status, anzahl, betrag, summe, abholung, ohneVersand, vorAb, unbekannt: string[], hinweise: string[] }}
 */
export function berechneVerpackung(zeilen, vh, kondition, alleZeilen = zeilen) {
  const leer = { anzahl: 0, betrag: null, summe: null, abholung: 0, ohneVersand: 0, vorAb: 0, unbekannt: [], hinweise: [] };
  if (!kondition || kondition.status === 'keine') return { ...leer, status: 'keine' };
  if (kondition.status !== 'ok') {
    return { ...leer, status: 'fehlt', hinweise: [`Verpackungspauschale nicht berechnet: ${kondition.grund}.`] };
  }

  const iOrd = vh('WC-Bestellnummer'), iDat = vh('Datum'), iSto = vh('Storno-Status'), iVm = vh(VERSANDMETHODE);
  const istStorno = r => String(r[iSto] ?? '') !== '';

  // Bestelldatum + Versandmethode aus den Originalzeilen (auch frühere Abrechnungen)
  const original = new Map();
  for (const r of alleZeilen) {
    if (istStorno(r)) continue;
    const o = String(r[iOrd] ?? '');
    if (!original.has(o)) original.set(o, { datum: parseDatumDE(r[iDat]), methode: iVm === -1 ? '' : String(r[iVm] ?? '') });
  }

  const bestellungen = new Map(); // oid -> { plus, minus, methoden:Set, datum }
  for (const r of zeilen) {
    const o = String(r[iOrd] ?? '');
    if (!o) continue;
    const b = bestellungen.get(o) ?? { plus: 0, minus: 0, methoden: new Set(), datum: null };
    if (istStorno(r)) b.minus = 1; else b.plus = 1;
    // Storno-Gegenbuchung ohne eigene Methode: Methode der Originalzeile
    const eigene = iVm === -1 ? '' : String(r[iVm] ?? '').trim();
    b.methoden.add(eigene || (istStorno(r) ? String(original.get(o)?.methode ?? '').trim() : ''));
    b.datum = original.get(o)?.datum ?? b.datum ?? parseDatumDE(r[iDat]);
    bestellungen.set(o, b);
  }

  let anzahl = 0, abholung = 0, ohneVersand = 0, vorAb = 0;
  const unbekannt = [];
  for (const [o, b] of bestellungen) {
    const netto = b.plus - b.minus;
    if (netto === 0) continue;
    if (!b.datum || b.datum < kondition.ab) { vorAb++; continue; }
    const arten = new Set([...b.methoden].map(versandArt));
    if (arten.has('unbekannt') || arten.size !== 1) { unbekannt.push(o); continue; }
    const art = [...arten][0];
    if (art === 'abholung') { abholung++; continue; }
    if (art === 'ohne_versand') { ohneVersand++; continue; }
    anzahl += netto;
  }

  if (unbekannt.length) {
    return {
      ...leer, status: 'fehlt', abholung, ohneVersand, vorAb, unbekannt,
      hinweise: [`Verpackungspauschale nicht berechnet: Versandmethode fehlt bei ${unbekannt.length} Bestellung(en) (${unbekannt.slice(0, 5).join(', ')}${unbekannt.length > 5 ? ', …' : ''}).`],
    };
  }
  const hinweise = [];
  if (ohneVersand) hinweise.push(`${ohneVersand} Bestellung(en) ohne Versandzeile – nicht gezählt.`);
  return {
    status: 'ok', anzahl, betrag: kondition.betrag, summe: round2(anzahl * kondition.betrag),
    ab: kondition.abText, abholung, ohneVersand, vorAb, unbekannt, hinweise,
  };
}

/** Text der eigenen Abrechnungszeile. */
export function verpackungsZeile(v) {
  if (!v || v.status !== 'ok') return '';
  const fmt = n => Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Verpackungspauschale: ${v.anzahl} Bestellungen × ${fmt(v.betrag)} € = ${fmt(v.summe)} € (brutto)`;
}
