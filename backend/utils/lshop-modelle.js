// Ansicht "L-Shop-Modelle" (LS4) - reine Logik, ohne Sheets/Drive/Shop.
// Aufrufer: lib/lshopModelle.js (und lib/lshopStammdaten.js fuer "zurueckgezogen").
//
// Ablauf fuer Nicole (Inhaber 28.10., bericht-LS3): Sammelliste im Browser ->
// Sofort-Ampel aus den Sheets -> "Pruefen" (ein Lauf ueber die Stammdatei, schreibt
// nichts) -> "Uebernehmen" (nur ohne Fremdaenderungen). Gesucht wird ueber
//   1. CatalogNr exakt                       -> gefunden
//   2. CatNrManufacturer (Hersteller-Nummer)  -> Vorschlag ("TU03T" -> BCTU03T)
//   3. CatalogNr endet auf die Eingabe        -> Vorschlag ("3000" -> E3000)
//   4. Name (Description) enthaelt die Eingabe -> Vorschlag ("Fluffy")
//   5. sonst aehnliche Nummer (Abstand 1/Praefix, kandidaten() aus LS1) -> Vorschlag ("ZM108M" -> Z108M)
// Vorschlaege werden nie still uebernommen: 89 Hersteller-Nummern gehoeren in der
// Stammdatei zu mehreren Modellen (Messung LS3).

const t = v => String(v ?? '').trim();
const U = v => t(v).toUpperCase();

export const ZURUECKGEZOGEN = 'zurückgezogen';
/** Quelle der noch nicht in Modelle_Zusatz stehenden Modelle im Stammdaten-Lauf. */
export const QUELLE_NEU = 'L-Shop-Modelle (neu)';
/** Neue Spalten hinten in Modelle_Zusatz (Inhaber 28.10.: ohne Namen der Person). */
export const ZUSATZ_SPALTEN_NEU = ['Notiz', 'Eingetragen', 'Status'];
export const MAX_EINGABEN = 30;
export const MAX_VORSCHLAEGE = 8;
export const NOTIZ_MAX = 80;

export const istZurueckgezogen = s => ['zurückgezogen', 'zurueckgezogen'].includes(t(s).toLowerCase());

// Modellnummer: hat eine Ziffer, keine Leerzeichen ("BY289", "TU03T", "3005", "JH030F").
// Alles andere mit mind. 3 Zeichen ist eine Namenssuche ("Fluffy").
const NUMMER_RE = /^[A-Z0-9][A-Z0-9-]{0,14}$/;
/** @returns {{ text: string, wert: string, art: 'nummer'|'name'|'leer' }} */
export function eingabeArt(roh) {
  const text = t(roh).replace(/\s+/g, ' ');
  const wert = U(text);
  if (!wert) return { text, wert, art: 'leer' };
  if (NUMMER_RE.test(wert) && /\d/.test(wert)) return { text, wert, art: 'nummer' };
  return wert.length >= 3 ? { text, wert, art: 'name' } : { text, wert, art: 'leer' };
}

export const RANG = { exakt: 0, hersteller: 1, endet: 2, name: 3, aehnlich: 4 };

/**
 * Wie trifft eine Dateizeile die Eingabe? null = gar nicht.
 * @param {{ wert, art }} e   aus eingabeArt
 * @param {{ catalogNr, hersteller, name }} z
 */
export function trefferArt(e, z) {
  const cat = U(z.catalogNr);
  if (!cat || e.art === 'leer') return null;
  if (e.art === 'nummer') {
    if (cat === e.wert) return 'exakt';
    // "3000/3099" -> zwei Hersteller-Nummern
    if (U(z.hersteller).split(/[\s/,;]+/).filter(Boolean).includes(e.wert)) return 'hersteller';
    if (e.wert.length >= 3 && cat.endsWith(e.wert)) return 'endet';
    return null;
  }
  return U(z.name).includes(e.wert) ? 'name' : null;
}

/**
 * Ergebnis einer Eingabe aus den gesammelten Treffern.
 * @param {Map<string, string>} treffer  CatalogNr -> beste Trefferart
 * @returns {{ stufe: 'gefunden'|'vorschlag'|'nicht', catalogNr?: string, vorschlaege?: {catalogNr, weg}[], mehr?: boolean }}
 */
export function bewerteSuche(treffer) {
  const liste = [...(treffer ?? new Map())].map(([catalogNr, weg]) => ({ catalogNr, weg }));
  const exakt = liste.find(x => x.weg === 'exakt');
  if (exakt) return { stufe: 'gefunden', catalogNr: exakt.catalogNr };
  if (!liste.length) return { stufe: 'nicht' };
  liste.sort((a, b) => RANG[a.weg] - RANG[b.weg] || a.catalogNr.localeCompare(b.catalogNr));
  return { stufe: 'vorschlag', vorschlaege: liste.slice(0, MAX_VORSCHLAEGE), mehr: liste.length > MAX_VORSCHLAEGE };
}

/**
 * Sofort-Ampel ohne Stammdatei.
 * @returns {'da'|'liste'|'zurueckgezogen'|'suchen'}
 */
