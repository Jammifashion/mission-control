// BS4: Link "Im Shop öffnen" - Bestellung im WooCommerce-Backend (dort wird das DHL-Etikett gedruckt).
// Gemessen 11.11.2026 (system_status): JFN WC 11.2.2 und HONK WC 11.2.1 speichern Bestellungen klassisch als Beitrag
// (order_datastore WC_Order_Data_Store_CPT, HPOS_enabled false). Darum post.php?post=<ID>&action=edit - diese Adresse leitet
// WooCommerce auch nach einer Umstellung auf HPOS weiter. Basis = Herkunft (origin) von WC_URL bzw. WC_URL_HONK, nie fest im Code.
// Kein Token, keine Zugangsdaten in der Adresse - die Anmeldung macht der Browser.

/** @returns {string} https://<shop>/wp-admin/post.php?post=<id>&action=edit oder '' (keine gueltige Basis/ID). */
export function adminBestellLink(wcUrl, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return '';
  try {
    const u = new URL(String(wcUrl ?? '').trim());
    if (u.protocol !== 'https:') return '';
    return `${u.origin}/wp-admin/post.php?post=${n}&action=edit`;
  } catch { return ''; }
}

/** Haengt `mc_admin_url` an jede Bestellung (Antwort von GET /api/woocommerce/orders). */
export const mitAdminLink = (orders, wcUrl) => (Array.isArray(orders) ? orders.map(o => ({ ...o, mc_admin_url: adminBestellLink(wcUrl, o?.id) })) : orders);
