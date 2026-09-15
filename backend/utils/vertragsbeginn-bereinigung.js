// Reine Logik: Verkaufszeilen eines Partners vor seinem Vertrag-ab entfernen.
// Sheets-Zugriff in lib/vertragsbeginnBereinigung.js, Route in routes/kalkulation.js.
//
// Anlass: der Neu-Sync fuer P-004 holte Bestellungen ab 25.11.2022, die
// Vereinbarung gilt ab 01.01.2025 (48 Zeilen, 192,61 €).
//
// Schutzregeln:
//   - Trockenlauf ist Standard. Geloescht wird nur mit loeschen === true.
//   - loeschen verlangt erwarteteZeilen und erwarteteSumme; beide muessen
//     gegen den frisch gelesenen Stand passen, sonst kein Schreiben.
//   - Abgerechnete Zeilen in der Auswahl → kein Schreiben.
//   - Eine Gegenbuchung folgt ihrem Verkauf: liegt der Verkauf vor
//     Vertrag-ab, geht sie mit, auch wenn sie selbst danach datiert ist.
//     Gegenbuchungen ohne Verkauf bleiben stehen und werden gezaehlt.
//   - Geloescht wird in EINEM batchUpdate, von unten nach oben.

import { verkaufsSpalten, istStornoZeile, parseDatum } from './abrechnung-zeilen.js';
import { requireHeader } from './sheet-headers.js';

export const round2 = n => Math.round(n * 100) / 100;
const text = v => String(v ?? '').trim();
const eur  = n => round2(n).toFixed(2).replace('.', ',');

// "3,82" und "192.61" → Zahl; mit Komma gilt ein Punkt als Tausendertrenner ("1.234,56").
export function betrag(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = text(v);
  if (s === '') return NaN;
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(norm);
  return Number.isFinite(n) ? n : NaN;
}

export function fehler(status, message) {
  return Object.assign(new Error(message), { status });
}

// ── Eingaben ────────────────────────────────────────────────────────────────
export function parseOptionen(body = {}) {
  const partnerId = text(body.partnerId);
  if (!/^P-\d{3,}$/.test(partnerId))
    throw fehler(400, `partnerId fehlt oder ist ungültig: "${partnerId}" (erwartet z.B. P-004).`);

  // Nur ein echtes true loescht - "true" als String oder 1 nicht.
  if (body.loeschen !== undefined && typeof body.loeschen !== 'boolean')
    throw fehler(400, 'loeschen muss true oder false sein (Boolean).');
  const loeschen = body.loeschen === true;

  const leer = v => v === undefined || v === null || text(v) === '';
  const erwarteteZeilen = leer(body.erwarteteZeilen) ? null : Number(body.erwarteteZeilen);
  const erwarteteSumme  = leer(body.erwarteteSumme)  ? null : betrag(body.erwarteteSumme);
  if (erwarteteZeilen !== null && !(Number.isInteger(erwarteteZeilen) && erwarteteZeilen >= 0))
    throw fehler(400, `erwarteteZeilen ist keine ganze Zahl: "${body.erwarteteZeilen}".`);
  if (erwarteteSumme !== null && !Number.isFinite(erwarteteSumme))
    throw fehler(400, `erwarteteSumme ist keine Zahl: "${body.erwarteteSumme}".`);
  if (loeschen && (erwarteteZeilen === null || erwarteteSumme === null))
    throw fehler(400, 'loeschen nur zusammen mit erwarteteZeilen und erwarteteSumme.');

  return { partnerId, loeschen, erwarteteZeilen, erwarteteSumme };
}