export function ampelStufe(e, { bestandModelle = new Set(), zusatz = [] } = {}) {
  if (e.art !== 'nummer') return 'suchen';
  if (bestandModelle.has(e.wert)) return 'da';
  const z = zusatz.filter(x => U(x.catalogNr) === e.wert);
  if (z.some(x => !istZurueckgezogen(x.status))) return 'liste';
  if (z.length) return 'zurueckgezogen';
  return 'suchen';
}

/**
 * Aendert der Stammdaten-Lauf mehr als die neuen Modelle? (Inhaber 28.10.: dann
 * nicht aus dieser Ansicht uebernehmen, sondern erst das Update in den Einstellungen.)
 * @param {object} lauf  Antwort von stammdatenLauf (zeilen, neuJeModell)
 * @param {Iterable<string>} neueModelle  CatalogNr der Auswahl
 * @returns {string[]} Gruende, leer = in Ordnung
 */
export function fremdAenderungen(lauf, neueModelle) {
  const neu = new Set([...(neueModelle ?? [])].map(U));
  const z = lauf?.zeilen ?? {};
  const gruende = [];
  if (z.geaendert) gruende.push(`${z.geaendert} bestehende Zeile(n) würden geändert`);
  if (z.ausgelaufen) gruende.push(`${z.ausgelaufen} Zeile(n) würden auslaufen`);
  if (z.reaktiviert && !z.geaendert) gruende.push(`${z.reaktiviert} Zeile(n) würden wieder aktiv`);
  if (z.nameErgaenzt) gruende.push(`bei ${z.nameErgaenzt} Zeile(n) käme der Artikelname dazu`);
  const fremd = Object.entries(lauf?.neuJeModell ?? {}).filter(([m]) => !neu.has(U(m)));
  if (fremd.length) gruende.push(`neue Zeilen auch für ${fremd.map(([m]) => m).sort().join(', ')}`);
  return gruende;
}

/** Notiz: einzeilig, ohne Steuerzeichen, hoechstens NOTIZ_MAX Zeichen, kein fuehrendes "=". */
export function bereinigeNotiz(s) {
  // eslint-disable-next-line no-control-regex
  const n = t(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[=+@-]+/, '').trim();
  return [...n].slice(0, NOTIZ_MAX).join('');
}

/**
 * Reiter Modelle_Zusatz (Werte inkl. Kopf) -> Zeilen nur ueber die Spaltennamen.
 * @returns {{ kopf: string[], spalten: object, zeilen: { zeile, catalogNr, notiz, eingetragen, status, roh }[] }}
 */
export function zusatzZeilen(werte) {
  const kopf = (werte?.[0] ?? []).map(t);
  const i = n => kopf.indexOf(n);
  const spalten = { catalogNr: i('CatalogNr'), notiz: i('Notiz'), eingetragen: i('Eingetragen'), status: i('Status') };
  if (spalten.catalogNr < 0) return { kopf, spalten, zeilen: [] };
  const zeilen = [];
  (werte ?? []).slice(1).forEach((r, j) => {
    const cat = U(r?.[spalten.catalogNr]);
    if (!cat) return;
    const w = k => (spalten[k] >= 0 ? t(r[spalten[k]]) : '');
    zeilen.push({ zeile: j + 2, catalogNr: cat, notiz: w('notiz'), eingetragen: w('eingetragen'), status: w('status'), roh: r ?? [] });
  });
  return { kopf, spalten, zeilen };
}

/** Fehlen die neuen Spalten? (dann Einrichtung noetig, nichts schreiben) */
export const fehlendeZusatzSpalten = kopf => ZUSATZ_SPALTEN_NEU.filter(n => !(kopf ?? []).includes(n));

/**
 * Was passiert in Modelle_Zusatz mit der Auswahl?
 * @param {object[]} zeilen  aus zusatzZeilen
 * @param {{ catalogNr, notiz }[]} auswahl
 * @returns {{ neu: {catalogNr, notiz}[], reaktivieren: object[], vorhanden: string[] }}
 */
export function zusatzPlan(zeilen, auswahl) {
  const neu = [], reaktivieren = [], vorhanden = [];
  const gesehen = new Set();
  for (const a of auswahl ?? []) {
    const cat = U(a.catalogNr);
    if (!cat || gesehen.has(cat)) continue;
    gesehen.add(cat);
    const da = (zeilen ?? []).filter(z => z.catalogNr === cat);
    if (da.some(z => !istZurueckgezogen(z.status))) vorhanden.push(cat);
    else if (da.length) reaktivieren.push({ ...da[da.length - 1], notizNeu: bereinigeNotiz(a.notiz) });
    else neu.push({ catalogNr: cat, notiz: bereinigeNotiz(a.notiz) });
  }
  return { neu, reaktivieren, vorhanden };
}

/** Neue Zeile fuer Modelle_Zusatz in der Reihenfolge des Kopfes (nur bekannte Spalten). */
export function zusatzZeileWerte(kopf, { catalogNr, notiz = '', eingetragen = '' }) {
  const werte = { CatalogNr: U(catalogNr), Notiz: notiz, Eingetragen: eingetragen, Status: '' };
  return kopf.map(n => (n in werte ? werte[n] : ''));
}

/** Datum Europe/Berlin "JJJJ-MM-TT". */
export function berlinTag(jetzt = new Date()) {
  return jetzt.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}
