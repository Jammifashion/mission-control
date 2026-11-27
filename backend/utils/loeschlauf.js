// Datenschutz-Loeschlauf (FIX4): reine Logik. Lesen/Schreiben in lib/loeschlauf.js.
// Geleert werden nur einzelne Zellen, Zeilen bleiben (Statistik, Abrechnung). Ausgaben nur Anzahlen und Nummern.
//
//  - Bestellseite (SSOT Bestell_Eintraege): Trikot_Name + Wunsch, 12 Monate nach dem Termin-Datum (Bestell_Termine.Datum),
//    ohne Termin nach `Zeit` des Eintrags. Zusage auf der Bestellseite: Rueckennamen nach 12 Monaten geloescht.
//  - Trikots (Business-Reiter Trikots): Name, Kunde, Rohtext 12 Monate nach Geliefert_Am, sonst nach Bestelldatum.
//  - Kundenanfragen (Business): Anfragen OHNE Auftrag (keine Auftraege.Anfrage_ID, keine WC-Order-ID) 12 Monate nach
//    Datum -> Kunde-Name, Kunde-Email, Produkt-Beschreibung, Varianten, Anmerkungen-Kunde, Notiz-intern leer.
//  - Gespraechsverlauf (Business Kundenanfragen_Verlauf, KA2): IMMER 12 Monate nach dem Zeitpunkt (= Absenden der Anfrage),
//    auch wenn aus der Anfrage ein Auftrag wurde -> Nachrichten leer (Zusage im Chat-Hinweis, Inhaber 27.11.).
//  - Drucknamen der Auftraege: utils/druckname-loeschen.js (SA4), derselbe Lauf ruft leereDrucknamen auf.

export const LOESCH_MONATE = 12;

export const FELDER = {
  bestellEintraege: ['Trikot_Name', 'Wunsch'],
  trikots: ['Name', 'Kunde', 'Rohtext'],
  anfragen: ['Kunde-Name', 'Kunde-Email', 'Produkt-Beschreibung', 'Varianten', 'Anmerkungen-Kunde', 'Notiz-intern'],
  verlauf: ['Nachrichten'],
};

const t = v => String(v ?? '').trim();

/** Datum aus JJJJ-MM-TT…, TT.MM.JJJJ oder Sheets-Seriennummer -> Date (UTC-Tag) oder null. */
export function datumAus(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
  const s = t(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  if (/^\d{5}(\.\d+)?$/.test(s)) return datumAus(Number(s));
  return null;
}

/** heute minus `monate` Kalendermonate (UTC-Tag). */
export function grenzeVon(jetzt, monate = LOESCH_MONATE) {
  const d = new Date(jetzt);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monate, d.getUTCDate()));
}

/** Werte (Kopf + Zeilen) -> [{ _zeile, ...Spalte: Wert }]. */
export function zeilenAus(werte) {
  const [kopf = [], ...rows] = werte ?? [];
  return { kopf, zeilen: rows.map((r, i) => ({ _zeile: i + 2, ...Object.fromEntries(kopf.map((k, j) => [k, r[j] ?? ''])) })) };
}

/** Zellen zum Leeren einer Zeile: nur Felder, die es gibt und die nicht leer sind. */
function zellen(z, felder, kopf) {
  return felder.filter(f => kopf.includes(f) && t(z[f]) !== '').map(f => ({ feld: f, alt: z[f] }));
}

/**
 * Plan fuer einen Bereich. `stichtag(z)` liefert das massgebliche Datum einer Zeile (oder null = nicht geleert, gezaehlt
 * als ohneDatum); `ausnahme(z)` = Zeile bleibt (z. B. Anfrage mit Auftrag).
 * @returns {{ leeren: { zeile, id, zellen }[], zaehler: { faellig, jung, ohneDatum, ausnahme } }}
 */
export function bereichPlan({ werte, felder, idSpalte, stichtag, ausnahme = () => false, jetzt, monate = LOESCH_MONATE }) {
  const { kopf, zeilen } = zeilenAus(werte);
  const grenze = grenzeVon(jetzt, monate);
  const zaehler = { faellig: 0, jung: 0, ohneDatum: 0, ausnahme: 0 };
  const leeren = [];
  for (const z of zeilen) {
    const zl = zellen(z, felder, kopf);
    if (!zl.length) continue;
    if (ausnahme(z)) { zaehler.ausnahme++; continue; }
    const d = stichtag(z);
    if (!d) { zaehler.ohneDatum++; continue; }
    if (d > grenze) { zaehler.jung++; continue; }
    zaehler.faellig++;
    leeren.push({ zeile: z._zeile, id: t(z[idSpalte]), zellen: zl });
  }
  return { kopf, leeren, zaehler };
}

/** Bestellseite: Termin-Datum (Bestell_Termine), sonst Zeit des Eintrags. */
export function bestellEintraegePlan({ eintraege, termine, jetzt }) {
  const datumJe = new Map(zeilenAus(termine).zeilen.map(z => [t(z.Termin_ID), datumAus(z.Datum)]));
  return bereichPlan({ werte: eintraege, felder: FELDER.bestellEintraege, idSpalte: 'Eintrag_ID', jetzt,
    stichtag: z => datumJe.get(t(z.Termin_ID)) ?? datumAus(z.Zeit) });
}

/** Trikots: Geliefert_Am, sonst Bestelldatum. */
export function trikotsPlan({ trikots, jetzt }) {
  return bereichPlan({ werte: trikots, felder: FELDER.trikots, idSpalte: 'Zeilen-ID', jetzt,
    stichtag: z => datumAus(z.Geliefert_Am) ?? datumAus(z.Bestelldatum) });
}

/** Kundenanfragen ohne Auftrag: Datum; mit Auftrag (Auftraege.Anfrage_ID) oder WC-Order-ID bleibt die Zeile. */
export function anfragenPlan({ anfragen, auftraege, jetzt }) {
  const mitAuftrag = new Set(zeilenAus(auftraege).zeilen.map(z => t(z.Anfrage_ID)).filter(Boolean));
  return bereichPlan({ werte: anfragen, felder: FELDER.anfragen, idSpalte: 'Anfrage-ID', jetzt,
    stichtag: z => datumAus(z.Datum),
    ausnahme: z => mitAuftrag.has(t(z['Anfrage-ID'])) || t(z['WC-Order-ID']) !== '' });
}

/** KA2: Gespraechsverlauf - immer nach Zeitpunkt, keine Ausnahme fuer Anfragen mit Auftrag. */
export function verlaufPlan({ verlauf, jetzt }) {
  return bereichPlan({ werte: verlauf, felder: FELDER.verlauf, idSpalte: 'Anfrage-ID', jetzt, stichtag: z => datumAus(z.Zeitpunkt) });
}

/** Chat-Text: nur Anzahlen. */
export function loeschlaufText({ scharf, ergebnis }) {
  const z = (n, was) => `${was}: ${n.faellig ?? n} ${scharf ? 'geleert' : 'fällig'}`;
  return [
    `🧹 Datenschutz-Löschlauf${scharf ? '' : ' (Trockenlauf)'}`,
    ...Object.entries(ergebnis).map(([k, v]) => (v.fehler ? `${k}: Fehler (${v.fehler})` : z(v.zaehler ?? v, k))),
  ].join('\n');
}
