// Bestellseite KS2: Termine anlegen, Eintraege absenden/aendern/stornieren - reine Logik ohne Netz.
// Lesen/Schreiben in lib/bestellEintraege.js. Die Seite schreibt NUR in Bestell_Termine und Bestell_Eintraege.
//
// Regeln (Inhaber 06./07.11.): je Termin eine Liste; Termine legen die Leute vor Ort selbst an (nur Art dauer, Datum >= heute,
// gleiches Datum = vorhandener Termin); nach Bestellschluss weiter erlaubt, Eintrag bekommt Nach_Schluss = ja; alle mit dem
// Link sehen und aendern alle Eintraege ihres Zugangs bis "übernommen", "geändert von <Kürzel>"; Kürzel Pflicht (<= 12).
// Kürzel, Rückennamen, Wünsche, Freitexte stehen nur im Sheet und auf der Seite dieses Zugangs - nie in Log, Chat, Fehlertext.

import { heuteBerlin, fristen, zugangTage, naechsteTerminId, fehler, ART, TERMIN_STATUS_OFFEN } from './bestellseite.js';

// KS2-1: Notiz je Position (alle Arten, <= 100) - eigene Spalte hinten, damit Freitext/Fuer/Wunsch ihre Bedeutung behalten
// und KS3 sie in die Notiz der Auftragsposition uebernehmen kann. Datenschutz wie Rueckennamen (nie Log/Chat, Leeren nach 12 Monaten).
export const EINTRAG_OPTIONAL = ['Groesse', 'Bezeichnung', 'Trikot_Produkt', 'Vorgang', 'Geaendert_Von', 'Notiz'];
export const E_STATUS = { EINGEGANGEN: 'eingegangen', GEPRUEFT: 'geprüft', UEBERNOMMEN: 'übernommen', STORNIERT: 'storniert' };
export const OFFEN = [E_STATUS.EINGEGANGEN, E_STATUS.GEPRUEFT];
export const E_ART = { ARTIKEL: 'artikel', EXTRA: 'extra', TRIKOT: 'trikot' };
export const MAX = { positionNotiz: 100, kuerzel: 12, notiz: 60, freitext: 200, fuer: 40, name: 30, nummer: 3, wunsch: 200, positionen: 60, menge: 999, offenJeTermin: 500 };

const t = v => String(v ?? '').trim();
const ein = v => t(v).replace(/\s+/g, ' ');
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

/** Kürzel: Pflicht, 1-12 Zeichen, Buchstaben/Ziffern/Leer/Punkt/Bindestrich. Fehlertext ohne den Wert. */
export function kuerzelAus(v) {
  const k = ein(v);
  if (!k) throw fehler('Bitte Kürzel oder Vornamen eintragen.');
  if (k.length > MAX.kuerzel || !/^[\p{L}\p{N} .\-]+$/u.test(k)) throw fehler(`Kürzel: höchstens ${MAX.kuerzel} Zeichen, nur Buchstaben und Ziffern.`);
  return k;
}
const text = (v, max, was, pflicht = false) => {
  const x = ein(v);
  if (pflicht && !x) throw fehler(`${was} fehlt.`);
  if (x.length > max) throw fehler(`${was}: höchstens ${max} Zeichen.`);
  return x;
};
const menge = (v, was = 'Menge') => {
  const n = Number(t(v));
  if (!Number.isInteger(n) || n < 1 || n > MAX.menge) throw fehler(`${was}: ganze Zahl 1–${MAX.menge}.`);
  return n;
};
const nummer = v => {
  const n = t(v);
  if (n && !new RegExp(`^\\d{1,${MAX.nummer}}$`).test(n)) throw fehler(`Rückennummer: nur Ziffern (höchstens ${MAX.nummer}).`);
  return n;
};

// ── Termine ──────────────────────────────────────────────────────────────────

/** Termin vergangen (Datum vor heute, Berlin)? Ohne Datum (Art auftrag ohne Termin) nie. */
export const terminVergangen = (termin, jetzt) => DATUM.test(t(termin?.Datum)) && t(termin.Datum) < heuteBerlin(jetzt);
/** Nach Bestellschluss (heute nach Datum - Bestellschluss_Tage)? */
export function nachSchluss(termin, zugang, jetzt) {
  const { bestellschluss } = fristen(termin?.Datum, zugangTage(zugang));
  return !!bestellschluss && heuteBerlin(jetzt) > bestellschluss;
}

