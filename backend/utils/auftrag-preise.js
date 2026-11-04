// Preise, Summen, EK und Rohertrag eines Auftrags (AM-5), reine Logik ohne Netz. Eingabe netto, gerechnet in Cent (ganzzahlig),
// gerundet erst in der Anzeige. Nur Anzeige in MC: Preise/EK gehen nie in Korb-Zeilen, EDI-Datei, Log oder Chat.
// Frontend-Spiegel: Block `Auftrag-Preise: Anfang/Ende` in index.html (Test auftrag-preise.test.js vergleicht beide).

import { groessenRang } from '../lib/groessen.js';

export const UST_SAETZE = [19, 7, 0];
export const UST_STANDARD = 19;
export const AUFPREIS_AB_STANDARD = '3XL';   // Messung AM-5: in 780 von 897 Gruppen ist 3XL die erste teurere Groesse
export const PREIS_MAX = 100000;             // Euro je Stueck bzw. Rabatt-Betrag - Tippfehler-Bremse
// "Zuständig" (AM-5): bewusst einfach, feste Auswahl; leer = niemand.
export const ZUSTAENDIG = ['Christian', 'Nicole'];

const t = v => String(v ?? '').trim();

/** Euro-Eingabe -> Zahl (2 Nachkommastellen) | null (leer). "12,50", "1.234,50", "12.5", 12.5. Sonst Fehler (Text ohne Wert). */
export function euroZahl(v, feld = 'Preis') {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0 || v > PREIS_MAX) throw preisFehler(`${feld} muss zwischen 0 und ${PREIS_MAX} € liegen.`);
    return Math.round(v * 100) / 100;
  }
  let s = t(v).replace(/\s|€/g, '');
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '');   // 1.234,50
  s = s.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw preisFehler(`${feld}: bitte als Betrag eingeben, z. B. 12,50.`);
  const n = Number(s);
  if (n > PREIS_MAX) throw preisFehler(`${feld} muss zwischen 0 und ${PREIS_MAX} € liegen.`);
  return Math.round(n * 100) / 100;
}
function preisFehler(text) { const e = new Error(text); e.status = 422; e.code = 'preis'; return e; }

