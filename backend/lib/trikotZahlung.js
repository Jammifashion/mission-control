// TR9: Bezahlstand der offenen Trikot-Bestellungen aus dem JFN-Shop - gesammelt (include, 1 Abruf je 100, nacheinander),
// 10 min Zwischenspeicher je Order-ID, nur Status + date_paid. Nur lesen; Pruefseite/Zeitlimit -> Ansicht ohne Bezahlstand.
import { getWcClient, getShopConfig } from './shopConfig.js';
import { seitenListe, wirfWennPruefseite } from './hosterPruefseite.js';
import { offeneOrderIds, mitZahlung, ZAHLUNG_FELDER } from '../utils/trikot-zahlung.js';

const BLOCK = 100;
/** Bestellungen gesammelt (include, nacheinander, je 100 ein Abruf), nur id/status/date_paid. */
async function ladeBestellungen(ids) {
  const wc = getWcClient('jfn');
  const map = new Map();
  for (let i = 0; i < ids.length; i += BLOCK) {
    const teil = ids.slice(i, i + BLOCK);
    const liste = seitenListe((await wc.get('orders', { include: teil.join(','), status: 'any', per_page: BLOCK, _fields: ZAHLUNG_FELDER })).data, { wc, pfad: 'orders' });
    for (const o of liste) map.set(String(o.id), o);
  }
  return map;
}

export const ZAHLUNG_CACHE_MS = 10 * 60 * 1000;
let cache = new Map();   // Order-ID -> { bis, o }
export const trikotZahlungCacheLeeren = () => { cache = new Map(); };

/** Ansicht (aus leseTrikotAnsicht) + Bezahlstand. `laden(ids)` nur fuer Tests (sonst Shop). */
export async function mitTrikotZahlung(ansicht, { jetzt = Date.now(), laden } = {}) {
  const ids = offeneOrderIds(ansicht);
  const fehlen = ids.filter(id => !(cache.get(id)?.bis > jetzt));
  try {
    if (fehlen.length) {
      const map = await (laden ?? ladeBestellungen)(fehlen);
      for (const id of fehlen) cache.set(id, { bis: jetzt + ZAHLUNG_CACHE_MS, o: map.get(id) ?? null });
    }
  } catch (err) {
    wirfWennPruefseite(err);
    return mitZahlung(ansicht, null, '', 'Bezahlstand gerade nicht lesbar (Shop) – bitte später neu laden.');
  }
  const je = new Map(ids.map(id => [id, cache.get(id)?.o ?? null]));
  return mitZahlung(ansicht, je, getShopConfig('jfn').wcUrl);
}
