// WC_Variation_ID zurueckschreiben (Befehl VR2) - reine Zuordnungslogik, eine Quelle.
//
// Neue WooCommerce-Variation -> Varianten-Zeile NUR ueber die Attributkombination,
// nie ueber die Position (Anlagepfad ordnete frueher ueber den Index zu).
// Schluessel wie VR1 (utils/varianten-zeilen.js variantenSchluessel: Menge der Paare
// Achse=Wert, reihenfolgeunabhaengig, trim, klein, ß=ss) - hier zusaetzlich mit
// Umlaut-Faltung ä/ö/ü -> ae/oe/ue, damit "Größe" und "Groesse" dieselbe Achse
// sind (Auftrag VR2). VR1 selbst bleibt unveraendert.
//
// Regeln:
//  - nur LEERE WC_Variation_ID fuellen; vorhandene gleiche ID = "schon gefuellt";
//    vorhandene ABWEICHENDE ID = Konflikt, nichts schreiben, Hinweis.
//  - passt eine WC-Variation auf 0 oder mehr als 1 Zeile: nichts schreiben, Hinweis.
//  - passen MEHRERE WC-Variationen auf dieselbe Zeile (Dubletten im Shop): die Zeile
//    ist mehrdeutig, keine dieser Variationen wird geschrieben, Hinweis (Befund VR2
//    Stufe 2, JFN-2026-0089). Zaehler getrennt: mehrdeutigShop (Variation -> n
//    Zeilen, je Variation), mehrdeutigZeile (Zeile -> n Variationen, je Zeile);
//    mehrdeutig = alle nicht geschriebenen Variationen beider Richtungen.
//  - eine ID, die schon an einer anderen Zeile steht, wird nicht doppelt vergeben.
//
// Nutzer: Frontend (Anlage- und Aenderungspfad, Spiegel-Block "WC-IDs: Anfang/Ende"
// in frontend/index.html, gleiche Faelle in backend/tests/wc-variation-ids.test.js)
// und backend/scripts/fill-wc-variation-ids.js.

import { variantenSchluessel } from '../utils/varianten-zeilen.js';
import { requireHeader } from '../utils/sheet-headers.js';
import { colLetter } from '../utils/sheet-spalten.js';

const falte = s => String(s ?? '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');

/** Schluessel einer Attributkombination aus [[achse, wert], ...]. */
export function wcSchluessel(paare) {
  return variantenSchluessel((paare ?? []).map(([e, v]) => [falte(e), falte(v)]));
}

/** WooCommerce-Attribute [{ name, option }] -> Paare. */
export const paareAusWc = attributes => (attributes ?? []).map(a => [a?.name, a?.option]);

const lesbar = paare => (paare ?? []).filter(([e]) => String(e ?? '').trim())
  .map(([e, w]) => `${String(e).trim()}=${String(w ?? '').trim()}`).join(', ') || '(ohne Achsen)';

/**
 * @param {object[]} zeilen  Varianten-Zeilen [{ paare: [[e, v], ...], wcVariationId, sheetZeile? }]
 * @param {object[]} wcVariationen  [{ id, attributes: [{ name, option }], error? }]
 * @param {object}  [o]
 * @param {string}  [o.ssotId]  nur fuer die Hinweistexte
 * @returns {{ zuordnung: {index: number, id: string}[], schonGefuellt: number,
 *             ohneTreffer: number, mehrdeutig: number, mehrdeutigShop: number,
 *             mehrdeutigZeile: number, konflikt: number,
 *             fehlerWc: number, hinweise: string[] }}
 */
