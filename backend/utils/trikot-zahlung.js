// TR9: Bezahlstand der Shop-Bestellungen im Trikot-Reiter (nur Anzeige, nichts im Shop geaendert).
// Gemessen 12.11.2026 an den 43 offenen Trikot-Bestellungen: unbezahlt = Status on-hold (Ueberweisung, bacs) OHNE date_paid
// (2 Bestellungen); `needs_payment` ist bei on-hold false und taugt nicht. Dazu auffaellig: erstattet (1) und nicht mehr im Shop (1).
// Nur Bestellnummern und Stufen - nie Namen, Betraege oder Zahlungsdaten.
import { adminBestellLink } from './shop-admin.js';

export const UNBEZAHLT_STATUS = ['on-hold', 'pending', 'failed'];
export const ZAHLUNG_FELDER = 'id,status,date_paid';
export const ZAHLUNG_TEXT = { unbezahlt: 'nicht bezahlt', erstattet: 'erstattet', storniert: 'storniert', fehlt: 'nicht im Shop' };

/** '' = nichts auffaellig | unbezahlt | erstattet | storniert | fehlt (Bestellung im Shop nicht gefunden). */
export function zahlungStufe(o) {
  if (!o) return 'fehlt';
  const st = String(o.status ?? '');
  if (st === 'cancelled') return 'storniert';
  if (st === 'refunded') return 'erstattet';
  if (!o.date_paid && UNBEZAHLT_STATUS.includes(st)) return 'unbezahlt';
  return '';
}

/** Shop-Bestellungen (nur Ziffern-IDs) der Zeilen, die beim Kunden noch nicht fertig sind - nur fuer die wird gelesen. */
export function offeneOrderIds(ansicht) {
  const ids = new Set();
  for (const g of ansicht?.gruppen ?? []) {
    if (g.storniert) continue;
    for (const z of g.zeilen ?? []) if (/^\d+$/.test(String(z.orderId ?? '')) && !z.kundeFertig && !z.storniert) ids.add(String(z.orderId));
  }
  return [...ids];
}

/**
 * Haengt `zahlung` { stufe, text, link } an jede Zeile einer auffaelligen Bestellung und zaehlt sie (`summen.zahlung`
 * = Anzahl Bestellungen je Stufe). `je` = Map Order-ID -> Bestellung (null = nicht gefunden); ohne `je` (Shop nicht
 * lesbar) bleibt die Ansicht unveraendert und traegt `zahlungHinweis`.
 */
export function mitZahlung(ansicht, je, wcUrl, hinweis = '') {
  if (!je) return { ...ansicht, zahlung: null, zahlungHinweis: hinweis || 'Bezahlstand gerade nicht lesbar.' };
  const stufeJe = new Map();
  for (const [id, o] of je) {
    const s = zahlungStufe(o);
    if (s) stufeJe.set(String(id), { stufe: s, text: ZAHLUNG_TEXT[s], link: adminBestellLink(wcUrl, id) });
  }
  const zaehler = {};
  for (const v of stufeJe.values()) zaehler[v.stufe] = (zaehler[v.stufe] ?? 0) + 1;
  const offen = new Set(offeneOrderIds(ansicht));
  const gruppen = (ansicht?.gruppen ?? []).map(g => ({
    ...g, zeilen: (g.zeilen ?? []).map(z => {
      const k = offen.has(String(z.orderId ?? '')) && !z.kundeFertig ? stufeJe.get(String(z.orderId)) : null;
      return k ? { ...z, zahlung: k } : z;
    }),
  }));
  return { ...ansicht, gruppen, zahlung: zaehler };
}
