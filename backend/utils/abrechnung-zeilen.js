// B17: Welche Sheet-Zeilen gehoeren zu einer Lizenz-Abrechnung?
//
// Frueher speicherte der Entwurf die Sheet-Zeilennummer (rowIndex) jeder
// Position, und die Freigabe schrieb "abgerechnet" blind in genau diese
// Nummern. Wird zwischen Entwurf und Freigabe eine Zeile eingefuegt oder
// geloescht (Sync, Storno, Handkorrektur), verschieben sich alle Nummern
// darunter: markiert werden fremde Zeilen, die eigenen bleiben offen und
// landen in der naechsten Abrechnung ein zweites Mal.
//
// Jetzt wird zur Freigabe frisch gelesen und ueber den Inhalt zugeordnet:
// Partner + Zeitraum + Status grenzen die Kandidaten ein, der Schluessel jeder
// Position (Order/Artikel/Variante/Storno bzw. Datum/Bezeichnung/Anzahl/Summe)
// waehlt daraus genau die Zeilen des Entwurfs. Die Zeilennummer kommt aus dem
// frischen Read (_sheetRow), nie aus dem gespeicherten JSON.

import { findHeader, requireHeader } from './sheet-headers.js';

// DD.MM.YYYY, auch einstellig (Sheets formatiert USER_ENTERED-Daten je nach
// Gebietsschema als 1.6.2026) oder ISO.
export function parseDatum(s) {
  const str = String(s ?? '').trim();
  const m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(`${str.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function zeitraeumeUeberlappen(von1, bis1, von2, bis2) {
  return !!(von1 && bis1 && von2 && bis2) && von1 <= bis2 && von2 <= bis1;
}

const text   = v => String(v ?? '').trim();
const varKey = v => (text(v) === '' ? '0' : text(v));
const betrag = v => {
  const n = parseFloat(text(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export function verkaufSchluessel({ orderId, artikelname, variationId, storno }) {
  return [text(orderId), text(artikelname), varKey(variationId), storno ? 'S' : 'V'].join('|');
}

export function internSchluessel({ datum, bezeichnung, anzahl, summe }) {
  return [text(datum), text(bezeichnung), betrag(anzahl), betrag(summe)].join('|');
}

// Spaltenindizes der Verkaeufe. Storno-Status ist optional (aeltere Reiter):
// ohne die Spalte gilt eine negative Stueckzahl als Gegenbuchung.
export function verkaufsSpalten(header) {
  const K = 'Verkaeufe';
  return {
    partner: requireHeader(header, 'Partner-ID',    K),
    datum:   requireHeader(header, 'Datum',         K),
    order:   requireHeader(header, 'Order-ID',      K),
    artikel: requireHeader(header, 'Artikelnummer', K),
    variante: requireHeader(header, 'Variante',     K),
    stueck:  requireHeader(header, 'Stückzahl',     K),
    status:  requireHeader(header, 'Status',        K),
    storno:  findHeader(header, 'Storno-Status'),
  };
}

export function istStornoZeile(row, sp) {
  if (sp.storno !== -1) return text(row[sp.storno]) !== '';
  return betrag(row[sp.stueck]) < 0;
}

export function internSpalten(header) {
  const K = 'Partner_Interne_Bestellungen';
  return {
    partner:     requireHeader(header, 'Partner-ID',  K),
    datum:       requireHeader(header, 'Datum',       K),
    bezeichnung: requireHeader(header, 'Bezeichnung', K),
    anzahl:      requireHeader(header, 'Anzahl',      K),
    summe:       requireHeader(header, 'Summe',       K),
    status:      requireHeader(header, 'Status',      K),
  };
}

// Jede Position verbraucht genau eine Kandidatenzeile mit gleichem Schluessel,
// in Sheet-Reihenfolge. Doppelte Zeilen werden so nicht doppelt markiert.
function ordneZu(kandidaten, zeilenKey, positionen, positionKey) {
  const pool = new Map();
  for (const r of kandidaten) {
    const k = zeilenKey(r);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(r);
  }
  const treffer = [];
  const fehlend = [];
  for (const p of positionen ?? []) {
    const liste = pool.get(positionKey(p));
    if (liste?.length) treffer.push(liste.shift());
    else fehlend.push(p);
  }
  return { treffer, fehlend };
}

function imZeitraum(datum, von, bis) {
  const d = parseDatum(datum);
  return !!(d && von && bis && d >= von && d <= bis);
}

/**
 * @param {Object}   o
 * @param {string[]} o.header, o.rows   frisch gelesener Verkaeufe-Reiter (rows mit _sheetRow)
 * @param {string}   o.partnerId
 * @param {Date}     o.von, o.bis
 * @param {Object[]} o.positionen       positionen.verkaeufe aus dem Entwurf
 * @param {Function} o.statusPasst      (status) => boolean
 * @returns {{ treffer: Array, fehlend: Object[], spalten: Object }}
 */
export function verkaufsZeilenDerAbrechnung({ header, rows, partnerId, von, bis, positionen, statusPasst }) {
  const sp = verkaufsSpalten(header);
  const kandidaten = rows.filter(r =>
    text(r[sp.partner]) === partnerId
    && statusPasst(text(r[sp.status]))
    && imZeitraum(r[sp.datum], von, bis));

  const zeilenKey = r => verkaufSchluessel({
    orderId: r[sp.order], artikelname: r[sp.artikel], variationId: r[sp.variante],
    storno: istStornoZeile(r, sp),
  });
  // Entwuerfe von vor B17 tragen kein storno-Feld: Gegenbuchungen haben dort
  // eine negative Stueckzahl.
  const positionKey = p => verkaufSchluessel({
    orderId: p.orderId, artikelname: p.artikelname, variationId: p.variationId,
    storno: p.storno !== undefined ? !!p.storno : betrag(p.stueckzahl) < 0,
  });

  return { ...ordneZu(kandidaten, zeilenKey, positionen, positionKey), spalten: sp };
}

export function interneZeilenDerAbrechnung({ header, rows, partnerId, von, bis, positionen, statusPasst }) {
  const sp = internSpalten(header);
  const kandidaten = rows.filter(r =>
    text(r[sp.partner]) === partnerId
    && statusPasst(text(r[sp.status]))
    && imZeitraum(r[sp.datum], von, bis));

  const zeilenKey = r => internSchluessel({
    datum: r[sp.datum], bezeichnung: r[sp.bezeichnung], anzahl: r[sp.anzahl], summe: r[sp.summe],
  });
  return { ...ordneZu(kandidaten, zeilenKey, positionen, internSchluessel), spalten: sp };
}
