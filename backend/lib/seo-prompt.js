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

export const MATERIAL_PLACEHOLDER = '[Material: bitte ergänzen]';
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

// Der Einleitungstext: das erste <p>. Die <h2> zählt ausdrücklich NICHT als
// erster Satz – sie darf den Titel ja gerade nicht tragen.
function einleitung(html) {
  const text = String(html ?? '');
  const p = text.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (p) return stripHtml(p[1]);
  return stripHtml(text.replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, ' '));
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
  const text = String(zeile ?? '');
  const i = text.indexOf(':');
  if (i <= 0) return false;
  const label = normalize(text.slice(0, i));      // "Farbe(n)" → "farbe n"
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
 * Abgeschnitten wird am Doppelpunkt, nicht am Label-Muster – damit auch
 * "Verfügbare Farben: Schwarz" den Wert sauber hergibt.
 */
export function farbenAusEigenschaften(lines) {
  const werte = (lines ?? [])
    .filter(istFarbZeile)
    .map(z => String(z).slice(String(z).indexOf(':') + 1));
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

/**
 * Eigenschaften-Zeilen säubern, BEVOR daraus Material, <li>-Liste und
 * "Weitere Eigenschaften" gebaut werden. Genau eine Filterstelle: ein Filter
 * kurz vor der Ausgabe würde von der jeweils anderen Eintrittsstelle umgangen.
 *
 * Entfernt werden
 *  - Zeilen mit einem Sperrbegriff (Farbigkeit, Veredelungsangabe, Verarbeitung)
 *  - Zeilen, deren Label eine Größe benennt ("Größen: S–5XL", "Größenlauf: …").
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

    const trenner = String(zeile).indexOf(':');
    if (trenner > 0) {
      const label = normalize(String(zeile).slice(0, trenner));
      if (/groesse|size/.test(label)) return false;
    }
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
        `${quelle} "${keyword.text}" fehlt im ersten Satz der Produktbeschreibung ` +
        `(fehlt: ${fehlendSatz.join(', ')}).`
      );
    }
  }

  return [...meldungen, ...pruefeH2(produktbeschreibung, produktname)];
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

  const h2Woerter      = woerterVon(h2);
  const titelWoerter   = woerterVon(produktname);
  const ohneZielgruppe = titelWoerter.filter(w => !ZIELGRUPPEN.has(w));

  if (titelWoerter.length &&
      (enthaeltWortfolge(h2Woerter, titelWoerter) ||
       (ohneZielgruppe.length && enthaeltWortfolge(h2Woerter, ohneZielgruppe)))) {
    meldungen.push(
      `Die <h2> enthält den Produkttitel ("${h2}") – sie soll eine kurze, sachliche ` +
      'Zwischenüberschrift sein, die H1 der Seite ist bereits der Titel.'
    );
  }
  if (h2Woerter.length > H2_MAX_WOERTER) {
    meldungen.push(
      `Die <h2> hat ${h2Woerter.length} Wörter (höchstens ${H2_MAX_WOERTER}): "${h2}".`
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
    'Schreibe den Text neu. Die <h2> enthält NICHT den Produkttitel,',
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
 * Materialangabe aus dem Eigenschaften-Freitext, gefiltert nach den
 * angebotenen Farben. Einzige Stelle für diesen Weg: der SEO-Prompt und die
 * Meta-Beschreibung (lib/seo-meta.js) sehen damit dieselbe Faserangabe.
 *
 * @returns {{ eigenschaftenLines: string[], farbListe: string[],
 *             materialRoh: string, material: string, meldung: string|null }}
 */
export function materialAusEigenschaften(eigenschaften, farben) {
  const rohLines = eigenschaften ? String(eigenschaften).split('\n').filter(Boolean) : [];
  // ⚠️ Reihenfolge: erst auslesen, dann entfernen. filterEigenschaften() wirft
  // die Farbzeile raus (sonst steht die Farbe doppelt in der Detailliste) –
  // die Liste selbst wird aber weiter gebraucht, für FARBEN und für
  // filterMaterialFarben.
  const farbenAusZeilen = farbenAusEigenschaften(rohLines);
  // Einzige Filterstelle. Alles darunter arbeitet nur noch auf den sauberen
  // Zeilen – Material, <li>-Liste und "Weitere Eigenschaften" gleichermaßen.
  const eigenschaftenLines = filterEigenschaften(rohLines);

  const materialZeile = eigenschaftenLines.find(l => MATERIAL_LINE_RE.test(l))?.trim() || '';
  // Führendes "Material:" abschneiden – das Label steht schon im <li>.
  const materialRoh    = materialZeile.replace(/^\s*material\s*:\s*/i, '');

  const farbListe = parseFarben(
    farben && (Array.isArray(farben) ? farben.length : String(farben).trim())
      ? farben
      : farbenAusZeilen
  );

  // Die Form MIT Meldung, nicht der Wrapper: die Meldung sagt, dass im
  // Material keine vollständige Faserangabe mehr steht.
  const { material, meldung } = filterMaterialFarbenMitMeldung(materialRoh, farbListe);
  return { eigenschaftenLines, farbListe, materialRoh, material, meldung };
}

/**
 * Baut den User-Prompt für die SEO-Generierung.
 * Der System-Prompt liegt in backend/routes/claude.js (SEO_SYSTEM).
 *
 * Gibt neben dem Prompt die Material-Meldung zurück (Punkt 1). Die Route
 * hängt sie an die Hinweise der Antwort – eine Meldung, die hier verschluckt
 * würde, erreicht niemanden.
 *
 * @returns {{ prompt: string, meldung: string|null }}
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
    eigenschaftenLines, farbListe, material, meldung: materialMeldung,
  } = materialAusEigenschaften(eigenschaften, farben);

  // Größen kommen NUR aus der Variantenauswahl. Kein Fallback auf die
  // Eigenschaften: dort steht der Größenlauf der Baureihe, nicht die Auswahl
  // dieses Artikels.
  const groessenListe = parseGroessen(groessen);

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
  const weitereLines = eigenschaftenLines.filter(l => !MATERIAL_LINE_RE.test(l));

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
          '- Der ERSTE SATZ der produktbeschreibung enthält ALLE Wörter der Keyphrase.',
          '- Die Keyphrase wörtlich verwenden, nicht umschreiben.',
        ].join('\n')
      : '',

    `KONTEXT & HINWEISE (PRIMÄR):\n${hinweise || 'Keine besonderen Hinweise'}`,

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
        ? '- Größen: nenne ausschließlich die unter GRÖSSEN gelisteten.'
        : '- Größen: NENNE KEINE Größen, für diesen Artikel gibt es keine Größen-Variante.',
    ].join('\n'),

    [
      'STRUKTUR der produktbeschreibung (EXAKT einhalten):',
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

  return { prompt: bloecke.filter(Boolean).join('\n\n'), meldung: materialMeldung };
}