/**
 * + Termin (nur Art dauer). Gleiches Datum im Zugang = vorhandener Termin (kein zweiter).
 * @returns {{ vorhanden?: object, neu?: object }}
 */
export function terminPlan({ zugang, termine, eingabe, jetzt }) {
  if (zugang.Art !== ART.DAUER) throw fehler('Für diese Bestellseite gibt es genau einen Termin – kein Anlegen.');
  const datum = t(eingabe?.datum);
  if (!DATUM.test(datum)) throw fehler('Datum fehlt (TT.MM.JJJJ).');
  if (datum < heuteBerlin(jetzt)) throw fehler('Das Datum liegt in der Vergangenheit.');
  const notiz = text(eingabe?.notiz, MAX.notiz, 'Notiz');
  const vorhanden = (termine ?? []).find(x => x.Zugang_ID === zugang.Zugang_ID && t(x.Datum) === datum);
  if (vorhanden) return { vorhanden };
  const stand = new Date(jetzt).toISOString();
  return { neu: {
    Termin_ID: naechsteTerminId(termine), Zugang_ID: zugang.Zugang_ID, Datum: datum, Notiz: notiz,
    Bestellschluss: fristen(datum, zugangTage(zugang)).bestellschluss, Auftrag_Nr: '', Status: TERMIN_STATUS_OFFEN,
    Angelegt: heuteBerlin(jetzt), Stand: stand,
  } };
}

// ── Auswahl aus dem Katalog ──────────────────────────────────────────────────

/**
 * Index der waehlbaren Groessen: id (WC-Variation bzw. ArticleNr bei Art auftrag) -> Karte + Groesse.
 * Trikots: produktId -> { name, groessen }.
 */
export function auswahlIndex({ artikel, trikots, art }) {
  const je = new Map();
  for (const a of artikel ?? []) for (const g of a.groessen ?? []) {
    if (!t(g.id)) continue;
    je.set(t(g.id), {
      karte: t(a.key), groesse: t(g.groesse), bezeichnung: [t(a.name), t(a.farbe), t(a.design)].filter(Boolean).join(' · '),
      wcId: art === ART.AUFTRAG ? '' : t(g.id), articleNr: t(g.articleNr),
    });
  }
  const tr = new Map((trikots ?? []).map(x => [t(x.produktId), { name: t(x.name), groessen: (x.groessen ?? []).map(t) }]));
  return { je, trikots: tr };
}

const naechsteEintragId = (eintraege, versatz) => {
  const max = (eintraege ?? []).reduce((m, x) => { const r = /^BE-(\d+)$/.exec(t(x.Eintrag_ID)); return r ? Math.max(m, Number(r[1])) : m; }, 0);
  return `BE-${String(max + 1 + versatz).padStart(5, '0')}`;
};

/** Eine Position der Eingabe -> Felder fuer die Zeile. nr = Position (fuer Fehlertexte, ohne Werte). */
function positionFelder(p, idx, nr) {
  const art = t(p?.art);
  if (art === E_ART.ARTIKEL) {
    const w = idx.je.get(t(p.id));
    if (!w) throw fehler(`Position ${nr}: Artikel/Größe ist auf dieser Bestellseite nicht wählbar.`);
    return { Art: art, WC_Variation_ID: w.wcId, LShop_ArticleNr: w.articleNr, Menge: menge(p.menge, `Position ${nr}: Menge`),
      Groesse: w.groesse, Bezeichnung: w.bezeichnung };
  }
  if (art === E_ART.EXTRA) {
    return { Art: art, Freitext: text(p.freitext, MAX.freitext, `Position ${nr}: Text`, true), Menge: menge(p.menge, `Position ${nr}: Menge`),
      Fuer: text(p.fuer, MAX.fuer, `Position ${nr}: „für wen“`), Bezeichnung: 'Extra' };
  }
  if (art === E_ART.TRIKOT) {
    const tr = idx.trikots.get(t(p.produktId));
    if (!tr) throw fehler(`Position ${nr}: Trikot ist auf dieser Bestellseite nicht wählbar.`);
    const groesse = t(p.groesse).toUpperCase();
    if (!tr.groessen.includes(groesse)) throw fehler(`Position ${nr}: Trikot-Größe nicht wählbar.`);
    return { Art: art, Trikot_Produkt: t(p.produktId), Groesse: groesse, Menge: 1, Bezeichnung: tr.name,
      Trikot_Name: text(p.name, MAX.name, `Position ${nr}: Rückenname`), Trikot_Nummer: nummer(p.nummer),
      Wunsch: text(p.wunsch, MAX.wunsch, `Position ${nr}: Wunsch`) };
  }
  throw fehler(`Position ${nr}: Art unbekannt.`);
}

