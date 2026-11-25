import { Router } from 'express';
import { seitenGrenze, seitenListe } from '../lib/hosterPruefseite.js';
import { shopSpalte, gleicherShop } from '../utils/shop-spalte.js';

// DT1: Der Router hat keine Endpunkte mehr (L-Shop-Weg seit GT1, DTF-Liste seit DT1 entfernt). Er bleibt eingebunden, damit
// psZeilenFinden und offeneBestellungen an einer Stelle bleiben.
const router = Router();

// Spalten-Indizes Produktions_Status (0-basiert). Die Spalte "Shop" (NAV3)
// haengt hinten und wird ueber den Namen gefunden (utils/shop-spalte.js);
// deshalb lesen alle Zugriffe die ganze Breite (A1:Z).
const PI = { orderId: 0, wcItemId: 1, artikelname: 2, sku: 3, menge: 4, lshop: 5, dtf: 6 };
// Spalten-Indizes Varianten (0-basiert)
// Varianten: nur über Spaltennamen (utils/varianten-zeilen.js → wcVariationMap).

/**
 * Welche Produktions_Status-Zeilen gehoeren zu dieser Bestellung?
 *
 * 1. Mit {orderId, wcItemId}-Paaren: exakt, wie bisher.
 * 2. Ohne Paare wurde frueher der ARTIKELNAME per Teilstring gegen den Teil
 *    hinter dem "/" der Artikelnummer geprueft:
 *      artikelname.includes(artikelnummer.split('/').pop())
 *    Das setzte voraus, dass hinter dem "/" der Produkttitel steht - genau das
 *    Schema, das S2 abschafft. Mit "JH030/UglySw01" traefe der Vergleich nie
 *    mehr, und ein kurzes Kuerzel koennte zufaellig fremde Zeilen treffen.
 *    Neu: exakt gegen die SKU-Spalte, die bereits die volle Artikelnummer
 *    fuehrt. Der alte Namensvergleich greift nur noch, wo diese Spalte LEER
 *    ist - also fuer Altzeilen, die sonst nicht mehr gefunden wuerden.
 */
export function psZeilenFinden(psRows, { orderIds = [], artikelnummer = '', wcItemIds = [], shop }) {
  const treffer = [];
  // NAV3: nur Zeilen des Shops der Anfrage (leer/ohne Spalte = JFN).
  const si = shopSpalte(psRows[0]);

  if (Array.isArray(wcItemIds) && wcItemIds.length > 0) {
    const pairSet = new Set(wcItemIds.map(({ orderId, wcItemId }) => `${orderId}|${wcItemId}`));
    psRows.slice(1).forEach((r, i) => {
      if (!gleicherShop(r, si, shop)) return;
      const key = `${(r[PI.orderId] ?? '').trim()}|${(r[PI.wcItemId] ?? '').trim()}`;
      if (pairSet.has(key)) treffer.push(i + 2); // +1 Header, +1 1-Basierung
    });
    return treffer;
  }

  const orderIdSet = new Set(orderIds.map(String));
  const artNr = String(artikelnummer ?? '').trim();
  const kurz  = artNr.split('/').pop();

  psRows.slice(1).forEach((r, i) => {
    if (!gleicherShop(r, si, shop)) return;
    if (!orderIdSet.has((r[PI.orderId] ?? '').trim())) return;
    const rowSku = (r[PI.sku] ?? '').trim();
    if (rowSku) {
      if (rowSku === artNr) treffer.push(i + 2);
      return;
    }
    if (kurz && (r[PI.artikelname] ?? '').trim().includes(kurz)) treffer.push(i + 2);
  });
  return treffer;
}

// Offene Bestellungen eines Shops: Status nacheinander, alle Seiten. Frueher drei
// gleichzeitige Abrufe mit je 100 ohne Seitenschleife - bei der Hoster-Pruefseite
// liefen alle drei in sie hinein, ab 100 offenen fehlten Positionen.
const OFFEN_STATUS = ['pending', 'processing', 'on-hold'];
export async function offeneBestellungen(wc) {
  const alle = [];
  for (const status of OFFEN_STATUS) {
    for (let page = 1; ; page++) {
      seitenGrenze(page, { wc, pfad: 'orders' });
      const liste = seitenListe((await wc.get('orders', { status, per_page: 100, page })).data, { wc, pfad: 'orders' });
      alle.push(...liste);
      if (liste.length < 100) break;
    }
  }
  return alle;
}

// DT1 (Inhaber 25.11.): die alte DTF-Liste (dtf/offen, protokoll, bestellen, bestellen-bulk -> DTF_Bestellungen) ist entfernt;
// DTF laeuft ueber den DTF-Warenkorb (routes/dtf.js). DTF_Bestellungen und die Spalte DTF_bestellt bleiben als Archiv.

export default router;
