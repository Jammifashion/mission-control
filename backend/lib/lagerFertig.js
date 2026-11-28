// Fertigware im Lager (LG1) - Ein-/Ausgabe, Logik in utils/lager-fertig.js.
//
// Quelle der Auswahl = JFN-Shop (nur lesen, getWcClient): Artikelliste id/name/sku/type/status (alle Seiten nacheinander,
// 30 min vorgehalten - die Shop-Suche findet keine SKU-Teile), Variationen je Artikel (10 min). Ein WC-Schluessel gilt, wenn
// er im Shop eine Variation oder ein einfacher Artikel ist (GET products/<id>, 60 min; Trikots nie).
//
// Schreiben "aus Lager nehmen" / "zurück" (Bestellkarte): unter Korb-, DTF- und Lager-Sperre, alle drei Reiter frisch gelesen,
// die Bestellung frisch aus dem Shop (nur diese eine), Plan geprueft, Zielstrecke im Journal geprueft (kein append), dann EIN
// values.batchUpdate ueber Lager_Buchungen + Warenkorb_LShop + Warenkorb_DTF, danach zurueckgelesen.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { getWcClient } from './shopConfig.js';
import { seitenGrenze, seitenListe, wirfWennPruefseite } from './hosterPruefseite.js';
import { istGroessenAchse } from './groessen.js';
import { leseLager, mitLagerSperre, lagerCacheLeeren } from './lager.js';
import { pruefeZielStrecke, zeilenAbweichungen, zellText } from './sheet-zeilen.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { TAB_KORB, korbZeilen } from '../utils/korb-logic.js';
import { aktiveOrte, alsZeile, TAB_BUCHUNGEN } from '../utils/lager.js';
import { TAB_DTF_KORB, sichtbareZeilen, positionsSchluessel } from '../utils/dtf-korb.js';
import { fertigSuche, variantenAusShop, fertigInfoAus, fertigAusLagerPlan, fertigZurueckPlan } from '../utils/lager-fertig.js';

const t = v => String(v ?? '').trim();
const q = tab => `'${tab}'`;
const fehler = (msg, status, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
const SHOP = 'jfn';
const warte = ms => new Promise(r => setTimeout(r, ms));
export const LISTE_MS = 30 * 60 * 1000;
export const VARIANTEN_MS = 10 * 60 * 1000;
export const INFO_MS = 60 * 60 * 1000;
export const TAKT_MS = 1000;
const LISTE_FELDER = 'id,name,sku,type,status';

let liste = { bis: 0, daten: null, laeuft: null };
const variantenCache = new Map();   // produktId -> { bis, daten }
const infoCache = new Map();        // id -> { bis, info }
export function _fertigCacheLeeren() { liste = { bis: 0, daten: null, laeuft: null }; variantenCache.clear(); infoCache.clear(); }

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}

/** Artikelliste des JFN-Shops (alle Status ausser Papierkorb). Gleichzeitige Aufrufe teilen einen Lauf. */
export async function ladeShopListe({ wcFuer = getWcClient, jetzt = Date.now() } = {}) {
  if (liste.daten && jetzt < liste.bis) return liste.daten;
  if (liste.laeuft) return liste.laeuft;
  liste.laeuft = (async () => {
    const wc = wcFuer(SHOP);
    const pfad = 'products';
    const alle = [];
    for (let page = 1; ; page++) {
      seitenGrenze(page, { wc, pfad });
      const teil = seitenListe((await wc.get(pfad, { per_page: 100, page, status: 'any', _fields: LISTE_FELDER, orderby: 'id', order: 'asc' })).data, { wc, pfad });
      alle.push(...teil);
      if (teil.length < 100) break;
      await warte(TAKT_MS);
    }
    liste = { bis: Date.now() + LISTE_MS, daten: alle, laeuft: null };
    return alle;
  })();
  try { return await liste.laeuft; } finally { liste.laeuft = null; }
}

/**
 * GET /api/lager/auswahl/fertig?q= - Suche ueber Name, SKU (auch Teile), Produkt-ID; dazu die Suchtexte der Erfassungsmaske
 * (Kurzbezeichnung, Variantenwerte). Trikots raus.
 */
export async function sucheFertigShop({ q: suche, trikotIds = new Set(), zusatz = new Map(), wcFuer = getWcClient } = {}) {
  if (t(suche).length < 2) return { artikel: [], mehr: false };
  return fertigSuche(await ladeShopListe({ wcFuer }), suche, { ausschluss: trikotIds, zusatz });
}

