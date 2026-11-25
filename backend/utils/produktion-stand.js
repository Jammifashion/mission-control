// Bestellansicht (PS1): reine Logik fuer "Bestellungen (JFN)" - L-Shop-Stand je Artikel aus dem
// Warenkorb, Haekchen "Fertig (im Karton)", Zusammenfassung im Kopf, Filter "wartet auf Teile".
// Ein-/Ausgabe in lib/produktionStand.js. Hier wird nichts gelesen und nichts geschrieben.
//
// Produktions_Status: A-J feste Positionen (wie routes/sheets.js), "Shop" (NAV3), "Fertig" und
// "Fertig_Am" (PS1) haengen hinten und werden nur ueber den Namen gefunden.
// "L-Shop_bestellt" (F) ist seit PS1 nur noch Altstand: angezeigt als "von Hand markiert (alt)",
// wo der Warenkorb die Position nicht kennt; geschrieben wird F von der Ansicht nie mehr.

import { findHeader } from './sheet-headers.js';
import { shopSpalte, gleicherShop, normalizeShop } from './shop-spalte.js';
import { STATUS, KLASSE, hinweisSperrt } from './korb-logic.js';

export const PS_FERTIG    = 'Fertig';
export const PS_FERTIG_AM = 'Fertig_Am';
// Feste Positionen A-J (wie PS_COLS in routes/sheets.js).
const PI = { orderId: 0, itemId: 1, lshop: 5, dtf: 6, gedruckt: 7, versendet: 8, notiz: 9 };

// Nicht bestellbar laut Einstufung des Korb-Abgleichs (stufeEin):
//  - KEIN_LSHOP: Trikot, Fremdware, Fanartikel -> grau "kein L-Shop-Artikel"
//  - sonst (Nummer fehlt/falsch/unbekannt, ausgelaufen, fremdes Produkt, Produkt nicht lesbar) -> gelb,
//    damit ein Datenfehler nicht wie "kein L-Shop" aussieht.
export const KEIN_LSHOP = new Set([KLASSE.TRIKOT, KLASSE.EXTERN, KLASSE.EINFACH, KLASSE.OHNE_VARIANTE]);
const KLASSE_KURZ = {
  [KLASSE.TRIKOT]: 'Trikot', [KLASSE.EXTERN]: 'Fremdware', [KLASSE.EINFACH]: 'Artikel ohne Variation',
  [KLASSE.OHNE_VARIANTE]: 'ohne L-Shop-Daten', [KLASSE.NR_LEER]: 'Nummer leer', [KLASSE.NR_FORMAT]: 'Nummer nicht 10 Ziffern',
  [KLASSE.NR_UNBEKANNT]: 'Nummer nicht in den L-Shop-Daten', [KLASSE.AUSGELAUFEN]: 'ausgelaufen',
  [KLASSE.FREMDES_PRODUKT]: 'Variante gehört zu anderem Artikel',
};

// Arten des L-Shop-Stands; ziel = Unterpunkt in "bestellen" (Klick), leer = kein Link.
export const STAND = {
  OFFEN: 'offen', RAUS: 'raus', BESTELLT: 'bestellt', GELIEFERT: 'geliefert',
  KEIN: 'kein', PRUEFEN: 'pruefen', NICHT_IM_KORB: 'nicht-im-korb', NUR_JFN: 'nur-jfn',
};
const ZIEL_KORB = 'lshop-korb';
const ZIEL_BESTELLUNGEN = 'lshop-bestellungen';

const t = v => String(v ?? '').trim();
const wahr = v => (typeof v === 'boolean' ? v : ['TRUE', 'WAHR'].includes(t(v).toUpperCase()));
export const psSchluessel = (orderId, itemId) => `${t(orderId)}|${t(itemId)}`;

/**
 * Produktions_Status (ganze Breite inkl. Kopf) -> Map "Bestellung|Position" -> Zustand, nur Zeilen des Shops.
 * Doppelte Zeilen: die erste gilt (wie psZeileIndex beim Schreiben).
 */
export function psZustaende(werte, shop) {
  const [kopf = [], ...rest] = werte ?? [];
  const si = shopSpalte(kopf);
  const iF = findHeader(kopf, PS_FERTIG);
  const iA = findHeader(kopf, PS_FERTIG_AM);
  const m = new Map();
  for (const r of rest) {
    if (!t(r[PI.orderId]) || !gleicherShop(r, si, shop)) continue;
    const k = psSchluessel(r[PI.orderId], r[PI.itemId]);
    if (m.has(k)) continue;
    m.set(k, {
      altLShop: wahr(r[PI.lshop]), dtfBestellt: wahr(r[PI.dtf]), gedruckt: wahr(r[PI.gedruckt]),
      versendet: wahr(r[PI.versendet]), notiz: t(r[PI.notiz]),
      fertig: iF >= 0 && wahr(r[iF]), fertigAm: iA >= 0 ? t(r[iA]) : '',
    });
  }
  return { zustaende: m, fertigSpalte: iF >= 0 && iA >= 0 };
}

