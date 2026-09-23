// Reihenfolge der Groessen - EINE Stelle fuer Rang und Sortierung.
//
// Anlass (Befehl R, 23.09.): Oldschool T-Shirt Herren (E3000) stand in
// WooCommerce mit Groesse = [4XL, 3XL, 2XL, XL, L, M, S, XS, 5XL]. Die Groesse
// ist dort ein LOKALES Attribut (id 0); das Auswahlfeld im Shop folgt dann der
// Reihenfolge von attributes[].options. Der Aenderungspfad baute die Optionen
// aus GET products/<id>/variations - und das liefert neueste zuerst.
//
// index.html spiegelt die reine Logik im Block "Groessen: Anfang" (Muster
// sku.js), backend/tests/groessen.test.js prueft beide auf gleiche Ergebnisse.
// seo-meta.js (Groessenspanne) benutzt denselben Rang.

import { istFarbAchse } from './varianten-achsen.js';

// Achsennamen der Groesse. Exakt (Gross/Klein egal), kein Teilstring:
// "Schuhgröße" ist eine eigene Achse.
const GROESSEN_ACHSEN = ['größe', 'groesse', 'grösse'];

export function istGroessenAchse(name) {
  return GROESSEN_ACHSEN.includes(String(name ?? '').trim().toLowerCase());
}

// Rang einer Groesse. Buchstaben: S=3, M=4, L=5, XL=6, 2XL/XXL=7 …, XS=2,
// 2XS/XXS=1. Zahlen (Kinder, Konfektion): eigene Klasse, "110/116" zaehlt mit
// der ersten Zahl. Alles andere ("One Size", "Einheitsgröße") -> null.
export function groessenRang(wert) {
  const g = String(wert ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (g === 'M') return { klasse: 'buchstabe', rang: 4 };
  // "4XL" = Ziffer + X, "XXL" = X-Folge; beide zaehlen die X.
  let t = g.match(/^(?:(\d+)X|(X*))(S|L)$/);
  if (t) {
    const n = t[1] ? Number(t[1]) : t[2].length;
    if (t[1] && n < 2) return null;                       // "1XL" gibt es nicht
    return { klasse: 'buchstabe', rang: t[3] === 'L' ? 5 + n : 3 - n };
  }
  t = g.match(/^(\d{1,3})(?:[/-]\d{1,3})?$/);
  if (t) return { klasse: 'zahl', rang: Number(t[1]) };
  return null;
}

const KLASSEN = ['buchstabe', 'zahl'];

/**
 * Groessen aufsteigend: Buchstaben (XXS … 8XL), dann Zahlen (110/116 …).
 * Gleicher Rang (2XL und XXL) und Unbekanntes behalten die Eingabereihenfolge;
 * Unbekanntes steht am Ende und wird gemeldet.
 *
 * @returns {{ sortiert: string[], unbekannt: string[], hinweis: string|null }}
 */
export function sortiereGroessen(werte) {
  const liste = (Array.isArray(werte) ? werte : []).map(w => String(w ?? ''));
  const bekannt = [], unbekannt = [];
  liste.forEach((g, i) => {
    const r = groessenRang(g);
    (r ? bekannt : unbekannt).push({ g, r, i });
  });
  bekannt.sort((a, b) =>
    (KLASSEN.indexOf(a.r.klasse) - KLASSEN.indexOf(b.r.klasse)) || (a.r.rang - b.r.rang) || (a.i - b.i));
  const unb = unbekannt.map(x => x.g);
  return {
    sortiert:  [...bekannt.map(x => x.g), ...unb],
    unbekannt: unb,
    hinweis:   unb.length
      ? `Größe nicht einsortierbar (${unb.join(', ')}) – ans Ende gestellt.`
      : null,
  };
}

/**
 * Produkt-Attribute mit sortierten Optionen der Groessen-Achse. Andere
 * Attribute bleiben unveraendert, das Array wird nicht veraendert.
 *
 * @returns {{ attributes: Array|undefined, hinweis: string|null }}
 */
export function sortiereAttributOptionen(attributes) {
  if (!Array.isArray(attributes)) return { attributes, hinweis: null };
  let hinweis = null;
  const neu = attributes.map(a => {
    if (!a || !istGroessenAchse(a.name) || !Array.isArray(a.options)) return a;
    const s = sortiereGroessen(a.options);
    hinweis = s.hinweis;
    return { ...a, options: s.sortiert };
  });
  return { attributes: neu, hinweis };
}

/**
 * Reihenfolge der Variationen: Farbe (in der Reihenfolge der Farb-Optionen),
 * dann Groesse aufsteigend. Andere Achsen und Gleichstand: Eingabereihenfolge.
 *
 * @param {Array} variations WooCommerce-Form [{ attributes: [{ name, option }] }]
 * @param {Array} attributes Produkt-Attribute [{ name, options }] (optional)
 * @returns {number[]} Indizes in `variations`, sortiert.
 */
export function variantenReihenfolge(variations, attributes) {
  const liste = Array.isArray(variations) ? variations : [];
  const wert  = (v, pruefe) => ((v?.attributes ?? []).find(a => pruefe(a?.name)) || {}).option;

  const farbAttr = (Array.isArray(attributes) ? attributes : []).find(a => istFarbAchse(a?.name));
  const farben   = [...(farbAttr?.options ?? [])].map(String);
  for (const v of liste) {
    const f = wert(v, istFarbAchse);
    if (f != null && !farben.includes(String(f))) farben.push(String(f));
  }

  const groessen = sortiereGroessen(
    [...new Set(liste.map(v => wert(v, istGroessenAchse)).filter(g => g != null).map(String))],
  ).sortiert;

  const pos = (arr, w) => (w == null ? -1 : arr.indexOf(String(w)));
  return liste
    .map((v, i) => ({ i, f: pos(farben, wert(v, istFarbAchse)), g: pos(groessen, wert(v, istGroessenAchse)) }))
    .sort((a, b) => (a.f - b.f) || (a.g - b.g) || (a.i - b.i))
    .map(x => x.i);
}
