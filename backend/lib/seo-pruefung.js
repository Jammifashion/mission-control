// Deterministische Pruefung des generierten Textes (Befehl M4) - KEIN Modell.
//
// Laeuft nach der Generierung ueber Kurz- und Produktbeschreibung und liefert
// eine Hinweisliste. Kein zweiter Modelllauf dafuer (der einzige
// Wiederholungslauf haengt weiter allein an pruefeH2). Die bestehenden
// Pruefungen - <h2> am Anfang und nicht der Titel, Keyphrase in der
// Kurzbeschreibung und im ersten <p> nach der <h2>, Groessen - stehen in
// lib/seo-prompt.js (pruefeSeoText) und laufen unveraendert daneben.
//
// ⚠️ Die Begriffe hier stehen NUR im Code, nie im Prompt: jedes Verbot im
// Prompt ("nicht offiziell") landete gemessen im Text (BL7).
//
// Regeln:
//  1. Nur_intern des Motivs (Wendung, dazu jedes eigene Wort ab 4 Zeichen, das
//     nicht im Produktnamen/der Keyphrase steht - "Carbon Cap" meldet "Carbon",
//     nicht "Cap").
//  2. Marke und Modellnummern des Rohlings (LShop_Modelle: Brand, CatalogNr,
//     CatNrManufacturer).
//  3. Feste Liste VERBOTENE_BEGRIFFE.
//  4. Zeitangabe mit Zahl (Werktage, Tage, Wochen mit Ziffer davor).
//     M4b: auch Zahlwoerter (ein/eine/…, zwei … zwoelf, "wenigen") und Spannen
//     ("drei bis fuenf", "fuenf-sechs"); dazu JEDES "Lieferzeit",
//     "Lieferung erfolgt" und "geliefert in" - Lieferzeiten stehen im Shop
//     (German Market), nie im Text. Anlass Echttest Cap 25.09.: "Die Lieferung
//     erfolgt in drei bis fuenf Werktagen." blieb ungemeldet.
//  5. <h1> im HTML.
//  6. "bestickt"/"Stick…", wenn das Motiv einen Druck beschreibt.
//  7. Floskeln (FLOSKELN): die Liste aus dem Systemprompt (SEO_SYSTEM_PROMPT,
//     dort seit jeher genannt) plus Grenzfaelle aus KI1 ("Jetzt in deiner
//     Groesse sichern", "sofort einsatzbereit") - die neuen NUR hier, nicht im
//     Prompt (Regel oben).
//  8. Druck- und Knappheitsfloskeln (KNAPPHEIT, FM2 28.10.): "solange er da
//     ist", "bevor andere", "zuschlagen", "jetzt … sichern", "nur noch",
//     "begrenzt", "limitiert" … - wir drucken auf Bestellung, Knappheit ist
//     immer falsch. Muster statt fester Woerter, weil das Modell die Wendung
//     jedes Mal anders baut. NUR hier, nie im Prompt.
//  9. Faserangabe unvollstaendig (FM2): nennt ein Text eine Faser mit Prozent
//     ("80 % Baumwolle"), muss jede Faser der Artikel-Faserangabe
//     (strukturiert.faser bzw. LShop_Modelle Consistence) darin stehen.
//     Reine Stoffe (eine Faser, z. B. 100 % Baumwolle) pruefen nichts.

import { motivFuer } from './seo-ssot.js';
import { lshopFuerArtikel } from './lshop.js';
import { strukturierteEingabe } from './seo-prompt.js';

// Feste Liste (Entscheidung Otto 25.09.). "Jammi Fashion" nur getrennt
// geschrieben - "JammiFashion" ist der Markenname und erlaubt.
export const VERBOTENE_BEGRIFFE = ['L-Shop', 'Printequipment', 'Sublistar', 'OEKO-TEX', 'offiziell', 'Jammi Fashion'];

