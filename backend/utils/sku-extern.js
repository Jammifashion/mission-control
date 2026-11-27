// SG3: Fremdware aus dem Reiter SKU_Extern fuer den SEO-Weg (nur lesen, reine Logik).
//
// Der SEO-Reiter kannte bisher nur L-Shop-Modelle: eine Tasse aus SKU_Extern galt als "Material fehlt im
// L-Shop-Modell". Hier wird aus einer SKU_Extern-Zeile, was der Generator braucht: Material (Consistence),
// Gewicht, Masse, Volumen, Eigenschaften_Shop und die Lieferzeit als Vorschlag.
// NIE in den Prompt und nie an den Browser: Nur_intern, Lieferant (Merkposten Inhaber: Lieferant, Herstellercodes,
// Markennamen stehen nie in Shop-Texten). Die Felder werden hier gar nicht erst gelesen (FELDER_EXTERN).

const t = v => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Feld -> Spaltenname in SKU_Extern. ArticleNr ist Pflicht, alles andere optional (fehlt die Spalte, fehlt das Feld). */
export const SPALTEN_EXTERN = { articleNr: 'ArticleNr' };
export const OPTIONAL_EXTERN = {
  catalogNr: 'CatalogNr', material: 'Consistence', gewicht: 'Weight', masse: 'Masse', volumen: 'Volumen',
  eigenschaften: 'Eigenschaften_Shop', lieferzeitId: 'Lieferzeit_ID', name: 'Description',
};
/** Spalten, die der SEO-Weg bewusst NICHT liest (Test). */
export const NIE_LESEN = ['Nur_intern', 'Lieferant'];

/** Textilfaser als eigenes Wort ("Kunststoff", "Acrylglas" zaehlen nicht). Spiegel im Frontend: PH_TEXTIL_RE. */
export const TEXTIL_FASER_RE = /(^|[^A-Za-zÄÖÜäöüß])(baumwolle|bio-baumwolle|polyester|elasth?an|spandex|viskose|wolle|schurwolle|leinen|modal|polyacryl|acryl|nylon|polyamid|seide|lyocell|tencel)(?![A-Za-zÄÖÜäöüß])/i;

const schluessel = v => t(v).toLowerCase();

/** Zeile zur Nummer: ArticleNr genau (ohne Gross/Klein), sonst CatalogNr - nur wenn genau EINE Zeile sie traegt oder alle dasselbe sagen. */
export function findeExternZeile(zeilen, nr) {
  const k = schluessel(nr);
  if (!k) return null;
  const liste = Array.isArray(zeilen) ? zeilen : [];
  const genau = liste.filter(z => schluessel(z.articleNr) === k);
  if (genau.length) return genau[0];
  const modell = liste.filter(z => schluessel(z.catalogNr) === k);
  return modell.length ? modell[0] : null;
}

const HTML_RE = /[<>[\]\u0000-\u001f]/g;
const sauber = (v, max) => t(String(v ?? '').replace(HTML_RE, ' ')).slice(0, max);

/**
 * Angaben fuer Maske und Generator - feste Feldauswahl.
 * @returns {{ nr, material, textil, zeilen: string[], lieferzeitId }|null}
 */
export function externEingaben(zeile) {
  if (!zeile) return null;
  const material = sauber(zeile.material, 200);
  const zeilen = [];
  const gewicht = sauber(zeile.gewicht, 60), masse = sauber(zeile.masse, 80), volumen = sauber(zeile.volumen, 60);
  if (gewicht) zeilen.push(`Gewicht: ${/[a-zA-Z]/.test(gewicht) ? gewicht : `${gewicht} g`}`);
  if (masse) zeilen.push(`Maße: ${masse}`);
  if (volumen) zeilen.push(`Volumen: ${volumen}`);
  for (const l of String(zeile.eigenschaften ?? '').split(/\r?\n|;/).map(x => sauber(x, 200)).filter(Boolean).slice(0, 12))
    zeilen.push(l.includes(':') ? l : `Eigenschaften: ${l}`);   // meist eine Aufzaehlung ohne Label (gemessen 21.11.) - mit Label in den Prompt
  const lz = t(zeile.lieferzeitId);
  return {
    nr: t(zeile.articleNr),
    material,
    textil: TEXTIL_FASER_RE.test(material),
    zeilen,
    lieferzeitId: /^\d+$/.test(lz) ? lz : '',
  };
}

