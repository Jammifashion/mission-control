// Generator-Eingaben aus dem SSOT-Sheet (Befehl M4) - nur lesen.
//
//  - Motive: Motiv, Druckposition, Druckfarben, Serie_Kontext je
//    Artikelkurzbezeichnung. Nur_intern wird mitgelesen, verlaesst aber diese
//    Datei nur Richtung Pruefung (lib/seo-pruefung.js) - NIE in den Prompt und
//    nie ans Frontend (motivFuerPrompt laesst es weg).
//  - Struktur_Kategorien: SEO_Hinweis je Kategorienummer. Vorlage fuer das Feld
//    "Eigene Hinweise": alle nicht leeren Hinweise der Kategorien in deren
//    Reihenfolge, doppelte entfernt (Entscheidung Otto 25.09.).
//  - SEO_Karte: Soll_ und Ist_Keyphrase aller Eintraege fuer die
//    Kollisionspruefung. Gleich einer Keyphrase eines ANDEREN Eintrags ->
//    Warnung; als Teilstring in einer fremden enthalten -> Info. Blockiert nie.
//
// Gelesen wird ueber lib/ssot-reiter.js (header-basiert, ganze Hoehe), je
// Reiter 5 min Cache.

import { leseReiterSpalten, reiterCache } from './ssot-reiter.js';

export const TAB_MOTIVE     = 'Motive';
export const TAB_KATEGORIEN = 'Struktur_Kategorien';
export const TAB_SEO_KARTE  = 'SEO_Karte';

const SPALTEN_MOTIVE = {
  kurz:          'Artikelkurzbezeichnung',
  motiv:         'Motiv',
  druckposition: 'Druckposition',
  druckfarben:   'Druckfarben',
  serieKontext:  'Serie_Kontext',
  nurIntern:     'Nur_intern',
};
const SPALTEN_KATEGORIEN = { nr: 'Kategorienummer', hinweis: 'SEO_Hinweis' };
const SPALTEN_SEO_KARTE  = { typ: 'Typ', name: 'Name', wcId: 'WC_ID', ist: 'Ist_Keyphrase', soll: 'Soll_Keyphrase' };
// M8: Synonyme zaehlen fuer Kollisionen mit (optional - fehlt die Spalte, ohne).
const SPALTEN_SEO_KARTE_OPT = { syn: 'Ist_Synonyme' };

const t    = v => String(v ?? '').trim();
const norm = v => t(v).toLowerCase().replace(/\s+/g, ' ');

// ── Reine Logik (backend/tests/seo-ssot.test.js) ────────────────────────────

/** Motiv-Zeile zur Artikelkurzbezeichnung (Gross/Klein egal), oder null. */
export function motivAus(zeilen, kurz) {
  const k = norm(kurz);
  if (!k) return null;
  return (zeilen ?? []).find(z => norm(z.kurz) === k) ?? null;
}

/** Was vom Motiv in den Prompt darf - ausdruecklich OHNE nurIntern. */
export function motivFuerPrompt(m) {
  if (!m) return null;
  return {
    motiv:         t(m.motiv),
    druckposition: t(m.druckposition),
    druckfarben:   t(m.druckfarben),
    serieKontext:  t(m.serieKontext),
  };
}

/**
 * Vorlage "Eigene Hinweise" aus den SEO_Hinweisen der Kategorien.
 * @param {object[]} zeilen [{ nr, hinweis }]
 * @param {Array<string|number>} kategorieIds in der Reihenfolge des Artikels
 * @returns {string} Hinweise, durch Leerzeile getrennt; '' wenn keine.
 */
export function hinweisVorlage(zeilen, kategorieIds) {
  const raus = [];
  for (const id of kategorieIds ?? []) {
    const z = (zeilen ?? []).find(r => t(r.nr) === t(id));
    const h = t(z?.hinweis);
    if (h && !raus.some(x => norm(x) === norm(h))) raus.push(h);
  }
  return raus.join('\n\n');
}

/**
 * Ist_Synonyme in eine Liste: Yoast-Format `["a, b, c"]` oder schlichter
 * Text "a, b, c".
 */
export function synonymeListe(roh) {
  let s = t(roh);
  if (!s) return [];
  try { const j = JSON.parse(s); if (Array.isArray(j)) s = j.join(','); } catch { /* kein JSON */ }
  return s.split(',').map(x => t(x)).filter(Boolean);
}