export function ordneWcIdsZu(zeilen, wcVariationen, { ssotId = '' } = {}) {
  const liste = Array.isArray(zeilen) ? zeilen : [];
  const schluessel = liste.map(z => wcSchluessel(z.paare));
  const vergebene = new Set(liste.map(z => String(z.wcVariationId ?? '').trim()).filter(Boolean));
  const vor = ssotId ? `${ssotId}: ` : '';
  const r = { zuordnung: [], schonGefuellt: 0, ohneTreffer: 0, mehrdeutig: 0, mehrdeutigShop: 0, mehrdeutigZeile: 0, konflikt: 0, fehlerWc: 0, hinweise: [], details: [] };

  // Erst alle Treffer sammeln: nur so faellt auf, wenn mehrere Variationen auf dieselbe Zeile zeigen.
  const kandidaten = [];
  const jeZeile = new Map();   // Zeilenindex -> IDs der Variationen mit genau diesem einen Treffer
  for (const w of wcVariationen ?? []) {
    const id = String(w?.id ?? '').trim();
    if (!id || id === '0' || w?.error) { r.fehlerWc++; r.details.push({ id, ergebnis: 'fehler' }); continue; }   // WC-Batch: Fehler = { id: 0, error }
    const paare = paareAusWc(w.attributes);
    const k = wcSchluessel(paare);
    const treffer = schluessel.map((s, i) => (s === k ? i : -1)).filter(i => i >= 0);
    kandidaten.push({ id, paare, treffer });
    if (treffer.length === 1) jeZeile.set(treffer[0], [...(jeZeile.get(treffer[0]) ?? []), id]);
  }
  for (const [i, ids] of jeZeile) {
    if (ids.length < 2) continue;
    r.mehrdeutigZeile++;
    const nr = liste[i].sheetZeile ? `Zeile ${liste[i].sheetZeile} ` : '';
    r.hinweise.push(`${vor}${nr}(${lesbar(liste[i].paare)}): ${ids.length} Shop-Variationen (${ids.join(', ')}) – nicht geschrieben.`);
  }

  for (const { id, paare, treffer } of kandidaten) {
    if (!treffer.length) { r.ohneTreffer++; r.details.push({ id, kombination: lesbar(paare), ergebnis: 'ohne Treffer' }); r.hinweise.push(`${vor}Variation ${id} (${lesbar(paare)}) passt auf keine Varianten-Zeile – nicht geschrieben.`); continue; }
    if (treffer.length > 1) { r.mehrdeutig++; r.mehrdeutigShop++; r.details.push({ id, kombination: lesbar(paare), ergebnis: 'mehrdeutig' }); r.hinweise.push(`${vor}Variation ${id} (${lesbar(paare)}) passt auf ${treffer.length} Zeilen – nicht geschrieben.`); continue; }
    const i = treffer[0];
    if (jeZeile.get(i).length > 1) { r.mehrdeutig++; r.details.push({ id, kombination: lesbar(paare), ergebnis: 'mehrdeutig', index: i }); continue; }
    const alt = String(liste[i].wcVariationId ?? '').trim();
    if (alt === id) { r.schonGefuellt++; r.details.push({ id, kombination: lesbar(paare), ergebnis: 'schon gefuellt', index: i }); continue; }
    if (alt) { r.konflikt++; r.details.push({ id, kombination: lesbar(paare), ergebnis: 'konflikt', index: i, alt }); r.hinweise.push(`${vor}${lesbar(liste[i].paare)} hat schon WC_Variation_ID ${alt}, Shop meldet ${id} – nicht überschrieben.`); continue; }
    if (vergebene.has(id)) { r.konflikt++; r.details.push({ id, kombination: lesbar(paare), ergebnis: 'konflikt', index: i, alt: '(ID an anderer Zeile)' }); r.hinweise.push(`${vor}Variation ${id} steht schon an einer anderen Zeile – nicht doppelt vergeben.`); continue; }
    vergebene.add(id);
    r.zuordnung.push({ index: i, id });
    r.details.push({ id, kombination: lesbar(paare), ergebnis: 'zuordenbar', index: i });
  }
  return r;
}

/** Toast-Text (Regel 7). */
export function wcIdsMeldung(r) {
  const ohne = r.ohneTreffer + r.mehrdeutig + r.konflikt;
  return `${r.zuordnung.length} Variations-IDs zurückgeschrieben, ${ohne} ohne Zuordnung`;
}

/** WooCommerce-Attribute auf { name, option } kuerzen (Antwort an das Frontend). */
export const wcAttributePaare = attributes =>
  (Array.isArray(attributes) ? attributes : []).map(a => ({ name: String(a?.name ?? ''), option: String(a?.option ?? '') }));

// ── Sperre gegen doppelte Variationen (Befehl VR3) ───────────────────────────
// Vor jedem create: die Variationen des Produkts im Shop lesen (alle Seiten) und
// neue Kombinationen ueber wcSchluessel dagegen pruefen. Befund VR2 Stufe 3: der
// Speichern-Pfad legte jede Variante ohne id an - nach Wegfall einer Achse
// entstand bei 20996 ein zweiter Satz. Kein stiller Rueckfall: ist die Liste
// nicht lesbar, wirft leseAlleVariationen, und der Aufrufer legt nichts an.

/**
 * Alle Variationen eines Produkts (per_page 100, alle Seiten). Wirft bei jedem Fehler.
 * @returns {Promise<object[]>} WooCommerce-Variationen (volle Objekte)
 */
export async function leseAlleVariationen(wc, productId) {
  const alle = [];
  for (let page = 1; ; page++) {
    const { data } = await wc.get(`products/${productId}/variations`, { per_page: 100, page });
    if (!Array.isArray(data)) throw new Error(`Antwort ohne Liste (Seite ${page})`);
    alle.push(...data);
    if (data.length < 100) return alle;
  }
}

