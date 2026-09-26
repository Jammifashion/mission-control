// L-Shop-Stammdaten aus dem Reiter "SKU_LShop" (SSOT-Sheet) - nur lesen.
//
// Befehl M1: Faserangabe und Grammatur kommen fuer einen neuen Artikel aus den
// Stammdaten der gewaehlten Farben, nicht mehr aus dem Eigenschaften-Freitext.
// Der Freitext bleibt Fallback (lib/seo-prompt.js, materialAusEigenschaften).
//
// Gelesen wird header-basiert ueber die GANZE Breite: der Reiter hat ueber 100
// Spalten, readRange('A1:Z1000') aus routes/sheets.js wuerde still abschneiden.
// Erst die Kopfzeile, dann genau die benoetigten Spalten per batchGet. Zeilen
// werden ueber den Index zusammengefuehrt - alle Spalten kommen aus demselben
// Abruf, die Zeilen stehen also gleich.
//
// ArticleNr ist immer ein String (10 Ziffern). Gelesen wird FORMATTED_VALUE,
// damit aus 1000412880 nie 1.000412880E9 wird.
//
// Farbwert = "color1/color2", nur color1, wenn color2 leer - englisch wie im
// L-Shop (Entscheidung Inhaber 25.09.: "Black/Kelly Green"). Keine Uebersetzung.
//
// Faser (Consistence) und Grammatur (Grammage):
//  - laufen durch den BESTEHENDEN filterMaterialFarbenMitMeldung, mit ALLEN
//    gewaehlten Farbwerten. So bleibt eine Klammer stehen, deren Farbe
//    angeboten wird ("100% Baumwolle (Sports Grey: 85% Baumwolle / 15%
//    Viskose)" mit Black + Sports Grey), und faellt weg, wenn nicht.
//  - Unterscheiden sich die gefilterten Werte zwischen den gewaehlten Farben:
//    nichts raten, kein Wert, Hinweis mit den Werten.
//  - Faser: jeder Abschnitt mit Prozentwerten muss auf 100 % aufgehen (L03581,
//    "Ash: 98% Baumwolle / 15% Viskose" = 113 %). Sonst kein Wert, Hinweis.
//  - Grammatur leer: kein Wert, KEIN Hinweis (Entscheidung Inhaber 25.09.).
//
// Discontinued (Befehl M8b), je Zeile = je Farbe x Groesse:
//  - 0 oder leer: normal.
//  - 3 und 6: NICHT waehlbar (nie bestellen; Merkposten EDI 4d). Die Zeile
//    faellt aus Farben, Groessen und Varianten heraus, steht in `gesperrt`, und
//    fuer die gewaehlten Farben gibt es einen Hinweis.
//  - jeder andere Wert: waehlbar, aber "laeuft aus (Wert n)" - Variante traegt
//    `auslauf`, die Liste `auslaufend` gilt fuers ganze Modell (Markierung in
//    der Maske). Kein Hinweis: der SEO-Flow zeigt Hinweise als Warnung an.

import { leseReiterSpalten } from './ssot-reiter.js';
import { filterMaterialFarbenMitMeldung, klammerGruppen, MATERIAL_PLACEHOLDER } from './seo-prompt.js';
import { sortiereGroessen } from './groessen.js';

export const TAB_LSHOP = 'SKU_LShop';
export const CACHE_MS  = 5 * 60 * 1000;

// Feld -> Spaltenname im Reiter. Alle Pflicht: fehlt eine, wirft das Lesen.
const SPALTEN = {
  articleNr:   'ArticleNr',
  catalogNr:   'CatalogNr',
  color1:      'color1',
  color2:      'color2',
  size:        'Size',
  consistence: 'Consistence',
  grammage:    'Grammage',
};
// M4: fuer die Pruefung nach der Generierung (Marke und Modellnummer duerfen
// nicht im Text stehen). Optional - fehlen sie, bleibt das Feld leer.
const SPALTEN_OPTIONAL = {
  marke:       'Brand',
  herstellerNr: 'CatNrManufacturer',
  // M8b: fehlt die Spalte, gilt jede Zeile als normal (0).
  discontinued: 'Discontinued',
};

