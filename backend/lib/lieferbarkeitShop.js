// Problemliste "Lieferbarkeit Shop" (BO7-3) - Ein-/Ausgabe, Logik in utils/lieferbarkeit-shop.js. NUR LESEN.
//
//  GET /api/lieferbarkeit-shop               Liste (Sheets + 1-2 Shop-Abrufe fuer Status/Name/Kategorie/Lieferzeit, 10 min)
//  GET /api/lieferbarkeit-shop?shopStatus=1   zusaetzlich der Status jeder Variation im Shop (privat ausblenden) - je Artikel
//                                             ein Abruf, nacheinander mit Takt (PAUSE_MS), 30 min Zwischenspeicher je Artikel
//
// Privat im Shop: MC setzt beim Privat-Setzen (Loeschliste) die Varianten-Zeile auf Aktiv FALSE - die faellt schon so
// heraus. Den Shop-Status jeder Variation liest die Ansicht nur auf Knopfdruck, weil das je Artikel einen Abruf kostet
// (Hoster-Pruefseite nach ~11 schnellen Abrufen). Shop nur ueber getWcClient (Pruefseite haengt an jedem Request).

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { getWcClient } from './shopConfig.js';
import { leseReiterSpalten } from './ssot-reiter.js';
import { leseLieferbarkeit } from './lieferbarkeitLesen.js';
import { ladeLShopZeilen, farbwert } from './lshop.js';
import { parseLieferzeiten, lieferzeitAusMetaData, TAB_LIEFERZEITEN } from './lieferzeiten.js';
import { wirfWennPruefseite } from './hosterPruefseite.js';
import { baueProblemliste } from '../utils/lieferbarkeit-shop.js';

export const PRODUKT_CACHE_MS = 10 * 60_000;
export const VARIATION_CACHE_MS = 30 * 60_000;
export const PAUSE_MS = 2000;   // Takt wie die Halloween-Anlage (HW2): Hoster-Pruefseite nach ~11 schnellen Abrufen
const t = v => String(v ?? '').trim();

let _produkte = new Map();     // Produkt-ID -> { zeit, daten }
let _variationen = new Map();  // Produkt-ID -> { zeit, status: Map }
export function _lieferbarkeitShopCacheLeeren() { _produkte = new Map(); _variationen = new Map(); }

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

/** Status jeder Variation der genannten Artikel - ein Abruf je Artikel (Seiten a 100), nacheinander mit Takt. */
async function ladeVariationsStatus(wc, ids, { pause, warte }) {
  const status = new Map();
  let erster = true;
  for (const id of ids) {
    const c = _variationen.get(id);
    if (c && Date.now() - c.zeit < VARIATION_CACHE_MS) { for (const [k, v] of c.status) status.set(k, v); continue; }
    const je = new Map();
    for (let seite = 1; seite <= 20; seite++) {
      if (!erster) await warte(pause);
      erster = false;
      let data;
      try { ({ data } = await wc.get(`products/${id}/variations`, { per_page: 100, page: seite, _fields: 'id,status' })); } catch (err) {
        wirfWennPruefseite(err);
        throw err;
      }
      if (!Array.isArray(data)) throw new Error('Shop-Antwort ohne Liste');
      for (const v of data) je.set(String(v.id), t(v.status));
      if (data.length < 100) break;
    }
    _variationen.set(id, { zeit: Date.now(), status: je });
    for (const [k, v] of je) status.set(k, v);
  }
  return status;
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
  const kandidaten = baueProblemliste({ varianten, produktJeSsot, je: lb.je, produkte: new Map([...produktJeSsot.values()].map(id => [id, { status: 'publish' }])), jetzt });
  const ids = kandidaten.artikel.map(a => a.produktId);
  const wc = wcFuer('jfn');
  const produkte = await ladeProdukte(wc, ids, { pause, warte });
  const varStatus = shopStatus ? await ladeVariationsStatus(wc, ids.filter(id => produkte.get(id)?.status === 'publish'), { pause, warte }) : null;
  const liste = baueProblemliste({ varianten, produktJeSsot, je: lb.je, produkte, lieferzeitName: lzNamen, modelle, varStatus, jetzt });
  return { ...liste, stand: lb.stand };
}
