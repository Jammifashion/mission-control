// Lager beim Wareneingang (BO5-4) - reine Logik, ohne Zugriffe. Ein-/Ausgabe in lib/wareneingang.js, lib/karton.js,
// lib/lagerEingang.js.
//
// Nichts automatisch, der Mensch bestaetigt: "Ware angekommen" bzw. "Karton angekommen" IST die Bestaetigung fuer
//  - Positionen mit Lager_Ziel (eigene Positionen, "bei Ankunft ins Lager"): Zugang Art vorrat, Menge = Positionsmenge,
//    abwaehlbar je Position; nie zweimal je Korb-Schluessel (offener Zugang aus Wareneingang/Karton).
//  - "mehr gekommen: n" (von Hand): Zugang Art zugang_ueberschuss, Bezug = Korb-Schluessel.
// Eigene Knoepfe (ein Schreibaufruf nur ins Lager):
//  - Karton: "Rest ins Lager (m-n)" bei Karton > Korb, "ins Lager" bei "nicht im Korb" - Mengen aus Ord. (nie Qty),
//    Bezug <order_id>:<Karton-ID>:<reference>:<sku> (nie die Kundennummer aus dem QR-Link).
//  - Trikot mit Status "ersetzt": "falsches Trikot ins Lager" (TR:<Produkt-ID>:<Groesse>, Notiz nur "beflockt").

import { ART, QUELLE, WARENART, naechsteBuchungNr, buchungId, bestandAus, VORGANG_MUSTER, buchungenDesVorgangs, trikotSchluessel, warenartVon } from './lager.js';
import { AU_NR_MUSTER } from './auftraege.js';
import { STATUS, HERKUNFT } from './korb-logic.js';

