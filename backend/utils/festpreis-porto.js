// ── Porto je Bestellung als eigene Positionen (Festpreis, PO1) ───────────────
//
// Inhaber 18.11.2026: fuer Bestellungen ab PORTO_AB (Bestelldatum) stecken Porto-Einnahme, Porto-Kosten und
// Versandnebenkosten NICHT mehr anteilig in den FP_Verkaeufe-Zeilen (Spalten I/J/K = 0), sondern stehen je
// Abrechnung als zwei eigene Positionen: "Porto-Einnahmen (n Bestellungen)" und "Porto-Kosten (n Bestellungen)".
// Regeln:
//  - Je Bestellung EINMAL der hoehere Satz: mind. ein Partner-Artikel mit Versandart P -> Paket-Satz, sonst
//    Grossbrief-Satz (Porto + Versandnebenkosten). Der Partner traegt das volle Porto auch bei gemischten
//    Bestellungen mit fremden Artikeln und bekommt dafuer die volle Porto-Einnahme der Bestellung.
//  - Abholung (local_pickup*/pickup_location) und Bestellungen ohne Versandzeile: keine Porto-Kosten (Regel
//    versandArt aus VP1); die Porto-Einnahme (meist 0) zaehlt trotzdem.
//  - Eine Bestellung zaehlt einmal - in der ersten Abrechnung, in der eine ihrer Partnerzeilen steht. Ist schon eine
//    Zeile der Bestellung abgerechnet, zaehlt sie nicht noch einmal. Storno-Gegenbuchung = Gegenposition (wie VP1).
//  - Basis NETTO wie bisher (shipping_total netto, Saetze aus Kalkulation_Fixkosten netto); der Saldo rechnet die
//    Positionen zur Netto-Auszahlung, brutto wie bisher daraus. Saetze gelten zum BESTELLDATUM (gueltig ab/bis).
//  - PayPal bleibt anteilig in der Zeile (Spalte L) - unveraendert.
//  - Zwei FP-Partner in einer Bestellung (gemessen 18.11.: 0 Faelle, Vorschlag Otto): das Porto traegt genau EIN Partner -
//    der mit einem Paket-Artikel, sonst bzw. bei Gleichstand die kleinere Partner-ID. Nie doppelt.
// Daten je Zeile (additiv hinter X "Sperre", nur ueber den Namen): PORTO_BESTELLUNG = volle Porto-Einnahme der
// Bestellung (netto, auf jeder Zeile der Bestellung gleich), PORTO_VERSANDART = B|P des Partner-Artikels.
// Zeilen ab PORTO_AB OHNE Porto_Bestellung sind noch im alten Modell (Porto anteilig in I/J/K) und zaehlen hier
// nicht - so wird nie doppelt gerechnet.

import { versandArt, VERSANDMETHODE } from './festpreis-verpackung.js';
import { parseDeZahl } from './zahl-de.js';
import { MARKE_ERSTATTUNG, MARKE_VERSAND } from './teilerstattung.js';   // NB2

export const PORTO_AB = '2026-07-01';                 // Bestelldatum (Inhaber 18.11.)
export const PORTO_BESTELLUNG = 'Porto_Bestellung';   // FP_Verkaeufe, additiv
export const PORTO_VERSANDART = 'Porto_Versandart';   // FP_Verkaeufe, additiv
export const PORTO_SPALTEN = [PORTO_BESTELLUNG, PORTO_VERSANDART];

const round2 = n => Math.round(n * 100) / 100;
const t = v => String(v ?? '').trim();
const zahl = v => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = parseDeZahl(String(v));
  return Number.isNaN(n) ? null : n;
};

/** TT.MM.JJJJ -> JJJJ-MM-TT (sonst ''). */
export function isoAusDE(str) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t(str));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

/** Gilt die neue Regel fuer eine Bestellung mit diesem Bestelldatum (TT.MM.JJJJ)? */
export const portoNeu = datumDE => isoAusDE(datumDE) >= PORTO_AB && isoAusDE(datumDE) !== '';

