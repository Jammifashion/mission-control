// DB1: Dashboard - EINE gebuendelte Route (GET /api/dashboard) statt vieler Einzelaufrufe. Liest nur; einziger Schreibweg ist
// "Kundenhinweis gelesen" (Reiter Hinweis_Gelesen im SSOT: Shop, Bestellnummer, Pruefsumme, Kuerzel, Zeit - nie Text/Kundendaten).
// Logik: utils/dashboard.js. Teilfehler: jede Quelle fuer sich; die Kachel, die sie braucht, zeigt "–" + Hinweis.
// Shop-Abrufe nacheinander (Hoster-Pruefseite, CLAUDE.md), 60 s Zwischenspeicher; eine Pruefseite bricht ab (503).

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { getWcClient } from './shopConfig.js';
import { seitenGrenze, seitenListe, wirfWennPruefseite } from './hosterPruefseite.js';
import { schreibeNeueZeilen } from './sheet-zeilen.js';
import { leseAuftraege } from './auftraege.js';
import { leseKunden } from './kunden.js';
import { leseRueckstand } from './rueckstand.js';
import { leseTrikotAnsicht } from './trikotAnsicht.js';
import { leseUngepruefte } from './bestellUebernahme.js';   // KS3
import { parseArtikel, TAB_ARTIKEL } from '../utils/trikot-logic.js';
import {
  SHOPS, TAB_GELESEN, KOPF_GELESEN, baueDashboard, shopBestellung, gelesenAus, gelesenZeile, pruefsumme, tagBerlin, WER,
} from '../utils/dashboard.js';

export const CACHE_MS = 60 * 1000;
const FELDER = 'id,number,status,date_created,total,currency,billing,customer_note,shipping_lines,line_items';
const MAX_SEITEN_DASH = 5;   // je Abfrage hoechstens 500 Bestellungen (wie die Bestellansicht)
let shopCache = new Map();   // shop -> { bis, roh }
export const _dashboardCacheLeeren = () => { shopCache = new Map(); };

const fehler = (text, status, code) => Object.assign(new Error(text), { status, ...(code ? { code } : {}) });
async function sheetsClient() { return google.sheets({ version: 'v4', auth: await getGoogleAuth() }); }

/** Berliner Ortszeit als "JJJJ-MM-TTThh:mm:ss" (WooCommerce "after" ohne Zone = Shop-Ortszeit). */
function berlinLokal(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

async function alleSeiten(wc, shop, params) {
  const alle = [];
  for (let page = 1; page <= MAX_SEITEN_DASH; page++) {
    seitenGrenze(page, { wc, shop, pfad: 'orders' });
    const liste = seitenListe((await wc.get('orders', { ...params, per_page: 100, page, _fields: FELDER })).data, { wc, shop, pfad: 'orders' });
    alle.push(...liste);
    if (liste.length < 100) break;
  }
  return alle;
}

/** Roh-Bestellungen eines Shops: offen (processing, on-hold - nacheinander) + letzte 7 Kalendertage (alle Status). */
export async function leseShopRoh(shop, { jetzt = new Date(), wc: w } = {}) {
  const c = shopCache.get(shop);
  if (!w && c && c.bis > Date.now()) return c.roh;
  const wc = w ?? getWcClient(shop);
  const offen = [];
  for (const status of ['processing', 'on-hold']) offen.push(...await alleSeiten(wc, shop, { status }));
  const heute = tagBerlin(jetzt);
  const ab = new Date(Date.UTC(+heute.slice(0, 4), +heute.slice(5, 7) - 1, +heute.slice(8, 10) - 6)).toISOString().slice(0, 10);
  const woche = await alleSeiten(wc, shop, { after: `${ab}T00:00:00` });
  const roh = { offen, woche };
  if (!w) shopCache.set(shop, { bis: Date.now() + CACHE_MS, roh });
  return roh;
}

async function leseTrikotArtikel(sheets) {
  const spreadsheetId = process.env.BUSINESS_SHEET_ID;
  if (!spreadsheetId) throw fehler('BUSINESS_SHEET_ID fehlt.', 503);
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_ARTIKEL}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
  return parseArtikel(data.values ?? []);
}

async function leseGelesenWerte(sheets) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_GELESEN}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    return data.values ?? [];
  } catch (err) {
    if (err?.code === 400 || /Unable to parse range/i.test(err?.message ?? '')) return null;   // Reiter fehlt (Setup)
    throw err;
  }
}

const kurz = err => String(err?.message ?? err).slice(0, 160);

/**
 * GET /api/dashboard. wer = 'Christian' | 'Nicole' | '' (alle).
 * Antwort: baueDashboard(...) + `fehlerText` je Quelle (kurz, ohne Kundendaten) + `einrichtung.gelesen`.
 */
