// Vorschlaege fuer die Erfassungsmaske (Befehl M8) - deterministisch, kein Modell.
//
//  - Kurzbezeichnung: Praefix = haeufigstes Praefix ("CH-", "BL-") in der
//    Erfassungsmaske, zuerst je DIREKTER Kategorie des Artikels (M8b: unter
//    "Kuenstler und Marken" hat jeder Kuenstler sein eigenes). Erst wenn dort
//    keins steht, das der Hauptkategorie - aber nur, wenn es dort fuer die
//    ganze Hauptkategorie gilt: es steht an der Hauptkategorie selbst oder in
//    mindestens zwei ihrer Unterkategorien. Ein Praefix, das nur in 670 Malle
//    Prinz vorkommt, gilt damit nicht fuer einen anderen Kuenstler. Doppelte
//    Kategorienamen zaehlen nicht als direkte Kategorie (die Erfassungsmaske
//    speichert Namen, keine Nummern). Dazu das erste kennzeichnende Wort
//    des Namens (ohne Woerter aus Haupt-/gewaehlten Kategorien und Fuellwoerter),
//    CamelCase, Regeln aus lib/sku.js (3-20 Zeichen, A-Z a-z 0-9 -). Eindeutig
//    gegen Erfassungsmaske und Motive, bei Kollision Ziffer anhaengen.
//    Nachtrag M8 (antwort-M8-1): ist das erste Wort kuerzer als 6 Buchstaben,
//    kommt das zweite klein und ohne Bindestrich dazu - "Match Day Cap" ->
//    "Matchday" (so hat der Inhaber die Cap selbst benannt).
//  - Versandklasse: die Klasse, die die meisten veroeffentlichten Artikel mit
//    derselben L-Shop-Modellnummer tragen; ohne Treffer "paket".
//    Gleichstand: "paket", falls darunter, sonst alphabetisch erste.
//    Modell der SKU (M8b, modellAusSku): fuehrender Token bis zum ersten "/",
//    "_", "-" oder Leerzeichen, Altpraefix "KING"/"Queen" davor uebersprungen;
//    zaehlt nur, wenn der Token eine CatalogNr in LShop_Modelle ist ("BG42_Delfin",
//    "BG42 Deutsches ECK", "BG42-SCALA"). Die alte Regel "SKU vor '/'" gilt
//    daneben weiter, damit Modelle, die noch nicht in LShop_Modelle stehen, nicht
//    verloren gehen (JC092, JH030 ...).
//
// Nur Vorschlaege: die Maske ueberschreibt nie Getipptes.

import { leseReiterSpalten, reiterCache } from './ssot-reiter.js';
import { getWcClient } from './shopConfig.js';
import { KURZ_MIN, KURZ_MAX, KURZ_RE } from './sku.js';
import { ladeLShopZeilen } from './lshop.js';

export const VERSAND_STANDARD = 'paket';
const PRAEFIX_RE = /^([A-Z]{2,4})-/;
export const KURZ_ERSTES_WORT_MIN = 6;
const FUELL = new Set(['der', 'die', 'das', 'und', 'mit', 'für', 'fuer', 'von', 'im', 'in', 'am', 'the', 'a', '&', '–', '-', '+']);

const t = v => String(v ?? '').trim();

// ── Reine Logik (backend/tests/vorschlaege.test.js) ─────────────────────────

/** Hauptkategorie = erster Teil des Pfads ("Crocodiles Hamburg > Accessoires"). */
export function hauptkategorieVon(pfad) {
  return t(String(pfad ?? '').split('>')[0]);
}

/**
 * Haeufigstes Praefix je Hauptkategorie.
 * @param {object[]} erfassung [{ kurz, kategorien: "Name, Name" }]
 * @param {object[]} kategorien [{ nr, pfad, name }]
 * @returns {Map<string, {praefix: string, anzahl: number}>}
 */
export function praefixeJeHauptkategorie(erfassung, kategorien) {
  const raus = new Map();
  for (const [h, zm] of praefixZaehlung(erfassung, kategorien).haupt) {
    const [praefix, { anzahl }] = [...zm].sort((a, b) => b[1].anzahl - a[1].anzahl || a[0].localeCompare(b[0]))[0];
    raus.set(h, { praefix, anzahl });
  }
  return raus;
}

