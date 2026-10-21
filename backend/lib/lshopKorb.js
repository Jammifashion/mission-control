// L-Shop-Warenkorb (BO2): Zugriffe auf WooCommerce und Sheets. Logik in utils/korb-logic.js.
//
// Aufrufer:
//  - POST /api/bestellen/lshop-korb/abgleich  (routes/bestellen.js; Knopf und
//    .github/workflows/lshop-korb-abgleich.yml)
//  - GET  /api/bestellen/lshop-korb           (liest NUR den Reiter)
//
// Shop: nur GET, Status nacheinander mit seitenGrenze/seitenListe, _fields ohne
// billing/shipping. Zwischenspeicher nur fuer Varianten und LShop_Modelle (5 min).
//
// Schreiben ohne values.append (antwort-BO1): Zielzeilen vorher bestimmen (erste
// freie Zeile), Nachbarzeile oben und den Zielbereich zuruecklesen, dann
// values.update, danach zuruecklesen. append haengt mitten in eine Tabelle ein,
// und googleRetry wiederholt kein append. Hinweise per values.batchUpdate auf
// einzelne Zellen, nachdem Schluessel und alter Hinweis in der Zeile geprueft sind.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { getWcClient } from './shopConfig.js';
import { seitenGrenze, seitenListe } from './hosterPruefseite.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { leseReiterSpalten, reiterCache } from './ssot-reiter.js';
import { ladeLShopZeilen } from './lshop.js';
import { wcVariationMap } from '../utils/varianten-zeilen.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { normalizeShop } from '../utils/shop-spalte.js';
import {
  TAB_KORB, KORB_SHOPS, KORB_STATUS_SHOP, korbSchluessel,
  korbZeilen, alsSheetZeile, baueKontext, abgleichPlan, nachzulesendeBestellungen,
  ersteFreieZeile, bereichLeer, vergleicheZurueck, buendele, korbZaehler,
  GRUENDE, statusPlan, naechsteEigenNummer, bestellbareVarianten, eigeneZeile,
} from '../utils/korb-logic.js';
import { LIEFERZEIT_META_KEY } from './lieferzeiten.js';

const TAB_VARIANTEN = 'Varianten';
const TAB_MASKE     = 'Erfassungsmaske';
const TAB_EXTERN    = 'SKU_Extern';
const TAB_TRIKOT    = 'Trikot_Artikel';
const ORDER_FELDER  = 'id,status,line_items';
const BLOCK         = 100;

const cache = reiterCache();
export function _korbCacheLeeren() { cache.leeren(); }

function fehler(msg, status) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}

const q = tab => `'${tab}'`;

// ── Shop ────────────────────────────────────────────────────────────────────

export async function ladeKorbBestellungen(wc) {
  const alle = [];
  for (const status of KORB_STATUS_SHOP) {
    for (let page = 1; ; page++) {
      seitenGrenze(page, { wc, pfad: 'orders' });
      const liste = seitenListe((await wc.get('orders', { status, per_page: BLOCK, page, _fields: ORDER_FELDER })).data, { wc, pfad: 'orders' });
      alle.push(...liste);
      if (liste.length < BLOCK) break;
    }
  }
  return alle;
}

// Bestellungen ueber IDs (Hinweise fuer Zeilen, deren Bestellung nicht mehr offen ist).
// Nicht zurueckgegeben (geloescht/Papierkorb) -> null.
export async function ladeBestellungenNachId(wc, ids) {
  const map = new Map(ids.map(id => [String(id), null]));
  for (let i = 0; i < ids.length; i += BLOCK) {
    const teil = ids.slice(i, i + BLOCK);
    const liste = seitenListe((await wc.get('orders', {
      include: teil.join(','), status: 'any', per_page: BLOCK, _fields: ORDER_FELDER,
    })).data, { wc, pfad: 'orders' });
    for (const o of liste) map.set(String(o.id), o);
  }
  return map;
}

export async function ladeProdukte(wc, ids) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += BLOCK) {
    const teil = ids.slice(i, i + BLOCK);
    const liste = seitenListe((await wc.get('products', {
      include: teil.join(','), status: 'any', per_page: BLOCK, _fields: 'id,type,meta_data',
    })).data, { wc, pfad: 'products' });
    for (const p of liste) {
      const lz = (p.meta_data ?? []).find(m => m.key === LIEFERZEIT_META_KEY)?.value;
      map.set(String(p.id), { type: p.type, lieferzeit: String(lz ?? '') });
    }
  }
  return map;
}

// ── Sheets ──────────────────────────────────────────────────────────────────

