// KI-Schnellannahme (SA1): Freitext -> KI-Struktur (festes Schema) -> MC prueft und ordnet zu -> Vorschlag fuer den
// normalen Dialog "Neuer Auftrag". Reine Logik ohne Netz; Aufrufe in lib/auftragSchnell.js.
//
// Grundsaetze (Inhaber 17.11.):
//  - Der Rohtext geht NUR an die KI, wird nirgends gespeichert oder geloggt. Diese Datei loggt nichts.
//  - Die Kundenliste geht NIE an die KI. Die KI liefert nur Stichwoerter, MC sucht selbst (sucheKunden).
//  - Nichts erfinden: Modelle nur aus LShop_Modelle (waehlbare Varianten aus lshopAuswertung), Farben/Groessen nur
//    gueltige Werte des Modells. Was nicht sicher passt, bleibt leer bzw. traegt einen Grund ("unsicher").
//  - Es entsteht KEIN Eingang und kein Auftrag: erst "Speichern" im Dialog legt AU-… an.

import { sucheKunden } from './kunden.js';
import { sucheModelle } from './korb-logic.js';
import { groessenRang } from '../lib/groessen.js';

export const TEXT_MIN = 5;
export const TEXT_MAX = 3000;
export const KUNDE_VORSCHLAEGE_MAX = 3;
export const MODELL_VORSCHLAEGE_MAX = 3;
export const MENGE_MAX = 999;
const TERMIN_TAGE_MAX = 400;

const t = v => String(v ?? '').trim();
const klein = v => t(v).toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const kappe = (v, n) => t(v).slice(0, n);

// ── Schema der KI-Antwort (Structured Outputs: additionalProperties false, alles required) ──────────────────────
const STR = { type: 'string' };
export const KI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kunde', 'kurztitel', 'termin', 'kanal', 'gruppen', 'frei', 'todos', 'hinweise', 'wieLetztesMal', 'kundeNeu', 'notiz'],
  properties: {
    kunde: { type: 'array', items: STR },
    kurztitel: STR,
    termin: STR,
    kanal: STR,
    notiz: STR,   // SA4
    wieLetztesMal: { type: 'boolean' },
    gruppen: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['artikel', 'modellNr', 'farbe', 'farbeEn', 'motiv', 'druck', 'groessen', 'menge', 'druckname'],
        properties: {
          artikel: STR, modellNr: STR, farbe: STR, farbeEn: STR, motiv: STR, druck: STR, druckname: STR,
          groessen: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['groesse', 'menge'], properties: { groesse: STR, menge: { type: 'integer' } } },
          },
          menge: { type: 'integer' },
        },
      },
    },
    frei: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['text', 'menge', 'druckname'], properties: { text: STR, menge: { type: 'integer' }, druckname: STR } },
    },
    todos: { type: 'array', items: STR },
    // SA2: Angaben zum Kunden fuer "Neuen Kunden anlegen (vorbelegt)" - nur, was woertlich im Text steht
    kundeNeu: {
      type: 'object', additionalProperties: false,
      required: ['art', 'name', 'ansprechpartner', 'strasse', 'plz', 'ort', 'email', 'telefon'],
      properties: { art: STR, name: STR, ansprechpartner: STR, strasse: STR, plz: STR, ort: STR, email: STR, telefon: STR },
    },
    hinweise: { type: 'array', items: STR },
  },
};