/** "versandt · GLS · Paket 1" aus der BO4d-Bestellung (Pakete der ganzen L-Shop-Bestellung). */
function versandText(b) {
  const pakete = (b?.lieferscheine ?? []).flatMap(l => l.pakete ?? []);
  if (!pakete.length) return '';
  const fracht = [...new Set(pakete.map(p => t(p.frachtfuehrer)).filter(Boolean))].join('/');
  return ['versandt', fracht, pakete.length === 1 ? 'Paket 1' : `${pakete.length} Pakete`].filter(Boolean).join(' · ');
}

/**
 * L-Shop-Stand einer Shop-Position.
 * @param {object}  o
 * @param {boolean} o.jfn         Shop ist JFN (nur dort gibt es den Warenkorb)
 * @param {object}  [o.korb]      Korb-Zeile mit diesem Schluessel (korbZeilen)
 * @param {object}  [o.bestellung] BO4d-Bestellung, in der die Position steht (baueBestellungen)
 * @param {string}  [o.klasse]    Einstufung (stufeEin), nur ohne Korb-Zeile
 * @param {boolean} [o.altHaken]  altes Haekchen "L-Shop bestellt" in Produktions_Status
 * @returns {{ art, text, kurz, ziel, bestellId?, alt? }}
 */
export function lshopStand({ jfn, korb, bestellung, klasse, altHaken = false }) {
  const alt = altHaken && !korb ? { alt: true } : {};
  if (!jfn) return { art: STAND.NUR_JFN, text: 'L-Shop-Stand nur für JFN', kurz: '', ziel: '', ...alt };
  if (korb) {
    const s = t(korb.Status);
    if (s === STATUS.OFFEN) return { art: STAND.OFFEN, text: 'im Korb offen', kurz: 'L-Shop: im Korb', ziel: ZIEL_KORB };
    if (s === STATUS.ABGEWAEHLT) {
      const g = t(korb.Grund);
      return { art: STAND.RAUS, text: g ? `herausgenommen: ${g}` : 'herausgenommen', kurz: 'L-Shop: herausgenommen', ziel: ZIEL_KORB };
    }
    if (s === STATUS.BESTELLT) {
      const id = t(korb.Bestell_ID);
      const zusatz = bestellung?.status === 'teilweise geliefert' ? 'teilweise geliefert'
        : versandText(bestellung) || (bestellung?.status === 'bestätigt' ? 'bestätigt' : '');
      const kurzZusatz = zusatz.startsWith('versandt') ? ', versandt' : zusatz ? `, ${zusatz}` : '';
      return {
        art: STAND.BESTELLT, text: [`bestellt${id ? ` ${id}` : ''}`, zusatz].filter(Boolean).join(' · '),
        kurz: `L-Shop: bestellt${kurzZusatz}`, ziel: ZIEL_BESTELLUNGEN, bestellId: id,
      };
    }
    if (s === STATUS.GELIEFERT) {
      return { art: STAND.GELIEFERT, text: 'geliefert', kurz: 'L-Shop: geliefert', ziel: ZIEL_BESTELLUNGEN, bestellId: t(korb.Bestell_ID) };
    }
    // Sonstiger Status (z. B. "Lager"): so zeigen, wie er im Korb steht.
    return { art: STAND.RAUS, text: s || 'im Korb', kurz: `L-Shop: ${s || 'im Korb'}`, ziel: ZIEL_KORB };
  }
  if (klasse === KLASSE.BESTELLBAR) return { art: STAND.NICHT_IM_KORB, text: 'nicht im Korb', kurz: 'L-Shop: nicht im Korb', ziel: ZIEL_KORB, ...alt };
  if (!klasse || KEIN_LSHOP.has(klasse)) {
    const grund = KLASSE_KURZ[klasse] ?? '';
    return { art: STAND.KEIN, text: 'kein L-Shop-Artikel', grund, kurz: '', ziel: '', ...alt };
  }
  if (klasse === KLASSE.PRODUKT_FEHLT) return { art: STAND.PRUEFEN, text: 'Produkt im Shop nicht lesbar', kurz: 'L-Shop: prüfen', ziel: '', ...alt };
  return { art: STAND.PRUEFEN, text: 'L-Shop-Nummer fehlt', grund: KLASSE_KURZ[klasse] ?? klasse, kurz: 'L-Shop-Nummer fehlt', ziel: '', ...alt };
}

