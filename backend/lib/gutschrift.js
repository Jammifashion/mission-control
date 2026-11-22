// GS1: Gutschrift an Festpreis-Partner aus einer abgeschlossenen FP-Abrechnung als Lexware-Entwurf.
// Logik utils/gutschrift.js, Lexware-Aufruf lib/lexwareGutschrift.js (Schreiben) bzw. lib/lexwareRechnung.js `sucheEntwuerfe` (Nachsehen, nur lesen).
// Ablauf Anlegen (unter der FP-Sperre, alles frisch gelesen) wie RE1:
//   pruefen (Brutto wie gesehen, kein Kennzeichen, Plan ohne Probleme) -> Kennzeichen "unklar" + Tag ZUERST schreiben -> genau EIN POST ->
//   angelegt: ID + "entwurf" | nicht (4xx): Kennzeichen wieder leer | unklar: bleibt "unklar" + Chat. Jeder Schreibschritt zurueckgelesen.
// Log/Chat: nur Abrechnungs-ID und Partner-ID - nie Namen, Betraege, Antwortinhalt.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { leseKunden } from './kunden.js';
import { notify } from './chatNotify.js';
import { mitFpSperre } from './fpSperre.js';
import { spalteBuchstabe } from './sheet-zeilen.js';
import { legeGutschriftsentwurfAn, gutschriftenBereit, gutschriftSchluessel } from './lexwareGutschrift.js';
import { sucheEntwuerfe } from './lexwareRechnung.js';
import { parseKonfiguration } from '../utils/partner-kalkulation.js';
import { berlinDatum } from '../utils/berlin-tag.js';
import { lexwareDatum } from '../utils/rechnung.js';
import {
  GUTSCHRIFT_SPALTEN, SPALTE_KUNDE, GS_STATUS, LINK_BASIS, CONFIG_BELEGART, abrechnungAus, abrechnungGrund, gutschriftPlan, belegartAus,
  kennzeichenFelder, leerFelder, kennzeichenPlan, inCent, chatText,
} from '../utils/gutschrift.js';

export const TAB_ABRECHNUNGEN = 'FP_Abrechnungen';
export const TAB_PARTNER = 'FP_Partner';
const TAB_FIXKOSTEN = 'Kalkulation_Fixkosten';
const TAB_CONFIG = 'Config';

const t = v => String(v ?? '').trim();
const fehler = (text, status = 422, code) => Object.assign(new Error(text), { status, code });
const sheetIdBusiness = () => {
  const id = process.env.BUSINESS_SHEET_ID;
  if (!id) throw fehler('BUSINESS_SHEET_ID fehlt.', 503);
  return id;
};
async function sheetsClient() { return google.sheets({ version: 'v4', auth: await getGoogleAuth() }); }

async function werte(sheets, spreadsheetId, tab, unformatiert = false) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `'${tab}'`, ...(unformatiert ? { valueRenderOption: 'UNFORMATTED_VALUE' } : {}),
  });
  return data.values ?? [];
}

/** FP_Abrechnungen frisch: Kopf + Zeilen (UNFORMATTED: Betraege als Zahl), je Zeile _zeile (Sheet-Zeile). */
async function liesAbrechnungen(sheets, spreadsheetId) {
  const [kopf = [], ...z] = await werte(sheets, spreadsheetId, TAB_ABRECHNUNGEN, true);
  const zeilen = z.map((r, i) => ({ ...abrechnungAus(kopf, r), _zeile: i + 2 })).filter(a => a.id);
  const idx = Object.fromEntries(kopf.map((k, i) => [t(k), i]));
  return { kopf: kopf.map(t), idx, zeilen };
}

function pruefeSpalten(idx) {
  const fehlt = GUTSCHRIFT_SPALTEN.filter(s => idx[s] === undefined);
  if (fehlt.length) throw fehler(`Spalten ${fehlt.join(', ')} fehlen in ${TAB_ABRECHNUNGEN} – erst scripts/setup-fp-gutschrift.js --write.`, 409, 'einrichtung');
}

