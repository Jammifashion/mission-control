// L-Shop-EDI-Bestelldatei aus dem Warenkorb (BO4a) - Ein-/Ausgabe, Logik in utils/edi-bestellung.js.
//
//  - POST /api/bestellen/lshop-korb/edi/vorschau  -> ediVorschau(): liest Korb, LShop_Modelle und
//    Config (customer_id), prueft, baut das XML mit Platzhalter-order_id. Schreibt NICHTS.
//  - POST /api/bestellen/lshop-korb/edi/erzeugen  -> ediErzeugen(): dieselbe Pruefung unter der
//    Korb-Sperre, vergibt die naechste order_id und schreibt genau EINE Protokollzeile in
//    "LShop_EDI_Dateien". Der Korb bleibt unveraendert (kein Status, kein Hinweis).
// Nur Sheets: kein Shop-Aufruf, kein Versand. Die Datei geht nur an den Browser (Download).
// Der Reiter und die Config-Zeile entstehen ueber scripts/setup-lshop-edi-reiter.js.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { ladeLShopZeilen } from './lshop.js';
import { mitKorbSperre } from './lshopKorb.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { normHeader } from '../utils/sheet-headers.js';
import { TAB_KORB, korbZeilen, ersteFreieZeile, bereichLeer, vergleicheZurueck } from '../utils/korb-logic.js';
import {
  EDI_TAB, EDI_SPALTEN, EDI_STATUS, CONFIG_CUSTOMER_ID, ediSpalten, ediPruefung, baueBestellXml, pruefeBestellXml,
  naechsteOrderId, platzhalterOrderId, standardCommission, ediDatum, ediDateiname, berlinTeile,
} from '../utils/edi-bestellung.js';

const TAB_CONFIG = 'Config';
const CONFIG_MS = 5 * 60 * 1000;
const q = tab => `'${tab}'`;

function fehler(msg, status, extra = {}) {
  const e = new Error(msg);
  e.status = status;
  Object.assign(e, extra);
  return e;
}

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}

async function reiter(sheets, spreadsheetId, titel) {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId,gridProperties)' });
  return (data.sheets ?? []).map(s => s.properties).find(p => p.title === titel) ?? null;
}

async function werte(sheets, spreadsheetId, tab) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: q(tab), valueRenderOption: 'FORMATTED_VALUE' });
  return data.values ?? [];
}

// ── customer_id aus dem Business-Sheet, Reiter Config (nie aus dem Code, nie ins Log) ──
let _cid = null;   // { wert, zeit }
export function _customerIdCacheLeeren() { _cid = null; }
export async function leseCustomerId({ sheets, spreadsheetId = process.env.BUSINESS_SHEET_ID } = {}) {
  if (_cid && Date.now() - _cid.zeit < CONFIG_MS) return _cid.wert;
  if (!spreadsheetId) throw fehler('BUSINESS_SHEET_ID fehlt.', 503);
  const [kopf = [], ...zeilen] = await werte(sheets, spreadsheetId, TAB_CONFIG);
  const norm = kopf.map(normHeader);
  const iS = norm.indexOf(normHeader('Schlüssel')), iW = norm.indexOf(normHeader('Wert'));
  if (iS < 0 || iW < 0) throw fehler(`Reiter "${TAB_CONFIG}": Spalten Schlüssel/Wert fehlen.`, 422);
  const z = zeilen.find(r => String(r[iS] ?? '').trim() === CONFIG_CUSTOMER_ID);
  const wert = String(z?.[iW] ?? '').trim();
  if (wert) _cid = { wert, zeit: Date.now() };   // nur einen gefundenen Wert zwischenspeichern
  return wert;
}

async function grundlagen(sheets, { auswahl, commission, jetzt }) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  if (!await reiter(sheets, spreadsheetId, TAB_KORB)) throw fehler(`Reiter "${TAB_KORB}" fehlt.`, 409);
  const { zeilen } = korbZeilen(await werte(sheets, spreadsheetId, TAB_KORB));
  const modelle = new Map((await ladeLShopZeilen({ sheets, spreadsheetId })).map(z => [z.articleNr, z]));
  const customerId = await leseCustomerId({ sheets });
  const com = commission === undefined || commission === null ? standardCommission(jetzt) : String(commission).trim();
  return { spreadsheetId, zeilen, modelle, customerId, commission: com, auswahl: Array.isArray(auswahl) ? auswahl : [] };
}