// ── Kalendertage Europe/Berlin ──────────────────────────────────────────────
const berlinTag = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
/** Ganze Kalendertage (Europe/Berlin) von iso bis jetzt; ungueltig -> null. */
export function tageSeit(iso, jetzt = new Date()) {
  const d = new Date(iso);
  if (!t(iso) || isNaN(d)) return null;
  return Math.round((Date.parse(berlinTag(jetzt)) - Date.parse(berlinTag(d))) / 864e5);
}

export const NAME_MAX = 30;
const kurzName = (name, menge) => {
  const n = t(name);
  const k = n.length > NAME_MAX ? `${n.slice(0, NAME_MAX - 1).trimEnd()}…` : n;
  return Number(menge) > 1 ? `${menge}× ${k}` : k;
};

/**
 * Zusammenfassung einer Bestellung aus ihren Artikeln. Versendet zaehlt als fertig (Teillieferung).
 * @param {{ name, menge, fertig, fertigAm, versendet, lshop }[]} artikel
 * @param {string} bestelldatum  date_created der Bestellung (Ersatz fuer "wartet seit" ohne Fertig_Am)
 */
export function zusammenfassung(artikel, bestelldatum, jetzt = new Date()) {
  const n = artikel.length;
  const fertigListe = artikel.filter(a => a.fertig || a.versendet);
  const fertig = fertigListe.length;
  const versendet = artikel.filter(a => a.versendet).length;
  const wartetAufTeile = fertig > 0 && fertig < n;
  const offen = artikel.filter(a => !a.fertig && !a.versendet);
  const wartetAuf = offen.map(a => `${kurzName(a.name, a.menge)}${a.lshop?.kurz ? ` (${a.lshop.kurz})` : ''}`);

  let text;
  if (!n) text = '–';
  else if (versendet === n) text = `${n}/${n} versendet ✓`;
  else {
    text = [`${fertig}/${n} fertig`, versendet ? `${versendet}/${n} versendet` : '',
      wartetAufTeile ? `wartet auf: ${wartetAuf.join(', ')}` : ''].filter(Boolean).join(' · ');
  }
  // "wartet seit": der erste Artikel, der fertig wurde (so lange liegt der Karton); ohne Zeit das Bestelldatum.
  const zeiten = fertigListe.map(a => Date.parse(a.fertigAm)).filter(Number.isFinite);
  const seit = zeiten.length ? new Date(Math.min(...zeiten)).toISOString() : t(bestelldatum);
  return {
    text, artikel: n, fertig, versendet, wartetAufTeile,
    allesVersendet: n > 0 && versendet === n,
    wartetSeit: wartetAufTeile ? seit : '', wartetTage: wartetAufTeile ? tageSeit(seit, jetzt) : null,
  };
}

/**
 * Stand aller Bestellungen der Ansicht.
 * @param {object}   o
 * @param {string}   o.shop
 * @param {object[]} o.bestellungen  [{ id, date_created, line_items: [{ id, name, quantity, product_id, variation_id, sku }] }]
 * @param {Map}      o.ps            psZustaende(...).zustaende
 * @param {Map}      o.korb          Schluessel -> Korb-Zeile
 * @param {Map}      o.bestellungJe  Korb-Schluessel -> BO4d-Bestellung
 * @param {Function} o.einstufen     li -> klasse (nur fuer Positionen ohne Korb-Zeile)
 * @param {Function} o.korbSchluessel (bestellnummer, position) -> Schluessel
 */