/**
 * Absenden: alle Positionen in EINEM Schreibvorgang. Grenzen: 1-60 Positionen, Menge 1-999, je Termin hoechstens 500 offene.
 * @returns {object[]} neue Zeilen (Objekte nach Spaltenname)
 */
export function absendenPlan({ zugang, termin, eintraege, idx, eingabe, jetzt }) {
  if (!termin || termin.Zugang_ID !== zugang.Zugang_ID) throw fehler('Termin gibt es auf dieser Bestellseite nicht.', 404);
  if (terminVergangen(termin, jetzt)) throw fehler('Der Termin ist vorbei – nur noch lesen.');
  const kuerzel = kuerzelAus(eingabe?.kuerzel);
  const pos = Array.isArray(eingabe?.positionen) ? eingabe.positionen : [];
  if (!pos.length) throw fehler('Nichts zum Absenden.');
  if (pos.length > MAX.positionen) throw fehler(`Höchstens ${MAX.positionen} Positionen je Absenden.`);
  const offen = (eintraege ?? []).filter(x => x.Termin_ID === termin.Termin_ID && OFFEN.includes(t(x.Status))).length;
  if (offen + pos.length > MAX.offenJeTermin) throw fehler(`Für diesen Termin sind höchstens ${MAX.offenJeTermin} offene Positionen möglich.`);
  const zeit = new Date(jetzt).toISOString();
  const spaet = nachSchluss(termin, zugang, jetzt) ? 'ja' : '';
  return pos.map((p, i) => ({
    Eintrag_ID: naechsteEintragId(eintraege, i), Zugang_ID: zugang.Zugang_ID, Termin_ID: termin.Termin_ID, Gegner_Notiz: '',
    Kuerzel: kuerzel, WC_Variation_ID: '', LShop_ArticleNr: '', Freitext: '', Fuer: '', Trikot_Name: '', Trikot_Nummer: '', Wunsch: '',
    Groesse: '', Bezeichnung: '', Trikot_Produkt: '',
    ...positionFelder(p, idx, i + 1),
    Notiz: text(p?.notiz, MAX.positionNotiz, `Position ${i + 1}: Notiz`),   // KS2-1
    Zeit: zeit, Nach_Schluss: spaet, Status: E_STATUS.EINGEGANGEN, Auftrag_Nr: '', Position_ID: '', Stand: zeit,
    Vorgang: t(eingabe?.vorgang), Geaendert_Von: '',
  }));
}

function aenderbar({ zugang, termin, eintrag, eingabe, jetzt }) {
  if (!eintrag || eintrag.Zugang_ID !== zugang.Zugang_ID) throw fehler('Eintrag gibt es auf dieser Bestellseite nicht.', 404);
  if (t(eintrag.Status) === E_STATUS.UEBERNOMMEN) throw fehler('Schon übernommen – nur noch lesen.');
  if (t(eintrag.Status) === E_STATUS.STORNIERT) throw fehler('Schon storniert.');
  if (terminVergangen(termin, jetzt)) throw fehler('Der Termin ist vorbei – nur noch lesen.');
  if (t(eingabe?.stand) !== t(eintrag.Stand)) throw fehler('Wurde inzwischen geändert – bitte neu laden.', 409, 'konflikt');
  return kuerzelAus(eingabe?.kuerzel);
}

/**
 * Aendern: Menge, Groesse (nur innerhalb derselben Karte), Texte. Vermerk "geändert von", Nach_Schluss bleibt bzw. wird ja.
 * @returns {object} neue Zeile
 */
