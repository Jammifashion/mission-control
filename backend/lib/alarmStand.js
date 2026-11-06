// AL2: Stand der Shop-Zeitueberschreitungen im SSOT-Reiter `Alarm_Stand` (Schluessel | Letzte_Zeitueberschreitung |
// Stand), eine Zeile je Shop + Ablauf. Geschrieben wird NUR bei einer Zeitueberschreitung (kein Schreibzugriff bei
// erfolgreichen Laeufen): Zeile ersetzen bzw. neu anlegen, ohne append, zurueckgelesen (lib/sheet-zeilen.js).
// Faellt der Reiter aus (fehlt, Kopf falsch, Sheets-Fehler, Schreibkonflikt), wird SOFORT gemeldet - lieber eine
// Meldung zu viel als ein verschluckter Ausfall. Einrichtung: scripts/setup-alarm-stand.js.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { schreibeNeueZeilen, ersetzeZeile } from './sheet-zeilen.js';
import { TAB_ALARM, KOPF_ALARM, alarmEntscheidung, FENSTER_MS } from '../utils/alarm-stand.js';

async function sheetsClient() {
  return google.sheets({ version: 'v4', auth: await getGoogleAuth() });
}

/**
 * Soll eine LESENDE Shop-Zeitueberschreitung gemeldet werden? Traegt die Zeit dieser Zeitueberschreitung ein.
 * @returns {Promise<{ melden: boolean, grund: 'erste'|'zweite'|'kein_stand'|'fehler', abstandMin?: number }>}
 */
export async function zeitueberschreitungPruefen({ schluessel, zeit, sheets, spreadsheetId = process.env.GOOGLE_SHEET_ID, jetzt = Date.now(), fenster = FENSTER_MS } = {}) {
  if (!spreadsheetId) return { melden: true, grund: 'kein_stand' };
  let werte;
  try {
    sheets ??= await sheetsClient();
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_ALARM}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    werte = data.values ?? [];
  } catch (err) {
    console.warn(`[alarm] ${TAB_ALARM} nicht lesbar (${err?.code ?? err?.status ?? 'Fehler'}) - Meldung sofort.`);
    return { melden: true, grund: 'kein_stand' };
  }
  const kopf = (werte[0] ?? []).map(k => String(k).trim());
  if (KOPF_ALARM.some((k, i) => kopf[i] !== k)) {
    console.warn(`[alarm] ${TAB_ALARM}: Kopfzeile fehlt oder anders - Meldung sofort.`);
    return { melden: true, grund: 'kein_stand' };
  }
  const i = werte.findIndex((r, n) => n > 0 && String(r[0] ?? '').trim() === schluessel);
  const alt = i > 0 ? werte[i] : null;
  const entscheidung = alarmEntscheidung(alt?.[1] ?? '', jetzt, fenster);
  const iso = new Date(Date.parse(zeit ?? '') || jetzt).toISOString();
  const neu = [schluessel, iso, new Date(jetzt).toISOString()];
  try {
    if (alt) await ersetzeZeile(sheets, spreadsheetId, TAB_ALARM, i + 1, alt, neu);
    else await schreibeNeueZeilen(sheets, spreadsheetId, TAB_ALARM, [neu], { alt: werte });
  } catch (err) {
    console.warn(`[alarm] ${TAB_ALARM} nicht geschrieben (${err?.status ?? 'Fehler'}) - Meldung sofort.`);
    return { ...entscheidung, melden: true, grund: entscheidung.melden ? entscheidung.grund : 'fehler' };
  }
  return entscheidung;
}
