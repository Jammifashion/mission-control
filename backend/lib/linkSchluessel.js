// LK1: Link-Schluessel aus dem Secret Manager laden (lokal: .env). Logik in utils/link-schluessel.js.
// NICHT in SECRET_KEYS: das Backend startet ohne ihn, die Links pruefen weiter ueber den Hash; nur "Link kopieren" und das
// verschluesselte Speichern neuer Links fallen dann aus. Nie den Wert loggen; ein Lesefehler meldet nur, DASS er fehlt.

import { getSecret } from '../utils/secrets.js';
import { SECRET_JE_VERSION, VERSION, schluesselAus } from '../utils/link-schluessel.js';

let gemeldet = false;

/** Buffer (32 Byte) oder null. `lies` nur fuer Tests. */
export async function ladeLinkSchluessel({ lies = getSecret } = {}) {
  let text = '';
  try { text = await lies(SECRET_JE_VERSION[VERSION]); } catch { text = ''; }
  const s = schluesselAus(text);
  if (!s && !gemeldet) {
    gemeldet = true;
    console.warn(`[LK1] ${SECRET_JE_VERSION[VERSION]} fehlt oder ist ungültig – "Link kopieren" nicht verfügbar, Links gelten weiter.`);
  }
  if (s) gemeldet = false;
  return s;
}
