// Problemliste "Lieferbarkeit Shop" (BO7-3) - reine Logik, ohne Zugriffe. Ein-/Ausgabe in lib/lieferbarkeitShop.js.
//
// Wer drin ist: aktive Varianten-Zeilen (Aktiv TRUE, WC_Variation_ID, LShop_ArticleNr) eines VEROEFFENTLICHTEN JFN-Artikels,
// deren Rohling bei L-Shop nicht mehr gefuehrt ist (sofort), auf der Auslaufliste steht oder seit >= 14 Tagen am Stueck 0 hat.
// Nur lesen, nur Vorschlaege als Text (Inhaber: nichts automatisch, kundensichtbare Aenderungen nur im eigenen Auftrag).
//
// BO7-5: zwei Gruppen ueber den LAGERSTATUS im Shop (Map Variation-ID -> { lager, rueckstandErlaubt }):
//  - "Im Rueckstand – bei L-Shop lieferbar": Shop onbackorder (oder Rueckstand erlaubt), L-Shop lieferbar (stock > 0, nicht auf
//    der Auslaufliste) -> Vorschlag "zurück auf vorrätig". Diese Variationen haben KEIN L-Shop-Problem und kommen nur so herein.
//  - "Vorrätig – bei L-Shop 0 / weg": Shop instock, L-Shop nicht gefuehrt / laeuft aus · schon 0 / 0 seit >= 14 Tagen
//    -> Vorschlag "Rückstand oder privat?". Teilmenge der Problemliste.
// Ohne Lagerstatus (unbekannt) gibt es keine Gruppe.

import { stufeAus, STUFE } from './lshop-lieferbarkeit.js';

export const NULL_AB_TAGE = 14;       // Inhaber 02.11.: Bestand 0 zaehlt erst ab 14 Tagen am Stueck
export const LIEFERZEIT_PRUEFEN_TAGE = 30;
export const NACHFOLGER_MAX = 3;
const TAG_MS = 86_400_000;
const RANG = { [STUFE.WEG]: 0, [STUFE.AUSLAUF_NULL]: 1, [STUFE.AUSLAUF]: 2, [STUFE.NULL]: 3, [STUFE.LIEFERBAR]: 4 };   // BO7-4: schon 0 vor laeuft aus
export const GRUPPE = { RUECKSTAND_LIEFERBAR: 'rueckstand_lieferbar', VORRAETIG_PROBLEM: 'vorraetig_problem' };   // BO7-5
export const LAGER = { VORRAETIG: 'instock', RUECKSTAND: 'onbackorder', NICHT_VORRAETIG: 'outofstock' };
const VORRAETIG_PROBLEM_STUFEN = [STUFE.WEG, STUFE.AUSLAUF_NULL, STUFE.NULL];
export const VORSCHLAG_ZURUECK = 'zurück auf vorrätig';
export const VORSCHLAG_RUECKSTAND_PRIVAT = 'Rückstand oder privat? (im Shop noch vorrätig)';
const LAGER_TEXT = { [LAGER.VORRAETIG]: 'Shop: vorrätig', [LAGER.RUECKSTAND]: 'Shop: im Rückstand', [LAGER.NICHT_VORRAETIG]: 'Shop: nicht vorrätig' };
const t = v => String(v ?? '').trim();
const NR_RE = /^\d{10}$/;

/** Ganze Tage seit einem Zeitpunkt (ISO), sonst null. */
export function tageSeit(iso, jetzt = new Date()) {
  const d = Date.parse(t(iso));
  return Number.isFinite(d) ? Math.floor((jetzt.getTime() - d) / TAG_MS) : null;
}

/** Store-API-Eintrag ({ is_in_stock, is_on_backorder }) -> Lagerstatus wie WooCommerce (instock | onbackorder | outofstock). */
export function lagerAusStore(p) {
  if (p?.is_on_backorder === true) return LAGER.RUECKSTAND;
  if (p?.is_in_stock === true) return LAGER.VORRAETIG;
  if (p?.is_in_stock === false) return LAGER.NICHT_VORRAETIG;
  return '';
}

