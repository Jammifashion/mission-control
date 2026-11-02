// Problemliste "Lieferbarkeit Shop" (BO7-3) - reine Logik, ohne Zugriffe. Ein-/Ausgabe in lib/lieferbarkeitShop.js.
//
// Wer drin ist: aktive Varianten-Zeilen (Aktiv TRUE, WC_Variation_ID, LShop_ArticleNr) eines VEROEFFENTLICHTEN JFN-Artikels,
// deren Rohling bei L-Shop nicht mehr gefuehrt ist (sofort), auf der Auslaufliste steht oder seit >= 14 Tagen am Stueck 0 hat.
// Nur lesen, nur Vorschlaege als Text (Inhaber: nichts automatisch, kundensichtbare Aenderungen nur im eigenen Auftrag).

import { stufeAus, STUFE } from './lshop-lieferbarkeit.js';

export const NULL_AB_TAGE = 14;       // Inhaber 02.11.: Bestand 0 zaehlt erst ab 14 Tagen am Stueck
export const LIEFERZEIT_PRUEFEN_TAGE = 30;
export const NACHFOLGER_MAX = 3;
const TAG_MS = 86_400_000;
const RANG = { [STUFE.WEG]: 0, [STUFE.AUSLAUF]: 1, [STUFE.NULL]: 2 };
const t = v => String(v ?? '').trim();
const NR_RE = /^\d{10}$/;

/** Ganze Tage seit einem Zeitpunkt (ISO), sonst null. */
export function tageSeit(iso, jetzt = new Date()) {
  const d = Date.parse(t(iso));
  return Number.isFinite(d) ? Math.floor((jetzt.getTime() - d) / TAG_MS) : null;
}

/**
 * Reiter-Stand einer Nummer ({ stufe, stock, nullSeit, auslaufdatum } aus lieferbarkeitLesen) -> Problem oder null.
 * nicht gefuehrt und laeuft aus zaehlen sofort, 0 erst ab NULL_AB_TAGE am Stueck (ohne Null_seit nie).
 */
export function problemStufe(l, jetzt = new Date()) {
  if (!l) return null;
  if (l.stufe === STUFE.WEG || l.stufe === STUFE.AUSLAUF) return { stufe: l.stufe, tage: tageSeit(l.nullSeit, jetzt), auslaufdatum: t(l.auslaufdatum), nullSeit: t(l.nullSeit), stock: l.stock };
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
  if (nachfolger.farben?.length) teile.push(`gleiches Modell in ${nachfolger.farben.join(', ')}`);
  if (nachfolger.modelle?.length) teile.push(`${nachfolger.marke ? `${nachfolger.marke}: ` : ''}${nachfolger.modelle.join(', ')}`);
  return `Nachfolger suchen${teile.length ? ` – lieferbar: ${teile.join(' · ')} (nur Hinweis)` : ''}`;
}

/** Merkmale einer Varianten-Zeile aus E1/V1 … E3/V3 -> { farbe, groesse, text } */
export function merkmale(z) {
  const paare = [1, 2, 3].map(i => [t(z[`E${i}`]), t(z[`V${i}`])]).filter(([e, v]) => e && v);
  const finde = re => paare.find(([e]) => re.test(e))?.[1] ?? '';
  return { farbe: finde(/^farbe$/i), groesse: finde(/^gr(ö|oe)(ß|ss)e$/i), text: paare.map(([, v]) => v).join(' / ') };
}

