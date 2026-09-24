// SEO-Prompt-Aufbereitung für action=seo_description (backend/routes/claude.js).
//
// Hier passiert die Datenaufbereitung, die NICHT dem Modell überlassen wird:
// Der Materialstring aus dem Herstellerkatalog enthält oft farbspezifische
// Ausnahmen in Klammern, z.B.
//   "85% Baumwolle, 15% Viskose (Grau meliert: 60% Baumwolle, 40% Polyester)"
// Wird die Farbe "Grau meliert" für diesen Artikel gar nicht angeboten, ist die
// Ausnahme im Prompt nur eine Falle – das Modell baut sie sonst in die
// Pflichtangabe ein. Also raus damit, bevor der Prompt gebaut wird.
//
// Dazu zwei weitere Aufgaben:
//  * Sperrliste und Größenzeilen fliegen aus den Eigenschaften, bevor
//    irgendetwas gebaut wird. Es gibt genau EINE Filterstelle, weil jede Zeile
//    sonst über das Sammelfeld "Weitere Eigenschaften" doch wieder im Prompt
//    landet.
//  * pruefeSeoText() prüft die Modellantwort deterministisch nach. Regeln, die
//    nur im Prompt stehen, werden vom Modell still gebrochen – geprüft wird
//    darum im Code, und das Ergebnis wird gemeldet, nicht verschluckt.

import { sortiereGroessen } from './groessen.js';

export const MATERIAL_PLACEHOLDER = '[Material: bitte ergänzen]';

// Befehl F2: sichtbarer Hinweis, wenn eine Faserangabe mit Prozent GANZ fehlt.
// Die Nachbedingung in filterMaterialFarbenMitMeldung meldet nur, wenn der
// Filter eine vorhandene Prozentangabe entfernt hat - wo nie eine war, schwieg
// sie bisher.
export const FASER_FEHLT_HINWEIS =
  'Keine Faserangabe mit Prozent gefunden – Pflichtangabe bei Textilien. '
  + 'Bitte im Feld Eigenschaften ergänzen (z. B. 100 % Baumwolle).';
export const MOTIV_PLACEHOLDER    = 'keine Angabe – Motiv nicht erfinden';

// MODUS ist ein fester Enum, kein Freitext.
//   kollektion – fertiger Shop-Artikel (auch Vereinsartikel). KEIN Freigabe-
//                Hinweis: die Freigabe vor dem Druck gilt für eigene
//                Kollektionen ausdrücklich nicht.
//   auftrag     – Kundenauftrag mit Layout-Freigabe vor dem Druck.
// Ein Tippfehler darf den Modus nicht still umlegen – sonst verspricht der Text
// dem Kunden einen Prozess, den es für diesen Artikel nicht gibt. Deshalb
// meldet resolveModus() jeden unbekannten oder fehlenden Wert.
export const MODUS_KOLLEKTION = 'kollektion';
export const MODUS_AUFTRAG    = 'auftrag';
export const MODI = [MODUS_KOLLEKTION, MODUS_AUFTRAG];

// Höchstlänge der <h2>. Die H1 der Seite ist bereits der Produkttitel, die
// <h2> ist nur eine Zwischenüberschrift für den Abschnitt.
export const H2_MAX_WOERTER = 8;

// Anzahl Wörter am Anfang der Kurzbeschreibung, in denen die Keyphrase stehen
// muss.
export const KEYPHRASE_FENSTER = 10;

const FREIGABE_HINWEIS =
  'FREIGABE:\n' +
  'Schließe mit einem Satz in <p>, dass wir das Layout vor dem Druck zur ' +
  'Freigabe schicken. Keine Datumsangaben, keine Lieferzusagen.';

// Befehl SP1 (24.09.): Fanart darf den Serientitel nennen – aber NUR, wenn er
// woertlich als "Fanart zur Serie <Titel>" im Hinweisblock steht, und dann in
// genau dieser Form. Ohne diese Wendung gilt das Titelverbot unveraendert.
//
// ⚠️ Das Wort "offiziell" (auch verneint) steht absichtlich NICHT im Prompt.
// GEMESSEN (BL7, 24.09.): jedes "nie offiziell" in der Eingabe kam als "kein
// offizielles Merch" / "inoffizielle Fanart" im Text an. Darum nur positiv:
// "als Fanart kennzeichnen, sonst keine Aussage zu Lizenz oder Herkunft".
const FANART_RE = /Fanart zur Serie\s+(„[^“]+“|"[^"]+"|[^\n–—;.,]+?)(?=\s*(?:[–—;.,]|\s-\s|\n|$))/g;

/**
 * Alle Wendungen "Fanart zur Serie <Titel>" aus dem Hinweisblock, woertlich.
 * Titel in „…“ oder "…" bleiben samt Anfuehrungszeichen; sonst endet der Titel
 * am ersten Gedankenstrich, Komma, Semikolon, Punkt oder Zeilenende.
 * @returns {{ wendung: string, titel: string }[]}
 */
export function fanartSerien(hinweise) {
  const out = [];
  for (const m of String(hinweise ?? '').matchAll(FANART_RE)) {
    const titel = m[1].trim();
    const wendung = `Fanart zur Serie ${titel}`;
    if (titel && !out.some(x => x.wendung === wendung)) out.push({ wendung, titel });
  }
  return out;
}

/**
 * Block FANART-SERIE fuer den User-Prompt – oder '' ohne Wendung im Hinweis.
 * SP2: Die Ausnahme vom Titelverbot steht NUR hier, nicht im Systemprompt.
 * GEMESSEN (BL7 Lauf 2): stand die Wendung im Systemprompt, schrieb das Modell
 * auch bei Artikeln ohne Serie "Fanart zur Serie." – ohne Titel.
 */
export function fanartBlock(hinweise) {
  const serien = fanartSerien(hinweise);
  if (!serien.length) return '';
  return [
    'FANART-SERIE (Ausnahme vom Titelverbot, nur für diesen Artikel):',
    ...serien.map(s => `- Nenne die Serie genau in dieser Form und Schreibweise: ${s.wendung}`),
    '- Nur diesen Titel, keinen anderen. Den Artikel als Fanart kennzeichnen, sonst keine Aussage zu Lizenz oder Herkunft.',
    '- Keine Figurennamen, keine Handlung, keine Schauspieler:innen.',
  ].join('\n');
}

// Systemprompt fuer action=seo_description. Hier, nicht in routes/claude.js,
// damit die Regeln an einer Stelle stehen und testbar sind.
export const SEO_SYSTEM_PROMPT = `Du bist SEO-Texter für jammifashion.de. Der Artikel ist ein FERTIG BEDRUCKTES
Textil – genau so wird er verkauft.

WICHTIG:
- NICHT schreiben: "individuell bedruckbar", "personalisierbar",
  "jetzt selbst gestalten"
- Schreibe als würdest du einen fertigen Markenartikel beschreiben –
  der Druck IST der Artikel
- Beschreibe das MOTIV: was ist darauf zu sehen. Bei einem fertig bedruckten
  Artikel ist das Motiv das Produkt, nicht der Stoff.
- Ton: duzen, norddeutsch-direkt, trocken. Zielgruppe aus den Hinweisen ableiten.
- VERBOTENE FLOSKELN, nie verwenden: "Must-have", "Party-Kracher",
  "absoluter Hingucker", "Blickfang", "hochwertige Qualität",
  "maximaler Tragekomfort", "schnell und zuverlässig", "sichere dir jetzt",
  "Lieblings-". Prüfung: Lässt sich ein Satz streichen, ohne dass Information
  verloren geht, gehört er gestrichen.
- Höchstens ein Ausrufezeichen im ganzen Text, lieber keins.
- Konkrete Zahlen schlagen Adjektive: "280 g/m², innen angeraut" statt
  "kuschelig warm".

MATERIAL – Rechtspflicht (EU-Verordnung 1007/2011):
- Faserzusammensetzung MUSS enthalten sein, mit Prozentangaben und nur mit
  den Faserbezeichnungen dieser Verordnung (z.B. Baumwolle, Polyester, Viskose)
- Übernimm NUR Angaben zu Farben, die unter FARBEN gelistet sind.
  Farbspezifische Ausnahmen für nicht angebotene Farben werden weggelassen.
- Übernimm keine Herstellerkatalogfelder, die diesen Artikel nicht beschreiben
  (z.B. "Farbigkeit: 1-farbig, Meliert, Pastell")
- Wenn Material unbekannt: "[Material: bitte ergänzen]". Niemals raten,
  niemals plausibel ergänzen.

WEITERES:
- Keine AGB erwähnen – es gibt bewusst keine
- Keine konkreten Liefer- oder Bestellschlussdaten. Lieferzeit nur als Spanne.
- Keine fremden Marken, Filmtitel oder geschützten Figuren, auch nicht
  nachempfunden oder angedeutet
- HTML nur: <h2>, <h3>, <p>, <ul>, <li>, <strong> – KEIN <h1>, KEIN Markdown,
  KEIN Codeblock
- JSON-Output MUSS valides JSON sein: Zeilenumbrüche und Anführungszeichen in
  HTML escapen
- KEINE echten/rohen Zeilenumbrüche, Tabs oder Steuerzeichen innerhalb der
  JSON-Strings – ausschließlich escaped (\\n, \\r, \\t)
- Antworte NUR mit dem JSON-Objekt`;