/** Systemprompt. Feste Regeln; Datum kommt in den User-Prompt (Cache bleibt gleich). */
export function systemPrompt(kanaele) {
  return `Du strukturierst eine kurze Auftragsnotiz eines Textildruck-Betriebs (T-Shirts, Hoodies, Polos usw. bedrucken) in JSON.
Die Notiz kann diktiert sein: ohne Satzzeichen, mit Tippfehlern, umgangssprachlich.

Felder:
- kunde: Stichwörter, an denen man den Kunden erkennt (Vereins-/Firmenname, Spitzname, Ort). Höchstens 3, kurz. Leer, wenn keiner genannt ist.
- kurztitel: kurzer Titel des Auftrags, höchstens 60 Zeichen, OHNE Personennamen (z. B. "Hoodies Jugend 2027").
- termin: Liefer-/Wunschtermin als JJJJ-MM-TT. Relative Angaben ("nächsten Freitag", "in 2 Wochen") vom angegebenen Heute aus rechnen. Leer, wenn keiner genannt.
- kanal: genau einer aus [${kanaele.join(', ')}] oder leer, wenn er nicht genannt ist.
- wieLetztesMal: true, wenn die Notiz sich auf einen früheren Auftrag bezieht ("wie letztes Mal", "wie immer", "nochmal").
- gruppen: je Artikel + Farbe eine Gruppe.
  - artikel: Art des Artikels wie genannt (z. B. "Hoodie", "T-Shirt", "Kapuzenpulli").
  - modellNr: Modellnummer NUR, wenn sie in der Notiz steht (z. B. "E3000", "JH001"), sonst leer. Nie raten.
  - farbe: Farbe wie genannt (deutsch); farbeEn: dieselbe Farbe als gängiger englischer Textil-Farbname (z. B. "Black", "White", "Navy", "Red", "Heather Grey"), leer wenn keine Farbe genannt.
  - motiv: was gedruckt wird (Logo, Schriftzug), OHNE Personennamen. druck: Position/Technik (z. B. "Brust links", "Rücken groß", "Stick").
  - druckname: NUR Namen, die laut Notiz auf diese Artikel GEDRUCKT werden (Rückenname, Brustname, Namensliste), genau wie geschrieben.
    Mit Größe davor, wenn die Notiz sie zuordnet: "M: Anna, Ben; L: Carl", sonst nur die Namen mit Komma. Leer, wenn nichts gedruckt wird.
  - groessen: Liste {groesse, menge}, Größen in der üblichen Schreibweise (XS, S, M, L, XL, XXL, 3XL, 128, 140 …). Leer, wenn keine Größen genannt sind.
  - menge: Gesamtstückzahl, wenn ohne Größen genannt, sonst 0.
- frei: Positionen, die keine Textilien sind (Tassen, Sticker, Banner, mitgebrachte Ware), mit Menge (1, wenn keine genannt); druckname wie oben.
- todos: kurze Aufgaben, die in der Notiz stehen ("Logo als Vektor anfordern", "Angebot schicken"). Ohne Personennamen.
- hinweise: alles, was unklar ist oder nicht in die Felder passt, kurz und sachlich.
- notiz: was man sich zum Auftrag merken soll und NICHT schon in Positionen, Kurztitel, Termin oder Kanal steht: Absprachen,
  Wünsche zu Motiv/Druck/Farbe, Lieferung/Abholung, Zahlungsabsprache, offene Fragen an den Kunden. Kurze Stichpunkte, je Zeile
  mit "- ", höchstens 600 Zeichen. KEINE Personennamen - Rollen statt Namen ("Ansprechpartner", "Trainerin"); zu druckende Namen
  stehen nur in druckname. Leer, wenn es nichts Merkenswertes gibt (z. B. reine Mengenangaben).
- kundeNeu: Angaben zum Kunden, NUR wenn sie wörtlich in der Notiz stehen, sonst leer: art ("verein", "firma", "person" oder leer),
  name (Verein/Firma bzw. Vor- und Nachname der Person), ansprechpartner (Person bei Verein/Firma), strasse (mit Hausnummer), plz, ort,
  email, telefon. Nichts ergänzen oder ableiten: keine PLZ aus dem Ort, keine E-Mail aus dem Namen, keine Vorwahl dazuerfinden.

Regeln: Erfinde nichts. Was nicht in der Notiz steht, bleibt leer (bzw. leere Liste, Menge 0). Keine Preise berechnen.`;
}

export function userPrompt(text, heute) {
  return `Heute ist ${heute.wochentag}, ${heute.datum}.\n\nNotiz:\n<<<\n${text}\n>>>`;
}