/** Sortierschluessel: nicht gefuehrt -> laeuft aus (frueheres Datum zuerst, ohne Datum danach) -> 0 am laengsten. */
export function sortSchluessel(v) {
  return [RANG[v.stufe] ?? 9, v.stufe === STUFE.AUSLAUF ? (v.auslaufdatum || '9999-99-99') : '', v.stufe === STUFE.NULL ? -(v.tage ?? 0) : 0];
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
 */
export function baueProblemliste({ varianten, produktJeSsot, je, produkte, lieferzeitName = new Map(), modelle = [], varStatus = null, jetzt = new Date() }) {
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
    const p = problemStufe(je.get(nr), jetzt);
    if (!p) continue;
    const pid = t(produktJeSsot.get(t(z['SSOT-ID'])));
    const prod = produkte.get(pid);
    if (!prod || prod.status !== 'publish') { ausgeblendet.entwurf++; continue; }
    const vid = t(z.WC_Variation_ID);
    if (varStatus && varStatus.has(vid) && varStatus.get(vid) !== 'publish') { ausgeblendet.privat++; continue; }
    const m = merkmale(z);
    const nf = p.stufe === STUFE.AUSLAUF ? nachfolgerFuer(nr, modelle, je) : undefined;
    if (!jeArtikel.has(pid)) jeArtikel.set(pid, { produktId: pid, ssotId: t(z['SSOT-ID']), variationen: [] });
    jeArtikel.get(pid).variationen.push({
      variationId: vid, articleNr: nr, catalogNr: t(modelle.find(x => t(x.articleNr) === nr)?.catalogNr), farbe: m.farbe, groesse: m.groesse,
      merkmale: m.text, stufe: p.stufe, tage: p.tage, nullSeit: p.nullSeit, auslaufdatum: p.auslaufdatum, vorschlag: vorschlagFuer(p, nf),
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
      gesamt: alle.length, betroffen: a.variationen.length, farbenKomplett,
    };
  }).sort((x, y) => vergleiche(x.variationen[0], y.variationen[0]) || x.name.localeCompare(y.name, 'de'));
  const vars = artikel.flatMap(a => a.variationen.map(v => ({ ...v, produktId: a.produktId })));
  const zaehle = st => ({ variationen: vars.filter(v => v.stufe === st).length, artikel: new Set(vars.filter(v => v.stufe === st).map(v => v.produktId)).size });
  return {
    artikel,
    zaehler: {
      artikel: artikel.length, variationen: vars.length,
      [STUFE.WEG]: zaehle(STUFE.WEG), [STUFE.AUSLAUF]: zaehle(STUFE.AUSLAUF), [STUFE.NULL]: zaehle(STUFE.NULL),
      ausgeblendet, shopStatusGeprueft: Boolean(varStatus),
    },
  };
}

const STUFE_TEXT = { [STUFE.WEG]: 'nicht mehr geführt', [STUFE.AUSLAUF]: 'läuft aus', [STUFE.NULL]: 'bei L-Shop 0' };
const tagDe = s => (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('.') : '');

/** Kurztext der Stufe einer Problem-Variation ("läuft aus bis 31.12.2026", "bei L-Shop 0 seit 01.11.2026 (16 Tage)"). */
export function stufeText(v) {
  if (v.stufe === STUFE.AUSLAUF) return `läuft aus${v.auslaufdatum ? ` bis ${tagDe(v.auslaufdatum)}` : ''}`;
  if (v.stufe === STUFE.NULL) return `bei L-Shop 0${v.nullSeit ? ` seit ${tagDe(v.nullSeit)}` : ''} (${v.tage} Tage)`;
  return STUFE_TEXT[v.stufe] ?? v.stufe;
}

/** "Liste kopieren": Text fuer einen Folgeauftrag - Artikel-ID, Variation-ID, Merkmale, Stufe, Vorschlag. Ohne Preise/Kundendaten. */
export function exportText(liste, { stand = '' } = {}) {
  const kopf = `Lieferbarkeit Shop – ${liste.zaehler.artikel} Artikel, ${liste.zaehler.variationen} Variationen${stand ? ` (Stand ${stand})` : ''}`;
  const zeilen = liste.artikel.flatMap(a => [
    `Artikel ${a.produktId} · ${a.name} · ${a.betroffen} von ${a.gesamt} Variationen${a.farbenKomplett.length ? ` · ganze Farbe: ${a.farbenKomplett.join(', ')}` : ''}${a.lieferzeit ? ` · Lieferzeit ${a.lieferzeit.id}${a.lieferzeit.name ? ` (${a.lieferzeit.name})` : ''}` : ''}`,
    ...a.variationen.map(v => `  Variation ${v.variationId} · ${v.merkmale || '–'} · L-Shop ${v.articleNr} · ${stufeText(v)} · ${v.vorschlag}`),
  ]);
  return [kopf, ...zeilen].join('\n');
}
