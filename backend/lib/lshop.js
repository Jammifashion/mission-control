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

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { requireHeader } from '../utils/sheet-headers.js';
import { colLetter } from '../utils/sheet-spalten.js';
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
 *             varianten: {farbe: string, groesse: string, articleNr: string}[],
 *             faser: string|null, grammatur: string|null, hinweise: string[] }}
 */
export function lshopAuswertung(zeilen, { farben } = {}) {
  const liste = Array.isArray(zeilen) ? zeilen : [];
  const hinweise = [];

  const mitFarbe = liste.map(z => ({ ...z, farbe: farbwert(z.color1, z.color2) }));
  const alleFarben = [...new Set(mitFarbe.map(z => z.farbe).filter(Boolean))];

  const gewuenscht = (Array.isArray(farben) ? farben : []).map(t).filter(Boolean);
  let gewaehlt;
  if (gewuenscht.length) {
    gewaehlt = [];
    for (const f of gewuenscht) {
      const treffer = alleFarben.find(a => vergleich(a) === vergleich(f));
      if (!treffer) hinweise.push(`Farbe "${f}" gibt es im L-Shop für diese Nummer nicht.`);
      else if (!gewaehlt.includes(treffer)) gewaehlt.push(treffer);
    }
  } else {
    gewaehlt = alleFarben;
  }

  const auswahl = mitFarbe.filter(z => gewaehlt.includes(z.farbe));
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
      varianten.push({ farbe, groesse, articleNr: nummern[0] });
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

  return {
    catalogNr: t(liste[0]?.catalogNr),
    farben: gewaehlt,
    alleFarben,
    groessen,
    varianten,
    faser,
    grammatur,
    hinweise,
  };
}

// ── Lesen (Sheets) ──────────────────────────────────────────────────────────

let _cache = null;   // { spreadsheetId, zeit, zeilen }
export function _resetLShopCache() { _cache = null; }

async function sheetsClient() {
  return google.sheets({ version: 'v4', auth: await getGoogleAuth() });
}

/**
 * Alle Zeilen des Reiters als Objekte (nur die Felder aus SPALTEN), 5 min Cache.
 */
export async function ladeLShopZeilen({ sheets, spreadsheetId = process.env.GOOGLE_SHEET_ID } = {}) {
  if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 500);
  if (_cache && _cache.spreadsheetId === spreadsheetId && Date.now() - _cache.zeit < CACHE_MS)
    return _cache.zeilen;

  const api = sheets ?? await sheetsClient();
  const { data: kopf } = await api.spreadsheets.values.get({ spreadsheetId, range: `${TAB_LSHOP}!1:1` });
  const header = kopf.values?.[0] ?? [];
  if (!header.length) throw fehler(`${CTX} fehlt oder hat keine Kopfzeile.`, 500);

  const felder = Object.entries(SPALTEN).map(([feld, name]) => ({ feld, idx: requireHeader(header, name, CTX) }));
  const { data } = await api.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: felder.map(({ idx }) => `${TAB_LSHOP}!${colLetter(idx)}2:${colLetter(idx)}`),
    majorDimension: 'COLUMNS',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const spalten = (data.valueRanges ?? []).map(vr => vr.values?.[0] ?? []);
  const anzahl  = Math.max(0, ...spalten.map(s => s.length));

  const zeilen = [];
  for (let i = 0; i < anzahl; i++) {
    const z = {};
    felder.forEach(({ feld }, j) => { z[feld] = t(spalten[j]?.[i]); });
    if (z.catalogNr || z.articleNr) zeilen.push(z);
  }
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
