// Wareneingang (BO4b-5) - Ein-/Ausgabe, Logik in utils/wareneingang.js.
//  - POST /api/bestellen/lshop-korb/wareneingang          -> wareneingangBuchen()   "Ware angekommen" (von Hand)
//  - POST /api/bestellen/lshop-korb/wareneingang/zurueck  -> wareneingangZurueck()  "zurueck auf bestellt"
// Schreibmuster wie "Als gesendet markieren" (BO4e): unter der Korb-Sperre frisch lesen, planen (nichts ist
// geaendert, wenn eine Position nicht passt), EIN values.batchUpdate (Korb-Zellen + ggf. Wareneingang am Paket),
// alles zuruecklesen. Nie loeschen, kein values.append.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { mitKorbSperre } from './lshopKorb.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { TAB_KORB, korbZeilen } from '../utils/korb-logic.js';
import { SENDUNGEN_TAB, sendungenSpalten } from '../utils/lshop-belege.js';
import { eingangPlan } from '../utils/wareneingang.js';

const q = tab => `'${tab}'`;
const t = v => String(v ?? '').trim();
function fehler(msg, status) { const e = new Error(msg); e.status = status; return e; }

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}
async function werte(sheets, spreadsheetId, tab) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: q(tab), valueRenderOption: 'FORMATTED_VALUE' });
  return data.values ?? [];
}

async function schreibe({ orderId, auswahl, zurueck, sheets: s, jetzt }) {
  return mitKorbSperre(zurueck ? 'wareneingang-zurueck' : 'wareneingang', async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
    const nun = jetzt().toISOString();
    const { idx: kIdx, zeilen } = korbZeilen(await werte(sheets, spreadsheetId, TAB_KORB));
    const sWerte = await werte(sheets, spreadsheetId, SENDUNGEN_TAB);
    const plan = eingangPlan({ korbZeilen: zeilen, sendungenWerte: sWerte, orderId, auswahl, jetzt: nun, zurueck });

    const data = plan.korb.flatMap(p => Object.entries(p.werte).map(([sp, w]) => ({ range: `${q(TAB_KORB)}!${colLetter(kIdx[sp])}${p.zeile}`, values: [[w]] })));
    let sIdx = null;
    if (plan.paket) {
      sIdx = sendungenSpalten(sWerte[0]);
      data.push({ range: `${q(SENDUNGEN_TAB)}!${colLetter(sIdx.Wareneingang)}${plan.paket.zeile}`, values: [[plan.paket.neu]] });
    }
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });

    // Zuruecklesen: jede Korb-Zeile (Schluessel + neue Werte), ggf. die Paketzeile (order_id + Wareneingang).
    const ranges = [...plan.korb.map(p => `${q(TAB_KORB)}!${p.zeile}:${p.zeile}`), ...(plan.paket ? [`${q(SENDUNGEN_TAB)}!${plan.paket.zeile}:${plan.paket.zeile}`] : [])];
    const { data: z } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges, valueRenderOption: 'FORMATTED_VALUE' });
    const zeile = i => z.valueRanges?.[i]?.values?.[0] ?? [];
    const abweichend = [];
    plan.korb.forEach((p, i) => {
      const r = zeile(i);
      if (t(r[kIdx.Schluessel]) !== p.schluessel || Object.entries(p.werte).some(([sp, w]) => t(r[kIdx[sp]]) !== w)) abweichend.push(p.schluessel);
    });
    if (plan.paket) {
      const r = zeile(plan.korb.length);
      if (t(r[sIdx.order_id]) !== t(orderId) || t(r[sIdx.Wareneingang]) !== plan.paket.neu) abweichend.push(`Paket Zeile ${plan.paket.zeile}`);
    }
    if (abweichend.length) throw fehler(`Rücklesen weicht ab bei ${abweichend.join(', ')} - bitte im Sheet prüfen.`, 500);
    return {
      ok: true, orderId: t(orderId), positionen: plan.korb.length, status: zurueck ? 'bestellt' : 'geliefert',
      paket: plan.paket ? (plan.paket.neu ? 'Wareneingang gesetzt' : 'Wareneingang geleert') : '', hinweis: plan.hinweis,
      zellen: data.map(d => d.range),
    };
  });
}

export const wareneingangBuchen = ({ orderId, auswahl, sheets, jetzt = () => new Date() } = {}) =>
  schreibe({ orderId, auswahl, zurueck: false, sheets, jetzt });
export const wareneingangZurueck = ({ orderId, auswahl, sheets, jetzt = () => new Date() } = {}) =>
  schreibe({ orderId, auswahl, zurueck: true, sheets, jetzt });