// Labels vor einem Doppelpunkt, die keine Farbe benennen. Ohne diese Liste
// würde "(Pflege: 30°C Schonwaschgang)" als Ausnahme für eine unbekannte Farbe
// namens "Pflege" gelesen und stillschweigend gelöscht.
// "farbe"/"farben" stehen mit drin: das Label FÜHRT eine Farbe ein, es IST
// keine – "Farbe: Off-White" darf nicht als Ausnahme für "Off-White" gelten.
const NON_COLOR_LABELS = new Set([
  'material', 'materialien', 'pflege', 'pflegehinweis', 'hinweis', 'hinweise',
  'achtung', 'farbigkeit', 'farbe', 'farben', 'gewicht', 'grammatur',
  'groesse', 'groessen', 'qualitaet', 'stoff', 'art', 'passform', 'schnitt',
  'druck', 'drucktechnik', 'herkunft', 'zusammensetzung', 'futter',
  'einfassung',
]);

// Zusammengesetzte Köpfe: ein Label ist auch dann ein Sachlabel, wenn eines
// seiner Wörter DARAUF ENDET. "Materialzusammensetzung" fällt so unter
// Material, ohne dass die Liste jede Zusammensetzung einzeln kennen muss.
//
// ⚠️ Geprüft wird auf ganzen Wörtern der normalisierten Form, nie als
// Teilstring irgendwo in der Zeile: "Black Smoke" darf nicht dadurch zum
// Sachlabel werden, dass anderswo "Stoff" vorkommt.
const SACHLABEL_KOEPFE = ['zusammensetzung', 'stoff', 'buendchen', 'panel'];

// Farbwörter für FREIE Klauseln (Punkt 4). In der Klammer reicht die
// Umkehrprobe "kein Sachlabel" – dort ist die Form schon ein Indiz. Mitten im
// Fließtext ist sie es nicht, deshalb wird hier POSITIV verlangt, dass das
// Label wie eine Farbe liest. Lieber eine fremde Farbe stehen lassen als eine
// Pflichtangabe löschen.
const FARB_WOERTER = new Set([
  'grey', 'gray', 'grau', 'heather', 'charcoal', 'black', 'schwarz', 'white',
  'weiss', 'navy', 'blau', 'blue', 'rot', 'red', 'gruen', 'green', 'smoke',
  'ash', 'melange', 'meliert', 'anthrazit', 'beige', 'braun', 'brown', 'gelb',
  'yellow', 'pink', 'lila', 'purple', 'orange', 'silber', 'silver', 'gold',
  'natur', 'natural', 'creme', 'cream', 'royal', 'bordeaux', 'petrol',
  'tuerkis', 'khaki', 'oliv', 'sand', 'marine', 'denim', 'stone',
]);

// Faserbezeichnung mit Prozentwert – "85% Baumwolle", "100 % Polyester",
// auch "0% Baumwolle" (der Datenfehler bei 13270 ist trotzdem eine Angabe).
// Bewusst generisch statt Faserliste: eine Liste kennt Tencel oder Modal
// irgendwann nicht, und dann SPANNT SICH DAS NETZ AUS PUNKT 1 GAR NICHT ERST
// AUF. Die generische Form spannt es für jede Materialangabe auf, die
// überhaupt nach Zusammensetzung aussieht.
const FASER_RE = /\d{1,3}\s*%\s*[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]{2,}/;

// "Name: 85% Baumwolle …" – eine freie Klausel ÜBERALL in der Zeile, nicht nur
// am Anfang (sonst entgeht 13251). Das Label umfasst höchstens vier Wörter und
// kann keinen Doppelpunkt überspringen, der Wert muss DIREKT mit einer
// Faserangabe beginnen (Bedingung (b)).
const FREIE_KLAUSEL_RE =
  /([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9®\-]*(?:\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9®\-]*){0,3})\s*:\s*(\d{1,3}\s*%[^:]*)/g;

const MATERIAL_LINE_RE  = /material|baumwolle|polyester/i;
// "Farben:", "Farbe:", "Farbe(n):" – die beiden letzten Schreibweisen traf das
// alte Muster nicht, weil nach "farbe" sofort ein ":" verlangt wurde. Folge:
// das Label blieb im Wert stehen und landete als "Farben: Farbe(n): Schwarz"
// in der Detailliste.
const FARB_LABEL_RE     = /^\s*(?:farbe\(n\)|farben|farbe|colou?r\(s\)|colou?rs|colou?r)\s*:\s*/i;
// Schreibweisen des Labels: "Größen:", "Grössen:", "Groessen:", "Size(s):".
// Das ß braucht einen eigenen Zweig – es ist EIN Zeichen, kein "ss".
const GROESSEN_LABEL_RE = /^\s*(gr(?:ö|oe)(?:ß|ss|s)?en?|sizes?)\s*:\s*/i;

// Sperrliste: Katalogfelder, die die Baureihe beschreiben, nicht diesen
// Artikel. "Farbigkeit: 1-farbig, Meliert, Pastell" liest das Modell sonst als
// Produktmerkmal und schreibt es mit. Geprüft wird die ganze Zeile.
const SPERR_BEGRIFFE = ['farbigkeit', 'veredelungsangabe', 'verarbeitung'];

// Zielgruppen-Wörter im Produkttitel: "Ugly Sweater Rentier Herren" ohne
// Zielgruppe ist "Ugly Sweater Rentier". Beide Formen darf die <h2> nicht
// tragen.
const ZIELGRUPPEN = new Set([
  'herren', 'damen', 'kinder', 'unisex', 'maenner', 'frauen', 'jungen',
  'maedchen', 'baby', 'babys', 'jungs',
]);

// Generische Größenkürzel – für "Produkttitel ohne Farbe/Größe".
const GROESSEN_TOKEN_RE = /^(xs|xxs|s|m|l|xl|xxl|xxxl|[0-9]+xl|gr|groesse|groessen)$/;

// Vergleichsform: Umlaute auflösen, Satzzeichen weg, klein. "Grau-meliert" und
// "grau meliert" sind damit dasselbe.
export function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const normalizeFarbe = normalize;