/**
 * Porto-Positionen fuer die Zeilen EINER Abrechnung (bzw. Vorschau/Saldo - dieselben Zeilen wie dort).
 * @param {Array<Array>} zeilen      FP_Verkaeufe-Zeilen dieser Abrechnung (inkl. Storno-Gegenbuchungen)
 * @param {Function}     vh          Spaltenname -> Index
 * @param {Function}     satzAm      (datumISO) -> { portoB, portoP, versandnebenkostenB, versandnebenkostenP } (netto)
 * @param {Array<Array>} alleZeilen  alle FP_Verkaeufe-Zeilen (alle Partner: Originaldaten, schon abgerechnet?, Traeger)
 * @param {object}       [o]         { partnerId } - fuer wen gerechnet wird (ohne: Partner der Zeilen)
 * @returns {{ status, einnahmen: {anzahl, summe}, kosten: {anzahl, summe, paket, grossbrief}, saldo, abholung, ohneVersand,
 *             unbekannt: string[], hinweise: string[] }}  alle Betraege netto
 */
export function berechnePorto(zeilen, vh, satzAm, alleZeilen = zeilen, { partnerId = null } = {}) {
  const iOrd = vh('WC-Bestellnummer'), iDat = vh('Datum'), iSto = vh('Storno-Status'), iSt = vh('Status Abrechnung');
  const iVm = vh(VERSANDMETHODE), iPb = vh(PORTO_BESTELLUNG), iVa = vh(PORTO_VERSANDART), iPid = vh('Partner-ID');
  const fuer = partnerId ?? t(zeilen[0]?.[iPid]);
  const leer = { einnahmen: { anzahl: 0, summe: 0 }, kosten: { anzahl: 0, summe: 0, paket: 0, grossbrief: 0 }, saldo: 0,
    abholung: 0, ohneVersand: 0, unbekannt: [], hinweise: [] };
  if (iPb === -1 || iVa === -1) return { ...leer, status: 'keine' };   // Spalten noch nicht angelegt = altes Modell
  // NB2: Teilerstattungs-Zeilen sind KEIN Storno der Bestellung. "Erstattung #…" (Position) beruehrt das Porto nicht;
  // "Versanderstattung #…" traegt in Porto_Bestellung den erstatteten Versand (negativ, netto) und mindert die
  // Porto-Einnahmen der Bestellung (Kosten bleiben - verschickt wurde trotzdem).
  const istTeil = r => t(r[iSto]).startsWith(MARKE_ERSTATTUNG) || t(r[iSto]).startsWith(MARKE_VERSAND);
  const istVersandErst = r => t(r[iSto]).startsWith(MARKE_VERSAND);
  const istStorno = r => t(r[iSto]) !== '' && !istTeil(r);
  // Erstatteter Versand je Bestellung ueber ALLE Zeilen (fuer das Ganz-Storno: es nimmt nur zurueck, was noch da ist)
  const versandErstattet = new Map();
  for (const r of alleZeilen) {
    if (!istVersandErst(r) || t(r[iPid]) !== fuer) continue;
    const o = t(r[iOrd]);
    versandErstattet.set(o, (versandErstattet.get(o) ?? 0) + (zahl(r[iPb]) ?? 0));
  }

  // Originaldaten je Bestellung (auch aus frueheren Abrechnungen): Datum, Porto, Versandmethode, Versandarten, abgerechnet?
  const original = new Map();
  for (const r of alleZeilen) {
    if (istStorno(r) || istTeil(r)) continue;
    const o = t(r[iOrd]);
    if (!o) continue;
    const b = original.get(o) ?? { datum: isoAusDE(r[iDat]), porto: null, methode: '', partner: new Map(), abgerechnet: false, neu: false };
    const pid = t(r[iPid]);
    const p = b.partner.get(pid) ?? { arten: new Set() };
    if (t(r[iPb]) !== '') { b.neu = true; b.porto = b.porto ?? zahl(r[iPb]); }
    if (!b.methode && iVm !== -1) b.methode = t(r[iVm]);
    if (t(r[iVa])) p.arten.add(t(r[iVa]).toUpperCase() === 'P' ? 'P' : 'B');
    if (pid === fuer && t(r[iSt]).toLowerCase() === 'abgerechnet') b.abgerechnet = true;
    b.partner.set(pid, p);
    original.set(o, b);
  }

  // Bestellungen in DIESEN Zeilen: plus (Originalzeile) / minus (Storno-Gegenbuchung)
  const hier = new Map();
  for (const r of zeilen) {
    const o = t(r[iOrd]);
    if (!o) continue;
    const h = hier.get(o) ?? { plus: 0, minus: 0, erste: true, versand: 0 };
    if (istVersandErst(r)) { if (t(r[iPid]) === fuer) h.versand += zahl(r[iPb]) ?? 0; }
    else if (istTeil(r)) { /* Position erstattet: Porto bleibt */ }
    else if (istStorno(r)) h.minus = 1; else h.plus = 1;
    hier.set(o, h);
  }

  const erg = { ...leer, einnahmen: { anzahl: 0, summe: 0 }, kosten: { anzahl: 0, summe: 0, paket: 0, grossbrief: 0 }, unbekannt: [], fixkostenFehlen: [], hinweise: [] };
  for (const [o, h] of hier) {
    const b = original.get(o);
    if (!b || !b.neu || b.datum < PORTO_AB) continue;
    // Traeger bei mehreren FP-Partnern: Paket vor Grossbrief, dann kleinere Partner-ID
    const traeger = [...b.partner.entries()].sort(([a, x], [c, y]) => (y.arten.has('P') - x.arten.has('P')) || a.localeCompare(c))[0]?.[0];
    if (traeger !== fuer) { erg.anderePartner = (erg.anderePartner ?? 0) + 1; continue; }
    // "erste Abrechnung": Originalzeilen hier zaehlen nur, wenn noch keine Zeile der Bestellung abgerechnet ist
    const plus = h.plus && !b.abgerechnet ? 1 : 0;
    const vorzeichen = plus - h.minus;
    // Versanderstattung in DIESEN Zeilen: mindert die Einnahme - ausser Plus und Storno heben sich hier ohnehin auf.
    const versandHier = plus && h.minus ? 0 : h.versand;
    if (vorzeichen === 0 && !versandHier) continue;
    const art = versandArt(b.methode);
    // ohne Versandmethode zaehlen Einnahme UND Kosten nicht (Hinweis "fehlt"), nie nur die Einnahme.
    if (art === 'unbekannt') { erg.unbekannt.push(o); continue; }
    // Fehlt zum Bestelldatum ein Porto-Satz in Kalkulation_Fixkosten: wie fehlende Versandart (nichts zaehlt, Hinweis).
    if (art !== 'abholung' && art !== 'ohne_versand' && satzAm(b.datum).fehlt?.length) { erg.fixkostenFehlen.push(o); continue; }
    // Ganz-Storno nimmt nur die Einnahme zurueck, die nach Versanderstattungen noch da ist (Summe ueber alles = 0).
    const einnahme = vorzeichen < 0 ? (b.porto ?? 0) + (versandErstattet.get(o) ?? 0) : (b.porto ?? 0);
    erg.einnahmen.summe += vorzeichen * einnahme + versandHier;
    if (versandHier) erg.versandErstattet = round2((erg.versandErstattet ?? 0) + versandHier);
    if (vorzeichen === 0) continue;   // nur Versanderstattung: keine Bestellung mehr oder weniger, keine Kosten
    erg.einnahmen.anzahl += vorzeichen;
    if (art === 'abholung') { erg.abholung++; continue; }
    if (art === 'ohne_versand') { erg.ohneVersand++; continue; }
    const s = satzAm(b.datum);
    const paket = b.partner.get(fuer)?.arten.has('P') ?? false;
    const kosten = paket ? s.portoP + s.versandnebenkostenP : s.portoB + s.versandnebenkostenB;
    erg.kosten.anzahl += vorzeichen;
    erg.kosten.summe += vorzeichen * kosten;
    if (paket) erg.kosten.paket += vorzeichen; else erg.kosten.grossbrief += vorzeichen;
  }
  erg.einnahmen.summe = round2(erg.einnahmen.summe);
  erg.kosten.summe = round2(erg.kosten.summe);
  erg.saldo = round2(erg.einnahmen.summe - erg.kosten.summe);
  if (erg.unbekannt.length) {
    erg.hinweise.push(`Porto (Einnahme und Kosten) ohne Versandmethode nicht berechnet: ${erg.unbekannt.length} Bestellung(en) (${erg.unbekannt.slice(0, 5).join(', ')}${erg.unbekannt.length > 5 ? ', …' : ''}).`);
  }
  if (erg.fixkostenFehlen.length) {
    erg.hinweise.push(`Porto nicht berechnet, Porto-Satz fehlt in Kalkulation_Fixkosten zum Bestelldatum: ${erg.fixkostenFehlen.length} Bestellung(en) (${erg.fixkostenFehlen.slice(0, 5).join(', ')}${erg.fixkostenFehlen.length > 5 ? ', …' : ''}).`);
  }
  const leerErgebnis = !erg.einnahmen.anzahl && !erg.kosten.anzahl && !erg.versandErstattet && !erg.abholung && !erg.ohneVersand && !erg.unbekannt.length && !erg.fixkostenFehlen.length;
  return { ...erg, status: leerErgebnis ? 'keine' : erg.unbekannt.length || erg.fixkostenFehlen.length ? 'fehlt' : 'ok' };
}