/** Lexoffice-ID des Partners ueber FP_Partner.Kunden_Nr -> Kunden-Sheet. '' wenn nicht verknuepft. */
async function kontaktVonPartner(sheets, spreadsheetId, partnerId, { kunden = leseKunden } = {}) {
  const [kopf = [], ...z] = await werte(sheets, spreadsheetId, TAB_PARTNER);
  const k = kopf.map(t);
  const iP = k.indexOf('Partner-ID'), iK = k.indexOf(SPALTE_KUNDE);
  if (iK === -1) return { kundenNr: '', kontaktId: '', spalte: false };
  const zeile = z.find(r => t(r[iP]) === partnerId);
  const kundenNr = t(zeile?.[iK]);
  if (!kundenNr) return { kundenNr: '', kontaktId: '', spalte: true };
  const { kunden: liste } = await kunden({ sheets });
  const kunde = liste.find(x => x.Kunden_Nr === kundenNr);
  return { kundenNr, kontaktId: t(kunde?.Lexoffice_ID), spalte: true };
}

async function mwstAus(sheets, spreadsheetId) {
  const [kopf = [], ...z] = await werte(sheets, spreadsheetId, TAB_FIXKOSTEN);
  const k = parseKonfiguration(z, kopf);
  return k.fehlend.includes('MwSt') ? null : k.mwstProzent;   // kein stiller Standardwert
}

async function belegart(sheets, spreadsheetId) {
  let wert = '';
  try {
    const [kopf = [], ...z] = await werte(sheets, spreadsheetId, TAB_CONFIG);
    const k = kopf.map(x => t(x).toLowerCase());
    const iS = k.findIndex(x => x === 'schlüssel' || x === 'schluessel'), iW = k.indexOf('wert');
    if (iS !== -1 && iW !== -1) wert = t(z.find(r => t(r[iS]) === CONFIG_BELEGART)?.[iW]);
  } catch { /* ohne Config: Standard */ }
  return belegartAus(wert);
}

async function planFuer({ sheets, spreadsheetId, abrechnung, jetzt }) {
  const [{ kontaktId, kundenNr, spalte }, mwstProzent, art] = await Promise.all([
    kontaktVonPartner(sheets, spreadsheetId, abrechnung.partnerId), mwstAus(sheets, spreadsheetId), belegart(sheets, spreadsheetId),
  ]);
  const plan = gutschriftPlan({ abrechnung, mwstProzent, kontaktId, voucherDate: lexwareDatum(berlinDatum(jetzt)) });
  if (!spalte) plan.probleme.unshift(`Spalte ${SPALTE_KUNDE} fehlt in FP_Partner – erst scripts/setup-fp-gutschrift.js --write.`);
  else if (!kundenNr) plan.probleme.unshift(`Partner ${abrechnung.partnerId} hat keine Kunden_Nr in FP_Partner.`);
  return { plan, kundenNr, belegart: art };
}

/** Liste je Abrechnung: Kennzeichen + Grund (fuer den Knopf). Schreibt nichts. */
export async function gutschriftListe({ sheets: s, bereit = gutschriftenBereit } = {}) {
  const sheets = s ?? await sheetsClient();
  const { idx, zeilen } = await liesAbrechnungen(sheets, sheetIdBusiness());
  return {
    bereit: await bereit(), spalten: GUTSCHRIFT_SPALTEN.every(c => idx[c] !== undefined), linkBasis: LINK_BASIS,
    abrechnungen: zeilen.map(a => ({
      id: a.id, partnerId: a.partnerId, status: a.status, grund: abrechnungGrund(a),
      gutschrift: { id: a.Gutschrift_Lexware_ID, am: a.Gutschrift_Am, status: a.Gutschrift_Status },
    })),
  };
}