export const cent = e => (e === null || e === undefined || e === '' ? null : Math.round(Number(e) * 100));
/** Cent -> "12,50 €" (Anzeige). */
export const euroText = c => (c === null || c === undefined ? '–' : `${(c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);

/** USt-Satz: leer = 19; nur 19/7/0. */
export function ustAus(v) {
  if (t(v) === '') return UST_STANDARD;
  const n = Number(t(v).replace('%', '').replace(',', '.'));
  if (!UST_SAETZE.includes(n)) throw preisFehler(`USt-Satz ${UST_SAETZE.join(', ')} %.`);
  return n;
}

/** Rabatt am Auftrag: "" -> null · "10%" / { art: '%', wert: 10 } -> Prozent · 25 / "25,00" / { art: '€', wert } -> Betrag. */
export function rabattAus(v) {
  if (v && typeof v === 'object') {
    if (t(v.wert) === '') return null;
    return v.art === '%' ? rabattAus(`${t(v.wert)}%`) : rabattAus(euroZahl(v.wert, 'Rabatt'));
  }
  if (typeof v === 'number') return v > 0 ? { art: '€', wert: euroZahl(v, 'Rabatt') } : null;
  const s = t(v);
  if (!s) return null;
  if (s.endsWith('%')) {
    const n = Number(s.slice(0, -1).trim().replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100) throw preisFehler('Rabatt in % zwischen 0 und 100.');
    return n > 0 ? { art: '%', wert: Math.round(n * 100) / 100 } : null;
  }
  const e = euroZahl(s, 'Rabatt');
  return e ? { art: '€', wert: e } : null;
}
/** Rabatt fuer das Sheet: "10%" (Text) oder Betrag (Zahl) oder "". */
export const rabattZelle = r => (!r ? '' : r.art === '%' ? `${r.wert}%` : r.wert);

/** Gilt der Aufpreis fuer diese Groesse? Gleiche Groessen-Klasse und Rang >= Rang von "ab". */
export function aufpreisGilt(groesse, ab = AUFPREIS_AB_STANDARD, rang = groessenRang) {
  const g = rang(groesse), a = rang(ab || AUFPREIS_AB_STANDARD);
  return !!(g && a && g.klasse === a.klasse && g.rang >= a.rang);
}

/**
 * Eine Position -> Cent-Werte. p: { art, menge, groesse, preis, aufpreis, aufpreisAb, ust, ekHand, ekAuto }
 * (Euro-Zahlen oder null). EK: von Hand vor automatisch (L-Shop), sonst unbekannt.
 */
export function positionWerte(p, rang = groessenRang) {
  const menge = Number(p.menge) || 0;
  const stueck = cent(p.preis);
  const auf = p.art === 'lshop' && p.aufpreis && aufpreisGilt(p.groesse, p.aufpreisAb, rang) ? cent(p.aufpreis) : 0;
  const netto = stueck === null ? null : (stueck + auf) * menge;
  const ekStueck = p.ekHand !== null && p.ekHand !== undefined && p.ekHand !== '' ? cent(p.ekHand) : (p.ekAuto ?? null) === null ? null : cent(p.ekAuto);
  const ekQuelle = p.ekHand !== null && p.ekHand !== undefined && p.ekHand !== '' ? 'hand' : ekStueck === null ? '' : 'lshop';
  const ek = ekStueck === null ? null : ekStueck * menge;
  return { menge, netto, aufpreisGilt: auf > 0, ust: p.ust ?? UST_STANDARD, ek, ekQuelle, rohertrag: netto !== null && ek !== null ? netto - ek : null };
}

/** Anteile ganzzahlig verteilen (Rest auf die groessten), Summe bleibt exakt. */
function verteile(gesamt, gewichte) {
  const summe = gewichte.reduce((s, g) => s + g, 0);
  if (!summe) return gewichte.map(() => 0);
  const roh = gewichte.map(g => (gesamt * g) / summe);
  const ganz = roh.map(Math.floor);
  let rest = gesamt - ganz.reduce((s, g) => s + g, 0);
  roh.map((r, i) => [r - ganz[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest > 0) { ganz[i] += 1; rest -= 1; } });
  return ganz;
}

/**
 * Summen eines Auftrags. positionen: Eingaben wie positionWerte; rabatt: rabattAus(...) | null.
 * - netto = Summe der Positionen mit Preis (ohnePreis zaehlt die ohne); Rabatt vor MwSt, Betrag hoechstens netto.
 * - MwSt je Satz auf (netto des Satzes - anteiliger Rabatt), je Satz gerundet; brutto = netto nach Rabatt + MwSt.
 * - Rohertrag nur ueber Positionen mit Preis UND EK (anteiliger Rabatt abgezogen); ekFehlt zaehlt die ohne EK.
 * Alles in Cent.
 */
export function auftragSummen(positionen, rabatt = null, rang = groessenRang) {
  const pos = (positionen ?? []).map(p => positionWerte(p, rang));
  const mitPreis = pos.filter(p => p.netto !== null);
  const netto = mitPreis.reduce((s, p) => s + p.netto, 0);
  const rabattCent = !rabatt || !netto ? 0 : Math.min(netto, rabatt.art === '%' ? Math.round((netto * rabatt.wert) / 100) : cent(rabatt.wert));
  const anteil = verteile(rabattCent, mitPreis.map(p => p.netto));
  mitPreis.forEach((p, i) => { p.nachRabatt = p.netto - anteil[i]; });
  const saetze = [...new Set(mitPreis.map(p => p.ust))].sort((a, b) => b - a);
  const mwst = saetze.map(satz => {
    const basis = mitPreis.filter(p => p.ust === satz).reduce((s, p) => s + p.nachRabatt, 0);
    return { satz, basis, betrag: Math.round((basis * satz) / 100) };
  });
  const nettoNach = netto - rabattCent;
  const mitEk = mitPreis.filter(p => p.ek !== null);
  const umsatzMitEk = mitEk.reduce((s, p) => s + p.nachRabatt, 0);
  const ek = mitEk.reduce((s, p) => s + p.ek, 0);
  const rohertrag = umsatzMitEk - ek;
  return {
    positionen: pos.map(({ nachRabatt, ...p }) => p), netto, ohnePreis: pos.length - mitPreis.length, rabatt: rabattCent, nettoNach,
    mwst, brutto: nettoNach + mwst.reduce((s, m) => s + m.betrag, 0),
    ek, ekFehlt: pos.filter(p => p.netto !== null && p.ek === null).length, umsatzMitEk, rohertrag,
    rohertragProzent: umsatzMitEk ? Math.round((rohertrag / umsatzMitEk) * 1000) / 10 : null,
  };
}

/** Sheet-Position (+ L-Shop-Groesse/EK) -> Eingabe fuer positionWerte. Ungueltige Zellen zaehlen als leer. */
export function positionAusZeile(p, { groesse = '', ekAuto = null } = {}) {
  const z = v => { try { return euroZahl(v); } catch { return null; } };
  let ust = UST_STANDARD;
  try { ust = ustAus(p.USt_Satz); } catch { /* ungueltig -> Standard */ }
  return {
    art: p.Art, menge: Number(p.Menge) || 0, groesse, preis: z(p.Preis_Netto), aufpreis: z(p.Aufpreis_Netto),
    aufpreisAb: t(p.Aufpreis_Ab) || AUFPREIS_AB_STANDARD, ust, ekHand: z(p.EK_Hand), ekAuto: ekAuto === null || ekAuto === '' ? null : z(ekAuto),
  };
}

/** Angebotsstand: weicht die aktuelle Summe (Cent) vom festgehaltenen ab? Ohne Stand -> null. */
export function angebotAbweichung(auftrag, summen) {
  if (t(auftrag.Angebot_Stand) === '') return null;
  const alt = { netto: cent(auftrag.Angebot_Netto) ?? 0, brutto: cent(auftrag.Angebot_Brutto) ?? 0 };
  return alt.netto !== summen.nettoNach || alt.brutto !== summen.brutto ? { alt, neu: { netto: summen.nettoNach, brutto: summen.brutto } } : null;
}
