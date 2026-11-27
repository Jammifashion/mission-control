// ZW2 Teil A: JFN-Kurzfassung zu einem HONK!-Artikel (ED27: JFN-Texte eigenstaendig und kuerzer, 0 gleiche Saetze, kein canonical).
// Reine Logik. Frontend-Spiegel von `satzListe`/`gleicheSaetze`: Block `Satzvergleich: Anfang/Ende` in index.html (Test kurzfassung.test.js).
//
// Aufbau der JFN-Fassung: eigene <h2> + Einleitung (2-3 Saetze) + Produktdetails-Block UNVERAENDERT aus der vollen Fassung
// (Daten, keine Saetze - deterministisch kopiert, nie vom Modell) + ein Schlusssatz. Kurzbeschreibung eigen.
// Satzvergleich deterministisch: Saetze aus <h2>/<h3>/<p> und Fliesstext (Listen <li> = Produktdetails ausgenommen), normalisiert
// (klein, Satzzeichen weg, Leerzeichen zusammengefasst); Saetze unter MIN_WOERTER zaehlen nicht ("Produktdetails").

export const MIN_WOERTER = 4;

const ENT = { '&amp;': '&', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&shy;': '' };
const entity = s => s.replace(/&(amp|nbsp|quot|#39|lt|gt|shy);/g, m => ENT[m]);

/** Normalform eines Satzes fuer den Vergleich. */
export function normSatz(s) {
  return entity(String(s ?? '')).toLowerCase()
    .replace(/[„“"'‚‘’«»()[\]{}:;,.!?…–—-]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Saetze eines HTML-Texts (ohne <li>-Inhalte). -> [{ text, norm }]
 * Ueberschriften zaehlen als ein Satz.
 */
export function satzListe(html) {
  const ohneListen = String(html ?? '').replace(/<li\b[^>]*>[\s\S]*?<\/li>/gi, ' ');
  const bloecke = ohneListen.replace(/<\/(h[1-6]|p|div|ul|ol)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  const raus = [];
  for (const block of entity(bloecke).split('\n')) {
    for (const teil of block.split(/(?<=[.!?…])\s+/)) {
      const text = teil.replace(/\s+/g, ' ').trim();
      const norm = normSatz(text);
      if (norm.split(' ').filter(Boolean).length >= MIN_WOERTER) raus.push({ text, norm });
    }
  }
  return raus;
}

/** Saetze aus `a`, die (normalisiert) auch in einem der Texte `bs` stehen. -> [text] ohne Dubletten */
export function gleicheSaetze(a, ...bs) {
  const in_b = new Set(bs.flatMap(b => satzListe(b).map(x => x.norm)));
  const gesehen = new Set();
  const raus = [];
  for (const x of satzListe(a)) {
    if (in_b.has(x.norm) && !gesehen.has(x.norm)) { gesehen.add(x.norm); raus.push(x.text); }
  }
  return raus;
}

/** Gleiche Saetze zwischen JFN-Paar und HONK!-Paar (Kurz- und Langtext jeweils gegen beide). */
export function gleicheSaetzePaare({ jfnKurz, jfnLang, honkKurz, honkLang }) {
  return [...new Set([...gleicheSaetze(jfnLang, honkLang, honkKurz), ...gleicheSaetze(jfnKurz, honkLang, honkKurz)])];
}

/** Produktdetails-Block (<h3>Produktdetails</h3> + folgende Liste) aus der vollen Fassung, sonst ''. */
export function detailsBlock(html) {
  const m = String(html ?? '').match(/<h3\b[^>]*>\s*Produktdetails\s*<\/h3>\s*<(ul|ol)\b[^>]*>[\s\S]*?<\/\1>/i);
  return m ? m[0] : '';
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ohneTags = s => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** JFN-Langtext aus den Teilen des Modells + dem kopierten Produktdetails-Block. */
export function baueKurzfassung({ h2, einleitung, abschluss, details }) {
  return [
    `<h2>${esc(ohneTags(h2))}</h2>`,
    `<p>${esc(ohneTags(einleitung))}</p>`,
    details,
    ohneTags(abschluss) ? `<p>${esc(ohneTags(abschluss))}</p>` : '',
  ].filter(Boolean).join('\n');
}

/** User-Prompt fuer die Kurzfassung. `verboten` = Saetze, die im ersten Versuch doppelt waren. */
export function kurzfassungPrompt({ produktname, keyphrase, voll, kurzVoll, verboten = [] }) {
  return [
    'AUFGABE: Schreibe für JammiFashion eine EIGENE, KÜRZERE Fassung dieses Artikeltexts. Der volle Text steht schon im Partnershop.',
    'Kein Satz darf mit dem vollen Text übereinstimmen – formuliere alles neu, gleiche Fakten, andere Worte. Erfinde nichts dazu.',
    `PRODUKT: ${produktname}`,
    keyphrase ? `KEYPHRASE: ${keyphrase} – steht im ersten Satz der Einleitung.` : '',
    'VOLLER TEXT (nicht wiederholen):',
    ohneTags(String(voll ?? '').replace(/<li\b[^>]*>[\s\S]*?<\/li>/gi, ' ')),
    kurzVoll ? `VOLLE KURZBESCHREIBUNG (nicht wiederholen): ${ohneTags(kurzVoll)}` : '',
    verboten.length ? `DIESE SÄTZE STEHEN SCHON IM VOLLEN TEXT – NICHT VERWENDEN:\n${verboten.map(s => `- ${s}`).join('\n')}` : '',
    'ANTWORT nur als JSON-Objekt, reiner Text ohne HTML:',
    '{"h2": "kurze sachliche Zwischenüberschrift, höchstens 6 Wörter, nicht der Produkttitel",'
      + ' "einleitung": "2-3 Sätze", "abschluss": "1 Satz", "kurzbeschreibung": "höchstens 160 Zeichen"}',
  ].filter(Boolean).join('\n\n');
}
