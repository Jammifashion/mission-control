// Versandmethode (method_id) für bestehende FP_Verkäufe-Zeilen nachtragen (VP1).
// Neue Zeilen schreibt der Sync (routes/festpreis-portal.js, Spalte W) selbst.
// Shop nur über getWcClient, Bestellungen über include (100 je Abruf), nur GET.
import { seitenListe } from './hosterPruefseite.js';
import { versandmethodeAus, VERSANDMETHODE } from '../utils/festpreis-verpackung.js';

export const TAB_FP_VERKAEUFE = 'FP_Verkäufe';
export const SPALTE_W = 22;

/**
 * Plant den Nachtrag: Zeilen (ab `abDatum`, optional Partner) mit leerer
 * Versandmethode und ihre Bestell-IDs. Rein, ohne Abruf.
 * @param {string[]} header
 * @param {Array<Array>} rows   Zeilen mit _sheetRow
 */
export function planeVersandNachtrag(header, rows, { partnerId = null, ab = null } = {}) {
  const h = col => header.indexOf(col);
  const iVm = h(VERSANDMETHODE);
  const parse = s => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s ?? ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  const zeilen = rows.filter(r => {
    if (partnerId && (r[h('Partner-ID')] ?? '') !== partnerId) return false;
    if (iVm !== -1 && String(r[iVm] ?? '').trim() !== '') return false;
    const d = parse(r[h('Datum')]);
    return !ab || (d && d >= ab);
  });
  const ids = [...new Set(zeilen.map(r => String(r[h('WC-Bestellnummer')] ?? '')).filter(Boolean))];
  return { zeilen, ids };
}

/** Liest Versandmethoden je Bestell-ID. drossel() vor jedem Abruf. */
export async function ladeVersandmethoden(wc, ids, drossel) {
  const methode = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const teil = ids.slice(i, i + 100);
    await drossel();
    const liste = seitenListe((await wc.get('orders', { include: teil.join(','), per_page: 100 })).data, { wc, pfad: 'orders' });
    for (const o of liste) methode.set(String(o.id), versandmethodeAus(o));
  }
  return { methode, fehlend: ids.filter(id => !methode.has(id)) };
}