/** wc/v3-Variation ({ stock_status, backorders }) -> { lager, rueckstandErlaubt }; unbekannte Werte = '' (keine Gruppe). */
export function lagerAusV3(v) {
  const st = t(v?.stock_status);
  const bo = t(v?.backorders);
  return { lager: Object.values(LAGER).includes(st) ? st : '', rueckstandErlaubt: bo === 'notify' || bo === 'yes' };
}

/**
 * Gruppe einer Variation (BO7-5): stufe = L-Shop-Stufe aus dem Reiter (auch "lieferbar"), info = { lager, rueckstandErlaubt }.
 * Rueckstand zaehlt, wenn der Shop "onbackorder" meldet oder Rueckstand erlaubt ist.
 */
export function gruppeFuer(stufe, info) {
  if (!info?.lager) return '';
  const rueckstand = info.lager === LAGER.RUECKSTAND || Boolean(info.rueckstandErlaubt);
  if (rueckstand && stufe === STUFE.LIEFERBAR) return GRUPPE.RUECKSTAND_LIEFERBAR;
  if (!rueckstand && info.lager === LAGER.VORRAETIG && VORRAETIG_PROBLEM_STUFEN.includes(stufe)) return GRUPPE.VORRAETIG_PROBLEM;
  return '';
}

/** Lagerstatus als Kurztext ("Shop: im Rückstand", "… · Rückstand erlaubt"), unbekannt = ''. */
export function lagerText(v) {
  const s = LAGER_TEXT[v?.lager] ?? '';
  return s && v.rueckstandErlaubt && v.lager !== LAGER.RUECKSTAND ? `${s} · Rückstand erlaubt` : s;
}

/**
 * Reiter-Stand einer Nummer ({ stufe, stock, nullSeit, auslaufdatum } aus lieferbarkeitLesen) -> Problem oder null.
 * nicht gefuehrt und laeuft aus zaehlen sofort, 0 erst ab NULL_AB_TAGE am Stueck (ohne Null_seit nie).
 */
export function problemStufe(l, jetzt = new Date()) {
  if (!l) return null;
  // nicht gefuehrt, laeuft aus und (BO7-4) laeuft aus · schon 0 zaehlen sofort - ohne 14-Tage-Grenze
  if ([STUFE.WEG, STUFE.AUSLAUF, STUFE.AUSLAUF_NULL].includes(l.stufe)) return { stufe: l.stufe, tage: tageSeit(l.nullSeit, jetzt), auslaufdatum: t(l.auslaufdatum), nullSeit: t(l.nullSeit), stock: l.stock };
  if (l.stufe === STUFE.NULL) {
    const tage = tageSeit(l.nullSeit, jetzt);
    return tage !== null && tage >= NULL_AB_TAGE ? { stufe: STUFE.NULL, tage, auslaufdatum: '', nullSeit: t(l.nullSeit), stock: 0 } : null;
  }
  return null;
}

/**
 * Nachfolger fuer eine auslaufende Nummer - nur als Hinweis, nur LIEFERBARE Alternativen (Stufe aus dem Reiter, also nur
 * Nummern, die wir schon nutzen): dasselbe Modell in anderer Farbe (gleiche Groesse) und andere Modelle derselben Marke
 * (gleiche Groesse). modelle = Zeilen aus LShop_Modelle ({ articleNr, catalogNr, farbe, size, marke }).
 */
export function nachfolgerFuer(articleNr, modelle, je) {
  const m = modelle.find(z => t(z.articleNr) === t(articleNr));
  if (!m) return { farben: [], modelle: [] };
  const lieferbar = z => je.get(t(z.articleNr))?.stufe === STUFE.LIEFERBAR;
  const gleicheGroesse = z => t(z.size).toLowerCase() === t(m.size).toLowerCase();
  const farben = [...new Set(modelle.filter(z => t(z.catalogNr) === t(m.catalogNr) && t(z.farbe) !== t(m.farbe) && gleicheGroesse(z) && lieferbar(z)).map(z => t(z.farbe)))].slice(0, NACHFOLGER_MAX);
  const andere = t(m.marke)
    ? [...new Set(modelle.filter(z => t(z.marke) === t(m.marke) && t(z.catalogNr) !== t(m.catalogNr) && gleicheGroesse(z) && lieferbar(z)).map(z => t(z.catalogNr)))].slice(0, NACHFOLGER_MAX)
    : [];
  return { farben, modelle: andere, marke: t(m.marke) };
}