export async function leseDashboard({ wer = '', shop = '', jetzt = new Date(), sheets: s, wc = {}, quellen = {} } = {}) {
  // Inhaber 06.11.: nur der Shop aus dem Kennzeichen (?shop=, haengt apiFetch immer an); leer = beide
  const aktiv = SHOPS.includes(shop) ? [shop] : SHOPS;
  const sheets = s ?? await sheetsClient();
  const fehlerText = {};
  const versuche = async (name, fn) => {
    try { return await fn(); } catch (err) { wirfWennPruefseite(err); fehlerText[name] = kurz(err); return null; }
  };
  // Google-Quellen parallel, Shops nacheinander
  const [au, kunden, rueckstand, trikots, artikel, gelesenWerte, bestellseiten] = await Promise.all([
    versuche('auftraege', () => (quellen.auftraege ?? (() => leseAuftraege()))()),
    versuche('kunden', () => (quellen.kunden ?? (() => leseKunden()))()),
    versuche('rueckstand', () => (quellen.rueckstand ?? (() => leseRueckstand()))()),
    versuche('trikots', () => (quellen.trikots ?? (() => leseTrikotAnsicht()))()),
    versuche('trikot_artikel', () => (quellen.trikotArtikel ?? (() => leseTrikotArtikel(sheets)))()),
    versuche('gelesen', () => (quellen.gelesen ?? (() => leseGelesenWerte(sheets)))()),
    versuche('bestellseiten', () => (quellen.bestellseiten ?? (() => leseUngepruefte({ sheets })))()),   // KS3: nur Zahlen
  ]);
  const trikotOrderIds = new Set((trikots?.gruppen ?? []).flatMap(g => g.zeilen ?? []).map(z => String(z.orderId ?? '').trim()).filter(Boolean));
  const shops = {};
  for (const sh of aktiv) {
    const roh = await versuche(`shop_${sh}`, () => leseShopRoh(sh, { jetzt, wc: wc[sh] }));
    if (!roh) continue;
    const norm = o => shopBestellung(o, sh, { artikel, trikotOrderIds });
    const woche = roh.woche.map(norm);
    shops[sh] = { offen: roh.offen.map(norm), woche, neu: woche };
  }
  const kundenMap = new Map((kunden?.kunden ?? []).map(k => [k.Kunden_Nr, String(k.Spitzname ?? '').split(';')[0].trim() ? `${k.Name} (${String(k.Spitzname).split(';')[0].trim()})` : k.Name]));
  const gelesen = gelesenAus(gelesenWerte ?? []);
  // "kunden" fehlt -> nur die Kunden-Nr. statt Name, keine Kachel faellt aus; "gelesen" fehlt -> alles gilt als ungelesen
  const quellFehler = Object.fromEntries(Object.keys(fehlerText).filter(k => !['kunden', 'gelesen'].includes(k)).map(k => [k, true]));
  const d = baueDashboard({ shops, shop: aktiv.length === 1 ? aktiv[0] : '', au, kunden: kundenMap, rueckstand, trikots, gelesen, wer, jetzt, fehler: quellFehler, bestellseiten });
  return { ...d, fehlerText, einrichtung: { gelesen: gelesenWerte !== null || !!fehlerText.gelesen } };
}

// ── Kundenhinweis gelesen (fuer alle) ────────────────────────────────────────
let sperre = Promise.resolve();
const mitSperre = fn => { const lauf = sperre.then(fn, fn); sperre = lauf.catch(() => {}); return lauf; };

/**
 * POST /api/dashboard/hinweis-gelesen { shop, nr, pruef, wer }. Liest die Bestellung NEU: die Notiz muss noch dieselbe
 * Pruefsumme haben (sonst 409, die Liste ist veraltet). Schon gelesen (gleiche Pruefsumme) -> { schon: true }, nichts doppelt.
 * Schreibt eine Zeile ohne append (erste freie Zeile, zurueckgelesen).
 */
export async function setzeHinweisGelesen({ eingabe = {}, sheets: s, wc: w, jetzt = () => new Date() } = {}) {
  const shop = String(eingabe.shop ?? '').toLowerCase();
  const nr = String(eingabe.nr ?? '').trim();
  const pruef = String(eingabe.pruef ?? '').trim();
  const wer = WER.includes(eingabe.wer) ? eingabe.wer : '';
  if (!SHOPS.includes(shop)) throw fehler('Shop: jfn oder honk.', 422);
  if (!/^\d{1,12}$/.test(nr)) throw fehler('Bestellnummer fehlt.', 422);
  if (!/^[0-9a-f]{16}$/.test(pruef)) throw fehler('Prüfsumme fehlt.', 422);
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const wc = w ?? getWcClient(shop);
  const { data: o } = await wc.get(`orders/${nr}`, { _fields: 'id,number,customer_note' });
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw fehler('Bestellung nicht lesbar.', 502);
  if (pruefsumme(o.customer_note) !== pruef) throw fehler('Der Hinweis hat sich inzwischen geändert – Liste neu laden.', 409, 'geaendert');
  return mitSperre(async () => {
    const werte = await leseGelesenWerte(sheets);
    if (werte === null) throw fehler(`Reiter "${TAB_GELESEN}" fehlt – scripts/setup-hinweis-gelesen.js --write.`, 409, 'einrichtung');
    if (JSON.stringify((werte[0] ?? []).slice(0, KOPF_GELESEN.length)) !== JSON.stringify(KOPF_GELESEN)) throw fehler(`Reiter "${TAB_GELESEN}": Kopfzeile passt nicht.`, 409, 'einrichtung');
    if (gelesenAus(werte).get(`${shop}:${nr}`)?.has(pruef)) return { ok: true, schon: true };
    const zeile = await schreibeNeueZeilen(sheets, spreadsheetId, TAB_GELESEN, [gelesenZeile({ shop, nr, pruef, wer, jetzt: jetzt() })], { alt: werte });
    return { ok: true, zeile };
  });
}
