// MI1: Assistent "Mika" Stufe 0 - Laden der Daten fuer die drei festen Fragen. Logik: utils/mika.js, Route: routes/mika.js.
// Kein Modell, nichts wird geschrieben. Last (Auftrag): "heute"/"dringend" nur aus Daten, die MC ohnehin laedt:
//  1. letzte Dashboard-Antwort (zuletztDashboard, <= 60 s) samt Auftragsdaten - nach dem Dashboard also KEINE weitere Lesung;
//  2. sonst einmal leseDashboard mit Auftraegen OHNE das automatische "bestellt" (leseAuftraege schreibt sonst beim Lesen);
//  3. "wahrscheinlich da": letzte Antwort der L-Shop-Bestellungen (<= 10 min), sonst einmal gelesen (merkt sie sich dort).
// Dazu je Frage + Ansicht + Shop 60 s Zwischenspeicher der fertigen Antwort (wiederholtes Tippen kostet nichts).
// Suche: genau EIN Shop-Abruf (getWcClient, orders/<nr>) bzw. der Auftrag aus leseAuftraege (ohne Automatik, 30 s Speicher).

import { getWcClient } from './shopConfig.js';
import { leseDashboard, zuletztDashboard } from './dashboard.js';
import { leseAuftraege } from './auftraege.js';
import { leseLShopBestellungen, zuletztLShopBestellungen } from './lshopBestellungen.js';
import { leseProduktionStand } from './produktionStand.js';
import { HosterPruefseiteError, ShopZeitueberschreitungError } from './hosterPruefseite.js';
import { mikaHeute, mikaDringend, mikaSucheShop, mikaSucheAuftrag, mikaNichtGefunden, sucheEingabe } from '../utils/mika.js';
import { WER, SHOPS } from '../utils/dashboard.js';

export const ANTWORT_MS = 60 * 1000;
export const DASH_MS = 60 * 1000;
export const LSHOP_MS = 10 * 60 * 1000;
let antworten = new Map();   // `${frage}|${wer}|${shop}` -> { bis, antwort }
export const _mikaCacheLeeren = () => { antworten = new Map(); };

const fehler = (text, status, code) => Object.assign(new Error(text), { status, code });
const auOhneAutomatik = () => leseAuftraege({ autoBestellen: false });

/** Standard-Lader (Tests geben Attrappen). */
export const LADER = {
  async dashboard({ wer, shop }) {
    const z = zuletztDashboard({ wer, shop, maxMs: DASH_MS });
    if (z) return { d: z.d, au: z.au };
    let au = null;
    const d = await leseDashboard({ wer, shop, quellen: { auftraege: async () => (au = await auOhneAutomatik()) } });
    return { d, au };
  },
  async lshop() {
    return zuletztLShopBestellungen({ maxMs: LSHOP_MS }) ?? await leseLShopBestellungen({ shop: 'jfn', mitHinweisen: true });
  },
  auftraege: auOhneAutomatik,
  shop: shop => getWcClient(shop),
  stand: p => leseProduktionStand({ ...p, einstufen: false }),
};

/**
 * "heute" | "dringend". fuer = 'Christian' | 'Nicole' | '' (Auswahl des Dashboards), shop = Kennzeichen.
 * Faellt eine Quelle aus, antwortet Mika mit dem Rest (`unvollstaendig`); fehlt alles -> 502.
 */
export async function beantworteFrage({ frage, fuer = '', shop = '', jetzt = new Date(), lader = LADER } = {}) {
  if (!['heute', 'dringend'].includes(frage)) throw fehler('Unbekannte Frage.', 422, 'mika_frage');
  const wer = WER.includes(fuer) ? fuer : '';
  const sh = SHOPS.includes(shop) ? shop : '';
  const key = `${frage}|${wer}|${sh}`;
  const c = antworten.get(key);
  if (lader === LADER && c && c.bis > Date.now()) return c.antwort;
  const { d, au } = await lader.dashboard({ wer, shop: sh });
  if (!d && !au) throw fehler('Keine Daten.', 502, 'mika_daten');
  let antwort;
  if (frage === 'heute') antwort = mikaHeute({ dash: d, au, wer, jetzt });
  else {
    let lshop = null;
    if (sh !== 'honk') {   // L-Shop-Bestellungen gibt es nur fuer JFN
      try { lshop = await lader.lshop(); } catch (err) {
        if (err instanceof HosterPruefseiteError) throw err;
        console.warn(`Mika: L-Shop-Bestellungen nicht lesbar (${err?.code ?? err?.status ?? 'Fehler'})`);
      }
    }
    antwort = mikaDringend({ dash: d, au, lshop, wer, jetzt });
    if (sh !== 'honk' && !lshop) antwort.unvollstaendig = true;
  }
  if (lader === LADER) antworten.set(key, { bis: Date.now() + ANTWORT_MS, antwort });
  return antwort;
}

const ist404 = err => err?.response?.status === 404 || err?.status === 404;
/** Nummer aus Fehlertexten von Laufstopps nehmen (die gehen in Log + Chat) - die Pruefung des Hosters bleibt sonst unveraendert. */
function ohneNummer(err, nr) {
  if (err instanceof HosterPruefseiteError || err instanceof ShopZeitueberschreitungError) {
    const weg = s => String(s ?? '').split(nr).join('…');
    err.message = weg(err.message);
    if (err.pfad) err.pfad = weg(err.pfad);
    throw err;
  }
}

/**
 * Suche nach Bestell- oder Auftragsnummer. Eingabe { nummer, shop }. Ungueltig -> 422 (fester Text).
 * Shop: GENAU ein Abruf orders/<nr>; 404 = nicht gefunden. Stand je Position aus der Bestellansicht (ohne Einstufung);
 * nicht lesbar -> Bestellung ohne Stand (`unvollstaendig`).
 */
export async function sucheNummer({ eingabe = {}, jetzt = new Date(), lader = LADER } = {}) {
  const e = sucheEingabe(eingabe);
  if (e.fehler) throw fehler(e.fehler, 422, 'mika_eingabe');
  if (e.art === 'au') {
    const au = await lader.auftraege();
    return mikaSucheAuftrag({ au, nr: e.nr }) ?? mikaNichtGefunden(e);
  }
  let order;
  try {
    const { data } = await lader.shop(e.shop).get(`orders/${e.nr}`, { _fields: 'id,number,status,date_created,line_items' });
    order = data;
  } catch (err) {
    if (ist404(err)) return mikaNichtGefunden(e);
    ohneNummer(err, e.nr);
    throw err;
  }
  if (!order || typeof order !== 'object' || Array.isArray(order) || !order.id) return mikaNichtGefunden(e);
  let stand = null;
  try {
    const r = await lader.stand({ shop: e.shop, bestellungen: [{
      id: order.id, date_created: order.date_created,
      line_items: (order.line_items ?? []).map(li => ({ id: li.id, name: li.parent_name || li.name, quantity: li.quantity, product_id: li.product_id, variation_id: li.variation_id, sku: li.sku })),
    }] });
    stand = r?.bestellungen?.[0] ?? null;
  } catch (err) {
    ohneNummer(err, e.nr);
    console.warn(`Mika: Stand nicht lesbar (${err?.code ?? err?.status ?? 'Fehler'})`);
  }
  return mikaSucheShop({ shop: e.shop, order, stand, jetzt });
}
