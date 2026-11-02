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
import { leseLager, mitLagerSperre, lagerCacheLeeren } from './lager.js';
import { pruefeZielStrecke, zeilenAbweichungen } from './sheet-zeilen.js';
import { aktiveOrte, alsZeile, TAB_BUCHUNGEN } from '../utils/lager.js';
import { eingangLagerPlan, zurueckSperre, QUELLE_EINGANG } from '../utils/lager-eingang.js';

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

/**
 * Der Schreibweg selbst - OHNE Sperre. Nur fuer Aufrufer, die die Korb-Sperre schon halten (Karton-Scan,
 * lib/karton.js); sonst wareneingangBuchen/-Zurueck.
 */
export async function bucheEingangInSperre({ orderId, auswahl, zurueck = false, sheets, spreadsheetId, nun, quelle = QUELLE_EINGANG.WARENEINGANG, vorgang }) {
  // BO5-4: das Lager liest und schreibt im selben Schritt mit (Lager-Sperre zusaetzlich zur Korb-Sperre des Aufrufers).
  return mitLagerSperre(() => eingangMitLager({ orderId, auswahl, zurueck, sheets, spreadsheetId, nun, quelle, vorgang }));
}

async function eingangMitLager({ orderId, auswahl, zurueck, sheets, spreadsheetId, nun, quelle, vorgang }) {
  const { idx: kIdx, zeilen } = korbZeilen(await werte(sheets, spreadsheetId, TAB_KORB));
  const sWerte = await werte(sheets, spreadsheetId, SENDUNGEN_TAB);
  const plan = eingangPlan({ korbZeilen: zeilen, sendungenWerte: sWerte, orderId, auswahl, jetzt: nun, zurueck });
  // BO5-4: Lager - Zugang bei "bei Ankunft ins Lager" (Lager_Ziel) und "mehr gekommen"; Rueckweg gesperrt, solange
  // ein solcher Zugang offen ist. Fehlt das Lager (nicht eingerichtet) und wird nichts gebraucht, laeuft alles wie vorher.
  const l = await leseLager(sheets, spreadsheetId).catch(() => null);
  const lagerDa = l && !l.einrichtung.length;
  if (zurueck && lagerDa) zurueckSperre(auswahl, l.buchungen);
  const lagerZeilen = zurueck ? [] : eingangLagerPlan({
    auswahl, korbZeilen: zeilen, buchungen: lagerDa ? l.buchungen : [], orte: lagerDa ? aktiveOrte(l.orte) : [], quelle, orderId, vorgang, jetzt: new Date(nun),
  });
  if (lagerZeilen.length && !lagerDa) throw fehler('Lager ist nicht eingerichtet oder nicht lesbar - ohne "ins Lager" noch einmal buchen.', 409);

  const data = plan.korb.flatMap(p => Object.entries(p.werte).map(([sp, w]) => ({ range: `${q(TAB_KORB)}!${colLetter(kIdx[sp])}${p.zeile}`, values: [[w]] })));
  let sIdx = null;
  if (plan.paket) {
    sIdx = sendungenSpalten(sWerte[0]);
    data.push({ range: `${q(SENDUNGEN_TAB)}!${colLetter(sIdx.Wareneingang)}${plan.paket.zeile}`, values: [[plan.paket.neu]] });
  }
  let lagerZiel = null, lagerWerte = [];
  if (lagerZeilen.length) {
    lagerWerte = lagerZeilen.map(o => alsZeile(o, l.idxB));
    try { lagerZiel = await pruefeZielStrecke(sheets, spreadsheetId, TAB_BUCHUNGEN, l.werteB, lagerWerte); } catch (err) {
      throw fehler('Gerade hat jemand anders im Lager gebucht - bitte noch einmal.', 409);
    }
    data.push({ range: lagerZiel.range, values: lagerWerte });
  }
  // EIN Schreibaufruf fuer Korb, Paket und Lager.
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  if (lagerZeilen.length) lagerCacheLeeren();

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
  if (lagerZiel) {
    const { data: lz } = await sheets.spreadsheets.values.get({ spreadsheetId, range: lagerZiel.range, valueRenderOption: 'UNFORMATTED_VALUE' });
    if (zeilenAbweichungen(lagerWerte, lz.values ?? []).length) abweichend.push(TAB_BUCHUNGEN);
  }
  if (abweichend.length) throw fehler(`Rücklesen weicht ab bei ${abweichend.join(', ')} - bitte im Sheet prüfen.`, 500);
  return {
    lager: lagerZeilen.map(z => ({ buchung: z.Buchung_ID, art: z.Art, schluessel: z.Schluessel, menge: z.Menge, ort: z.Ort, bezug: z.Bezug })),
    ok: true, orderId: t(orderId), positionen: plan.korb.length, status: zurueck ? 'bestellt' : 'geliefert',
    paket: plan.paket ? (plan.paket.neu ? 'Wareneingang gesetzt' : 'Wareneingang geleert') : '', hinweis: plan.hinweis,
    zellen: data.map(d => d.range),
  };
}

async function schreibe({ orderId, auswahl, zurueck, sheets: s, jetzt, vorgang }) {
  return mitKorbSperre(zurueck ? 'wareneingang-zurueck' : 'wareneingang', async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
    return bucheEingangInSperre({ orderId, auswahl, zurueck, sheets, spreadsheetId, nun: jetzt().toISOString(), vorgang });
  });
}

export const wareneingangBuchen = ({ orderId, auswahl, sheets, jetzt = () => new Date(), vorgang } = {}) =>
  schreibe({ orderId, auswahl, zurueck: false, sheets, jetzt, vorgang });
export const wareneingangZurueck = ({ orderId, auswahl, sheets, jetzt = () => new Date() } = {}) =>
  schreibe({ orderId, auswahl, zurueck: true, sheets, jetzt });