async function reiterInfo(sheets, spreadsheetId) {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId,gridProperties)' });
  return (data.sheets ?? []).map(s => s.properties).find(p => p.title === TAB_KORB) ?? null;
}

async function leseKorbWerte(sheets, spreadsheetId) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: q(TAB_KORB), valueRenderOption: 'FORMATTED_VALUE' });
  return data.values ?? [];
}

async function ladeKontext(sheets, spreadsheetId) {
  const varianten = await cache.hole(`var|${spreadsheetId}`, async () =>
    (await sheets.spreadsheets.values.get({ spreadsheetId, range: q(TAB_VARIANTEN) })).data.values ?? []);
  const lshop  = await ladeLShopZeilen({ sheets, spreadsheetId });
  const maske  = await leseReiterSpalten({ tab: TAB_MASKE, spalten: { id: 'ID', pid: 'Produkt-ID' }, sheets, spreadsheetId });
  const extern = await leseReiterSpalten({ tab: TAB_EXTERN, spalten: { CatalogNr: 'CatalogNr' }, optional: { Artikel_WC_IDs: 'Artikel_WC_IDs' }, sheets, spreadsheetId });
  const busId  = process.env.BUSINESS_SHEET_ID;
  if (!busId) throw fehler('BUSINESS_SHEET_ID fehlt.', 503);
  const trikot = await leseReiterSpalten({ tab: TAB_TRIKOT, spalten: { pid: 'Produkt-ID' }, sheets, spreadsheetId: busId });
  return baueKontext({
    varMap: wcVariationMap(varianten, 'L-Shop-Warenkorb'),
    varianten,
    produktIdJeSsot: Object.fromEntries(maske.map(m => [m.id, m.pid])),
    lshop, extern, trikotIds: trikot.map(x => x.pid),
  });
}

/**
 * Neue Zeilen ohne append: erste freie Zeile, Nachbarzeile oben und Zielbereich
 * (plus eine Zeile darunter) pruefen, values.update, zuruecklesen.
 */
