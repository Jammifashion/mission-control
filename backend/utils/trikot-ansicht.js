// Trikot-Ansicht (TR2) - reine Logik fuer GET /api/bestellen/trikots. NUR LESEN.
//
// Reiter "Trikots" (Business-Sheet), Spalten nur ueber den Namen. Die Spalte "Kunde" wird nie
// gelesen. Gruppen: oben "noch nicht beim Produzenten" (Charge leer), dann die Chargen absteigend.
//
// Zaehlregel (Inhaber 30.10.): Status "ok" = geliefert. Status "ersetzt" (Aenderung nach der
// Produzenten-Bestellung) zaehlt beim Produzenten als da - das Trikot kam -, beim Kunden als nicht
// fertig; fertig ist er, wenn die Ersatzzeile (Spalte "Ersetzt" = Zeilen-ID des Originals) "ok" hat.
// Geliefert_Am ist nur eine Zusatzangabe. Fehlt die Spalte "Ersetzt", gibt es keine Verbindungen.
//
// Kundenangabe: die Zeilen aus "Rohtext" (Bestellfelder + Kundennotiz, so wie der Sync sie schreibt).
// Sie wird nur angezeigt, nie nach Name/Nummer uebernommen.

import { requireHeader, findHeader } from './sheet-headers.js';

export const TAB_TRIKOTS = 'Trikots';
export const LIEFER_TAGE = 30;
export const STATUS_GELIEFERT = 'ok';
export const STATUS_ERSETZT = 'ersetzt';

export const TRIKOT_ANSICHT_SPALTEN = {
  id: 'Zeilen-ID', orderId: 'Order-ID', produkt: 'Produktname', groesse: 'Groesse', name: 'Name',
  nummer: 'Nummer', quelle: 'Quelle', rohtext: 'Rohtext', charge: 'Charge', bestelltAm: 'Bestellt_Am',
  geliefertAm: 'Geliefert_Am', status: 'Status', notiz: 'Notiz',
};
export const TRIKOT_ANSICHT_OPTIONAL = { ersetzt: 'Ersetzt' };

// Gelbe Hinweise je Zeile bzw. Gruppe - nur anzeigen.
export const HINWEISE = {
  name_leer:          'Name nicht übernommen',
  nummer_leer:        'Nummer nicht übernommen',
  ersetzt_unbekannt:  '„Ersetzt“ zeigt auf eine Zeile, die es nicht gibt',
  ersatz_fehlt:       'ersetzt, aber keine Ersatzzeile',
  ohne_bestellt_am:   'Bestellt_Am fehlt',
  id_doppelt:         'Zeilen-ID doppelt',
};

const t = v => String(v ?? '').trim();

export function produktKurz(name) {
  const n = t(name).toLowerCase();
  if (/auswärts|auswaerts/.test(n)) return 'Auswärts';
  if (/heim/.test(n)) return 'Heim';
  return t(name);
}

