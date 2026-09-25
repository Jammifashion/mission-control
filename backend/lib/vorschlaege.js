// Vorschlaege fuer die Erfassungsmaske (Befehl M8) - deterministisch, kein Modell.
//
//  - Kurzbezeichnung: Praefix = haeufigstes Praefix ("CH-", "BL-") der
//    Hauptkategorie in der Erfassungsmaske, dazu das erste kennzeichnende Wort
//    des Namens (ohne Woerter aus Haupt-/gewaehlten Kategorien und Fuellwoerter),
//    CamelCase, Regeln aus lib/sku.js (3-20 Zeichen, A-Z a-z 0-9 -). Eindeutig
//    gegen Erfassungsmaske und Motive, bei Kollision Ziffer anhaengen.
//  - Versandklasse: die Klasse, die die meisten veroeffentlichten Artikel mit
//    derselben L-Shop-Modellnummer (SKU vor "/") tragen; ohne Treffer "paket".
//    Gleichstand: "paket", falls darunter, sonst alphabetisch erste.
//
// Nur Vorschlaege: die Maske ueberschreibt nie Getipptes.

import { leseReiterSpalten, reiterCache } from './ssot-reiter.js';
import { getWcClient } from './shopConfig.js';
import { KURZ_MIN, KURZ_MAX, KURZ_RE } from './sku.js';

export const VERSAND_STANDARD = 'paket';
const PRAEFIX_RE = /^([A-Z]{2,4})-/;
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
  const pfadVonName = new Map((kategorien ?? []).map(k => [t(k.name).toLowerCase(), t(k.pfad)]));
  const zaehler = new Map();                       // haupt -> Map(praefix -> n)
  for (const z of erfassung ?? []) {
    const m = PRAEFIX_RE.exec(t(z.kurz));
    if (!m) continue;
    const haupt = new Set(String(z.kategorien ?? '').split(',').map(s => t(s)).filter(Boolean)
      .map(n => hauptkategorieVon(pfadVonName.get(n.toLowerCase()) ?? n)));
    for (const h of haupt) {
      if (!zaehler.has(h)) zaehler.set(h, new Map());
      const zm = zaehler.get(h);
      zm.set(m[1] + '-', (zm.get(m[1] + '-') ?? 0) + 1);
    }
  }
  const raus = new Map();
  for (const [h, zm] of zaehler) {
    const [praefix, anzahl] = [...zm].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    raus.set(h, { praefix, anzahl });
  }
  return raus;
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
  let basis = '';
  for (const w of woerter) {
    basis += camel(w);
    if ((praefix + basis).length >= KURZ_MIN) break;
  }
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

/**
 * Versandklasse je L-Shop-Modell aus veroeffentlichten Artikeln.
 * @param {object[]} produkte [{ sku, shipping_class }]
 * @param {string} modell     L-Shop-Nummer, z. B. "CB166R"
 * @returns {{ klasse: string, quelle: string, verteilung: object }}
 */
export function versandVorschlag(produkte, modell) {
  const m = t(modell).toLowerCase();
  const verteilung = {};
  if (m) {
    for (const p of produkte ?? []) {
      const sku = t(p.sku);
      const i = sku.indexOf('/');
      if (i < 1 || sku.slice(0, i).trim().toLowerCase() !== m) continue;
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
      const p = praefixeJeHauptkategorie(erf, kat).get(haupt);
      const ausschluss = [haupt, ...gewaehlt.map(k => k.name)];
      const v = kurzVorschlag({
        name, praefix: p?.praefix ?? '', ausschluss,
        belegt: [...erf.map(z => z.kurz), ...mot.map(z => z.kurz)],
      });
      raus.kurz = {
        ...v, hauptkategorie: haupt, praefix: p?.praefix ?? '',
        quelle: p ? `Präfix ${p.praefix} (${p.anzahl}× in ${haupt})` : `Kein Präfix für ${haupt || 'die Kategorie'}`,
      };
    } catch (e) { raus.kurz = { wert: null, fehler: e.message }; }
  }

  try {
    raus.versand = versandVorschlag(await ladeProdukte(shop), lshopNr);
  } catch (e) { raus.versand = { klasse: VERSAND_STANDARD, quelle: `Shop nicht lesbar – Standard "${VERSAND_STANDARD}".`, fehler: e.message }; }

  return raus;
}
