// HONK!-Zwilling anlegen (ZW1). Logik in utils/zwilling.js.
//
// Ablauf `legeZwillingAn({ jfnId, ssotId })` - erst alles lesen und pruefen, dann schreiben:
//   1. SSOT: Erfassungsmaske-Zeile (ID + Produkt-ID muessen passen, HONK_Produkt_ID leer), Zuordnungen aus
//      Struktur_Kategorien.HONK_Kategorie und Struktur_Lieferzeiten.Term_ID_HONK. Fehlen Spalten -> 409 `einrichtung`.
//   2. JFN-Artikel + Variationen lesen -> Plan. Fehlt eine Zuordnung -> 422 mit Gruenden, in HONK nichts angelegt.
//   3. HONK: gibt es eine der SKUs schon -> 409 `sku_vergeben` (kein "-v2" wie bei der JFN-Anlage).
//   4. Bilder: aus JFN laden, in die HONK-Mediathek hochladen (lib/wpMedien.js, Name/Titel/ALT gleich). Scheitert
//      eines (z. B. WP-Rolle ohne Upload-Recht) -> 502 `bilder`, KEIN Artikel (kein Zwilling ohne Bilder).
//   5. Artikel als ENTWURF anlegen, Variationen per batch (<= 50), Takt 2 s.
//   6. Zuruecklesen und vergleichen; dann SSOT: Erfassungsmaske HONK_Produkt_ID + HONK_Status, Varianten
//      HONK_Variation_ID (Zuordnung ueber die Attributkombination, nur leere Zellen), RAW, zurueckgelesen.
// Eine Sperre je Instanz verhindert den Doppelklick. Shop-Zugriffe nur ueber getWcClient bzw. fetchMitZeitlimit +
// Pruefung. Keine Partner-Zeile: die legt der taegliche Abgleich (lib/partnerArtikel.js) an, sobald der Zwilling
// veroeffentlicht ist.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { frischLesen } from './sheetsZentral.js';
import { getWcClient, getShopConfig } from './shopConfig.js';
import { fetchMitZeitlimit, HosterPruefseiteError, wirfWennPruefseite } from './hosterPruefseite.js';
import { ladeMedienHoch } from './wpMedien.js';
import { leseAlleVariationen, ordneWcIdsZu } from './wc-variation-ids.js';
import { findHeader, findHeaderAny } from '../utils/sheet-headers.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { adminBestellLink } from '../utils/shop-admin.js';
import {
  SPALTE_ERF_HONK_ID, SPALTE_ERF_HONK_STATUS, SPALTE_VAR_HONK_ID, SPALTE_KAT_HONK, SPALTE_LZ_HONK,
  zuordnungAus, bildListe, dateinameAus, zwillingPlan, mitBildern, stuecke, vergleicheZwilling, honkStatusText,
} from '../utils/zwilling.js';

const TAKT_MS = 2000;
const BILD_MAX_BYTES = 15 * 1024 * 1024;
const t = v => String(v ?? '').trim();
export const uhr = { pause: ms => new Promise(r => setTimeout(r, ms)) };

const fehler = (status, code, text, extra = {}) => Object.assign(new Error(text), { status, code, ...extra });

async function sheetsClient() {
  return google.sheets({ version: 'v4', auth: await getGoogleAuth() });
}

async function leseReiter(sheets, spreadsheetId, tab) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'!A1:ZZ`, valueRenderOption: 'FORMATTED_VALUE' });
  const [kopf = [], ...zeilen] = r.data.values ?? [];
  return { kopf, zeilen };
}

