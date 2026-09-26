// Partner-Artikel: Import und taeglicher Abgleich (Befehl PA2, Teil A).
//
// Einzige Stelle, die Zeilen in Partner_Artikel (JFN) und HK_Partner_Artikel
// (HonkShop) ANLEGT. Aufrufer: der Knopf "Aus WC importieren" (POST
// /api/partner/:id/artikel/import) und der taegliche Abgleich (POST
// /api/partner/artikel/abgleich, sync-partner-daily.yml, VOR dem Sync).
//
// Regeln (auftrag-PA2, Entscheidungen Inhaber 26.09.):
//  - Dubletten ueber die Produkt-ID (JFN je Partner, HonkShop global), nicht
//    mehr ueber die SKU: nach einer SKU-Korrektur entstand sonst eine zweite
//    Zeile (Befund MP1).
//  - Nur fehlende Zeilen anlegen. Eine vorhandene Zeile wird nie geaendert,
//    ein vorhandener EK nie ueberschrieben.
//  - EK und Druck LEER statt 0 (leer = fehlt, 0 = bewusst 0). Druck immer leer.
//  - EK aus L-Shop (V1): kleinster 10CartonsPrice ueber alle Groessen UND die
//    angebotenen Farben, nur wenn jede aktive Variante eine LShop_ArticleNr hat
//    (Reiter Varianten). Sonst EK leer. Gehen die Farben auseinander: trotzdem
//    der kleinste, gemeldet als "Farben mit verschiedenem EK".
//  - Spalte EK_Quelle ("L-Shop JJJJ-MM-TT" oder leer) wird additiv am Ende
//    angelegt; keine Kopfzeile wird umbenannt.
//  - Lizenz-% wird nicht mehr geschrieben (seit B16 ungelesen).
//  - JFN nimmt alle Status (Entwuerfe wie bisher, im Chat markiert); HonkShop
//    wie bisher nur veroeffentlichte.
//  - Nur aktive Lizenz-Partner (Reiter Partner) und der HonkShop; Festpreis
//    (FP_Partner/FP_Artikel) wird nie angefasst.

import { getWcClient } from './shopConfig.js';
import { leseReiterSpalten } from './ssot-reiter.js';
import { farbwert } from './lshop.js';
import { findHeader, requireHeader } from '../utils/sheet-headers.js';
import { colLetter, sichereSpalte } from '../utils/sheet-spalten.js';

export const TAB_JFN = 'Partner_Artikel';
export const TAB_HK  = 'HK_Partner_Artikel';
export const SPALTE_EK_QUELLE = 'EK_Quelle';
// Teil B (Vorschlag): Markierung gesperrter Verkaufszeilen. Solange es die
// Spalte nicht gibt, zaehlt der Abgleich keine gesperrten Zeilen.
export const SPALTE_SPERRE = 'Sperre';

const t = v => String(v ?? '').trim();
const leer = v => t(v) === '';

