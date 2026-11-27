// Kundenanfragen (KA1): reine Logik fuer Lesen, Bearbeiten, Anlegen und die Verknuepfung mit einem Auftrag.
// Lesen/Schreiben in lib/anfragen.js. Reiter `Kundenanfragen` im Business-Sheet, Spalten nur ueber den Namen.
// Kundendaten nie in Fehlertexte (nur KA-/AU-Nummern und Feldnamen).
import { createHash } from 'crypto';
import { SESSION_LAENGEN, KANAL_VALUES, preisZelle } from './anfrage-felder.js';

export const TAB = 'Kundenanfragen';

/** Kopf wie scripts/setup-kundenanfragen.js (A-N), Pflicht. */
export const SPALTEN = [
  'Anfrage-ID', 'Datum', 'Kanal', 'Kunde-Name', 'Kunde-Email', 'Produkt-Beschreibung', 'Menge', 'Varianten',
  'Partner-ID', 'Preisvorschlag', 'Anmerkungen-Kunde', 'Status', 'Notiz-intern', 'WC-Order-ID',
];
/** KA1: hinten angehaengt (scripts/setup-kundenanfragen.js --spalten); fehlt sie, laeuft alles ausser der Verknuepfung. */
export const SPALTE_AUFTRAG = 'Auftrag_Nr';

// KA1 (Inhaber 27.11.): Neu -> Geprueft -> Angebot gesendet -> Bestaetigt -> Abgeschlossen, dazu Abgelehnt.
// Werte bleiben in der bisherigen Schreibweise (Bindestrich), "In-Produktion" gilt nur noch fuer Altdaten.
export const STATUS = ['Neu', 'Geprüft', 'Angebot-gesendet', 'Bestätigt', 'Abgeschlossen', 'Abgelehnt'];
export const STATUS_ALT = ['In-Produktion'];
export const STATUS_ZU = ['Abgeschlossen', 'Abgelehnt'];
export const STATUS_BESTAETIGT = 'Bestätigt';
export const istOffen = status => !STATUS_ZU.includes(String(status ?? '').trim());

/** API-Feld -> Spalte, mit Laengengrenze (wie der Kundenchat, Notiz intern 1000). */
export const FELDER = {
  status:              { spalte: 'Status' },
  notizIntern:         { spalte: 'Notiz-intern', max: 1000 },
  kundeName:           { spalte: 'Kunde-Name', max: SESSION_LAENGEN.kundeName, pflicht: true },
  kundeEmail:          { spalte: 'Kunde-Email', max: SESSION_LAENGEN.kundeEmail, pflicht: true },
  produktBeschreibung: { spalte: 'Produkt-Beschreibung', max: SESSION_LAENGEN.produktBeschreibung, pflicht: true },
  menge:               { spalte: 'Menge', max: SESSION_LAENGEN.menge },
  varianten:           { spalte: 'Varianten', max: SESSION_LAENGEN.varianten },
  partnerId:           { spalte: 'Partner-ID', max: SESSION_LAENGEN.partnerId },
  preisvorschlag:      { spalte: 'Preisvorschlag', max: SESSION_LAENGEN.preisvorschlag },
  anmerkungenKunde:    { spalte: 'Anmerkungen-Kunde', max: SESSION_LAENGEN.anmerkungenKunde },
};

export const KA_NR = /^KA-\d{4}-\d{4}$/;
export const AU_NR = /^AU-\d{4}-\d{4}$/;
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const t = v => String(v ?? '').trim();
export function fehler(text, status = 422, code = '') {
  const e = new Error(text);
  e.status = status;
  if (code) e.code = code;
  return e;
}

/** Spaltenindex je Name aus der Kopfzeile. */
export function spaltenIndex(kopf) {
  const idx = {};
  (kopf ?? []).forEach((k, i) => { const n = t(k); if (n && idx[n] === undefined) idx[n] = i; });
  return idx;
}

/** Fehlende Pflichtspalten (Namen). */
export const fehlendeSpalten = idx => SPALTEN.filter(s => idx[s] === undefined);

/** Stand einer Zeile = Pruefsumme des Inhalts (gesehen = jetzt, sonst 409). Keine eigene Spalte noetig. */
export function standVon(zeile, breite) {
  const werte = Array.from({ length: breite }, (_, i) => t(zeile?.[i]));
  return createHash('sha256').update(JSON.stringify(werte)).digest('hex').slice(0, 16);
}