/** Vorschau einer Abrechnung (Zeilen, Summen, Probleme). Schreibt nichts. */
export async function gutschriftVorschau({ id, sheets: s, jetzt = () => new Date(), bereit = gutschriftenBereit } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetIdBusiness();
  const { idx, zeilen } = await liesAbrechnungen(sheets, spreadsheetId);
  const a = zeilen.find(x => x.id === t(id));
  if (!a) throw fehler(`Abrechnung ${t(id)} gibt es nicht.`, 404);
  const { plan, kundenNr } = await planFuer({ sheets, spreadsheetId, abrechnung: a, jetzt: jetzt() });
  return {
    abrechnung: { id: a.id, partnerId: a.partnerId, von: a.von, bis: a.bis, status: a.status, bruttoCent: inCent(a.brutto) },
    kundenNr, titel: plan.payload.title, einleitung: plan.payload.introduction, zeilen: plan.zeilen, summen: plan.summen,
    ausgleich: plan.ausgleich, probleme: plan.probleme, bereit: await bereit(), spalten: GUTSCHRIFT_SPALTEN.every(c => idx[c] !== undefined),
  };
}

/** Zellen einer Abrechnungszeile schreiben (RAW) und zuruecklesen. */
async function schreibeKennzeichen(sheets, spreadsheetId, idx, zeile, felder) {
  const data = Object.entries(felder).map(([k, v]) => ({ range: `'${TAB_ABRECHNUNGEN}'!${spalteBuchstabe(idx[k])}${zeile}`, values: [[v]] }));
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  const { data: zur } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: data.map(d => d.range) });
  const falsch = (zur.valueRanges ?? []).some((vr, i) => t(vr.values?.[0]?.[0]) !== t(data[i].values[0][0]));
  if (falsch) throw fehler('Kennzeichen nach dem Schreiben nicht wie erwartet – bitte neu laden und prüfen.', 500, 'zuruecklesen');
}

/**
 * Gutschrift-Entwurf anlegen. eingabe { id, bruttoCent } (bruttoCent = wie in der Vorschau gesehen).
 * @returns {{ ok, ergebnis: 'angelegt'|'unklar', id?, link?, abrechnung }}
 */
