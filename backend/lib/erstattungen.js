// Erstattungen aus WooCommerce lesen (NB1/NB2) - EINE Stelle fuer Lizenz-Sync, FP-Sync und Abrechnungsvorschau.
// Nur lesen. Shop-Zugriff nur ueber den uebergebenen getWcClient (Pruefseite haengt an jedem Request).
import { seitenGrenze, seitenListe, HosterPruefseiteError } from './hosterPruefseite.js';
import { erstattungHinweisText } from '../utils/teilerstattung.js';

// Der Sync sieht Erstattungen der in den letzten ERSTATTUNG_TAGE geaenderten Bestellungen (eine Erstattung aendert
// date_modified); aeltere holt das Skript scripts/nachtragen-erstattungen.js.
export const ERSTATTUNG_TAGE = 60;
const warte = ms => new Promise(r => setTimeout(r, ms));

/**
 * Bestellungen mit Status Verkauf, die eine Erstattung tragen und schon Verkaufszeilen haben - aus dem normalen
 * Abruf und aus allen in den letzten ERSTATTUNG_TAGE geaenderten Bestellungen. Je Kandidat EIN Abruf
 * /orders/<id>/refunds, nacheinander mit Pause.
 * @param {object} wc           getWcClient(shop)
 * @param {object[]} orders     schon geladene Bestellungen (Status Verkauf)
 * @param {Set<string>} mitZeilen  Bestellnummern, zu denen es Verkaufszeilen gibt
 * @param {string[]} verkaufStati  z. B. ['processing','completed','on-hold']
 * @returns {Promise<Array<{order, refunds}>>}
 */
export async function ladeErstattungsBestellungen(wc, orders, mitZeilen, verkaufStati, { pause = 1000, jetzt = Date.now } = {}) {
  const seit = new Date(jetzt() - ERSTATTUNG_TAGE * 864e5).toISOString().slice(0, 19);
  const geaendert = [];
  for (let page = 1; ; page++) {
    seitenGrenze(page, { wc, pfad: 'orders' });
    const listen = [];
    for (const status of verkaufStati) {
      listen.push(seitenListe((await wc.get('orders', { per_page: 100, page, status, modified_after: seit })).data, { wc, pfad: 'orders' }));
    }
    for (const l of listen) geaendert.push(...l);
    if (listen.every(l => l.length < 100)) break;
  }
  const kandidaten = new Map();
  for (const o of [...orders, ...geaendert]) {
    if ((o.refunds ?? []).length && mitZeilen.has(String(o.id)) && verkaufStati.includes(o.status)) kandidaten.set(String(o.id), o);
  }
  const out = [];
  for (const order of kandidaten.values()) {
    await warte(pause);
    const refunds = seitenListe((await wc.get(`orders/${order.id}/refunds`, { per_page: 100 })).data, { wc, pfad: 'orders/refunds' });
    out.push({ order, refunds });
  }
  return out;
}

/**
 * Abrechnungsvorschau (NB2): Erstattungen zu genau diesen Bestellungen, unabhaengig vom Alter. Eine Anfrage je
 * 100 Bestellungen (include, nur id/status/refunds), dann /refunds nur fuer die mit Erstattung. Liefert
 * dieselbe Form wie ladeErstattungsBestellungen - die Rechnung macht der Aufrufer mit derselben Funktion wie der Sync.
 * Nie sperrend: Fehler (auch die Hoster-Pruefseite) kommen als { fehler } zurueck, die Vorschau zeigt sie als Hinweis.
 */
export async function erstattungenFuerBestellungen(wc, orderIds, verkaufStati, { pause = 300 } = {}) {
  const ids = [...new Set((orderIds ?? []).map(String).filter(Boolean))];
  const bestellungen = [];
  try {
    const mitErstattung = [];
    for (let i = 0; i < ids.length; i += 100) {
      const teil = ids.slice(i, i + 100);
      const liste = seitenListe((await wc.get('orders', { include: teil.join(','), per_page: 100, status: 'any', _fields: 'id,status,refunds' })).data, { wc, pfad: 'orders' });
      for (const o of liste) if ((o.refunds ?? []).length && verkaufStati.includes(o.status)) mitErstattung.push(String(o.id));
    }
    for (const id of mitErstattung) {
      await warte(pause);
      const order = (await wc.get(`orders/${id}`)).data;
      const refunds = seitenListe((await wc.get(`orders/${id}/refunds`, { per_page: 100 })).data, { wc, pfad: 'orders/refunds' });
      bestellungen.push({ order, refunds });
    }
    return { bestellungen, geprueft: ids.length };
  } catch (err) {
    const fehler = err instanceof HosterPruefseiteError ? 'Shop zeigt die Hoster-Prüfseite' : 'Shop nicht erreichbar';
    return { bestellungen, geprueft: ids.length, fehler };
  }
}

/**
 * Hinweise der Abrechnungsvorschau (NB2, Lizenz + FP), nie sperrend: Erstattungen zu den Bestellungen der Zeilen
 * im Zeitraum, gerechnet mit DERSELBEN Funktion wie der Sync (rechne). Meldet die Hinweise (ohne Position, Betrag ohne
 * Menge, mehrdeutig, mehr als offen …) und Gegenbuchungen, die der Sync noch nicht geschrieben hat (z. B. aelter als
 * ERSTATTUNG_TAGE). Nur Bestellnummern und Erstattungs-Nummern, keine Betraege.
 * @param {object} o { wc (Client oder () => Client), orderIds, verkaufStati, rechne: (bestellungen) => { rows, hinweise }, orderVon: row => id }
 * @returns {Promise<string[]>}
 */
export async function vorschauErstattungsHinweise({ wc, orderIds, verkaufStati, rechne, orderVon, laden = erstattungenFuerBestellungen }) {
  if (!(orderIds ?? []).length) return [];
  let client;
  try { client = typeof wc === 'function' ? wc() : wc; } catch { return ['Erstattungen nicht geprüft (Shop-Zugang fehlt).']; }
  const { bestellungen, fehler } = await laden(client, orderIds, verkaufStati);
  if (fehler) return [`Erstattungen nicht geprüft (${fehler}).`];
  if (!bestellungen.length) return [];
  const erg = rechne(bestellungen);
  const texte = erg.hinweise.map(erstattungHinweisText);
  if (erg.rows.length) {
    const ids = [...new Set(erg.rows.map(orderVon))];
    texte.unshift(`${erg.rows.length} Erstattungs-Gegenbuchung(en) noch nicht gebucht (Bestellung ${ids.join(', ')}) – erst den Sync laufen lassen, ältere als ${ERSTATTUNG_TAGE} Tage über den Nachtrag.`);
  }
  return texte;
}
