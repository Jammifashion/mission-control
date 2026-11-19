// Nachtragen fehlender Verkaufszeilen: eine Bestellung hatte dieselbe Position (gleicher Artikelname, gleiche
// Variante) mehrfach, der alte Sync-Schluessel (Bestellung | Artikel | Variante | Partner) schrieb nur eine Zeile.
// Reine Logik, ohne Sheets/Shop (lib/nachtragPositionen.js, scripts/nachtragen-positionen.js).

import { SPALTE_POSITION } from './sync-logic.js';

const t = v => String(v ?? '').trim();
const varianteKey = v => (t(v) === '' ? '0' : t(v));
const artikelName = item => item.name || item.sku || String(item.product_id);

/**
 * Fehlende Positionen einer Shop-Bestellung gegen die vorhandenen Zeilen.
 * Betrachtet nur Gruppen (Partner + Artikel + Variante), fuer die es schon mindestens eine Zeile gibt - neue,
 * nie erfasste Positionen sind Sache des Syncs. Vorhandene Zeilen mit Positions-ID decken genau ihre Position,
 * Altzeilen ohne Positions-ID decken die ersten noch offenen gleichen Positionen (Reihenfolge der Bestellung).
 * @param {object}   o
 * @param {object}   o.order      Shop-Bestellung (line_items mit id)
 * @param {any[][]}  o.zeilen     alle Zeilen des Reiters (ohne Kopf)
 * @param {(c:string)=>number} o.vh
 * @param {{ bestellung: string, artikel: string }} o.spalten
 * @returns {{ item: object, partnerId: string }[]}
 */
export function fehlendePositionen({ order, zeilen, vh, spalten }) {
  const iPos = vh(SPALTE_POSITION), iSt = vh('Storno-Status');
  const eigene = (zeilen ?? []).filter(r => t(r[vh(spalten.bestellung)]) === t(order.id) && (iSt === -1 || t(r[iSt]) === ''));
  const gruppen = new Map();   // partner|artikel|variante -> { partnerId, pos:Set, alt:number }
  for (const r of eigene) {
    const partnerId = t(r[vh('Partner-ID')]);
    const art = t(r[vh(spalten.artikel)]), vari = varianteKey(r[vh('Variante')]);
    const k = JSON.stringify([partnerId, art, vari]);
    const g = gruppen.get(k) ?? { partnerId, art, vari, pos: new Set(), alt: 0 };
    const p = iPos === -1 ? '' : t(r[iPos]);
    if (p) g.pos.add(p); else g.alt++;
    gruppen.set(k, g);
  }
  const fehlend = [];
  for (const g of gruppen.values()) {
    const offen = (order.line_items ?? []).filter(i => t(artikelName(i)) === g.art && varianteKey(i.variation_id || 0) === g.vari
      && !g.pos.has(t(i.id)));
    // Altzeilen decken die ersten offenen Positionen; ohne Positions-ID vom Shop kann nichts zugeordnet werden.
    for (const item of offen.slice(g.alt)) {
      if (t(item.id) === '') continue;
      fehlend.push({ item, partnerId: g.partnerId });
    }
  }
  return fehlend;
}

/** Bestellnummern mit mindestens einer Verkaufszeile (ohne Gegenbuchungen), optional gefiltert. */
export function bestellungenMitZeilen(zeilen, vh, spalten, nur = null) {
  const iSt = vh('Storno-Status');
  const ids = new Set((zeilen ?? []).filter(r => iSt === -1 || t(r[iSt]) === '').map(r => t(r[vh(spalten.bestellung)])).filter(Boolean));
  return [...ids].filter(id => !nur || nur.has(id));
}
