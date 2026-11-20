// Schreib-Attrappe fuer lib/sheet-zeilen.js schreibeNeueZeilen (NB2: Portal-Eigenauftrag ohne values.append).
// Haengt sich vor eine vorhandene get-Attrappe (jest.fn mit Bereichs-Logik der Tests): ganze-Reiter- und Umgebungs-
// Lesungen des Reiters gehen an dieselbe get-Attrappe (als "Reiter!A:Z"), geschriebene Bereiche liest sie zurueck.
import { jest } from '@jest/globals';

export function schreibAttrappe(getMock, tab = 'Partner_Interne_Bestellungen') {
  const geschrieben = new Map();
  const ganz = async () => ((await getMock({ range: `${tab}!A:Z` }))?.data?.values ?? []);
  const values = {
    get: jest.fn(async arg => {
      const { range } = arg;
      if (geschrieben.has(range)) return { data: { values: geschrieben.get(range) } };
      if (range === `'${tab}'`) return { data: { values: await ganz() } };
      const m = new RegExp(`^'${tab}'!A(\\d+):`).exec(range);
      if (m) return { data: { values: (await ganz()).slice(Number(m[1]) - 1) } };
      return getMock(arg);
    }),
    update: jest.fn(async ({ range, requestBody }) => { geschrieben.set(range, requestBody.values); return { data: {} }; }),
  };
  const spreadsheets = {
    get: jest.fn(async () => ({ data: { sheets: [{ properties: { title: tab, sheetId: 7, gridProperties: { rowCount: 1000 } } }] } })),
    batchUpdate: jest.fn(async () => ({ data: {} })),
  };
  /** Zeilen, die in den Reiter geschrieben wurden (fuer Erwartungen statt append). */
  const zeilen = () => [...geschrieben.entries()].filter(([r]) => r.startsWith(`'${tab}'!`)).flatMap(([, v]) => v);
  return { values, spreadsheets, geschrieben, zeilen };
}
