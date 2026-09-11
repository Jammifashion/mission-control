// Zustandslose Sitzungs-Token fuer das oeffentliche Chat-Widget.
//
// Warum zustandslos: Cloud Run faehrt bis zu zwei Instanzen ohne Session
// Affinity. Ein im Prozess gehaltener Sitzungsspeicher wuerde je nach Instanz
// mal greifen und mal nicht. Der Token traegt seine Gueltigkeit deshalb selbst:
// Ablaufzeit + Zufallswert, signiert mit HMAC-SHA256. Jede Instanz kann ihn
// allein aus CHAT_SESSION_SECRET pruefen, ohne gemeinsamen Zustand.
//
// Format: "<exp>.<nonce>.<sig>"
//   exp   Ablauf als ms seit Epoch
//   nonce 16 Zufallsbytes hex - macht zwei Token derselben Millisekunde
//         unterscheidbar und verhindert, dass der Token allein aus der Zeit
//         ableitbar ist
//   sig   HMAC-SHA256 ueber "<exp>.<nonce>"
//
// Der Token ersetzt keine Benutzer-Authentifizierung. Er belegt nur, dass
// dieser Client einmal eine Turnstile-Pruefung bestanden hat.

import crypto from 'crypto';

export const SESSION_TTL_MS = 30 * 60 * 1000;

const NONCE_RE = /^[0-9a-f]{32}$/;
const SIG_RE   = /^[0-9a-f]{64}$/;
const EXP_RE   = /^\d{1,15}$/;

// Fehlt das Secret, wird weder ausgestellt noch akzeptiert - lieber 503 als
// eine Signatur ueber den leeren String, die jeder nachrechnen koennte.
function getKey() {
  const s = process.env.CHAT_SESSION_SECRET ?? '';
  if (!s) throw Object.assign(
    new Error('CHAT_SESSION_SECRET nicht konfiguriert.'), { status: 503 },
  );
  return s;
}

function sign(payload) {
  return crypto.createHmac('sha256', getKey()).update(payload).digest('hex');
}

export function issueSessionToken(now = Date.now()) {
  const exp     = now + SESSION_TTL_MS;
  const nonce   = crypto.randomBytes(16).toString('hex');
  const payload = `${exp}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * true nur bei intakter Signatur UND nicht abgelaufenem Token.
 * Wirft nur, wenn CHAT_SESSION_SECRET fehlt (siehe getKey).
 */
export function verifySessionToken(token, now = Date.now()) {
  if (typeof token !== 'string' || token === '') return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts;

  // Form zuerst pruefen: danach haben sig und expected garantiert dieselbe
  // Laenge, was timingSafeEqual voraussetzt (wirft sonst).
  if (!EXP_RE.test(exp) || !NONCE_RE.test(nonce) || !SIG_RE.test(sig)) return false;

  const expected = sign(`${exp}.${nonce}`);
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')))
    return false;

  return Number(exp) > now;
}