/** Alles, was im SSOT fuer den Zwilling gebraucht wird. */
async function leseSsot(sheets, spreadsheetId, { jfnId, ssotId }) {
  const [erf, kat, lz, varianten] = await Promise.all(['Erfassungsmaske', 'Struktur_Kategorien', 'Struktur_Lieferzeiten', 'Varianten']
    .map(tab => leseReiter(sheets, spreadsheetId, tab)));
  const fehlt = [];
  const sp = (r, name, tab) => { const i = findHeader(r.kopf, name); if (i < 0) fehlt.push(`${tab}.${name}`); return i; };
  const e = {
    id: findHeaderAny(erf.kopf, ['ID', 'SSOT-ID']), pid: sp(erf, 'Produkt-ID', 'Erfassungsmaske'),
    honk: sp(erf, SPALTE_ERF_HONK_ID, 'Erfassungsmaske'), status: sp(erf, SPALTE_ERF_HONK_STATUS, 'Erfassungsmaske'),
  };
  const k = { nr: sp(kat, 'Kategorienummer', 'Struktur_Kategorien'), honk: sp(kat, SPALTE_KAT_HONK, 'Struktur_Kategorien') };
  const l = { id: sp(lz, 'Term_ID', 'Struktur_Lieferzeiten'), honk: sp(lz, SPALTE_LZ_HONK, 'Struktur_Lieferzeiten') };
  const v = { ssot: sp(varianten, 'SSOT-ID', 'Varianten'), honk: sp(varianten, SPALTE_VAR_HONK_ID, 'Varianten') };
  if (fehlt.length) throw fehler(409, 'einrichtung', `Spalten fehlen: ${fehlt.join(', ')} – erst scripts/setup-zwilling.js --write.`);

  const zi = erf.zeilen.findIndex(z => t(z[e.id]) === t(ssotId));
  if (zi < 0) throw fehler(404, 'ssot', `Artikel-ID ${ssotId} nicht in der Erfassungsmaske.`);
  const zeile = erf.zeilen[zi];
  if (t(zeile[e.pid]) !== String(jfnId)) throw fehler(409, 'ssot', `Erfassungsmaske ${ssotId} gehört zu Produkt ${t(zeile[e.pid]) || '–'}, nicht ${jfnId}.`);
  const vorhanden = t(zeile[e.honk]);
  if (vorhanden) throw fehler(409, 'schon_da', `Zwilling in HONK! besteht schon (#${vorhanden}).`, { honkId: vorhanden });

  return {
    erf, e, sheetZeile: zi + 2,
    kategorien: zuordnungAus(kat.zeilen.map(z => ({ von: z[k.nr], nach: z[k.honk] }))),
    lieferzeiten: zuordnungAus(lz.zeilen.map(z => ({ von: z[l.id], nach: z[l.honk] }))),
    varianten, v,
  };
}