/** Vorschlag je Variation (nur Text). */
export function vorschlagFuer(p, nachfolger = { farben: [], modelle: [] }) {
  if (p.stufe === STUFE.WEG) return 'Variation privat (Löschliste)';
  if (p.stufe === STUFE.NULL) return p.tage >= LIEFERZEIT_PRUEFEN_TAGE ? 'Lieferzeit prüfen' : 'beobachten';
  const teile = [];
  const nf = () => (teile.length ? ` – lieferbar: ${teile.join(' · ')} (nur Hinweis)` : '');
  if (nachfolger.farben?.length) teile.push(`gleiches Modell in ${nachfolger.farben.join(', ')}`);
  if (nachfolger.modelle?.length) teile.push(`${nachfolger.marke ? `${nachfolger.marke}: ` : ''}${nachfolger.modelle.join(', ')}`);
  if (p.stufe === STUFE.AUSLAUF_NULL) return `jetzt handeln: Nachfolger anlegen oder Variation privat (Löschliste) · Lieferzeit prüfen${nf()}`;
  return `Nachfolger suchen${nf()}`;
}

/** Merkmale einer Varianten-Zeile aus E1/V1 … E3/V3 -> { farbe, groesse, text } */
export function merkmale(z) {
  const paare = [1, 2, 3].map(i => [t(z[`E${i}`]), t(z[`V${i}`])]).filter(([e, v]) => e && v);
  const finde = re => paare.find(([e]) => re.test(e))?.[1] ?? '';
  return { farbe: finde(/^farbe$/i), groesse: finde(/^gr(ö|oe)(ß|ss)e$/i), text: paare.map(([, v]) => v).join(' / ') };
}