// Normalisierte Wortliste. Grundlage jedes Vergleichs hier: verglichen wird auf
// ganzen Wörtern, nie als Teilstring – "Shirt" darf nicht in "T-Shirts" treffen.
function woerterVon(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

// Enthält die Wortfolge `needle` als zusammenhängende Folge in `hay`?
function enthaeltWortfolge(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i <= hay.length - needle.length; i++) {
    if (needle.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
}

function stripHtml(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Der Einleitungstext: das erste <p> NACH der <h2> (SP2). Die <h2> zählt
// ausdrücklich NICHT als erster Satz – sie darf den Titel ja gerade nicht
// tragen. Loser Text VOR der <h2> zählt auch nicht (BL7 Lauf 2: das Modell
// zog den Keyphrase-Satz vor die Überschrift).
function einleitung(html) {
  const text = String(html ?? '');
  const h2Ende = text.search(/<\/h2>/i);
  const nachH2 = h2Ende >= 0 ? text.slice(h2Ende + 5) : text;
  const p = nachH2.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (p) return stripHtml(p[1]);
  return stripHtml(nachH2.replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, ' '));
}

// Titelvergleich fuer pruefeH2: "/", "&", Bindestriche, Mehrfach-Leerzeichen
// macht normalize() schon gleich; "und"/"and" fallen zusaetzlich weg, damit
// "Jack & Joker", "Jack und Joker" und "Jack/Joker" dieselben Woerter ergeben.
const titelWoerterVon = text => woerterVon(text).filter(w => w !== 'und' && w !== 'and');

// Stehen alle Woerter von `needle` in dieser Reihenfolge in `hay`, mit
// hoechstens `luecke` fremden Woertern dazwischen? Faengt "Jack Joker FANART
// T-Shirt" gegen den Titel "Jack/Joker T-Shirt" (BL7 Lauf 2, 12623).
function enthaeltInReihenfolge(hay, needle, luecke) {
  for (let start = 0; start < hay.length; start++) {
    if (hay[start] !== needle[0]) continue;
    let j = 1, fremd = 0;
    for (let i = start + 1; i < hay.length && j < needle.length; i++) {
      if (hay[i] === needle[j]) j++;
      else if (++fremd > luecke) break;
    }
    if (j === needle.length) return true;
  }
  return false;
}

function ersterSatz(text) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const treffer = t.split(/(?<=[.!?])\s+/);
  return treffer[0] ?? t;
}

function h2Inhalt(html) {
  const m = String(html ?? '').match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  return m ? stripHtml(m[1]) : null;
}

/**
 * MODUS auf den Enum abbilden. Fällt nie durch, meldet aber jeden Wert, der
 * nicht sauber getroffen hat.
 *
 * @param {*} input Rohwert aus dem Request.
 * @returns {{ modus: string, warnung: string|null }}
 */
export function resolveModus(input) {
  const roh = input == null ? '' : String(input).trim();

  if (!roh) {
    return {
      modus: MODUS_KOLLEKTION,
      warnung: `MODUS fehlt – "${MODUS_KOLLEKTION}" angenommen, kein Freigabe-Hinweis im Text. ` +
               `Erlaubt: ${MODI.join(', ')}.`,
    };
  }

  const normalisiert = roh.toLowerCase();
  if (MODI.includes(normalisiert)) return { modus: normalisiert, warnung: null };

  return {
    modus: MODUS_KOLLEKTION,
    warnung: `MODUS "${roh}" ist unbekannt – "${MODUS_KOLLEKTION}" angenommen, kein Freigabe-Hinweis ` +
             `im Text. Erlaubt: ${MODI.join(', ')}.`,
  };
}

// Gemeinsame Zerlegung für Farb- und Größenlisten.
//
// Array = Variantenauswahl, und die ist die Wahrheit: jeder Eintrag ist EIN
// Wert, es wird nicht weiter getrennt – nur getrimmt, Leeres und Dubletten
// fallen weg. "Weiß/Pink" ist eine Farbe, "110/116" eine Kindergröße.
//
// Text (mehrzeilig oder "Farben: Schwarz, Navy") wird nur an "," und ";"
// getrennt. "/" und "|" gehören zum Namen bzw. zur Größe – früher zerfiel hier
// "Weiß/Pink" in zwei Farben und "110/116" in zwei Zahlen.
function parseListe(input, labelRe) {
  const teile = Array.isArray(input)
    ? input.map(e => String(e ?? '').trim())
    : String(input ?? '').split('\n')
        .flatMap(zeile => zeile.replace(labelRe, '').split(/[,;]/))
        .map(teil => teil.trim().replace(/[.\s]+$/, ''));
  const out = [];
  for (const name of teile) {
    if (!name) continue;
    if (!out.some(vorhanden => normalize(vorhanden) === normalize(name))) {
      out.push(name);
    }
  }
  return out;
}

/**
 * Farbliste aus Request-Feld oder aus den Eigenschaften-Zeilen lesen.
 * Akzeptiert Array, mehrzeiligen String oder "Farben: Schwarz, Navy".
 * @returns {string[]} Farbnamen in Originalschreibweise, ohne Dubletten.
 */
export function parseFarben(input) {
  return parseListe(input, FARB_LABEL_RE);
}

/**
 * Ist das eine Farbzeile aus dem Eigenschaften-Freitext?
 * Erkannt wird am LABEL vor dem Doppelpunkt, nicht am ganzen Text – sonst
 * träfe es auch "Farbigkeit: 1-farbig" (die steht auf der Sperrliste) oder
 * jeden Satz, in dem das Wort Farbe vorkommt.
 */
function istFarbZeile(zeile) {
  const lw = labelUndWert(zeile);                 // Doppelpunkt ODER Tab
  if (!lw) return false;
  const label = normalize(lw.label);              // "Farbe(n)" → "farbe n"
  if (label.includes('farbigkeit')) return false; // eigener Zweig: Sperrliste
  return /\bfarben?\b|\bcolou?rs?\b/.test(label);
}

/**
 * Farbliste aus den ROHEN Eigenschaften-Zeilen lesen.
 *
 * ⚠️ Muss VOR filterEigenschaften() laufen: die entfernt die Farbzeile, damit
 * sie nicht ein zweites Mal in der Detailliste landet. Ohne diesen Schritt
 * ginge die Farbliste für filterMaterialFarben verloren und der Prompt zeigte
 * "siehe Varianten" statt der echten Farben.
 *
 * Abgeschnitten wird am ersten Doppelpunkt oder Tab (labelUndWert), nicht am
 * Label-Muster – damit auch "Verfügbare Farben: Schwarz" den Wert sauber hergibt.
 */
export function farbenAusEigenschaften(lines) {
  const werte = (lines ?? [])
    .filter(istFarbZeile)
    .map(z => labelUndWert(z).wert);
  // Als TEXT weiterreichen, nicht als Array: die Zeile ist Freitext und wird
  // an "," und ";" getrennt ("Weiß/Pink, Schwarz" -> zwei Farben).
  return parseFarben(werte.join('\n'));
}

/**
 * Größenliste aus der Variantenauswahl lesen. Gleiches Format wie parseFarben.
 * @returns {string[]} Größen in Originalschreibweise, ohne Dubletten.
 */
export function parseGroessen(input) {
  return parseListe(input, GROESSEN_LABEL_RE);
}

/** Groessen fuer Prompt und Pruefung: zerlegt und aufsteigend (groessen.js). */
export function groessenFuerText(input) {
  return sortiereGroessen(parseGroessen(input)).sortiert;
}

/**
 * Stehen die Groessen im fertigen Text aufsteigend? Die Zeile "Größen: …"
 * schreibt das Modell (nach der Vorlage im Prompt) - also nachpruefen.
 * Geprueft werden die <li> mit "Größe(n):" und jede Spanne "X bis Y" in
 * Kurz- und Produktbeschreibung. Nur bekannte Groessen zaehlen.
 *
 * @returns {string[]} Meldungen, leer wenn alles passt.
 */
export function pruefeGroessenReihenfolge({ kurzbeschreibung, produktbeschreibung, groessen } = {}) {
  const soll = groessenFuerText(groessen);
  if (soll.length < 2) return [];
  const rang = w => soll.findIndex(g => g.toLowerCase() === String(w).trim().toLowerCase());
  const meldungen = [];

  for (const [, inhalt] of String(produktbeschreibung ?? '').matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = stripHtml(inhalt);
    const t = text.match(/^\s*gr(?:ö|oe)(?:ß|ss)en?\s*:\s*(.*)$/i);
    if (!t) continue;
    const ist = t[1].split(/\s*(?:,|;|\bund\b)\s*/).map(x => x.trim().replace(/\.$/, '')).filter(x => rang(x) >= 0);
    const r = ist.map(rang);
    if (r.some((x, i) => i > 0 && x < r[i - 1])) {
      meldungen.push(`Größen im Text nicht aufsteigend ("${ist.join(', ')}") – erwartet: ${soll.join(', ')}. Bitte prüfen.`);
    }
  }

  for (const html of [kurzbeschreibung, produktbeschreibung]) {
    for (const [, von, bis] of stripHtml(html).matchAll(/(\S+)\s+bis\s+(\S+)/gi)) {
      const a = rang(von), b = rang(bis.replace(/[.,;]$/, ''));
      if (a >= 0 && b >= 0 && b < a) {
        meldungen.push(`Größenspanne "${von} bis ${bis.replace(/[.,;]$/, '')}" ist absteigend – erwartet aufsteigend. Bitte prüfen.`);
      }
    }
  }
  return meldungen;
}

/**
 * Eigenschaften-Zeilen säubern, BEVOR daraus Material, <li>-Liste und
 * "Weitere Eigenschaften" gebaut werden. Genau eine Filterstelle: ein Filter
 * kurz vor der Ausgabe würde von der jeweils anderen Eintrittsstelle umgangen.
 *
 * Entfernt werden
 *  - Zeilen mit einem Sperrbegriff (Farbigkeit, Veredelungsangabe, Verarbeitung)
 *  - Zeilen, deren Label eine Größe benennt ("Größen: S–5XL", "Größenlauf<TAB>…").
 *    Größen kommen ausschließlich aus der Variantenauswahl.
 *  - Farbzeilen ("Farbe: …", "Farbe(n): …", "Farben: …"). Der Generator baut
 *    seit der Größen-Änderung selbst eine Zeile "Farben: …" in die Detailliste;
 *    blieb die handgetippte Zeile stehen, stand die Farbe zweimal da.
 *    ⚠️ Die Farbliste vorher mit farbenAusEigenschaften() auslesen.
 *
 * @param {string[]} lines Rohzeilen aus dem Eigenschaften-Freitext.
 * @returns {string[]}
 */
export function filterEigenschaften(lines) {
  return (lines ?? []).filter(zeile => {
    const ganzeZeile = normalize(zeile);
    if (!ganzeZeile) return false;
    if (SPERR_BEGRIFFE.some(b => ganzeZeile.includes(b))) return false;
    if (istFarbZeile(zeile)) return false;

    // Label am ersten Doppelpunkt ODER Tab: "Größenlauf<TAB>XS - 8XL" aus dem
    // L-Shop-Datenblatt faellt genauso raus wie "Größen: S–5XL". normalize()
    // macht aus ß und ö "ss"/"oe" - Größe, Grösse, Groesse treffen alle.
    const lw = labelUndWert(zeile);
    if (lw && /groesse|size/.test(normalize(lw.label))) return false;
    return true;
  });
}

/**
 * Das Hauptkeyword, auf das der Text geprüft wird.
 * Fokus-Keyphrase, wenn gesetzt – sonst der Produkttitel ohne Farbe und Größe.
 *
 * @returns {{ text: string, woerter: string[], ausTitel: boolean }}
 */
export function hauptKeyword({ keyphrase, produktname, farben, groessen } = {}) {
  const phrase = String(keyphrase ?? '').trim();
  if (phrase) return { text: phrase, woerter: woerterVon(phrase), ausTitel: false };

  const farbWoerter    = new Set(parseFarben(farben).flatMap(f => woerterVon(f)));
  const groessenWoerter = new Set(parseGroessen(groessen).flatMap(g => woerterVon(g)));

  const behalten = String(produktname ?? '').trim().split(/\s+/).filter(Boolean)
    .filter(wort => {
      const woerter = woerterVon(wort);
      if (!woerter.length) return false;
      // Ein Titelwort fliegt raus, wenn es komplett aus Farb-/Größenwörtern
      // besteht: "Navy", "XL", "Größe".
      return !woerter.every(w =>
        farbWoerter.has(w) || groessenWoerter.has(w) || GROESSEN_TOKEN_RE.test(w));
    });

  const text = behalten.join(' ');
  return { text, woerter: woerterVon(text), ausTitel: true };
}

/**
 * Deterministische Nachprüfung der Modellantwort. Verglichen wird auf ganzen
 * Wörtern, Groß/Klein und Umlaute egal.
 *
 * Geprüft wird:
 *  1. Keyphrase in den ersten zehn Wörtern der Kurzbeschreibung
 *  2. Keyphrase im ersten Satz der Produktbeschreibung
 *  3. <h2> ohne Produkttitel (auch ohne Zielgruppe) und höchstens 8 Wörter
 *  4. Größen aufsteigend (Befehl G)
 *
 * @returns {string[]} Meldungen, leer wenn alles passt.
 */
export function pruefeSeoText({
  kurzbeschreibung,
  produktbeschreibung,
  keyphrase,
  produktname,
  farben,
  groessen,
} = {}) {
  const meldungen = [];
  const keyword   = hauptKeyword({ keyphrase, produktname, farben, groessen });
  const quelle    = keyword.ausTitel ? 'Hauptkeyword (aus dem Titel)' : 'Fokus-Keyphrase';

  if (keyword.woerter.length) {
    const ersteWoerter = woerterVon(stripHtml(kurzbeschreibung)).slice(0, KEYPHRASE_FENSTER);
    const fehlendKurz  = keyword.woerter.filter(w => !ersteWoerter.includes(w));
    if (fehlendKurz.length) {
      meldungen.push(
        `${quelle} "${keyword.text}" steht nicht komplett in den ersten ${KEYPHRASE_FENSTER} ` +
        `Wörtern der Kurzbeschreibung (fehlt: ${fehlendKurz.join(', ')}).`
      );
    }

    const satzWoerter  = woerterVon(ersterSatz(einleitung(produktbeschreibung)));
    const fehlendSatz  = keyword.woerter.filter(w => !satzWoerter.includes(w));
    if (fehlendSatz.length) {
      meldungen.push(
        `${quelle} "${keyword.text}" fehlt im ersten Satz der Produktbeschreibung (erstes <p> nach der <h2>) ` +
        `(fehlt: ${fehlendSatz.join(', ')}).`
      );
    }
  }

  // Groessen-Reihenfolge: Hinweis wie Keyphrase, KEIN zweiter Lauf (der
  // haengt allein an pruefeH2).
  return [
    ...meldungen,
    ...pruefeGroessenReihenfolge({ kurzbeschreibung, produktbeschreibung, groessen }),
    ...pruefeH2(produktbeschreibung, produktname),
  ];
}

/**
 * Nur die <h2>-Regel. Eigene Funktion, weil ausschließlich SIE einen zweiten
 * Modellaufruf auslöst: die Keyphrase-Prüfung ist laut Framework ein Hinweis,
 * kein Fehler, und darf nichts wiederholen.
 *
 * @returns {string[]} Meldungen, leer wenn die <h2> in Ordnung ist.
 */
export function pruefeH2(produktbeschreibung, produktname) {
  const meldungen = [];
  const h2 = h2Inhalt(produktbeschreibung);

  if (h2 === null) {
    meldungen.push('Die Produktbeschreibung enthält keine <h2>.');
    return meldungen;
  }

  // SP2: vor der <h2> steht nichts. Teil DIESER Pruefung, damit beide
  // Verstoesse denselben einen Wiederholungslauf teilen.
  if (!/^<h2[\s>]/i.test(String(produktbeschreibung ?? '').trim())) {
    meldungen.push('Die Produktbeschreibung beginnt nicht mit <h2> – davor steht Text.');
  }

  const h2Woerter      = titelWoerterVon(h2);
  const titelWoerter   = titelWoerterVon(produktname);
  const ohneZielgruppe = titelWoerter.filter(w => !ZIELGRUPPEN.has(w));
  // Ab zwei Titelwoertern auch mit bis zu zwei eingeschobenen Woertern.
  const traf = w => w.length && (enthaeltWortfolge(h2Woerter, w) || (w.length >= 2 && enthaeltInReihenfolge(h2Woerter, w, 2)));

  if (titelWoerter.length && (traf(titelWoerter) || traf(ohneZielgruppe))) {
    meldungen.push(
      `Die <h2> enthält den Produkttitel ("${h2}") – sie soll eine kurze, sachliche ` +
      'Zwischenüberschrift sein, die H1 der Seite ist bereits der Titel.'
    );
  }
  const h2Anzahl = woerterVon(h2).length;   // zaehlt wie bisher, "und" eingeschlossen
  if (h2Anzahl > H2_MAX_WOERTER) {
    meldungen.push(
      `Die <h2> hat ${h2Anzahl} Wörter (höchstens ${H2_MAX_WOERTER}): "${h2}".`
    );
  }

  return meldungen;
}

/**
 * Korrekturblock für den EINEN Wiederholungslauf. Nennt den konkreten Verstoß,
 * nicht nur die Regel – der erste Lauf hatte die Regel ja schon im Prompt.
 */
export function h2KorrekturBlock(meldungen) {
  return [
    'KORREKTUR – der erste Entwurf hat die <h2>-Regel verletzt:',
    ...(meldungen ?? []).map(m => `- ${m}`),
    '',
    'Schreibe den Text neu. Die produktbeschreibung beginnt mit <h2>, davor steht nichts.',
    'Die Keyphrase steht im ersten Satz des ersten <p> nach der <h2>.',
    'Die <h2> enthält NICHT den Produkttitel,',
    `höchstens ${H2_MAX_WOERTER} Wörter, kein Slogan – sie benennt sachlich,`,
    'worum es im Abschnitt geht.',
    'falsch:  "Das <Produkttitel> für den Alltag"',
    'richtig: "Mehrfarbiger Brustdruck auf schwarzem Jersey"',
  ].join('\n');
}

/**
 * Benennt das Label eine Sache statt einer Farbe?
 *
 * Verglichen wird auf ganzen Wörtern der normalisierten Form – ein blindes
 * Teilstring-Matching würde "Black Smoke" zum Sachlabel machen, sobald
 * irgendwo "Stoff" auftaucht. Zusätzlich zählt ein zusammengesetzter Kopf:
 * "Materialzusammensetzung" endet auf "zusammensetzung" und fällt damit unter
 * Material, ohne dass die Liste jede Wortbildung einzeln kennen muss.
 */
function istSachlabel(label) {
  const woerter = woerterVon(label);
  return woerter.some(w =>
    NON_COLOR_LABELS.has(w) || SACHLABEL_KOEPFE.some(kopf => w.endsWith(kopf)));
}

/**
 * Liest das Label wie ein Farbname? Ein Wort genügt: "Sports Grey" ist über
 * "grey" eine Farbe, "Heather Grey" über beide.
 *
 * Nur für FREIE Klauseln gedacht. In der Klammer bleibt es bei der Umkehrprobe
 * "kein Sachlabel", sonst verlöre der Filter die Katalog-Ausnahmen mit
 * ausgefallenen Farbnamen, die dort seit jeher zuverlässig erkannt werden.
 */
function istFarbname(label) {
  return woerterVon(label).some(w => FARB_WOERTER.has(w));
}

/**
 * Steht in dem Text eine Faserbezeichnung mit Prozentwert?
 *
 * Grundlage der Nachbedingung aus Punkt 1: Die Faserzusammensetzung ist eine
 * gesetzliche Pflichtangabe. Greift diese Prüfung beim Ausgangswert, aber
 * nicht mehr beim gefilterten Ergebnis, hat der Filter die Pflichtangabe
 * entfernt – dann gilt der ungefilterte Wert und es gibt eine Meldung.
 *
 * Nicht exportiert: eine Heuristik als Netz, kein Parser für Materialangaben.
 */
function hatFaserangabe(text) {
  return FASER_RE.test(String(text ?? ''));
}

// Eine Klausel innerhalb der Klammer: "Grau meliert: 60% Baumwolle".
// Rückgabe: null = keine farbspezifische Ausnahme (unverändert behalten),
// sonst { farben, rest } mit den benannten Farben.
function parseAusnahme(klausel) {
  const treffer = klausel.match(/^([^:]{1,80}):\s*(.+)$/s);
  if (!treffer) return null;

  const label = treffer[1].trim();
  const rest  = treffer[2].trim();
  if (!rest) return null;

  const namen = label
    .split(/\s*(?:,|\/|&|\+|\bund\b|\boder\b)\s*/i)
    .map(n => n.trim())
    .filter(Boolean);

  if (!namen.length) return null;
  if (namen.some(istSachlabel)) return null;

  return { namen, rest };
}

// Zwei Farbnamen gelten als dieselbe Farbe, wenn einer den anderen enthält:
// Variante "Grau meliert" deckt die Katalog-Ausnahme "Grau" ab. Erst ab drei
// Zeichen, sonst matcht jede Kurzform quer durch die Palette.
function sameFarbe(a, b) {
  const x = normalizeFarbe(a);
  const y = normalizeFarbe(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length < 3 || y.length < 3) return false;
  return x.includes(y) || y.includes(x);
}

// Klammergruppen mit Tiefenzählung. Das alte Muster \(([^()]*)\) traf
// "(Charcoal (Heather): 52% …)" nicht: die verschachtelte Klammer beendete den
// Treffer zu früh, die Klausel blieb stehen.
//
// ENTSCHIEDEN: Eine offene Klammer ohne schließende gilt bis Zeilenende als
// Klauselinhalt. Bei 13251 ist das das richtige Ergebnis, und eine verirrte
// Klammer im Fließtext richtet wenig an, weil zusätzlich Label-Prüfung,
// Faserangabe und die Nachbedingung greifen müssen.
function klammerGruppen(text) {
  const gruppen = [];
  let tiefe = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') {
      if (tiefe === 0) start = i;
      tiefe++;
    } else if (text[i] === ')' && tiefe > 0) {
      tiefe--;
      if (tiefe === 0) {
        gruppen.push({ start, ende: i + 1, inhalt: text.slice(start + 1, i) });
        start = -1;
      }
    }
  }
  // Unbalanciert: der Rest der Zeile ist der Klauselinhalt.
  if (tiefe > 0 && start >= 0) {
    gruppen.push({ start, ende: text.length, inhalt: text.slice(start + 1) });
  }
  return gruppen;
}

