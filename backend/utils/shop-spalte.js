// Spalte "Shop" in den SSOT-Reitern mit Bestellbezug (NAV3):
// Produktions_Status, LShop_Bestellungen, DTF_Bestellungen.
//
// JFN- und HonkShop-Bestellnummern sind WordPress-Beitrags-IDs zweier
// getrennter Installationen und koennen gleich sein. Jede Zeile traegt deshalb
// den Shop; Schluessel ist Shop + Bestellnummer (+ Position).
//
// Die Spalte haengt HINTEN an der Kopfzeile und wird nur ueber den Namen
// gefunden. Ist die Zelle leer, gilt JFN - das ist der Altbestand. Fehlt die
// Spalte noch ganz, verhaelt sich der Code wie vor NAV3 (kein Filter). So
// vertraegt er beide Reihenfolgen von Deploy und Sheet-Umstellung.

import { normalizeShop } from '../lib/shopConfig.js';

export const SHOP_SPALTE = 'Shop';

// Wert im Sheet: "JFN" | "HONK".
export const shopWert = shop => normalizeShop(shop).toUpperCase();

// Spaltenindex der Kopfzeile oder -1.
export function shopSpalte(header) {
  return (header ?? []).findIndex(h => String(h ?? '').trim() === SHOP_SPALTE);
}

// Shop einer Datenzeile: 'jfn' | 'honk'. Leer oder ohne Spalte = 'jfn'.
export function shopDerZeile(row, idx) {
  if (idx < 0) return 'jfn';
  const v = String(row?.[idx] ?? '').trim();
  return v ? normalizeShop(v) : 'jfn';
}

// Gehoert die Zeile zum Shop? Ohne Spalte filtert nichts (Verhalten wie vor
// NAV3): HONK liesse sich dann nicht speichern, ein Filter wuerde bei jedem
// Aufklappen einer HONK-Bestellung neue Zeilen anlegen.
export function gleicherShop(row, idx, shop) {
  if (idx < 0) return true;
  return shopDerZeile(row, idx) === normalizeShop(shop);
}

// Neue Zeile fuer append: Shop an die Position der Spalte. Ohne Spalte
// bleibt die Zeile wie bisher (leer = JFN beim Lesen).
export function zeileMitShop(row, idx, shop) {
  if (idx < 0) return row;
  const r = [...row];
  while (r.length < idx) r.push('');
  r[idx] = shopWert(shop);
  return r;
}

// Gleiche Normalisierung wie fuer den WC-Client (unbekannt/fehlt = jfn).
export { normalizeShop };
