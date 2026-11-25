// In-Memory-Attrappe fuer die Google-Sheets-API (values.get/update/batchGet/batchUpdate/append,
// spreadsheets.get/batchUpdate). Bereiche werden wirklich aufgeloest (A1-Schreibweise), Schreiben
// veraendert `tabs` - so pruefen Tests den Schreibweg ohne values.append (Zielzeile, Ruecklesen).
import { jest } from '@jest/globals';

const spalteZuIndex = s => [...s].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

export function bereichAus(range) {
  const m = /^(?:'([^']+)'|([^!]+?))(?:!(.*))?$/.exec(String(range));
  const tab = m[1] ?? m[2];
  const b = m[3];
  if (!b) return { tab, r1: 1, r2: Infinity, c1: 0, c2: Infinity };
  const z = /^([A-Z]+)?(\d+)?(?::([A-Z]+)?(\d+)?)?$/.exec(b);
  const [, cA, rA, cB, rB] = z;
  const einzeln = !b.includes(':');
  return {
    tab,
    c1: cA ? spalteZuIndex(cA) : 0,
    r1: rA ? Number(rA) : 1,
    c2: einzeln ? (cA ? spalteZuIndex(cA) : Infinity) : (cB ? spalteZuIndex(cB) : Infinity),
    r2: einzeln ? (rA ? Number(rA) : Infinity) : (rB ? Number(rB) : Infinity),
  };
}

const kopie = rows => rows.map(r => [...(r ?? [])]);

// raster: { <Reiter>: Spaltenzahl } - Schreiben hinter das Raster wirft wie Google ("exceeds grid limits");
// appendDimension COLUMNS ueber spreadsheets.batchUpdate verbreitert es.
export function sheetsAttrappe(tabsRef, raster = {}) {
  const tabs = () => tabsRef();
  const lies = range => {
    const { tab, r1, r2, c1, c2 } = bereichAus(range);
    const daten = tabs()[tab] ?? [];
    const zeilen = daten.slice(r1 - 1, r2 === Infinity ? undefined : r2).map(r => (r ?? []).slice(c1, c2 === Infinity ? undefined : c2 + 1));
    // wie Sheets: leere Zeilen/Zellen am Ende fallen weg
    const ohneEnde = kopie(zeilen).map(r => { while (r.length && (r[r.length - 1] === '' || r[r.length - 1] === undefined)) r.pop(); return r; });
    while (ohneEnde.length && !ohneEnde[ohneEnde.length - 1].length) ohneEnde.pop();
    return ohneEnde;
  };
  const schreib = (range, values) => {
    const { tab, r1, c1 } = bereichAus(range);
    const breit = Math.max(0, ...values.map(z => z.length));
    if (raster[tab] !== undefined && c1 + breit > raster[tab])
      throw Object.assign(new Error(`Range (${range}) exceeds grid limits. Max columns: ${raster[tab]}`), { code: 400 });
    const t = tabs();
    if (!t[tab]) t[tab] = [];
    values.forEach((zeile, i) => {
      const ziel = (t[tab][r1 - 1 + i] ??= []);
      zeile.forEach((w, j) => { while (ziel.length < c1 + j) ziel.push(''); ziel[c1 + j] = w; });
    });
    for (let i = 0; i < t[tab].length; i++) t[tab][i] ??= [];
  };
  const values = {
    get: jest.fn(async ({ range }) => ({ data: { values: lies(range) } })),
    // DT1: majorDimension COLUMNS (leseReiterSpalten) wie Google - Spalten statt Zeilen
    batchGet: jest.fn(async ({ ranges, majorDimension }) => ({ data: { valueRanges: ranges.map(r => {
      const z = lies(r);
      if (majorDimension !== 'COLUMNS') return { range: r, values: z };
      const breite = Math.max(0, ...z.map(x => x.length));
      return { range: r, values: Array.from({ length: breite }, (_, j) => z.map(x => x[j] ?? '')) };
    }) } })),
    update: jest.fn(async ({ range, requestBody }) => { schreib(range, requestBody.values); return { data: {} }; }),
    batchUpdate: jest.fn(async ({ requestBody }) => { for (const d of requestBody.data) schreib(d.range, d.values); return { data: {} }; }),
    append: jest.fn(async ({ range, requestBody }) => {
      const { tab } = bereichAus(range);
      const t = tabs(); (t[tab] ??= []).push(...kopie(requestBody.values)); return { data: {} };
    }),
  };
  const spreadsheets = {
    values,
    get: jest.fn(async () => ({ data: { sheets: Object.keys(tabs()).map((title, i) => ({ properties: { title, sheetId: i + 1,
      gridProperties: { rowCount: 10000, ...(raster[title] !== undefined ? { columnCount: raster[title] } : {}) } } })) } })),
    batchUpdate: jest.fn(async ({ requestBody }) => {
      const namen = Object.keys(tabs());
      for (const q of requestBody?.requests ?? []) {
        const a = q.appendDimension;
        if (a?.dimension === 'COLUMNS') { const tab = namen[a.sheetId - 1]; if (raster[tab] !== undefined) raster[tab] += a.length; }
      }
      return { data: {} };
    }),
  };
  return { spreadsheets };
}

/** Zeilen (ab Zeile 2), die per values.update/batchUpdate in einen Reiter geschrieben wurden - in Aufrufreihenfolge. */
export function neueZeilen(attrappe, tab) {
  const v = attrappe.spreadsheets.values;
  const aufrufe = [
    ...v.update.mock.calls.map(([a]) => ({ range: a.range, values: a.requestBody.values })),
    ...v.batchUpdate.mock.calls.flatMap(([a]) => a.requestBody.data),
  ];
  return aufrufe.filter(a => { const b = bereichAus(a.range); return b.tab === tab && b.r1 > 1 && b.c1 === 0; })
    .flatMap(a => a.values);
}

/** Kalkulation_Fixkosten mit allen Positionen ab 01.01.2020 (erfundene Werte, MwSt 19). */
export const FIXKOSTEN_VOLL = [
  ['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis'],
  ['Herstellungsnebenkosten', '0', 'EUR', '01.01.2020', ''],
  ['Versandnebenkosten B', '0', 'EUR', '01.01.2020', ''],
  ['Versandnebenkosten P', '0', 'EUR', '01.01.2020', ''],
  ['Porto B', '0', 'EUR', '01.01.2020', ''],
  ['Porto P', '0', 'EUR', '01.01.2020', ''],
  ['PayPal Prozent', '0', '%', '01.01.2020', ''],
  ['PayPal Pauschale', '0', 'EUR', '01.01.2020', ''],
  ['MwSt', '19', '%', '01.01.2020', ''],
];