/** Heute in Europe/Berlin: { datum: JJJJ-MM-TT, wochentag }. */
export function heuteBerlin(jetzt = new Date()) {
  const datum = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(jetzt);
  const wochentag = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long' }).format(jetzt);
  return { datum, wochentag };
}

// ── Pruefen der KI-Antwort ──────────────────────────────────────────────────────────────────────────────────────

export class KiUnsinnError extends Error {
  constructor(grund) {
    super(`Die KI-Antwort war nicht verwertbar (${grund}) – bitte Text prüfen und erneut versuchen.`);
    this.name = 'KiUnsinnError';
    this.code = 'ki_unsinn';
    this.status = 502;
  }
}

const ganz = (v, max = MENGE_MAX) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : 0;
};
const liste = v => (Array.isArray(v) ? v : []);

/**
 * Rohtext der KI (JSON) -> geprueftes, normalisiertes Objekt nach KI_SCHEMA. Kein JSON / falscher Typ = KiUnsinnError.
 * Unbekannte Felder fallen weg, Laengen werden gekappt, Mengen ausserhalb 0-999 = 0.
 */
export function pruefeKiAntwort(roh) {
  let o;
  try {
    const s = t(roh);
    const m = s.match(/\{[\s\S]*\}/);
    o = JSON.parse(m ? m[0] : s);
  } catch { throw new KiUnsinnError('kein JSON'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new KiUnsinnError('kein Objekt');
  for (const f of ['gruppen', 'frei']) if (o[f] !== undefined && !Array.isArray(o[f])) throw new KiUnsinnError(`${f} ist keine Liste`);
  return {
    kunde: liste(o.kunde).map(x => kappe(x, 60)).filter(Boolean).slice(0, 3),
    kurztitel: kappe(o.kurztitel, 80),
    termin: kappe(o.termin, 10),
    kanal: kappe(o.kanal, 20),
    wieLetztesMal: o.wieLetztesMal === true,
    gruppen: liste(o.gruppen).slice(0, 20).filter(g => g && typeof g === 'object').map(g => ({
      artikel: kappe(g.artikel, 60), modellNr: kappe(g.modellNr, 20), farbe: kappe(g.farbe, 40), farbeEn: kappe(g.farbeEn, 40),
      motiv: kappe(g.motiv, 120), druck: kappe(g.druck, 120), menge: ganz(g.menge), druckname: kappe(g.druckname, DRUCKNAME_MAX),
      groessen: liste(g.groessen).slice(0, 30).filter(x => x && typeof x === 'object')
        .map(x => ({ groesse: kappe(x.groesse, 20), menge: ganz(x.menge) })).filter(x => x.groesse && x.menge > 0),
    })),
    frei: liste(o.frei).slice(0, 20).filter(x => x && typeof x === 'object')
      .map(x => ({ text: kappe(x.text, 120), menge: ganz(x.menge, 9999) || 1, druckname: kappe(x.druckname, DRUCKNAME_MAX) })).filter(x => x.text),
    todos: liste(o.todos).map(x => kappe(x, 200)).filter(Boolean).slice(0, 10),
    hinweise: liste(o.hinweise).map(x => kappe(x, 200)).filter(Boolean).slice(0, 10),
    kundeNeu: kundeNeuForm(o.kundeNeu),
    notiz: kappe(o.notiz, NOTIZ_MAX),   // SA4
  };
}

// ── SA4: Notiz und Drucknamen ───────────────────────────────────────────────────────────────────────────────────
export const NOTIZ_MAX = 600;
export const DRUCKNAME_MAX = 300;
const NAME_ERSATZ = '(Name)';

/**
 * Drucknamen pruefen: nur Namen, die WOERTLICH im Text stehen (Gross/Klein egal). Groesse davor nur, wenn es sie in der
 * Gruppe gibt ("M: Anna, Ben; L: Carl"); sonst faellt die Groesse weg, die Namen bleiben.
 * @returns {{ wert: string, namen: string[], weg: number }}
 */
export function drucknamePruefen(druckname, text, groessen = []) {
  const roh = klein(text).replace(/\s+/g, ' ');
  const gr = new Set((groessen ?? []).map(g => t(g).toUpperCase().replace(/\s+/g, '')));
  const segmente = [], namen = [];
  let weg = 0;
  for (const seg of t(druckname).split(';').map(t).filter(Boolean)) {
    const m = seg.match(/^([A-Za-z0-9/ ]{1,12}):\s*(.*)$/);
    const groesse = m && gr.has(m[1].toUpperCase().replace(/\s+/g, '')) ? m[1].trim() : '';
    const rest = m ? m[2] : seg;   // unbekannte Groesse: Namen bleiben, die Groesse faellt weg
    const da = rest.split(',').map(x => t(x).replace(/\s+/g, ' ')).filter(Boolean).filter(n => {
      const ok = n.length >= 2 && n.length <= 40 && roh.includes(klein(n));
      if (!ok) weg++;
      return ok;
    });
    if (!da.length) continue;
    namen.push(...da);
    segmente.push(groesse ? `${groesse}: ${da.join(', ')}` : da.join(', '));
  }
  const wert = segmente.join('; ').slice(0, DRUCKNAME_MAX);
  return { wert, namen, weg };
}

/** Notiz ohne bekannte Namen (Drucknamen, Kontaktname/Ansprechpartner aus dem Text) - ganze Woerter, Gross/Klein egal. */
export function notizOhneNamen(notiz, namen = []) {
  let s = t(notiz);
  let ersetzt = 0;
  const sortiert = [...new Set((namen ?? []).map(t).filter(n => n.length >= 2))].sort((a, b) => b.length - a.length);
  for (const n of sortiert) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu');
    s = s.replace(re, () => { ersetzt++; return NAME_ERSATZ; });
  }
  return { notiz: s.slice(0, NOTIZ_MAX), ersetzt };
}

// ── Kunde (MC sucht selbst) ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Stichwoerter -> bis zu 3 Kunden_Nr. Erst jedes Stichwort als Ganzes (sucheKunden: alle Woerter), dann Woerter ab 3
 * Zeichen einzeln. Sicher nur bei genau einem Treffer aus einem ganzen Stichwort.
 * @returns {{ vorschlaege: string[], sicher: boolean, grund: string }}
 */
export function kundenVorschlaege(kunden, stichwoerter) {
  const aktiv = (kunden ?? []).filter(k => t(k.Status || 'aktiv') === 'aktiv');
  const sw = liste(stichwoerter).map(t).filter(x => x.length >= 2);
  if (!sw.length) return { vorschlaege: [], sicher: false, grund: 'Kein Kunde im Text erkannt.' };
  const ganzTreffer = new Map();
  for (const s of sw) for (const k of sucheKunden(aktiv, s)) ganzTreffer.set(k.Kunden_Nr, k);
  if (ganzTreffer.size === 1) return { vorschlaege: [...ganzTreffer.keys()], sicher: true, grund: '' };
  if (ganzTreffer.size > 1) {
    return { vorschlaege: [...ganzTreffer.keys()].slice(0, KUNDE_VORSCHLAEGE_MAX), sicher: false,
      grund: `Kunde nicht eindeutig (${ganzTreffer.size} Treffer) – bitte wählen.` };
  }
  const zaehl = new Map();
  for (const w of new Set(sw.flatMap(s => s.split(/\s+/)).filter(w => w.length >= 3))) {
    for (const k of sucheKunden(aktiv, w)) zaehl.set(k.Kunden_Nr, (zaehl.get(k.Kunden_Nr) ?? 0) + 1);
  }
  const nr = [...zaehl.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
  return nr.length
    ? { vorschlaege: nr.slice(0, KUNDE_VORSCHLAEGE_MAX), sicher: false, grund: 'Kunde nur ähnlich gefunden – bitte prüfen.' }
    : { vorschlaege: [], sicher: false, grund: 'Kein passender Kunde in MC – suchen oder neu anlegen.' };
}

// ── Termin, Kanal ───────────────────────────────────────────────────────────────────────────────────────────────

export function terminPruefen(termin, heute) {
  const s = t(termin);
  if (!s) return { wert: '', grund: '' };
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!d || d.toISOString().slice(0, 10) !== s) return { wert: '', grund: `Termin „${s}“ ist kein gültiges Datum.` };
  const h = new Date(`${heute}T00:00:00Z`);
  const tage = Math.round((d - h) / 86400000);
  if (tage < 0) return { wert: '', grund: `Termin ${s} liegt in der Vergangenheit – bitte prüfen.` };
  if (tage > TERMIN_TAGE_MAX) return { wert: '', grund: `Termin ${s} liegt über ein Jahr in der Zukunft – bitte prüfen.` };
  return { wert: s, grund: 'Termin von der KI berechnet – bitte prüfen.' };
}

export function kanalPruefen(kanal, kanaele) {
  const s = t(kanal);
  if (!s) return { wert: '', grund: '' };
  const k = kanaele.find(x => klein(x) === klein(s));
  return k ? { wert: k, grund: '' } : { wert: '', grund: `Kanal „${s}“ unbekannt.` };
}

// ── Modell, Farbe, Groesse ──────────────────────────────────────────────────────────────────────────────────────

// Deutsche Artikelwoerter -> Suchwoerter in LShop_Modelle (Description ist englisch). Nur Suche, nie Zuordnung allein.
export const ARTIKEL_SUCHE = [
  [/kapuze|hood/, ['hood']],
  [/zip|jacke|jacket/, ['zip', 'jacket']],
  [/sweat|pulli|pullover/, ['sweat']],
  [/polo/, ['polo']],
  [/t-?shirt|shirt|tshirt/, ['t-shirt']],
  [/tank|top/, ['tank']],
  [/cap|kappe|muetze|beanie/, ['cap', 'beanie']],
  [/tasche|beutel|bag/, ['bag']],
  [/hose|jogg/, ['pants']],
];

export function suchwoerter(artikel) {
  const a = klein(artikel);
  const w = new Set();
  if (a.length >= 3) w.add(a);
  // Nur die ERSTE passende Artikelart (SA1-1, gemessen 17.11.: "Kapuzenpulli" suchte sonst auch "sweat" - 43 statt 34 Modelle).
  const art = ARTIKEL_SUCHE.find(([re]) => re.test(a));
  if (art) art[1].forEach(x => w.add(x));
  return [...w];
}

/**
 * Modell einer Gruppe. modellNr -> CatalogNr bzw. Hersteller-Nr. genau (sicher). Sonst Kandidaten ueber die
 * Suchwoerter; Modelle aus der Kunden-Historie zuerst. Genau ein Historien-Kandidat bzw. genau ein Kandidat ->
 * zugeordnet, aber unsicher. Sonst keins + Vorschlaege.
 * @param {object[]} zeilen   ladeLShopZeilen()
 * @param {string[]} historie CatalogNr aus der AM-6-Historie des Kunden (neueste zuerst, nur noch waehlbare)
 * @returns {{ catalogNr: string, sicher: boolean, grund: string, vorschlaege: string[] }}
 */
export function modellZuordnen(gruppe, zeilen, historie = []) {
  const nr = t(gruppe.modellNr);
  if (nr) {
    const v = nr.toLowerCase().replace(/\s+/g, '');
    const z = zeilen.find(x => t(x.catalogNr).toLowerCase() === v) ?? zeilen.find(x => t(x.herstellerNr).toLowerCase().replace(/\s+/g, '') === v);
    if (z) return { catalogNr: t(z.catalogNr), sicher: true, grund: '', vorschlaege: [] };
  }
  const kand = new Map();
  for (const w of suchwoerter(gruppe.artikel)) {
    for (const m of sucheModelle(zeilen, w).modelle) if (m.bestellbar > 0) kand.set(m.catalogNr, m);
  }
  const ausHist = historie.filter(c => kand.has(c));
  const was = [nr && `Modell „${nr}“`, t(gruppe.artikel) && `„${t(gruppe.artikel)}“`].filter(Boolean).join(' / ') || 'Artikel';
  if (nr && !kand.size) return { catalogNr: '', sicher: false, grund: `${was} nicht in LShop_Modelle.`, vorschlaege: [] };
  if (ausHist.length === 1) return { catalogNr: ausHist[0], sicher: false, grund: `${was}: Modell aus früheren Aufträgen des Kunden – bitte prüfen.`, vorschlaege: [] };
  if (kand.size === 1) return { catalogNr: [...kand.keys()][0], sicher: false, grund: `${was}: einziges passendes Modell – bitte prüfen.`, vorschlaege: [] };
  const vorschlaege = [...new Set([...ausHist, ...kand.keys()])].slice(0, MODELL_VORSCHLAEGE_MAX);
  return {
    catalogNr: '', sicher: false, vorschlaege,
    grund: kand.size ? `${was}: Modell nicht eindeutig (${kand.size} passen) – bitte wählen.` : `${was}: kein passendes L-Shop-Modell gefunden.`,
  };
}

// Kleine Liste deutscher Farbwoerter als Zusatz zu farbeEn der KI (nur Kandidaten, geprueft wird gegen das Modell).
const FARBEN_DE = {
  schwarz: 'black', weiss: 'white', rot: 'red', blau: 'blue', dunkelblau: 'navy', marine: 'navy', navy: 'navy',
  grau: 'grey', hellgrau: 'light grey', dunkelgrau: 'dark grey', gruen: 'green', gelb: 'yellow', orange: 'orange',
  lila: 'purple', rosa: 'pink', pink: 'pink', braun: 'brown', beige: 'beige', bordeaux: 'burgundy', tuerkis: 'turquoise',
};

/**
 * Farbe gegen die Farben des Modells. Genau gleich (farbeEn, farbe, deutsches Wort) = sicher; sonst eindeutiger
 * Teiltreffer = unsicher; mehrere/keiner = leer + Grund + Auswahl.
 * @returns {{ farbe: string|null, sicher: boolean, grund: string, auswahl: string[] }}
 */
export function farbeZuordnen(gruppe, farben) {
  const alle = [...new Set(farben)];
  const echte = alle.filter(f => f !== '');
  if (!echte.length) return { farbe: '', sicher: true, grund: '', auswahl: [] };   // Modell ohne Farben
  const kandidaten = [...new Set([gruppe.farbeEn, gruppe.farbe, FARBEN_DE[klein(gruppe.farbe)]].map(klein).filter(Boolean))];
  if (!kandidaten.length) {
    if (echte.length === 1) return { farbe: echte[0], sicher: false, grund: 'Nur eine Farbe beim Modell – bitte prüfen.', auswahl: [] };
    return { farbe: null, sicher: false, grund: 'Keine Farbe genannt.', auswahl: echte.slice(0, 8) };
  }
  for (const k of kandidaten) {
    const f = echte.find(x => klein(x) === k);
    if (f) return { farbe: f, sicher: true, grund: '', auswahl: [] };
  }
  const woerter = x => klein(x).replace(/\([^)]*\)/g, ' ').split(/[\s/-]+/).filter(Boolean);
  const genannt = t(gruppe.farbe || gruppe.farbeEn);
  // SA1-1 (gemessen 17.11.): erst Modellfarben, deren Woerter ALLE im genannten Namen stehen ("Royal" bei "Royal Blue"),
  // dann Modellfarben, die ein genanntes Wort enthalten ("Fire Red" bei "Red"). Beides nur eindeutig, immer orange.
  const allgemeiner = echte.filter(x => kandidaten.some(k => { const kw = woerter(k); return woerter(x).every(w => kw.includes(w)); }));
  if (allgemeiner.length === 1) return { farbe: allgemeiner[0], sicher: false, grund: `Farbe „${genannt}“ als „${allgemeiner[0]}“ gedeutet – bitte prüfen.`, auswahl: [] };
  const teil = echte.filter(x => kandidaten.some(k => woerter(x).includes(k) || klein(x).startsWith(k)));
  if (teil.length === 1) return { farbe: teil[0], sicher: false, grund: `Farbe „${genannt}“ als „${teil[0]}“ gedeutet – bitte prüfen.`, auswahl: [] };
  return {
    farbe: null, sicher: false, auswahl: (teil.length ? teil : echte).slice(0, 8),
    grund: teil.length ? `Farbe „${genannt}“ nicht eindeutig – bitte wählen.` : `Farbe „${genannt}“ gibt es beim Modell nicht.`,
  };
}