async function schreibeNeueZeilen({ sheets, spreadsheetId, info, idx, zeilen }) {
  const werte = await leseKorbWerte(sheets, spreadsheetId);
  const frisch = korbZeilen(werte);
  const da = new Set(frisch.zeilen.map(z => z.Schluessel));
  const rest = zeilen.filter(z => !da.has(z.Schluessel));   // ein anderer Lauf war schneller
  if (!rest.length) return { geschrieben: 0, startZeile: null, uebersprungen: zeilen.length };

  const rows   = rest.map(z => alsSheetZeile(idx, z));
  const breite = rows[0].length;
  const ende   = colLetter(breite - 1);
  const start  = ersteFreieZeile(werte);
  const letzte = start + rows.length - 1;

  // Raster vergroessern, wenn noetig (Struktur, wird nicht wiederholt).
  const zeilenRaster = info?.gridProperties?.rowCount ?? 0;
  if (zeilenRaster < letzte + 1) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
      { appendDimension: { sheetId: info.sheetId, dimension: 'ROWS', length: letzte + 1 - zeilenRaster } },
    ] } });
  }

  const { data: um } = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${q(TAB_KORB)}!A${start - 1}:${ende}${letzte + 1}`, valueRenderOption: 'FORMATTED_VALUE',
  });
  const umgebung = um.values ?? [];
  const oben = umgebung[0] ?? [];
  const erwartetOben = werte[start - 2] ?? [];
  if (vergleicheZurueck([erwartetOben.slice(0, breite)], [oben]).length) {
    throw fehler(`${TAB_KORB}: Zeile ${start - 1} hat sich seit dem Lesen geaendert - nichts geschrieben.`, 409);
  }
  if (!bereichLeer(umgebung.slice(1))) {
    throw fehler(`${TAB_KORB}: Zielzeilen ${start}-${letzte + 1} sind nicht leer - nichts geschrieben.`, 409);
  }

  const range = `${q(TAB_KORB)}!A${start}:${ende}${letzte}`;
  await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: rows } });

  const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'FORMATTED_VALUE' });
  const ab = vergleicheZurueck(rows, zurueck.values ?? []);
  if (ab.length) throw fehler(`${TAB_KORB}: Rücklesen weicht in ${ab.length} Zelle(n) ab (Zeilen ${start}-${letzte}).`, 500);
  return { geschrieben: rows.length, startZeile: start, uebersprungen: zeilen.length - rest.length };
}

/** Hinweise: Zeile neu lesen, Schluessel + alten Hinweis pruefen, dann nur die Zelle. */
async function schreibeHinweise({ sheets, spreadsheetId, idx, hinweise }) {
  if (!hinweise.length) return { geschrieben: 0, konflikte: 0 };
  const frisch = korbZeilen(await leseKorbWerte(sheets, spreadsheetId)).zeilen;
  const jeZeile = new Map(frisch.map(z => [z._zeile, z]));
  const sp = colLetter(idx.Hinweis);
  const data = [];
  let konflikte = 0;
  for (const h of hinweise) {
    const z = jeZeile.get(h.zeile);
    if (!z || z.Schluessel !== h.schluessel || z.Hinweis !== (h.alt ?? '')) { konflikte++; continue; }
    data.push({ range: `${q(TAB_KORB)}!${sp}${h.zeile}`, values: [[h.neu]] });
  }
  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  }
  return { geschrieben: data.length, konflikte };
}

// ── Abgleich ────────────────────────────────────────────────────────────────

// Eine Sperre fuer alle Schreiber des Reiters in dieser Instanz (Abgleich, Status,
// eigene Position). Instanzuebergreifend schuetzen die Pruefungen vor dem Schreiben.
let laeuft = null;
export const BESCHAEFTIGT = 'Der Warenkorb wird gerade aktualisiert (Abgleich läuft) - bitte gleich noch einmal.';
async function mitSperre(was, fn) {
  if (laeuft) throw fehler(BESCHAEFTIGT, 409);
  laeuft = was;
  try { return await fn(); } finally { laeuft = null; }
}

/**
 * @param {object} o
 * @param {boolean} [o.dryRun]   nichts schreiben
 * @param {string}  [o.quelle]   'knopf' | 'workflow'
 * @param {string}  [o.laufId]   z. B. GitHub-Run-ID
 */
export async function runKorbAbgleich({ dryRun = false, quelle = 'workflow', laufId, sheets: s, wcFuer = getWcClient, jetzt = () => new Date() } = {}) {
  if (typeof dryRun !== 'boolean') throw fehler('dryRun erwartet true oder false.', 400);
  return mitSperre('abgleich', async () => {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
    const sheets = s ?? await sheetsClient();
    const zeit   = jetzt().toISOString();
    const lauf   = String(laufId ?? '').trim() || `KL-${zeit.slice(0, 16)}Z`;
    const quelleLauf = quelle === 'knopf' ? 'Knopf' : lauf;

    const info = await reiterInfo(sheets, spreadsheetId);
    if (!info && !dryRun) throw fehler(`Reiter "${TAB_KORB}" fehlt - erst anlegen (scripts/setup-lshop-korb-reiter.js).`, 409);
    const { idx, zeilen: vorhanden } = info
      ? korbZeilen(await leseKorbWerte(sheets, spreadsheetId))
      : { idx: null, zeilen: [] };

    const ktx = await ladeKontext(sheets, spreadsheetId);

    const shops = {};
    const neuAlle = [];
    const hinweiseAlle = [];
    for (const shop of KORB_SHOPS) {
      const wc = wcFuer(shop);
      const offene = await ladeKorbBestellungen(wc);
      const schonDa = new Set(vorhanden.map(z => z.Schluessel));
      const pids = [...new Set(offene.flatMap(o => (o.line_items ?? [])
        .filter(li => !schonDa.has(korbSchluessel(shop, o.id, li.id)))
        .map(li => String(li.product_id))))].filter(x => x && x !== '0');
      const produkte = await ladeProdukte(wc, pids);
      const nach = nachzulesendeBestellungen({ shop, vorhanden, offene });
      const bekannte = nach.length ? await ladeBestellungenNachId(wc, nach) : new Map();
      const plan = abgleichPlan({ shop, vorhanden, offene, produkte, bekannte, ktx, jetzt: zeit, quelleLauf });
      shops[normalizeShop(shop).toUpperCase()] = { bestellungen: offene.length, ...plan.zaehler };
      neuAlle.push(...plan.neu);
      hinweiseAlle.push(...plan.hinweise);
    }

    let schreiben = { neu: 0, uebersprungen: 0, hinweise: 0, hinweisKonflikte: 0, startZeile: null };
    if (!dryRun) {
      const n = neuAlle.length ? await schreibeNeueZeilen({ sheets, spreadsheetId, info, idx, zeilen: neuAlle }) : { geschrieben: 0, uebersprungen: 0, startZeile: null };
      const h = await schreibeHinweise({ sheets, spreadsheetId, idx, hinweise: hinweiseAlle });
      schreiben = { neu: n.geschrieben, uebersprungen: n.uebersprungen, hinweise: h.geschrieben, hinweisKonflikte: h.konflikte, startZeile: n.startZeile };
    }

    return {
      ok: true, dryRun, lauf, quelle: quelleLauf, zeit, reiterFehlt: !info, vorhanden: vorhanden.length, shops, schreiben,
      // Nur IDs und Zaehler - keine Kundendaten.
      neu: neuAlle.map(z => ({ schluessel: z.Schluessel, articleNr: z.LShop_ArticleNr, menge: z.Menge, hinweis: z.Hinweis })),
      hinweise: hinweiseAlle.map(h => ({ schluessel: h.schluessel, alt: h.alt, neu: h.neu })),
    };
  });
}

// ── BO3: Status aendern ─────────────────────────────────────────────────────

/**
 * Herausnehmen (abgewählt + Grund) oder zurueck auf offen, alles oder nichts.
 * Zeilen frisch lesen, Schluessel + bisherigen Status pruefen (statusPlan), dann
 * values.batchUpdate NUR auf Status/Grund/Notiz/Status_Datum/Stand, zuruecklesen.
 * @param {object} o { auswahl: [{schluessel, status}], ziel, grund, notiz }
 */
export async function setzeStatus({ auswahl, ziel, grund, notiz, sheets: s, jetzt = () => new Date() } = {}) {
  return mitSperre('status', async () => {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
    const sheets = s ?? await sheetsClient();
    if (!await reiterInfo(sheets, spreadsheetId)) throw fehler(`Reiter "${TAB_KORB}" fehlt.`, 409);
    const { idx, zeilen } = korbZeilen(await leseKorbWerte(sheets, spreadsheetId));
    const plan = statusPlan({ zeilen, auswahl, ziel, grund, notiz, jetzt: jetzt().toISOString() });

    const data = plan.flatMap(p => Object.entries(p.werte).map(([spalte, wert]) => ({
      range: `${q(TAB_KORB)}!${colLetter(idx[spalte])}${p.zeile}`, values: [[wert]],
    })));
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });

    // Zuruecklesen: jede geaenderte Zeile, Schluessel und neue Werte.
    const { data: zurueck } = await sheets.spreadsheets.values.batchGet({
      spreadsheetId, ranges: plan.map(p => `${q(TAB_KORB)}!${p.zeile}:${p.zeile}`), valueRenderOption: 'FORMATTED_VALUE',
    });
    const abweichend = plan.filter((p, i) => {
      const r = zurueck.valueRanges?.[i]?.values?.[0] ?? [];
      const wert = sp => String(r[idx[sp]] ?? '').trim();
      return wert('Schluessel') !== p.schluessel || Object.entries(p.werte).some(([sp, w]) => wert(sp) !== w);
    });
    if (abweichend.length) {
      throw fehler(`${TAB_KORB}: Rücklesen weicht ab bei ${abweichend.map(p => p.schluessel).join(', ')} - bitte neu laden und prüfen.`, 500);
    }
    return { ok: true, geaendert: plan.length, ziel, schluessel: plan.map(p => p.schluessel) };
  });
}

// ── BO3: eigene Positionen ──────────────────────────────────────────────────

async function variantenObjekte(sheets, spreadsheetId) {
  const werte = await cache.hole(`var|${spreadsheetId}`, async () =>
    (await sheets.spreadsheets.values.get({ spreadsheetId, range: q(TAB_VARIANTEN) })).data.values ?? []);
  const [h = [], ...z] = werte;
  return z.map(r => Object.fromEntries(h.map((k, i) => [String(k).trim(), String(r[i] ?? '').trim()])));
}

async function maskeArtikel(sheets, spreadsheetId) {
  return leseReiterSpalten({
    tab: TAB_MASKE, spalten: { id: 'ID', pid: 'Produkt-ID', name: 'Produktname', artikelnummer: 'Artikelnummer' }, sheets, spreadsheetId,
  });
}

async function variantenDesArtikels(sheets, spreadsheetId, ssotId) {
  const alle = await variantenObjekte(sheets, spreadsheetId);
  const lshop = await ladeLShopZeilen({ sheets, spreadsheetId });
  return bestellbareVarianten(alle.filter(v => v['SSOT-ID'] === ssotId), new Map(lshop.map(z => [z.articleNr, z])));
}

const SUCHE_MAX = 30;

/** Artikel fuer die Auswahl: nur synchronisiert (Produkt-ID), Suche in Name, Artikelnummer, SSOT-ID. */
export async function sucheArtikel({ q: suche, sheets: s } = {}) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheets = s ?? await sheetsClient();
  const n = String(suche ?? '').trim().toLowerCase();
  if (n.length < 2) return { artikel: [], mehr: false };
  const treffer = (await maskeArtikel(sheets, spreadsheetId))
    .filter(a => a.pid && [a.name, a.artikelnummer, a.id].some(x => x.toLowerCase().includes(n)));
  const alle = await variantenObjekte(sheets, spreadsheetId);
  const lshop = new Map((await ladeLShopZeilen({ sheets, spreadsheetId })).map(z => [z.articleNr, z]));
  const artikel = treffer.slice(0, SUCHE_MAX).map(a => ({
    ssotId: a.id, produktname: a.name, artikelnummer: a.artikelnummer,
    bestellbar: bestellbareVarianten(alle.filter(v => v['SSOT-ID'] === a.id), lshop).length,
  }));
  return { artikel, mehr: treffer.length > SUCHE_MAX };
}

/** Bestellbare Varianten eines Artikels (Farbe, Rest der Achsen, ArticleNr). */
export async function artikelVarianten({ ssotId, sheets: s } = {}) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheets = s ?? await sheetsClient();
  const id = String(ssotId ?? '').trim();
  const artikel = (await maskeArtikel(sheets, spreadsheetId)).find(a => a.id === id);
  if (!artikel || !artikel.pid) throw fehler('Artikel nicht gefunden oder nicht synchronisiert - im SSOT nachpflegen.', 404);
  return { ssotId: id, produktname: artikel.name, varianten: await variantenDesArtikels(sheets, spreadsheetId, id) };
}

/**
 * Eigene Position anlegen. Nummer EIGEN:<Jahr>-NNNN serverseitig aus dem Reiter,
 * Schreiben wie im Abgleich ueber vorher bestimmte Zielzeilen (nie values.append).
 */
export async function legeEigenePositionAn({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitSperre('eigen', async () => {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
    const sheets = s ?? await sheetsClient();
    const info = await reiterInfo(sheets, spreadsheetId);
    if (!info) throw fehler(`Reiter "${TAB_KORB}" fehlt.`, 409);
    const zeit = jetzt();
    const { idx, zeilen } = korbZeilen(await leseKorbWerte(sheets, spreadsheetId));
    const ssotId = String(eingabe?.ssotId ?? '').trim();
    const artikel = (await maskeArtikel(sheets, spreadsheetId)).find(a => a.id === ssotId);
    const varianten = artikel ? await variantenDesArtikels(sheets, spreadsheetId, ssotId) : [];
    const schluessel = naechsteEigenNummer(zeilen, zeit.getUTCFullYear());
    const zeile = eigeneZeile({ eingabe, artikel, varianten, schluessel, jetzt: zeit.toISOString() });

    const r = await schreibeNeueZeilen({ sheets, spreadsheetId, info, idx, zeilen: [zeile] });
    if (r.geschrieben !== 1) throw fehler(BESCHAEFTIGT, 409);   // Nummer inzwischen vergeben
    return { ok: true, schluessel, zeile: r.startZeile, articleNr: zeile.LShop_ArticleNr, menge: zeile.Menge };
  });
}

// ── Anzeige ─────────────────────────────────────────────────────────────────

export async function leseKorb({ shop, sheets: s, jetzt = () => new Date() } = {}) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  const sheets = s ?? await sheetsClient();
  const info = await reiterInfo(sheets, spreadsheetId);
  if (!info) return { reiterFehlt: true, buendel: [], gruende: GRUENDE, summen: { positionen: 0, zuBestellen: 0, artikelnummern: 0, offen: 0, herausgenommen: 0, herausgenommenAktuell: 0, mitHinweis: 0 } };

  const { zeilen } = korbZeilen(await leseKorbWerte(sheets, spreadsheetId));
  const meine = zeilen.filter(z => normalizeShop(z.Shop || 'jfn') === normalizeShop(shop));
  const lshop = await ladeLShopZeilen({ sheets, spreadsheetId });
  const maske = await leseReiterSpalten({ tab: TAB_MASKE, spalten: { id: 'ID', name: 'Produktname' }, sheets, spreadsheetId });
  const nun = jetzt();
  const buendel = buendele(meine, new Map(lshop.map(z => [z.articleNr, z])), Object.fromEntries(maske.map(m => [m.id, m.name])), nun);
  return {
    reiterFehlt: false,
    buendel,
    gruende: GRUENDE,
    summen: {
      positionen: meine.length,
      zuBestellen: buendel.reduce((n, b) => n + b.zuBestellen, 0),
      artikelnummern: buendel.filter(b => b.zuBestellen > 0).length,
      ...korbZaehler(meine, nun),
    },
  };
}
