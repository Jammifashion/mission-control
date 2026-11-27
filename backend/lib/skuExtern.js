// SG3: Reiter SKU_Extern (SSOT) fuer den SEO-Weg lesen - nur lesen, ueber Spaltennamen, 5 min Zwischenspeicher.
// Logik und Feldauswahl in utils/sku-extern.js. Nur_intern und Lieferant werden hier nie gelesen.
import { leseReiterSpalten, reiterCache } from './ssot-reiter.js';
import { SPALTEN_EXTERN, OPTIONAL_EXTERN, findeExternZeile, externEingaben, sucheExtern, externNeuPruefen } from '../utils/sku-extern.js';
import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { frischLesen } from './sheetsZentral.js';
import { schreibeNeueZeilen } from './sheet-zeilen.js';
import { ladeLShopZeilen } from './lshop.js';
import { ladeLieferzeiten } from './lieferzeiten.js';

export const TAB_EXTERN = 'SKU_Extern';
const cache = reiterCache();

export async function ladeExternZeilen({ sheets, spreadsheetId = process.env.GOOGLE_SHEET_ID } = {}) {
  const laden = () => leseReiterSpalten({ tab: TAB_EXTERN, spalten: SPALTEN_EXTERN, optional: OPTIONAL_EXTERN, sheets, spreadsheetId });
  return sheets ? laden() : cache.hole(`${TAB_EXTERN}|${spreadsheetId}`, laden);
}

/** Angaben zur Nummer (ArticleNr oder CatalogNr) oder null. */
export async function externFuerNummer(nr, opt = {}) {
  if (!String(nr ?? '').trim()) return null;
  return externEingaben(findeExternZeile(await ladeExternZeilen(opt), nr));
}

/** ZW2 Teil D: Trefferliste fuer die Maske (nur lesen). */
export async function sucheExternArtikel(q, opt = {}) {
  return sucheExtern(await ladeExternZeilen(opt), q);
}

const fehler = (status, code, text) => Object.assign(new Error(text), { status, code });
let laeuft = false;

/**
 * ZW2 Teil D: "als Fremdware anlegen" - EINE neue Zeile in SKU_Extern (ArticleNr, Description, Consistence, Lieferzeit_ID; Rest von Hand).
 * Sperre je Instanz, Reiter frisch gelesen, kein append (schreibeNeueZeilen mit dem gelesenen Stand), RAW, zurueckgelesen.
 */
export async function legeExternAn({ eingabe, sheets: s, spreadsheetId = process.env.GOOGLE_SHEET_ID } = {}) {
  if (laeuft) throw fehler(409, 'laeuft_gerade', 'Wird gerade angelegt – gleich noch einmal.');
  laeuft = true;
  try {
    return await frischLesen(async () => {
      const sheets = s ?? google.sheets({ version: 'v4', auth: await getGoogleAuth() });
      const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_EXTERN}'!A1:ZZ`, valueRenderOption: 'UNFORMATTED_VALUE' });
      const werte = data.values ?? [];
      const kopf = (werte[0] ?? []).map(x => String(x ?? '').trim());
      const idx = n => kopf.indexOf(n);
      const fehlt = ['ArticleNr', 'Description', 'Consistence', 'Lieferzeit_ID'].filter(n => idx(n) < 0);
      if (fehlt.length) throw fehler(409, 'einrichtung', `SKU_Extern: Spalte(n) ${fehlt.join(', ')} fehlen.`);
      const zeilen = werte.slice(1).map(r => ({ articleNr: r[idx('ArticleNr')], catalogNr: idx('CatalogNr') >= 0 ? r[idx('CatalogNr')] : '' }));
      const lshop = new Set((await ladeLShopZeilen({ sheets, spreadsheetId })).map(z => String(z.catalogNr ?? '').trim().toLowerCase()).filter(Boolean));
      let lz = null;
      try { lz = new Set((await ladeLieferzeiten()).map(l => String(l.id ?? '').trim()).filter(Boolean)); } catch { lz = null; }
      const p = externNeuPruefen(eingabe, { zeilen, lshopModelle: lshop, lieferzeiten: lz && lz.size ? lz : null });
      if (p.fehler) throw fehler(p.code === 'schon_da' || p.code === 'lshop' ? 409 : 422, p.code || 'eingabe', p.fehler);
      const zeile = kopf.map(n => p.werte[n] ?? '');
      const nr = await schreibeNeueZeilen(sheets, spreadsheetId, TAB_EXTERN, [zeile], { alt: werte });
      const { data: nach } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_EXTERN}'!A${nr}:ZZ${nr}`, valueRenderOption: 'UNFORMATTED_VALUE' });
      if (String(nach.values?.[0]?.[idx('ArticleNr')] ?? '') !== p.werte.ArticleNr) throw fehler(500, 'ruecklesen', 'Zeile nach dem Schreiben anders gelesen – bitte im Sheet prüfen.');
      cache.leeren();
      return { ok: true, nr: p.werte.ArticleNr, zeile: nr };
    });
  } finally { laeuft = false; }
}
