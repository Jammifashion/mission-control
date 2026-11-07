import rateLimit from 'express-rate-limit';

// PPS1: Fehlversuchs-Bremse je IP fuer die Partnerportale (Lizenz /api/partner, Festpreis /api/festpreis-public).
// Gezaehlt werden NUR Antworten 401 (unbekannter oder fehlender Token); gueltige Links zaehlen nie mit, es gibt
// sonst kein eigenes Limit (Inhaber) - der allgemeine apiRateLimiter bleibt davor. Ein Zaehler fuer beide Portale.
// Nach FEHLVERSUCHE_MAX Fehlversuchen in FENSTER_MS: 429 fuer diese IP bis zum Ende des Fensters.
// Kein Log mit Token oder Adresse.
export const FENSTER_MS = 15 * 60 * 1000;
export const FEHLVERSUCHE_MAX = 20;

export function baueTokenBremse({ fensterMs = FENSTER_MS, max = FEHLVERSUCHE_MAX } = {}) {
  return rateLimit({
    windowMs: fensterMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    // Erfolgreich = alles ausser 401: nur Fehlversuche zaehlen.
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
    message: { error: 'Zu viele ungültige Zugriffe. Bitte in 15 Minuten erneut versuchen.', code: 'token_bremse' },
  });
}

export const tokenBremse = baueTokenBremse();