// Reste aufräumen: doppelte Leerzeichen und Trennzeichen, die nur noch die
// entfernte Klammer angebunden haben. Mehrere entfernte Klauseln hinterlassen
// Ketten wie ", ," – die werden erst zusammengezogen, sonst bliebe ein
// einzelnes Komma am Ende stehen.
function aufraeumen(text) {
  return text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,;.])/g, '$1')
    .replace(/([,;])(?:\s*[,;])+/g, '$1')
    .replace(/^\s*[,;]\s*/, '')
    .replace(/[,;]\s*$/, '')
    .trim();
}

// Freie Klauseln (Punkt 4), konservativ. Entfernt wird nur, wenn
//   (a) das Label ein Farbname und kein Sachlabel ist,
//   (b) direkt eine Faserangabe mit Prozent folgt (verlangt FREIE_KLAUSEL_RE),
//   (c) die Nachbedingung aus Punkt 1 danach noch greift.
//
// ⚠️ Bei 19192 lautet die Materialangabe "Material: Sports Grey: 85% Baumwolle
// / 15% Viskose". Das führende "Material:" schützt NICHTS – "Sports Grey:"
// erfüllt (a) und (b). Diesen Artikel rettet AUSSCHLIESSLICH (c). Er ist
// NICHT doppelt geschützt: wer (c) später lockert, nimmt ihm die
// Pflichtangabe.
function entferneFreieKlauseln(text, angeboten) {
  // Ohne bekannte Variantenauswahl wird nichts entfernt – dieselbe Regel wie
  // in der Klammer.
  if (!angeboten.length) return text;

  let aktuell = text;

  // Je Runde höchstens eine Klausel, danach neu suchen: die Indizes ändern
  // sich mit jedem Schnitt.
  for (let runde = 0; runde < 10; runde++) {
    let entfernt = false;

    for (const treffer of [...aktuell.matchAll(FREIE_KLAUSEL_RE)]) {
      const label = treffer[1];
      if (istSachlabel(label)) continue;                        // (a)
      if (!istFarbname(label)) continue;                        // (a)
      if (angeboten.some(f => sameFarbe(f, label))) continue;   // angebotene Farbe bleibt

      const ohne = aufraeumen(
        aktuell.slice(0, treffer.index) + aktuell.slice(treffer.index + treffer[0].length));
      if (!hatFaserangabe(ohne)) continue;                      // (c)

      aktuell = ohne;
      entfernt = true;
      break;
    }

    if (!entfernt) return aktuell;
  }
  return aktuell;
}