const t = v => String(v ?? '').trim();
const fehler = (msg, status, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
export const QUELLE_EINGANG = { WARENEINGANG: 'wareneingang', KARTON: 'karton' };
export const HAUPTORT = 'Wrist';
const MEHR_MAX = 999;

/** Offene (nicht gegengebuchte) Zugaenge aus dem Wareneingang je Bezug -> Liste. */
export function eingangsZugaenge(buchungen) {
  const gegen = new Set((buchungen ?? []).filter(b => b.stornoVon).map(b => b.stornoVon));
  const m = new Map();
  for (const b of buchungen ?? []) {
    if (!Object.values(QUELLE_EINGANG).includes(b.quelle) || b.menge <= 0 || gegen.has(b.id) || !b.bezug) continue;
    const l = m.get(b.bezug) ?? [];
    l.push(b);
    m.set(b.bezug, l);
  }
  return m;
}

/** Standard-Ort: Wrist, wenn aktiv; sonst der erste aktive Ort. */
export const standardOrt = orte => ((orte ?? []).includes(HAUPTORT) ? HAUPTORT : (orte ?? [])[0] ?? '');

function zeilenAus(bewegungen, { buchungen, jetzt, vorgang }) {
  const jahr = jetzt.getUTCFullYear();
  const n0 = naechsteBuchungNr(buchungen, jahr);
  const iso = jetzt.toISOString();
  return bewegungen.map((b, i) => ({
    Buchung_ID: buchungId(jahr, n0 + i), Datum: iso, Art: b.art, Warenart: warenartVon(b.schluessel) ?? WARENART.ROHLING, Schluessel: b.schluessel,
    Menge: b.menge, Ort: b.ort, Grund: b.grund ?? '', Bezug: b.bezug, Quelle: b.quelle, Notiz: b.notiz ?? '', Storno_von: '', Stand: iso, Vorgang: vorgang,
  }));
}

/**
 * Lager-Zeilen beim Wareneingang ("Ware angekommen" / "Karton angekommen"). Fuer jede gebuchte Position:
 * Lager_Ziel (+ insLager !== false) -> vorrat; mehr > 0 -> zugang_ueberschuss. Alles oder nichts (wirft 422).
 * @param {object} o { auswahl: [{ schluessel, mehr, insLager, ort }], korbZeilen, buchungen, orte, quelle, orderId, vorgang, jetzt }
 * @returns {object[]} Journal-Zeilen (leer = nichts ins Lager)
 */
export function eingangLagerPlan({ auswahl, korbZeilen, buchungen, orte, quelle, orderId, vorgang, jetzt = new Date() }) {
  const jeSchluessel = new Map((korbZeilen ?? []).map(z => [z.Schluessel, z]));
  const offen = eingangsZugaenge(buchungen);
  const bewegungen = [];
  const probleme = [];
  const ortOk = o => (orte ?? []).includes(o);
  for (const a of auswahl ?? []) {
    const z = jeSchluessel.get(t(a?.schluessel));
    if (!z) continue;   // fehlt -> meldet eingangPlan
    const nr = t(z.LShop_ArticleNr);
    const grund = `Wareneingang ${t(orderId)}`.trim();
    const ziel = t(z.Lager_Ziel);
    if (ziel && z.Herkunft === HERKUNFT.EIGEN && a?.insLager !== false) {
      const ort = t(a?.ort) || ziel;
      if (!ortOk(ort)) probleme.push({ schluessel: z.Schluessel, text: `Lagerort "${ort}" gibt es nicht (mehr)` });
      else if ((offen.get(z.Schluessel) ?? []).some(b => b.art === ART.VORRAT)) probleme.push({ schluessel: z.Schluessel, text: 'schon ins Lager gebucht' });
      else bewegungen.push({ art: ART.VORRAT, schluessel: `LS:${nr}`, menge: Number(z.Menge) || 0, ort, bezug: z.Schluessel, quelle, grund });
    }
    const roh = t(a?.mehr);
    if (roh && roh !== '0') {
      const n = Number(roh);
      if (!Number.isInteger(n) || n < 1 || n > MEHR_MAX) { probleme.push({ schluessel: z.Schluessel, text: `"mehr gekommen" ungültig (1–${MEHR_MAX})` }); continue; }
      const ort = t(a?.ortMehr) || t(a?.ort) || standardOrt(orte);
      if (!ortOk(ort)) { probleme.push({ schluessel: z.Schluessel, text: `Lagerort "${ort}" gibt es nicht (mehr)` }); continue; }
      bewegungen.push({ art: ART.UEBERSCHUSS, schluessel: `LS:${nr}`, menge: n, ort, bezug: z.Schluessel, quelle, grund });
    }
  }
  if (bewegungen.some(b => !/^LS:\d{10}$/.test(b.schluessel))) probleme.push({ text: 'Position ohne gültige L-Shop-Artikelnummer' });
  if (probleme.length) throw fehler(`Lager: ${probleme[0].text}${probleme[0].schluessel ? ` (${probleme[0].schluessel})` : ''} - nichts gebucht.`, 422, { probleme });
  if (!bewegungen.length) return [];
  if (!VORGANG_MUSTER.test(t(vorgang))) throw fehler('Interne Kennung fehlt - Seite neu laden.', 422);
  return zeilenAus(bewegungen, { buchungen, jetzt, vorgang: t(vorgang) });
}

/** Rueckweg "zurück auf bestellt": nicht, solange ein Lager-Zugang aus dem Wareneingang dieser Position offen ist. */
export function zurueckSperre(auswahl, buchungen) {
  const offen = eingangsZugaenge(buchungen);
  const gesperrt = (auswahl ?? []).map(a => t(a?.schluessel)).filter(s => offen.get(s)?.length);
  if (gesperrt.length) {
    throw fehler(`${gesperrt.join(', ')}: schon ins Lager gebucht - erst im Lager die Gegenbuchung, dann zurück auf bestellt.`, 409, { code: 'lager' });
  }
}

/** Bezug einer Karton-Zeile - order_id, Karton-ID, reference, SKU; nie die Kundennummer. */
export const kartonBezug = (orderId, kartonId, reference, sku) => [t(orderId), t(kartonId), t(reference), t(sku)].join(':');

/**
 * Karton: "Rest ins Lager" (Karton > Korb, Menge = Ord. - Korb) und "ins Lager" (nicht im Korb, Menge = Ord.).
 * @param {object} o { abgleich (kartonAbgleich), karton, kartonId, auswahl: [{ reference, sku }], ort, buchungen, orte,
 *   gueltig: schluessel -> true|Text, vorgang, jetzt }
 */
export function kartonUeberschussPlan({ abgleich, karton, kartonId, auswahl, ort, buchungen, orte, gueltig = () => true, vorgang, jetzt = new Date() }) {
  const v = t(vorgang);
  if (!VORGANG_MUSTER.test(v)) throw fehler('Interne Kennung fehlt - Seite neu laden.', 422);
  const schon = buchungenDesVorgangs(buchungen, v);
  if (schon.length) return { schonGebucht: schon };
  if (!Array.isArray(auswahl) || !auswahl.length) throw fehler('Keine Karton-Zeile gewählt.', 422);
  if (!(orte ?? []).includes(t(ort))) throw fehler(t(ort) ? `Lagerort "${t(ort)}" gibt es nicht (mehr).` : 'Bitte einen Lagerort wählen.', 422);
  const offen = eingangsZugaenge(buchungen);
  const probleme = [];
  const bewegungen = [];
  for (const a of auswahl) {
    const p = (abgleich?.positionen ?? []).find(x => x.reference === t(a?.reference) && x.sku === t(a?.sku));
    const name = `${t(a?.reference)} ${t(a?.sku)}`.trim();
    if (!p) { probleme.push({ text: `${name}: nicht in diesem Karton` }); continue; }
    const rest = lagerRestFuer(p);
    if (!(rest > 0)) { probleme.push({ text: `${name}: kein Überschuss` }); continue; }
    const bezug = kartonBezug(karton.orderId, kartonId, p.reference, p.sku);
    if (offen.get(bezug)?.length) { probleme.push({ text: `${name}: schon ins Lager gebucht` }); continue; }
    const s = `LS:${p.sku}`;
    const g = /^\d{10}$/.test(p.sku) ? gueltig(s) : `${p.sku} ist keine L-Shop-Artikelnummer`;
    if (g !== true) { probleme.push({ text: typeof g === 'string' ? g : `${p.sku} ist nicht gepflegt` }); continue; }
    bewegungen.push({ art: ART.UEBERSCHUSS, schluessel: s, menge: rest, ort: t(ort), bezug, quelle: QUELLE_EINGANG.KARTON, grund: `Karton ${t(kartonId)} · ${t(karton.orderId)}` });
  }
  if (probleme.length) throw fehler(`${probleme[0].text} - nichts gebucht.`, 422, { probleme });
  return { zeilen: zeilenAus(bewegungen, { buchungen, jetzt, vorgang: v }) };
}

/**
 * Ueberschuss einer Karton-Zeile: Karton > Korb (Status bestellt/geliefert) -> Ord. - Korb; nicht im Korb -> Ord.; sonst 0.
 * Die Menge ist immer `ord` (Summe "Ord." je reference + SKU), nie "Qty".
 */
export function lagerRestFuer(p) {
  const ord = Number(p?.ord);
  if (!Number.isInteger(ord) || ord < 1) return 0;
  if (!p.schluessel) return ord;
  const korb = Number(p.menge);
  return Number.isInteger(korb) && ord > korb ? ord - korb : 0;
}

/**
 * Trikot mit Status "ersetzt" ins Lager: TR:<Produkt-ID>:<Groesse>, Art zugang_ueberschuss (Mehrstueck vom Produzenten),
 * Quelle wareneingang, Bezug = Zeilen-ID, Notiz nur "beflockt" (wenn Name oder Nummer da) - nie der Rueckenname.
 * @param {object} o { zeile: { id, status, produktId, groesse, beflockt }, ort, buchungen, orte, vorgang, jetzt }
 */
export function trikotLagerPlan({ zeile, ort, buchungen, orte, vorgang, jetzt = new Date() }) {
  const v = t(vorgang);
  if (!VORGANG_MUSTER.test(v)) throw fehler('Interne Kennung fehlt - Seite neu laden.', 422);
  const schon = buchungenDesVorgangs(buchungen, v);
  if (schon.length) return { schonGebucht: schon };
  if (t(zeile?.status).toLowerCase() !== 'ersetzt') throw fehler(`Zeile ${t(zeile?.id)} ist nicht "ersetzt" - nichts gebucht.`, 409);
  if (!t(zeile?.produktId)) throw fehler('Zum Trikot fehlt die Produkt-ID (Trikot_Artikel) - nichts gebucht.', 422);
  const s = trikotSchluessel(zeile.produktId, zeile.groesse);
  if (warenartVon(s) !== WARENART.TRIKOT) throw fehler(`Größe "${t(zeile.groesse)}" passt nicht - nichts gebucht.`, 422);
  if (!(orte ?? []).includes(t(ort))) throw fehler(t(ort) ? `Lagerort "${t(ort)}" gibt es nicht (mehr).` : 'Bitte einen Lagerort wählen.', 422);
  if (eingangsZugaenge(buchungen).get(t(zeile.id))?.length) throw fehler('Dieses Trikot ist schon im Lager gebucht.', 409, { code: 'doppelt' });
  return { zeilen: zeilenAus([{ art: ART.UEBERSCHUSS, schluessel: s, menge: 1, ort: t(ort), bezug: t(zeile.id), quelle: QUELLE_EINGANG.WARENEINGANG,
    grund: 'Trikot ersetzt', notiz: zeile.beflockt ? 'beflockt' : '' }], { buchungen, jetzt, vorgang: v }) };
}

/** "bei Ankunft ins Lager" setzen/entfernen: nur eigene Positionen, nur offen/bestellt, Ort aktiv (leer = entfernen). */
export function lagerZielPlan({ korbZeile: z, status, ziel, orte }) {
  if (!z) throw fehler('Position gibt es nicht (mehr) - nichts geändert.', 409);
  if (z.Herkunft !== HERKUNFT.EIGEN) throw fehler('Nur eigene Positionen können direkt ins Lager gehen (Shop-Positionen gehören einem Kunden).', 422);
  if (AU_NR_MUSTER.test(t(z.Referenz)) && t(ziel)) throw fehler(`Position ${z.Schluessel} gehört zu Auftrag ${t(z.Referenz)} (Kundenrohlinge) – nicht ins Lager.`, 422);
  if (z.Status !== t(status)) throw fehler(`Position ${z.Schluessel} hat sich geändert (jetzt "${z.Status}") - bitte neu laden.`, 409);
  if (![STATUS.OFFEN, STATUS.BESTELLT].includes(z.Status)) throw fehler(`Position ${z.Schluessel} ist "${z.Status}" - nur bis zum Wareneingang änderbar.`, 422);
  const neu = t(ziel);
  if (neu && !(orte ?? []).includes(neu)) throw fehler(`Lagerort "${neu}" gibt es nicht (mehr).`, 422);
  return { zeile: z._zeile, schluessel: z.Schluessel, alt: t(z.Lager_Ziel), neu };
}

/** Bestand je Ort nach den neuen Zeilen nie negativ (nur Zugaenge hier - zur Sicherheit). */
export const nieNegativ = (buchungen, zeilen) => [...bestandAus([...(buchungen ?? []), ...zeilen.map(z => ({ schluessel: z.Schluessel, ort: z.Ort, menge: z.Menge, datum: z.Datum }))]).values()].every(e => e.menge >= 0);
export { QUELLE };

/** Setup Lager_Ziel: { da, spalte (Index hinter der letzten belegten Kopfspalte), belegt (Zeilen mit Wert dort), kopfBreite }. */
export function lagerZielSpaltePlan(werte) {
  const kopf = (werte?.[0] ?? []).map(k => t(k));
  if (kopf.some(k => k.toLowerCase() === 'lager_ziel')) return { da: true, spalte: kopf.findIndex(k => k.toLowerCase() === 'lager_ziel'), belegt: 0, kopfBreite: kopf.length };
  let spalte = kopf.length;
  while (spalte > 0 && !kopf[spalte - 1]) spalte--;
  const belegt = (werte ?? []).slice(1).filter(r => t(r?.[spalte])).length;
  return { da: false, spalte, belegt, kopfBreite: kopf.length };
}
