// Produzenten-Bestellung der Trikots (TR3) - Ein-/Ausgabe, Logik in utils/trikot-formular.js.
//
// POST /api/bestellen/trikots/formular/vorschau  { auswahl:[{id,zeile}] }  -> Kopf, Positionen, Zaehler (schreibt nichts)
// POST /api/bestellen/trikots/formular/datei     { auswahl }               -> .xlsx (nur an den Browser, nirgends abgelegt)
// POST /api/bestellen/trikots/formular/eintragen { auswahl, charge }       -> NUR P (Charge) + Q (Bestellt_Am), unter Sperre
//
// Die Nummer im Download ist vorlaeufig; fest wird sie erst beim Eintragen (hoechste Charge + 1, direkt
// vor dem Schreiben neu gelesen). Kein append, RAW, zurueckgelesen. Shop: nur die Namen der Produkt-IDs
// aus Trikot_Artikel (getWcClient, 10 min Zwischenspeicher).

import ExcelJS from 'exceljs';
import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { getWcClient } from './shopConfig.js';
import { TAB_TRIKOTS, trikotZeilen } from '../utils/trikot-ansicht.js';
import {
  TAB_ARTIKEL, FORMULAR, KOPF_BESCHRIFTUNG, TABELLE_KOPF, formularZuordnung, formularPositionen, sortierePositionen,
  zaehleJeGroesse, naechsteCharge, bestellNummer, dateiName, tagWerte, eintragPlan,
} from '../utils/trikot-formular.js';

const fehler = (msg, status, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
const CACHE_MS = 10 * 60 * 1000;
let namenCache = { bis: 0, namen: null };

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}
function spreadsheetId() {
  const id = process.env.BUSINESS_SHEET_ID;
  if (!id) throw fehler('BUSINESS_SHEET_ID fehlt.', 503);
  return id;
}

/** Shop-Namen der Produkt-IDs (nacheinander, je eine Anfrage), 10 min zwischengespeichert. */
async function shopNamen(ids, wc) {
  if (namenCache.namen && Date.now() < namenCache.bis && ids.every(i => namenCache.namen.has(i))) return namenCache.namen;
  const namen = new Map();
  for (const id of ids) {
    const { data } = await wc.get(`products/${id}`, { _fields: 'id,name' });
    if (!data || typeof data !== 'object' || !data.name) throw fehler(`Produkt ${id} im Shop nicht lesbar.`, 502);
    namen.set(id, String(data.name).trim());
  }
  namenCache = { bis: Date.now() + CACHE_MS, namen };
  return namen;
}
export const _leereNamenCache = () => { namenCache = { bis: 0, namen: null }; };

async function ladeKontext({ sheets, wc }) {
  const id = spreadsheetId();
  const { data } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: id, ranges: [`'${TAB_TRIKOTS}'`, `'${TAB_ARTIKEL}'`], valueRenderOption: 'FORMATTED_VALUE',
  });
  const [tri, art] = (data.valueRanges ?? []).map(v => v.values ?? []);
  const iId = (art[0] ?? []).findIndex(h => String(h).trim() === 'Produkt-ID');
  const ids = [...new Set(art.slice(1).map(r => String(r[iId] ?? '').trim()).filter(Boolean))];
  const zuordnung = formularZuordnung(art, await shopNamen(ids, wc));
  return { werte: tri, zeilen: trikotZeilen(tri).zeilen, zuordnung };
}

/** Auswahl pruefen: nur offene Zeilen (Charge leer), Zeilen-ID wie gesehen. */
function gewaehlte(zeilen, auswahl) {
  if (!Array.isArray(auswahl) || !auswahl.length) throw fehler('Keine Trikots gewählt.', 400);
  const nachZeile = new Map(zeilen.map(z => [z.zeile, z]));
  const probleme = [], gew = [];
  for (const a of auswahl) {
    const z = nachZeile.get(Number(a?.zeile));
    if (!z || z.id !== String(a?.id ?? '').trim()) { probleme.push({ zeile: a?.zeile, text: `Zeile ${a?.zeile} hat sich geändert – bitte neu laden.` }); continue; }
    if (z.charge) { probleme.push({ zeile: z.zeile, text: `Zeile ${z.zeile} ist schon in Bestellung ${z.charge}.` }); continue; }
    gew.push(z);
  }
  return { gew, probleme };
}

