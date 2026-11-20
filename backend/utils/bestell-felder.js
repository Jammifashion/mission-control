// FIX4: Shop-Bestellungen gehen nur mit den Feldern an den Browser, die die Oberflaeche liest ("Bestellungen (JFN)",
// gemessen 20.11. in frontend/index.html: loadOrders, psPosition, psVariante, psVersandArt, psUnbezahlt, psSchlank,
// psZeilenAnlegen). Keine Lieferadresse, keine Mail/Telefon, keine Kundennotiz, keine Order-Meta. Neues Feld in der
// Oberflaeche = hier ergaenzen (Test fix4-datenschutz.test.js).

const LI_META = m => ({ key: m?.key, value: typeof m?.value === 'object' ? '' : m?.value, display_key: m?.display_key, display_value: m?.display_value });

/** Eine WooCommerce-Bestellung -> nur die angezeigten Felder. */
export function bestellungFuerBrowser(o) {
  if (!o || typeof o !== 'object') return o;
  return {
    id: o.id, number: o.number, status: o.status, date_created: o.date_created, date_paid: o.date_paid,
    total: o.total, currency: o.currency, payment_method_title: o.payment_method_title,
    billing: { first_name: o.billing?.first_name ?? '', last_name: o.billing?.last_name ?? '', city: o.billing?.city ?? '' },
    line_items: (o.line_items ?? []).map(li => ({
      id: li.id, name: li.name, parent_name: li.parent_name, quantity: li.quantity, sku: li.sku,
      product_id: li.product_id, variation_id: li.variation_id,
      image: li.image?.src ? { src: li.image.src } : undefined,
      // Interne Meta (Schluessel mit "_") liest die Oberflaeche nicht
      meta_data: (li.meta_data ?? []).filter(m => !String(m?.key ?? '').startsWith('_')).map(LI_META),
    })),
    shipping_lines: (o.shipping_lines ?? []).map(s => ({ method_id: s.method_id, instance_id: s.instance_id, method_title: s.method_title })),
    ...(o.mc_admin_url !== undefined ? { mc_admin_url: o.mc_admin_url } : {}),
  };
}

export const bestellungenFuerBrowser = liste => (Array.isArray(liste) ? liste.map(bestellungFuerBrowser) : liste);
