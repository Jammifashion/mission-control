// Interne Trikotbestellung (TR6) - Ein-/Ausgabe, Logik in utils/trikot-intern.js.
// GET  /api/bestellen/trikots/intern/auswahl                -> Trikots (Heim/Auswaerts aus Trikot_Artikel + Shop-Name/SKU), Groessen
// POST /api/bestellen/trikots/intern { trikots, referenz, vorgang }        -> neue INT-Zeilen (kein append, zurueckgelesen)
// POST /api/bestellen/trikots/aendern { id, zeile, trikot, vorher }         -> TR7: Shop- und INT-Zeilen ohne Charge
//      (alter Pfad /trikots/intern/aendern bleibt derselbe Weg); vorher = gesehener Stand, je Zelle geprueft
// POST /api/bestellen/trikots/intern/entfernen { id, zeile }               -> Status "storniert", nie loeschen
// Eine Sperre je Instanz, Reiter frisch gelesen (UNFORMATTED). Log nur Zeilen-IDs.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { getWcClient } from './shopConfig.js';
import { schreibeNeueZeilen, spalteBuchstabe, zeilenAbweichungen } from './sheet-zeilen.js';
import { trikotAnsichtCacheLeeren } from './trikotAnsicht.js';
import { berlinDatum } from '../utils/berlin-tag.js';
import { TAB_TRIKOTS } from '../utils/trikot-ansicht.js';
import { produktKurz } from '../utils/trikot-ansicht.js';
import {
  anlagePlan, aenderungPlan, schonAngelegt, istIntern, GROESSEN_KINDER, GROESSEN_ERWACHSENE,
} from '../utils/trikot-intern.js';

const TAB_ARTIKEL = 'Trikot_Artikel';
const CACHE_MS = 10 * 60 * 1000;
let produktCache = { bis: 0, produkte: null };
export const _trikotInternCacheLeeren = () => { produktCache = { bis: 0, produkte: null }; };
const fehler = (msg, status = 422, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
const t = v => String(v ?? '').trim();

let laeuft = false;
async function mitSperre(fn) {
  if (laeuft) throw fehler('Trikots werden gerade gespeichert – gleich noch einmal.', 409, { code: 'laeuft_gerade' });
  laeuft = true;
  try { return await fn(); } finally { laeuft = false; }
}
async function sheetsClient() { return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() })); }
function sheetId() {
  const id = process.env.BUSINESS_SHEET_ID;
  if (!id) throw fehler('BUSINESS_SHEET_ID fehlt.', 503);
  return id;
}