/** Pruefung + XML. xml bleibt null, wenn es sich nicht bauen laesst; dann ist auch "xml" rot. */
function pruefeUndBaue(g, orderId, jetzt) {
  const p = ediPruefung({ ...g, orderId, jetzt });
  let xml = null, xmlFehler = [];
  try {
    xml = baueBestellXml({
      kopf: { customer_id: g.customerId, order_date: ediDatum(jetzt), delivery_date: ediDatum(jetzt), order_id: orderId, commission: g.commission },
      items: p.items,
    });
    xmlFehler = pruefeBestellXml(xml);
  } catch (e) { xmlFehler = [e.message]; }
  // Ein fehlender customer_id-Wert ist schon eine eigene rote Regel - im XML-Punkt nicht doppelt melden.
  if (!g.customerId) xmlFehler = xmlFehler.filter(f => !/customer_id/.test(f));
  const punkte = [...p.punkte, {
    regel: 'xml', stufe: 'rot', titel: 'XML gültig zurückgelesen, keine Adressblöcke', ok: !xmlFehler.length,
    treffer: xmlFehler.map(text => ({ text })),
  }];
  return { gruen: p.gruen && !xmlFehler.length, punkte, items: p.items, stueck: p.stueck, xml: xmlFehler.length ? null : xml };
}