/**
 * Keyphrase gegen SEO_Karte. Eintraege mit derselben WC_ID wie der Artikel
 * selbst zaehlen nicht. M8: auch gleich einem Ist_Synonym eines anderen
 * Eintrags ist eine Kollision (Feld "Ist_Synonyme").
 * @returns {{ kollisionen: object[], teiltreffer: object[] }}
 *   je Treffer { typ, name, wcId, feld: 'Soll_Keyphrase'|'Ist_Keyphrase', wert }
 */
export function keyphrasePruefung(zeilen, keyphrase, { wcId } = {}) {
  const k = norm(keyphrase);
  const kollisionen = [], teiltreffer = [];
  if (!k) return { kollisionen, teiltreffer };
  const eigen = t(wcId);
  for (const z of zeilen ?? []) {
    if (eigen && t(z.wcId) === eigen) continue;
    const gesehen = new Set();
    for (const [feld, wert] of [['Soll_Keyphrase', z.soll], ['Ist_Keyphrase', z.ist]]) {
      const w = norm(wert);
      if (!w || gesehen.has(w)) continue;
      gesehen.add(w);
      const treffer = { typ: t(z.typ), name: t(z.name), wcId: t(z.wcId), feld, wert: t(wert) };
      if (w === k) kollisionen.push(treffer);
      else if (w.includes(k)) teiltreffer.push(treffer);
    }
    for (const syn of synonymeListe(z.syn)) {
      if (norm(syn) === k) kollisionen.push({ typ: t(z.typ), name: t(z.name), wcId: t(z.wcId), feld: 'Ist_Synonyme', wert: syn });
    }
  }
  return { kollisionen, teiltreffer };
}

/** Meldungstexte zur Keyphrase-Pruefung: { warnungen, infos }. */
export function keyphraseMeldungen(keyphrase, { kollisionen, teiltreffer } = {}) {
  const beschr = x => `${x.typ || 'Eintrag'} "${x.name}"${x.wcId ? ` (ID ${x.wcId})` : ''}, ${x.feld} "${x.wert}"`;
  return {
    warnungen: (kollisionen ?? []).map(x => `Keyphrase "${t(keyphrase)}" ist schon vergeben: ${beschr(x)}.`),
    infos:     (teiltreffer ?? []).map(x => `Keyphrase "${t(keyphrase)}" steckt in: ${beschr(x)}.`),
  };
}

// ── Lesen (Sheets) ──────────────────────────────────────────────────────────

const cache = reiterCache();
export function _resetSeoSsotCache() { cache.leeren(); }
// M9: nach dem Schreiben der SEO_Karte (lib/seo-karte.js) neu lesen.
export function karteVergessen() { cache.leeren(); }

const lade = (tab, spalten, o = {}, optional) =>
  cache.hole(`${tab}|${o.spreadsheetId ?? process.env.GOOGLE_SHEET_ID}`,
    () => leseReiterSpalten({ tab, spalten, optional, ...o }));

/** Motiv-Zeile (inkl. nurIntern - nur fuer die Pruefung). */
export async function motivFuer(kurz, o) {
  return motivAus(await lade(TAB_MOTIVE, SPALTEN_MOTIVE, o), kurz);
}

export async function seoHinweisVorlage(kategorieIds, o) {
  return hinweisVorlage(await lade(TAB_KATEGORIEN, SPALTEN_KATEGORIEN, o), kategorieIds);
}

export async function keyphraseGegenKarte(keyphrase, { wcId, ...o } = {}) {
  return keyphrasePruefung(await lade(TAB_SEO_KARTE, SPALTEN_SEO_KARTE, o, SPALTEN_SEO_KARTE_OPT), keyphrase, { wcId });
}

/**
 * M8: mehrere Vorschlaege (Keyphrase, Synonyme) gegen SEO_Karte.
 * @returns {Promise<{ wert: string, kollisionen: object[] }[]>}
 */
export async function werteGegenKarte(werte, { wcId, ...o } = {}) {
  const zeilen = await lade(TAB_SEO_KARTE, SPALTEN_SEO_KARTE, o, SPALTEN_SEO_KARTE_OPT);
  return (werte ?? []).map(w => t(w)).filter(Boolean)
    .map(wert => ({ wert, kollisionen: keyphrasePruefung(zeilen, wert, { wcId }).kollisionen }));
}