/**
 * Entfernt farbspezifische Ausnahmen aus dem Materialstring, deren Farbe für
 * diesen Artikel nicht angeboten wird – und meldet, wenn danach keine
 * vollständige Faserangabe mehr dasteht.
 *
 * Die Nachbedingung MELDET nur, sie stellt nichts wieder her. Das gefilterte
 * Ergebnis bleibt stehen, auch wenn es unvollständig ist.
 *
 * @param {string}   material Rohstring aus dem Katalog/Sheet.
 * @param {string[]} farben   Angebotene Farben (Variantenauswahl).
 * @returns {{ material: string, meldung: string|null }}
 */
export function filterMaterialFarbenMitMeldung(material, farben) {
  const text = String(material ?? '').trim();
  if (!text) return { material: MATERIAL_PLACEHOLDER, meldung: null };

  const angeboten = parseFarben(farben);

  // Von hinten nach vorn ersetzen, damit die Indizes der noch offenen Gruppen
  // gültig bleiben.
  let bereinigt = text;
  for (const gruppe of klammerGruppen(text).reverse()) {
    const klauseln = gruppe.inhalt.split(';').map(k => k.trim()).filter(Boolean);
    const behalten = [];
    let geaendert  = false;

    for (const klausel of klauseln) {
      const ausnahme = parseAusnahme(klausel);
      if (!ausnahme) {
        behalten.push(klausel);          // keine Farbausnahme → unangetastet
        continue;
      }
      // Ohne bekannte Variantenauswahl kann nichts geprüft werden – dann
      // bleibt alles stehen, statt korrekte Angaben zu verlieren.
      if (!angeboten.length) {
        behalten.push(klausel);
        continue;
      }
      const passende = ausnahme.namen.filter(n => angeboten.some(f => sameFarbe(f, n)));
      if (passende.length === ausnahme.namen.length) {
        behalten.push(klausel);          // alle genannten Farben angeboten
        continue;
      }
      geaendert = true;
      if (passende.length) behalten.push(`${passende.join(', ')}: ${ausnahme.rest}`);
    }

    // Unangetastete Gruppen behalten ihren Wortlaut – auch die unbalancierte.
    if (!geaendert) continue;
    const ersatz = behalten.length ? `(${behalten.join('; ')})` : '';
    bereinigt = bereinigt.slice(0, gruppe.start) + ersatz + bereinigt.slice(gruppe.ende);
  }

  const sauber =
    aufraeumen(entferneFreieKlauseln(aufraeumen(bereinigt), angeboten)) || MATERIAL_PLACEHOLDER;

  // Nachbedingung: MELDEN, nicht wiederherstellen.
  //
  // Ihre Auslösemenge ist genau die Menge, in der der Filter KORREKT
  // gearbeitet hat: die einzige Faserangabe gehörte zu einer nicht
  // angebotenen Farbe. Den ungefilterten Ausgangswert zurückzuholen brächte
  // dort fremdes Material in den Prompt – genau die Falle, gegen die dieser
  // Filter gebaut ist. Und der Fall, für den die Prüfung ursprünglich gedacht
  // war (eine von zwei Angaben gelöscht), löst sie nie aus: dann bleibt ja
  // eine vollständige Angabe stehen. Gegen den steht die Sachlabel-Prüfung.
  //
  // Das gefilterte Ergebnis bleibt also stehen, auch unvollständig. Der
  // Platzhalter greift nur, wenn gar nichts übrig bleibt – das erledigt oben
  // das `|| MATERIAL_PLACEHOLDER`.
  const meldung = hatFaserangabe(text) && !hatFaserangabe(sauber)
    ? 'Nach dem Filtern steht keine vollständige Faserangabe mit Prozentwerten ' +
      'mehr im Material — bitte prüfen.'
    : null;

  return { material: sauber, meldung };
}

