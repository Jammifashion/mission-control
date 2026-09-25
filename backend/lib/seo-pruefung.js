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
//  2. Marke und Modellnummern des Rohlings (SKU_LShop: Brand, CatalogNr,
//     CatNrManufacturer).
//  3. Feste Liste VERBOTENE_BEGRIFFE.
//  4. Zeitangabe mit Zahl (Werktage, Tage, Wochen mit Ziffer davor).
//  5. <h1> im HTML.
//  6. "bestickt"/"Stick…", wenn das Motiv einen Druck beschreibt.

// Feste Liste (Entscheidung Otto 25.09.). "Jammi Fashion" nur getrennt
// geschrieben - "JammiFashion" ist der Markenname und erlaubt.
export const VERBOTENE_BEGRIFFE = ['L-Shop', 'Printequipment', 'Sublistar', 'OEKO-TEX', 'offiziell', 'Jammi Fashion'];

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

function text(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const ZEIT_RE   = /(?<![A-Za-z0-9])\d+(?:\s*[-–]\s*\d+)?\s*(?:Werktage?n?|Arbeitstage?n?|Tage?n?|Wochen?)(?![A-Za-zÄÖÜäöüß])/i;
const STICK_RE  = /(?<![A-Za-zÄÖÜäöüß])(?:be|ge)?stick(?:t|te|ten|en|erei|ereien)?(?![A-Za-zÄÖÜäöüß])/i;
const H1_RE     = /<h1[\s>]/i;

const woerter = s => String(s ?? '').toLowerCase().split(/[^a-zäöüß0-9]+/i).filter(Boolean);

/**
 * @param {object}   e
 * @param {string}   e.kurzbeschreibung
 * @param {string}   e.produktbeschreibung
 * @param {string}   [e.produktname]
 * @param {string}   [e.keyphrase]
 * @param {string}   [e.nurIntern]      Motive.Nur_intern (nie im Prompt)
 * @param {string[]} [e.marken]         SKU_LShop.Brand
 * @param {string[]} [e.modellnummern]  CatalogNr + CatNrManufacturer
 * @param {boolean}  [e.druck]          Motiv beschreibt einen Druck
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

  // 4. Zeitangabe mit Zahl
  for (const [n, html] of teile) {
    const m = ZEIT_RE.exec(text(html));
    if (m) hinweise.push(`Zeitangabe "${m[0]}" in ${n} – keine Liefer- oder Bearbeitungszeiten nennen.`);
  }

  // 5. <h1>
  const mitH1 = teile.filter(([, html]) => H1_RE.test(String(html ?? ''))).map(([n]) => n);
  if (mitH1.length) hinweise.push(`<h1> in ${mitH1.join(' und ')} – die H1 ist der Produkttitel der Seite.`);

  // 6. Stick bei Druck
  if (e.druck) melde(STICK_RE, 'Das Motiv ist gedruckt, der Text spricht von Stick/bestickt');

  return hinweise;
}