// Floskeln (Regel 7). "Lieblings-" als Wortanfang (Lieblingsshirt, Lieblings-Hoodie).
export const FLOSKELN = [
  'Must-have', 'Party-Kracher', 'absoluter Hingucker', 'Blickfang', 'hochwertige Qualität',
  'maximaler Tragekomfort', 'schnell und zuverlässig', 'sichere dir jetzt', 'Lieblings-',
  'individuell bedruckbar', 'personalisierbar', 'jetzt selbst gestalten',
  'in deiner Größe sichern', 'sofort einsatzbereit',
];

// Druck-/Knappheitsfloskeln (Regel 8). Name = Anzeige, re = Muster auf dem
// Klartext (Gross/Klein egal, an Wortgrenzen). Bis 4 Woerter Abstand, damit
// "solange er noch da ist" und "jetzt dein Exemplar sichern" greifen.
const W  = '[A-Za-zÄÖÜäöüß]';
const WL = '(?:\\s+[^\\s.!?]+){0,4}?';
const knapp = (name, kern) => ({ name, re: new RegExp(`(?<!${W})${kern}(?!${W})`, 'i') });
export const KNAPPHEIT = [
  knapp('solange … da ist', `solange${WL}\\s+(?:da(?:\\s+(?:ist|sind))?|vorrätig|verfügbar|vorhanden|(?:der\\s+)?Vorrat\\s+reicht)`),
  knapp('bevor andere',     'bevor\\s+(?:es\\s+)?andere'),
  knapp('zuvorkommen',      'zuvor\\s*(?:kommen|kommst|kommt)'),
  knapp('zuschlagen',       '(?:zuschlagen|schlag\\s+zu|greif\\s+zu|zugreifen)'),
  knapp('jetzt … sichern',  `jetzt${WL}\\s+(?:sichern|sicher(?:e|t)?\\s+(?:dir|euch))`),
  knapp('nur noch',         'nur\\s+noch'),
  knapp('begrenzt',         `begrenzt${W}*`),
  knapp('limitiert',        `(?:limitiert${W}*|limited)`),
  knapp('ausverkauft',      'ausverkauft'),
];

const BUCHST = 'A-Za-zÄÖÜäöüß0-9';
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Regex fuer einen Begriff: Gross/Klein egal, an Wortgrenzen. Bindestrich im
// Begriff darf auch Leerzeichen oder nichts sein ("L Shop", "LShop",
// "Oeko-Tex"); "offiziell" auch mit Endung (offizielle, offiziellen).
function begriffRe(begriff) {
  const b = String(begriff).trim();
  if (/^jammi fashion$/i.test(b)) return new RegExp(`(?<![${BUCHST}])jammi\\s+fashion(?![${BUCHST}])`, 'i');
  const kern = b.split('-').map(escape).join('[-\\s]?');
  const ende = /^offiziell$/i.test(b) ? '' : `(?![${BUCHST}])`;
  return new RegExp(`(?<![${BUCHST}])${kern}${ende}`, 'i');
}

// Floskel als Regex: Woerter mit beliebigem Leerraum, Bindestrich auch als
// Leerzeichen/nichts; "…-" am Ende = Wortanfang.
function floskelRe(f) {
  const praefix = f.endsWith('-');
  const kern = f.replace(/-$/, '').split(/\s+/).map(w => w.split('-').map(escape).join('[-\\s]?')).join('\\s+');
  return new RegExp(`(?<![${BUCHST}])${kern}${praefix ? '' : `(?![${BUCHST}])`}`, 'i');
}