// Zeilen mit Praefix zaehlen: je Hauptkategorie (mit den direkten Kategorien,
// in denen es vorkommt) und je direkter Kategorie (Name klein).
function praefixZaehlung(erfassung, kategorien) {
  const pfadVonName = new Map((kategorien ?? []).map(k => [t(k.name).toLowerCase(), t(k.pfad)]));
  const haupt  = new Map();                        // haupt -> Map(praefix -> { anzahl, direkt: Set })
  const direkt = new Map();                        // name klein -> Map(praefix -> n)
  for (const z of erfassung ?? []) {
    const m = PRAEFIX_RE.exec(t(z.kurz));
    if (!m) continue;
    const p = m[1] + '-';
    const namen = [...new Set(String(z.kategorien ?? '').split(',').map(s => t(s)).filter(Boolean))];
    const jeHaupt = new Map();                     // haupt -> Set(direkte Namen dieser Zeile)
    for (const n of namen) {
      const h = hauptkategorieVon(pfadVonName.get(n.toLowerCase()) ?? n);
      if (!jeHaupt.has(h)) jeHaupt.set(h, new Set());
      jeHaupt.get(h).add(n);
      const k = n.toLowerCase();
      if (!direkt.has(k)) direkt.set(k, new Map());
      direkt.get(k).set(p, (direkt.get(k).get(p) ?? 0) + 1);
    }
    for (const [h, dn] of jeHaupt) {
      if (!haupt.has(h)) haupt.set(h, new Map());
      const e = haupt.get(h).get(p) ?? { anzahl: 0, direkt: new Set() };
      e.anzahl++;
      for (const n of dn) e.direkt.add(n);
      haupt.get(h).set(p, e);
    }
  }
  return { haupt, direkt };
}

const bestes = eintraege => [...eintraege].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

/**
 * Praefix fuer die gewaehlten Kategorien (M8b): erst je direkter Kategorie,
 * dann die Hauptkategorie - nur wenn das Praefix dort fuer die ganze
 * Hauptkategorie gilt (an ihr selbst oder in mindestens zwei Unterkategorien).
 * @param {object[]} erfassung  [{ kurz, kategorien: "Name, Name" }]
 * @param {object[]} kategorien [{ nr, pfad, name }] (Struktur_Kategorien)
 * @param {object[]} gewaehlt   die Kategorien des Artikels, gleiche Form
 * @returns {{ praefix: string, anzahl: number, ebene: 'kategorie'|'hauptkategorie', in: string }|null}
 */
export function praefixFuerKategorien(erfassung, kategorien, gewaehlt) {
  const { haupt, direkt } = praefixZaehlung(erfassung, kategorien);
  const namenZahl = new Map();
  for (const k of kategorien ?? []) { const n = t(k.name).toLowerCase(); namenZahl.set(n, (namenZahl.get(n) ?? 0) + 1); }

  const summe = new Map(), inNamen = new Map();
  for (const k of gewaehlt ?? []) {
    const n = t(k.name).toLowerCase();
    if (namenZahl.get(n) !== 1) continue;          // doppelter Name: nicht eindeutig
    for (const [p, a] of direkt.get(n) ?? []) {
      summe.set(p, (summe.get(p) ?? 0) + a);
      if (!inNamen.has(p)) inNamen.set(p, []);
      inNamen.get(p).push(t(k.name));
    }
  }
  if (summe.size) {
    const [praefix, anzahl] = bestes(summe);
    return { praefix, anzahl, ebene: 'kategorie', in: inNamen.get(praefix).join(', ') };
  }

  const h = (gewaehlt ?? []).map(k => hauptkategorieVon(k.pfad)).find(Boolean) ?? '';
  const zm = haupt.get(h);
  if (!zm) return null;
  const gilt = [...zm].filter(([, e]) => [...e.direkt].some(n => n.toLowerCase() === h.toLowerCase()) || e.direkt.size >= 2);
  if (!gilt.length) return null;
  const [praefix, anzahl] = bestes(gilt.map(([p, e]) => [p, e.anzahl]));
  return { praefix, anzahl, ebene: 'hauptkategorie', in: h };
}

// "T-Shirt" -> "TShirt", "Größe" -> "Groesse"; nur A-Z a-z 0-9.
function camel(wort) {
  const w = String(wort)
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
  return w;
}

/**
 * Kurzbezeichnung vorschlagen.
 * @param {object} o
 * @param {string} o.name            Produktname
 * @param {string} o.praefix         z. B. "CH-" oder ''
 * @param {string[]} o.ausschluss    Kategorie-/Vereinsnamen (Woerter daraus fallen weg)
 * @param {Iterable<string>} o.belegt bestehende Kurzbezeichnungen (Gross/Klein egal)
 * @returns {{ wert: string|null, hinweis: string|null }}
 */
