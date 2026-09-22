// Hat ein Artikel Variantenachsen, muss eine davon die Farbe sein.
//
// Anlass: BCWU03K wurde am 22.09. ohne Farbachse angelegt; die Varianten-SKU
// lautete BCWU03K/CH-Skyline-4xl statt ...-schwarz-4xl. Der SKU-Bau war
// korrekt, die Erfassung unvollstaendig - es gab schlicht keine Stelle, die
// das Fehlen der Achse bemerkt haette.
//
// Grundlage ist die Entscheidung vom 21.09.: Farbe wird als Variantenachse
// gefuehrt, auch bei nur EINER Farbe. Die L-Shop-Nummer haengt an
// Modell + Farbe + Groesse, das Bild haengt an der Farbe.
//
// Die Regel gilt nur, wenn es ueberhaupt Achsen gibt. Ein Artikel ganz ohne
// Achsen - Puck, Kuscheltier, Fan-Schal - ist ein gueltiger Fall und bleibt es.

// ⚠️ EXAKTER Vergleich, kein Teilstring. Die SSOT (Sheet-Reiter
// Struktur_Attribute) fuehrt VIER Eigenschaften mit "farbe" im Namen, aber nur
// eine ist die Artikelfarbe:
//
//   Farbe                    47 Begriffe   <- die Artikelfarbe
//   Druckfarbe               14 Begriffe   Motivfarbe
//   Farbe des Wunschnamens    9 Begriffe   Beflockungsfarbe
//   Schriftfarbe              9 Begriffe
//
// Ein Teilstring-Vergleich liesse einen Artikel mit den Achsen
// "Groesse + Druckfarbe" die Regel bestehen, obwohl er keine Artikelfarbe hat -
// genau der Fehler aus dem Anlass, nur schweigend bestanden. Die Negativtests
// in backend/tests/farbachse.test.js halten das fest.
export const FARB_ACHSE = 'Farbe';

const vergleichsform = (name) => String(name ?? '').trim().toLowerCase();

/**
 * Ist dieser Achsenname die Artikelfarbe?
 * Gross/Klein und Rand-Leerzeichen egal, sonst exakt.
 */
export function istFarbAchse(name) {
  return vergleichsform(name) === vergleichsform(FARB_ACHSE);
}

/**
 * Achsennamen aus den Produkt-Attributen.
 *
 * Nur Attribute mit variation !== false sind Achsen. Ein Attribut, das nur als
 * Datenblatt-Zeile am Produkt haengt, ist keine Variantenachse und darf die
 * Regel weder erfuellen noch ausloesen.
 *
 * @param {Array} attribute WooCommerce-Form [{ name, variation }]
 * @returns {string[]} Namen in Originalschreibweise, ohne Dubletten.
 */
export function achsenAusAttributen(attribute) {
  const namen = [];
  for (const a of Array.isArray(attribute) ? attribute : []) {
    if (!a || a.variation === false) continue;
    const name = String(a.name ?? '').trim();
    if (name && !namen.some(v => vergleichsform(v) === vergleichsform(name))) namen.push(name);
  }
  return namen;
}

/**
 * Achsennamen aus den Varianten. Drei Schreibweisen wie in sku.js:
 * {attrs} aus dem Frontend, {attributes} aus dem WooCommerce-Format.
 *
 * @returns {string[]} Namen in Originalschreibweise, ohne Dubletten.
 */
export function achsenAusVarianten(varianten) {
  const namen = [];
  for (const v of Array.isArray(varianten) ? varianten : []) {
    for (const a of (v?.attrs ?? v?.attributes ?? [])) {
      const name = String(a?.name ?? '').trim();
      if (name && !namen.some(x => vergleichsform(x) === vergleichsform(name))) namen.push(name);
    }
  }
  return namen;
}

/**
 * Alle Achsen eines Artikels: Produkt-Attribute und Varianten zusammen.
 * Beide Quellen, weil der Aenderungspfad auch ein reines Attribut-Update
 * schickt (Frontend: "Neue Varianten anlegen") und der Anlagepfad beides.
 */
export function achsenVon({ attribute, varianten } = {}) {
  const namen = achsenAusAttributen(attribute);
  for (const n of achsenAusVarianten(varianten)) {
    if (!namen.some(v => vergleichsform(v) === vergleichsform(n))) namen.push(n);
  }
  return namen;
}

/**
 * Sind das dieselben Achsen? Reihenfolge egal, Gross/Klein egal.
 * Fuer den Aenderungspfad: verglichen wird gegen den SHOP-Stand, nicht gegen
 * die Erfassungsmaske - die fuehrt gar keine Achsenspalte.
 */
export function achsenGleich(a, b) {
  const x = (Array.isArray(a) ? a : []).map(vergleichsform).filter(Boolean).sort();
  const y = (Array.isArray(b) ? b : []).map(vergleichsform).filter(Boolean).sort();
  return x.length === y.length && x.every((w, i) => w === y[i]);
}

/**
 * Die Regel selbst.
 *
 * Keine Achse  -> null. Die Regel greift nicht; das ist ein gueltiger Artikel.
 * Achsen da    -> eine davon muss exakt "Farbe" sein.
 *
 * @param {string[]} achsen Achsennamen.
 * @returns {{feld: string, fehler: string}|null} null = in Ordnung.
 */
export function pruefeFarbAchse(achsen) {
  const namen = (Array.isArray(achsen) ? achsen : [])
    .map(n => String(n ?? '').trim())
    .filter(Boolean);

  if (!namen.length) return null;                 // keine Achse - Regel greift nicht
  if (namen.some(istFarbAchse)) return null;

  return {
    feld:   'Variantenachsen',
    fehler: `Der Artikel hat Variantenachsen (${namen.join(', ')}), aber keine davon ist `
          + `"${FARB_ACHSE}". Farbe wird als Achse gefuehrt, auch bei nur einer Farbe: die `
          + 'L-Shop-Nummer haengt an Modell + Farbe + Groesse, das Bild an der Farbe. '
          + 'Achtung: Druckfarbe, Schriftfarbe und Farbe des Wunschnamens zaehlen NICHT.',
  };
}
