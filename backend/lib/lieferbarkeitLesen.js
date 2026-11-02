// Lieferbarkeit L-Shop lesen (BO7-2) - nur der Reiter LShop_Lieferbarkeit, fuer die Anzeige in Korb, Raster, Maske,
// Lager und LS4. Eigenes kleines Modul (ohne FTP/Drive), damit lib/lshop.js und lib/lager.js es ohne Kreis importieren.
// Fehlt der Reiter oder ist er nicht lesbar, liefert es eine leere Map: alles laeuft ohne Kennzeichen weiter.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { LIEFERBARKEIT_TAB, lieferbarkeitAusWerten } from '../utils/lshop-lieferbarkeit.js';

export const LIEFERBARKEIT_CACHE_MS = 60_000;
let _cache = null;   // { spreadsheetId, zeit, daten }
export function _lieferbarkeitCacheLeeren() { _cache = null; }

/** -> { je: Map ArticleNr -> { stufe, stock, nullSeit, auslaufdatum }, stand | null } */
export async function leseLieferbarkeit({ sheets: s, spreadsheetId = process.env.GOOGLE_SHEET_ID, jetzt = new Date() } = {}) {
  if (!spreadsheetId) return { je: new Map(), stand: null };
  if (_cache && _cache.spreadsheetId === spreadsheetId && Date.now() - _cache.zeit < LIEFERBARKEIT_CACHE_MS) return _cache.daten;
  let daten;
  try {
    const sheets = s ?? sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${LIEFERBARKEIT_TAB}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    daten = lieferbarkeitAusWerten(data.values ?? [], jetzt);
  } catch (err) {
    // Reiter fehlt (400 "Unable to parse range") oder Sheets wackelt: ohne Kennzeichen weiter, nicht zwischenspeichern.
    console.warn(`Lieferbarkeit nicht lesbar (${err?.code ?? err?.status ?? 'Fehler'}) - Anzeige ohne Kennzeichen.`);
    return { je: new Map(), stand: null };
  }
  _cache = { spreadsheetId, zeit: Date.now(), daten };
  return daten;
}