/** Vorschau: schreibt nichts, order_id als Platzhalter (die Nummer kommt erst beim Erzeugen). */
export async function ediVorschau({ auswahl, commission, sheets: s, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const nun = jetzt();
  const g = await grundlagen(sheets, { auswahl, commission, jetzt: nun });
  const orderId = platzhalterOrderId(berlinTeile(nun).jahr);
  const r = pruefeUndBaue(g, orderId, nun);
  return { ...r, orderId, commission: g.commission, standardCommission: standardCommission(nun), dateiname: null };
}

/**
 * Neue Zeile ohne append (Muster des Korbs): erste freie Zeile, Nachbarzeile oben und Zielbereich
 * (plus eine Zeile darunter) pruefen, values.update RAW, zuruecklesen.
 */
async function schreibeProtokollzeile({ sheets, spreadsheetId, info, alt, zeile }) {
  const breite = zeile.length;
  const ende = colLetter(breite - 1);
  const start = ersteFreieZeile(alt);
  const zeilenRaster = info?.gridProperties?.rowCount ?? 0;
  if (zeilenRaster < start + 1) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
      { appendDimension: { sheetId: info.sheetId, dimension: 'ROWS', length: start + 1 - zeilenRaster } },
    ] } });
  }
  const { data: um } = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${q(EDI_TAB)}!A${start - 1}:${ende}${start + 1}`, valueRenderOption: 'FORMATTED_VALUE',
  });
  const umgebung = um.values ?? [];
  if (vergleicheZurueck([(alt[start - 2] ?? []).slice(0, breite)], [umgebung[0] ?? []]).length) {
    throw fehler(`${EDI_TAB}: Zeile ${start - 1} hat sich seit dem Lesen geaendert - nichts geschrieben.`, 409);
  }
  if (!bereichLeer(umgebung.slice(1))) throw fehler(`${EDI_TAB}: Zielzeile ${start} ist nicht leer - nichts geschrieben.`, 409);
  const range = `${q(EDI_TAB)}!A${start}:${ende}${start}`;
  await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: [zeile] } });
  const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'FORMATTED_VALUE' });
  if (vergleicheZurueck([zeile], zurueck.values ?? []).length) throw fehler(`${EDI_TAB}: Rücklesen der Zeile ${start} weicht ab.`, 500);
  return start;
}

/**
 * Erzeugen: unter der Korb-Sperre neu pruefen, naechste order_id vergeben, eine Protokollzeile
 * (Status "Entwurf") schreiben. Rot -> 422 mit Pruefbericht, nichts geschrieben.
 */
export async function ediErzeugen({ auswahl, commission, sheets: s, jetzt = () => new Date() } = {}) {
  return mitKorbSperre('edi', async () => {
    const sheets = s ?? await sheetsClient();
    const nun = jetzt();
    const g = await grundlagen(sheets, { auswahl, commission, jetzt: nun });
    const info = await reiter(sheets, g.spreadsheetId, EDI_TAB);
    if (!info) throw fehler(`Reiter "${EDI_TAB}" fehlt - erst anlegen (scripts/setup-lshop-edi-reiter.js).`, 409);
    const alt = await werte(sheets, g.spreadsheetId, EDI_TAB);
    const idx = ediSpalten(alt[0]);
    const ids = alt.slice(1).map(r => String(r[idx.order_id] ?? '').trim());
    const orderId = naechsteOrderId(ids, berlinTeile(nun).jahr);

    const r = pruefeUndBaue(g, orderId, nun);
    if (!r.gruen) throw fehler('Prüfbericht rot - keine Datei erzeugt, nichts geschrieben.', 422, { pruefung: { gruen: false, punkte: r.punkte } });

    const dateiname = ediDateiname(orderId, nun);
    const zeile = Array(Math.max(...Object.values(idx)) + 1).fill('');
    const felder = {
      order_id: orderId, Erzeugt: nun.toISOString(), Status: EDI_STATUS.ENTWURF, Positionen: String(r.items.length),
      Stueck: String(r.stueck), Commission: g.commission, Dateiname: dateiname, Korb_Schluessel: r.items.map(i => i.schluessel).join(' '), Notiz: '',
    };
    for (const n of EDI_SPALTEN) zeile[idx[n]] = felder[n];
    const protokollZeile = await schreibeProtokollzeile({ sheets, spreadsheetId: g.spreadsheetId, info, alt, zeile });
    return { ...r, orderId, commission: g.commission, dateiname, protokollZeile };
  });
}

// ── Einrichtung (scripts/setup-lshop-edi-reiter.js) ─────────────────────────

export const TESTDATEI_ZEILE = {
  order_id: 'JFN-2026-0001', Erzeugt: '2026-09-21', Status: 'Testdatei', Positionen: '', Stueck: '', Commission: '',
  Dateiname: 'JFN-2026-0001_20260921-1600.xml', Korb_Schluessel: '',
  Notiz: 'Testdatei vom 21.09.2026, von L-Shop am 23.09.2026 fehlerfrei verarbeitet (Beispiel-Artikelnummern)',
};
export const CONFIG_BESCHREIBUNG = 'Debitorennummer bei L-Shop für die EDI-Bestelldatei (BO4a), höchstens 8 Zeichen. Nicht ins Postfach.';

/**
 * Reiter LShop_EDI_Dateien (SSOT) mit Kopf + Zeile JFN-2026-0001 und die Config-Zeile
 * lshop.customer_id (Business, Wert leer) anlegen. Idempotent; schreibt nur mit write=true.
 * Gibt nur Zaehler/Texte zurueck - nie den customer_id-Wert.
 */
export async function richteEdiEin({ write = false, sheets: s, jetzt = new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const ssot = process.env.GOOGLE_SHEET_ID, bus = process.env.BUSINESS_SHEET_ID;
  if (!ssot || !bus) throw fehler('GOOGLE_SHEET_ID oder BUSINESS_SHEET_ID fehlt.', 503);
  const log = [];

  // 1. Protokoll-Reiter
  let info = await reiter(sheets, ssot, EDI_TAB);
  if (info) {
    const alt = await werte(sheets, ssot, EDI_TAB);
    const idx = ediSpalten(alt[0]);
    const hatTest = alt.slice(1).some(r => String(r[idx.order_id] ?? '').trim() === TESTDATEI_ZEILE.order_id);
    log.push(`Reiter "${EDI_TAB}" vorhanden (${alt.length - 1} Zeilen), Zeile ${TESTDATEI_ZEILE.order_id} ${hatTest ? 'vorhanden' : 'FEHLT - bitte von Hand pruefen'}.`);
  } else {
    log.push(`Reiter "${EDI_TAB}" fehlt -> ${write ? 'anlegen' : 'wuerde angelegt'}: ${EDI_SPALTEN.join(' | ')} + Zeile ${TESTDATEI_ZEILE.order_id}.`);
    if (write) {
      const { data: add } = await sheets.spreadsheets.batchUpdate({ spreadsheetId: ssot, requestBody: { requests: [
        { addSheet: { properties: { title: EDI_TAB, gridProperties: { rowCount: 200, columnCount: EDI_SPALTEN.length, frozenRowCount: 1 } } } },
      ] } });
      const sheetId = add.replies[0].addSheet.properties.sheetId;
      const kopfUndTest = [EDI_SPALTEN, EDI_SPALTEN.map(n => TESTDATEI_ZEILE[n])];
      await sheets.spreadsheets.values.update({ spreadsheetId: ssot, range: `${q(EDI_TAB)}!A1`, valueInputOption: 'RAW', requestBody: { values: kopfUndTest } });
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: ssot, requestBody: { requests: [
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
      ] } });
      const zurueck = await werte(sheets, ssot, EDI_TAB);
      const ok = !vergleicheZurueck(kopfUndTest, zurueck.slice(0, 2)).length;
      log.push(ok ? `✓ Reiter angelegt, Kopf + ${TESTDATEI_ZEILE.order_id} zurueckgelesen.` : '✗ Zuruecklesen weicht ab.');
      if (!ok) throw fehler(`${EDI_TAB}: Zuruecklesen weicht ab.`, 500);
    }
  }

  // 2. Config-Zeile lshop.customer_id (Business). Ein vorhandener Wert wird nie angefasst.
  const cfgInfo = await reiter(sheets, bus, TAB_CONFIG);
  if (!cfgInfo) throw fehler(`Reiter "${TAB_CONFIG}" fehlt im Business-Sheet.`, 409);
  const cfg = await werte(sheets, bus, TAB_CONFIG);
  const norm = (cfg[0] ?? []).map(normHeader);
  const sp = n => norm.indexOf(normHeader(n));
  const iS = sp('Schlüssel'), iW = sp('Wert');
  if (iS < 0 || iW < 0) throw fehler(`Reiter "${TAB_CONFIG}": Spalten Schlüssel/Wert fehlen.`, 422);
  const da = cfg.slice(1).find(r => String(r[iS] ?? '').trim() === CONFIG_CUSTOMER_ID);
  if (da) {
    log.push(`Config "${CONFIG_CUSTOMER_ID}" vorhanden, Wert ${String(da[iW] ?? '').trim() ? 'gesetzt' : 'leer'} - nicht angefasst.`);
  } else {
    const zeile = Array(cfg[0].length).fill('');
    zeile[iS] = CONFIG_CUSTOMER_ID;
    if (sp('Beschreibung') >= 0) zeile[sp('Beschreibung')] = CONFIG_BESCHREIBUNG;
    if (sp('Geändert-Am') >= 0) zeile[sp('Geändert-Am')] = jetzt.toISOString().slice(0, 10);
    const start = ersteFreieZeile(cfg);
    log.push(`Config "${CONFIG_CUSTOMER_ID}" fehlt -> ${write ? 'anlegen' : 'wuerde angelegt'} in Zeile ${start} (Wert leer, mit Beschreibung).`);
    if (write) {
      const ende = colLetter(zeile.length - 1);
      const { data: um } = await sheets.spreadsheets.values.get({ spreadsheetId: bus, range: `${q(TAB_CONFIG)}!A${start - 1}:${ende}${start + 1}` });
      const umgebung = um.values ?? [];
      if (vergleicheZurueck([(cfg[start - 2] ?? []).slice(0, zeile.length)], [umgebung[0] ?? []]).length || !bereichLeer(umgebung.slice(1))) {
        throw fehler(`${TAB_CONFIG}: Umgebung von Zeile ${start} hat sich geaendert - nichts geschrieben.`, 409);
      }
      const range = `${q(TAB_CONFIG)}!A${start}:${ende}${start}`;
      await sheets.spreadsheets.values.update({ spreadsheetId: bus, range, valueInputOption: 'RAW', requestBody: { values: [zeile] } });
      const { data: z } = await sheets.spreadsheets.values.get({ spreadsheetId: bus, range });
      const ok = !vergleicheZurueck([zeile], z.values ?? []).length;
      log.push(ok ? `✓ Config-Zeile ${start} angelegt und zurueckgelesen (Wert leer).` : '✗ Config-Zeile weicht beim Zuruecklesen ab.');
      if (!ok) throw fehler(`${TAB_CONFIG}: Zuruecklesen weicht ab.`, 500);
    }
  }
  return { write, log };
}