export function kurzVorschlag({ name, praefix = '', ausschluss = [], belegt = [] } = {}) {
  const weg = new Set(ausschluss.flatMap(a => String(a).toLowerCase().split(/[\s>/,]+/)).filter(Boolean));
  const woerter = String(name ?? '').split(/\s+/).map(s => s.trim()).filter(Boolean)
    .filter(w => !FUELL.has(w.toLowerCase()) && !weg.has(w.toLowerCase()));
  let basis = camel(woerter[0] ?? '');
  // Kurzes erstes Wort: zweites Wort klein anhaengen ("Match" + "day").
  if (basis && basis.length < KURZ_ERSTES_WORT_MIN && woerter[1]) basis += camel(woerter[1]).toLowerCase();
  // Immer noch unter der SKU-Mindestlaenge: weitere Woerter wie bisher.
  for (let i = 2; basis && (praefix + basis).length < KURZ_MIN && i < woerter.length; i++) basis += camel(woerter[i]);
  if (!basis) return { wert: null, hinweis: 'Kein kennzeichnendes Wort im Namen – Kurzbezeichnung bitte selbst setzen.' };
  let kern = (praefix + basis).slice(0, KURZ_MAX);
  const frei = new Set([...belegt].map(b => t(b).toLowerCase()));
  let wert = kern, n = 2;
  while (frei.has(wert.toLowerCase())) {
    const zusatz = String(n++);
    wert = kern.slice(0, KURZ_MAX - zusatz.length) + zusatz;
  }
  if (wert.length < KURZ_MIN || !KURZ_RE.test(wert))
    return { wert: null, hinweis: `Vorschlag "${wert}" verletzt die SKU-Regeln – bitte selbst setzen.` };
  return { wert, hinweis: null };
}

const ALTPRAEFIX_RE = /^(king|queen)[\s/_-]+/i;

/**
 * L-Shop-Modell aus einer SKU (M8b): fuehrender Token bis "/", "_", "-" oder
 * Leerzeichen, "KING "/"Queen " davor uebersprungen. Nur ein Token, der als
 * CatalogNr im Katalog steht, zaehlt.
 * @param {string} sku
 * @param {Iterable<string>} katalog CatalogNr aus LShop_Modelle
 * @returns {string|null} CatalogNr in Katalog-Schreibweise
 */
export function modellAusSku(sku, katalog) {
  const token = t(sku).replace(ALTPRAEFIX_RE, '').split(/[\s/_-]/)[0].toLowerCase();
  if (!token) return null;
  for (const c of katalog ?? []) if (t(c).toLowerCase() === token) return t(c);
  return null;
}

/**
 * Versandklasse je L-Shop-Modell aus veroeffentlichten Artikeln.
 * @param {object[]} produkte [{ sku, shipping_class }]
 * @param {string} modell     L-Shop-Nummer, z. B. "CB166R"
 * @param {object} [o]
 * @param {Iterable<string>} [o.katalog] CatalogNr aus LShop_Modelle; ohne nur "SKU vor '/'"
 * @returns {{ klasse: string, quelle: string, verteilung: object }}
 */
export function versandVorschlag(produkte, modell, { katalog } = {}) {
  const m = t(modell).toLowerCase();
  const verteilung = {};
  if (m) {
    for (const p of produkte ?? []) {
      const sku = t(p.sku);
      const i = sku.indexOf('/');
      const alt = i >= 1 && sku.slice(0, i).trim().toLowerCase() === m;
      if (!alt && (modellAusSku(sku, katalog) ?? '').toLowerCase() !== m) continue;
      const k = t(p.shipping_class);
      if (k) verteilung[k] = (verteilung[k] ?? 0) + 1;
    }
  }
  const eintraege = Object.entries(verteilung);
  if (!eintraege.length) {
    return {
      klasse: VERSAND_STANDARD,
      quelle: m ? `Kein veröffentlichter Artikel mit Modell ${t(modell)} – Standard "${VERSAND_STANDARD}".`
                : `Kein L-Shop-Modell – Standard "${VERSAND_STANDARD}".`,
      verteilung,
    };
  }
  const max = Math.max(...eintraege.map(([, n]) => n));
  const beste = eintraege.filter(([, n]) => n === max).map(([k]) => k).sort();
  const klasse = beste.includes(VERSAND_STANDARD) ? VERSAND_STANDARD : beste[0];
  const summe = eintraege.reduce((a, [, n]) => a + n, 0);
  return {
    klasse,
    quelle: `Aus ${max} von ${summe} veröffentlichten Artikeln mit Modell ${t(modell)}`
      + (eintraege.length > 1 ? ` (gemischt: ${eintraege.map(([k, n]) => `${k} ${n}`).join(', ')})` : '') + '.',
    verteilung,
  };
}

