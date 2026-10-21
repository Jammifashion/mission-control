import { google } from 'googleapis';
import { getSecret } from '../utils/secrets.js';

// Anmeldung fuer Google Cloud Scheduler (CS1). Der Job schickt ein Google-ID-Token
// (OIDC) seines Dienstkontos; kein MC_API_KEY im Job. Geprueft werden Signatur,
// Ablauf und Aussteller (verifyIdToken), dazu hier noch einmal aud und das
// Dienstkonto mit email_verified. Beide Sollwerte kommen aus der Umgebung
// (SCHEDULER_AUDIENCE, SCHEDULER_SA_EMAIL), nie aus dem Code.
// Abgelehnt wird mit 401 ohne Details; ins Log kommen nur Grund und Pfad, nie das Token.

let client = null;
function oidcClient() {
  if (!client) client = new google.auth.OAuth2();
  return client;
}

function ablehnen(req, res, grund) {
  console.warn(`Scheduler-Anmeldung abgelehnt: ${grund} (${req.method} ${req.baseUrl}${req.path})`);
  return res.status(401).json({ error: 'Unauthorized' });
}

export async function requireSchedulerOidc(req, res, next) {
  try {
    const kopf = String(req.headers.authorization ?? '');
    const m = /^Bearer\s+(\S+)$/i.exec(kopf);
    if (!m) return ablehnen(req, res, 'kein Bearer-Token');

    const audience = await getSecret('SCHEDULER_AUDIENCE');
    const konto    = await getSecret('SCHEDULER_SA_EMAIL');
    if (!audience || !konto) return ablehnen(req, res, 'Sollwerte fehlen');

    let payload;
    try {
      const ticket = await oidcClient().verifyIdToken({ idToken: m[1], audience });
      payload = ticket.getPayload() ?? {};
    } catch {
      return ablehnen(req, res, 'Token ungueltig (Signatur, Ablauf, Aussteller oder Audience)');
    }

    if (payload.aud !== audience) return ablehnen(req, res, 'falsche Audience');
    if (payload.email !== konto) return ablehnen(req, res, 'falsches Dienstkonto');
    if (payload.email_verified !== true) return ablehnen(req, res, 'email_verified fehlt');

    next();
  } catch (err) {
    next(err);
  }
}

export function _schedulerClientLeeren() { client = null; }
