// SG2 (Inhaber 19.11.): ein Text mit "[… bitte ergänzen]" wird nie veroeffentlicht.
// Gilt fuer Anlage (POST /products) und Aenderung (PUT /products/:id) - also Maske,
// SEO-Reiter und jeden anderen Aufrufer. Entwurf/privat bleiben erlaubt.
import { platzhalterIn, PLATZHALTER_TEXT } from '../lib/seo-prompt.js';

export const PLATZHALTER_CODE = 'platzhalter';

/** Braucht die Pruefung den Shop-Stand (Status oder Texte fehlen im Body)? */
export function brauchtShopStand(body = {}) {
  const imBody = platzhalterIn(body.description, body.short_description).length > 0;
  if (imBody) return body.status === undefined;
  return body.status === 'publish' && (body.description === undefined || body.short_description === undefined);
}

/**
 * @param {object} body  Request-Body (description, short_description, status)
 * @param {object} [alt] Shop-Stand (nur noetig, wenn brauchtShopStand)
 * @param {string} [standardStatus] Status, wenn weder Body noch Shop ihn kennen (Anlage: WooCommerce nimmt 'publish')
 * @returns {null | { status: 422, error: string, code: string, platzhalter: string[] }}
 */
export function platzhalterSperre(body = {}, alt = null, standardStatus = 'publish') {
  const status = body.status ?? alt?.status ?? standardStatus;
  if (status !== 'publish') return null;
  const p = platzhalterIn(body.description ?? alt?.description, body.short_description ?? alt?.short_description);
  if (!p.length) return null;
  return {
    status: 422, code: PLATZHALTER_CODE, platzhalter: p,
    error: `${PLATZHALTER_TEXT}: Platzhalter im Text (${p.join(', ')}). Veröffentlichen gesperrt – als Entwurf speichern geht.`,
  };
}