// ── Auswahl ─────────────────────────────────────────────────────────────────
// rows tragen _sheetRow (echte Zeilennummer aus dem frischen Read).
export function waehleZeilen({ header, rows, partnerId, beginn }) {
  const sp     = verkaufsSpalten(header);
  const lizIdx = requireHeader(header, 'Lizenzgebühr', 'Verkaeufe');
  const eigene = rows.filter(r => text(r[sp.partner]) === partnerId);
  const key    = r => [text(r[sp.order]), text(r[sp.artikel]), text(r[sp.variante]) || '0'].join('|');

  const verkaufZu = new Map();
  for (const r of eigene) if (!istStornoZeile(r, sp) && !verkaufZu.has(key(r))) verkaufZu.set(key(r), r);

  const zeilen = [];
  const waisen = [];
  for (const r of eigene) {
    const basis = istStornoZeile(r, sp) ? verkaufZu.get(key(r)) : r;
    if (!basis) { waisen.push(r); continue; }
    const d = parseDatum(basis[sp.datum]);
    if (!d) throw fehler(409, `Datum unlesbar in Zeile ${basis._sheetRow}: "${basis[sp.datum]}".`);
    if (d < beginn) zeilen.push(r);
  }

  let summe = 0;
  for (const r of zeilen) {
    const b = betrag(r[lizIdx]);
    if (!Number.isFinite(b)) throw fehler(409, `Lizenzgebühr unlesbar in Zeile ${r._sheetRow}: "${r[lizIdx]}".`);
    summe += b;
  }

  return {
    zeilen,
    anzahl:      zeilen.length,
    summe:       round2(summe),
    abgerechnet: zeilen.filter(r => text(r[sp.status]) !== 'offen'),
    waisen,
    bleiben:     eigene.length - zeilen.length,
    spalten:     { ...sp, liz: lizIdx },
  };
}

// ── Freigabe ────────────────────────────────────────────────────────────────
export function pruefeFreigabe({ loeschen, erwarteteZeilen, erwarteteSumme }, auswahl) {
  const gefunden = `gefunden: ${auswahl.anzahl} Zeilen, Summe ${eur(auswahl.summe)} €`;
  if (!loeschen) return { loeschen: false, grund: `Trockenlauf (${gefunden}).` };
  if (auswahl.anzahl === 0) return { loeschen: false, grund: `Nichts zu löschen (${gefunden}).` };
  if (auswahl.anzahl !== erwarteteZeilen || auswahl.summe !== round2(erwarteteSumme)) {
    return {
      loeschen: false,
      grund: `Erwartung passt nicht zum Sheet – erwartet: ${erwarteteZeilen} Zeilen, Summe ${eur(erwarteteSumme)} €; ${gefunden}.`,
    };
  }
  if (auswahl.abgerechnet.length) {
    return {
      loeschen: false,
      grund: `${auswahl.abgerechnet.length} abgerechnete Zeile(n) in der Auswahl (Zeilen ${auswahl.abgerechnet.map(r => r._sheetRow).join(', ')}).`,
    };
  }
  return { loeschen: true, grund: `Erwartung passt (${gefunden}).` };
}

// ── Lösch-Requests ──────────────────────────────────────────────────────────
export function baueLoeschRequests(gid, zeilen) {
  const nummern = zeilen.map(r => r._sheetRow);
  if (nummern.some(n => !Number.isInteger(n) || n < 2)) throw fehler(500, 'Ungültige Zeilennummer in der Auswahl.');
  if (new Set(nummern).size !== nummern.length) throw fehler(500, 'Doppelte Zeilennummer in der Auswahl.');
  return [...nummern].sort((a, b) => b - a).map(n => ({
    deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: n - 1, endIndex: n } },
  }));
}

// ── Antwort ─────────────────────────────────────────────────────────────────
export function zeileFuerAntwort(r, sp) {
  return {
    zeile:         r._sheetRow,
    orderId:       text(r[sp.order]),
    datum:         text(r[sp.datum]),
    artikel:       text(r[sp.artikel]),
    variante:      text(r[sp.variante]) || '0',
    stueckzahl:    betrag(r[sp.stueck]),
    lizenzgebuehr: betrag(r[sp.liz]),
    status:        text(r[sp.status]),
    storno:        istStornoZeile(r, sp),
  };
}
