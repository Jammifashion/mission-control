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
//
// DK2 (Inhaber 24.11.): je Druckmass ist EINE Seite fuehrend (Breite | Hoehe, leer = Breite) - danach skaliert der Drucker; die
// Kalkulation braucht trotzdem beide (fehlt die andere -> Grund statt Betrag). Optional `Modell` (CatalogNr): Zeile gilt nur fuer
// dieses Modell und geht dann vor Zeilen ohne Modell. Freie Masse je AUFTRAGSPOSITION (= Groessenzeile, antwort-DK2-1) in
// Druckmasse_Hand: "Brust 11x12,5; Rücken 28x31 H" (B|H am Ende = fuehrende Seite, ohne = Breite, "?" = fehlt). Position nur aus
// POSITIONEN; alte Freitext-Zeilen ("Ruecken L boardgame club 29x32") werden nie umgedeutet -> "bitte zuordnen".

import { parseDeZahl } from './zahl-de.js';
import { UST_STANDARD } from './auftrag-preise.js';
import { berlinDatum } from './berlin-tag.js';

export const TAB_DRUCKMASSE = 'Druckmasse';
export const DRUCKMASSE_SPALTEN = ['Druckmass_ID', 'Bezug', 'Position', 'Groesse', 'Breite_cm', 'Hoehe_cm', 'Aktiv', 'Notiz', 'Angelegt', 'Stand'];
export const DRUCKMASSE_OPTIONAL = ['Fuehrend', 'Modell'];   // DK2, hinten (Setup); leer = Breite bzw. alle Modelle
export const GROESSE_ALLE = 'alle';
// DK2: feste Auswahl (kein Freitext im Auftrag). Reihenfolge = Anzeige.
export const POSITIONEN = ['Brust', 'Brust links', 'Brust rechts', 'Rücken', 'Nacken', 'Ärmel links', 'Ärmel rechts', 'Vorderseite', 'Kapuze', 'Bein', 'Bein links', 'Bein rechts'];
export const POSITIONEN_VORSCHLAG = POSITIONEN;   // alter Name (DK1)
export const FUEHREND = { BREITE: 'Breite', HOEHE: 'Hoehe' };
export const MASS_MAX_CM = 300;          // laengster Bogen 3 m - Tippfehler-Bremse
export const TEILE_MAX = 10;             // Druckpositionen je Teil
export const LAENGE = { bezug: 60, position: 30, groesse: 20, notiz: 200, modell: 20 };

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
// DT1: Start des DTF-Korbs (legt scripts/setup-dtf-korb.js an, nicht das Druckmaß-Setup). AU-UX1: auch Anzeige-Regel der Maß-Warnung.
export const DTF_START_SCHLUESSEL = 'dtf.start_datum';
// Vorbelegung des Setups (keine Preise): Breite 57 cm (Inhaber 23.11.: der Bogen ist immer 57 cm breit), Verschnitt 15 %.
// Bogenlaenge nur beim Bogenpreis noetig - traegt der Inhaber ein (Abrechnung in 10-cm-Schritten bis 3 m, antwort-DK1-1).
export const DTF_CONFIG_VORGABE = { [DTF_CONFIG.breite]: '57', [DTF_CONFIG.verschnitt]: '15' };

// Druckart: leer oder "DTF" = DTF (Standard im Betrieb); Stick, Flex, Flock, Siebdruck, Plot, Sublimation, Laser/Gravur = nicht DTF.
const NICHT_DTF = /(stick|flex|flock|sieb|plott?|sublim|laser|gravur|trikot)/i;   // KS8: "Trikot (Hersteller)" = Abrechnungsposition, kein DTF
export const istDtf = druck => /\bdtf\b/i.test(String(druck ?? '')) || !NICHT_DTF.test(String(druck ?? ''));

const t = v => String(v ?? '').trim();

