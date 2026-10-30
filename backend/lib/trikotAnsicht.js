// Trikot-Ansicht (TR2) - Ein-/Ausgabe fuer GET /api/bestellen/trikots, Logik in utils/trikot-ansicht.js.
// NUR LESEN, nur der Reiter "Trikots" im Business-Sheet (kein Shop, kein Schreiben). Trikots gibt es
// nur im JFN-Shop, der Shop-Parameter spielt keine Rolle. Die Spalte "Kunde" verlaesst das Backend nie.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { TAB_TRIKOTS, trikotZeilen, baueTrikotAnsicht } from '../utils/trikot-ansicht.js';

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}

// TR5: kurzer Zwischenspeicher, weil auch "Bestellungen (JFN)" den Stand je Bestellung liest. Die MC-Schreibwege
// (TR3 Eintragen, TR4 Wareneingang) leeren ihn; Aenderungen von Hand im Sheet sind nach hoechstens CACHE_MS sichtbar.
export const CACHE_MS = 60 * 1000;
let cache = { bis: 0, daten: null };
export const trikotAnsichtCacheLeeren = () => { cache = { bis: 0, daten: null }; };

export async function leseTrikotAnsicht({ sheets: s, jetzt = Date.now() } = {}) {
  const spreadsheetId = process.env.BUSINESS_SHEET_ID;
  if (!spreadsheetId) { const e = new Error('BUSINESS_SHEET_ID fehlt.'); e.status = 503; throw e; }
  if (!s && cache.daten && jetzt < cache.bis) return cache.daten;
  const sheets = s ?? await sheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `'${TAB_TRIKOTS}'`, valueRenderOption: 'FORMATTED_VALUE',
  });
  const daten = baueTrikotAnsicht(trikotZeilen(data.values ?? []));
  if (!s) cache = { bis: jetzt + CACHE_MS, daten };
  return daten;
}