function fehler(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

/** "3,45" / "3.45" / 3.45 -> Zahl, sonst NaN. */
export function preisZahl(v) {
  if (typeof v === 'number') return v;
  const s = t(v);
  if (!s) return NaN;
  return Number(s.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
}

// ── Reine Logik (backend/tests/partner-artikel.test.js) ─────────────────────

/**
 * EK aus L-Shop fuer die angebotenen Varianten eines Artikels (V1).
 * @param {string[]} articleNrs  LShop_ArticleNr der aktiven Varianten ('' = fehlt)
 * @param {object[]} lshop       SKU_LShop [{ articleNr, catalogNr, color1, color2, size, preis }]
 * @returns {{ ek: number|null, grund: string|null, farbenVerschieden: boolean }}
 */
export function ekAusLShop(articleNrs, lshop) {
  const nrs = (articleNrs ?? []).map(t);
  if (!nrs.length) return { ek: null, grund: 'keine Varianten mit LShop_ArticleNr', farbenVerschieden: false };
  if (nrs.some(n => !n)) return { ek: null, grund: 'nicht jede Variante hat eine LShop_ArticleNr', farbenVerschieden: false };
  const zeilen = (lshop ?? []).map(z => ({ ...z, farbe: farbwert(z.color1, z.color2), p: preisZahl(z.preis) }));
  const byNr = new Map(zeilen.map(z => [t(z.articleNr), z]));
  const farben = new Map();                        // catalogNr|farbe -> { catalogNr, farbe }
  for (const n of new Set(nrs)) {
    const z = byNr.get(n);
    if (!z) return { ek: null, grund: `ArticleNr ${n} steht nicht in SKU_LShop`, farbenVerschieden: false };
    farben.set(`${t(z.catalogNr)}|${z.farbe}`, { catalogNr: t(z.catalogNr), farbe: z.farbe });
  }
  const mins = [];
  for (const { catalogNr, farbe } of farben.values()) {
    const preise = zeilen.filter(z => t(z.catalogNr) === catalogNr && z.farbe === farbe).map(z => z.p);
    if (!preise.length || preise.some(p => !Number.isFinite(p)))
      return { ek: null, grund: `10CartonsPrice fehlt fuer ${catalogNr} ${farbe}`, farbenVerschieden: false };
    mins.push(Math.min(...preise));
  }
  return { ek: Math.min(...mins), grund: null, farbenVerschieden: new Set(mins).size > 1 };
}

/** Alle Nachkommen (inkl. Wurzel) der Kategorie(n) mit diesem Namen. */
export function kategorieBaum(kategorien, name) {
  const n = t(name).toLowerCase();
  const roots = (kategorien ?? []).filter(c => t(c.name).toLowerCase() === n).map(c => Number(c.id));
  const alle = new Set(roots);
  let front = [...roots];
  while (front.length) {
    const next = (kategorien ?? []).filter(c => front.includes(Number(c.parent)) && !alle.has(Number(c.id))).map(c => Number(c.id));
    next.forEach(id => alle.add(id));
    front = next;
  }
  return alle;
}

/** Zeile als Array in Reihenfolge der Kopfzeile; unbekannte Spalten leer. */
export function zeileNachKopf(header, werte) {
  return header.map(h => (Object.prototype.hasOwnProperty.call(werte, h) ? werte[h] : ''));
}

/**
 * Neue Zeilen fuer fehlende Produkte.
 * @param {object} o
 * @param {'jfn'|'honk'} o.shop
 * @param {string} o.partnerId          JFN: Partner der Zeile; HonkShop: nur fuer den Bericht
 * @param {object[]} o.produkte         [{ id, name, sku, status }]
 * @param {Set<string>} o.vorhanden     vorhandene Produkt-IDs (JFN: dieses Partners)
 * @param {Map<string,object>} o.ek     Produkt-ID -> Ergebnis von ekAusLShop
 * @param {string} o.heuteIso           YYYY-MM-DD (EK_Quelle)
 * @param {string} o.heuteDe            TT.MM.JJJJ (Letzte-Synchro)
 * @returns {{ werte: object, bericht: object }[]}
 */
export function neueZeilen({ shop, partnerId, produkte, vorhanden, ek, heuteIso, heuteDe }) {
  const raus = [];
  const gesehen = new Set(vorhanden);
  for (const p of produkte ?? []) {
    const pid = String(p.id);
    if (gesehen.has(pid)) continue;
    gesehen.add(pid);
    const e = ek?.get(pid) ?? { ek: null, grund: 'nicht ermittelt', farbenVerschieden: false };
    const ekWert = e.ek === null ? '' : e.ek;
    const werte = shop === 'honk'
      ? { 'Produkt-ID': pid, 'Artikelname': p.name ?? '', 'EK-Preis-Netto': ekWert, 'Druckkosten': '', 'Versandart': 'P' }
      : { 'Partner-ID': partnerId, 'Artikelnummer': p.sku || pid, 'Produkt-ID': pid, 'Artikelname': p.name ?? '',
          'EK-Preis-Netto': ekWert, 'Druckkosten': '', 'Versandart': 'P', 'Letzte-Synchro': heuteDe };
    werte[SPALTE_EK_QUELLE] = e.ek === null ? '' : `L-Shop ${heuteIso}`;
    raus.push({
      werte,
      bericht: { produktId: pid, name: p.name ?? '', entwurf: t(p.status) !== 'publish', ekFehlt: e.ek === null,
                 ekGrund: e.grund, farbenVerschieden: !!e.farbenVerschieden },
    });
  }
  return raus;
}

/** Offene Punkte je Reiterzeilen eines Partners (EK/Druck leer, nicht 0). */
export function offenePunkte(header, rows) {
  const iEk = findHeader(header, 'EK-Preis-Netto'), iDr = findHeader(header, 'Druckkosten');
  return {
    ekFehlt:    rows.filter(r => leer(r[iEk])).length,
    druckFehlt: rows.filter(r => leer(r[iDr])).length,
  };
}

// ── Lesen / Schreiben ───────────────────────────────────────────────────────

async function readTab(sheets, sheetId, tab) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: tab });
  const [header, ...rows] = data.values ?? [];
  return { header: header ?? [], rows: rows.filter(r => (r ?? []).some(c => t(c))) };
}

async function alleSeiten(wc, pfad, params) {
  const out = [];
  for (let page = 1; ; page++) {
    const { data } = await wc.get(pfad, { per_page: 100, page, ...params });
    const liste = Array.isArray(data) ? data : [];
    out.push(...liste);
    if (liste.length < 100) break;
  }
  return out;
}

