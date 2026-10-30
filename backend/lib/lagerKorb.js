// Lager im L-Shop-Warenkorb (BO5-3) - Ein-/Ausgabe, Logik in utils/lager-korb.js.
// POST /api/bestellen/lshop-korb/aus-lager            { schluessel, status, verteilung: [{ ort, menge }], vorgang }
// POST /api/bestellen/lshop-korb/zurueck-aus-lager    { schluessel, vorgang }
//
// Ablauf (Muster "Als gesendet markieren"): unter Korb- UND Lager-Sperre, beide Reiter frisch gelesen, Plan geprueft
// (nie negativ, Status wie gesehen), Zielstrecke im Journal geprueft (kein append), dann EIN values.batchUpdate ueber
// beide Reiter (Korb: Status/Grund/Status_Datum/Stand; Lager_Buchungen: neue Zeilen), danach beide zurueckgelesen.
// Gleiche Vorgangs-Kennung = schon gebucht, nichts doppelt.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { mitKorbSperre } from './lshopKorb.js';
import { leseLager, mitLagerSperre, lagerCacheLeeren } from './lager.js';
import { pruefeZielStrecke, zeilenAbweichungen, zellText } from './sheet-zeilen.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { TAB_KORB, korbZeilen } from '../utils/korb-logic.js';
import { aktiveOrte, alsZeile, TAB_BUCHUNGEN } from '../utils/lager.js';
import { ausLagerPlan, zurueckAusLagerPlan } from '../utils/lager-korb.js';

const t = v => String(v ?? '').trim();
const q = tab => `'${tab}'`;
const fehler = (msg, status, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}

async function mitBeidenSperren(was, fn) {
  return mitKorbSperre(was, () => mitLagerSperre(fn));
}

async function lauf(planen, { eingabe, sheets: s, jetzt = () => new Date() }) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  const sheets = s ?? await sheetsClient();
  const l = await leseLager(sheets, spreadsheetId);
  if (l.einrichtung.length) throw fehler(`Lager ist noch nicht eingerichtet (${l.einrichtung.join('; ')}).`, 409, { code: 'einrichtung' });
  const korbWerte = (await sheets.spreadsheets.values.get({ spreadsheetId, range: q(TAB_KORB), valueRenderOption: 'FORMATTED_VALUE' })).data.values ?? [];
  const { idx: kIdx, zeilen } = korbZeilen(korbWerte);
  const plan = planen(eingabe, { korbZeilen: zeilen, buchungen: l.buchungen, orte: aktiveOrte(l.orte), jetzt: jetzt() });
  if (plan.schonGebucht) {
    return { ok: true, schonGebucht: true, schluessel: t(eingabe?.schluessel), buchungen: plan.schonGebucht.map(b => b.id) };
  }

  const zeilenLager = plan.lagerZeilen.map(o => alsZeile(o, l.idxB));
  let ziel;
  try {
    ziel = await pruefeZielStrecke(sheets, spreadsheetId, TAB_BUCHUNGEN, l.werteB, zeilenLager);
  } catch (err) {
    throw fehler('Gerade hat jemand anders gebucht - bitte noch einmal.', 409, { code: 'konflikt', grund: err.message });
  }
  const zelle = sp => `${q(TAB_KORB)}!${colLetter(kIdx[sp])}${plan.korb.zeile}`;
  const data = [
    ...Object.entries(plan.korb.werte).map(([sp, w]) => ({ range: zelle(sp), values: [[w]] })),
    { range: ziel.range, values: zeilenLager },
  ];
  // EIN Schreibaufruf fuer beide Reiter: entweder kommt alles an oder nichts.
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  lagerCacheLeeren();

  // Zuruecklesen: Korb-Zeile (Schluessel + neue Werte) und die neuen Journal-Zeilen.
  const korbZurueck = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `${q(TAB_KORB)}!${plan.korb.zeile}:${plan.korb.zeile}`, valueRenderOption: 'FORMATTED_VALUE' })).data.values?.[0] ?? [];
  const lagerZurueck = (await sheets.spreadsheets.values.get({ spreadsheetId, range: ziel.range, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
  const wert = sp => zellText(korbZurueck[kIdx[sp]]);
  const abweichend = [];
  if (wert('Schluessel') !== plan.korb.schluessel || Object.entries(plan.korb.werte).some(([sp, w]) => wert(sp) !== zellText(w))) abweichend.push(TAB_KORB);
  if (zeilenAbweichungen(zeilenLager, lagerZurueck).length) abweichend.push(TAB_BUCHUNGEN);
  if (abweichend.length) throw fehler(`Rücklesen weicht ab (${abweichend.join(', ')}) - bitte im Sheet prüfen.`, 500);
  return {
    ok: true, schluessel: plan.korb.schluessel, status: plan.korb.werte.Status,
    buchungen: plan.lagerZeilen.map(z => z.Buchung_ID), stueck: plan.lagerZeilen.reduce((a, z) => a + Math.abs(z.Menge), 0),
    orte: plan.lagerZeilen.map(z => ({ ort: z.Ort, menge: Math.abs(z.Menge) })),
  };
}

/** "aus Lager nehmen": Korb-Position offen -> Lager, Abgang im Lager. */
export const ausLagerNehmen = o => mitBeidenSperren('aus-lager', () => lauf(ausLagerPlan, o));
/** "zurück in den Korb": Lager -> offen, Gegenbuchung. */
export const zurueckAusLager = o => mitBeidenSperren('zurueck-aus-lager', () => lauf(zurueckAusLagerPlan, o));
