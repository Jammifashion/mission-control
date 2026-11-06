// L-Shop-Rueckstandsliste (RS1) - NUR LESEN: neueste Datei aus dem Drive-Ordner "L-Shop Rueckstandsliste" (geteilte Ablage
// "Mission Control", Apps Script des Inhabers legt sie jeden Mittwoch ab), Logik in utils/rueckstand.js.
// GET /api/bestellen/rueckstand. Nichts wird gespeichert (kein Sheet): die Datei wird im Speicher gelesen und nach Datei-ID +
// Aenderungszeit zwischengespeichert; neu geladen wird nur bei neuer Datei (Ordnerliste hoechstens alle 10 min).
// Spalten P-T (Empfaenger/Adresse) liest der Parser nie; Kommission/Kunden-Nr. verlassen das Backend nie; Log nur Zahlen.

import { google } from 'googleapis';
import JSZip from 'jszip';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { korbZeilen, TAB_KORB } from '../utils/korb-logic.js';
import { referenzFuer } from '../utils/edi-bestellung.js';
import { berlinDatum } from '../utils/berlin-tag.js';
import {
  leseXlsxZeilen, rueckstandPositionen, zuordnen, rueckstandAntwort, neuesteListe, listenDatum, alterTage, VERALTET_TAGE,
} from '../utils/rueckstand.js';

// Ordner (Inhaber 06.11.). Keine Zugangsdaten - nur die Ablage-Adresse; per Umgebung ueberschreibbar.
export const RUECKSTAND_ORDNER_ID = process.env.RUECKSTAND_ORDNER_ID || '1o70xXT2PhZgqxuI8SM_idOHJdJxTlrtR';
const TAB_EDI = 'LShop_EDI_Dateien';
const LISTE_MS = 10 * 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;
const fehler = (msg, status = 502, code) => Object.assign(new Error(msg), { status, ...(code ? { code } : {}) });
const t = v => String(v ?? '').trim();

let ordnerCache = { bis: 0, dateien: null };
let dateiCache = { key: '', positionen: null };
export const _rueckstandCacheLeeren = () => { ordnerCache = { bis: 0, dateien: null }; dateiCache = { key: '', positionen: null }; };

async function driveClient() { return google.drive({ version: 'v3', auth: await getGoogleAuth() }); }   // drive.readonly
async function sheetsClient() { return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() })); }

async function ordnerDateien(drive) {
  if (ordnerCache.dateien && Date.now() < ordnerCache.bis) return ordnerCache.dateien;
  const { data } = await drive.files.list({
    q: `'${RUECKSTAND_ORDNER_ID}' in parents and trashed = false`, fields: 'files(id,name,modifiedTime,size)', pageSize: 200,
    supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: 'allDrives',
  });
  ordnerCache = { bis: Date.now() + LISTE_MS, dateien: data.files ?? [] };
  return ordnerCache.dateien;
}

async function dateiPositionen(drive, datei) {
  const key = `${datei.id}|${datei.modifiedTime}`;
  if (dateiCache.key === key && dateiCache.positionen) return dateiCache.positionen;
  if (Number(datei.size) > MAX_BYTES) throw fehler('Rückstandsliste ist unerwartet groß – nicht gelesen.', 422, 'rueckstand_datei');
  const res = await drive.files.get({ fileId: datei.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  const positionen = rueckstandPositionen(await leseXlsxZeilen(Buffer.from(res.data), JSZip));
  dateiCache = { key, positionen };
  return positionen;
}

/** Korb (mit Referenz je Position) und unsere order_ids - nur gelesen. */
async function mcDaten(sheets, spreadsheetId) {
  const { data } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: [`'${TAB_KORB}'`, `'${TAB_EDI}'`] });
  const [korbWerte, ediWerte] = (data.valueRanges ?? []).map(v => v.values ?? []);
  const korb = korbZeilen(korbWerte).zeilen.map(z => ({ ...z, referenz: referenzFuer(z) }));
  const [kopf = [], ...rows] = ediWerte;
  const i = kopf.findIndex(h => /^order_?id$/i.test(t(h)));
  return { korb, edi: new Set(i < 0 ? [] : rows.map(r => t(r[i])).filter(Boolean)) };
}

/**
 * Rueckstand fuer die Anzeige: { liste: { name, datum, alterTage, veraltet } | null, hinweis, positionen, je, zahlen }.
 * Ordner leer -> liste null + Hinweis (kein Fehler). Drive/Datei kaputt -> 502/422 mit Text ohne Inhalte.
 */
export async function leseRueckstand({ drive: d, sheets: s, spreadsheetId = process.env.GOOGLE_SHEET_ID, jetzt = new Date() } = {}) {
  const drive = d ?? await driveClient();
  let dateien;
  try { dateien = await ordnerDateien(drive); } catch (e) { throw fehler(`Rückstands-Ordner nicht lesbar (${e?.code ?? e?.status ?? 'Fehler'}).`, 502, 'rueckstand_ordner'); }
  const datei = neuesteListe(dateien);
  if (!datei) return { liste: null, hinweis: 'Noch keine Rückstandsliste im Ordner „L-Shop Rueckstandsliste“.', positionen: [], je: { korb: {}, auftrag: {}, shop: {} }, zahlen: { positionen: 0, stueck: 0, kritisch: 0, ohneBezug: 0 } };
  const datum = listenDatum(datei.name);
  const alter = alterTage(datum, berlinDatum(jetzt));
  const positionen = await dateiPositionen(drive, datei);
  const sheets = s ?? await sheetsClient();
  const { korb, edi } = await mcDaten(sheets, spreadsheetId);
  const antwort = rueckstandAntwort(zuordnen(positionen, { korb, edi }));
  const veraltet = alter !== null && alter > VERALTET_TAGE;
  return {
    liste: { name: datei.name, datum, alterTage: alter, veraltet }, ...antwort,
    hinweis: veraltet ? `Rückstandsliste veraltet (letzte vom ${datum.split('-').reverse().join('.')}) – Script oder Mail ausgefallen?` : '',
  };
}
