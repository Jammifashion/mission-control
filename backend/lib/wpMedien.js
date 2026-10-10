// Bild in die WordPress-Mediathek laden - eine Stelle (HW3).
//
// Vorher lag der Upload nur in routes/artikel.js (POST /api/artikel/media-upload,
// Varianten-Bilder der Maske). Das Halloween-Skript braucht denselben Weg; die
// Route ruft jetzt diese Funktion, das Verhalten bleibt gleich.
//
// Zugriff: fetchMitZeitlimit (60 s, Schreiben) + pruefeFetchAntwort - HTML statt
// JSON (Hoster-Pruefseite) wirft HosterPruefseiteError, ohne Wiederholung.
// Titel und ALT-Text gehen als Abfrageparameter mit (WP REST uebernimmt sie beim
// Anlegen); setzeMedienText setzt sie nachtraeglich, falls die Antwort sie nicht
// traegt.

import { getShopConfig } from './shopConfig.js';
import { pruefeFetchAntwort, fetchMitZeitlimit } from './hosterPruefseite.js';

const PFAD = '/wp-json/wp/v2/media';

function zugang(shop) {
  const cfg = getShopConfig(shop);
  if (!cfg.wcUrl || !cfg.wpAppUser || !cfg.wpAppPassword) return { cfg, fehlt: true };
  const auth = Buffer.from(`${cfg.wpAppUser}:${cfg.wpAppPassword}`).toString('base64');
  return { cfg, auth, basis: cfg.wcUrl.replace(/\/$/, '') };
}

/**
 * @param {object} o
 * @param {string} [o.shop]
 * @param {Buffer} o.buffer
 * @param {string} o.dateiname
 * @param {string} [o.mimetype]
 * @param {string} [o.titel]   Bildtitel
 * @param {string} [o.alt]     ALT-Text
 * @returns {Promise<{ ok: boolean, status: number, data: object, fehlt?: boolean }>}
 *   data = WordPress-Antwort (id, source_url, title, alt_text …). Wirft bei Pruefseite/Zeitlimit.
 */
export async function ladeMedienHoch({ shop, buffer, dateiname, mimetype, titel, alt }) {
  const z = zugang(shop);
  if (z.fehlt) return { ok: false, status: 503, fehlt: true, data: {} };
  const name = String(dateiname || 'upload.jpg').replace(/"/g, '');
  const q = new URLSearchParams();
  if (titel) q.set('title', titel);
  if (alt) q.set('alt_text', alt);
  const res = await fetchMitZeitlimit(`${z.basis}${PFAD}${q.size ? `?${q}` : ''}`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${z.auth}`,
      'Content-Type': mimetype || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
    body: buffer,
  }, { shop: z.cfg.label, pfad: PFAD });
  const data = await pruefeFetchAntwort(res, { shop: z.cfg.label, pfad: PFAD });
  return { ok: res.ok, status: res.status, data };
}

/** Titel/ALT eines vorhandenen Mediums setzen. */
export async function setzeMedienText({ shop, id, titel, alt }) {
  const z = zugang(shop);
  if (z.fehlt) return { ok: false, status: 503, fehlt: true, data: {} };
  const pfad = `${PFAD}/${id}`;
  const res = await fetchMitZeitlimit(`${z.basis}${pfad}`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${z.auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(titel ? { title: titel } : {}), ...(alt ? { alt_text: alt } : {}) }),
  }, { shop: z.cfg.label, pfad: PFAD });
  const data = await pruefeFetchAntwort(res, { shop: z.cfg.label, pfad: PFAD });
  return { ok: res.ok, status: res.status, data };
}

/** Titel aus der WP-Antwort (raw bzw. rendered). */
export const medienTitel = d => String(d?.title?.raw ?? d?.title?.rendered ?? d?.title ?? '');
