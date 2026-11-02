// Lager beim Wareneingang (BO5-4) - eigene Knoepfe. Logik in utils/lager-eingang.js.
//  - kartonUeberschuss: "Rest ins Lager (m-n)" / "ins Lager" (nicht im Korb) - Karton-PDF neu gelesen (Mengen aus Ord.),
//    nur Lager_Buchungen, Bezug ohne Kundennummer.
//  - trikotInsLager: Trikot mit Status "ersetzt" ins Lager - Reiter Trikots nur gelesen.
//  - setzeLagerZiel: "bei Ankunft ins Lager" an einer eigenen Position (nur die Zelle Lager_Ziel, zurueckgelesen).
// Lager-Zeilen immer ueber die gepruefte Zielstrecke (kein append), zurueckgelesen; Vorgangs-Kennung gegen Doppelklick.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { mitKorbSperre } from './lshopKorb.js';
import { leseLager, mitLagerSperre, lagerCacheLeeren } from './lager.js';
import { ladeLShopZeilen } from './lshop.js';
import { holeKarton } from './karton.js';
import { leseReiterSpalten } from './ssot-reiter.js';
import { pruefeZielStrecke, zeilenAbweichungen, zellText } from './sheet-zeilen.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { TAB_KORB, korbZeilen } from '../utils/korb-logic.js';
import { referenzFuer } from '../utils/edi-bestellung.js';
import { kartonAbgleich } from '../utils/karton.js';
import { aktiveOrte, alsZeile, TAB_BUCHUNGEN } from '../utils/lager.js';
import { kartonUeberschussPlan, trikotLagerPlan, lagerZielPlan } from '../utils/lager-eingang.js';
import { TAB_TRIKOTS } from '../utils/trikot-ansicht.js';
import { trikotAnsichtCacheLeeren } from './trikotAnsicht.js';

const t = v => String(v ?? '').trim();
const q = tab => `'${tab}'`;
const fehler = (msg, status, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}
const ssot = () => {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  return id;
};

async function lagerFrisch(sheets, spreadsheetId) {
  const l = await leseLager(sheets, spreadsheetId);
  if (l.einrichtung.length) throw fehler(`Lager ist noch nicht eingerichtet (${l.einrichtung.join('; ')}).`, 409, { code: 'einrichtung' });
  return l;
}

/** Neue Journal-Zeilen schreiben (gepruefte Zielstrecke, ein update), zurueckgelesen. */
async function schreibeLager(sheets, spreadsheetId, l, zeilen) {
  const werte = zeilen.map(o => alsZeile(o, l.idxB));
  let ziel;
  try { ziel = await pruefeZielStrecke(sheets, spreadsheetId, TAB_BUCHUNGEN, l.werteB, werte); } catch {
    throw fehler('Gerade hat jemand anders im Lager gebucht - bitte noch einmal.', 409, { code: 'konflikt' });
  }
  await sheets.spreadsheets.values.update({ spreadsheetId, range: ziel.range, valueInputOption: 'RAW', requestBody: { values: werte } });
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: ziel.range, valueRenderOption: 'UNFORMATTED_VALUE' });
  if (zeilenAbweichungen(werte, data.values ?? []).length) throw fehler(`${TAB_BUCHUNGEN}: Rücklesen weicht ab - bitte im Sheet prüfen.`, 500);
  lagerCacheLeeren();
  return { ok: true, buchungen: zeilen.map(z => z.Buchung_ID), stueck: zeilen.reduce((a, z) => a + z.Menge, 0), ort: zeilen[0]?.Ort ?? '' };
}
const schonGebuchtAntwort = schon => ({ ok: true, schonGebucht: true, buchungen: schon.map(b => b.id) });