/** Sortierschluessel: nicht gefuehrt -> laeuft aus (frueheres Datum zuerst, ohne Datum danach) -> 0 am laengsten. */
export function sortSchluessel(v) {
  const aus = v.stufe === STUFE.AUSLAUF || v.stufe === STUFE.AUSLAUF_NULL;
  return [RANG[v.stufe] ?? 9, aus ? (v.auslaufdatum || '9999-99-99') : '', v.stufe === STUFE.NULL ? -(v.tage ?? 0) : 0];
}
const vergleiche = (a, b) => {
  const x = sortSchluessel(a), y = sortSchluessel(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};

/**
 * Problemliste bauen.
 * @param {object} o
 * @param {object[]} o.varianten       Reiter Varianten (SSOT-ID, Aktiv, WC_Variation_ID, LShop_ArticleNr, E1..V3)
 * @param {Map}      o.produktJeSsot   SSOT-ID -> Produkt-ID (Erfassungsmaske)
 * @param {Map}      o.je              ArticleNr -> Lieferbarkeit (lieferbarkeitLesen)
 * @param {Map}      o.produkte        Produkt-ID -> { status, name, permalink, kategorien: string[], lieferzeit }
 * @param {Map}      [o.lieferzeitName] Term-ID -> Name (Struktur_Lieferzeiten)
 * @param {object[]} [o.modelle]       LShop_Modelle-Zeilen fuer Nachfolger
 * @param {Map|null} [o.varStatus]     Variation-ID -> Shop-Status (nur nach "Shop-Status prüfen"), sonst null
 * @param {Map|null} [o.lager]         Variation-ID -> { lager, rueckstandErlaubt } (BO7-5); null = Lagerstatus nicht gelesen
 */
export function baueProblemliste({ varianten, produktJeSsot, je, produkte, lieferzeitName = new Map(), modelle = [], varStatus = null, lager = null, jetzt = new Date() }) {
  const aktiv = varianten.filter(z => /^true$/i.test(t(z.Aktiv)) && t(z.WC_Variation_ID));
  const jeArtikel = new Map();
  const ausgeblendet = { entwurf: 0, privat: 0, inaktiv: 0 };
  for (const z of varianten) {
    if (/^true$/i.test(t(z.Aktiv)) || !NR_RE.test(t(z.LShop_ArticleNr))) continue;
    if (problemStufe(je.get(t(z.LShop_ArticleNr)), jetzt)) ausgeblendet.inaktiv++;
  }
  for (const z of aktiv) {
    const nr = t(z.LShop_ArticleNr);
    if (!NR_RE.test(nr)) continue;
    const l = je.get(nr);
    const info = lager?.get(t(z.WC_Variation_ID)) ?? null;
    let p = problemStufe(l, jetzt);
    const gruppe = gruppeFuer(p?.stufe ?? l?.stufe, info);
    if (!p && gruppe !== GRUPPE.RUECKSTAND_LIEFERBAR) continue;
    if (!p) p = { stufe: STUFE.LIEFERBAR, tage: null, auslaufdatum: '', nullSeit: '', stock: l.stock };   // BO7-5: Gruppe 1
    const pid = t(produktJeSsot.get(t(z['SSOT-ID'])));
    const prod = produkte.get(pid);
    if (!prod || prod.status !== 'publish') { ausgeblendet.entwurf++; continue; }
    const vid = t(z.WC_Variation_ID);
    if (varStatus && varStatus.has(vid) && varStatus.get(vid) !== 'publish') { ausgeblendet.privat++; continue; }
    const m = merkmale(z);
    const nf = p.stufe === STUFE.AUSLAUF || p.stufe === STUFE.AUSLAUF_NULL ? nachfolgerFuer(nr, modelle, je) : undefined;
    if (!jeArtikel.has(pid)) jeArtikel.set(pid, { produktId: pid, ssotId: t(z['SSOT-ID']), variationen: [] });
    jeArtikel.get(pid).variationen.push({
      variationId: vid, articleNr: nr, catalogNr: t(modelle.find(x => t(x.articleNr) === nr)?.catalogNr), farbe: m.farbe, groesse: m.groesse,
      merkmale: m.text, stufe: p.stufe, stock: p.stock ?? null, tage: p.tage, nullSeit: p.nullSeit, auslaufdatum: p.auslaufdatum,
      lager: info?.lager ?? '', rueckstandErlaubt: Boolean(info?.rueckstandErlaubt), gruppe,
      vorschlag: gruppe === GRUPPE.RUECKSTAND_LIEFERBAR ? VORSCHLAG_ZURUECK
        : gruppe === GRUPPE.VORRAETIG_PROBLEM ? `${VORSCHLAG_RUECKSTAND_PRIVAT} · ${vorschlagFuer(p, nf)}` : vorschlagFuer(p, nf),
    });
  }
  const artikel = [...jeArtikel.values()].map(a => {
    const prod = produkte.get(a.produktId);
    const alle = aktiv.filter(z => t(z['SSOT-ID']) === a.ssotId);
    // Farben, bei denen JEDE aktive Groesse betroffen ist
    const betroffenJeFarbe = new Map();
    for (const v of a.variationen) if (v.farbe) betroffenJeFarbe.set(v.farbe, (betroffenJeFarbe.get(v.farbe) ?? 0) + 1);
    const farbenKomplett = [...betroffenJeFarbe].filter(([f, n]) => alle.filter(z => merkmale(z).farbe === f).length === n).map(([f]) => f);
    a.variationen.sort(vergleiche);
    const lz = t(prod.lieferzeit);
    return {
      ...a, name: t(prod.name), permalink: t(prod.permalink), kategorien: prod.kategorien ?? [],
      lieferzeit: lz ? { id: lz, name: lieferzeitName.get(lz) ?? '' } : null,
      gesamt: alle.length, betroffen: a.variationen.length, schonNull: a.variationen.filter(v => v.stufe === STUFE.AUSLAUF_NULL).length, farbenKomplett,
    };
  }).sort((x, y) => vergleiche(x.variationen[0], y.variationen[0]) || x.name.localeCompare(y.name, 'de'));
  const vars = artikel.flatMap(a => a.variationen.map(v => ({ ...v, produktId: a.produktId })));
  const zaehle = st => ({ variationen: vars.filter(v => v.stufe === st).length, artikel: new Set(vars.filter(v => v.stufe === st).map(v => v.produktId)).size });
  const zaehleGruppe = g => ({ variationen: vars.filter(v => v.gruppe === g).length, artikel: new Set(vars.filter(v => v.gruppe === g).map(v => v.produktId)).size });
  return {
    artikel,
    zaehler: {
      artikel: artikel.length, variationen: vars.length,
      [STUFE.WEG]: zaehle(STUFE.WEG), [STUFE.AUSLAUF_NULL]: zaehle(STUFE.AUSLAUF_NULL), [STUFE.AUSLAUF]: zaehle(STUFE.AUSLAUF), [STUFE.NULL]: zaehle(STUFE.NULL),
      [GRUPPE.RUECKSTAND_LIEFERBAR]: zaehleGruppe(GRUPPE.RUECKSTAND_LIEFERBAR), [GRUPPE.VORRAETIG_PROBLEM]: zaehleGruppe(GRUPPE.VORRAETIG_PROBLEM),
      ausgeblendet, shopStatusGeprueft: Boolean(varStatus), lagerGelesen: Boolean(lager),
    },
  };
}

const STUFE_TEXT = { [STUFE.WEG]: 'nicht mehr geführt', [STUFE.AUSLAUF_NULL]: 'läuft aus · schon 0', [STUFE.AUSLAUF]: 'läuft aus', [STUFE.NULL]: 'bei L-Shop 0', [STUFE.LIEFERBAR]: 'bei L-Shop lieferbar' };
const tagDe = s => (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('.') : '');

/** Kurztext der Stufe einer Problem-Variation ("läuft aus bis 31.12.2026", "bei L-Shop 0 seit 01.11.2026 (16 Tage)"). */
export function stufeText(v) {
  if (v.stufe === STUFE.AUSLAUF) return `läuft aus${v.auslaufdatum ? ` bis ${tagDe(v.auslaufdatum)}` : ''}`;
  if (v.stufe === STUFE.AUSLAUF_NULL) return `läuft aus${v.auslaufdatum ? ` bis ${tagDe(v.auslaufdatum)}` : ''} · schon 0${v.nullSeit ? ` seit ${tagDe(v.nullSeit)}` : ''}`;
  if (v.stufe === STUFE.NULL) return `bei L-Shop 0${v.nullSeit ? ` seit ${tagDe(v.nullSeit)}` : ''} (${v.tage} Tage)`;
  if (v.stufe === STUFE.LIEFERBAR && v.stock !== null && v.stock !== undefined) return `bei L-Shop lieferbar (${v.stock})`;
  return STUFE_TEXT[v.stufe] ?? v.stufe;
}

/** "Liste kopieren": Text fuer einen Folgeauftrag - Artikel-ID, Variation-ID, Merkmale, Stufe, Vorschlag. Ohne Preise/Kundendaten. */
export function exportText(liste, { stand = '' } = {}) {
  const kopf = `Lieferbarkeit Shop – ${liste.zaehler.artikel} Artikel, ${liste.zaehler.variationen} Variationen${stand ? ` (Stand ${stand})` : ''}`;
  const zeilen = liste.artikel.flatMap(a => [
    `Artikel ${a.produktId} · ${a.name} · ${a.betroffen} von ${a.gesamt} Variationen${a.schonNull ? ` · ${a.schonNull} davon schon 0` : ''}${a.farbenKomplett.length ? ` · ganze Farbe: ${a.farbenKomplett.join(', ')}` : ''}${a.lieferzeit ? ` · Lieferzeit ${a.lieferzeit.id}${a.lieferzeit.name ? ` (${a.lieferzeit.name})` : ''}` : ''}`,
    ...a.variationen.map(v => `  Variation ${v.variationId} · ${v.merkmale || '–'} · L-Shop ${v.articleNr} · ${stufeText(v)}${lagerText(v) ? ` · ${lagerText(v)}` : ''} · ${v.vorschlag}`),
  ]);
  return [kopf, ...zeilen].join('\n');
}