/**
 * Dünner Wrapper mit der alten Signatur.
 *
 * ⚠️ VERWIRFT DIE MELDUNG und gehört damit NICHT in den Produktionspfad. Er
 * existiert nur, weil bestehende Tests und der Audit-Code an der alten
 * Signatur hängen. Im Prompt-Pfad steht filterMaterialFarbenMitMeldung(), und
 * buildSeoUserPrompt reicht die Meldung nach oben. Wer hier zum kürzeren Namen
 * greift, nimmt dem Nutzer den Hinweis, dass eine gesetzliche Pflichtangabe
 * geprüft werden muss.
 *
 * @param {string}   material Rohstring aus dem Katalog/Sheet.
 * @param {string[]} farben   Angebotene Farben (Variantenauswahl).
 * @returns {string} Bereinigter String, oder MATERIAL_PLACEHOLDER wenn leer.
 */
export function filterMaterialFarben(material, farben) {
  return filterMaterialFarbenMitMeldung(material, farben).material;
}

/**
 * Zeile in Label und Wert zerlegen. Trenner ist der ERSTE Doppelpunkt, Tab
 * oder eine Folge von ZWEI oder mehr Leerzeichen - "Grammatur in g/m²<TAB>180
 * g/m²" (L-Shop-Datenblatt, kopiert) genauso wie "Grammatur: 180 g/m²".
 * Ein einzelnes Leerzeichen trennt nie.
 *
 * Ein Label beginnt mit einem Buchstaben, enthaelt kein "%" und Klammern nur
 * geschlossen ("Farbe(n)"). Sonst wuerde der Doppelpunkt in
 * "100% Baumwolle (Grau: 60% …)" oder "Baumwolle (Grau meliert: 60% …)" als
 * Trenner gelesen und die Faserangabe verloere ihren Anfang.
 *
 * @returns {{ label: string, wert: string }|null} null, wenn kein Label.
 */
export function labelUndWert(zeile) {
  const z = zerlege(zeile);
  return z ? { label: z.label, wert: z.wert } : null;
}

// Wie labelUndWert, dazu der Trenner: ':' oder 'tab' (Tab / zwei und mehr
// Leerzeichen - so kommt ein L-Shop-Datenblatt aus der Zwischenablage).
// Ein EINZELNES Leerzeichen trennt nie. Der erste Trenner gewinnt:
// "Pflege: 30  Grad" hat das Label "Pflege".
function zerlege(zeile) {
  const t = String(zeile ?? '')
    .match(/^\s*([A-Za-zÄÖÜäöüß](?:[^:\t%()]|\([^():\t%]*\))*?)[ \t]*?(:|\t| {2,})\s*(.*?)\s*$/);
  if (!t) return null;
  const label = t[1].trim();
  if (!label || label.length > 40 || !t[3]) return null;
  return { label, wert: t[3], trenner: t[2] === ':' ? ':' : 'tab' };
}