/** Trikots zur Auswahl: aktive Zeilen in Trikot_Artikel, Name/SKU aus dem Shop (je Produkt ein Abruf, 10 min). */
async function ladeProdukte(sheets, wc) {
  if (produktCache.produkte && Date.now() < produktCache.bis) return produktCache.produkte;
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `'${TAB_ARTIKEL}'` });
  const [kopf = [], ...rows] = data.values ?? [];
  const iId = kopf.indexOf('Produkt-ID'), iAktiv = kopf.indexOf('Aktiv');
  if (iId < 0) throw fehler('Reiter Trikot_Artikel: Spalte Produkt-ID fehlt.', 409, { code: 'einrichtung' });
  const produkte = new Map();
  for (const r of rows) {
    const id = t(r[iId]);
    if (!id || (iAktiv >= 0 && ['false', 'nein', '0'].includes(t(r[iAktiv]).toLowerCase()))) continue;
    const { data: p } = await wc.get(`products/${id}`, { _fields: 'id,name,sku' });
    if (!p || typeof p !== 'object' || !p.name) throw fehler(`Produkt ${id} im Shop nicht lesbar.`, 502);
    produkte.set(id, { produktId: id, name: t(p.name), sku: t(p.sku), kurz: produktKurz(p.name) });
  }
  produktCache = { bis: Date.now() + CACHE_MS, produkte };
  return produkte;
}
async function leseReiter(sheets) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `'${TAB_TRIKOTS}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
  return data.values ?? [];
}

/** Auswahl fuer den Dialog: Trikots (Heim/Auswaerts) und Groessen (Kinder cm, Erwachsene, dazu was im Reiter vorkommt). */
export async function internAuswahl({ sheets: s, wc: w } = {}) {
  const sheets = s ?? await sheetsClient();
  const produkte = await ladeProdukte(sheets, w ?? getWcClient('jfn'));
  const werte = await leseReiter(sheets);
  const iG = (werte[0] ?? []).indexOf('Groesse');
  const vorhanden = iG < 0 ? [] : [...new Set(werte.slice(1).map(r => t(r[iG]).toUpperCase()).filter(Boolean))];
  const bekannt = [...GROESSEN_KINDER, ...GROESSEN_ERWACHSENE];
  return {
    produkte: [...produkte.values()].map(({ produktId, name, kurz }) => ({ produktId, name, kurz })),
    groessen: { kinder: [...GROESSEN_KINDER, ...vorhanden.filter(g => /^\d+$/.test(g) && !bekannt.includes(g))].sort((a, b) => a - b),
      erwachsene: [...GROESSEN_ERWACHSENE, ...vorhanden.filter(g => !/^\d+$/.test(g) && !bekannt.includes(g))] },
  };
}

/** Neue interne Trikots. Gleicher Vorgang = schon angelegt (Doppelklick, auch ueber Instanzen: Rohtext-Zeile). */
export async function legeInterneTrikotsAn({ trikots, referenz, vorgang, sheets: s, wc: w, jetzt = new Date() } = {}) {
  const v = t(vorgang);
  if (!/^[\w-]{8,64}$/.test(v)) throw fehler('Vorgangs-Kennung fehlt.', 422);
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const werte = await leseReiter(sheets);
    const schon = schonAngelegt(werte, v);
    if (schon.length) return { ok: true, schon: true, ids: schon };
    const produkte = await ladeProdukte(sheets, w ?? getWcClient('jfn'));
    const erfasstAm = jetzt.toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(' ', 'T');
    const plan = anlagePlan({ werte, trikots, referenz, vorgang: v, produkte, heute: berlinDatum(jetzt), erfasstAm });
    await schreibeNeueZeilen(sheets, sheetId(), TAB_TRIKOTS, plan.zeilen, { alt: werte });
    trikotAnsichtCacheLeeren();
    return { ok: true, schon: false, ids: plan.ids };
  });
}

/**
 * Aendern ('aendern', trikot, vorher; TR7: Shop- und INT-Zeilen ohne Charge) bzw. Entfernen ('entfernen' -> Status
 * storniert, nur INT). Unter der Sperre frisch gelesen; vorher wird je Zelle geprueft (sonst 409, nichts geschrieben).
 */
export async function aendereInternesTrikot({ aktion, ziel, trikot, vorher, sheets: s, wc: w } = {}) {
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const werte = await leseReiter(sheets);
    const [kopf = []] = werte;
    const r = werte[Number(ziel?.zeile) - 1];
    const intern = istIntern({ id: r?.[kopf.indexOf('Zeilen-ID')], quelle: r?.[kopf.indexOf('Quelle')] });
    const produkte = aktion === 'aendern' && intern ? await ladeProdukte(sheets, w ?? getWcClient('jfn')) : new Map();
    const plan = aenderungPlan({ werte, ziel, aktion, trikot, vorher, produkte });
    if (plan.unveraendert) return { ok: true, id: t(ziel?.id), unveraendert: true };
    const data = plan.zellen.map(z => ({ range: `'${TAB_TRIKOTS}'!${spalteBuchstabe(z.spalte)}${plan.zeile}`, values: [[z.wert]] }));
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: sheetId(), requestBody: { valueInputOption: 'RAW', data } });
    const { data: zurueck } = await sheets.spreadsheets.values.batchGet({ spreadsheetId: sheetId(), ranges: data.map(d => d.range), valueRenderOption: 'UNFORMATTED_VALUE' });
    const ab = zeilenAbweichungen(plan.zellen.map(z => [z.wert]), (zurueck.valueRanges ?? []).map(r => r.values?.[0] ?? ['']));
    if (ab.length) throw fehler(`Trikots: Rücklesen weicht in ${ab.length} Zelle(n) ab – bitte prüfen.`, 500);
    trikotAnsichtCacheLeeren();
    return { ok: true, id: t(ziel?.id), aktion };
  });
}
export const aendereTrikot = aendereInternesTrikot;   // TR7: gilt fuer jede Zeile ohne Charge