/**
 * Reiter -> Anfragen. Notizzeile ("// …") und leere Zeilen fallen weg; `zeile` = Sheet-Zeile (1-basiert).
 * @returns {{ idx, kopf, breite, anfragen: object[] }}
 */
export function anfragenAus(werte) {
  const [kopf = [], ...rest] = werte ?? [];
  const idx = spaltenIndex(kopf);
  const breite = Math.max(kopf.length, ...rest.map(r => (r ?? []).length), 0);
  const w = (r, s) => (idx[s] === undefined ? '' : r?.[idx[s]] ?? '');
  const anfragen = [];
  rest.forEach((r, i) => {
    if (!(r ?? []).some(c => t(c))) return;
    if (t(r[0]).startsWith('//')) return;
    anfragen.push({
      anfrageId:           t(w(r, 'Anfrage-ID')),
      datum:               t(w(r, 'Datum')),
      kanal:               t(w(r, 'Kanal')),
      kundeName:           t(w(r, 'Kunde-Name')),
      kundeEmail:          t(w(r, 'Kunde-Email')),
      produktBeschreibung: t(w(r, 'Produkt-Beschreibung')),
      menge:               t(w(r, 'Menge')),
      varianten:           t(w(r, 'Varianten')),
      partnerId:           t(w(r, 'Partner-ID')),
      preisvorschlag:      t(w(r, 'Preisvorschlag')),
      anmerkungenKunde:    t(w(r, 'Anmerkungen-Kunde')),
      status:              t(w(r, 'Status')),
      notizIntern:         t(w(r, 'Notiz-intern')),
      wcOrderId:           t(w(r, 'WC-Order-ID')),
      auftragNr:           t(w(r, SPALTE_AUFTRAG)),
      zeile:               i + 2,
      stand:               standVon(r, breite),
    });
  });
  return { idx, kopf, breite, anfragen };
}

/** Naechste KA-Nummer des Jahres (hoechste + 1). */
export function naechsteAnfrageId(ids, jahr) {
  const p = `KA-${jahr}-`;
  const max = (ids ?? []).filter(id => String(id).startsWith(p))
    .map(id => parseInt(String(id).slice(p.length), 10)).filter(Number.isFinite)
    .reduce((a, n) => Math.max(a, n), 0);
  return `${p}${String(max + 1).padStart(4, '0')}`;
}

const einzeilig = (v, max) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

/** Ein Feldwert geprueft; Fehlertexte nennen nur das Feld. */
export function feldWert(feld, roh, { altStatus = '' } = {}) {
  const f = FELDER[feld];
  if (!f) throw fehler(`Feld ${feld} ist nicht änderbar.`);
  if (feld === 'status') {
    const s = t(roh);
    if (!STATUS.includes(s) && !(s === altStatus && STATUS_ALT.includes(s))) throw fehler(`Status muss ${STATUS.join(', ')} sein.`);
    return s;
  }
  if (feld === 'notizIntern') {
    const s = String(roh ?? '').replace(/\r\n?/g, '\n').trim();
    if (s.length > f.max) throw fehler(`Notiz intern: höchstens ${f.max} Zeichen.`);
    return s;
  }
  const s = einzeilig(roh, 10_000);
  if (s.length > f.max) throw fehler(`${f.spalte}: höchstens ${f.max} Zeichen.`);
  if (f.pflicht && !s) throw fehler(`${f.spalte} darf nicht leer sein.`);
  if (feld === 'kundeEmail' && !MAIL.test(s)) throw fehler('Kunde-Email: keine gültige E-Mail-Adresse.');
  if (feld === 'partnerId' && /[^A-Za-z0-9-]/.test(s)) throw fehler('Partner-ID: nur Buchstaben, Ziffern und Bindestrich.');
  if (feld === 'preisvorschlag') {
    if (s && !/^\d{1,7}([.,]\d{1,2})?$/.test(s)) throw fehler('Preisvorschlag als Zahl (z. B. 580 oder 580,50).');
    return s ? preisZelle(s) : '';
  }
  return s;
}

const gleich = (a, b) => t(a) === t(b);

/**
 * Bearbeiten: { anfrage (aus anfragenAus), felder: { api-feld: wert } } -> { aenderung: { Spalte: wert } } (nur Geaendertes).
 * Status frei waehlbar (der Inhaber korrigiert auch zurueck); "abschliessen"/"ablehnen" = Status, nie loeschen.
 */