/** Groesse gegen die Groessen einer Farbe: genau gleich (gross/klein, Leerzeichen) oder gleicher Rang (XXL = 2XL). */
export function groesseFinden(groesse, varianten) {
  const g = t(groesse).toUpperCase().replace(/\s+/g, '');
  const gleich = varianten.find(v => t(v.groesse).toUpperCase().replace(/\s+/g, '') === g);
  if (gleich) return gleich;
  const r = groessenRang(g);
  if (!r) return null;
  return varianten.find(v => { const x = groessenRang(v.groesse); return x && x.klasse === r.klasse && x.rang === r.rang; }) ?? null;
}

/**
 * Eine KI-Gruppe -> Vorschlag. `varianten` = waehlbare Varianten des zugeordneten Modells (lshopAuswertung).
 * positionen nur mit gueltiger ArticleNr; nicht gefundene Groessen stehen in `grund`.
 */
export function gruppeVorschlag(gruppe, modell, varianten) {
  const basis = {
    stichwort: [gruppe.artikel, gruppe.modellNr, gruppe.farbe].filter(Boolean).join(' '),
    motiv: gruppe.motiv, druck: gruppe.druck, wunsch: gruppe.groessen,
    farbWunsch: [...new Set([gruppe.farbeEn, gruppe.farbe, FARBEN_DE[klein(gruppe.farbe)]].filter(Boolean))],   // nur zum Vorwaehlen im Raster
    mengenText: gruppe.groessen.length ? gruppe.groessen.map(x => `${x.groesse} × ${x.menge}`).join(', ') : (gruppe.menge ? `${gruppe.menge} Stück` : ''),
  };
  if (!modell.catalogNr) {
    return { ...basis, ok: false, modell: '', farbe: '', positionen: [], grund: [modell.grund], vorschlaege: modell.vorschlaege, farbAuswahl: [] };
  }
  const grund = modell.sicher ? [] : [modell.grund];
  const f = farbeZuordnen(gruppe, varianten.map(v => v.farbe));
  if (f.grund) grund.push(f.grund);
  if (f.farbe === null) {
    return { ...basis, ok: false, modell: modell.catalogNr, farbe: '', positionen: [], grund, vorschlaege: [], farbAuswahl: f.auswahl };
  }
  const jeFarbe = varianten.filter(v => v.farbe === f.farbe);
  const positionen = [], fehlt = [];
  for (const x of gruppe.groessen) {
    const v = groesseFinden(x.groesse, jeFarbe);
    if (!v) { fehlt.push(`${x.groesse} × ${x.menge}`); continue; }
    const da = positionen.find(p => p.articleNr === v.articleNr);
    if (da) da.menge = Math.min(MENGE_MAX, da.menge + x.menge);
    else positionen.push({ articleNr: v.articleNr, groesse: v.groesse, menge: x.menge, ...(v.lieferbar ? { lieferbar: v.lieferbar } : {}) });
  }
  if (fehlt.length) grund.push(`Größe nicht beim Modell: ${fehlt.join(', ')}.`);
  if (!gruppe.groessen.length && gruppe.menge) grund.push(`${gruppe.menge} Stück ohne Größen – im Raster verteilen.`);
  else if (!gruppe.groessen.length) grund.push('Keine Größen/Mengen genannt.');
  return { ...basis, ok: positionen.length > 0, modell: modell.catalogNr, farbe: f.farbe, positionen, grund, vorschlaege: [], farbAuswahl: f.auswahl };
}