/** Zahl/Datum aus Config: Startdatum als JJJJ-MM-TT (Sheets-Seriennummer oder Text), sonst ''. */
export function startDatumAus(w) {
  if (typeof w === 'number' && w > 30000) return berlinDatum(new Date(Math.round((w - 25569) * 864e5)));
  const s = t(w);
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (de) return `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
export const normBezug = v => t(v).toLowerCase().replace(/\s+/g, ' ');
/** Groesse vergleichbar: Gross/Klein egal, XXL = 2XL, XXXL = 3XL. */
export function normGroesse(v) {
  const s = t(v).toLowerCase().replace(/\s+/g, '');
  const m = /^(x{2,5})l$/.exec(s);
  return m ? `${m[1].length}xl` : s;
}
const zahl = v => { const n = parseDeZahl(v); return Number.isFinite(n) ? n : null; };
const fehler = (text, code = 'druckmass') => Object.assign(new Error(text), { status: 422, code });
/** "Hoehe"/"Höhe"/"H" -> Hoehe, alles andere (auch leer) -> Breite. */
export const fuehrendAus = v => (/^(h|hoehe|höhe)$/i.test(t(v)) ? FUEHREND.HOEHE : FUEHREND.BREITE);
const umlaut = v => normBezug(v).replace(/ae/g, 'ä').replace(/oe/g, 'ö').replace(/ue/g, 'ü');
/** Position aus der festen Liste (Gross/Klein, ae = ä egal) oder null. */
export function positionAusListe(v) {
  const n = umlaut(v);
  return n ? POSITIONEN.find(x => umlaut(x) === n) ?? null : null;
}

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
const leer = v => v === null || v === undefined || t(v) === '' || t(v) === '?';
const seiteName = f => (f === FUEHREND.HOEHE ? 'Höhe' : 'Breite');

/**
 * DK2: B und H mit fuehrender Seite pruefen. Die fuehrende Seite ist Pflicht, die andere darf fehlen (null) - dann rechnet die
 * Kalkulation nicht und nennt den Grund.
 * @returns {{ breite: number|null, hoehe: number|null, fuehrend: 'Breite'|'Hoehe' }}
 */
export function seitenEingabe(e = {}, name = '') {
  const fuehrend = fuehrendAus(e.fuehrend);
  const vor = name ? `${name}: ` : '';
  if (leer(fuehrend === FUEHREND.HOEHE ? e.hoehe : e.breite)) throw fehler(`${vor}${seiteName(fuehrend)} fehlt (führende Seite).`);
  return {
    breite: leer(e.breite) ? null : massCm(e.breite, `${vor}Breite`),
    hoehe: leer(e.hoehe) ? null : massCm(e.hoehe, `${vor}Höhe`),
    fuehrend,
  };
}

/**
 * Eine Zeile fuer Druckmasse pruefen -> { Bezug, Position, Groesse, Breite_cm, Hoehe_cm, Fuehrend, Modell, Notiz }.
 * DK2: Position aus der Liste; `positionAlt` = schon gespeicherte Position dieser Zeile (bleibt erlaubt, Pflege-Ansicht).
 */
export function druckmassEingabe(e = {}) {
  const bezug = t(e.bezug), groesse = t(e.groesse) || GROESSE_ALLE, notiz = t(e.notiz), modell = t(e.modell);
  const position = positionAusListe(e.position) ?? (t(e.positionAlt) && normBezug(e.positionAlt) === normBezug(e.position) ? t(e.position) : '');
  if (!bezug) throw fehler('Bezug (Motiv-Kürzel oder Kurzbezeichnung) fehlt.');
  if (!position) throw fehler(t(e.position) ? `Druckposition „${t(e.position)}“ gibt es nicht – bitte aus der Liste wählen.` : 'Druckposition fehlt (z. B. Brust, Rücken).');
  for (const [w, n, max] of [[bezug, 'Bezug', LAENGE.bezug], [position, 'Position', LAENGE.position], [groesse, 'Größe', LAENGE.groesse], [notiz, 'Notiz', LAENGE.notiz], [modell, 'Modell', LAENGE.modell]]) {
    if (w.length > max) throw fehler(`${n}: höchstens ${max} Zeichen.`);
  }
  const sx = seitenEingabe(e);
  return { Bezug: bezug, Position: position, Groesse: normGroesse(groesse) === GROESSE_ALLE ? GROESSE_ALLE : groesse,
    Breite_cm: sx.breite ?? '', Hoehe_cm: sx.hoehe ?? '', Fuehrend: sx.fuehrend, Modell: modell, Notiz: notiz };
}

export const istAktiv = z => !/^(nein|false|0|inaktiv)$/i.test(t(z.Aktiv));
/** Gleicher Schluessel (Bezug + Position + Groesse + Modell) - je Schluessel hoechstens eine aktive Zeile. */
export const massSchluessel = z => `${normBezug(z.Bezug)}|${normBezug(z.Position)}|${normGroesse(z.Groesse || GROESSE_ALLE)}|${normBezug(z.Modell)}`;

const massZahl = v => { const n = zahl(v); return n > 0 && n <= MASS_MAX_CM ? n : null; };
/**
 * Druckpositionen eines Bezugs fuer eine Groesse (und ein Modell): je Position die passendste Zeile - Modell genau vor ohne
 * Modell, dann genaue Groesse vor "alle". Zeilen eines anderen Modells zaehlen nie.
 * @returns {{ id, position, breite, hoehe, fuehrend, groesse, modell }[]} in Zeilenreihenfolge; breite/hoehe null = fehlt
 */
export function masseFuer(zeilen, bezug, groesse = '', modell = '') {
  const b = normBezug(bezug), g = normGroesse(groesse), m = normBezug(modell);
  if (!b) return [];
  const je = new Map();   // Position -> [rang, zeile]
  for (const z of zeilen ?? []) {
    if (!istAktiv(z) || normBezug(z.Bezug) !== b) continue;
    const zm = normBezug(z.Modell);
    if (zm && zm !== m) continue;
    const zg = normGroesse(z.Groesse || GROESSE_ALLE);
    if (zg !== GROESSE_ALLE && !(g && zg === g)) continue;
    const rang = (zm ? 2 : 0) + (zg === GROESSE_ALLE ? 0 : 1);
    const p = normBezug(z.Position);
    if (!je.has(p) || je.get(p)[0] < rang) je.set(p, [rang, z]);
  }
  return [...je.values()].map(([, z]) => ({
    id: t(z.Druckmass_ID), position: t(z.Position), breite: massZahl(z.Breite_cm), hoehe: massZahl(z.Hoehe_cm),
    fuehrend: fuehrendAus(z.Fuehrend), groesse: t(z.Groesse) || GROESSE_ALLE, modell: t(z.Modell),
  })).filter(x => x.breite || x.hoehe);
}

/**
 * Maß-Sets zur Auswahl im Auftrag (antwort-DK2-1): aktive Zeilen gruppiert nach Bezug + Groesse + Modell.
 * @returns {{ bezug, groesse, modell, teile: { position, breite, hoehe, fuehrend }[] }[]} sortiert nach Bezug, Groesse
 */
export function massSets(zeilen) {
  const je = new Map();
  for (const z of zeilen ?? []) {
    if (!istAktiv(z) || !t(z.Bezug)) continue;
    const k = `${normBezug(z.Bezug)}|${normGroesse(z.Groesse || GROESSE_ALLE)}|${normBezug(z.Modell)}`;
    const s = je.get(k) ?? { bezug: t(z.Bezug), groesse: t(z.Groesse) || GROESSE_ALLE, modell: t(z.Modell), teile: [] };
    s.teile.push({ position: t(z.Position), breite: massZahl(z.Breite_cm), hoehe: massZahl(z.Hoehe_cm), fuehrend: fuehrendAus(z.Fuehrend) });
    je.set(k, s);
  }
  return [...je.values()].sort((a, b) => a.bezug.localeCompare(b.bezug, 'de') || a.groesse.localeCompare(b.groesse, 'de', { numeric: true }));
}

// ── Freie Eingabe je Auftragsposition (Spalte Druckmasse_Hand) ──────────────
// DK2: "Brust 11x12,5; Rücken 28x31 H" - Position (aus POSITIONEN), B x H in cm ("?" = fehlt), optional B|H = fuehrende Seite
// (ohne = Breite, so lesen sich auch DK1-Zellen). Gespeichert wird so, wie handText ihn baut - je Auftragsposition (Groesse).

const zahlText = n => (n === null ? '?' : String(n).replace('.', ','));
/** [{ position, breite, hoehe, fuehrend }] -> "Brust 11x12,5; Rücken 28x31 H" (geprueft; Position nur aus der Liste). */
export function handText(teile) {
  const liste = (teile ?? []).filter(x => t(x?.position) || !leer(x?.breite) || !leer(x?.hoehe));
  if (liste.length > TEILE_MAX) throw fehler(`Höchstens ${TEILE_MAX} Druckpositionen je Teil.`);
  const gesehen = new Set();
  return liste.map((x, i) => {
    const p = positionAusListe(x.position);
    if (!p) throw fehler(t(x.position) ? `Druckposition ${i + 1}: „${t(x.position)}“ gibt es nicht – bitte aus der Liste wählen.` : `Druckposition ${i + 1}: bitte wählen (z. B. Brust).`);
    if (gesehen.has(p)) throw fehler(`Druckposition ${p} steht doppelt.`);
    gesehen.add(p);
    const sx = seitenEingabe(x, p);
    return `${p} ${zahlText(sx.breite)}x${zahlText(sx.hoehe)}${sx.fuehrend === FUEHREND.HOEHE ? ' H' : ''}`;
  }).join('; ');
}
const HAND_RE = /^(.+?)\s+(\d+(?:[.,]\d+)?|\?)\s*[x×]\s*(\d+(?:[.,]\d+)?|\?)(?:\s+([BH]))?$/i;
/**
 * Zelle -> [{ position, breite, hoehe, fuehrend, zuordnen }]; zuordnen = Position nicht aus der Liste (alter Freitext, DK1) -
 * wird nie umgedeutet. Unlesbare Teile fallen weg.
 */
export function handTeile(zelle) {
  const out = [];
  for (const teil of t(zelle).split(';')) {
    const m = HAND_RE.exec(t(teil));
    if (!m) continue;
    const breite = m[2] === '?' ? null : massZahl(m[2]), hoehe = m[3] === '?' ? null : massZahl(m[3]);
    if (!breite && !hoehe) continue;
    const liste = positionAusListe(m[1]);
    out.push({ position: liste ?? t(m[1]), breite, hoehe, fuehrend: fuehrendAus(m[4]), zuordnen: !liste });
  }
  return out;
}
/** Zelle aus einer Vorlage ("Wie letztes Mal") neu pruefen: nur, wenn jeder Teil zugeordnet ist; sonst leer. */
export function handTextAusZelle(zelle) {
  const teile = handTeile(zelle);
  if (!teile.length || teile.some(x => x.zuordnen)) return '';
  return handText(teile);
}

// ── Kosten ──────────────────────────────────────────────────────────────────

export const flaecheCm2 = teile => Math.round((teile ?? []).reduce((s, x) => s + (x.breite ?? 0) * (x.hoehe ?? 0), 0) * 100) / 100;

/**
 * Druckkosten einer Auftragsposition (= einer Groessenzeile). Kann MC nicht rechnen, steht der Grund in `text` (ein Satz).
 * @param {object} p { druck, motiv, groesse, modell, menge, hand }  hand = Zelle Druckmasse_Hand DIESER Position
 * @param {object} o { masse: Druckmasse-Zeilen, preise: dtfPreise(...), express: boolean }
 * @returns {{ status: 'ok'|'kein_dtf'|'ohne_mass'|'zuordnen'|'seite_fehlt'|'preis_fehlt', quelle?: 'hand'|'tabelle', teile?,
 *   flaeche?, stueck?, netto?, text? }}  stueck/netto in Cent (netto ganzzahlig, stueck auf 2 Stellen), immer NETTO.
 */
export function positionDruck(p, { masse = [], preise, express = false } = {}) {
  if (!istDtf(p.druck)) return { status: 'kein_dtf', text: 'Druckart ist nicht DTF – keine Druckkosten' };
  const hand = handTeile(p.hand);
  const teile = hand.length ? hand : masseFuer(masse, p.motiv, p.groesse, p.modell);
  const quelle = hand.length ? 'hand' : 'tabelle';
  const gr = t(p.groesse);
  if (!teile.length) {
    return { status: 'ohne_mass', text: t(p.motiv) ? `Maß fehlt${gr ? ` für Größe ${gr}` : ''} – „Maße …“ wählen oder eingeben` : `Maß fehlt${gr ? ` für Größe ${gr}` : ''} – Motiv leer, „Maße …“ eingeben` };
  }
  if (teile.some(x => x.zuordnen)) return { status: 'zuordnen', quelle, teile, text: 'Maße bitte zuordnen (alter Freitext) – „Maße …“ öffnen' };
  const halb = teile.find(x => !x.breite || !x.hoehe);
  if (halb) {
    const fehlt = halb.breite ? FUEHREND.HOEHE : FUEHREND.BREITE;
    return { status: 'seite_fehlt', quelle, teile, text: `${seiteName(fehlt)} fehlt für ${halb.position}${gr ? `, Größe ${gr}` : ''} (führende Seite ${seiteName(halb.fuehrend)})` };
  }
  const flaeche = flaecheCm2(teile);
  const tf = preise?.[express ? 'express' : 'normal'];
  if (!tf || tf.fehlt?.length || tf.doppelt || preise.verschnitt === null || preise.verschnitt === undefined) {
    return { status: 'preis_fehlt', quelle, teile, flaeche, text: tf?.doppelt ? tf.text : `Preis fehlt (Einstellungen${express ? ', Express' : ''})` };
  }
  const stueckGenau = (flaeche / 10000) * tf.qmBruttoCent * (1 + preise.verschnitt / 100) * 100 / (100 + UST_STANDARD);
  const menge = Number(p.menge) || 0;
  return { status: 'ok', quelle, teile, flaeche, stueck: Math.round(stueckGenau * 100) / 100, netto: Math.round(stueckGenau * menge) };
}

/**
 * Druckkosten eines Auftrags zu den AM-5-Summen.
 * @param {object[]} druck   je Position positionDruck(...) (gleiche Reihenfolge wie summen.positionen)
 * @param {object} summen    auftragSummen(...)
 * @returns {{ gesamt, ohneMass, preisFehlt, keinDtf, zuordnen, seiteFehlt, rohertragNachDruck, offen }}  Cent; rohertragNachDruck nur
 *   ueber die Positionen des Rohertrags (Preis UND EK), offen = davon ohne berechnete Druckkosten (alles ausser ok/kein DTF).
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
    zuordnen: zaehle('zuordnen'), seiteFehlt: zaehle('seite_fehlt'),   // DK2
    rohertragNachDruck: summen ? summen.rohertrag - abzug : null,
    rohertragNachDruckProzent: summen?.umsatzMitEk ? Math.round(((summen.rohertrag - abzug) / summen.umsatzMitEk) * 1000) / 10 : null,
  };
}

/** Naechste Druckmass_ID (DM-NNNN): hoechste + 1, nie wiederverwendet. */
export function naechsteDruckmassId(ids) {
  const max = (ids ?? []).reduce((m, id) => { const x = /^DM-(\d{4,})$/.exec(t(id)); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return `DM-${String(max + 1).padStart(4, '0')}`;
}

/**
 * antwort-DK2-1 Punkt 5: Vorschlag fuer alte Freitext-Zellen - je Teil Position und Groesse aus dem Text raten (nur Anzeige im
 * Bericht/Dialog, nie geschrieben). "Ruecken L boardgame club 29x32" -> { position: 'Rücken', groesse: 'L', breite, hoehe }.
 */
export function zuordnenVorschlag(zelle) {
  return handTeile(zelle).map(x => {
    const w = t(x.position).split(/\s+/);
    let position = null, groesse = '';
    for (let n = Math.min(2, w.length); n >= 1 && !position; n -= 1) position = positionAusListe(w.slice(0, n).join(' '));
    const g = w.find(v => /^(xs|s|m|l|x{0,5}l|\d?xl)$/i.test(v));
    if (g) groesse = g.toUpperCase();
    return { text: x.position, position, groesse, breite: x.breite, hoehe: x.hoehe };
  });
}
