// L-Shop-Bestellungen (BO4d) - Ein-/Ausgabe fuer GET /api/bestellen/lshop-bestellungen, Logik in
// utils/lshop-bestellungen.js. NUR LESEN, nur Sheets: LShop_EDI_Dateien, Warenkorb_LShop, LShop_Modelle,
// LShop_Sendungen. Kein FTP, kein Shop, kein Schreiben. Laedt nur, wenn der Unterreiter offen ist.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { ladeLShopZeilen } from './lshop.js';
import { normalizeShop } from '../utils/shop-spalte.js';
import { TAB_KORB, korbZeilen } from '../utils/korb-logic.js';
import { AB_KORB_SPALTEN } from '../utils/lshop-ab.js';
import { normHeader } from '../utils/sheet-headers.js';
import { EDI_TAB, entwuerfeAus } from '../utils/edi-bestellung.js';
import { SENDUNGEN_TAB, sendungenZeilen } from '../utils/lshop-belege.js';
import { ediBestellZeilen, baueBestellungen } from '../utils/lshop-bestellungen.js';

const q = tab => `'${tab}'`;

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}

/** Reiter lesen; fehlt er, leere Liste (noch nicht eingerichtet). */
async function werteOderLeer(sheets, spreadsheetId, tab, titel) {
  if (!titel.has(tab)) return [];
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: q(tab), valueRenderOption: 'FORMATTED_VALUE' });
  return data.values ?? [];
}

// BO4i: Liefertermin + AB_Hinweis (hinten, optional - fehlen sie, bleibt es leer) an die Korb-Zeilen haengen.
function mitAbFeldern(korbWerte, zeilen) {
  const norm = (korbWerte[0] ?? []).map(normHeader);
  const i = AB_KORB_SPALTEN.map(n => [n, norm.indexOf(normHeader(n))]).filter(([, x]) => x >= 0);
  return zeilen.map(z => ({ ...z, ...Object.fromEntries(i.map(([n, x]) => [n, String(korbWerte[z._zeile - 1]?.[x] ?? '').trim()])) }));
}

export async function leseLShopBestellungen({ shop, sheets: s, jetzt = () => new Date() } = {}) {
  // EDI-Bestellungen gibt es nur fuer JFN (wie Warenkorb und EDI-Datei).
  if (normalizeShop(shop) !== 'jfn') return { nurJfn: true, bestellungen: [], portal: [], entwuerfe: [] };
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) { const e = new Error('GOOGLE_SHEET_ID fehlt.'); e.status = 503; throw e; }
  const sheets = s ?? await sheetsClient();
  const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title)' });
  const titel = new Set((data.sheets ?? []).map(x => x.properties?.title));

  const ediWerte = await werteOderLeer(sheets, spreadsheetId, EDI_TAB, titel);
  const edi = ediBestellZeilen(ediWerte);
  const korbWerte = await werteOderLeer(sheets, spreadsheetId, TAB_KORB, titel);
  const korb = korbWerte.length ? mitAbFeldern(korbWerte, korbZeilen(korbWerte).zeilen).filter(z => normalizeShop(z.Shop || 'jfn') === 'jfn') : [];
  const sWerte = await werteOderLeer(sheets, spreadsheetId, SENDUNGEN_TAB, titel);
  const sendungen = sWerte.length ? sendungenZeilen(sWerte) : [];
  const modelle = new Map((await ladeLShopZeilen({ sheets, spreadsheetId })).map(z => [z.articleNr, z]));
  // BO4e: Entwuerfe (noch nicht gesendet) fuer den Knopf "Als gesendet markieren"; Testdatei nie.
  const entwuerfe = entwuerfeAus(ediWerte, korb, jetzt());
  return { nurJfn: false, ...baueBestellungen({ edi, korb, modelle, sendungen, jetzt: jetzt() }), entwuerfe };
}
