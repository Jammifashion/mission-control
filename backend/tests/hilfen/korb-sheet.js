// Gemeinsame Testhilfen fuer den L-Shop-Warenkorb (BO2/BO3): In-Memory-Sheet, Testdaten, WC-Attrappe.
// Kein Test - jest laeuft nur *.test.js.

import { jest } from '@jest/globals';
import { KORB_SPALTEN, TAB_KORB } from '../../utils/korb-logic.js';

// ── In-Memory-Sheet ──────────────────────────────────────────────────────────
const colNr = s => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
function bereich(range) {
  const [tabRoh, a1] = String(range).split('!');
  const tab = tabRoh.replace(/^'|'$/g, '');
  if (!a1) return { tab };
  let m = a1.match(/^(\d+):(\d+)$/);
  if (m) return { tab, r0: +m[1] - 1, r1: +m[2] - 1 };
  m = a1.match(/^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/);
  return { tab, c0: colNr(m[1]), r0: m[2] ? +m[2] - 1 : 0, c1: m[3] ? colNr(m[3]) : colNr(m[1]), r1: m[4] ? +m[4] - 1 : (m[3] && !m[4] ? Infinity : +m[2] - 1) };
}
function lese(tabs, range) {
  const b = bereich(range);
  const t = tabs[b.tab];
  if (!t) { const e = new Error(`Unable to parse range: ${range}`); e.code = 400; throw e; }
  if (b.r0 === undefined) return t.map(z => [...z]);
  const bis = Math.min(b.r1, t.length - 1);
  const out = [];
  for (let r = b.r0; r <= bis; r++) {
    const z = t[r] ?? [];
    out.push(b.c0 === undefined ? [...z] : z.slice(b.c0, b.c1 + 1));
  }
  while (out.length && !out.at(-1).some(x => String(x ?? '') !== '')) out.pop();
  return out.map(z => { const k = [...z]; while (k.length && String(k.at(-1) ?? '') === '') k.pop(); return k; });
}
export function machSheets(tabs, raster = {}) {
  const aufrufe = { append: 0, update: [], batchUpdate: [], struktur: [] };
  const values = {
    get: async ({ range }) => ({ data: { values: lese(tabs, range) } }),
    batchGet: async ({ ranges, majorDimension }) => ({ data: { valueRanges: ranges.map(r => {
      const zeilen = lese(tabs, r);
      if (majorDimension !== 'COLUMNS') return { values: zeilen };
      return { values: [zeilen.map(z => z[0] ?? '')] };
    }) } }),
    append: async () => { aufrufe.append++; return {}; },
    update: async ({ range, requestBody }) => {
      aufrufe.update.push(range);
      const b = bereich(range);
      requestBody.values.forEach((z, i) => {
        const t = tabs[b.tab];
        while (t.length <= b.r0 + i) t.push([]);
        z.forEach((w, j) => { t[b.r0 + i][b.c0 + j] = w; });
      });
      return {};
    },
    batchUpdate: async ({ requestBody }) => {
      requestBody.data.forEach(d => {
        aufrufe.batchUpdate.push(d.range);
        const b = bereich(d.range);
        const t = tabs[b.tab];
        while (t.length <= b.r0) t.push([]);
        t[b.r0][b.c0] = d.values[0][0];
      });
      return {};
    },
  };
  const spreadsheets = {
    values,
    get: async () => ({ data: { sheets: Object.keys(tabs).map((title, i) => ({ properties: { title, sheetId: i, gridProperties: { rowCount: raster[title] ?? 1000 } } })) } }),
    batchUpdate: async ({ requestBody }) => { aufrufe.struktur.push(requestBody.requests); return {}; },
  };
  return { sheets: { spreadsheets }, aufrufe };
}

// ── Testdaten ────────────────────────────────────────────────────────────────
export const NR = '1000326843';
export const NR2 = '1000326842';
export const NR_AUS = '1000999999';   // in LShop_Modelle ausgelaufen
export const NR_INAKTIV = '1000888888';
export function grundTabs({ mitKorb = true } = {}) {
  return {
    Varianten: [
      ['SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'Preis', 'Aktiv', 'WC_Variation_ID', 'Google_Farbe', 'LShop_ArticleNr'],
      ['0001', '1', 'Farbe', 'Deep Black', 'Größe', '2XL', '', '', '', 'TRUE', '501', '', NR],
      ['0001', '2', 'Farbe', 'Deep Black', 'Größe', 'XL', '', '', '', 'TRUE', '502', '', NR2],
      ['0001', '3', 'Farbe', 'Navy', 'Größe', 'M', '', '', '', 'TRUE', '503', '', NR_AUS],
      ['0001', '4', 'Farbe', 'Navy', 'Größe', 'L', '', '', '', 'FALSE', '504', '', NR_INAKTIV],
      ['0002', '1', 'Farbe', 'Weiß', '', '', '', '', '', 'TRUE', '601', '', ''],
      ['0003', '1', 'Farbe', 'Rot', '', '', '', '', '', 'TRUE', '', '', NR],
    ],
    Erfassungsmaske: [['ID', 'Produkt-ID', 'Produktname', 'Artikelnummer'],
      ['0001', '100', 'Ugly Sweater', 'JH030F/US'], ['0002', '200', 'Tasse', 'T1/Tasse'], ['0003', '', 'Ugly Entwurf', 'JH030F/UE']],
    LShop_Modelle: [
      ['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Discontinued', 'Status'],
      [NR, 'JH030F', 'Deep Black', '', 'XXL', '', '', '0', 'aktiv'],
      [NR2, 'JH030F', 'Deep Black', '', 'XL', '', '', '0', 'aktiv'],
      [NR_AUS, 'JH030F', 'Navy', '', 'M', '', '', '0', 'ausgelaufen'],
      [NR_INAKTIV, 'JH030F', 'Navy', '', 'L', '', '', '0', 'aktiv'],
    ],
    SKU_Extern: [['ArticleNr', 'CatalogNr', 'Artikel_WC_IDs'], ['x', 'EXT1', '700']],
    Trikot_Artikel: [['Artikelnummer', 'Produkt-ID', 'Produktname', 'Aktiv'], ['', '900', '', 'TRUE']],
    ...(mitKorb ? { [TAB_KORB]: [KORB_SPALTEN] } : {}),
  };
}
export const pos = (id, product_id, variation_id, quantity = 1, sku = 'JH030F/US') => ({ id, product_id, variation_id, quantity, sku });
export const bestellung = (id, status, items) => ({ id, status, line_items: items });

export function machWc(orders, { produkte, alle = [] } = {}) {
  const get = jest.fn(async (pfad, q) => {
    if (pfad === 'products') {
      const ids = q.include.split(',');
      return { data: (produkte ?? ids.map(id => ({ id: +id, type: 'variable', meta_data: [] }))).filter(p => ids.includes(String(p.id))) };
    }
    if (q.include) return { data: alle.filter(o => q.include.split(',').includes(String(o.id))) };
    return { data: q.page === 1 ? orders.filter(o => o.status === q.status) : [] };
  });
  return { get };
}