/** Bild aus JFN laden (statische Datei). HTML statt Bild = Pruefseite -> Stopp. */
async function ladeBild(b) {
  const res = await fetchMitZeitlimit(b.src, {}, { shop: 'JammiFashion', pfad: 'bild' });
  const typ = res.headers.get('content-type') ?? '';
  if (!res.ok) throw fehler(502, 'bilder', `Bild ${b.id} aus JFN nicht lesbar (Status ${res.status}).`);
  if (!/^image\//i.test(typ)) {
    if (/html/i.test(typ)) throw new HosterPruefseiteError({ shop: 'JammiFashion', pfad: 'bild', httpStatus: res.status });
    throw fehler(502, 'bilder', `Bild ${b.id}: kein Bild („${typ}“).`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > BILD_MAX_BYTES) throw fehler(502, 'bilder', `Bild ${b.id} ist größer als 15 MB.`);
  return { buffer, typ };
}

/** Alle Bilder hochladen - ganz oder gar nicht (hochgeladene bleiben bei Abbruch in der Mediathek, Liste im Fehler). */
async function ladeBilderHoch(bilder) {
  const map = new Map();
  const hochgeladen = [];
  for (const b of bilder) {
    const { buffer, typ } = await ladeBild(b);
    const titel = b.name || dateinameAus(b.src, b.id).replace(/\.[a-z]+$/i, '');
    const r = await ladeMedienHoch({ shop: 'honk', buffer, dateiname: dateinameAus(b.src, b.id), mimetype: typ, titel, alt: b.alt || undefined });
    await uhr.pause(TAKT_MS);
    if (r.fehlt) throw fehler(503, 'bilder', 'Zugang zur HONK!-Mediathek fehlt (WP_APP_PASSWORD_HONK).', { hochgeladen });
    if (!r.ok || !r.data?.id) {
      const rolle = r.status === 401 || r.status === 403;
      throw fehler(502, 'bilder', rolle
        ? `HONK! lässt keinen Bild-Upload zu (Status ${r.status}) – der MC-Benutzer braucht dort die Rolle „Redakteur“. Kein Zwilling angelegt.`
        : `Bild-Upload in HONK! gescheitert (Status ${r.status}). Kein Zwilling angelegt.`, { hochgeladen });
    }
    map.set(b.id, Number(r.data.id));
    hochgeladen.push(Number(r.data.id));
  }
  return { map, hochgeladen };
}

/** SKUs in HONK pruefen (Produkte; Variations-SKUs schuetzt WooCommerce beim Anlegen - dann Abbruch vor den Variationen). */
async function pruefeSkusFrei(wc, skus) {
  const belegt = [];
  for (const teil of stuecke(skus, 50)) {
    const { data } = await wc.get('products', { sku: teil.join(','), status: 'any', per_page: 100, _fields: 'id,sku' });
    await uhr.pause(TAKT_MS);
    for (const p of Array.isArray(data) ? data : []) belegt.push(`${p.sku} (#${p.id})`);
  }
  return belegt;
}

const laufend = new Set();

/**
 * @param {object} o
 * @param {number|string} o.jfnId
 * @param {string} o.ssotId
 * @param {object} [o.sheets]  Sheets-Client (Tests)
 * @param {object} [o.wcJfn]   WC-Client JFN (Tests)
 * @param {object} [o.wcHonk]  WC-Client HONK (Tests)
 * @param {Function} [o.bilderHochladen]  (Tests)
 */
export async function legeZwillingAn({ jfnId, ssotId, sheets, wcJfn, wcHonk, bilderHochladen = ladeBilderHoch,
  spreadsheetId = process.env.GOOGLE_SHEET_ID } = {}) {
  const id = Number(jfnId);
  if (!Number.isInteger(id) || id <= 0) throw fehler(400, 'eingabe', 'JFN-Produkt-ID fehlt.');
  if (!t(ssotId)) throw fehler(400, 'eingabe', 'Artikel-ID fehlt.');
  if (laufend.has(id)) throw fehler(409, 'laeuft_gerade', 'Zwilling wird gerade angelegt – bitte warten.');
  laufend.add(id);
  try {
    return await frischLesen(async () => {
      const s = sheets ?? await sheetsClient();
      const jfn = wcJfn ?? getWcClient('jfn');
      const honk = wcHonk ?? getWcClient('honk');

      const ssot = await leseSsot(s, spreadsheetId, { jfnId: id, ssotId });
      const { data: produkt } = await jfn.get(`products/${id}`);
      const variationen = await leseAlleVariationen(jfn, id);
      const plan = zwillingPlan({ produkt, variationen, kategorien: ssot.kategorien, lieferzeiten: ssot.lieferzeiten });
      if (plan.gruende.length) throw fehler(422, 'zuordnung', 'HONK!-Zwilling nicht angelegt: ' + plan.gruende.join(' · '), { gruende: plan.gruende });

      const belegt = await pruefeSkusFrei(honk, plan.skus);
      if (belegt.length) throw fehler(409, 'sku_vergeben', `SKU in HONK! schon vergeben: ${belegt.join(', ')} – kein Zwilling angelegt.`);

      const bilder = bildListe(produkt, variationen);
      const { map: bildMap } = await bilderHochladen(bilder);
      const fertig = mitBildern(plan, bildMap);

      let honkProdukt;
      try {
        ({ data: honkProdukt } = await honk.post('products', fertig.produkt));
      } catch (err) {
        wirfWennPruefseite(err);
        throw fehler(502, 'anlegen', `HONK!-Artikel nicht angelegt: ${err.response?.data?.message ?? err.message}`);
      }
      await uhr.pause(TAKT_MS);
      const honkId = Number(honkProdukt?.id);
      if (!honkId) throw fehler(502, 'anlegen', 'HONK! hat keine Produkt-ID zurückgegeben – bitte in HONK! nachsehen.');

      const varFehler = [];
      for (const teil of stuecke(fertig.variationen)) {
        try {
          const { data } = await honk.post(`products/${honkId}/variations/batch`, { create: teil });
          for (const c of data?.create ?? []) if (c?.error) varFehler.push(`${c.error.message ?? c.error.code}`);
        } catch (err) {
          wirfWennPruefseite(err);
          varFehler.push(err.response?.data?.message ?? err.message);
        }
        await uhr.pause(TAKT_MS);
      }

      const { data: zurueck } = await honk.get(`products/${honkId}`);
      const honkVariationen = await leseAlleVariationen(honk, honkId);
      const abweichungen = [...varFehler.map(f => `Variation: ${f}`),
        ...vergleicheZwilling({ plan: fertig, produkt: zurueck, variationen: honkVariationen, bilderErwartet: fertig.galerieAnzahl })];
      const status = honkStatusText(zurueck?.status, abweichungen);

      const ssotErgebnis = await schreibeVerknuepfung(s, spreadsheetId, { ssotId, jfnId: id, honkId, status, honkVariationen });
      return {
        honkId, status, abweichungen,
        link: adminBestellLink(getShopConfig('honk').wcUrl, honkId),
        variationen: honkVariationen.length, bilder: bildMap.size,
        ssot: ssotErgebnis,
      };
    });
  } finally {
    laufend.delete(id);
  }
}

/** HONK_Produkt_ID/HONK_Status + HONK_Variation_ID schreiben (frisch gelesen, nur leere Zellen, RAW, zurueckgelesen). */
async function schreibeVerknuepfung(sheets, spreadsheetId, { ssotId, jfnId, honkId, status, honkVariationen }) {
  const ssot = await (async () => {
    try { return await leseSsot(sheets, spreadsheetId, { jfnId, ssotId }); }
    catch (e) { if (e.code === 'schon_da') return null; throw e; }
  })();
  if (!ssot) return { geschrieben: false, hinweis: 'HONK_Produkt_ID stand inzwischen schon in der Erfassungsmaske – nichts überschrieben.' };
  const { e, v, varianten, sheetZeile } = ssot;
  const daten = [
    { range: `'Erfassungsmaske'!${colLetter(e.honk)}${sheetZeile}`, values: [[String(honkId)]] },
    { range: `'Erfassungsmaske'!${colLetter(e.status)}${sheetZeile}`, values: [[status]] },
  ];
  // Varianten der SSOT-ID: Paare aus E1/V1 … E3/V3 (Kopfzeile ueber den Namen).
  const k = varianten.kopf;
  const ach = [1, 2, 3].map(n => [findHeader(k, `E${n}`), findHeader(k, `V${n}`)]).filter(([a, b]) => a >= 0 && b >= 0);
  const zeilen = [];
  varianten.zeilen.forEach((z, i) => {
    if (t(z[v.ssot]) !== t(ssotId)) return;
    zeilen.push({ paare: ach.map(([a, b]) => [z[a], z[b]]).filter(([a]) => t(a)), wcVariationId: t(z[v.honk]), sheetZeile: i + 2 });
  });
  const zu = ordneWcIdsZu(zeilen, honkVariationen.map(x => ({ id: x.id, attributes: x.attributes })), { ssotId });
  for (const { index, id } of zu.zuordnung)
    daten.push({ range: `'Varianten'!${colLetter(v.honk)}${zeilen[index].sheetZeile}`, values: [[String(id)]] });

  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: daten } });
  const nach = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: daten.map(d => d.range) });
  const falsch = (nach.data.valueRanges ?? []).filter((r, i) => t(r.values?.[0]?.[0]) !== t(daten[i].values[0][0])).length;
  return {
    geschrieben: true, variationIds: zu.zuordnung.length, ohneZuordnung: zu.ohneTreffer + zu.mehrdeutig + zu.konflikt,
    hinweise: zu.hinweise, ...(falsch ? { hinweis: `${falsch} Zelle(n) nach dem Schreiben anders gelesen – bitte prüfen.` } : {}),
  };
}