/** Satz-Funktion aus Kalkulation_Fixkosten (parseKonfiguration mit Datum). */
export function satzAus(parseKonfiguration, rows, header) {
  const cache = new Map();
  return datumISO => {
    if (!cache.has(datumISO)) {
      const k = parseKonfiguration(rows, header, new Date(`${datumISO}T12:00:00Z`));
      const noetig = ['Porto B', 'Porto P', 'Versandnebenkosten B', 'Versandnebenkosten P'];
      cache.set(datumISO, { portoB: k.portoB, portoP: k.portoP, versandnebenkostenB: k.versandnebenkostenB, versandnebenkostenP: k.versandnebenkostenP,
        fehlt: (k.fehlend ?? []).filter(p => noetig.includes(p)) });
    }
    return cache.get(datumISO);
  };
}

/**
 * Daten einer neuen Sync-Zeile (Bestelldatum ab PORTO_AB): Porto-Spalten I/J/K = 0, dazu Porto_Bestellung (volle
 * Porto-Einnahme der Bestellung, netto) und Porto_Versandart. Vor PORTO_AB: null (altes Modell, anteilig).
 */
export function portoFuerSyncZeile({ bestelldatumDE, shippingNetto, versandart }) {
  if (!portoNeu(bestelldatumDE)) return null;
  return { portoEinnahmeAnteil: 0, portoKostenAnteil: 0, versandnkAnteil: 0, portoBestellung: round2(shippingNetto || 0), versandart: versandart === 'B' ? 'B' : 'P' };
}

