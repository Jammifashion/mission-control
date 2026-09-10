// SEO-Prompt-Aufbereitung für action=seo_description (backend/routes/claude.js).
//
// Hier passiert die Datenaufbereitung, die NICHT dem Modell überlassen wird:
// Der Materialstring aus dem Herstellerkatalog enthält oft farbspezifische
// Ausnahmen in Klammern, z.B.
//   "85% Baumwolle, 15% Viskose (Grau meliert: 60% Baumwolle, 40% Polyester)"
// Wird die Farbe "Grau meliert" für diesen Artikel gar nicht angeboten, ist die
// Ausnahme im Prompt nur eine Falle – das Modell baut sie sonst in die
// Pflichtangabe ein. Also raus damit, bevor der Prompt gebaut wird.

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

const MATERIAL_LINE_RE = /material|baumwolle|polyester/i;
const FARB_LABEL_RE    = /^\s*(farben?|colou?rs?)\s*:\s*/i;

// Vergleichsform für Farbnamen: Umlaute auflösen, Satzzeichen weg, klein.
// "Grau-meliert" und "grau meliert" sind damit dasselbe.
function normalizeFarbe(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

/**
 * Farbliste aus Request-Feld oder aus den Eigenschaften-Zeilen lesen.
 * Akzeptiert Array, mehrzeiligen String oder "Farben: Schwarz, Navy".
 * @returns {string[]} Farbnamen in Originalschreibweise, ohne Dubletten.
 */
export function parseFarben(input) {
  const roh = Array.isArray(input) ? input : String(input ?? '').split('\n');
  const out = [];
  for (const eintrag of roh) {
    const ohneLabel = String(eintrag ?? '').replace(FARB_LABEL_RE, '');
    for (const teil of ohneLabel.split(/[,;/|]/)) {
      const name = teil.trim().replace(/[.\s]+$/, '');
      if (!name) continue;
      if (!out.some(vorhanden => normalizeFarbe(vorhanden) === normalizeFarbe(name))) {
        out.push(name);
      }
    }
  }
  return out;
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
} = {}) {
  const eigenschaftenLines = eigenschaften ? String(eigenschaften).split('\n').filter(Boolean) : [];

  const materialZeile = eigenschaftenLines.find(l => MATERIAL_LINE_RE.test(l))?.trim() || '';
  // Führendes "Material:" abschneiden – das Label steht schon im <li>.
  const materialRoh    = materialZeile.replace(/^\s*material\s*:\s*/i, '');

  const farbListe = parseFarben(
    farben && (Array.isArray(farben) ? farben.length : String(farben).trim())
      ? farben
      : eigenschaftenLines.filter(l => /farbe|colou?r/i.test(l))
  );

  const material    = filterMaterialFarben(materialRoh, farbListe);
  const farbenText  = farbListe.length ? farbListe.join(', ') : 'siehe Varianten';
  // Defensiv: die Route löst den Modus schon auf, hier darf trotzdem nie ein
  // Freitext durchrutschen.
  const modusWert   = resolveModus(modus).modus;
  const istKollektion = modusWert === MODUS_KOLLEKTION;

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

    `KONTEXT & HINWEISE (PRIMÄR):\n${hinweise || 'Keine besonderen Hinweise'}`,

    [
      'PRODUKTDATEN:',
      `- Artikelname: ${produktname ?? ''}`,
      `- Kategorie: ${kategorien || 'Textilien'}`,
      `- MOTIV: ${motiv || MOTIV_PLACEHOLDER}`,
      `- FARBEN: ${farbenText}`,
      `- Material: ${material}`,
      weitereLines.length ? `- Weitere Eigenschaften: ${weitereLines.join('; ')}` : '',
    ].filter(Boolean).join('\n'),

    [
      'STRUKTUR der produktbeschreibung (EXAKT einhalten):',
      '',
      '<h2>[Artikelbezeichnung] – [passender Slogan basierend auf Kontext]</h2>',
      '',
      '<p>[Einleitung: 2-3 Sätze. WER trägt das + WANN/WARUM. Was ist auf dem Artikel zu sehen (MOTIV). Ton aus den Hinweisen.]</p>',
      '',
      '<h3>Produktdetails</h3>',
      '<ul>',
      `<li><strong>Material:</strong> ${material}</li>`,
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
