// Problemliste "Lieferbarkeit Shop" (BO7-3) - Ein-/Ausgabe, Logik in utils/lieferbarkeit-shop.js. NUR LESEN.
//
//  GET /api/lieferbarkeit-shop               Liste (Sheets + 1-2 Shop-Abrufe fuer Status/Name/Kategorie/Lieferzeit, 10 min)
//  GET /api/lieferbarkeit-shop?shopStatus=1   zusaetzlich der Status jeder Variation im Shop (privat ausblenden) - je Artikel
//                                             ein Abruf, nacheinander mit Takt (PAUSE_MS), 30 min Zwischenspeicher je Artikel
//
// Privat im Shop: MC setzt beim Privat-Setzen (Loeschliste) die Varianten-Zeile auf Aktiv FALSE - die faellt schon so
// heraus. Den Shop-Status jeder Variation liest die Ansicht nur auf Knopfdruck, weil das je Artikel einen Abruf kostet
// (Hoster-Pruefseite nach ~11 schnellen Abrufen). Shop nur ueber getWcClient (Pruefseite haengt an jedem Request).
//
// BO7-5 Lagerstatus je Variation (gemessen 09.11.: wc/v3 kann Variationen nicht shopweit nach stock_status listen - `type`
// kennt nur simple/grouped/external/variable; der Elternartikel steht auf "instock", sobald eine Variation vorraetig ist):
// die oeffentliche Store-API `wc/store/v1/products?type=variation` kann es. Bei jedem Oeffnen hoechstens
//   - `stock_status=onbackorder` (alle Rueckstand-Variationen, heute 0 -> eine Anfrage) und
//   - `include=<IDs der Problem-Variationen>` je 100 eine Anfrage (is_in_stock / is_on_backorder),
// nacheinander mit Takt, 10 min Zwischenspeicher; private/ausgeblendete Variationen liefert sie nicht (= unbekannt, keine
// Gruppe). Zugriff ueber fetchMitZeitlimit + pruefeFetchAntwort (Hoster-Pruefseite). "Rueckstand erlaubt" bei Lagerstatus
// "vorraetig" kennt nur wc/v3 (`backorders`) - das liest "Shop-Status prüfen" mit und hat dann Vorrang.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { getWcClient } from './shopConfig.js';
import { leseReiterSpalten } from './ssot-reiter.js';
import { leseLieferbarkeit } from './lieferbarkeitLesen.js';
import { ladeLShopZeilen, farbwert } from './lshop.js';
import { parseLieferzeiten, lieferzeitAusMetaData, TAB_LIEFERZEITEN } from './lieferzeiten.js';
import { wirfWennPruefseite, fetchMitZeitlimit, pruefeFetchAntwort, seitenGrenze, seitenListe } from './hosterPruefseite.js';
import { getShopConfig } from './shopConfig.js';
import { baueProblemliste, lagerAusStore, lagerAusV3, LAGER } from '../utils/lieferbarkeit-shop.js';

export const PRODUKT_CACHE_MS = 10 * 60_000;
export const VARIATION_CACHE_MS = 30 * 60_000;
export const LAGER_CACHE_MS = 10 * 60_000;   // BO7-5
export const STORE_PFAD = '/wp-json/wc/store/v1/products';
export const PAUSE_MS = 2000;   // Takt wie die Halloween-Anlage (HW2): Hoster-Pruefseite nach ~11 schnellen Abrufen
const t = v => String(v ?? '').trim();

let _produkte = new Map();     // Produkt-ID -> { zeit, daten }
let _variationen = new Map();  // Produkt-ID -> { zeit, status: Map, lager: Map }
let _lager = new Map();        // Variation-ID -> { zeit, info }  (Store-API, BO7-5)
let _rueckstand = null;        // { zeit, ids: string[] }          (Store-API onbackorder, BO7-5)
export function _lieferbarkeitShopCacheLeeren() { _produkte = new Map(); _variationen = new Map(); _lager = new Map(); _rueckstand = null; }

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}

/** Produkte (Status, Name, Link, Kategorien, Lieferzeit) - je 100 ein Abruf, nacheinander, 10 min zwischengespeichert. */
async function ladeProdukte(wc, ids, { pause, warte }) {
  const jetzt = Date.now();
  const fehlen = ids.filter(id => !(_produkte.get(id) && jetzt - _produkte.get(id).zeit < PRODUKT_CACHE_MS));
  for (let i = 0; i < fehlen.length; i += 100) {
    if (i) await warte(pause);
    const teil = fehlen.slice(i, i + 100);
    const { data } = await wc.get('products', { include: teil.join(','), per_page: 100, status: 'any', _fields: 'id,name,status,permalink,categories,meta_data' });
    if (!Array.isArray(data)) throw new Error('Shop-Antwort ohne Liste');
    for (const p of data) {
      _produkte.set(String(p.id), { zeit: jetzt, daten: {
        status: t(p.status), name: t(p.name), permalink: t(p.permalink), kategorien: (p.categories ?? []).map(k => t(k.name)).filter(Boolean),
        lieferzeit: lieferzeitAusMetaData(p.meta_data) ?? '',
      } });
    }
  }
  return new Map(ids.filter(id => _produkte.has(id)).map(id => [id, _produkte.get(id).daten]));
}