/**
 * Teilt neue Variationen [{ attributes: [{ name, option }] }] gegen den Shop-Stand auf.
 * @returns {{ anlegen: number[], vorhanden: {index: number, kombination: string, id: number, attributes: object[]}[],
 *             doppelt: {index: number, kombination: string}[] }}
 *   anlegen = Indizes in `neu`, die angelegt werden duerfen; vorhanden = Kombination gibt es
 *   im Shop schon (mit deren id); doppelt = Kombination kommt im Request mehrfach vor (nur
 *   die erste wird angelegt).
 */
export function sperreDoppelte(neu, bestehend) {
  const imShop = new Map();
  for (const b of bestehend ?? []) {
    const k = wcSchluessel(paareAusWc(b?.attributes));
    if (!imShop.has(k)) imShop.set(k, b);
  }
  const gesehen = new Set();
  const r = { anlegen: [], vorhanden: [], doppelt: [] };
  (neu ?? []).forEach((v, index) => {
    const paare = paareAusWc(v?.attributes);
    const k = wcSchluessel(paare);
    const b = imShop.get(k);
    if (b) { r.vorhanden.push({ index, kombination: lesbar(paare), id: b.id, attributes: wcAttributePaare(b.attributes) }); return; }
    if (gesehen.has(k)) { r.doppelt.push({ index, kombination: lesbar(paare) }); return; }
    gesehen.add(k);
    r.anlegen.push(index);
  });
  return r;
}

/** Hinweistext zur Sperre fuer die Antwort (null, wenn nichts zu melden). */
export function sperreHinweis(s) {
  const teile = [];
  if (s.vorhanden.length) teile.push(`${s.vorhanden.length === 1 ? '1 Variante existierte' : `${s.vorhanden.length} Varianten existierten`} bereits – nicht doppelt angelegt (${s.vorhanden.map(v => v.kombination).join('; ')}).`);
  if (s.doppelt.length) teile.push(`${s.doppelt.length === 1 ? '1 Variante stand' : `${s.doppelt.length} Varianten standen`} doppelt in der Anfrage – nur einmal angelegt (${s.doppelt.map(v => v.kombination).join('; ')}).`);
  return teile.join(' ') || null;
}

// ── Nachtrag fuer den Bestand (Teil B, scripts/fill-wc-variation-ids.js) ─────
// Liest Varianten + Erfassungsmaske (SSOT-ID -> Produkt-ID) und je SSOT-ID die
// Shop-Variationen (nur GET), ordnet mit ordneWcIdsZu zu. Schreiben nur mit
// schreibeNachtrag: je zugeordnete Zeile NUR die Zelle WC_Variation_ID, und nur,
// wenn sie beim erneuten Lesen noch leer ist und die Zeile noch dieselbe
// SSOT-ID und Kombination traegt. Alle anderen Zellen bleiben unberuehrt.


const TAB_V = 'Varianten';
const TAB_E = 'Erfassungsmaske';
const ACHSEN_NAMEN = [['E1', 'V1'], ['E2', 'V2'], ['E3', 'V3']];

async function leseTab(sheets, spreadsheetId, tab) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const [header = [], ...rows] = data.values ?? [];
  return { header: header.map(h => String(h ?? '')), rows };
}

function variantenIndex(header) {
  const ctx = `Reiter "${TAB_V}"`;
  return {
    ssot: requireHeader(header, 'SSOT-ID', ctx),
    wc:   requireHeader(header, 'WC_Variation_ID', ctx),
    achsen: ACHSEN_NAMEN.map(([e, v]) => [requireHeader(header, e, ctx), requireHeader(header, v, ctx)]),
  };
}
const zeilenPaare = (r, idx) => idx.achsen.map(([e, v]) => [r[e], r[v]]);

/**
 * @param {object} o
 * @param {object} o.sheets  Sheets-Client
 * @param {object} o.wc      WooCommerce-Client (nur get)
 * @param {string} [o.spreadsheetId]
 * @param {string|null} [o.nurSsot]  Filter auf eine SSOT-ID
 * @param {() => Promise<void>} [o.drossel]  vor jedem WC-GET (1 Req/s)
 */
