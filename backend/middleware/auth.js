import { createHash, timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';
import { getSecret } from '../utils/secrets.js';

// /health ist der einzige offene Pfad - er kostet nichts und dient als
// Liveness-Probe. /api/health/full ruft WooCommerce, Sheets UND das Modell auf;
// offen war das eine Einladung, fremdes Kontingent zu verbrennen. Der einzige
// Aufrufer ist das Dashboard, und das schickt ohnehin einen API-Key mit.
// (/api/health steht weiter drin und laeuft weiter ins 404 - siehe D4 im
// Code-Check, eigener Befund.)
const OPEN_PATHS = new Set(['/health', '/api/health']);

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

const sha256 = wert => createHash('sha256').update(String(wert), 'utf8').digest();

/**
 * Geheimnis zeitkonstant vergleichen: SHA-256 beider Werte -> gleich lange Puffer ->
 * timingSafeEqual. Fehlender oder leerer Wert auf EINER Seite = nie gleich (auch nicht zwei leere).
 * Nur fuer Strings; alles andere (Array bei doppeltem Header, undefined) = abgelehnt.
 */
export function schluesselGleich(gegeben, erwartet) {
  if (typeof gegeben !== 'string' || typeof erwartet !== 'string') return false;
  if (gegeben === '' || erwartet === '') return false;
  return timingSafeEqual(sha256(gegeben), sha256(erwartet));
}

export async function requireApiKey(req, res, next) {
  if (OPEN_PATHS.has(req.path)) return next();

  try {
    const key = req.headers['x-api-key'];
    const expected = await getSecret('MC_API_KEY');
    if (!schluesselGleich(key, expected)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  } catch (err) {
    next(err);
  }
}