/** GET /api/lager/auswahl/fertig/:produktId - einfacher Artikel = eine Zeile, variabler = je Variation. */
export async function fertigVariantenShop({ produktId, trikotIds = new Set(), wcFuer = getWcClient, jetzt = Date.now() } = {}) {
  const id = t(produktId);
  if (!/^\d{1,12}$/.test(id)) throw fehler('Artikel unbekannt.', 404);
  if (trikotIds.has(id)) throw fehler('Trikots bitte als „Trikot“ buchen.', 422);
  const c = variantenCache.get(id);
  if (c && jetzt < c.bis) return c.daten;
  const wc = wcFuer(SHOP);
  let produkt;
  try {
    produkt = (await wc.get(`products/${id}`, { _fields: 'id,name,type,sku,status' })).data;
  } catch (err) {
    wirfWennPruefseite(err);
    if (err?.response?.status === 404) throw fehler(`Artikel ${id} gibt es im Shop nicht.`, 404);
    throw err;
  }
  if (!produkt || Array.isArray(produkt) || typeof produkt !== 'object') throw fehler(`Artikel ${id} nicht lesbar.`, 502);
  if (!['simple', 'variable'].includes(t(produkt.type))) throw fehler(`Artikel ${id} ist „${t(produkt.type)}“ – geht als Fertigware nicht.`, 422);
  let variationen = [];
  if (t(produkt.type) === 'variable') {
    const pfad = `products/${id}/variations`;
    for (let page = 1; ; page++) {
      seitenGrenze(page, { wc, pfad: 'products/variations' });
      const teil = seitenListe((await wc.get(pfad, { per_page: 100, page, _fields: 'id,sku,status,attributes' })).data, { wc, pfad: 'products/variations' });
      variationen.push(...teil);
      if (teil.length < 100) break;
      await warte(TAKT_MS);
    }
  }
  const daten = variantenAusShop(produkt, variationen, istGroessenAchse);
  // Namen fuer Bestand/Meldungen gleich mitmerken
  for (const v of daten.varianten) {
    infoCache.set(v.schluessel.slice(3), { bis: Date.now() + INFO_MS, info: { gueltig: true, name: daten.name, farbe: v.farbe, groesse: v.groesse, produktId: id } });
  }
  variantenCache.set(id, { bis: Date.now() + VARIANTEN_MS, daten });
  return daten;
}

/**
 * Info je WC-Schluessel (ohne "WC:") aus dem Shop: Map id -> { gueltig, grund?, name, farbe, groesse, produktId }.
 * Nacheinander, Takt; unbekannt (404) = gueltig false. Pruefseite/Zeitlimit -> Fehler (der Aufrufer entscheidet).
 */
export async function fertigInfo(ids, { trikotIds = new Set(), wcFuer = getWcClient, jetzt = Date.now() } = {}) {
  const m = new Map();
  const fehlend = [];
  for (const id of new Set((ids ?? []).map(t).filter(x => /^\d{1,12}$/.test(x)))) {
    const c = infoCache.get(id);
    if (c && jetzt < c.bis) m.set(id, c.info);
    else fehlend.push(id);
  }
  if (!fehlend.length) return m;
  const wc = wcFuer(SHOP);
  for (const [i, id] of fehlend.entries()) {
    if (i) await warte(TAKT_MS);
    let p = null;
    try {
      p = (await wc.get(`products/${id}`, { _fields: 'id,name,type,parent_id,attributes,status' })).data;
    } catch (err) {
      wirfWennPruefseite(err);
      if (err?.response?.status !== 404) throw err;
    }
    const info = fertigInfoAus(p && !Array.isArray(p) ? p : null, { istGroesse: istGroessenAchse, trikotIds });
    infoCache.set(id, { bis: Date.now() + (info.gueltig ? INFO_MS : 10 * 60 * 1000), info });
    m.set(id, info);
  }
  return m;
}

/** Nur aus dem Zwischenspeicher (ohne Abruf) - fuer Beschreibungen, wenn der Shop gerade nicht gefragt werden soll. */
export function fertigInfoGemerkt(id) {
  const c = infoCache.get(t(id));
  return c ? c.info : null;
}

// ── Bestellkarte: aus Lager nehmen / zurueck ─────────────────────────────────

