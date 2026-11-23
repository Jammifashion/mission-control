// Druckkosten (DTF) je Auftrag (DK1), reine Logik ohne Netz. Lesen/Schreiben in lib/druckmasse.js.
// Nur Anzeige in MC (Kalkulation): Druckkosten gehen nie in Bestellseite, Portal, Lexware, Chat oder Log.
//
// Rechenregel (Inhaber 22.11., offen gehalten 23.11. antwort-DK1-1):
//   Preis je m² aus Config (Business, Reiter Config), je Tarif normal | express GETRENNT, je Tarif GENAU EIN Modell:
//     Bogen: dtf.preis_je_bogen[_express]_brutto / (dtf.breite_cm x dtf.bogen_laenge_cm)
//     Meter: dtf.preis_je_meter[_express]_brutto / (dtf.breite_cm x 100 cm)   (je laufendem Meter bei dieser Breite)
//   Druckkosten je Teil = Summe der Druckflaechen (B x H je Druckposition) x Preis je m² x (1 + dtf.verschnitt_prozent/100),
//   netto = brutto / (1 + 19 %). Fehlt ein Wert: "Preis fehlt" - nie still 0.
// Druckmasse: Reiter `Druckmasse` (SSOT), je Bezug (Motiv-Kuerzel bzw. Kurzbezeichnung) + Position + Groesse ("alle" oder
// konkret) B x H in cm. Nachschlag: genaue Groesse vor "alle". Spalten so, dass der spaetere Druckbogen sie nutzen kann.

import { parseDeZahl } from './zahl-de.js';
import { UST_STANDARD } from './auftrag-preise.js';

export const TAB_DRUCKMASSE = 'Druckmasse';
export const DRUCKMASSE_SPALTEN = ['Druckmass_ID', 'Bezug', 'Position', 'Groesse', 'Breite_cm', 'Hoehe_cm', 'Aktiv', 'Notiz', 'Angelegt', 'Stand'];
export const GROESSE_ALLE = 'alle';
export const POSITIONEN_VORSCHLAG = ['Brust', 'Rücken', 'Ärmel links', 'Ärmel rechts', 'Nacken', 'Bein', 'Vorderseite', 'Kapuze'];
export const MASS_MAX_CM = 300;          // laengster Bogen 3 m - Tippfehler-Bremse
export const TEILE_MAX = 10;             // Druckpositionen je Teil
export const LAENGE = { bezug: 60, position: 30, groesse: 20, notiz: 200 };

// Config-Schluessel (Werte nur im Sheet, nie im Code/Log/Postfach)
export const DTF_CONFIG = {
  breite: 'dtf.breite_cm',
  bogenLaenge: 'dtf.bogen_laenge_cm',
  bogen: 'dtf.preis_je_bogen_brutto',
  bogenExpress: 'dtf.preis_je_bogen_express_brutto',
  meter: 'dtf.preis_je_meter_brutto',
  meterExpress: 'dtf.preis_je_meter_express_brutto',
  verschnitt: 'dtf.verschnitt_prozent',
};
export const DTF_CONFIG_SCHLUESSEL = Object.values(DTF_CONFIG);
// Vorbelegung des Setups (keine Preise): Breite 57 cm (Inhaber 23.11.: der Bogen ist immer 57 cm breit), Verschnitt 15 %.
// Bogenlaenge nur beim Bogenpreis noetig - traegt der Inhaber ein (Abrechnung in 10-cm-Schritten bis 3 m, antwort-DK1-1).
export const DTF_CONFIG_VORGABE = { [DTF_CONFIG.breite]: '57', [DTF_CONFIG.verschnitt]: '15' };

// Druckart: leer oder "DTF" = DTF (Standard im Betrieb); Stick, Flex, Flock, Siebdruck, Plot, Sublimation, Laser/Gravur = nicht DTF.
const NICHT_DTF = /(stick|flex|flock|sieb|plott?|sublim|laser|gravur)/i;
export const istDtf = druck => /\bdtf\b/i.test(String(druck ?? '')) || !NICHT_DTF.test(String(druck ?? ''));