/**
 * Status jeder Variation der genannten Artikel - ein Abruf je Artikel (Seiten a 100), nacheinander mit Takt.
 * BO7-5: liest stock_status + backorders mit -> lager (Variation-ID -> { lager, rueckstandErlaubt }).
 */
async function ladeVariationsStatus(wc, ids, { pause, warte }) {
  const status = new Map();
  const lager = new Map();
  let erster = true;
  for (const id of ids) {
    const c = _variationen.get(id);
    if (c && Date.now() - c.zeit < VARIATION_CACHE_MS) { for (const [k, v] of c.status) status.set(k, v); for (const [k, v] of c.lager) lager.set(k, v); continue; }
    const je = new Map();
    const jeLager = new Map();
    for (let seite = 1; seite <= 20; seite++) {
      if (!erster) await warte(pause);
      erster = false;
      let data;
      try { ({ data } = await wc.get(`products/${id}/variations`, { per_page: 100, page: seite, _fields: 'id,status,stock_status,backorders' })); } catch (err) {
        wirfWennPruefseite(err);
        throw err;
      }
      if (!Array.isArray(data)) throw new Error('Shop-Antwort ohne Liste');
      for (const v of data) {
        je.set(String(v.id), t(v.status));
        const info = lagerAusV3(v);
        if (info.lager) jeLager.set(String(v.id), info);
      }
      if (data.length < 100) break;
    }
    _variationen.set(id, { zeit: Date.now(), status: je, lager: jeLager });
    for (const [k, v] of je) status.set(k, v);
    for (const [k, v] of jeLager) lager.set(k, v);
  }
  return { status, lager };
}

/**
 * Lagerstatus ueber die Store-API (BO7-5): alle Variationen im Rueckstand + die genannten Variationen. Nur lesen.
 * @returns {Map} Variation-ID -> { lager, rueckstandErlaubt: false }
 */
export async function ladeLagerStatus({ vids, basis, fetchFn = fetchMitZeitlimit, pause = PAUSE_MS, warte, shop = 'JammiFashion' }) {
  const jetzt = Date.now();
  const lager = new Map();
  let erster = true;
  const hole = async query => {
    if (!erster) await warte(pause);
    erster = false;
    const res = await fetchFn(`${basis}${STORE_PFAD}?${query}`, { headers: { Accept: 'application/json' } }, { shop, pfad: STORE_PFAD });
    if (res.status >= 400) {
      await pruefeFetchAntwort(res, { shop, pfad: STORE_PFAD });   // Pruefseite -> wirft
      throw new Error(`Store-API ${res.status}`);
    }
    return seitenListe(await pruefeFetchAntwort(res, { shop, pfad: STORE_PFAD }), { shop, pfad: STORE_PFAD });
  };
  const felder = '_fields=id,parent,is_in_stock,is_on_backorder';
  // 1. alle Rueckstand-Variationen (wenige Seiten)
  if (!_rueckstand || jetzt - _rueckstand.zeit >= LAGER_CACHE_MS) {
    const ids = [];
    for (let seite = 1; ; seite++) {
      seitenGrenze(seite, { shop, pfad: STORE_PFAD });
      const data = await hole(`type=variation&stock_status=onbackorder&per_page=100&page=${seite}&${felder}`);
      for (const p of data) {
        const info = { lager: lagerAusStore(p) || LAGER.RUECKSTAND, rueckstandErlaubt: false };
        _lager.set(String(p.id), { zeit: jetzt, info });
        ids.push(String(p.id));
      }
      if (data.length < 100) break;
    }
    _rueckstand = { zeit: jetzt, ids };
  }
  for (const id of _rueckstand.ids) { const c = _lager.get(id); if (c) lager.set(id, c.info); }
  // 2. die genannten Variationen (je 100 eine Anfrage); nicht geliefert = privat/ausgeblendet -> unbekannt
  const fehlen = [...new Set(vids.map(String))].filter(id => !lager.has(id) && !(_lager.get(id) && jetzt - _lager.get(id).zeit < LAGER_CACHE_MS));
  for (let i = 0; i < fehlen.length; i += 100) {
    const teil = fehlen.slice(i, i + 100);
    const data = await hole(`type=variation&include=${teil.join(',')}&per_page=100&${felder}`);
    const da = new Set();
    for (const p of data) {
      const info = { lager: lagerAusStore(p), rueckstandErlaubt: false };
      _lager.set(String(p.id), { zeit: jetzt, info });
      da.add(String(p.id));
    }
    for (const id of teil) if (!da.has(id)) _lager.set(id, { zeit: jetzt, info: null });
  }
  for (const id of vids.map(String)) { const c = _lager.get(id); if (c?.info?.lager) lager.set(id, c.info); }
  return lager;
}