/** Rohtext -> [{ feld, wert }]; "(keine Meta-Daten …)" und leere Zeilen fallen weg. */
export function kundenangabe(rohtext) {
  return t(rohtext).split('\n').map(l => l.trim()).filter(l => l && !/^\(keine Meta-Daten/.test(l)).map(l => {
    const p = l.indexOf(':');
    return p > 0 ? { feld: l.slice(0, p).trim(), wert: l.slice(p + 1).trim() } : { feld: '', wert: l };
  });
}

/** "TT.MM.JJJJ" oder "JJJJ-MM-TT…" -> Date (UTC-Mitternacht) oder null. */
export function leseTag(s) {
  const v = t(s);
  let m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return null;
}
const tagText = d => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
/** Voraussichtliche Lieferung = Bestellt_Am + 30 Tage (wie D2 im Formular des Produzenten), sonst ''. */
export function lieferTag(bestelltAm) {
  const d = leseTag(bestelltAm);
  return d ? tagText(new Date(d.getTime() + LIEFER_TAGE * 86400000)) : '';
}

/** Werte des Reiters (FORMATTED_VALUE, Kopfzeile zuerst) -> Zeilen. Ganz leere Zeilen fallen weg. */
export function trikotZeilen(values) {
  const [kopf = [], ...rows] = values ?? [];
  const ctx = `Reiter ${TAB_TRIKOTS}`;
  const idx = Object.fromEntries(Object.entries(TRIKOT_ANSICHT_SPALTEN).map(([f, n]) => [f, requireHeader(kopf, n, ctx)]));
  const iErsetzt = findHeader(kopf, TRIKOT_ANSICHT_OPTIONAL.ersetzt);
  const zeilen = [];
  rows.forEach((r, i) => {
    const w = f => t(r[idx[f]]);
    if (!(r ?? []).some(c => t(c))) return;
    zeilen.push({
      zeile: i + 2, id: w('id'), orderId: w('orderId'), produkt: w('produkt'), produktKurz: produktKurz(w('produkt')),
      groesse: w('groesse'), name: w('name'), nummer: w('nummer'), quelle: w('quelle'), kundenangabe: kundenangabe(w('rohtext')),
      charge: w('charge'), bestelltAm: w('bestelltAm'), geliefertAm: w('geliefertAm'), status: w('status'), notiz: w('notiz'),
      ersetzt: iErsetzt >= 0 ? t(r[iErsetzt]) : '',
    });
  });
  return { zeilen, spalteErsetzt: iErsetzt >= 0 };
}

const chargeSort = (a, b) => {
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na;
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  return b.localeCompare(a, 'de', { numeric: true });
};

/** Zeilen -> Ansicht { gruppen, summen, spalteErsetzt }. */
export function baueTrikotAnsicht({ zeilen, spalteErsetzt }) {
  const z = zeilen.map(x => ({ ...x, ersetztDurch: [], ersatzFuer: null, hinweise: [] }));
  const nachId = new Map(z.filter(x => x.id).map(x => [x.id, x]));
  const jeId = new Map();
  for (const x of z) if (x.id) jeId.set(x.id, (jeId.get(x.id) ?? 0) + 1);
  for (const x of z) if (jeId.get(x.id) > 1) x.hinweise.push('id_doppelt');
  for (const x of z) {
    if (!x.ersetzt) continue;
    const orig = jeId.get(x.ersetzt) > 1 ? null : nachId.get(x.ersetzt);   // doppelte ID: nie raten
    if (!orig || orig === x) { x.hinweise.push('ersetzt_unbekannt'); continue; }
    orig.ersetztDurch.push({ id: x.id, charge: x.charge, status: x.status });
    x.ersatzFuer = { id: orig.id, charge: orig.charge, zeile: orig.zeile };
  }
  for (const x of z) {
    const st = x.status.toLowerCase();
    x.geliefert = st === STATUS_GELIEFERT;
    x.ersetztStatus = st === STATUS_ERSETZT;
    x.da = x.geliefert || x.ersetztStatus;   // beim Produzenten
    x.kundeFertig = x.geliefert || (x.ersetztStatus && x.ersetztDurch.some(e => e.status.toLowerCase() === STATUS_GELIEFERT));
    if (!x.name) x.hinweise.push('name_leer');
    if (!x.nummer) x.hinweise.push('nummer_leer');
    if (x.ersetztStatus && spalteErsetzt && !x.ersetztDurch.length) x.hinweise.push('ersatz_fehlt');
  }
  // TR4 Wareneingang: Haken nur mit Charge; setzen bei leerem Status UND leerem Geliefert_Am, zurueck nur bei
  // "ok" MIT Geliefert_Am (Stand eines MC-Hakens); "ersetzt", andere Werte und "ok" ohne Datum (von Hand) nie.
  for (const x of z) {
    const st = x.status.toLowerCase();
    x.abhaken = !x.charge ? '' : (!x.status && !x.geliefertAm) ? 'setzen' : (st === STATUS_GELIEFERT && x.geliefertAm) ? 'zurueck' : '';
  }
  // TR4: "Bestellung komplett" = alle Trikots derselben Order-ID sind beim Kunden fertig (ersetzt -> Ersatzzeile).
  const jeOrder = new Map();
  for (const x of z) if (x.orderId) jeOrder.set(x.orderId, [...(jeOrder.get(x.orderId) ?? []), x]);
  for (const x of z) {
    const teile = x.orderId ? jeOrder.get(x.orderId) : [x];
    // Ersatzzeile zaehlt ueber ihr Original (kundeFertig), nicht doppelt.
    const zaehlen = teile.filter(t => !t.ersatzFuer);
    x.bestellung = { trikots: zaehlen.length, fertig: zaehlen.filter(t => t.kundeFertig).length };
    x.bestellungKomplett = !!x.orderId && zaehlen.length > 0 && zaehlen.every(t => t.kundeFertig);
  }

  const offen = z.filter(x => !x.charge);
  const jeCharge = new Map();
  for (const x of z.filter(x => x.charge)) {
    if (!jeCharge.has(x.charge)) jeCharge.set(x.charge, []);
    jeCharge.get(x.charge).push(x);
  }
  const gruppen = [{ charge: '', offen: true, anzahl: offen.length, da: 0, bestelltAm: [], lieferung: '', hinweise: [], zeilen: offen }];
  for (const charge of [...jeCharge.keys()].sort(chargeSort)) {
    const zs = jeCharge.get(charge);
    const bestelltAm = [...new Set(zs.map(x => x.bestelltAm).filter(Boolean))]
      .sort((a, b) => (leseTag(a)?.getTime() ?? 0) - (leseTag(b)?.getTime() ?? 0));
    gruppen.push({
      charge, offen: false, anzahl: zs.length, da: zs.filter(x => x.da).length, bestelltAm,
      lieferung: bestelltAm.length ? lieferTag(bestelltAm[0]) : '',
      hinweise: zs.some(x => !x.bestelltAm) ? ['ohne_bestellt_am'] : [],
      zeilen: zs,
    });
  }
  return {
    spalteErsetzt,
    gruppen,
    summen: {
      zeilen: z.length, offen: offen.length, chargen: jeCharge.size,
      da: z.filter(x => x.da).length, hinweise: z.filter(x => x.hinweise.length).length,
    },
  };
}
