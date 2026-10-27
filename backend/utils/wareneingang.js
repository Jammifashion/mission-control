// Wareneingang (BO4b-5): reine Logik, keine Zugriffe. Ein-/Ausgabe in lib/wareneingang.js.
//
// Schritt 1 "Ware angekommen" (von Hand) und - mit Schritt 2 - "Karton angekommen" (Scan) nutzen denselben Plan:
//  - nur Korb-Positionen der L-Shop-Bestellung (Bestell_ID = order_id) mit Status "bestellt" -> "geliefert"
//    (Status, Status_Datum, Stand); jede gewaehlte Position frisch gepruefte: Schluessel vorhanden, gehoert zur
//    Bestellung, Status wie im Browser gesehen und "bestellt" - sonst 409/422, nichts geschrieben
//  - Rueckweg "zurueck auf bestellt" nur "geliefert" -> "bestellt"
//  - Wareneingang am Paket (LShop_Sendungen) NUR, wenn die Bestellung genau EIN Paket hat (die Karton-PDF nennt
//    keine Paketnummer); beim Rueckweg wird er wieder geleert, wenn danach keine Position mehr geliefert ist.
// "geliefert"/"teilweise geliefert" der Bestellung leitet weiter bestellStatus (utils/lshop-bestellungen.js) ab.

import { STATUS } from './korb-logic.js';
import { sendungenSpalten } from './lshop-belege.js';

const t = v => String(v ?? '').trim();
function fehler(msg, status, probleme) {
  const e = new Error(msg);
  e.status = status;
  if (probleme) e.probleme = probleme;
  return e;
}

/** Pakete der Bestellung mit Zeilennummer (1-basiert). */
export function paketeDerBestellung(sendungenWerte, orderId) {
  const [kopf = [], ...rest] = sendungenWerte ?? [];
  if (!kopf.length) return { idx: null, pakete: [] };
  const idx = sendungenSpalten(kopf);
  const pakete = rest.map((r, i) => ({ r, zeile: i + 2 }))
    .filter(({ r }) => t(r[idx.order_id]) === t(orderId))
    .map(({ r, zeile }) => ({ zeile, paketnummer: t(r[idx.Paketnummer]), wareneingang: t(r[idx.Wareneingang]) }));
  return { idx, pakete };
}

/**
 * Plan fuer "Ware angekommen" (von) "bestellt" -> "geliefert" bzw. Rueckweg (zurueck: true).
 * @param {object}   o
 * @param {object[]} o.korbZeilen      korbZeilen(...).zeilen (mit _zeile), frisch gelesen
 * @param {string[][]} o.sendungenWerte LShop_Sendungen inkl. Kopf, frisch gelesen
 * @param {string}   o.orderId
 * @param {{schluessel:string,status:string}[]} o.auswahl  was der Browser gesehen hat
 * @param {string}   o.jetzt           ISO
 * @param {boolean}  [o.zurueck]
 * -> { korb: [{ zeile, schluessel, werte }], paket: { zeile, spalte, alt, neu } | null, hinweis }
 */
export function eingangPlan({ korbZeilen, sendungenWerte, orderId, auswahl, jetzt, zurueck = false }) {
  const id = t(orderId);
  if (!/^JFN-\d{4}-\d{4}$/.test(id)) throw fehler('order_id fehlt oder ist ungültig.', 400);
  if (!Array.isArray(auswahl) || !auswahl.length) throw fehler('Keine Position gewählt.', 400);
  const von = zurueck ? STATUS.GELIEFERT : STATUS.BESTELLT;
  const nach = zurueck ? STATUS.BESTELLT : STATUS.GELIEFERT;

  const jeSchluessel = new Map();
  for (const z of korbZeilen ?? []) {
    if (jeSchluessel.has(z.Schluessel)) throw fehler(`Schlüssel ${z.Schluessel} steht mehrfach im Korb - nichts geändert.`, 409);
    jeSchluessel.set(z.Schluessel, z);
  }
  const probleme = [];
  const korb = [];
  const gesehen = new Set();
  for (const a of auswahl) {
    const s = t(a?.schluessel);
    if (gesehen.has(s)) { probleme.push({ schluessel: s, text: 'doppelt gewählt' }); continue; }
    gesehen.add(s);
    const z = jeSchluessel.get(s);
    if (!z) { probleme.push({ schluessel: s, text: 'nicht mehr im Korb' }); continue; }
    if (t(z.Bestell_ID) !== id) { probleme.push({ schluessel: s, text: `gehört nicht zu ${id}` }); continue; }
    if (t(a.status) !== z.Status) { probleme.push({ schluessel: s, text: `Status hat sich geändert (jetzt "${z.Status}") - neu laden` }); continue; }
    if (z.Status !== von) { probleme.push({ schluessel: s, text: `Status "${z.Status}" statt ${von}` }); continue; }
    korb.push({ zeile: z._zeile, schluessel: s, werte: { Status: nach, Status_Datum: jetzt, Stand: jetzt } });
  }
  if (probleme.length) throw fehler(`${probleme.length} Position(en) nicht änderbar - nichts geändert.`, probleme.some(p => /Status hat sich/.test(p.text)) ? 409 : 422, probleme);

  // Paket: nur bei genau einem Paket der Bestellung.
  const { pakete } = paketeDerBestellung(sendungenWerte, id);
  let paket = null;
  let hinweis = '';
  if (pakete.length === 1) {
    const p = pakete[0];
    if (!zurueck && !p.wareneingang) paket = { zeile: p.zeile, spalte: 'Wareneingang', alt: '', neu: jetzt };
    if (zurueck && p.wareneingang) {
      // leeren, wenn nach dem Rueckweg keine Position der Bestellung mehr geliefert ist
      const zurueckSchl = new Set(korb.map(k => k.schluessel));
      const nochGeliefert = [...jeSchluessel.values()].some(z => t(z.Bestell_ID) === id && z.Status === STATUS.GELIEFERT && !zurueckSchl.has(z.Schluessel));
      if (!nochGeliefert) paket = { zeile: p.zeile, spalte: 'Wareneingang', alt: p.wareneingang, neu: '' };
    }
  } else if (!zurueck) {
    hinweis = pakete.length ? `${pakete.length} Pakete - Wareneingang am Paket nicht zugeordnet` : 'noch keine Lieferbestätigung - kein Paket';
  }
  return { korb, paket, hinweis };
}
