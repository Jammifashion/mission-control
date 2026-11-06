// Interne Trikotbestellung in MC (TR6), reine Logik ohne Netz. Lesen/Schreiben in lib/trikotIntern.js.
//
// Handzeilen wie TK1 (CLAUDE.md): Zeilen-ID INT-JJJJ-NNNN (vergibt MC: hoechste des Jahres + 1, auch gegen von Hand
// eingetragene), Quelle "intern", Order-ID/Order-Item-ID/Kunde leer, Bestelldatum Text JJJJ-MM-TT, Stueck 1, P-T leer
// (Charge/Bestellt_Am setzt wie bisher TR3), Zahlart leer. Referenz (AU-... oder Freitext ohne Personennamen) und Notiz
// stehen im Rohtext, dazu eine Zeile "MC-Vorgang: ..." gegen Doppelklick (die Ansicht blendet sie aus).
// Entfernen = Status "storniert" (nie Zeile loeschen); Ansicht, Formular (TR3) und Wareneingang (TR4) lassen sie aus.
// Nie Rueckennamen oder Referenzen ins Log - nur Zeilen-IDs.

import { requireHeader } from './sheet-headers.js';
import { TRIKOT_HEADER, SPALTE_GOALIE, goalieWert, goalieStatus, GOALIE_JA, GOALIE_NEIN } from './trikot-logic.js';

export const STATUS_STORNIERT = 'storniert';
export const QUELLE_INTERN = 'intern';
export const INT_MUSTER = /^INT-(\d{4})-(\d{4})$/;
export const VORGANG_ZEILE = 'MC-Vorgang:';
// Groessen zur Auswahl: Kinder in cm (wie im Reiter), dann Erwachsene; dazu, was im Reiter schon vorkommt.
export const GROESSEN_KINDER = ['90', '100', '110', '120', '130', '140', '150'];
export const GROESSEN_ERWACHSENE = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];
export const MAX = { name: 30, nummer: 3, notiz: 200, referenz: 80, trikots: 60 };
// TR7: nach der Produzenten-Bestellung (Charge gesetzt) nur noch ueber eine Ersatzzeile (TR3b, nicht gebaut).
export const GESPERRT_CHARGE = 'Schon beim Hersteller – Änderung nur über Ersatz (TR3b).';
const EINRICHTUNG_GOALIE = 'Spalte „Goalie“ fehlt im Reiter Trikots – erst einrichten (scripts/setup-trikot-goalie.js).';

const t = v => String(v ?? '').trim();
const fehler = (msg, status = 422, extra = {}) => Object.assign(new Error(msg), { status, ...extra });

/** Naechste INT-Nummern des Jahres: hoechste vorhandene + 1, + 2, ... (Nummern anderer Jahre zaehlen nicht). */
export function naechsteIntNummern(ids, jahr, anzahl = 1) {
  const max = (ids ?? []).reduce((m, id) => {
    const x = INT_MUSTER.exec(t(id));
    return x && x[1] === String(jahr) ? Math.max(m, Number(x[2])) : m;
  }, 0);
  return Array.from({ length: anzahl }, (_, i) => `INT-${jahr}-${String(max + 1 + i).padStart(4, '0')}`);
}

/** Rohtext einer internen Zeile: Referenz, Notiz, Vorgang (je eine Zeile, leere fallen weg). */
export const rohtextIntern = ({ referenz, notiz, vorgang }) =>
  [referenz && `Referenz: ${referenz}`, notiz && `Notiz: ${notiz}`, vorgang && `${VORGANG_ZEILE} ${vorgang}`].filter(Boolean).join('\n');
/** Rohtext -> { referenz, notiz, vorgang } (fuer Bearbeiten und die Ansicht). */
export function rohtextLesen(rohtext) {
  const aus = { referenz: '', notiz: '', vorgang: '' };
  for (const l of t(rohtext).split('\n')) {
    if (l.startsWith('Referenz:')) aus.referenz = l.slice(9).trim();
    else if (l.startsWith('Notiz:')) aus.notiz = l.slice(6).trim();
    else if (l.startsWith(VORGANG_ZEILE)) aus.vorgang = l.slice(VORGANG_ZEILE.length).trim();
  }
  return aus;
}