/** Text der zwei Positionen (Abrechnung, Vorschau). */
export function portoZeilen(p) {
  if (!p || p.status === 'keine') return [];
  const fmt = n => Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [
    `Porto-Einnahmen (${p.einnahmen.anzahl} Bestellungen${p.versandErstattet ? `, darin Versand erstattet −${fmt(-p.versandErstattet)} €` : ""}): ${p.einnahmen.summe < 0 ? "−" : "+"}${fmt(Math.abs(p.einnahmen.summe))} € (netto)`,   // NB2
    `Porto-Kosten (${p.kosten.anzahl} Bestellungen, davon ${p.kosten.paket} Paket): −${fmt(p.kosten.summe)} € (netto)`,
  ];
}

// ── Umstellung offener Bestandszeilen ab PORTO_AB (Skript scripts/po1-porto-umstellen.js) ──────────────────────
/**
 * Plan je Zeile (rein, ohne Abruf): nur Partner-Zeilen mit Bestelldatum >= PORTO_AB, Status "offen", keine Storno-
 * Gegenbuchung, Porto_Bestellung noch leer. Neu: I/J/K = 0, M/N neu gerechnet (berechneFestpreisAnteil, Porto 0),
 * Porto_Bestellung = volles Porto der Bestellung (netto, aus dem Shop), Porto_Versandart = B|P aus FP_Artikel.
 * Vor PORTO_AB, abgerechnet, gesperrt oder Storno: nie. Dazu der Vergleich alt/neu je Bestellung (nur Terminal/MC).
 * @param {object} o { kopf, zeilen (mit _sheetRow), partnerId, portoJe: Map(oid -> netto), versandartJe: (produktId) -> 'B'|'P'|null,
 *                     satzAm, berechne (berechneFestpreisAnteil), mwstProzent }
 */
