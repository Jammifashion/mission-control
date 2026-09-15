import { getShopConfig, getWcClient } from './shopConfig.js';

// Marke je Shop: Slug aus shopConfig.js → Term aus WooCommerce (product_brand).
//
// Die Term-ID steht bewusst nirgends im Code: sie unterscheidet sich je Shop
// und ändert sich, wenn jemand die Marke im Backend neu anlegt.
// Gecacht je Shop wie /api/woocommerce/categories (30 min). Gecacht wird nur
// ein Treffer - fehlt der Slug, wirft jeder Aufruf erneut, damit eine im
// Backend nachgetragene Marke sofort greift.

const MARKEN_TTL = 30 * 60 * 1000;
const _cache = new Map(); // shop → { marke, at }

export function _resetMarkenCache() { _cache.clear(); }

// Liefert { id, name, slug } oder null, wenn der Shop keine Marke hat.
// Wirft (status 500), wenn der konfigurierte Slug im Shop nicht existiert.
export async function markeFuerShop(shop) {
  const cfg = getShopConfig(shop);
  if (!cfg.markenSlug) return null;

  const hit = _cache.get(cfg.shop);
  if (hit && Date.now() - hit.at < MARKEN_TTL) return hit.marke;

  const { data } = await getWcClient(cfg.shop).get('products/brands', { slug: cfg.markenSlug });
  const term = (Array.isArray(data) ? data : [data]).find(t => t?.slug === cfg.markenSlug);
  if (!term) {
    const e = new Error(
      `Marke "${cfg.markenSlug}" existiert im Shop ${cfg.label} nicht (products/brands). `
      + 'Produkt wurde nicht angelegt.',
    );
    e.status = 500;
    throw e;
  }

  const marke = { id: term.id, name: term.name, slug: term.slug };
  _cache.set(cfg.shop, { marke, at: Date.now() });
  return marke;
}