export async function gutschriftAnlegen({ eingabe, sheets: s, jetzt = () => new Date(), senden = legeGutschriftsentwurfAn, melden = notify, schluesselLesen = gutschriftSchluessel, sperre = mitFpSperre } = {}) {
  const abrId = t(eingabe?.id);
  if (!/^FPA-\d+$/i.test(abrId)) throw fehler('Abrechnung fehlt.');
  const schluessel = await schluesselLesen();   // fehlt -> 503, vor jedem Schreiben
  return sperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetIdBusiness();
    const { idx, zeilen } = await liesAbrechnungen(sheets, spreadsheetId);
    pruefeSpalten(idx);
    const a = zeilen.find(x => x.id === abrId);
    if (!a) throw fehler(`Abrechnung ${abrId} gibt es nicht.`, 404);
    if (inCent(a.brutto) !== Number(eingabe?.bruttoCent)) throw fehler(`${abrId} wurde inzwischen geändert – bitte neu laden.`, 409, 'konflikt');
    if (t(a.Gutschrift_Status) || t(a.Gutschrift_Lexware_ID)) throw fehler(`Für ${abrId} ist schon eine Gutschrift angelegt.`, 409, 'schon');
    const { plan } = await planFuer({ sheets, spreadsheetId, abrechnung: a, jetzt: jetzt() });
    if (plan.probleme.length) { const e = fehler('Gutschrift so nicht möglich.', 422, 'probleme'); e.probleme = plan.probleme; throw e; }
    const heute = berlinDatum(jetzt());
    // 1) Kennzeichen "unklar" vor dem Senden
    await schreibeKennzeichen(sheets, spreadsheetId, idx, a._zeile, kennzeichenFelder({ status: GS_STATUS.UNKLAR, am: heute }));
    // 2) genau ein Versuch
    let r;
    try { r = await senden({ payload: plan.payload, schluessel }); } catch (err) { r = { ergebnis: 'unklar', grund: err?.name ?? 'Fehler' }; }
    if (r.ergebnis === 'angelegt') {
      await schreibeKennzeichen(sheets, spreadsheetId, idx, a._zeile, kennzeichenFelder({ id: r.id, status: GS_STATUS.ENTWURF, am: heute }));
      console.log(`GS1: Gutschrift-Entwurf angelegt für ${abrId} (${a.partnerId}).`);
      return { ok: true, ergebnis: 'angelegt', id: r.id, link: `${LINK_BASIS}${r.id}`, abrechnung: abrId };
    }
    if (r.ergebnis === 'nicht') {
      await schreibeKennzeichen(sheets, spreadsheetId, idx, a._zeile, leerFelder());
      console.warn(`GS1: Gutschrift NICHT angelegt (${r.status ?? '-'}) für ${abrId} (${a.partnerId}).`);
      try { await melden(chatText({ ergebnis: 'nicht', abrechnungId: abrId, partnerId: a.partnerId, grund: `Status ${r.status ?? '-'}` })); } catch { /* Chat optional */ }
      throw fehler(r.grund, r.status === 401 || r.status === 403 ? 503 : 422, r.status === 401 || r.status === 403 ? 'lexware_gutschriften' : 'lexware');
    }
    console.warn(`GS1: Ergebnis UNKLAR für ${abrId} (${a.partnerId}) – Kennzeichen „unklar“.`);
    try { await melden(chatText({ ergebnis: 'unklar', abrechnungId: abrId, partnerId: a.partnerId })); } catch { /* Chat optional */ }
    return { ok: false, ergebnis: 'unklar', grund: r.grund, abrechnung: abrId };
  });
}

/** Kennzeichen von Hand: aktion angelegt (unklar -> entwurf, mit ID) | zuruecksetzen (entwurf/unklar -> leer). */
export async function gutschriftKennzeichen({ eingabe, sheets: s, sperre = mitFpSperre } = {}) {
  const abrId = t(eingabe?.id), aktion = t(eingabe?.aktion);
  return sperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetIdBusiness();
    const { idx, zeilen } = await liesAbrechnungen(sheets, spreadsheetId);
    pruefeSpalten(idx);
    const a = zeilen.find(x => x.id === abrId);
    if (!a) throw fehler(`Abrechnung ${abrId} gibt es nicht.`, 404);
    const plan = kennzeichenPlan({ abrechnung: a, aktion, lexwareId: eingabe?.lexwareId });
    const felder = plan.zuruecksetzen ? leerFelder() : kennzeichenFelder({ id: plan.id, status: GS_STATUS.ENTWURF, am: a.Gutschrift_Am });
    await schreibeKennzeichen(sheets, spreadsheetId, idx, a._zeile, felder);
    return { ok: true, abrechnung: abrId, aktion };
  });
}

/** "In Lexware nachsehen" (nur lesen): Gutschrift-Entwuerfe des Partners seit dem Tag des Kennzeichens. */
export async function gutschriftNachsehen({ id, sheets: s, suche = sucheEntwuerfe } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetIdBusiness();
  const { zeilen } = await liesAbrechnungen(sheets, spreadsheetId);
  const a = zeilen.find(x => x.id === t(id));
  if (!a) throw fehler(`Abrechnung ${t(id)} gibt es nicht.`, 404);
  const { kontaktId } = await kontaktVonPartner(sheets, spreadsheetId, a.partnerId);
  const r = await suche({ kontaktId, seit: a.Gutschrift_Am, voucherType: 'creditnote' });
  return r.ok ? { ok: true, entwuerfe: r.entwuerfe.map(e => ({ ...e, link: `${LINK_BASIS}${e.id}` })) } : r;
}