const t = v => String(v ?? '').trim();
export const normBezug = v => t(v).toLowerCase().replace(/\s+/g, ' ');
/** Groesse vergleichbar: Gross/Klein egal, XXL = 2XL, XXXL = 3XL. */
export function normGroesse(v) {
  const s = t(v).toLowerCase().replace(/\s+/g, '');
  const m = /^(x{2,5})l$/.exec(s);
  return m ? `${m[1].length}xl` : s;
}
const zahl = v => { const n = parseDeZahl(v); return Number.isFinite(n) ? n : null; };
const fehler = (text, code = 'druckmass') => Object.assign(new Error(text), { status: 422, code });

// ── Preise aus Config ────────────────────────────────────────────────────────

function tarif(werte, bogenKey, meterKey) {
  const breite = zahl(werte[DTF_CONFIG.breite]);
  const bogen = zahl(werte[bogenKey]), meter = zahl(werte[meterKey]);
  const fehlt = [];
  if (!(breite > 0)) fehlt.push(DTF_CONFIG.breite);
  if (bogen !== null && meter !== null) return { fehlt: [], doppelt: true, text: `Druckkosten: Bogen- und Meterpreis eingetragen (${bogenKey} / ${meterKey}) – bitte nur einen (Einstellungen)` };
  if (bogen === null && meter === null) fehlt.push(`${bogenKey} oder ${meterKey}`);
  if (bogen !== null && !(zahl(werte[DTF_CONFIG.bogenLaenge]) > 0)) fehlt.push(DTF_CONFIG.bogenLaenge);
  if ((bogen ?? meter ?? 1) <= 0) fehlt.push(bogen !== null ? bogenKey : meterKey);
  if (fehlt.length) return { fehlt, text: 'Druckkosten: Preis fehlt (Einstellungen)' };
  const flaecheQm = bogen !== null ? (breite * zahl(werte[DTF_CONFIG.bogenLaenge])) / 10000 : breite / 100;
  return { modell: bogen !== null ? 'bogen' : 'meter', qmBruttoCent: ((bogen ?? meter) * 100) / flaecheQm, fehlt: [] };
}

/**
 * Config-Zeilen (Schluessel -> Wert, beliebige weitere Schluessel erlaubt) -> Preise je m².
 * @returns {{ normal, express, verschnitt: number|null, fehlt: string[] }} normal/express: { modell, qmBruttoCent } | { fehlt, text }
 */
export function dtfPreise(werte = {}) {
  const v = zahl(werte[DTF_CONFIG.verschnitt]);
  const verschnitt = v !== null && v >= 0 && v <= 100 ? v : null;
  const normal = tarif(werte, DTF_CONFIG.bogen, DTF_CONFIG.meter);
  const express = tarif(werte, DTF_CONFIG.bogenExpress, DTF_CONFIG.meterExpress);
  return { normal, express, verschnitt, fehlt: verschnitt === null ? [DTF_CONFIG.verschnitt] : [] };
}

// ── Druckmasse ──────────────────────────────────────────────────────────────

/** Ein Mass (cm) pruefen: Zahl > 0 und <= MASS_MAX_CM, eine Nachkommastelle reicht (mm). */
export function massCm(v, feld) {
  const n = typeof v === 'number' ? v : zahl(t(v).replace(/cm$/i, ''));
  if (n === null || !(n > 0) || n > MASS_MAX_CM) throw fehler(`${feld}: bitte in cm zwischen 0 und ${MASS_MAX_CM}, z. B. 28 oder 17,5.`);
  return Math.round(n * 10) / 10;
}