export function baueStand({ shop, bestellungen, ps, korb, bestellungJe, einstufen, korbSchluessel, lagerJe = new Map(), lagerFrei = null, dtf = null, jetzt = new Date() }) {
  const jfn = normalizeShop(shop) === 'jfn';
  return bestellungen.map(o => {
    const artikel = (o.line_items ?? []).map(li => {
      const z = ps.get(psSchluessel(o.id, li.id));
      const schl = jfn ? korbSchluessel(o.id, li.id) : '';
      const k = jfn ? korb.get(schl) : undefined;
      // einstufen liefert die Klasse (Tests) oder das ganze Ergebnis von stufeEin ({ klasse, articleNr }).
      const st = jfn && !k ? einstufen(li) : undefined;
      const stufe = st && typeof st === 'object' ? st : { klasse: st };
      const lshop = lshopStand({
        jfn, korb: k, bestellung: k ? bestellungJe.get(schl) : undefined,
        klasse: stufe.klasse, altHaken: z?.altLShop ?? false,
      });
      const lager = lagerJe.get(schl);   // BO5-8
      const fertig = z?.fertig ?? false, versendet = z?.versendet ?? false;
      const bo59 = lagerFrei ? einbuchenJeArtikel({ jfn, orderId: o.id, li, korbZeile: k, stufe, lager, fertig, versendet, ...lagerFrei }) : {};
      return {
        wcItemId: t(li.id), name: t(li.name), menge: Number(li.quantity) || 1, imSheet: Boolean(z),
        fertig, fertigAm: z?.fertigAm ?? '', versendet,
        dtfBestellt: z?.dtfBestellt ?? false, notiz: z?.notiz ?? '', lshop,
        ...(lager ? { lager } : {}),
        ...bo59,   // BO5-9: einbuchen / lagerFrei
        ...(jfn && dtf ? { dtf: dtfFuerKarte(dtf, `JFN:${t(o.id)}:${t(li.id)}`, stufe.klasse) } : {}),   // BO5-9 Teil B
      };
    });
    return { id: t(o.id), artikel, zusammenfassung: zusammenfassung(artikel, o.date_created, jetzt) };
  });
}

/**
 * BO5-8: Lager-Hinweis je Korb-Schluessel fuer die Bestellansicht. Grundlage sind die Korb-Buendel NACH korbVorschlaege
 * (gleiche Verteilung wie im Korb, keine Doppelverplanung). Nur Rohlinge (LS:<ArticleNr>) - gemessen 18.11.: anderer
 * Lagerbestand (WC:/EX:/TR:) existiert nicht.
 *  - art 'offen':    offene Position mit Bestand -> { n, genug } (Knopf "aus Lager nehmen" nur bei genug)
 *  - art 'bestellt': schon bei L-Shop bestellt/geliefert, aber Bestand da -> nur grauer Hinweis, kein Knopf
 * @returns {Map<string, object>}
 */
export function lagerJeKorb({ buendel, korb, bestand }) {
  const je = new Map();
  for (const b of buendel ?? []) {
    for (const p of b.positionen ?? []) {
      if (p.status === STATUS.OFFEN && p.lager?.n > 0) {
        je.set(t(p.schluessel), { art: 'offen', schluessel: p.schluessel, status: p.status, menge: p.menge, n: p.lager.n, genug: p.lager.genug,
          articleNr: t(b.articleNr), orte: b.lager?.orte ?? [] });
      }
    }
  }
  for (const [schl, z] of korb ?? new Map()) {
    if (![STATUS.BESTELLT, STATUS.GELIEFERT].includes(t(z.Status))) continue;
    const best = bestand?.get(t(z.LShop_ArticleNr));
    if (best?.summe > 0) je.set(schl, { art: 'bestellt', n: best.summe, articleNr: t(z.LShop_ArticleNr), orte: best.orte ?? [] });
  }
  return je;
}

/** Filter "wartet auf Teile": nur diese Bestellungen, aelteste zuerst. */
export function wartetAufTeile(stand) {
  return stand.filter(b => b.zusammenfassung.wartetAufTeile)
    .sort((a, b) => (Date.parse(a.zusammenfassung.wartetSeit) || Infinity) - (Date.parse(b.zusammenfassung.wartetSeit) || Infinity)
      || a.id.localeCompare(b.id, 'de', { numeric: true }));
}

/**
 * BO5-9 "Liegt im Lager – einbuchen …": Ware liegt physisch da, ist aber nie eingebucht. Nur JFN (Korb und Varianten gibt es
 * nur dort), nur Positionen, die weder fertig noch versendet sind.
 *  - mit Korb-Zeile: nur Status offen und ohne "aus Lager nehmen" (BO5-8 genug); Schluessel LS:<ArticleNr der Korb-Zeile>,
 *    Menge = was fehlt (Positionsmenge minus schon verplanter Bestand).
 *  - ohne Korb-Zeile: Rohling LS:<ArticleNr> (bestellbar, Abgleich noch nicht gelaufen), sonst Fertigware WC:<Variation> (nur
 *    wenn die Variante im Lager gepflegt ist); sonst Schluessel leer -> Dialog mit Artikelsuche, Grund in der Karte.
 *    Trikots nie (eigener Weg auf der Trikot-Seite).
 *    Dazu `lagerFrei` { schluessel, n, orte, genommen, menge, erledigt, korbFehlt }, sobald Bestand da ist oder schon etwas
 *    fuer diese Position ausgebucht wurde (abgang_shop mit Bezug der Position).
 * Einbuchen und Entnehmen bleiben zwei Schritte - hier wird nur angezeigt.
 * @param {object} o
 * @param {Map}    o.bestandJe  schluessel -> { summe, orte } (bestandJeSchluessel)
 * @param {Map}    o.genommenJe bezug "JFN:<Nr>:<Pos>" -> Stueck (shopAbgaengeJePosition)
 * @param {Set}    o.wcBekannt  im Lager gepflegte WC_Variation_IDs (null = unbekannt, dann kein WC-Vorschlag)
 */