async function lieferzeitNamen(sheets, spreadsheetId) {
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${TAB_LIEFERZEITEN}!A1:Z200` });
    return new Map(parseLieferzeiten(data.values ?? []).map(l => [l.id, l.name]));
  } catch { return new Map(); }   // ohne Namen: nur die ID
}

/**
 * Problemliste lesen. Schreibt nichts (weder Shop noch Sheet).
 * @returns {{ artikel, zaehler, stand, hinweis? }}
 */
export async function leseProblemliste({
  sheets: s, wcFuer = getWcClient, spreadsheetId = process.env.GOOGLE_SHEET_ID, jetzt = new Date(), shopStatus = false,
  pause = PAUSE_MS, warte = ms => new Promise(r => setTimeout(r, ms)),
  fetchFn = fetchMitZeitlimit, storeBasis = () => String(getShopConfig('jfn').wcUrl ?? '').replace(/\/+$/, ''),
} = {}) {
  const sheets = s ?? await sheetsClient();
  const lb = await leseLieferbarkeit({ sheets, spreadsheetId, jetzt });
  if (!lb.stand) return { artikel: [], zaehler: null, stand: null, hinweis: 'Die L-Shop-Lieferbarkeit ist noch nicht eingerichtet oder leer – erst „📦 Lieferbarkeit jetzt“ im Warenkorb.' };
  const [varianten, maske, lshop, lzNamen] = await Promise.all([
    leseReiterSpalten({ tab: 'Varianten', sheets, spreadsheetId, spalten: { 'SSOT-ID': 'SSOT-ID', LShop_ArticleNr: 'LShop_ArticleNr' },
      optional: { Aktiv: 'Aktiv', WC_Variation_ID: 'WC_Variation_ID', E1: 'E1', V1: 'V1', E2: 'E2', V2: 'V2', E3: 'E3', V3: 'V3' } }),
    leseReiterSpalten({ tab: 'Erfassungsmaske', sheets, spreadsheetId, spalten: { id: 'ID' }, optional: { produktId: 'Produkt-ID' } }),
    ladeLShopZeilen({ sheets, spreadsheetId }),
    lieferzeitNamen(sheets, spreadsheetId),
  ]);
  const produktJeSsot = new Map(maske.filter(m => t(m.produktId)).map(m => [t(m.id), t(m.produktId)]));
  const modelle = lshop.map(z => ({ articleNr: t(z.articleNr), catalogNr: t(z.catalogNr), farbe: farbwert(z.color1, z.color2), size: t(z.size), marke: t(z.marke) }));
  // Nur Artikel mit mindestens einer Problem-Variation lesen: erst ohne Shop-Daten vorsortieren.
  const alleVeroeffentlicht = new Map([...produktJeSsot.values()].map(id => [id, { status: 'publish' }]));
  const vorab = baueProblemliste({ varianten, produktJeSsot, je: lb.je, produkte: alleVeroeffentlicht, jetzt });
  // BO7-5: Lagerstatus (Store-API) - Rueckstand shopweit + die Problem-Variationen. Fehler (ausser Pruefseite/Zeitlimit) = ohne Gruppen.
  let lager = null;
  let lagerHinweis = '';
  try {
    lager = await ladeLagerStatus({ vids: vorab.artikel.flatMap(a => a.variationen.map(v => v.variationId)), basis: storeBasis(), fetchFn, pause, warte });
  } catch (err) {
    wirfWennPruefseite(err);
    lagerHinweis = 'Lagerstatus im Shop nicht lesbar – die Gruppen „Im Rückstand“ / „Vorrätig“ fehlen.';
  }
  const kandidaten = lager ? baueProblemliste({ varianten, produktJeSsot, je: lb.je, produkte: alleVeroeffentlicht, lager, jetzt }) : vorab;
  const ids = kandidaten.artikel.map(a => a.produktId);
  const wc = wcFuer('jfn');
  if (lager) await warte(pause);
  const produkte = await ladeProdukte(wc, ids, { pause, warte });
  let varStatus = null;
  if (shopStatus) {
    const v3 = await ladeVariationsStatus(wc, ids.filter(id => produkte.get(id)?.status === 'publish'), { pause, warte });
    varStatus = v3.status;
    lager = new Map([...(lager ?? new Map()), ...v3.lager]);   // wc/v3 hat Vorrang (auch "Rückstand erlaubt")
  }
  const liste = baueProblemliste({ varianten, produktJeSsot, je: lb.je, produkte, lieferzeitName: lzNamen, modelle, varStatus, lager, jetzt });
  return { ...liste, stand: lb.stand, ...(lagerHinweis ? { lagerHinweis } : {}) };
}