/** Eine Zeile fuer Druckmasse pruefen -> { Bezug, Position, Groesse, Breite_cm, Hoehe_cm, Notiz }. */
export function druckmassEingabe(e = {}) {
  const bezug = t(e.bezug), position = t(e.position), groesse = t(e.groesse) || GROESSE_ALLE, notiz = t(e.notiz);
  if (!bezug) throw fehler('Bezug (Motiv-Kürzel oder Kurzbezeichnung) fehlt.');
  if (!position) throw fehler('Druckposition fehlt (z. B. Brust, Rücken).');
  for (const [w, n, max] of [[bezug, 'Bezug', LAENGE.bezug], [position, 'Position', LAENGE.position], [groesse, 'Größe', LAENGE.groesse], [notiz, 'Notiz', LAENGE.notiz]]) {
    if (w.length > max) throw fehler(`${n}: höchstens ${max} Zeichen.`);
  }
  return { Bezug: bezug, Position: position, Groesse: normGroesse(groesse) === GROESSE_ALLE ? GROESSE_ALLE : groesse,
    Breite_cm: massCm(e.breite, 'Breite'), Hoehe_cm: massCm(e.hoehe, 'Höhe'), Notiz: notiz };
}

export const istAktiv = z => !/^(nein|false|0|inaktiv)$/i.test(t(z.Aktiv));
/** Gleicher Schluessel (Bezug + Position + Groesse) - je Schluessel hoechstens eine aktive Zeile. */
export const massSchluessel = z => `${normBezug(z.Bezug)}|${normBezug(z.Position)}|${normGroesse(z.Groesse || GROESSE_ALLE)}`;

/**
 * Druckpositionen eines Bezugs fuer eine Groesse: je Position die Zeile der genauen Groesse, sonst "alle".
 * @returns {{ position, breite, hoehe, groesse }[]} in Zeilenreihenfolge
 */
export function masseFuer(zeilen, bezug, groesse = '') {
  const b = normBezug(bezug), g = normGroesse(groesse);
  if (!b) return [];
  const je = new Map();   // Position -> { genau, alle }
  for (const z of zeilen ?? []) {
    if (!istAktiv(z) || normBezug(z.Bezug) !== b) continue;
    const zg = normGroesse(z.Groesse || GROESSE_ALLE);
    const p = normBezug(z.Position);
    const e = je.get(p) ?? {};
    if (zg === GROESSE_ALLE) e.alle ??= z;
    else if (g && zg === g) e.genau ??= z;
    je.set(p, e);
  }
  return [...je.values()].map(e => e.genau ?? e.alle).filter(Boolean)
    .map(z => ({ position: t(z.Position), breite: zahl(z.Breite_cm), hoehe: zahl(z.Hoehe_cm), groesse: t(z.Groesse) || GROESSE_ALLE }))
    .filter(m => m.breite > 0 && m.hoehe > 0);
}

// ── Freie Eingabe je Auftragsposition (Spalte Druckmasse_Hand) ──────────────
// Text "Brust 10,5x5; Rücken 28x17,5" - Position, dann B x H in cm. Wird so gespeichert, wie handText ihn baut.

const zahlText = n => String(n).replace('.', ',');
/** [{ position, breite, hoehe }] -> "Brust 10,5x5; Rücken 28x17,5" (geprueft). */
export function handText(teile) {
  const liste = (teile ?? []).filter(x => t(x?.position) || t(x?.breite) || t(x?.hoehe));
  if (liste.length > TEILE_MAX) throw fehler(`Höchstens ${TEILE_MAX} Druckpositionen je Teil.`);
  return liste.map((x, i) => {
    const p = t(x.position);
    if (!p) throw fehler(`Druckposition ${i + 1}: Name fehlt (z. B. Brust).`);
    if (p.length > LAENGE.position || /[;]|\d+([.,]\d+)?\s*[x×]/i.test(p)) throw fehler(`Druckposition ${i + 1}: Name ungültig.`);
    return `${p} ${zahlText(massCm(x.breite, `${p}: Breite`))}x${zahlText(massCm(x.hoehe, `${p}: Höhe`))}`;
  }).join('; ');
}
/** Zelle -> [{ position, breite, hoehe }]; unlesbare Teile fallen weg (ungueltig = []). */
export function handTeile(zelle) {
  const out = [];
  for (const teil of t(zelle).split(';')) {
    const m = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)$/i.exec(t(teil));
    if (!m) continue;
    const breite = zahl(m[2]), hoehe = zahl(m[3]);
    if (breite > 0 && hoehe > 0 && breite <= MASS_MAX_CM && hoehe <= MASS_MAX_CM) out.push({ position: t(m[1]), breite, hoehe });
  }
  return out;
}