/**
 * Eingabe pruefen. trikot: { produktId, groesse, name, nummer, notiz }; produkte: Map produktId -> { name, sku }.
 * Name/Nummer duerfen leer sein (Ansicht zeigt dann den gelben Hinweis), Groesse und Trikot sind Pflicht.
 */
export function pruefeTrikot(tr, produkte, nr = 1, { ohneProdukt = false } = {}) {
  const p = ohneProdukt ? null : produkte.get(t(tr?.produktId));
  if (!p && !ohneProdukt) throw fehler(`Trikot ${nr}: bitte Heim oder Auswärts wählen.`);
  const groesse = t(tr?.groesse).toUpperCase();
  if (!groesse) throw fehler(`Trikot ${nr}: Größe fehlt.`);
  if (!/^[0-9A-Z/ ]{1,12}$/.test(groesse)) throw fehler(`Trikot ${nr}: Größe ungültig.`);
  const name = t(tr?.name).replace(/\s+/g, ' ');
  if (name.length > MAX.name) throw fehler(`Trikot ${nr}: Name höchstens ${MAX.name} Zeichen.`);
  const nummer = t(tr?.nummer);
  if (nummer && !new RegExp(`^\\d{1,${MAX.nummer}}$`).test(nummer)) throw fehler(`Trikot ${nr}: Nummer nur Ziffern (höchstens ${MAX.nummer}).`);
  const notiz = t(tr?.notiz).replace(/\s+/g, ' ');
  if (notiz.length > MAX.notiz) throw fehler(`Trikot ${nr}: Notiz höchstens ${MAX.notiz} Zeichen.`);
  return { produkt: p, groesse, name, nummer, notiz, goalie: goalieWert(tr?.goalie) };
}
export function pruefeReferenz(referenz) {
  const r = t(referenz).replace(/\s+/g, ' ');
  if (r.length > MAX.referenz) throw fehler(`Referenz höchstens ${MAX.referenz} Zeichen.`);
  return r;
}

/**
 * Neue Zeilen fuer den Reiter (Werte in Spaltenfolge der Kopfzeile, Breite = Kopfzeile).
 * @returns {{ ids: string[], zeilen: Array<Array<string|number>> }}
 */
export function anlagePlan({ werte, trikots, referenz, vorgang, produkte, heute, erfasstAm }) {
  const [kopf = [], ...rows] = werte ?? [];
  const ctx = 'Reiter Trikots';
  for (const s of TRIKOT_HEADER) requireHeader(kopf, s, ctx);
  if (!Array.isArray(trikots) || !trikots.length) throw fehler('Mindestens ein Trikot.');
  if (trikots.length > MAX.trikots) throw fehler(`Höchstens ${MAX.trikots} Trikots auf einmal.`);
  const ref = pruefeReferenz(referenz);
  const geprueft = trikots.map((tr, i) => pruefeTrikot(tr, produkte, i + 1));
  const iId = kopf.indexOf('Zeilen-ID');
  const iGoalie = kopf.indexOf(SPALTE_GOALIE);   // TR7
  if (iGoalie < 0 && geprueft.some(g => g.goalie)) throw fehler(EINRICHTUNG_GOALIE, 409, { code: 'einrichtung' });
  const ids = naechsteIntNummern(rows.map(r => r[iId]), heute.slice(0, 4), geprueft.length);
  const zeilen = geprueft.map((g, i) => {
    const z = Array.from({ length: kopf.length }, () => '');
    const setze = (s, w) => { z[kopf.indexOf(s)] = w; };
    setze('Zeilen-ID', ids[i]); setze('Erfasst_Am', erfasstAm); setze('Bestelldatum', heute);
    setze('Artikelnummer', g.produkt.sku); setze('Produktname', g.produkt.name); setze('Groesse', g.groesse);
    setze('Name', g.name); setze('Nummer', g.nummer); setze('Stueck', 1); setze('Quelle', QUELLE_INTERN);
    setze('Rohtext', rohtextIntern({ referenz: ref, notiz: g.notiz, vorgang: `${vorgang}-${i + 1}` }));
    if (iGoalie >= 0) z[iGoalie] = g.goalie;
    return z;
  });
  return { ids, zeilen };
}

