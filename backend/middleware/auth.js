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

// SI2: ein Schluessel je Person bzw. fuer die Automatik, je einzeln widerrufbar. Keine Rechte-Unterschiede;
// der Name dient nur dem Log. Fehlt ein Secret (leer oder im Secret Manager nicht angelegt), wird es uebersprungen.
export const API_SCHLUESSEL = [
  { secret: 'MC_API_KEY',            name: 'inhaber' },
  { secret: 'MC_API_KEY_NICOLE',     name: 'nicole' },
  { secret: 'MC_API_KEY_AUTOMATION', name: 'automation' },
];
const FEHLT_MS = 10 * 60 * 1000;   // nicht angelegtes Secret nicht bei jeder Anfrage neu erfragen
const fehltSeit = new Map();

async function schluesselWert(secret) {
  const merken = process.env.NODE_ENV === 'production';   // lokal/Tests: process.env ist billig
  const seit = merken && fehltSeit.get(secret);
  if (seit && Date.now() - seit < FEHLT_MS) return '';
  try {
    const wert = await getSecret(secret);
    if (!wert && merken) fehltSeit.set(secret, Date.now()); else fehltSeit.delete(secret);
    return wert || '';
  } catch {
    if (merken) fehltSeit.set(secret, Date.now());
    return '';
  }
}

/** Nur fuer Tests: Merker "Secret fehlt" leeren. */
export function _schluesselMerkerLeeren() { fehltSeit.clear(); }

/**
 * Gegebenen X-API-Key gegen alle Schluessel pruefen. Jeder Kandidat wird verglichen (kein vorzeitiges Ende),
 * Vergleich zeitkonstant ueber schluesselGleich. Ergebnis: Name ('inhaber' | 'nicole' | 'automation') oder null.
 */
export async function apiSchluesselName(gegeben) {
  let treffer = null;
  for (const { secret, name } of API_SCHLUESSEL) {
    const wert = await schluesselWert(secret);
    if (schluesselGleich(gegeben, wert) && !treffer) treffer = name;
  }
  return treffer;
}

export async function requireApiKey(req, res, next) {
  if (OPEN_PATHS.has(req.path)) return next();

  try {
    const wer = await apiSchluesselName(req.headers['x-api-key']);
    if (!wer) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.mcSchluessel = wer;   // nur fuers Log (fehlerHandler)
    next();
  } catch (err) {
    next(err);
  }
}