/** L-Shop-Format: Label und Wert durch Tab oder mehrere Leerzeichen getrennt. */
function tabGetrennt(zeile) {
  return zerlege(zeile)?.trenner === 'tab';
}

// Labels, die eine Grammatur einleiten. Entscheidend ist das ERSTE Wort:
// "Grammatur in g/m²" (L-Shop-Datenblatt) zaehlt mit.
const GRAMMATUR_LABELS = ['grammatur', 'stoffgewicht', 'flächengewicht', 'flaechengewicht'];

/** Grammatur-Wert einer Zeile ohne Label, oder null. Nur ueber das Label. */
export function grammaturAusZeile(zeile) {
  const lw = labelUndWert(zeile);
  if (!lw) return null;
  const erstesWort = lw.label.toLowerCase().split(/\s+/)[0];
  return GRAMMATUR_LABELS.includes(erstesWort) && /\d/.test(lw.wert) ? lw.wert : null;
}

/**
 * Faserangabe ohne fuehrendes Label ("Materialzusammensetzung<TAB>100% …",
 * "Material: …"). Ein Label "Material" faellt immer, jedes andere nur, wenn
 * der Rest mit einer Prozentangabe beginnt - sonst bleibt der Text stehen.
 */
// Beginnt der Wert (ohne Label) mit einer Prozentangabe? "100% Baumwolle",
// "Materialzusammensetzung<TAB>100 % Baumwolle" ja, "Material: Jersey" nein.
function beginntMitProzent(zeile) {
  const wert = labelUndWert(zeile)?.wert ?? String(zeile ?? '');
  return /^\s*\d{1,3}\s*%/.test(wert);
}

export function faserOhneLabel(text) {
  const lw = labelUndWert(text);
  if (!lw) return text;
  return normalize(lw.label) === 'material' || /^\d{1,3}\s*%/.test(lw.wert) ? lw.wert : text;
}

/**
 * Zeile fuer die Detailliste. Doppelpunkt-Zeilen bleiben wie sie sind.
 * Tab-/Leerzeichen-Zeilen (L-Shop) werden zu "Label: Wert"; eine
 * Grammatur-Zeile mit dem L-Shop-Label "Grammatur in g/m²" wird zu
 * "Grammatur: 180 g/m²".
 */
function detailZeile(zeile) {
  const text = String(zeile ?? '').trim();
  const lw   = labelUndWert(text);
  if (!lw) return text;
  const erstesWort = lw.label.toLowerCase().split(/\s+/)[0];
  if (erstesWort === 'grammatur' && grammaturAusZeile(text) && lw.label.toLowerCase() !== 'grammatur')
    return `Grammatur: ${lw.wert}`;
  return tabGetrennt(text) ? `${lw.label}: ${lw.wert}` : text;
}

/**
 * Leere Listenpunkte entfernen ("<li></li>", "<li> </li>", "<li><br></li>",
 * "<li><strong></strong></li>"), danach leer gewordene <ul>. Gilt fuer
 * Beschreibung UND Kurzbeschreibung.
 *
 * @returns {{ html: string, entfernt: number }}
 */