/**
 * Stand des Zwillings fuer "Artikel ändern" - nur lesen.
 * @returns {Promise<{ honkId: string, status: string, link: string } | { honkId: '' }>}
 */
export async function leseZwilling({ jfnId, sheets, wcHonk, spreadsheetId = process.env.GOOGLE_SHEET_ID } = {}) {
  const s = sheets ?? await sheetsClient();
  const erf = await leseReiter(s, spreadsheetId, 'Erfassungsmaske');
  const pid = findHeader(erf.kopf, 'Produkt-ID');
  const honk = findHeader(erf.kopf, SPALTE_ERF_HONK_ID);
  if (pid < 0 || honk < 0) return { honkId: '', einrichtung: honk < 0 };
  const z = erf.zeilen.find(r => t(r[pid]) === String(jfnId));
  const honkId = t(z?.[honk]);
  if (!honkId) return { honkId: '' };
  let status = '';
  try {
    const { data } = await (wcHonk ?? getWcClient('honk')).get(`products/${honkId}`, { _fields: 'id,status' });
    status = data?.status ?? '';
  } catch (err) {
    wirfWennPruefseite(err);
    status = err.response?.status === 404 ? 'fehlt' : 'unbekannt';
  }
  return { honkId, status, link: adminBestellLink(getShopConfig('honk').wcUrl, honkId) };
}
