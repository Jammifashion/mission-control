// PA8 (Variante A aus PA7): der taegliche Abgleich legt fehlende FP_Artikel-Zeilen an - OHNE Artikelkategorie, nie mit
// Festpreis/EK/Handling. Moeglich, weil der FP-Sync seit PA8 Verkaeufe ohne Festpreis-Zuordnung sperrt statt mit 0 zu rechnen.
// Schreiben: eine Sperre je Instanz, FP_Artikel frisch gelesen (UNFORMATTED), Dubletten raus (utils/fp-artikel.js
// `fpAnlagePlan`), kein append (`schreibeNeueZeilen` mit dem gelesenen Stand), zurueckgelesen. Nur IDs in der Antwort.

import { schreibeNeueZeilen } from './sheet-zeilen.js';
import { fpAnlagePlan } from '../utils/fp-artikel.js';

export const TAB_FP_ARTIKEL = 'FP_Artikel';
let laeuft = false;

/**
 * @param {object} o { sheets, sheetId, befund: fpArtikelPruefung().partner }
 * @returns {Promise<{ angelegt: {partnerId, produktId}[] }>}
 */
export async function fpFehlendeAnlegen({ sheets, sheetId, befund }) {
  if (!(befund ?? []).some(p => p.fehlend?.length)) return { angelegt: [] };
  if (laeuft) throw Object.assign(new Error('FP_Artikel wird gerade geschrieben.'), { status: 409, code: 'laeuft_gerade' });
  laeuft = true;
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `'${TAB_FP_ARTIKEL}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    const alt = data.values ?? [];
    const [kopf = [], ...zeilen] = alt;
    const plan = fpAnlagePlan(kopf.map(k => String(k ?? '').trim()), zeilen, befund);
    if (!plan.zeilen.length) return { angelegt: [] };
    await schreibeNeueZeilen(sheets, sheetId, TAB_FP_ARTIKEL, plan.zeilen, { alt });
    return { angelegt: plan.neu };
  } finally { laeuft = false; }
}