export async function planeNachtrag({ sheets, wc, spreadsheetId = process.env.GOOGLE_SHEET_ID, nurSsot = null, drossel = async () => {} }) {
  const V = await leseTab(sheets, spreadsheetId, TAB_V);
  const E = await leseTab(sheets, spreadsheetId, TAB_E);
  const idx = variantenIndex(V.header);
  const eId = requireHeader(E.header, 'ID', `Reiter "${TAB_E}"`), ePid = requireHeader(E.header, 'Produkt-ID', `Reiter "${TAB_E}"`);
  const pidVon = new Map();
  for (const r of E.rows) { const s = String(r[eId] ?? '').trim(), p = String(r[ePid] ?? '').trim(); if (s && p) pidVon.set(s, p); }

  const jeSsot = new Map();
  V.rows.forEach((r, i) => {
    const s = String(r[idx.ssot] ?? '').trim();
    if (!s || (nurSsot && s !== nurSsot)) return;
    if (!jeSsot.has(s)) jeSsot.set(s, []);
    jeSsot.get(s).push({ sheetZeile: i + 2, paare: zeilenPaare(r, idx), wcVariationId: r[idx.wc] ?? '' });
  });

  let anfragen = 0;
  const plaene = [];
  for (const [ssot, zeilen] of jeSsot) {
    const pid = pidVon.get(ssot) ?? '';
    if (!pid) { plaene.push({ ssot, pid: '', zeilen, fehlt: 'ohne Produkt-ID' }); continue; }
    const variationen = [];
    try {
      for (let page = 1; ; page++) {
        await drossel(); anfragen++;
        const { data } = await wc.get(`products/${pid}/variations`, { per_page: 100, page, _fields: 'id,attributes' });
        const liste = Array.isArray(data) ? data : [];
        variationen.push(...liste.map(v => ({ id: v.id, attributes: wcAttributePaare(v.attributes) })));
        if (liste.length < 100) break;
      }
    } catch (err) {
      plaene.push({ ssot, pid, zeilen, fehlt: `Shop nicht lesbar (${err?.response?.status ?? err.message})` });
      continue;
    }
    plaene.push({ ssot, pid, zeilen, shopVariationen: variationen.length, r: ordneWcIdsZu(zeilen, variationen, { ssotId: ssot }) });
  }
  return { header: V.header, plaene, anfragen };
}

/**
 * Schreibt die zugeordneten IDs (nur mit --write). Liest den Reiter neu und
 * prueft je Zeile SSOT-ID, Kombination und leere Zelle.
 * @returns {Promise<{ geschrieben: number, uebersprungen: string[] }>}
 */
export async function schreibeNachtrag({ sheets, spreadsheetId = process.env.GOOGLE_SHEET_ID, plaene }) {
  const V = await leseTab(sheets, spreadsheetId, TAB_V);
  const idx = variantenIndex(V.header);
  const spalte = colLetter(idx.wc);
  const data = [];
  const uebersprungen = [];
  for (const p of plaene) {
    for (const { index, id } of p.r?.zuordnung ?? []) {
      const soll = p.zeilen[index];
      const ist = V.rows[soll.sheetZeile - 2] ?? [];
      const gleich = String(ist[idx.ssot] ?? '').trim() === p.ssot
        && wcSchluessel(zeilenPaare(ist, idx)) === wcSchluessel(soll.paare);
      if (!gleich) { uebersprungen.push(`${p.ssot} Zeile ${soll.sheetZeile}: Zeile hat sich geaendert`); continue; }
      if (String(ist[idx.wc] ?? '').trim()) { uebersprungen.push(`${p.ssot} Zeile ${soll.sheetZeile}: WC_Variation_ID inzwischen gefuellt`); continue; }
      data.push({ range: `'${TAB_V}'!${spalte}${soll.sheetZeile}`, values: [[/^\d+$/.test(id) ? Number(id) : id]] });
    }
  }
  if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  return { geschrieben: data.length, uebersprungen };
}

/** Zaehler je SSOT-ID fuer Bericht/Konsole (keine Preise). */
export function nachtragZaehler(p) {
  const r = p.r;
  const leerVorher = p.zeilen.filter(z => !String(z.wcVariationId ?? '').trim()).length;
  return {
    ssot: p.ssot, pid: p.pid, zeilen: p.zeilen.length, shopVariationen: p.shopVariationen ?? '',
    zuordenbar: r?.zuordnung.length ?? 0, schonGefuellt: r?.schonGefuellt ?? 0, ohneTreffer: r?.ohneTreffer ?? 0,
    mehrdeutig: r?.mehrdeutig ?? 0, mehrdeutigShop: r?.mehrdeutigShop ?? 0, mehrdeutigZeile: r?.mehrdeutigZeile ?? 0, konflikt: r?.konflikt ?? 0, leerVorher,
    leerDanach: leerVorher - (r?.zuordnung.length ?? 0), fehlt: p.fehlt ?? '',
  };
}