export function bearbeitenPlan({ anfrage, felder }) {
  if (!felder || typeof felder !== 'object' || Array.isArray(felder)) throw fehler('Keine Felder.');
  const aenderung = {};
  for (const [feld, roh] of Object.entries(felder)) {
    if (roh === undefined) continue;
    const wert = feldWert(feld, roh, { altStatus: anfrage.status });
    const spalte = FELDER[feld].spalte;
    if (!gleich(wert, anfrage[feld])) aenderung[spalte] = wert;
  }
  return { aenderung };
}

/**
 * Neue Zeile (Kundenchat oder von Hand). `eingabe` mit den API-Feldern; Kanal aus der Liste. `locker` = Kundenchat.
 * @returns {object} { Spalte: wert } fuer alle SPALTEN
 */
export function neueAnfrage({ eingabe, anfrageId, datum, kanalErsatz = 'Manuell', locker = false }) {
  const e = eingabe ?? {};
  const kanal = t(e.kanal) || kanalErsatz;
  if (!KANAL_VALUES.includes(kanal)) throw fehler(`Ungültiger Kanal. Erlaubt: ${KANAL_VALUES.join(', ')}`, 400);
  const z = Object.fromEntries(SPALTEN.map(s => [s, '']));
  for (const feld of ['kundeName', 'kundeEmail', 'produktBeschreibung', 'menge', 'varianten', 'partnerId', 'preisvorschlag', 'anmerkungenKunde', 'notizIntern']) {
    if (e[feld] === undefined || e[feld] === null || e[feld] === '') continue;
    try { z[FELDER[feld].spalte] = feldWert(feld, e[feld]); } catch (err) {
      // Kundenchat (locker): eine Anfrage geht nie verloren - Form-Fehler (z. B. ungewoehnliche Mail) bleiben als Text stehen,
      // gekappt wie bisher; MC kann sie im Dialog korrigieren.
      if (!locker) throw err;
      const w = einzeilig(e[feld], FELDER[feld].max);
      z[FELDER[feld].spalte] = feld === 'preisvorschlag' ? preisZelle(w.replace(/[^0-9.,]/g, '')) : feld === 'partnerId' ? w.replace(/[^A-Za-z0-9-]/g, '') : w;
    }
  }
  for (const feld of locker ? ['kundeName', 'kundeEmail'] : ['kundeName', 'kundeEmail', 'produktBeschreibung'])   // Chat: wie bisher Name + Mail
    if (!t(z[FELDER[feld].spalte])) throw fehler('kundeName, kundeEmail und produktBeschreibung sind erforderlich.', 400);
  Object.assign(z, {
    'Anfrage-ID': anfrageId, Datum: t(e.datum) || datum, Kanal: kanal, Status: 'Neu',
    'WC-Order-ID': einzeilig(e.wcOrderId, 30),
  });
  return z;
}

/** Objekt { Spalte: wert } -> Zeile in Reiterbreite (fehlende Spalten bleiben leer). */
export function alsZeile(idx, obj, breite) {
  const z = Array.from({ length: breite }, () => '');
  for (const [s, w] of Object.entries(obj)) if (idx[s] !== undefined) z[idx[s]] = w;
  return z;
}

/**
 * Verknuepfung mit einem Auftrag (KA1 Teil 3): Status "Bestaetigt" + Auftrag_Nr. Schon mit einer ANDEREN AU-Nr.
 * verknuepft -> 409 (nie ueberschreiben); gleiche AU-Nr. = nichts zu tun.
 */
export function verknuepfenPlan({ anfrage, auftragNr }) {
  if (!AU_NR.test(t(auftragNr))) throw fehler('Auftragsnummer ungültig.');
  if (anfrage.auftragNr && anfrage.auftragNr !== auftragNr)
    throw fehler(`${anfrage.anfrageId} ist schon mit ${anfrage.auftragNr} verknüpft.`, 409, 'schon_verknuepft');
  const aenderung = {};
  if (anfrage.auftragNr !== auftragNr) aenderung[SPALTE_AUFTRAG] = auftragNr;
  if (anfrage.status !== STATUS_BESTAETIGT && anfrage.status !== 'Abgeschlossen') aenderung.Status = STATUS_BESTAETIGT;   // auch aus "Abgelehnt" (doch ein Auftrag)
  return { aenderung };
}