const heute = (jetzt = new Date()) => {
  const iso = jetzt.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const [y, m, d] = iso.split('-');
  return { heuteIso: iso, heuteDe: `${d}.${m}.${y}` };
};

// EK aus L-Shop fuer eine Liste Produkt-IDs (SSOT: Erfassungsmaske -> Varianten -> SKU_LShop).
async function ekFuerProdukte(pids, { ssotSheets } = {}) {
  const ergebnis = new Map();
  if (!pids.length) return ergebnis;
  const o = ssotSheets ? { sheets: ssotSheets } : {};
  const [erf, varianten, lshop] = await Promise.all([
    leseReiterSpalten({ tab: 'Erfassungsmaske', spalten: { ssot: 'ID', pid: 'Produkt-ID' }, ...o }),
    leseReiterSpalten({ tab: 'Varianten', spalten: { ssot: 'SSOT-ID', aktiv: 'Aktiv' }, optional: { nr: 'LShop_ArticleNr' }, ...o }),
    leseReiterSpalten({ tab: 'SKU_LShop', spalten: { articleNr: 'ArticleNr', catalogNr: 'CatalogNr', color1: 'color1', color2: 'color2', size: 'Size', preis: '10CartonsPrice' }, ...o }),
  ]);
  const ssotVon = new Map(erf.filter(z => z.pid).map(z => [z.pid, z.ssot]));
  for (const pid of pids) {
    const ssot = ssotVon.get(pid);
    const nrs = ssot ? varianten.filter(v => v.ssot === ssot && t(v.aktiv).toUpperCase() !== 'FALSE').map(v => v.nr ?? '') : [];
    ergebnis.set(pid, ekAusLShop(nrs, lshop));
  }
  return ergebnis;
}

/**
 * Fehlende Zeilen fuer EINEN Partner anlegen.
 * @param {object} o { sheets, sheetId, partner: { id, hauptkategorie, shop }, wc?, ssotSheets?, jetzt? }
 * @returns {Promise<{ tab, neu: object[], vorhanden: number, kategorien?: number }>}
 */
export async function importiereFuerPartner({ sheets, sheetId, partner, wc, ssotSheets, jetzt } = {}) {
  const shop = t(partner.shop).toLowerCase() === 'honk' ? 'honk' : 'jfn';
  const tab  = shop === 'honk' ? TAB_HK : TAB_JFN;
  const shopWc = wc ?? getWcClient(shop);

  let produkte, kategorienAnzahl;
  if (shop === 'honk') {
    produkte = await alleSeiten(shopWc, 'products', { status: 'publish', _fields: 'id,name,sku,status' });
  } else {
    if (!t(partner.hauptkategorie)) throw fehler('Partner hat keine Hauptkategorie konfiguriert.');
    const kategorien = await alleSeiten(shopWc, 'products/categories', { _fields: 'id,name,parent' });
    const ids = kategorieBaum(kategorien, partner.hauptkategorie);
    if (!ids.size) throw fehler(`WC-Kategorie "${partner.hauptkategorie}" nicht gefunden.`, 404);
    kategorienAnzahl = ids.size;
    const m = new Map();
    for (const id of ids) {
      for (const p of await alleSeiten(shopWc, 'products', { category: id, status: 'any', _fields: 'id,name,sku,status' })) m.set(p.id, p);
    }
    produkte = [...m.values()];
  }

  const { header, rows } = await readTab(sheets, sheetId, tab);
  const iPid = requireHeader(header, 'Produkt-ID', tab);
  const iPartner = shop === 'jfn' ? requireHeader(header, 'Partner-ID', tab) : -1;
  const eigene = shop === 'honk' ? rows : rows.filter(r => t(r[iPartner]) === partner.id);
  const vorhanden = new Set(eigene.map(r => t(r[iPid])));

  const fehlend = produkte.filter(p => !vorhanden.has(String(p.id))).map(p => String(p.id));
  const ek = await ekFuerProdukte(fehlend, { ssotSheets });
  const { heuteIso, heuteDe } = heute(jetzt);
  const neu = neueZeilen({ shop, partnerId: partner.id, produkte, vorhanden, ek, heuteIso, heuteDe });

  if (neu.length) {
    await sichereSpalte(sheets, sheetId, tab, header, SPALTE_EK_QUELLE);
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${tab}!A:${colLetter(header.length - 1)}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: neu.map(n => zeileNachKopf(header, n.werte)) },
    });
  }
  return { tab, neu: neu.map(n => n.bericht), vorhanden: produkte.length - neu.length, ...(kategorienAnzahl ? { kategorien: kategorienAnzahl } : {}) };
}

/**
 * Taeglicher Abgleich: alle aktiven Lizenz-Partner + HonkShop.
 * @returns {Promise<{ partner: object[], summen: object }>}
 */