/**
 * Gilt die Prozentpflicht (EU-Textilkennzeichnung)? Ja, ausser der Artikel ist Fremdware aus SKU_Extern OHNE
 * Textilfaser und OHNE Groessen-Achse. Unbekannte Nummer / kein Eintrag = wie bisher (Pflicht).
 */
export function prozentPflicht({ extern, groessen } = {}) {
  const hatGroessen = Array.isArray(groessen) ? groessen.some(g => t(g)) : !!t(groessen);
  if (hatGroessen) return true;
  return !(extern && !extern.textil);
}

/** Zeilen aus SKU_Extern vor den Freitext "Eigenschaften" stellen - ein Label, das der Freitext schon nennt, gewinnt dort. */
export function eigenschaftenMitExtern(eigenschaften, extern) {
  const frei = String(eigenschaften ?? '');
  if (!extern?.zeilen?.length) return frei;
  const labels = new Set(frei.split('\n').map(l => schluessel(l.split(/[:\t]/)[0])).filter(Boolean));
  const neu = extern.zeilen.filter(l => !l.includes(':') || !labels.has(schluessel(l.split(':')[0])));
  return [...neu, frei].filter(x => x.trim()).join('\n');
}

// ── ZW2 Teil D: Trefferliste in der Maske und "als Fremdware anlegen" ─────────────────────────────────────────────────────
export const EXTERN_TREFFER_MAX = 20;

/** Suche in SKU_Extern: ab 2 Zeichen, ArticleNr/CatalogNr/Name enthaelt das Wort. -> [{ nr, catalogNr, name }] (nie Nur_intern/Lieferant) */
export function sucheExtern(zeilen, q) {
  const k = schluessel(q);
  if (k.length < 2) return { treffer: [], mehr: false };
  const liste = (Array.isArray(zeilen) ? zeilen : []).filter(z => [z.articleNr, z.catalogNr, z.name].some(x => schluessel(x).includes(k)));
  liste.sort((a, b) => (schluessel(b.articleNr) === k) - (schluessel(a.articleNr) === k) || t(a.articleNr).localeCompare(t(b.articleNr)));
  return {
    treffer: liste.slice(0, EXTERN_TREFFER_MAX).map(z => ({ nr: t(z.articleNr), catalogNr: t(z.catalogNr), name: sauber(z.name, 120) })),
    mehr: liste.length > EXTERN_TREFFER_MAX,
  };
}

/** Spalten, die "als Fremdware anlegen" schreibt (Inhaber 27.11., Antwort 4a: Rest von Hand im Sheet). */
export const EXTERN_NEU_SPALTEN = { articleNr: 'ArticleNr', name: 'Description', material: 'Consistence', lieferzeitId: 'Lieferzeit_ID' };

/**
 * Eingabe pruefen. -> { fehler } | { werte: { ArticleNr, Description, Consistence, Lieferzeit_ID } }
 * ArticleNr 2-40 Zeichen ohne Leerzeichen und ohne "/" (sonst kollidiert sie mit der Artikelnummer <Modell>/<Kuerzel>).
 */
export function externNeuPruefen(eingabe, { zeilen = [], lshopModelle = new Set(), lieferzeiten = null } = {}) {
  const nr = t(eingabe?.articleNr);
  const name = sauber(eingabe?.name, 120);
  const material = sauber(eingabe?.material, 200);
  const lz = t(eingabe?.lieferzeitId);
  if (!/^[^\s/]{2,40}$/.test(nr)) return { fehler: 'Artikelnummer: 2–40 Zeichen, ohne Leerzeichen und ohne „/“.' };
  if (name.length < 2) return { fehler: 'Name fehlt.' };
  if (lz && !/^\d+$/.test(lz)) return { fehler: 'Lieferzeit ungültig.' };
  if (lz && lieferzeiten && !lieferzeiten.has(lz)) return { fehler: `Lieferzeit ${lz} gibt es nicht.` };
  const k = schluessel(nr);
  if ((Array.isArray(zeilen) ? zeilen : []).some(z => schluessel(z.articleNr) === k || schluessel(z.catalogNr) === k))
    return { fehler: `${nr} steht schon in SKU_Extern.`, code: 'schon_da' };
  if (lshopModelle.has(k)) return { fehler: `${nr} ist ein L-Shop-Modell – keine Fremdware.`, code: 'lshop' };
  return { werte: { ArticleNr: nr, Description: name, Consistence: material, Lieferzeit_ID: lz } };
}