export function entferneLeereLi(html) {
  let entfernt = 0;
  const leer = /<li\b[^>]*>(?:\s|&nbsp;|&#160;|<br\s*\/?>|<(strong|b|em|i|span)\b[^>]*>(?:\s|&nbsp;|&#160;)*<\/\1>)*<\/li>[ \t]*\n?/gi;
  let out = String(html ?? '').replace(leer, () => { entfernt++; return ''; });
  out = out.replace(/<ul\b[^>]*>\s*<\/ul>[ \t]*\n?/gi, '');
  return { html: out, entfernt };
}

/**
 * Materialangabe aus dem Eigenschaften-Freitext, gefiltert nach den
 * angebotenen Farben. Einzige Stelle für diesen Weg: der SEO-Prompt und die
 * Meta-Beschreibung (lib/seo-meta.js) sehen damit dieselbe Faserangabe.
 *
 * @returns {{ eigenschaftenLines: string[], farbListe: string[],
 *             materialRoh: string, material: string, meldung: string|null }}
 */
export function materialAusEigenschaften(eigenschaften, farben, { groessen } = {}) {
  const rohLines = eigenschaften ? String(eigenschaften).split('\n').filter(Boolean) : [];
  // ⚠️ Reihenfolge: erst auslesen, dann entfernen. filterEigenschaften() wirft
  // die Farbzeile raus (sonst steht die Farbe doppelt in der Detailliste) –
  // die Liste selbst wird aber weiter gebraucht, für FARBEN und für
  // filterMaterialFarben.
  const farbenAusZeilen = farbenAusEigenschaften(rohLines);
  // Einzige Filterstelle. Alles darunter arbeitet nur noch auf den sauberen
  // Zeilen – Material, <li>-Liste und "Weitere Eigenschaften" gleichermaßen.
  const eigenschaftenLines = filterEigenschaften(rohLines);

  // Faserangabe: unter allen Material-Zeilen gewinnt die, deren Wert mit einer
  // Prozentangabe beginnt - unabhaengig von der Reihenfolge. "Material<TAB>
  // Jersey" vor "Materialzusammensetzung<TAB>100% Baumwolle" machte sonst
  // "Jersey" zur Faserangabe, und die Pflichtangabe fiel still weg.
  // Die uebrigen Material-Zeilen gehen als "Material: Jersey" in die
  // Detailliste - nie als Faserangabe. Ohne Zeile mit Prozentangabe bleibt es
  // beim Bisherigen: die erste Material-Zeile, die anderen fallen weg, und die
  // Nachbedingung in filterMaterialFarbenMitMeldung meldet es.
  const materialZeilen = eigenschaftenLines.filter(l => MATERIAL_LINE_RE.test(l));
  const faserZeile     = materialZeilen.find(l => beginntMitProzent(l));
  const materialZeile  = (faserZeile ?? materialZeilen[0])?.trim() || '';
  // Führendes Label abschneiden – "Material:" wie bisher, dazu jedes Label vor
  // Doppelpunkt, Tab oder Leerzeichenfolge, hinter dem die Prozentangabe
  // beginnt ("Materialzusammensetzung<TAB>100% …"). Das Label steht im <li>.
  const materialRoh    = faserOhneLabel(materialZeile);

  // Detailliste in Eingabereihenfolge: Nicht-Material-Zeilen wie bisher,
  // weitere Material-Zeilen nur, wenn eine Faserzeile gefunden wurde.
  const detailLines = eigenschaftenLines
    .filter(l => !MATERIAL_LINE_RE.test(l) || (faserZeile && l !== faserZeile))
    .map(detailZeile);

  const farbListe = parseFarben(
    farben && (Array.isArray(farben) ? farben.length : String(farben).trim())
      ? farben
      : farbenAusZeilen
  );

  // Die Form MIT Meldung, nicht der Wrapper: die Meldung sagt, dass im
  // Material keine vollständige Faserangabe mehr steht.
  const { material, meldung } = filterMaterialFarbenMitMeldung(materialRoh, farbListe);

  // Faserangabe fehlt ganz? Nur bei Textilien melden: der Artikel hat eine
  // Groessen-Achse ODER die Eigenschaften nennen Material ohne Prozent
  // ("Material: Jersey"). Puck, Fruehstuecksbrett, Thermobecher bleiben still.
  // Hat die Nachbedingung schon gemeldet, kein zweiter Hinweis.
  const textil = parseGroessen(groessen).length > 0 || materialZeilen.length > 0;
  const faserHinweis = !meldung && !hatFaserangabe(material) && textil ? FASER_FEHLT_HINWEIS : null;

  return { eigenschaftenLines, detailLines, farbListe, materialRoh, material, meldung, faserHinweis };
}

/**
 * Baut den User-Prompt für die SEO-Generierung.
 * Der System-Prompt liegt in backend/routes/claude.js (SEO_SYSTEM).
 *
 * Gibt neben dem Prompt die Material-Meldung zurück (Punkt 1). Die Route
 * hängt sie an die Hinweise der Antwort – eine Meldung, die hier verschluckt
 * würde, erreicht niemanden.
 *
 * @returns {{ prompt: string, meldung: string|null, faserHinweis: string|null }}
 */
export function buildSeoUserPrompt({
  produktname,
  kategorien,
  eigenschaften,
  hinweise,
  motiv,
  modus,
  farben,
  groessen,
  keyphrase,
} = {}) {
  const {
    detailLines, farbListe, material, meldung: materialMeldung, faserHinweis,
  } = materialAusEigenschaften(eigenschaften, farben, { groessen });

  // Größen kommen NUR aus der Variantenauswahl. Kein Fallback auf die
  // Eigenschaften: dort steht der Größenlauf der Baureihe, nicht die Auswahl
  // dieses Artikels.
  // Befehl G: aufsteigend sortiert, an DIESER einen Stelle - fuer alle
  // Quellen (Varianten-Reiter, WooCommerce-Fallback). Der Reiter liefert nach
  // einem Aenderungspfad-Speichern oft 3XL … XS, WooCommerce die Reihenfolge
  // seiner Optionen. Sortierung aus lib/groessen.js, keine zweite Logik.
  const groessenListe = groessenFuerText(groessen);

  const farbenText  = farbListe.length ? farbListe.join(', ') : 'siehe Varianten';
  const groessenText = groessenListe.join(', ');
  // Defensiv: die Route löst den Modus schon auf, hier darf trotzdem nie ein
  // Freitext durchrutschen.
  const modusWert   = resolveModus(modus).modus;
  const istKollektion = modusWert === MODUS_KOLLEKTION;

  const keyword = hauptKeyword({ keyphrase, produktname, farben: farbListe, groessen: groessenListe });

  // Material-Zeilen fliegen aus dem Rest raus: Material hat ein eigenes,
  // gefiltertes Feld. Sonst käme der ungefilterte Rohstring über
  // "Weitere Eigenschaften" doch wieder beim Modell an.
  // Aus materialAusEigenschaften: die Faserzeile fehlt, weitere Material-
  // Zeilen stehen als "Material: …" drin, Tab-Zeilen als "Label: Wert", die
  // L-Shop-Grammatur als "Grammatur: …".
  const weitereLines = detailLines;

  const weitereLi = weitereLines
    .slice(0, 5)
    .map(p => `<li>${p.trim()}</li>`)
    .join('\n');

  const bloecke = [
    'Erstelle Beschreibungen für folgenden FERTIGEN bedruckten Artikel:',

    `MODUS: ${modusWert}`,

    keyword.woerter.length
      ? [
          keyword.ausTitel
            ? `FOKUS-KEYPHRASE (aus dem Produkttitel abgeleitet): ${keyword.text}`
            : `FOKUS-KEYPHRASE: ${keyword.text}`,
          `- Die Kurzbeschreibung enthält ALLE Wörter der Keyphrase in den ersten ${KEYPHRASE_FENSTER} Wörtern.`,
          '- Der ERSTE SATZ des ersten <p> NACH der <h2> enthält ALLE Wörter der Keyphrase.',
          '- Die Keyphrase wörtlich verwenden, nicht umschreiben.',
        ].join('\n')
      : '',

    `KONTEXT & HINWEISE (PRIMÄR):\n${hinweise || 'Keine besonderen Hinweise'}`,

    // Nur mit woertlicher Wendung im Hinweis – sonst leer, Verbot gilt (SP1).
    fanartBlock(hinweise),

    [
      'PRODUKTDATEN:',
      `- Artikelname: ${produktname ?? ''}`,
      `- Kategorie: ${kategorien || 'Textilien'}`,
      `- MOTIV: ${motiv || MOTIV_PLACEHOLDER}`,
      `- FARBEN: ${farbenText}`,
      groessenText ? `- GRÖSSEN: ${groessenText}` : '',
      `- Material: ${material}`,
      weitereLines.length ? `- Weitere Eigenschaften: ${weitereLines.join('; ')}` : '',
    ].filter(Boolean).join('\n'),

    [
      'REGELN (werden nach der Generierung im Code geprüft):',
      `- Die <h2> ist eine kurze, sachliche Zwischenüberschrift (höchstens ${H2_MAX_WOERTER} Wörter),`,
      '  die sagt, worum es im Abschnitt geht. Sie enthält NICHT den Produkttitel',
      '  und KEINEN Werbeslogan – die H1 der Seite ist bereits der Produkttitel.',
      '  falsch:  "Das <Produkttitel> für den Alltag"',
      '  richtig: "Mehrfarbiger Brustdruck auf schwarzem Jersey"',
      '- Nenne KEINE Fakten, die nicht in dieser Eingabe stehen: keine Orte, keine',
      '  Hallen, keine Vereinsgeschichte, keine Zertifikate, keine Liefer- oder',
      '  Bestellschlussdaten. Solche Angaben dürfen ausschließlich aus KONTEXT &',
      '  HINWEISE oder den Eigenschaften stammen.',
      '- Eigenschaften dürfen GENANNT, aber nicht in eine Wirkung oder einen',
      '  Vorteil umgedeutet werden, wenn die Eingabe das nicht hergibt.',
      '  "Seitennähte" und "60 °C waschbar" sind Angaben – daraus wird NICHT',
      '  "sorgt für eine beständige Passform nach dem Waschen".',
      groessenText
        ? '- Größen: nenne ausschließlich die unter GRÖSSEN gelisteten, in GENAU dieser Reihenfolge (aufsteigend).'
        : '- Größen: NENNE KEINE Größen, für diesen Artikel gibt es keine Größen-Variante.',
    ].join('\n'),

    [
      'STRUKTUR der produktbeschreibung (EXAKT einhalten):',
      'Die produktbeschreibung beginnt IMMER mit <h2>. Vor der <h2> steht nichts.',
      'Die Keyphrase steht im ersten Satz des ersten <p> NACH der <h2>.',
      '',
      `<h2>[kurze sachliche Zwischenüberschrift, höchstens ${H2_MAX_WOERTER} Wörter – NICHT der Produkttitel, kein Slogan]</h2>`,
      '',
      '<p>[Einleitung: 2-3 Sätze. WER trägt das + WANN/WARUM. Was ist auf dem Artikel zu sehen (MOTIV). Ton aus den Hinweisen.]</p>',
      '',
      '<h3>Produktdetails</h3>',
      '<ul>',
      `<li><strong>Material:</strong> ${material}</li>`,
      `<li><strong>Farben:</strong> ${farbenText}</li>`,
      ...(groessenText ? [`<li><strong>Größen:</strong> ${groessenText}</li>`] : []),
      weitereLi,
      '</ul>',
      '',
      '<p>[Abschluss: 2 Sätze. Was macht diesen Artikel besonders? Direkte Kaufaufforderung – passend zur Stimmung aus den Hinweisen.]</p>',
    ].filter(z => z !== null).join('\n'),

    istKollektion ? '' : FREIGABE_HINWEIS,

    'kurzbeschreibung: Plain Text, max. 160 Zeichen. Artikel + Highlight + CTA.\nNICHT "individuell" oder "personalisierbar".',

    'Antworte NUR mit diesem JSON (KEIN Markdown-Codeblock):\n{\n  "kurzbeschreibung": "...",\n  "produktbeschreibung": "Valides HTML wie oben definiert"\n}',
  ];

  return { prompt: bloecke.filter(Boolean).join('\n\n'), meldung: materialMeldung, faserHinweis };
}