/**
 * Gesamter Vorschlag fuer den Dialog. Enthaelt nur Kunden_Nr (keine Personendaten) und gepruefte Werte.
 */
// ── SA2: neuen Kunden aus dem Text vorbelegen ──────────────────────────────────────────────────────────────────
// Grenzen wie die Kundenmaske (#ku-dialog maxlength). Ungueltige Form -> leer (nie "reparieren").
export const KUNDE_NEU_FELDER = { name: 120, ansprechpartner: 120, strasse: 120, plz: 12, ort: 80, email: 120, telefon: 40 };
export const KUNDE_ARTEN = { verein: 'Verein', firma: 'Firma', person: 'Person' };
const leerKunde = () => ({ art: '', ...Object.fromEntries(Object.keys(KUNDE_NEU_FELDER).map(f => [f, ''])) });

/** Form pruefen (Typen, Laengen, E-Mail, PLZ, Telefon, Art); Ungueltiges -> ''. */
export function kundeNeuForm(o) {
  const k = leerKunde();
  if (!o || typeof o !== 'object' || Array.isArray(o)) return k;
  for (const [f, max] of Object.entries(KUNDE_NEU_FELDER)) {
    const v = t(o[f]).replace(/\s+/g, ' ');
    k[f] = v.length <= max ? v : '';
  }
  k.art = KUNDE_ARTEN[klein(o.art)] ?? '';
  if (k.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(k.email)) k.email = '';
  if (k.plz && !/^\d{4,5}$/.test(k.plz)) k.plz = '';
  if (k.telefon && !/^\+?[\d\s/().-]{5,}$/.test(k.telefon)) k.telefon = '';
  return k;
}