export const EINBUCHEN_OHNE_SCHLUESSEL = 'Kein Lager-Artikel zu dieser Position bekannt – im Dialog suchen oder als Sonstiges anlegen.';
export function einbuchenJeArtikel({ jfn, orderId, li, korbZeile, stufe = {}, lager, fertig, versendet, bestandJe = new Map(), genommenJe = new Map(), wcBekannt = null }) {
  if (!jfn || fertig || versendet) return {};
  const menge = Number(li?.quantity) || 1;
  const bezug = `JFN:${t(orderId)}:${t(li?.id)}`;
  if (korbZeile) {
    if (t(korbZeile.Status) !== STATUS.OFFEN || lager?.genug || hinweisSperrt(korbZeile.Hinweis)) return {};   // gesperrt: nie im Lager-Vorschlag
    const nr = t(korbZeile.LShop_ArticleNr);
    const m = Number(t(korbZeile.Menge)) || menge;
    const fehlt = Math.max(1, m - (Number(lager?.n) || 0));
    return { einbuchen: { schluessel: /^\d{10}$/.test(nr) ? `LS:${nr}` : '', menge: fehlt, bezug, ...(/^\d{10}$/.test(nr) ? {} : { grund: EINBUCHEN_OHNE_SCHLUESSEL }) } };
  }
  if (stufe.klasse === KLASSE.TRIKOT) return {};   // Trikots: eigener Weg auf der Trikot-Seite (TR4 "ins Lager"), nie hier
  const vid = t(li?.variation_id);
  let schluessel = '';
  if (stufe.klasse === KLASSE.BESTELLBAR && /^\d{10}$/.test(t(stufe.articleNr))) schluessel = `LS:${t(stufe.articleNr)}`;
  else if (vid && vid !== '0' && wcBekannt?.has(vid)) schluessel = `WC:${vid}`;
  const genommen = genommenJe.get(bezug) ?? 0;
  const best = schluessel ? bestandJe.get(schluessel) : null;
  const n = best?.summe ?? 0;
  const out = {};
  if (schluessel && (n > 0 || genommen > 0)) {
    out.lagerFrei = { schluessel, n, orte: best?.orte ?? [], genommen, menge, erledigt: genommen >= menge, korbFehlt: schluessel.startsWith('LS:'), bezug };
  }
  const rest = menge - genommen;
  if (rest <= 0 || (schluessel && n >= rest)) return out;
  out.einbuchen = { schluessel, menge: Math.max(1, rest - n), bezug, ...(schluessel ? {} : { grund: EINBUCHEN_OHNE_SCHLUESSEL }) };
  return out;
}

/**
 * BO5-9 Teil B: DTF-Stand einer Position fuer die drei Knoepfe der Bestellkarte (Quelle = Warenkorb_DTF, eine Quelle).
 *  - { aus: Grund }  Knoepfe aus: Korb nicht eingerichtet / gerade nicht lesbar
 *  - null            Trikot (kommt nie in den DTF-Korb) -> keine Knoepfe
 *  - { stand: 'keine' } noch keine Korb-Zeile (Abgleich nicht gelaufen / vor dem Start-Datum) - Knoepfe legen sie an
 *  - sonst dtfStandJePosition (bestellen | bestellt | lager | abgewaehlt) mit den gesehenen Zeilen-Staenden
 */
export const DTF_AUS = { einrichtung: 'DTF-Korb noch nicht eingerichtet', lesen: 'DTF-Korb gerade nicht lesbar' };
export function dtfFuerKarte(dtf, posKey, klasse) {
  if (klasse === KLASSE.TRIKOT) return null;
  if (dtf.einrichtung === false) return { aus: DTF_AUS.einrichtung };
  if (dtf.einrichtung !== true) return { aus: DTF_AUS.lesen };
  return dtf.je.get(posKey) ?? { stand: 'keine', zeilen: [] };
}