export async function artikelAbgleich({ sheets, sheetId, wcFuer, ssotSheets, jetzt } = {}) {
  const pTab = await readTab(sheets, sheetId, 'Partner');
  const P = n => findHeader(pTab.header, n);
  const partner = pTab.rows
    .map(r => ({ id: t(r[P('Partner-ID')]), hauptkategorie: t(r[P('Hauptkategorie')]), shop: t(r[P('Shop')]).toLowerCase() || 'jfn',
                 aktiv: t(r[P('Aktiv')]).toLowerCase() === 'ja', vertragAb: P('Vertrag-ab') >= 0 ? t(r[P('Vertrag-ab')]) : '' }))
    .filter(p => p.id && p.aktiv);

  const bericht = [];
  for (const p of partner) {
    const e = { id: p.id, shop: p.shop === 'honk' ? 'honk' : 'jfn', neu: [], fehler: null, vertragAbLeer: !p.vertragAb };
    try {
      const r = await importiereFuerPartner({ sheets, sheetId, partner: p, wc: wcFuer?.(e.shop), ssotSheets, jetzt });
      e.neu = r.neu;
    } catch (err) { e.fehler = err.message; }
    bericht.push(e);
  }

  // Offene Punkte nach dem Schreiben (Stand der Reiter).
  const [jfn, hk] = await Promise.all([readTab(sheets, sheetId, TAB_JFN), readTab(sheets, sheetId, TAB_HK)]);
  const jP = findHeader(jfn.header, 'Partner-ID');
  const verk = await Promise.all(['Partner_Verkäufe', 'HK_Partner_Verkäufe'].map(tab => readTab(sheets, sheetId, tab).catch(() => null)));
  for (const e of bericht) {
    const rows = e.shop === 'honk' ? hk.rows : jfn.rows.filter(r => t(r[jP]) === e.id);
    Object.assign(e, offenePunkte(e.shop === 'honk' ? hk.header : jfn.header, rows));
    e.farbenVerschieden = e.neu.filter(n => n.farbenVerschieden).length;
    const v = verk[e.shop === 'honk' ? 1 : 0];
    const iS = v ? findHeader(v.header, SPALTE_SPERRE) : -1, iP = v ? findHeader(v.header, 'Partner-ID') : -1;
    e.gesperrt = iS >= 0 ? v.rows.filter(r => t(r[iP]) === e.id && !leer(r[iS])).length : null;
  }
  const summe = f => bericht.reduce((s, e) => s + (typeof e[f] === 'number' ? e[f] : 0), 0);
  return {
    partner: bericht,
    summen: {
      partner: bericht.length, neu: bericht.reduce((s, e) => s + e.neu.length, 0),
      ekFehlt: summe('ekFehlt'), druckFehlt: summe('druckFehlt'), farbenVerschieden: summe('farbenVerschieden'),
      gesperrt: summe('gesperrt'), vertragAbLeer: bericht.filter(e => e.vertragAbLeer).length,
      fehler: bericht.filter(e => e.fehler).length,
    },
  };
}

// ── Chat nach dem Abgleich (PA2/PA6) ────────────────────────────────────────

export const CHAT = {
  GESENDET:      'gesendet',
  NICHTS:        'nichts zu melden',
  FEHLGESCHLAGEN: 'fehlgeschlagen',
  LEBENSZEICHEN: 'lebenszeichen gesendet',
};

// Uhr des Abgleichs. Tests setzen uhr.jetzt fest; im Code steht kein Datum.
export const uhr = { jetzt: () => new Date() };

/** Montag in Europe/Berlin (Sonntag 23:30 UTC im Sommer ist dort schon Montag). */
export function istMontagBerlin(jetzt = uhr.jetzt()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', weekday: 'short' }).format(jetzt) === 'Mon';
}

/**
 * Meldung nach dem Abgleich. Befund -> normale Meldung (ersetzt das
 * Lebenszeichen). Nichts zu melden -> montags ein Lebenszeichen, sonst nichts.
 * @param {object} o { bericht, notify, baueMeldung, baueLebenszeichen, jetzt }
 * @returns {Promise<string>} einer der CHAT-Werte
 */
export async function abgleichMelden({ bericht, notify, baueMeldung, baueLebenszeichen, jetzt = uhr.jetzt() }) {
  const text = baueMeldung(bericht);
  if (text) return (await notify(text)) ? CHAT.GESENDET : CHAT.FEHLGESCHLAGEN;
  if (!istMontagBerlin(jetzt)) return CHAT.NICHTS;
  return (await notify(baueLebenszeichen(bericht?.summen?.partner ?? (bericht?.partner ?? []).length)))
    ? CHAT.LEBENSZEICHEN : CHAT.FEHLGESCHLAGEN;
}