// ── Kosten ──────────────────────────────────────────────────────────────────

export const flaecheCm2 = teile => Math.round((teile ?? []).reduce((s, x) => s + x.breite * x.hoehe, 0) * 100) / 100;

/**
 * Druckkosten einer Auftragsposition.
 * @param {object} p { druck, motiv, groesse, menge, hand }  hand = Zelle Druckmasse_Hand
 * @param {object} o { masse: Druckmasse-Zeilen, preise: dtfPreise(...), express: boolean }
 * @returns {{ status: 'ok'|'kein_dtf'|'ohne_mass'|'preis_fehlt', quelle?: 'hand'|'tabelle', teile?, flaeche?, stueck?, netto?, text? }}
 *   stueck/netto in Cent (netto ganzzahlig, stueck auf 2 Stellen), immer NETTO.
 */
export function positionDruck(p, { masse = [], preise, express = false } = {}) {
  if (!istDtf(p.druck)) return { status: 'kein_dtf', text: 'Druckkosten nicht berechnet (kein DTF)' };
  const hand = handTeile(p.hand);
  const teile = hand.length ? hand : masseFuer(masse, p.motiv, p.groesse);
  const quelle = hand.length ? 'hand' : 'tabelle';
  if (!teile.length) return { status: 'ohne_mass', text: t(p.motiv) ? 'Druckmaße fehlen' : 'Motiv fehlt – Druckmaße frei eingeben' };
  const flaeche = flaecheCm2(teile);
  const tf = preise?.[express ? 'express' : 'normal'];
  if (!tf || tf.fehlt?.length || tf.doppelt || preise.verschnitt === null || preise.verschnitt === undefined) {
    return { status: 'preis_fehlt', quelle, teile, flaeche, text: tf?.doppelt ? tf.text : 'Druckkosten: Preis fehlt (Einstellungen)' };
  }
  const stueckGenau = (flaeche / 10000) * tf.qmBruttoCent * (1 + preise.verschnitt / 100) * 100 / (100 + UST_STANDARD);
  const menge = Number(p.menge) || 0;
  return { status: 'ok', quelle, teile, flaeche, stueck: Math.round(stueckGenau * 100) / 100, netto: Math.round(stueckGenau * menge) };
}

/**
 * Druckkosten eines Auftrags zu den AM-5-Summen.
 * @param {object[]} druck   je Position positionDruck(...) (gleiche Reihenfolge wie summen.positionen)
 * @param {object} summen    auftragSummen(...)
 * @returns {{ gesamt, ohneMass, preisFehlt, keinDtf, rohertragNachDruck, offen }}  Cent; rohertragNachDruck nur ueber die
 *   Positionen des Rohertrags (Preis UND EK), offen = davon ohne berechnete Druckkosten (ohne Mass / Preis fehlt).
 */
export function druckSummen(druck, summen) {
  const gesamt = druck.reduce((s, d) => s + (d.status === 'ok' ? d.netto : 0), 0);
  let abzug = 0, offen = 0;
  (summen?.positionen ?? []).forEach((w, i) => {
    if (w.netto === null || w.ek === null) return;
    const d = druck[i];
    if (d?.status === 'ok') abzug += d.netto;
    else if (d && d.status !== 'kein_dtf') offen += 1;
  });
  const zaehle = st => druck.filter(d => d.status === st).length;
  return {
    gesamt, ohneMass: zaehle('ohne_mass'), preisFehlt: zaehle('preis_fehlt'), keinDtf: zaehle('kein_dtf'), offen,
    rohertragNachDruck: summen ? summen.rohertrag - abzug : null,
    rohertragNachDruckProzent: summen?.umsatzMitEk ? Math.round(((summen.rohertrag - abzug) / summen.umsatzMitEk) * 1000) / 10 : null,
  };
}

/** Naechste Druckmass_ID (DM-NNNN): hoechste + 1, nie wiederverwendet. */
export function naechsteDruckmassId(ids) {
  const max = (ids ?? []).reduce((m, id) => { const x = /^DM-(\d{4,})$/.exec(t(id)); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return `DM-${String(max + 1).padStart(4, '0')}`;
}