async function baueVorschau({ auswahl, sheets, wc, jetzt }) {
  const k = await ladeKontext({ sheets, wc });
  const { gew, probleme } = gewaehlte(k.zeilen, auswahl);
  const positionen = sortierePositionen(formularPositionen(gew, k.zuordnung));
  const charge = naechsteCharge(k.werte);
  const heute = tagWerte(jetzt), liefer = tagWerte(jetzt, FORMULAR.lieferTage);
  return {
    charge, nummer: bestellNummer(charge, jetzt), dateiname: dateiName(charge), vorlaeufig: true,
    kopf: { bestelltAm: heute.text, lieferung: liefer.text, team: FORMULAR.team, nummer: bestellNummer(charge, jetzt), wiederholung: FORMULAR.wiederholung },
    positionen, zaehler: zaehleJeGroesse(positionen), probleme,
    ohneZuordnung: positionen.filter(p => p.fehler.includes('ohne_zuordnung')).map(p => p.zeile),
    einrichtung: k.zuordnung.fehlend,
    _tage: { heute, liefer },
  };
}

export async function formularVorschau({ auswahl, sheets: s, wc = getWcClient('jfn'), jetzt = new Date() } = {}) {
  const { _tage, ...v } = await baueVorschau({ auswahl, sheets: s ?? await sheetsClient(), wc, jetzt });
  return v;
}

// ── xlsx wie das Muster (Blatt "Sheet1", Kopf D1-D5, Tabelle ab Zeile 7) ──
const GELB = 'FFFFF2CC', GOLD = 'FFFFCC00';   // wie im Muster (Excel-Farben 13431551 / 52479)
const RAND = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
// Breiten des Musters (Excel zeigt 7.14 ...); Excel zieht beim Oeffnen ~0.71 Rand ab, deshalb hier +0.71.
export const MUSTER_BREITEN = [7.14, 25.57, 10.71, 10, 13.43, 16.43, 10, 20.71].map(b => Math.round((b + 0.71) * 100) / 100);
export const LETZTE_RAHMENZEILE = 249;   // im Muster sind die Rahmen bis hier vorgezeichnet