/** POST .../karton/ueberschuss { link, auswahl: [{ reference, sku }], ort, vorgang } */
export async function kartonUeberschuss({ link, auswahl, ort, vorgang, sheets: s, holen, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = ssot();
  const { kartonId, karton } = await holeKarton({ link, sheets, holen });   // PDF neu gelesen - Mengen aus Ord.
  return mitLagerSperre(async () => {
    const l = await lagerFrisch(sheets, spreadsheetId);
    const korbW = (await sheets.spreadsheets.values.get({ spreadsheetId, range: q(TAB_KORB), valueRenderOption: 'FORMATTED_VALUE' })).data.values ?? [];
    const abgleich = kartonAbgleich({ karton, korbZeilen: korbZeilen(korbW).zeilen, referenz: referenzFuer, schonDa: null });
    const nummern = new Set((await ladeLShopZeilen({ sheets, spreadsheetId })).map(z => t(z.articleNr)));
    const plan = kartonUeberschussPlan({
      abgleich, karton, kartonId, auswahl, ort: t(ort), buchungen: l.buchungen, orte: aktiveOrte(l.orte), vorgang, jetzt: jetzt(),
      gueltig: sch => nummern.has(sch.slice(3)) || `${sch.slice(3)} steht nicht in den L-Shop-Stammdaten.`,
    });
    if (plan.schonGebucht) return schonGebuchtAntwort(plan.schonGebucht);
    const r = await schreibeLager(sheets, spreadsheetId, l, plan.zeilen);
    console.log(`Karton ${kartonId}: Überschuss ins Lager, ${r.stueck} Stück`);   // nie Link/Kundennummer
    return { ...r, kartonId };
  });
}

/** POST /api/bestellen/trikots/ins-lager { id (Zeilen-ID), zeile, ort, vorgang } - Trikots nur gelesen. */
export async function trikotInsLager({ id, zeile, ort, vorgang, sheets: s, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = ssot();
  const business = process.env.BUSINESS_SHEET_ID;
  if (!business) throw fehler('BUSINESS_SHEET_ID fehlt.', 503);
  return mitLagerSperre(async () => {
    const l = await lagerFrisch(sheets, spreadsheetId);
    const werte = (await sheets.spreadsheets.values.get({ spreadsheetId: business, range: q(TAB_TRIKOTS), valueRenderOption: 'FORMATTED_VALUE' })).data.values ?? [];
    const kopf = (werte[0] ?? []).map(k => t(k));
    const i = n => kopf.indexOf(n);
    for (const n of ['Zeilen-ID', 'Produktname', 'Groesse', 'Status']) if (i(n) < 0) throw fehler(`Trikots: Spalte ${n} fehlt.`, 409);
    const r = werte[Number(zeile) - 1] ?? [];
    if (Number(zeile) < 2 || t(r[i('Zeilen-ID')]) !== t(id)) throw fehler('Trikot-Zeile hat sich geändert - bitte neu laden.', 409);
    // Produkt-ID ueber Trikot_Artikel + Erfassungsmaske (Produktname des Shops), wie in der Lager-Auswahl.
    const artikel = await leseReiterSpalten({ tab: 'Trikot_Artikel', sheets, spreadsheetId: business, spalten: { produktId: 'Produkt-ID' } });
    const maske = await leseReiterSpalten({ tab: 'Erfassungsmaske', sheets, spreadsheetId, spalten: { name: 'Produktname' }, optional: { produktId: 'Produkt-ID' } });
    const pids = new Set(artikel.map(a => t(a.produktId)).filter(Boolean));
    const produktId = maske.find(m => pids.has(t(m.produktId)) && t(m.name) === t(r[i('Produktname')]))?.produktId ?? '';
    const plan = trikotLagerPlan({
      zeile: { id: t(id), status: t(r[i('Status')]), produktId: t(produktId), groesse: t(r[i('Groesse')]),
        beflockt: Boolean((i('Name') >= 0 && t(r[i('Name')])) || (i('Nummer') >= 0 && t(r[i('Nummer')]))) },
      ort: t(ort), buchungen: l.buchungen, orte: aktiveOrte(l.orte), vorgang, jetzt: jetzt(),
    });
    if (plan.schonGebucht) return schonGebuchtAntwort(plan.schonGebucht);
    const res = await schreibeLager(sheets, spreadsheetId, l, plan.zeilen);
    trikotAnsichtCacheLeeren();
    return res;
  });
}

/** POST .../lshop-korb/lager-ziel { schluessel, status, ziel } - nur die Zelle Lager_Ziel einer eigenen Position. */
export async function setzeLagerZiel({ schluessel, status, ziel, sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = ssot();
  return mitKorbSperre('lager-ziel', async () => {
    const korbW = (await sheets.spreadsheets.values.get({ spreadsheetId, range: q(TAB_KORB), valueRenderOption: 'FORMATTED_VALUE' })).data.values ?? [];
    const { idx, zeilen } = korbZeilen(korbW);
    if (idx.Lager_Ziel === undefined) throw fehler('Spalte Lager_Ziel fehlt im Warenkorb - erst einrichten (scripts/setup-korb-lager-ziel.js).', 409, { code: 'einrichtung' });
    const treffer = zeilen.filter(z => z.Schluessel === t(schluessel));
    if (treffer.length > 1) throw fehler(`Position ${t(schluessel)} steht mehrfach im Warenkorb - nichts geändert.`, 409);
    const l = t(ziel) ? await lagerFrisch(sheets, spreadsheetId) : null;
    const plan = lagerZielPlan({ korbZeile: treffer[0], status, ziel, orte: l ? aktiveOrte(l.orte) : [] });
    if (plan.alt === plan.neu) return { ok: true, schluessel: plan.schluessel, ziel: plan.neu, unveraendert: true };
    const range = `${q(TAB_KORB)}!${colLetter(idx.Lager_Ziel)}${plan.zeile}`;
    await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: [[plan.neu]] } });
    const zurueck = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `${q(TAB_KORB)}!${plan.zeile}:${plan.zeile}`, valueRenderOption: 'FORMATTED_VALUE' })).data.values?.[0] ?? [];
    if (zellText(zurueck[idx.Schluessel]) !== plan.schluessel || zellText(zurueck[idx.Lager_Ziel]) !== plan.neu) {
      throw fehler(`${TAB_KORB}: Rücklesen weicht ab bei ${plan.schluessel} - bitte im Sheet prüfen.`, 500);
    }
    return { ok: true, schluessel: plan.schluessel, ziel: plan.neu };
  });
}
