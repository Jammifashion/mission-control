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
const NON_COLOR_LABELS = new Set([
  'material', 'materialien', 'pflege', 'pflegehinweis', 'hinweis', 'hinweise',
  'achtung', 'farbigkeit', 'gewicht', 'grammatur', 'groesse', 'groessen',
  'qualitaet', 'stoff', 'art', 'passform', 'schnitt', 'druck', 'drucktechnik',
  'herkunft', 'zusammensetzung', 'futter', 'einfassung',
]);

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

// Gemeinsame Zerlegung für Farb- und Größenlisten: Array, mehrzeiliger String
// oder "Farben: Schwarz, Navy".
function parseListe(input, labelRe) {
  const roh = Array.isArray(input) ? input : String(input ?? '').split('\n');
  const out = [];
  for (const eintrag of roh) {
    const ohneLabel = String(eintrag ?? '').replace(labelRe, '');
    for (const teil of ohneLabel.split(/[,;/|]/)) {
      const name = teil.trim().replace(/[.\s]+$/, '');
      if (!name) continue;
      if (!out.some(vorhanden => normalize(vorhanden) === normalize(name))) {
        out.push(name);
      }
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
  return parseFarben(werte);
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
  if (namen.some(n => NON_COLOR_LABELS.has(normalizeFarbe(n).replace(/\s+/g, '')))) return null;

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

/**
 * Entfernt farbspezifische Ausnahmen aus dem Materialstring, deren Farbe für
 * diesen Artikel nicht angeboten wird.
 *
 * @param {string}   material Rohstring aus dem Katalog/Sheet.
 * @param {string[]} farben   Angebotene Farben (Variantenauswahl).
 * @returns {string} Bereinigter String, oder MATERIAL_PLACEHOLDER wenn leer.
 */
export function filterMaterialFarben(material, farben) {
  const text = String(material ?? '').trim();
  if (!text) return MATERIAL_PLACEHOLDER;

  const angeboten = parseFarben(farben);

  const bereinigt = text.replace(/\(([^()]*)\)/g, (ganzeKlammer, inhalt) => {
    const klauseln = inhalt.split(';').map(k => k.trim()).filter(Boolean);
    const behalten = [];

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
      if (passende.length) {
        behalten.push(`${passende.join(', ')}: ${ausnahme.rest}`);
      }
    }

    return behalten.length ? `(${behalten.join('; ')})` : '';
  });

  // Reste aufräumen: doppelte Leerzeichen und Trennzeichen, die nur noch die
  // entfernte Klammer angebunden haben.
  const sauber = bereinigt
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,;.])/g, '$1')
    .replace(/[,;]\s*$/, '')
    .trim();

  return sauber || MATERIAL_PLACEHOLDER;
}

/**
 * Baut den User-Prompt für die SEO-Generierung.
 * Der System-Prompt liegt in backend/routes/claude.js (SEO_SYSTEM).
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

  // Größen kommen NUR aus der Variantenauswahl. Kein Fallback auf die
  // Eigenschaften: dort steht der Größenlauf der Baureihe, nicht die Auswahl
  // dieses Artikels.
  const groessenListe = parseGroessen(groessen);

  const material    = filterMaterialFarben(materialRoh, farbListe);
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

  return bloecke.filter(Boolean).join('\n\n');
}
