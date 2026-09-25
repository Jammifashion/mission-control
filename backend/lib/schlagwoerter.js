// Schlagwoerter (WooCommerce product_tag) fuer den SEO-Generator (Befehl M8).
//
//  - Liste der vorhandenen Schlagwoerter (nach Nutzung sortiert) geht als
//    Auswahl in den Prompt: vorhandene werden bevorzugt.
//  - Die Modell-Vorschlaege (3-5) werden hier normalisiert: vorhandene
//    Schreibweise und ID, sonst "neu". Jedes laeuft durch die Regeln 1-3 der
//    Pruefung (Nur_intern, Marke/Modellnummer, feste Liste) - Treffer werden
//    markiert und nicht vorausgewaehlt.
//  - Schreiben: ein tags-Array im WooCommerce-PUT ERSETZT alle Schlagwoerter.
//    tagsFuerPut() baut darum immer die ganze Liste (vorhandene + behaltene).
//
// Schlagwort-Archive stehen in Yoast auf "noindex, follow" (gemessen 25.09.
// an /produkt-schlagwort/shirt|crocodiles-hamburg|hoodie/).

import { getWcClient } from './shopConfig.js';
import { reiterCache } from './ssot-reiter.js';
import { sperrTreffer } from './seo-pruefung.js';

export const SCHLAGWORT_MIN = 3;
export const SCHLAGWORT_MAX = 5;
// Nachtrag M8 (antwort-M8-1): hoechstens 2 NEUE je Artikel, vorhandene bis zusammen 5.
export const SCHLAGWORT_NEU_MAX = 2;
export const PROMPT_LISTE_MAX = 80;

const t = v => String(v ?? '').trim();
const norm = v => t(v).toLowerCase().replace(/\s+/g, ' ');

// ── Reine Logik (backend/tests/schlagwoerter.test.js) ───────────────────────

/** Namen fuer den Prompt: meistgenutzte zuerst, ohne ungenutzte. */
export function promptListe(vorhandene, max = PROMPT_LISTE_MAX) {
  return [...(vorhandene ?? [])].filter(x => (x.count ?? 0) > 0)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || t(a.name).localeCompare(t(b.name)))
    .slice(0, max).map(x => t(x.name));
}

/**
 * Modell-Vorschlaege normalisieren.
 * @param {string[]} roh           Vorschlaege aus der Modellantwort
 * @param {object[]} vorhandene    [{ id, name, slug }]
 * @param {object}   pruefKontext  wie sperrTreffer (nurIntern, marken, modellnummern, …)
 * Gesperrte (Pruefung schlaegt an) stehen zur Anzeige in der Liste, zaehlen
 * aber nicht mit. Zaehlt: hoechstens SCHLAGWORT_NEU_MAX neue, zusammen
 * hoechstens SCHLAGWORT_MAX. Weitere fallen weg und stehen in `hinweise`.
 *
 * @returns {{ liste: { name: string, id: number|null, neu: boolean, pruefung: string[], vorausgewaehlt: boolean }[],
 *             hinweise: string[] }}
 */
export function schlagwortVorschlaege(roh, vorhandene, pruefKontext = {}) {
  const eingang = Array.isArray(roh) ? roh : String(roh ?? '').split(',');
  const liste = [];
  const weg = [];
  let gueltig = 0, neue = 0;
  for (const r of eingang) {
    const name = t(r);
    if (!name || liste.some(x => norm(x.name) === norm(name)) || weg.some(x => norm(x.name) === norm(name))) continue;
    const treffer = (vorhandene ?? []).find(v => norm(v.name) === norm(name) || norm(v.slug) === norm(name));
    const pruefung = sperrTreffer(name, pruefKontext);
    const eintrag = {
      name: treffer ? t(treffer.name) : name,
      id: treffer ? treffer.id : null,
      neu: !treffer,
      pruefung,
      vorausgewaehlt: pruefung.length === 0,
    };
    if (pruefung.length) { liste.push(eintrag); continue; }
    if (gueltig >= SCHLAGWORT_MAX) { weg.push({ ...eintrag, grund: `mehr als ${SCHLAGWORT_MAX}` }); continue; }
    if (eintrag.neu && neue >= SCHLAGWORT_NEU_MAX) { weg.push({ ...eintrag, grund: `mehr als ${SCHLAGWORT_NEU_MAX} neue` }); continue; }
    liste.push(eintrag);
    gueltig++;
    if (eintrag.neu) neue++;
  }
  const hinweise = weg.map(x => `Schlagwort "${x.name}" weggelassen (${x.grund}).`);
  return { liste, hinweise };
}

/**
 * tags-Array fuer den WooCommerce-PUT: IMMER die ganze Liste, weil das Array
 * alle Schlagwoerter ersetzt. Vorhandene per id, neue per name.
 * @param {{id?: number, name: string}[]} auswahl  Chips im SEO-Reiter
 */
export function tagsFuerPut(auswahl) {
  const raus = [];
  for (const x of auswahl ?? []) {
    const name = t(x?.name);
    if (x?.id) { if (!raus.some(r => r.id === x.id)) raus.push({ id: x.id }); }
    else if (name && !raus.some(r => r.name && norm(r.name) === norm(name))) raus.push({ name });
  }
  return raus;
}

// ── Lesen ───────────────────────────────────────────────────────────────────

const cache = reiterCache(10 * 60 * 1000);
export function _resetSchlagwortCache() { cache.leeren(); }

export function ladeSchlagwoerter(shop) {
  return cache.hole(`tags|${shop ?? 'jfn'}`, async () => {
    const wc = getWcClient(shop);
    const out = [];
    for (let page = 1; ; page++) {
      const { data } = await wc.get('products/tags', { per_page: 100, page });
      out.push(...(Array.isArray(data) ? data : []).map(x => ({ id: x.id, name: x.name, slug: x.slug, count: x.count })));
      if (!Array.isArray(data) || data.length < 100) break;
    }
    return out;
  });
}
