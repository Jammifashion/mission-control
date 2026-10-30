// Wareneingang Trikots (TR4) - Ein-/Ausgabe, Logik in utils/trikot-wareneingang.js.
// POST /api/bestellen/trikots/wareneingang { richtung: 'setzen'|'zurueck', auswahl: [{ id, zeile, geliefertAm }] }
// Schreibt NUR Status (S) und Geliefert_Am (R) der gewaehlten Zeilen: eine Sperre je Instanz, frisch gelesen,
// Vorher-Zustand je Zeile geprueft (sonst 409, nichts geschrieben), EIN values.batchUpdate RAW, kein append,
// danach der ganze Reiter zurueckgelesen (nur die geplanten Zellen duerfen sich geaendert haben).

import { google } from 'googleapis';
import { trikotAnsichtCacheLeeren } from './trikotAnsicht.js';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { TAB_TRIKOTS } from '../utils/trikot-ansicht.js';
import { tagWerte } from '../utils/trikot-formular.js';
import { wareneingangPlan } from '../utils/trikot-wareneingang.js';

const fehler = (msg, status, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}

let laeuft = false;
export async function trikotWareneingang({ richtung, auswahl, sheets: s, jetzt = new Date() } = {}) {
  if (laeuft) throw fehler('Wareneingang läuft gerade – gleich noch einmal versuchen.', 409, { code: 'laeuft_gerade' });
  laeuft = true;
  try {
    const id = process.env.BUSINESS_SHEET_ID;
    if (!id) throw fehler('BUSINESS_SHEET_ID fehlt.', 503);
    const sheets = s ?? await sheetsClient();
    const lies = async o => (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${TAB_TRIKOTS}'`, valueRenderOption: o })).data.values ?? [];
    const vorher = await lies('UNFORMATTED_VALUE');
    const heute = tagWerte(jetzt);
    const plan = wareneingangPlan(vorher, await lies('FORMATTED_VALUE'), { richtung, auswahl, serial: heute.serial });
    if (plan.probleme.length) throw fehler(plan.probleme[0].text, 409, { probleme: plan.probleme, code: 'nicht_gebucht' });
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'RAW', data: plan.zellen } });

    // Geliefert_Am ohne Datumsformat (zeigt sonst die Seriennummer): nur das Format dieser Zellen setzen,
    // wie Bestellt_Am (dd.mm.yyyy). Der Wert bleibt.
    let fmt = await lies('FORMATTED_VALUE');
    const ohneFormat = richtung === 'setzen'
      ? plan.zeilen.filter(z => !/^\d{2}\.\d{2}\.\d{4}$/.test(String(fmt[z - 1]?.[plan.spalten.iR] ?? ''))) : [];
    if (ohneFormat.length) {
      const { data: m } = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(sheetId,title)' });
      const sheetId = m.sheets.find(x => x.properties.title === TAB_TRIKOTS)?.properties.sheetId;
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: ohneFormat.map(z => ({ repeatCell: {
        range: { sheetId, startRowIndex: z - 1, endRowIndex: z, startColumnIndex: plan.spalten.iR, endColumnIndex: plan.spalten.iR + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd.mm.yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } })) } });
      fmt = await lies('FORMATTED_VALUE');
    }

    // Ganzer Reiter zurueckgelesen: geplante Zellen wie geschrieben, sonst nichts veraendert.
    const nachher = await lies('UNFORMATTED_VALUE');
    const geplant = new Map(plan.zellen.map(z => [z.range.split('!')[1], z.values[0][0]]));
    const abw = [];
    for (let r = 0; r < Math.max(vorher.length, nachher.length); r++) {
      for (let c = 0; c < Math.max(vorher[r]?.length ?? 0, nachher[r]?.length ?? 0); c++) {
        const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
        const ist = nachher[r]?.[c] ?? '';
        if (geplant.has(ref)) { if (String(ist) !== String(geplant.get(ref))) abw.push(ref); }
        else if (String(vorher[r]?.[c] ?? '') !== String(ist)) abw.push(`${ref} (fremd)`);
      }
    }
    trikotAnsichtCacheLeeren();   // TR5: Ansicht/Karten zeigen sofort den neuen Stand
    return {
      richtung, zeilen: plan.zeilen.length, geliefertAm: richtung === 'setzen' ? heute.text : '',
      rueckgelesen: !abw.length, abweichungen: abw, datumsformatGesetzt: ohneFormat.length,
    };
  } finally { laeuft = false; }
}
