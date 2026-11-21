// SG3: Reiter SKU_Extern (SSOT) fuer den SEO-Weg lesen - nur lesen, ueber Spaltennamen, 5 min Zwischenspeicher.
// Logik und Feldauswahl in utils/sku-extern.js. Nur_intern und Lieferant werden hier nie gelesen.
import { leseReiterSpalten, reiterCache } from './ssot-reiter.js';
import { SPALTEN_EXTERN, OPTIONAL_EXTERN, findeExternZeile, externEingaben } from '../utils/sku-extern.js';

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