function text(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Zahl vor der Zeiteinheit: Ziffern oder Zahlwort. "ein Tag am Eis" meldet
// bewusst mit (Grenzfall, M4b): ein Hinweis blockiert nichts, eine uebersehene
// Lieferzusage waere rechtlich relevant.
const ZAHLWORT = '(?:ein|eine|einem|einen|einer|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|wenigen)';
const ZAHL     = `(?:\\d+|${ZAHLWORT})`;
const ZEIT_RE  = new RegExp(
  `(?<![A-Za-zÄÖÜäöüß0-9])${ZAHL}(?:\\s*(?:[-–]|bis)\\s*${ZAHL})?\\s*(?:Werktage?n?|Arbeitstage?n?|Tage?n?|Wochen?)(?![A-Za-zÄÖÜäöüß])`,
  'i');
// Lieferangaben ohne Zahl: jedes Vorkommen meldet.
const LIEFER_RE = /(?<![A-Za-zÄÖÜäöüß])(?:Lieferzeit(?:en)?|Lieferung\s+erfolgt|geliefert\s+in)(?![A-Za-zÄÖÜäöüß])/i;
const STICK_RE  = /(?<![A-Za-zÄÖÜäöüß])(?:be|ge)?stick(?:t|te|ten|en|erei|ereien)?(?![A-Za-zÄÖÜäöüß])/i;
const H1_RE     = /<h1[\s>]/i;

// Regel 9: Fasern einer Faserangabe = das Wort direkt nach jeder Prozentzahl
// ("80% Baumwolle / 20% Polyester" -> baumwolle, polyester), ohne Dubletten.
const FASER_RE = /(\d{1,3}(?:[.,]\d+)?)\s*%\s*([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]*)/g;
export function faserNamen(faser) {
  const namen = new Map();
  for (const m of String(faser ?? '').matchAll(FASER_RE)) {
    const k = m[2].toLowerCase();
    if (!namen.has(k)) namen.set(k, m[2]);
  }
  return [...namen.values()];
}

/**
 * Grundfaser einer L-Shop-Faserangabe: alles vor der ersten Klammer, also ohne
 * die Ausnahmen je Farbe ("100% Baumwolle (Sports Grey: 85% Baumwolle / 15% Viskose)"
 * -> "100% Baumwolle"). Scan FM2 28.10.: mit den Ausnahmen 340 von 341 Treffern
 * Fehlalarme, weil der Artikel die Ausnahmefarbe gar nicht fuehrt.
 * @returns {string|null}
 */
export function grundFaser(faser) {
  const g = String(faser ?? '').split('(')[0].trim().replace(/[\s,;]+$/, '');
  return g || null;
}

const woerter = s => String(s ?? '').toLowerCase().split(/[^a-zäöüß0-9]+/i).filter(Boolean);

/**
 * @param {object}   e
 * @param {string}   e.kurzbeschreibung
 * @param {string}   e.produktbeschreibung
 * @param {string}   [e.produktname]
 * @param {string}   [e.keyphrase]
 * @param {string}   [e.nurIntern]      Motive.Nur_intern (nie im Prompt)
 * @param {string[]} [e.marken]         LShop_Modelle.Brand
 * @param {string[]} [e.modellnummern]  CatalogNr + CatNrManufacturer
 * @param {boolean}  [e.druck]          Motiv beschreibt einen Druck
 * @param {string}   [e.faser]          Faserangabe des Artikels (Regel 9)
 * @returns {string[]} Hinweise, leer wenn alles in Ordnung.
 */
export function pruefeGeneratorText(e = {}) {
  const teile = [
    ['Kurzbeschreibung',    e.kurzbeschreibung],
    ['Produktbeschreibung', e.produktbeschreibung],
  ];
  const hinweise = [];
  const melde = (re, was) => {
    const wo = teile.filter(([, html]) => re.test(text(html))).map(([n]) => n);
    if (wo.length) hinweise.push(`${was} in ${wo.join(' und ')}.`);
    return wo.length > 0;
  };

  // 1. Nur_intern
  const erlaubt = new Set([...woerter(e.produktname), ...woerter(e.keyphrase)]);
  for (const wendung of String(e.nurIntern ?? '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean)) {
    const ganz = melde(begriffRe(wendung), `Interner Begriff "${wendung}" (Nur_intern)`);
    if (ganz) continue;
    for (const w of wendung.split(/\s+/).filter(x => x.length >= 4 && !erlaubt.has(x.toLowerCase())))
      melde(begriffRe(w), `Interner Begriff "${w}" (aus Nur_intern "${wendung}")`);
  }

  // 2. Marke und Modellnummern
  for (const m of new Set((e.marken ?? []).map(s => String(s).trim()).filter(Boolean)))
    melde(begriffRe(m), `Marke des Rohlings "${m}"`);
  for (const n of new Set((e.modellnummern ?? []).map(s => String(s).trim()).filter(s => s.length >= 3)))
    melde(begriffRe(n), `Modellnummer "${n}"`);

  // 3. Feste Liste
  for (const b of VERBOTENE_BEGRIFFE) melde(begriffRe(b), `Begriff "${b}"`);

  // 4. Zeitangabe mit Zahl (Ziffer oder Zahlwort, auch Spanne), Lieferangaben
  for (const [n, html] of teile) {
    const m = ZEIT_RE.exec(text(html));
    if (m) hinweise.push(`Zeitangabe "${m[0]}" in ${n} – keine Liefer- oder Bearbeitungszeiten nennen.`);
  }
  for (const [n, html] of teile) {
    const m = LIEFER_RE.exec(text(html));
    if (m) hinweise.push(`Lieferangabe "${m[0]}" in ${n} – Lieferzeiten stehen im Shop, nicht im Text.`);
  }

  // 5. <h1>
  const mitH1 = teile.filter(([, html]) => H1_RE.test(String(html ?? ''))).map(([n]) => n);
  if (mitH1.length) hinweise.push(`<h1> in ${mitH1.join(' und ')} – die H1 ist der Produkttitel der Seite.`);

  // 6. Stick bei Druck
  if (e.druck) melde(STICK_RE, 'Das Motiv ist gedruckt, der Text spricht von Stick/bestickt');

  // 7. Floskeln
  for (const f of FLOSKELN) melde(floskelRe(f), `Floskel "${f.replace(/-$/, '…')}"`);

  // 8. Druck/Knappheit - je Teil mit der gefundenen Stelle. Steht das Fundwort
  // im Produktnamen, ist es Motivtitel, keine Floskel (Bestand: "Rentier war
  // ausverkauft" - Scan FM2 28.10.).
  const name = String(e.produktname ?? '').toLowerCase();
  for (const k of KNAPPHEIT) {
    for (const [n, html] of teile) {
      const m = k.re.exec(text(html));
      if (m && !name.includes(m[0].toLowerCase()))
        hinweise.push(`Knappheitsfloskel "${m[0]}" in ${n} – wir drucken auf Bestellung, nichts ist knapp.`);
    }
  }

  // 9. Faserangabe unvollstaendig
  const fasern = faserNamen(e.faser);
  if (fasern.length >= 2) {
    for (const [n, html] of teile) {
      const t = text(html);
      const genannt = [...t.matchAll(FASER_RE)].map(m => m[0]);
      if (!genannt.length) continue;
      const fehlt = fasern.filter(f => !new RegExp(`(?<![${BUCHST}])${escape(f)}`, 'i').test(t));
      if (fehlt.length)
        hinweise.push(`Faserangabe unvollständig in ${n}: "${genannt.join(', ')}" – laut Artikel "${String(e.faser).trim()}", es fehlt ${fehlt.join(', ')}.`);
    }
  }

  return hinweise;
}

/**
 * Regeln 1-3 (Nur_intern, Marke/Modellnummer, feste Liste) auf EINEN kurzen
 * Text, z. B. ein Schlagwort (M8). Dieselben Muster wie pruefeGeneratorText.
 * @returns {string[]} Treffer als Kurztext, leer = in Ordnung.
 */
export function sperrTreffer(wert, e = {}) {
  const s = text(wert);
  const raus = [];
  const erlaubt = new Set([...woerter(e.produktname), ...woerter(e.keyphrase)]);
  for (const wendung of String(e.nurIntern ?? '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean)) {
    if (begriffRe(wendung).test(s)) { raus.push(`Nur_intern "${wendung}"`); continue; }
    for (const w of wendung.split(/\s+/).filter(x => x.length >= 4 && !erlaubt.has(x.toLowerCase())))
      if (begriffRe(w).test(s)) raus.push(`Nur_intern "${w}"`);
  }
  for (const m of new Set((e.marken ?? []).map(x => String(x).trim()).filter(Boolean)))
    if (begriffRe(m).test(s)) raus.push(`Marke "${m}"`);
  for (const n of new Set((e.modellnummern ?? []).map(x => String(x).trim()).filter(x => x.length >= 3)))
    if (begriffRe(n).test(s)) raus.push(`Modellnummer "${n}"`);
  for (const b of VERBOTENE_BEGRIFFE) if (begriffRe(b).test(s)) raus.push(`Begriff "${b}"`);
  return raus;
}

/**
 * Pruefkontext (Nur_intern, Marken, Modellnummern) aus der SSOT lesen - fuer
 * sperrTreffer (Schlagwoerter). Lesefehler -> leerer Teil plus Hinweis.
 * @returns {Promise<{ kontext: object, hinweise: string[] }>}
 */
export async function sperrKontext({ artikelkurz, lshopNr, motivZeile, produktname, keyphrase } = {}) {
  const hinweise = [];
  let motiv = motivZeile ?? null;
  if (motiv === null && String(artikelkurz ?? '').trim()) {
    try { motiv = await motivFuer(artikelkurz); } catch (err) { hinweise.push(`Reiter Motive nicht lesbar (${err.message}).`); }
  }
  let rohling = null;
  if (String(lshopNr ?? '').trim()) {
    try { rohling = await lshopFuerArtikel(lshopNr); }
    catch (err) { if (err.status !== 404) hinweise.push(`LShop_Modelle nicht lesbar (${err.message}).`); }
  }
  return {
    kontext: {
      produktname, keyphrase,
      nurIntern:     motiv?.nurIntern,
      marken:        rohling?.marken,
      modellnummern: rohling ? [rohling.catalogNr, ...(rohling.herstellerNummern ?? [])] : [],
    },
    hinweise,
  };
}

/**
 * Pruefung mit den SSOT-Daten des Artikels - EINE Stelle fuer Generator
 * (routes/claude.js, nach der Generierung) und SEO-Reiter (POST
 * /api/seo/text-pruefung, nach dem Speichern gegen den gespeicherten Text).
 * Liest Motiv-Zeile (Nur_intern, Druck) und Rohling (Marke, Modellnummern);
 * ein Lesefehler blockiert nicht, er steht als Hinweis vorne.
 *
 * @param {object} e  wie pruefeGeneratorText, dazu artikelkurz, lshopNr,
 *                    optional motivZeile (schon gelesen, spart den Abruf) und
 *                    strukturiert ({ faser } der Generierung, Regel 9)
 * @returns {Promise<string[]>}
 */
export async function pruefeTextMitSsot({ artikelkurz, lshopNr, motivZeile, strukturiert, ...e } = {}) {
  const hinweise = [];
  let motiv = motivZeile ?? null;
  if (motiv === null && String(artikelkurz ?? '').trim()) {
    try { motiv = await motivFuer(artikelkurz); }
    catch (err) { hinweise.push(`Reiter Motive nicht lesbar (${err.message}) – Nur_intern nicht geprüft.`); }
  }
  let rohling = null;
  if (String(lshopNr ?? '').trim()) {
    try { rohling = await lshopFuerArtikel(lshopNr); }
    catch (err) { if (err.status !== 404) hinweise.push(`LShop_Modelle nicht lesbar (${err.message}) – Marke nicht geprüft.`); }
  }
  return [
    ...hinweise,
    ...pruefeGeneratorText({
      ...e,
      nurIntern:     motiv?.nurIntern,
      marken:        rohling?.marken,
      modellnummern: rohling ? [rohling.catalogNr, ...(rohling.herstellerNummern ?? [])] : [],
      druck:         !!(motiv && (motiv.druckfarben || motiv.druckposition)),
      // Regel 9: Faser der Generierung (strukturiert, gewaehlte Farben), sonst
      // die GRUNDFASER des Rohlings (SEO-Reiter nach dem Speichern kennt die
      // Farben nicht; die Farb-Ausnahmen in Klammern gaeben sonst Fehlalarme).
      faser:         e.faser ?? strukturierteEingabe(strukturiert)?.faser ?? grundFaser(rohling?.faser),
    }),
  ];
}
