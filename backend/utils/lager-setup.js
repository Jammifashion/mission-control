// Plan fuer scripts/setup-lager-reiter.js (BO5-1) - reine Logik, Test lager.test.js.
import { TAB_BUCHUNGEN, TAB_ARTIKEL, TAB_ORTE, TAB_EVENTS, BUCHUNG_SPALTEN, ARTIKEL_SPALTEN, ORTE_SPALTEN, EVENT_SPALTEN } from './lager.js';

export const LAGER_REITER = [
  { tab: TAB_BUCHUNGEN, spalten: BUCHUNG_SPALTEN, text: ['Buchung_ID', 'Schluessel', 'Bezug', 'Storno_von', 'Vorgang'], zeilen: 1000 },
  { tab: TAB_ARTIKEL,   spalten: ARTIKEL_SPALTEN, text: ['LA-Nr', 'Größe'], zeilen: 200 },
  { tab: TAB_ORTE,      spalten: ORTE_SPALTEN,    text: [], zeilen: 100 },
  // BO5-5: Events fuer "Verkauf vor Ort" (Datum als Text JJJJ-MM-TT, sonst macht Sheets ein Datum daraus)
  { tab: TAB_EVENTS,    spalten: EVENT_SPALTEN,   text: ['Event_ID', 'Datum'], zeilen: 200 },
];

/**
 * BO5-5: fehlende Lagerorte (z. B. Wrist, Itzehoe) - nur Namen, die es (ohne Gross/Klein) noch nicht gibt.
 * @returns {string[]} anzulegende Orte
 */
export function orteFehlend(vorhanden, gewuenscht) {
  const da = new Set((vorhanden ?? []).map(o => String(o ?? '').trim().toLowerCase()));
  return [...new Set((gewuenscht ?? []).map(o => String(o ?? '').trim()).filter(Boolean))].filter(o => !da.has(o.toLowerCase()));
}

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