export function aenderungPlan({ zugang, termin, eintrag, idx, eingabe, jetzt }) {
  const kuerzel = aenderbar({ zugang, termin, eintrag, eingabe, jetzt });
  const neu = { ...eintrag };
  const art = t(eintrag.Art);
  if (art === E_ART.ARTIKEL) {
    if (eingabe.id !== undefined) {
      const w = idx.je.get(t(eingabe.id));
      const alt = [...idx.je.entries()].find(([k]) => k === t(eintrag.WC_Variation_ID) || k === t(eintrag.LShop_ArticleNr))?.[1];
      if (!w || (alt && w.karte !== alt.karte)) throw fehler('Diese Größe ist für den Artikel nicht wählbar.');
      Object.assign(neu, { WC_Variation_ID: w.wcId, LShop_ArticleNr: w.articleNr, Groesse: w.groesse, Bezeichnung: w.bezeichnung });
    }
    if (eingabe.menge !== undefined) neu.Menge = menge(eingabe.menge);
  } else if (art === E_ART.EXTRA) {
    if (eingabe.freitext !== undefined) neu.Freitext = text(eingabe.freitext, MAX.freitext, 'Text', true);
    if (eingabe.fuer !== undefined) neu.Fuer = text(eingabe.fuer, MAX.fuer, '„für wen“');
    if (eingabe.menge !== undefined) neu.Menge = menge(eingabe.menge);
  } else if (art === E_ART.TRIKOT) {
    if (eingabe.groesse !== undefined) {
      const tr = idx.trikots.get(t(eintrag.Trikot_Produkt));
      const g = t(eingabe.groesse).toUpperCase();
      if (!tr || !tr.groessen.includes(g)) throw fehler('Trikot-Größe nicht wählbar.');
      neu.Groesse = g;
    }
    if (eingabe.name !== undefined) neu.Trikot_Name = text(eingabe.name, MAX.name, 'Rückenname');
    if (eingabe.nummer !== undefined) neu.Trikot_Nummer = nummer(eingabe.nummer);
    if (eingabe.wunsch !== undefined) neu.Wunsch = text(eingabe.wunsch, MAX.wunsch, 'Wunsch');
  }
  if (eingabe.notiz !== undefined) neu.Notiz = text(eingabe.notiz, MAX.positionNotiz, 'Notiz');   // KS2-1, alle Arten
  const stand = new Date(jetzt).toISOString();
  return { ...neu, Geaendert_Von: kuerzel, Stand: stand, Nach_Schluss: t(eintrag.Nach_Schluss) === 'ja' || nachSchluss(termin, zugang, jetzt) ? 'ja' : '' };
}

/** Stornieren: Status storniert (nie loeschen), Vermerk "geändert von". */
export function stornoPlan({ zugang, termin, eintrag, eingabe, jetzt }) {
  const kuerzel = aenderbar({ zugang, termin, eintrag, eingabe, jetzt });
  return { ...eintrag, Status: E_STATUS.STORNIERT, Geaendert_Von: kuerzel, Stand: new Date(jetzt).toISOString() };
}

/** Feste Auswahl fuer Seite und MC (keine IDs anderer Zugaenge, keine Preise). */
export function eintragFuerSeite(x) {
  return {
    id: t(x.Eintrag_ID), termin: t(x.Termin_ID), art: t(x.Art), bezeichnung: t(x.Bezeichnung), groesse: t(x.Groesse),
    menge: Number(t(x.Menge)) || 0, kuerzel: t(x.Kuerzel), zeit: t(x.Zeit), nachSchluss: t(x.Nach_Schluss) === 'ja',
    status: t(x.Status) || E_STATUS.EINGEGANGEN, freitext: t(x.Freitext), fuer: t(x.Fuer), trikotName: t(x.Trikot_Name),
    trikotNummer: t(x.Trikot_Nummer), wunsch: t(x.Wunsch), geaendertVon: t(x.Geaendert_Von), stand: t(x.Stand),
    auswahl: t(x.WC_Variation_ID) || t(x.LShop_ArticleNr), trikotProdukt: t(x.Trikot_Produkt), notiz: t(x.Notiz),
  };
}

/** Chat-Text nach dem Absenden - NUR Zugang, Anzahl, Termin-Datum. Nie Kürzel, Namen, Texte. */
export function absendenNachricht({ zugangId, anzahl, datum }) {
  const d = DATUM.test(t(datum)) ? `${datum.slice(8, 10)}.${datum.slice(5, 7)}.` : 'ohne Datum';
  return `🛍️ Bestellseite ${t(zugangId)}: ${Number(anzahl) || 0} neue Position${Number(anzahl) === 1 ? '' : 'en'} für Termin ${d}`;
}