/**
 * Nur, was WOERTLICH im Text steht (Gross/Klein und Leerzeichen egal; Telefon ueber die Ziffern). Was die KI ergaenzt
 * oder abgeleitet hat, wird leer. Liefert { felder, leer } - leer = nichts Verwertbares (dann kein Knopf).
 */
export function kundeNeuPruefen(kundeNeu, text) {
  const k = kundeNeuForm(kundeNeu);
  const roh = klein(text).replace(/\s+/g, ' ');
  const ziffern = String(text ?? '').replace(/\D/g, '');
  for (const f of Object.keys(KUNDE_NEU_FELDER)) {
    if (!k[f]) continue;
    const steht = f === 'telefon' ? k[f].replace(/\D/g, '').length >= 5 && ziffern.includes(k[f].replace(/\D/g, '')) : roh.includes(klein(k[f]));
    if (!steht) k[f] = '';
  }
  const leer = !Object.keys(KUNDE_NEU_FELDER).some(f => k[f]);
  if (leer) k.art = '';
  return { felder: k, leer };
}

export function baueVorschlag({ ki, kunde, termin, kanal, gruppen, kundeNeu = null, notiz = null }) {
  const n = notiz ?? { notiz: ki.notiz ?? '', ersetzt: 0 };   // SA4
  return {
    kunde: { ...kunde, stichwoerter: ki.kunde },   // Stichwoerter nur fuer das Suchfeld im Dialog
    kopf: { Kurztitel: ki.kurztitel, Kanal: kanal.wert, Termin: termin.wert, Notiz: n.notiz },
    unsicher: {
      ...(ki.kurztitel ? { Kurztitel: 'Kurztitel von der KI – bitte prüfen.' } : {}),
      ...(n.notiz ? { Notiz: `Notiz von der KI – bitte prüfen.${n.ersetzt ? ` ${n.ersetzt} Name(n) durch „(Name)“ ersetzt.` : ''}` } : {}),
      ...(termin.grund ? { Termin: termin.grund } : {}),
      ...(kanal.grund ? { Kanal: kanal.grund } : {}),
    },
    gruppen,
    frei: ki.frei,
    todos: ki.todos,
    hinweise: ki.hinweise,
    wieLetztesMal: ki.wieLetztesMal,
    // SA2: nur ohne sicheren Kunden-Treffer und nur mit Angaben aus dem Text (sonst kein Knopf zum Neuanlegen)
    ...(kundeNeu && !kundeNeu.leer && !kunde.sicher ? { kundeNeu: kundeNeu.felder } : {}),
  };
}