export async function baueXlsx({ kopf, positionen, tage }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.columns = MUSTER_BREITEN.map(width => ({ width }));
  const fuell = farbe => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: farbe } });
  // Kopfbereich wie im Muster: A-E (Zeile 1 A-H) Calibri 12 fett, linksbuendig; Zeilen 1/3/5 A-E hellgelb.
  for (let r = 1; r <= 6; r++) {
    ws.getRow(r).height = 15.75;
    for (let s = 1; s <= (r === 1 ? 8 : 5); s++) {
      const c = ws.getCell(r, s);
      c.font = { name: 'Calibri', size: 12, bold: true };
      if (r <= 5 && s <= 5) c.alignment = { horizontal: 'left' };
      if (r <= 5 && r % 2 === 1 && s <= 5) c.fill = fuell(GELB);
    }
  }
  const werte = [tage.heute.utc, tage.liefer.utc, kopf.team, kopf.nummer, kopf.wiederholung];
  KOPF_BESCHRIFTUNG.forEach((text, i) => {
    const r = i + 1;
    ws.getCell(r, 1).value = text;
    const d = ws.getCell(r, 4);
    if (r <= 2) {
      d.value = new Date(werte[i]); d.numFmt = 'dd.mm.yyyy'; d.alignment = { horizontal: 'center' };
      ws.mergeCells(r, 4, r, 5);
    } else {
      d.value = String(werte[i]); d.alignment = { horizontal: 'left' };
    }
  });
  const kopfZeile = ws.getRow(7);
  kopfZeile.height = 12;
  TABELLE_KOPF.forEach((text, i) => {
    const c = kopfZeile.getCell(i + 1);
    c.value = text; c.font = { name: 'Calibri', size: 9, bold: true }; c.fill = fuell(GOLD);
    c.alignment = { horizontal: 'center', vertical: 'bottom' }; c.border = RAND;
  });
  const letzte = Math.max(LETZTE_RAHMENZEILE, 7 + positionen.length);
  for (let r = 8; r <= letzte; r++) {
    const row = ws.getRow(r);
    row.height = 15;
    const p = positionen[r - 8];
    const daten = p ? [1, p.artikel, p.kragen, p.material, /^\d+$/.test(p.groesse) ? Number(p.groesse) : p.groesse, p.name, p.nummer, ''] : [];
    for (let s = 1; s <= 8; s++) {
      const c = row.getCell(s);
      if (p) c.value = daten[s - 1] === '' ? null : daten[s - 1];
      c.font = { name: 'Calibri', size: 8 };
      c.alignment = s === 8 ? { horizontal: 'left', vertical: 'bottom', wrapText: true } : { horizontal: 'center', vertical: 'bottom' };
      c.border = RAND;
      if (s === 7) c.numFmt = '@';   // Nummer als Text ("07" bleibt)
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function formularDatei({ auswahl, sheets: s, wc = getWcClient('jfn'), jetzt = new Date() } = {}) {
  const v = await baueVorschau({ auswahl, sheets: s ?? await sheetsClient(), wc, jetzt });
  if (v.probleme.length) throw fehler('Auswahl hat sich geändert – bitte neu laden.', 409, { probleme: v.probleme });
  if (v.einrichtung.length) throw fehler(`Einrichtung fehlt: ${v.einrichtung.join(', ')} in ${TAB_ARTIKEL}.`, 409, { code: 'einrichtung' });
  if (v.ohneZuordnung.length) throw fehler(`Ohne Zuordnung zu einem Produkt: Zeile ${v.ohneZuordnung.join(', ')}.`, 422, { code: 'ohne_zuordnung' });
  if (!v.positionen.length) throw fehler('Keine Trikots gewählt.', 400);
  return { dateiname: v.dateiname, buffer: await baueXlsx({ kopf: v.kopf, positionen: v.positionen, tage: v._tage }) };
}

// ── Eintragen: eine Sperre je Instanz; ueber Instanzen hinweg schuetzen "P/Q leer" + "Nummer frei" ──
let laeuft = false;
export async function alsBestelltEintragen({ auswahl, charge, sheets: s, jetzt = new Date() } = {}) {
  if (laeuft) throw fehler('Eintragen läuft gerade – gleich noch einmal versuchen.', 409, { code: 'laeuft_gerade' });
  laeuft = true;
  try {
    const sheets = s ?? await sheetsClient();
    const id = spreadsheetId();
    const lies = async (o = 'UNFORMATTED_VALUE') => (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${TAB_TRIKOTS}'`, valueRenderOption: o })).data.values ?? [];
    const vorher = await lies();
    const heute = tagWerte(jetzt);
    const plan = eintragPlan(vorher, auswahl, { charge, serial: heute.serial });
    if (plan.probleme.length) throw fehler(plan.probleme[0].text, 409, { probleme: plan.probleme, code: 'nicht_eingetragen' });
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'RAW', data: plan.zellen } });
    const nachher = await lies();
    const fmt = await lies('FORMATTED_VALUE');
    const abw = [];
    for (const z of plan.zellen) {
      const [, ref] = z.range.split('!');
      const sp = ref.charCodeAt(0) - 65, zeile = Number(ref.slice(1));
      if (nachher[zeile - 1]?.[sp] !== z.values[0][0]) abw.push(ref);
    }
    // Ganz Reiter: nur die geplanten Zellen duerfen sich geaendert haben.
    const geplant = new Set(plan.zellen.map(z => z.range.split('!')[1]));
    for (let r = 0; r < Math.max(vorher.length, nachher.length); r++) {
      for (let c = 0; c < Math.max(vorher[r]?.length ?? 0, nachher[r]?.length ?? 0); c++) {
        const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
        if (!geplant.has(ref) && String(vorher[r]?.[c] ?? '') !== String(nachher[r]?.[c] ?? '')) abw.push(`${ref} (fremd)`);
      }
    }
    const qSp = plan.spalten.Q.charCodeAt(0) - 65;
    const ohneDatumsformat = plan.zellen.filter(z => z.range.includes(`!${plan.spalten.Q}`))
      .map(z => Number(z.range.split('!')[1].slice(1))).filter(zeile => !/^\d{2}\.\d{2}\.\d{4}$/.test(String(fmt[zeile - 1]?.[qSp] ?? '')));
    // Q ohne Datumsformat (zeigt sonst die Seriennummer): nur das Format dieser Zellen setzen, wie die
    // vorhandenen Bestellt_Am-Werte (dd.mm.yyyy). Der Wert bleibt.
    if (ohneDatumsformat.length) {
      const { data: m } = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(sheetId,title)' });
      const sheetId = m.sheets.find(x => x.properties.title === TAB_TRIKOTS)?.properties.sheetId;
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: ohneDatumsformat.map(zeile => ({ repeatCell: {
        range: { sheetId, startRowIndex: zeile - 1, endRowIndex: zeile, startColumnIndex: qSp, endColumnIndex: qSp + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd.mm.yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } })) } });
    }
    return {
      charge: Number(charge), nummer: bestellNummer(charge, jetzt), bestelltAm: heute.text,
      zeilen: plan.zellen.length / 2, rueckgelesen: !abw.length, abweichungen: abw, ohneDatumsformat,
    };
  } finally { laeuft = false; }
}