/** Schon angelegt (gleicher Vorgang, Doppelklick)? -> Zeilen-IDs, sonst []. */
export function schonAngelegt(werte, vorgang) {
  const [kopf = [], ...rows] = werte ?? [];
  const iR = kopf.indexOf('Rohtext'), iId = kopf.indexOf('Zeilen-ID');
  if (iR < 0 || !vorgang) return [];
  return rows.filter(r => new RegExp(`^${VORGANG_ZEILE} ${vorgang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`, 'm').test(t(r[iR]))).map(r => t(r[iId]));
}

/** TR7: Darf diese Zeile (Shop- ODER Handzeile) geaendert werden? Keine Charge, nicht storniert. '' = ja. */
export function aenderbar(z) {
  if (t(z.status).toLowerCase() === STATUS_STORNIERT) return 'Schon entfernt.';
  if (t(z.charge)) return GESPERRT_CHARGE;
  return '';
}
export const istIntern = z => INT_MUSTER.test(t(z.id)) && t(z.quelle) === QUELLE_INTERN;

/** Darf diese Zeile in MC entfernt werden (TR6)? INT-Zeile, Quelle intern, keine Charge, nicht storniert. */
export function bearbeitbar(z) {
  if (!INT_MUSTER.test(t(z.id))) return 'Nur interne Bestellungen (INT-…) lassen sich hier ändern.';
  if (t(z.quelle) !== QUELLE_INTERN) return 'Nur Zeilen mit Quelle „intern“ lassen sich hier ändern.';
  if (t(z.charge)) return `Schon beim Produzenten (Bestellung ${t(z.charge)}) – nicht mehr änderbar.`;
  if (t(z.status).toLowerCase() === STATUS_STORNIERT) return 'Schon entfernt.';
  return '';
}

/** TR7: Stand einer Zeile, wie der Browser ihn sieht und mitschickt (vorher). Notiz: intern im Rohtext, sonst Spalte Notiz. */
export function zeilenStand(kopf, r) {
  const w = s => t(r?.[kopf.indexOf(s)]);
  const intern = istIntern({ id: w('Zeilen-ID'), quelle: w('Quelle') });
  const iGoalie = kopf.indexOf(SPALTE_GOALIE);
  return {
    intern, produkt: w('Produktname'), groesse: w('Groesse'), name: w('Name'), nummer: w('Nummer'),
    notiz: intern ? rohtextLesen(w('Rohtext')).notiz : w('Notiz'), goalie: iGoalie >= 0 ? goalieStatus(r?.[iGoalie]) : '',   // TR8: auch "nein"
  };
}
const VORHER_FELDER = ['groesse', 'name', 'nummer', 'notiz', 'goalie'];
const FELD_TEXT = { produkt: 'Trikot', groesse: 'Größe', name: 'Name', nummer: 'Nummer', notiz: 'Notiz', goalie: 'Goalie' };
/** Gesehener Stand (vorher) gegen den frisch gelesenen (ist), je Zelle; weicht etwas ab: 409 geaendert, nichts geschrieben. */
function pruefeVorher(ist, vorher) {
  if (!vorher || typeof vorher !== 'object' || VORHER_FELDER.some(f => !(f in vorher))) throw fehler('Vorher-Stand fehlt – bitte neu laden.', 422);
  const vergleich = { groesse: v => t(v).toUpperCase(), goalie: goalieStatus };
  const felder = [...VORHER_FELDER, ...(ist.intern && 'produkt' in vorher ? ['produkt'] : [])];
  const abweichend = felder.filter(f => (vergleich[f] ?? t)(vorher[f]) !== (vergleich[f] ?? t)(ist[f]));
  if (abweichend.length) {
    throw fehler(`Inzwischen geändert (${abweichend.map(f => FELD_TEXT[f]).join(', ')}) – nichts gespeichert, bitte neu laden.`, 409, { code: 'geaendert', felder: abweichend });
  }
}