export function umstellungsPlan({ kopf, zeilen, partnerId, portoJe, versandartJe, satzAm, berechne, mwstProzent }) {
  const i = c => kopf.indexOf(c);
  const zahl0 = v => zahl(v) ?? 0;
  const aenderungen = [], fehlt = new Set(), ohneArt = new Set();
  const vergleich = new Map();   // oid -> { alt, neu, ... }
  for (const r of zeilen) {
    if (t(r[i('Partner-ID')]) !== partnerId) continue;
    if (!portoNeu(r[i('Datum')])) continue;
    if (t(r[i('Status Abrechnung')]).toLowerCase() !== 'offen') continue;
    if (t(r[i('Storno-Status')]) !== '') continue;
    if (i(PORTO_BESTELLUNG) !== -1 && t(r[i(PORTO_BESTELLUNG)]) !== '') continue;
    const oid = t(r[i('WC-Bestellnummer')]);
    const porto = portoJe.get(oid);
    if (porto === undefined || porto === null) { fehlt.add(oid); continue; }
    const art = versandartJe(t(r[i('Produkt-ID')]));
    if (!art) { ohneArt.add(t(r[i('Produkt-ID')])); continue; }
    const { netto, brutto } = berechne({
      vkNetto: zahl0(r[i('VK-Netto')]), festpreisEK: zahl0(r[i('Festpreis')]), handlingskosten: zahl0(r[i('Handlingskosten')]),
      stueckzahl: zahl0(r[i('Stückzahl')]) || 1, mehrkosten: zahl0(r[i('Mehrkosten')]),
      portoEinnahmeAnteil: 0, portoKostenAnteil: 0, versandnkAnteil: 0, paypalKosten: zahl0(r[i('PayPal-Kosten')]), mwstProzent,
    });
    aenderungen.push({ zeile: r._sheetRow, schluessel: `${oid}|${t(r[i('Artikelname')])}|${t(r[i('Variante')])}`, oid,
      werte: { 'Porto-Einnahme': 0, 'Porto-Kosten': 0, 'Versandnebenkosten': 0, 'Gesamt-Partner-Netto': netto, 'Gesamt-Partner-Brutto': brutto,
        [PORTO_BESTELLUNG]: round2(porto), [PORTO_VERSANDART]: art } });
    const v = vergleich.get(oid) ?? { alt: 0, datum: isoAusDE(r[i('Datum')]), methode: t(r[i(VERSANDMETHODE)]), arten: new Set(), porto };
    v.alt += zahl0(r[i('Porto-Einnahme')]) - zahl0(r[i('Porto-Kosten')]) - zahl0(r[i('Versandnebenkosten')]);
    v.arten.add(art);
    vergleich.set(oid, v);
  }
  let mehr = 0, weniger = 0, gleich = 0, summeAlt = 0, summeNeu = 0;
  for (const v of vergleich.values()) {
    const art = versandArt(v.methode);
    const s = satzAm(v.datum);
    const kosten = art === 'versendet' ? (v.arten.has('P') ? s.portoP + s.versandnebenkostenP : s.portoB + s.versandnebenkostenB) : 0;
    const neu = round2(v.porto - kosten);
    summeAlt += v.alt; summeNeu += neu;
    const d = round2(neu - round2(v.alt));
    if (d > 0.005) mehr++; else if (d < -0.005) weniger++; else gleich++;
  }
  return { aenderungen, bestellungen: vergleich.size, mehr, weniger, gleich, summeAlt: round2(summeAlt), summeNeu: round2(summeNeu),
    fehlt: [...fehlt], ohneVersandart: [...ohneArt] };
}