// Discontinued-Werte, die eine Variante sperren.
export const DISCONTINUED_GESPERRT = new Set([3, 6]);

const CTX = `Reiter "${TAB_LSHOP}"`;

function fehler(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

const t = v => String(v ?? '').trim();
const vergleich = v => t(v).toLowerCase();

// ── Reine Logik (backend/tests/lshop.test.js) ───────────────────────────────

/** "Black" + "Kelly Green" -> "Black/Kelly Green"; ohne color2 nur color1. */
export function farbwert(color1, color2) {
  const a = t(color1), b = t(color2);
  if (!a) return b;
  return b ? `${a}/${b}` : a;
}

/**
 * Summen der Prozentwerte je Abschnitt einer Faserangabe. Ein Abschnitt ist
 * der Text ausserhalb der Klammern und jede Klausel in einer Klammer (Trenner
 * ";"), dort gezaehlt ab dem ersten Doppelpunkt. Abschnitte ohne Prozent
 * zaehlen nicht.
 *
 * @returns {{ teil: string, summe: number }[]}
 */
export function prozentAbschnitte(faser) {
  const text = t(faser);
  const summe = s => [...String(s).matchAll(/(\d{1,3}(?:[.,]\d+)?)\s*%/g)]
    .reduce((acc, m) => acc + Number(m[1].replace(',', '.')), 0);
  const hatProzent = s => /\d\s*%/.test(s);

  const gruppen = klammerGruppen(text);
  let aussen = text;
  for (const g of [...gruppen].reverse()) aussen = aussen.slice(0, g.start) + ' ' + aussen.slice(g.ende);

  const abschnitte = [];
  if (hatProzent(aussen)) abschnitte.push({ teil: aussen.replace(/[\s,;]+/g, ' ').trim(), summe: summe(aussen) });
  for (const g of gruppen) {
    for (const klausel of g.inhalt.split(';').map(k => k.trim()).filter(Boolean)) {
      const i = klausel.indexOf(':');
      const wert = i >= 0 ? klausel.slice(i + 1) : klausel;
      if (hatProzent(wert)) abschnitte.push({ teil: klausel, summe: summe(wert) });
    }
  }
  return abschnitte;
}

/**
 * Geht jede Prozentangabe auf 100 %? (Rundung: auf 0,5 genau.)
 * @returns {string|null} Hinweis, oder null wenn in Ordnung.
 */
export function pruefeHundertProzent(faser) {
  const falsch = prozentAbschnitte(faser).filter(a => Math.abs(a.summe - 100) > 0.5);
  if (!falsch.length) return null;
  return `Faserangabe geht nicht auf 100 % auf (${falsch.map(a => `"${a.teil}" = ${a.summe} %`).join('; ')})`
    + ' – nicht übernommen, bitte prüfen.';
}

/** Discontinued als Zahl; leer/0 -> 0, kein Zahlwert -> der Text selbst. */
export function discontinuedWert(v) {
  const s = t(v);
  if (s === '') return 0;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : s;
}

// Ein Wert (Faser oder Grammatur) ueber alle gewaehlten Farben: filtern, dann
// muessen alle Farben dasselbe Ergebnis haben.
function einheitlich(zeilenJeFarbe, feld, farbwerte, name) {
  const jeFarbe = new Map();
  for (const [farbe, zeilen] of zeilenJeFarbe) {
    const roh = [...new Set(zeilen.map(z => t(z[feld])))];
    const gefiltert = roh.map(r => {
      if (!r) return '';
      const m = filterMaterialFarbenMitMeldung(r, farbwerte).material;
      return m === MATERIAL_PLACEHOLDER ? '' : m;
    });
    jeFarbe.set(farbe, [...new Set(gefiltert)]);
  }
  const alle = [...new Set([...jeFarbe.values()].flat())];
  if (alle.length <= 1) return { wert: alle[0] || null, hinweis: null };
  const liste = [...jeFarbe].map(([f, w]) => `${f}: ${w.map(x => x || '(leer)').join(' | ')}`).join('; ');
  return {
    wert: null,
    hinweis: `${name} unterscheidet sich je Farbe (${liste}) – nicht übernommen, bitte prüfen.`,
  };
}

/**
 * Auswertung der Zeilen EINER CatalogNr fuer die gewaehlten Farben.
 *
 * @param {object[]} zeilen   [{ articleNr, catalogNr, color1, color2, size, consistence, grammage }]
 * @param {object}   o
 * @param {string[]} o.farben Gewaehlte Farbwerte ("Black/Kelly Green"). Leer = alle.
 * @returns {{ catalogNr: string, farben: string[], alleFarben: string[], groessen: string[],
 *             varianten: {farbe: string, groesse: string, articleNr: string, auslauf?: number|string}[],
 *             faser: string|null, grammatur: string|null, hinweise: string[],
 *             gesperrt: {farbe, groesse, articleNr, wert}[], auslaufend: {farbe, groesse, wert}[] }}
 */
export function lshopAuswertung(zeilen, { farben } = {}) {
  const liste = Array.isArray(zeilen) ? zeilen : [];
  const hinweise = [];

  const mitFarbe = liste.map(z => ({ ...z, farbe: farbwert(z.color1, z.color2), disc: discontinuedWert(z.discontinued) }));
  // M8b: gesperrte Zeilen (Discontinued 3/6) sind fuer die Auswahl nicht da.
  const waehlbar = mitFarbe.filter(z => !DISCONTINUED_GESPERRT.has(z.disc));
  const gesperrtZeilen = mitFarbe.filter(z => DISCONTINUED_GESPERRT.has(z.disc));
  const alleFarben = [...new Set(waehlbar.map(z => z.farbe).filter(Boolean))];

  const gewuenscht = (Array.isArray(farben) ? farben : []).map(t).filter(Boolean);
  let gewaehlt;
  if (gewuenscht.length) {
    gewaehlt = [];
    for (const f of gewuenscht) {
      const treffer = alleFarben.find(a => vergleich(a) === vergleich(f));
      const gesperrt = !treffer && gesperrtZeilen.find(z => vergleich(z.farbe) === vergleich(f));
      if (gesperrt) hinweise.push(`Farbe "${gesperrt.farbe}" ist im L-Shop gesperrt (Discontinued ${gesperrt.disc}) – nicht wählbar.`);
      else if (!treffer) hinweise.push(`Farbe "${f}" gibt es im L-Shop für diese Nummer nicht.`);
      else if (!gewaehlt.includes(treffer)) gewaehlt.push(treffer);
    }
  } else {
    gewaehlt = alleFarben;
  }

  // Einzelne gesperrte Groessen einer gewaehlten Farbe: Hinweis, Variante fehlt.
  for (const z of gesperrtZeilen) {
    if (gewaehlt.includes(z.farbe))
      hinweise.push(`${z.farbe} / ${t(z.size)}: im L-Shop gesperrt (Discontinued ${z.disc}) – nicht wählbar.`);
  }

  const auswahl = waehlbar.filter(z => gewaehlt.includes(z.farbe));
  const zeilenJeFarbe = new Map(gewaehlt.map(f => [f, auswahl.filter(z => z.farbe === f)]));

  // Groessen in L-Shop-Schreibweise, sortiert ueber lib/groessen.js. Eine
  // einzelne Groesse ("One Size") bleibt ohne Sortierhinweis.
  const groessenRoh = [...new Set(auswahl.map(z => t(z.size)).filter(Boolean))];
  const sortierung  = groessenRoh.length > 1 ? sortiereGroessen(groessenRoh) : { sortiert: groessenRoh };
  if (sortierung.hinweis) hinweise.push(sortierung.hinweis);
  const groessen = sortierung.sortiert;

  // Varianten: je Farbe x Groesse genau eine ArticleNr (String).
  const varianten = [];
  for (const farbe of gewaehlt) {
    for (const groesse of groessen) {
      const treffer = auswahl.filter(z => z.farbe === farbe && t(z.size) === groesse);
      if (!treffer.length) continue;
      const nummern = [...new Set(treffer.map(z => t(z.articleNr)))];
      if (nummern.length > 1)
        hinweise.push(`${farbe} / ${groesse}: mehrere ArticleNr (${nummern.join(', ')}) – erste genommen.`);
      const auslauf = treffer[0].disc;
      varianten.push({ farbe, groesse, articleNr: nummern[0], ...(auslauf !== 0 ? { auslauf } : {}) });
    }
  }

  let faser = null, grammatur = null;
  if (gewaehlt.length) {
    const f = einheitlich(zeilenJeFarbe, 'consistence', gewaehlt, 'Faserangabe');
    if (f.hinweis) hinweise.push(f.hinweis);
    faser = f.wert;
    const hundert = faser ? pruefeHundertProzent(faser) : null;
    if (hundert) { hinweise.push(hundert); faser = null; }

    const g = einheitlich(zeilenJeFarbe, 'grammage', gewaehlt, 'Grammatur');
    if (g.hinweis) hinweise.push(g.hinweis);
    grammatur = g.wert;
  }

  // M4: Marke und Hersteller-Nummer des Rohlings - fuer die Pruefung nach der
  // Generierung (duerfen nicht im Text stehen). "3000/3099" -> zwei Nummern.
  const marken = [...new Set(liste.map(z => t(z.marke)).filter(Boolean))];
  const herstellerNummern = [...new Set(liste.flatMap(z => t(z.herstellerNr).split(/[/,;]/)).map(t).filter(Boolean))];

  return {
    catalogNr: t(liste[0]?.catalogNr),
    marken,
    herstellerNummern,
    farben: gewaehlt,
    alleFarben,
    groessen,
    varianten,
    faser,
    grammatur,
    hinweise,
    // M8b: ganzes Modell, fuer die Markierung in der Maske.
    gesperrt:   gesperrtZeilen.map(z => ({ farbe: z.farbe, groesse: t(z.size), articleNr: t(z.articleNr), wert: z.disc })),
    auslaufend: waehlbar.filter(z => z.disc !== 0).map(z => ({ farbe: z.farbe, groesse: t(z.size), wert: z.disc })),
  };
}

// ── Lesen (Sheets) ──────────────────────────────────────────────────────────

let _cache = null;   // { spreadsheetId, zeit, zeilen }
export function _resetLShopCache() { _cache = null; }

/**
 * Alle Zeilen des Reiters als Objekte (Felder aus SPALTEN, dazu marke und
 * herstellerNr, falls die Spalten da sind), 5 min Cache.
 */
export async function ladeLShopZeilen({ sheets, spreadsheetId = process.env.GOOGLE_SHEET_ID } = {}) {
  if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 500);
  if (_cache && _cache.spreadsheetId === spreadsheetId && Date.now() - _cache.zeit < CACHE_MS)
    return _cache.zeilen;

  const zeilen = (await leseReiterSpalten({
    tab: TAB_LSHOP, spalten: SPALTEN, optional: SPALTEN_OPTIONAL, sheets, spreadsheetId,
  })).filter(z => z.catalogNr || z.articleNr);
  _cache = { spreadsheetId, zeit: Date.now(), zeilen };
  return zeilen;
}

/**
 * Zeilen einer CatalogNr auswerten. Unbekannte Nummer -> 404.
 */
export async function lshopFuerArtikel(catalogNr, { farben, sheets, spreadsheetId } = {}) {
  const nr = t(catalogNr);
  if (!nr) throw fehler('CatalogNr fehlt.');
  const zeilen = (await ladeLShopZeilen({ sheets, spreadsheetId }))
    .filter(z => vergleich(z.catalogNr) === vergleich(nr));
  if (!zeilen.length) throw fehler(`CatalogNr "${nr}" steht nicht im ${CTX}.`, 404);
  return lshopAuswertung(zeilen, { farben });
}