/**
 * Plan Bearbeiten/Entfernen fuer EINE Zeile. werte = frisch gelesen (Kopfzeile zuerst); ziel = { id, zeile }.
 * aktion 'aendern' (trikot, vorher): TR7 Shop- und Handzeilen ohne Charge, nicht storniert. vorher = der Stand, den der
 *   Browser gesehen hat (groesse, name, nummer, notiz, goalie; bei INT auch produkt) - weicht eine Zelle ab, wird nichts
 *   geschrieben (409 geaendert). Shop-Zeile: Groesse/Name/Nummer/Notiz(Spalte)/Goalie; INT-Zeile zusaetzlich das Trikot
 *   (Produktname/Artikelnummer), Notiz im Rohtext (TR6). 'entfernen' -> Status storniert (nur INT, TR6).
 * @returns {{ zellen: Array<{spalte, wert}>, zeile, unveraendert }}
 */
export function aenderungPlan({ werte, ziel, aktion, trikot, vorher, produkte, wert }) {
  const [kopf = [], ...rows] = werte ?? [];
  const zeile = Number(ziel?.zeile);
  const r = rows[zeile - 2];
  const w = s => t(r?.[kopf.indexOf(s)]);
  if (!r || w('Zeilen-ID') !== t(ziel?.id)) throw fehler('Die Zeile hat sich geändert – bitte neu laden.', 409, { code: 'konflikt' });
  const soll = {};
  if (aktion === 'entfernen') {
    const grund = bearbeitbar({ id: w('Zeilen-ID'), quelle: w('Quelle'), charge: w('Charge'), status: w('Status') });
    if (grund) throw fehler(grund, 409, { code: 'gesperrt' });
    soll.Status = STATUS_STORNIERT;
  } else if (aktion === 'aendern') {
    const grund = aenderbar({ charge: w('Charge'), status: w('Status') });
    if (grund) throw fehler(grund, 409, { code: 'gesperrt' });
    const ist = zeilenStand(kopf, r);
    pruefeVorher(ist, vorher);
    const g = pruefeTrikot(trikot, produkte, 1, { ohneProdukt: !ist.intern });
    const iGoalie = kopf.indexOf(SPALTE_GOALIE);
    if (iGoalie < 0 && g.goalie) throw fehler(EINRICHTUNG_GOALIE, 409, { code: 'einrichtung' });
    Object.assign(soll, { Groesse: g.groesse, Name: g.name, Nummer: g.nummer });
    if (ist.intern) {
      const alt = rohtextLesen(w('Rohtext'));
      Object.assign(soll, { Produktname: g.produkt.name, Artikelnummer: g.produkt.sku, Rohtext: rohtextIntern({ referenz: alt.referenz, notiz: g.notiz, vorgang: alt.vorgang }) });
    } else {
      soll.Notiz = g.notiz;
    }
    // TR8: ein quittiertes "nein" bleibt, wenn Goalie nicht angehakt ist.
    if (iGoalie >= 0) soll[SPALTE_GOALIE] = g.goalie || (ist.goalie === GOALIE_NEIN ? GOALIE_NEIN : '');
  } else if (aktion === 'goalie') {
    // TR8: Ein-Klick am Hinweis - "ja" (als Goalie markieren) bzw. "nein" (kein Goalie, quittiert); gleiche Sperre und
    // Vorher-Pruefung wie "ändern …", geschrieben wird nur die Zelle Goalie.
    const grund = aenderbar({ charge: w('Charge'), status: w('Status') });
    if (grund) throw fehler(grund, 409, { code: 'gesperrt' });
    if (![GOALIE_JA, GOALIE_NEIN].includes(t(wert))) throw fehler('Wert nur „ja“ oder „nein“.', 400);
    const iGoalie = kopf.indexOf(SPALTE_GOALIE);
    if (iGoalie < 0) throw fehler(EINRICHTUNG_GOALIE, 409, { code: 'einrichtung' });
    pruefeVorher(zeilenStand(kopf, r), vorher);
    soll[SPALTE_GOALIE] = t(wert);
  } else throw fehler('Unbekannte Aktion.', 400);
  const zellen = Object.entries(soll).filter(([s, v]) => w(s) !== t(v)).map(([s, v]) => ({ spalte: kopf.indexOf(s), wert: v }));
  return { zellen, zeile, unveraendert: !zellen.length };
}
