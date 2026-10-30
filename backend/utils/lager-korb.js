// Lager im L-Shop-Warenkorb (BO5-3) - reine Logik, ohne Zugriffe. Ein-/Ausgabe in lib/lagerKorb.js.
//
// Inhaber 30.10.: MC schlaegt vor, der Inhaber bestaetigt; nichts automatisch (auch nicht im Abgleich).
// Vorschlag nur bei exakt gleicher LShop_ArticleNr (nur Rohlinge LS:). "aus Lager nehmen" = Korb-Status `Lager`
// (Konstante STATUS.LAGER, so wie sie ist) + Abgang im Lager-Journal (Quelle korb, Bezug = Korb-Schluessel), in
// EINEM Schreibvorgang. Rueckweg "zurück in den Korb" = Status offen + Gegenbuchung (Storno_von). Teilen
// (Lager deckt nur einen Teil der Menge) gibt es in dieser Stufe nicht.

import { STATUS, HERKUNFT, hinweisSperrt } from './korb-logic.js';
import { ART, QUELLE, WARENART, bestandAus, bestandVon, naechsteBuchungNr, buchungId, VORGANG_MUSTER, buchungenDesVorgangs } from './lager.js';

const t = v => String(v ?? '').trim();
const fehler = (msg, status, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
export const KORB_ABGANG_ARTEN = [ART.ABGANG_SHOP, ART.ABGANG_EIGEN];

/** Rohling-Bestand je ArticleNr: Map nr -> { summe, orte: [{ ort, menge }] } (nur Orte mit Bestand > 0, meiste zuerst). */
export function rohlingBestandJeNr(buchungen) {
  const m = new Map();
  for (const e of bestandAus(buchungen).values()) {
    if (!e.schluessel.startsWith('LS:') || e.menge <= 0) continue;
    const nr = e.schluessel.slice(3);
    const g = m.get(nr) ?? { summe: 0, orte: [] };
    g.summe += e.menge;
    g.orte.push({ ort: e.ort, menge: e.menge });
    m.set(nr, g);
  }
  for (const g of m.values()) g.orte.sort((a, b) => b.menge - a.menge || a.ort.localeCompare(b.ort));
  return m;
}

/** Offene (nicht gegengebuchte) Abgaenge aus dem Korb: Map Korb-Schluessel -> [{ id, ort, menge (positiv), art }]. */
export function korbAbgaenge(buchungen) {
  const gegen = new Set((buchungen ?? []).filter(b => b.stornoVon).map(b => b.stornoVon));
  const m = new Map();
  for (const b of buchungen ?? []) {
    if (b.quelle !== QUELLE.KORB || !KORB_ABGANG_ARTEN.includes(b.art) || gegen.has(b.id) || !b.bezug) continue;
    const l = m.get(b.bezug) ?? [];
    l.push({ id: b.id, ort: b.ort, menge: -b.menge, art: b.art, datum: b.datum });
    m.set(b.bezug, l);
  }
  return m;
}

/**
 * Vorschlag je Buendel (eine ArticleNr) in Positionsreihenfolge, ohne Doppelverplanung: jede vorschlagbare
 * Position (offen, kein sperrender Hinweis) sieht n = Bestand minus das, was frueheren Positionen schon
 * vorgeschlagen ist. Setzt b.lager = { summe, orte } und p.lager = { n, genug } (nur wenn n > 0); bei Status
 * Lager p.lagerAbgang = Abgaenge dieser Position.
 */
export function korbVorschlaege(buendel, bestandJeNr, abgaenge = new Map()) {
  for (const b of buendel ?? []) {
    const best = /^\d{10}$/.test(t(b.articleNr)) ? bestandJeNr.get(t(b.articleNr)) : null;
    b.lager = best ? { summe: best.summe, orte: best.orte } : null;
    let rest = best?.summe ?? 0;
    for (const p of b.positionen ?? []) {
      if (p.status === STATUS.LAGER) p.lagerAbgang = abgaenge.get(p.schluessel) ?? [];
      if (!p.vorschlag || p.status !== STATUS.OFFEN || rest <= 0) continue;
      p.lager = { n: rest, genug: rest >= p.menge };
      rest -= Math.min(rest, p.menge);
    }
  }
  return buendel;
}

function vorgangPruefen(buchungen, vorgang) {
  const v = t(vorgang);
  if (!VORGANG_MUSTER.test(v)) throw fehler('Interne Kennung fehlt - Seite neu laden.', 422, { code: 'vorgang' });
  return { v, schon: buchungenDesVorgangs(buchungen, v) };
}

function korbZeileZu(korbZeilen, schluessel) {
  const s = t(schluessel);
  const treffer = (korbZeilen ?? []).filter(z => z.Schluessel === s);
  if (!treffer.length) throw fehler(`Position ${s} gibt es nicht (mehr) - nichts geändert.`, 409, { code: 'konflikt' });
  if (treffer.length > 1) throw fehler(`Position ${s} steht mehrfach im Warenkorb - nichts geändert.`, 409, { code: 'konflikt' });
  return treffer[0];
}

/**
 * "aus Lager nehmen": Korb-Zeile offen -> Lager, Abgang je Ort aus der Verteilung.
 * @param {object} e  { schluessel, status (wie gesehen), verteilung: [{ ort, menge }], vorgang }
 * @param {object} k  { korbZeilen, buchungen, orte: string[] (aktiv), jetzt: Date }
 * @returns {{ schonGebucht?: object[], korb?: { zeile, schluessel, werte }, lagerZeilen?: object[] }}
 */
export function ausLagerPlan(e, { korbZeilen, buchungen, orte, jetzt = new Date() }) {
  const { v, schon } = vorgangPruefen(buchungen, e?.vorgang);
  if (schon.length) return { schonGebucht: schon };
  const z = korbZeileZu(korbZeilen, e?.schluessel);
  if (z.Status !== t(e?.status)) throw fehler(`Position ${z.Schluessel} hat sich geändert (jetzt "${z.Status}") - nichts geändert. Bitte neu laden.`, 409, { code: 'konflikt' });
  if (z.Status !== STATUS.OFFEN) throw fehler(`Position ${z.Schluessel} ist "${z.Status}" - nur offene Positionen gehen aus dem Lager.`, 422);
  if (hinweisSperrt(z.Hinweis)) throw fehler(`Position ${z.Schluessel}: ${z.Hinweis} - nicht aus dem Lager nehmen.`, 422);
  const nr = t(z.LShop_ArticleNr);
  if (!/^\d{10}$/.test(nr)) throw fehler(`Position ${z.Schluessel} hat keine gültige L-Shop-Artikelnummer.`, 422);
  const menge = Number(z.Menge);
  if (!Number.isInteger(menge) || menge < 1) throw fehler(`Position ${z.Schluessel}: Menge "${z.Menge}" ist ungültig.`, 422);
  if (korbAbgaenge(buchungen).get(z.Schluessel)?.length) {
    throw fehler(`Position ${z.Schluessel} hat schon einen Lager-Abgang - bitte von Hand prüfen, nichts geändert.`, 409, { code: 'konflikt' });
  }

  const verteilung = (Array.isArray(e?.verteilung) ? e.verteilung : []).map(x => ({ ort: t(x?.ort), menge: Number(x?.menge) }))
    .filter(x => x.ort || x.menge);
  const probleme = [];
  if (!verteilung.length || verteilung.length > 2) probleme.push({ code: 'verteilung', text: 'Bitte einen Ort wählen (höchstens zwei).' });
  const orteSet = new Set(orte ?? []);
  const bestand = bestandAus(buchungen);
  const gesehen = new Set();
  for (const x of verteilung) {
    if (!orteSet.has(x.ort)) probleme.push({ code: 'ort', text: x.ort ? `Ort "${x.ort}" gibt es nicht (mehr).` : 'Bitte einen Ort wählen.' });
    else if (gesehen.has(x.ort)) probleme.push({ code: 'ort', text: `Ort "${x.ort}" doppelt.` });
    gesehen.add(x.ort);
    if (!Number.isInteger(x.menge) || x.menge < 1) { probleme.push({ code: 'menge', text: `Menge bei "${x.ort}" ungültig.` }); continue; }
    const da = bestandVon(bestand, `LS:${nr}`, x.ort);
    if (x.menge > da) probleme.push({ code: 'bestand', text: `Am Ort "${x.ort}" ${da ? `nur ${da}` : 'nichts'} da, ${x.menge} gewünscht.`, da });
  }
  const summe = verteilung.reduce((a, x) => a + (Number.isInteger(x.menge) ? x.menge : 0), 0);
  if (!probleme.length && summe !== menge) probleme.push({ code: 'summe', text: `Verteilt sind ${summe}, die Position braucht ${menge}.` });
  if (probleme.length) throw fehler(probleme[0].text, 422, { probleme, code: 'nicht_gebucht' });

  const iso = jetzt.toISOString();
  const jahr = jetzt.getUTCFullYear();
  const n0 = naechsteBuchungNr(buchungen, jahr);
  const art = z.Herkunft === HERKUNFT.EIGEN ? ART.ABGANG_EIGEN : ART.ABGANG_SHOP;
  return {
    korb: { zeile: z._zeile, schluessel: z.Schluessel, werte: { Status: STATUS.LAGER, Grund: '', Status_Datum: iso, Stand: iso } },
    lagerZeilen: verteilung.map((x, i) => ({
      Buchung_ID: buchungId(jahr, n0 + i), Datum: iso, Art: art, Warenart: WARENART.ROHLING, Schluessel: `LS:${nr}`, Menge: -x.menge,
      Ort: x.ort, Grund: '', Bezug: z.Schluessel, Quelle: QUELLE.KORB, Notiz: '', Storno_von: '', Stand: iso, Vorgang: v,
    })),
  };
}

/**
 * "zurück in den Korb": Korb-Zeile Lager -> offen, jede offene Korb-Buchung dieser Position gegengebucht (Storno_von).
 * @param {object} e  { schluessel, vorgang }
 */
export function zurueckAusLagerPlan(e, { korbZeilen, buchungen, jetzt = new Date() }) {
  const { v, schon } = vorgangPruefen(buchungen, e?.vorgang);
  if (schon.length) return { schonGebucht: schon };
  const z = korbZeileZu(korbZeilen, e?.schluessel);
  if (z.Status !== STATUS.LAGER) throw fehler(`Position ${z.Schluessel} ist "${z.Status}", nicht "${STATUS.LAGER}" - nichts geändert. Bitte neu laden.`, 409, { code: 'konflikt' });
  const ab = korbAbgaenge(buchungen).get(z.Schluessel) ?? [];
  if (!ab.length) throw fehler(`Zu Position ${z.Schluessel} gibt es keine offene Lager-Buchung - bitte von Hand prüfen, nichts geändert.`, 409, { code: 'konflikt' });
  const iso = jetzt.toISOString();
  const jahr = jetzt.getUTCFullYear();
  const n0 = naechsteBuchungNr(buchungen, jahr);
  const nr = t(z.LShop_ArticleNr);
  return {
    korb: { zeile: z._zeile, schluessel: z.Schluessel, werte: { Status: STATUS.OFFEN, Grund: '', Status_Datum: iso, Stand: iso } },
    lagerZeilen: ab.map((a, i) => ({
      Buchung_ID: buchungId(jahr, n0 + i), Datum: iso, Art: ART.KORREKTUR, Warenart: WARENART.ROHLING, Schluessel: `LS:${nr}`, Menge: a.menge,
      Ort: a.ort, Grund: 'zurück in den Korb', Bezug: z.Schluessel, Quelle: QUELLE.KORB, Notiz: '', Storno_von: a.id, Stand: iso, Vorgang: v,
    })),
  };
}
