// Plan fuer scripts/setup-lager-reiter.js (BO5-1) - reine Logik, Test lager.test.js.
import { TAB_BUCHUNGEN, TAB_ARTIKEL, TAB_ORTE, BUCHUNG_SPALTEN, ARTIKEL_SPALTEN, ORTE_SPALTEN } from './lager.js';

export const LAGER_REITER = [
  { tab: TAB_BUCHUNGEN, spalten: BUCHUNG_SPALTEN, text: ['Buchung_ID', 'Schluessel', 'Bezug', 'Storno_von', 'Vorgang'], zeilen: 1000 },
  { tab: TAB_ARTIKEL,   spalten: ARTIKEL_SPALTEN, text: ['LA-Nr', 'Größe'], zeilen: 200 },
  { tab: TAB_ORTE,      spalten: ORTE_SPALTEN,    text: [], zeilen: 100 },
];

/**
 * @param {string[]} titel   vorhandene Reiter
 * @param {Object<string,string[]>} koepfe  Kopfzeile je vorhandenem Lager-Reiter
 * @returns {{ neu: object[], vorhanden: { tab, fehlt: string[] }[] }}
 */
export function reiterPlan(titel, koepfe = {}) {
  const da = new Set(titel ?? []);
  return {
    neu: LAGER_REITER.filter(r => !da.has(r.tab)),
    vorhanden: LAGER_REITER.filter(r => da.has(r.tab)).map(r => ({
      tab: r.tab, fehlt: r.spalten.filter(n => !(koepfe[r.tab] ?? []).map(k => String(k ?? '').trim()).includes(n)),
    })),
  };
}