async function ladePosition(wc, nummer, position) {
  let o;
  try {
    o = (await wc.get(`orders/${nummer}`, { _fields: 'id,status,line_items' })).data;
  } catch (err) {
    wirfWennPruefseite(err);
    if (err?.response?.status === 404) throw fehler(`Bestellung ${nummer} gibt es im Shop nicht.`, 404);
    throw err;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw fehler(`Bestellung ${nummer} nicht lesbar.`, 502);
  return (o.line_items ?? []).find(li => t(li.id) === t(position)) ?? null;
}

async function lauf(art, { eingabe, sheets: s, wcFuer = getWcClient, trikotIds = null, jetzt = () => new Date() }) {
  const nummer = t(eingabe?.nummer), position = t(eingabe?.position);
  if (!/^\d{1,12}$/.test(nummer) || !/^\d{1,12}$/.test(position)) throw fehler('Bestellung/Position unbekannt.', 422);
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  const sheets = s ?? await sheetsClient();
  const l = await leseLager(sheets, spreadsheetId);
  if (l.einrichtung.length) throw fehler(`Lager ist noch nicht eingerichtet (${l.einrichtung.join('; ')}).`, 409, { code: 'einrichtung' });
  const korbWerte = (await sheets.spreadsheets.values.get({ spreadsheetId, range: q(TAB_KORB), valueRenderOption: 'FORMATTED_VALUE' })).data.values ?? [];
  const { idx: kIdx, zeilen: kZeilen } = korbWerte.length ? korbZeilen(korbWerte) : { idx: {}, zeilen: [] };
  const dtfKorb = await (await import('./dtfKorb.js')).leseDtfKorbZeilen({ sheets, spreadsheetId });
  const posKey = `JFN:${nummer}:${position}`;
  const dtfZeilen = dtfKorb.einrichtung ? sichtbareZeilen(dtfKorb.zeilen.filter(z => positionsSchluessel(z) === posKey)) : [];

  let plan;
  if (art === 'nehmen') {
    const li = await ladePosition(wcFuer(SHOP), nummer, position);
    const trikot = trikotIds ? trikotIds.has(t(li?.product_id)) : false;
    plan = fertigAusLagerPlan(eingabe, { li, trikot, korbZeilen: kZeilen, korbHatAusLager: kIdx.Aus_Lager !== undefined, dtfZeilen,
      dtfHatAusLager: dtfKorb.hatAusLager, buchungen: l.buchungen, orte: aktiveOrte(l.orte), jetzt: jetzt() });
  } else {
    plan = fertigZurueckPlan(eingabe, { korbZeilen: kZeilen, dtfZeilen, buchungen: l.buchungen, jetzt: jetzt() });
  }
  if (plan.schonGebucht) return { ok: true, schonGebucht: true, buchungen: plan.schonGebucht.map(b => b.id) };

  const zeilenLager = plan.lagerZeilen.map(o => alsZeile(o, l.idxB));
  let ziel;
  try {
    ziel = await pruefeZielStrecke(sheets, spreadsheetId, TAB_BUCHUNGEN, l.werteB, zeilenLager);
  } catch (err) {
    throw fehler('Gerade hat jemand anders gebucht - bitte noch einmal.', 409, { code: 'konflikt', grund: err.message });
  }
  const zellen = (tab, idx, aend) => aend.flatMap(a => Object.entries(a.werte).map(([sp, w]) => {
    if (idx[sp] === undefined) throw fehler(`${tab}: Spalte ${sp} fehlt – nichts geändert.`, 409, { code: 'einrichtung' });
    return { range: `${q(tab)}!${colLetter(idx[sp])}${a.zeile}`, values: [[w]] };
  }));
  const data = [
    { range: ziel.range, values: zeilenLager },
    ...zellen(TAB_KORB, kIdx, plan.korb),
    ...zellen(TAB_DTF_KORB, dtfKorb.idx, plan.dtf),
  ];
  // EIN Schreibaufruf fuer alle drei Reiter: entweder kommt alles an oder nichts.
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  lagerCacheLeeren();

  // Zuruecklesen: Journal-Zeilen und jede geaenderte Zelle
  const { data: zurueck } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: data.map(d => d.range), valueRenderOption: 'FORMATTED_VALUE' });
  const abweichend = [];
  const lagerZurueck = (await sheets.spreadsheets.values.get({ spreadsheetId, range: ziel.range, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
  if (zeilenAbweichungen(zeilenLager, lagerZurueck).length) abweichend.push(TAB_BUCHUNGEN);
  (zurueck.valueRanges ?? []).slice(1).forEach((vr, i) => {
    if (zellText(vr.values?.[0]?.[0]) !== zellText(data[i + 1].values[0][0])) abweichend.push(data[i + 1].range.split('!')[0].replace(/'/g, ''));
  });
  if (abweichend.length) throw fehler(`Rücklesen weicht ab (${[...new Set(abweichend)].join(', ')}) - bitte im Sheet prüfen.`, 500);
  return {
    ok: true, nummer, position, stueck: plan.menge, buchungen: plan.lagerZeilen.map(z => z.Buchung_ID),
    korb: plan.korb.map(k => ({ schluessel: k.schluessel, ...k.werte })), dtf: plan.dtf.map(k => ({ schluessel: k.schluessel, ...k.werte })),
    hinweise: plan.hinweise,
  };
}

// lshopKorb/dtfKorb erst beim Aufruf laden (beide ziehen viel mit; lib/lager.js importiert dieses Modul)
const mitAllenSperren = async (was, fn) => {
  const { mitKorbSperre } = await import('./lshopKorb.js');
  const { mitDtfSperre } = await import('./dtfKorb.js');
  return mitKorbSperre(was, () => mitDtfSperre(() => mitLagerSperre(fn)));
};

/** POST /api/bestellen/produktion/fertig-aus-lager { nummer, position, schluessel, verteilung, korb, dtf, vorgang } */
export const fertigAusLager = o => mitAllenSperren('fertig-aus-lager', () => lauf('nehmen', o));
/** POST /api/bestellen/produktion/fertig-zurueck { nummer, position, vorgang } */
export const fertigZurueck = o => mitAllenSperren('fertig-zurueck', () => lauf('zurueck', o));
