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

export async function leseTrikotAnsicht({ sheets: s } = {}) {
  const spreadsheetId = process.env.BUSINESS_SHEET_ID;
  if (!spreadsheetId) { const e = new Error('BUSINESS_SHEET_ID fehlt.'); e.status = 503; throw e; }
  const sheets = s ?? await sheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `'${TAB_TRIKOTS}'`, valueRenderOption: 'FORMATTED_VALUE',
  });
  return baueTrikotAnsicht(trikotZeilen(data.values ?? []));
}