// ── Lesen ───────────────────────────────────────────────────────────────────

const cache = reiterCache(10 * 60 * 1000);
export function _resetVorschlagCache() { cache.leeren(); }

const sid = () => process.env.GOOGLE_SHEET_ID;
const ladeErfassung = () => cache.hole(`erf|${sid()}`, () => leseReiterSpalten({
  tab: 'Erfassungsmaske', spalten: { kurz: 'Artikelkurzbezeichnung', kategorien: 'Kategorien' } }));
const ladeKategorien = () => cache.hole(`kat|${sid()}`, () => leseReiterSpalten({
  tab: 'Struktur_Kategorien', spalten: { nr: 'Kategorienummer', pfad: 'Kategorien', name: 'Kategoriename' } }));
const ladeMotivKurz = () => cache.hole(`mot|${sid()}`, () => leseReiterSpalten({
  tab: 'Motive', spalten: { kurz: 'Artikelkurzbezeichnung' } }));

// Veroeffentlichte Artikel (SKU + Versandklasse), gecacht.
const ladeProdukte = (shop) => cache.hole(`wc|${shop ?? 'jfn'}`, async () => {
  const wc = getWcClient(shop);
  const out = [];
  for (let page = 1; ; page++) {
    const { data } = await wc.get('products', { status: 'publish', per_page: 100, page, _fields: 'id,sku,shipping_class' });
    out.push(...(Array.isArray(data) ? data : []));
    if (!Array.isArray(data) || data.length < 100) break;
  }
  return out;
});

/**
 * Beide Vorschlaege fuer die Maske. Jeder Teil fuer sich: ein Lesefehler
 * steht im Teil als `fehler`, der andere kommt trotzdem.
 * @param {object} o { name, kategorieIds: string[], lshopNr, shop }
 */
export async function maskenVorschlaege({ name, kategorieIds = [], lshopNr, shop } = {}) {
  const raus = { kurz: null, versand: null };

  if (t(name) && kategorieIds.length) {
    try {
      const [erf, kat, mot] = await Promise.all([ladeErfassung(), ladeKategorien(), ladeMotivKurz()]);
      const gewaehlt = kategorieIds.map(id => kat.find(k => t(k.nr) === t(id))).filter(Boolean);
      const haupt = gewaehlt.map(k => hauptkategorieVon(k.pfad)).find(Boolean) ?? '';
      const p = praefixFuerKategorien(erf, kat, gewaehlt);
      const ausschluss = [haupt, ...gewaehlt.map(k => k.name)];
      const v = kurzVorschlag({
        name, praefix: p?.praefix ?? '', ausschluss,
        belegt: [...erf.map(z => z.kurz), ...mot.map(z => z.kurz)],
      });
      const direkt = gewaehlt.map(k => k.name).join(', ');
      raus.kurz = {
        ...v, hauptkategorie: haupt, praefix: p?.praefix ?? '', praefixEbene: p?.ebene ?? null,
        quelle: p ? `Präfix ${p.praefix} (${p.anzahl}× in ${p.in})`
                  : `Kein Präfix für ${direkt || haupt || 'die Kategorie'}${haupt && haupt !== direkt ? ` / ${haupt}` : ''}`,
      };
    } catch (e) { raus.kurz = { wert: null, fehler: e.message }; }
  }

  try {
    // Ohne lesbaren Katalog nur die alte Regel "SKU vor '/'" (kein Abbruch).
    let katalog = null;
    try { katalog = new Set((await ladeLShopZeilen()).map(z => z.catalogNr).filter(Boolean)); } catch { /* s. o. */ }
    raus.versand = versandVorschlag(await ladeProdukte(shop), lshopNr, { katalog });
  } catch (e) { raus.versand = { klasse: VERSAND_STANDARD, quelle: `Shop nicht lesbar – Standard "${VERSAND_STANDARD}".`, fehler: e.message }; }

  return raus;
}
