// Bestellansicht (PS1) - Ein-/Ausgabe fuer POST /api/bestellen/produktion/stand, Logik in
// utils/produktion-stand.js. NUR LESEN: Produktions_Status, Warenkorb_LShop, BO4d-Bestellungen
// (leseLShopBestellungen) und - nur fuer Positionen ohne Korb-Zeile - der Kontext des Korb-Abgleichs
// plus die Produkttypen aus dem Shop (ladeProdukte, 1 Anfrage je 100, Pruefseite -> 503).
// Die Bestellungen selbst schickt der Browser mit (er hat sie gerade aus dem Shop): kein zweiter
// Bestellabruf. Antwort ohne Kundennamen.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { getWcClient } from './shopConfig.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { ladeKontext, ladeProdukte } from './lshopKorb.js';
import { leseLShopBestellungen } from './lshopBestellungen.js';
import { normalizeShop } from '../utils/shop-spalte.js';
import { TAB_KORB, korbZeilen, korbSchluessel, stufeEin, buendele, KORB_SICHTBAR } from '../utils/korb-logic.js';
import { psZustaende, baueStand, wartetAufTeile, lagerJeKorb } from '../utils/produktion-stand.js';
import { korbVorschlaege } from '../utils/lager-korb.js';
import { leseLagerFuerBestellungen } from './lager.js';

export const TAB_PS = 'Produktions_Status';
export const MAX_BESTELLUNGEN = 300;
const PS_BEREICH = 'A1:ZZ';   // GT1 B6: ohne Zeilengrenze; ganze Breite wie routes/sheets.js (Shop, Fertig, Fertig_Am hinten)

const t = v => String(v ?? '').trim();
function fehler(msg, status) { const e = new Error(msg); e.status = status; return e; }

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}

/** Eingabe pruefen und auf die noetigen Felder kuerzen (nur Zahlen-IDs). */
export function bestellungenEingabe(roh) {
  if (!Array.isArray(roh)) throw fehler('bestellungen erwartet eine Liste.', 400);
  if (roh.length > MAX_BESTELLUNGEN) throw fehler(`Höchstens ${MAX_BESTELLUNGEN} Bestellungen auf einmal.`, 400);
  const id = v => { const s = t(v); if (!/^\d{1,12}$/.test(s)) throw fehler(`Ungültige ID "${s}".`, 400); return s; };
  return roh.map(o => ({
    id: id(o?.id), date_created: t(o?.date_created),
    line_items: (Array.isArray(o?.line_items) ? o.line_items : []).map(li => ({
      id: id(li?.id), name: t(li?.name).slice(0, 200), quantity: Number(li?.quantity) || 1,
      product_id: t(li?.product_id), variation_id: t(li?.variation_id), sku: t(li?.sku),
    })),
  }));
}

/**
 * @param {boolean} [o.einstufen=true]  MI1: false = Positionen ohne Korb-Zeile NICHT einstufen (kein zweiter Shop-Abruf, kein
 *                                      Abgleich-Kontext) - Mika ruft den Shop je Suche genau einmal; Stand dann "kein" ohne Grund.
 */
export async function leseProduktionStand({ shop, bestellungen: roh, sheets: s, wcFuer = getWcClient, jetzt = () => new Date(), einstufen: mitEinstufung = true } = {}) {
  const bestellungen = bestellungenEingabe(roh);
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  const sheets = s ?? await sheetsClient();
  const jfn = normalizeShop(shop) === 'jfn';

  const { data: psDaten } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_PS}'!${PS_BEREICH}`, valueRenderOption: 'FORMATTED_VALUE' });
  const { zustaende, fertigSpalte } = psZustaende(psDaten.values ?? [], shop);

  let korb = new Map();
  let lagerJe = new Map();   // BO5-8: Korb-Schluessel -> Lager-Hinweis (dieselbe Verteilung wie im Korb)
  let lagerFrei = null;      // BO5-9: Einbuchen-Vorschlag und Lager-Hinweis fuer Positionen ohne Korb-Zeile
  let dtf = null;            // BO5-9 Teil B: DTF-Stand je Position aus Warenkorb_DTF (nur JFN)
  const bestellungJe = new Map();
  let einstufen = () => undefined;
  if (jfn && bestellungen.length) {
    const { data: k } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_KORB}'`, valueRenderOption: 'FORMATTED_VALUE' });
    const zeilen = (k.values ?? []).length ? korbZeilen(k.values).zeilen : [];
    korb = new Map(zeilen.map(z => [t(z.Schluessel), z]));
    // BO5-8: "im Lager" wie der Korb - dieselben Zeilen (JFN, sichtbar), dieselbe Funktion, also keine Doppelverplanung.
    // BO5-9: Stammdaten (gepflegte Varianten) nur, wenn es Positionen ohne Korb-Zeile mit Variation gibt.
    const mitStamm = bestellungen.some(o => o.line_items.some(li => !korb.has(korbSchluessel('jfn', o.id, li.id)) && li.variation_id && li.variation_id !== '0'));
    const lager = await leseLagerFuerBestellungen(sheets, spreadsheetId, { mitStamm });
    lagerFrei = { bestandJe: lager.bestandJe, genommenJe: lager.genommenJe, fertigJe: lager.fertigJe ?? new Map(), wcBekannt: lager.wcBekannt };
    // dynamisch wie in lib/auftraege.js: dtfKorb zieht Drive (dtfAblage) mit, das die Bestellansicht sonst nicht braucht
    try { dtf = await (await import('./dtfKorb.js')).leseDtfJePosition({ sheets, spreadsheetId }); } catch (err) {
      console.warn(`Bestellungen: DTF-Korb nicht lesbar (${err?.status ?? err?.code ?? 'Fehler'})`);
      dtf = { einrichtung: null, je: new Map() };   // null = gerade nicht lesbar
    }
    const buendel = korbVorschlaege(buendele(zeilen.filter(z => normalizeShop(z.Shop || 'jfn') === 'jfn' && KORB_SICHTBAR.includes(z.Status))), lager.bestand, lager.abgaenge);
    lagerJe = lagerJeKorb({ buendel, korb, bestand: lager.bestand });
    const bo = await leseLShopBestellungen({ shop, sheets, jetzt });
    for (const b of bo.bestellungen ?? []) for (const p of b.positionen ?? []) bestellungJe.set(t(p.schluessel), b);

    // Einstufung nur, wo der Korb die Position nicht kennt (heute: Trikots, Fanartikel).
    const ohne = bestellungen.flatMap(o => o.line_items.filter(li => !korb.has(korbSchluessel('jfn', o.id, li.id))));
    if (ohne.length && mitEinstufung) {
      const ktx = await ladeKontext(sheets, spreadsheetId);
      const pids = [...new Set(ohne.map(li => li.product_id))].filter(x => x && x !== '0');
      const produkte = pids.length ? await ladeProdukte(wcFuer('jfn'), pids) : new Map();
      einstufen = li => stufeEin(li, produkte.get(li.product_id), ktx);   // BO5-9: mit articleNr
    }
  }

  const stand = baueStand({
    shop, bestellungen, ps: zustaende, korb, bestellungJe, einstufen, lagerJe, lagerFrei, dtf,
    korbSchluessel: (nr, pos) => korbSchluessel('jfn', nr, pos), jetzt: jetzt(),
  });
  return {
    shop: normalizeShop(shop), fertigSpalte, bestellungen: stand,
    wartetAufTeile: wartetAufTeile(stand).map(b => b.id),
  };
}
