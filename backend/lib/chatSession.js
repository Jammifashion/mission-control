// Zustandslose Sitzungs-Token fuer das oeffentliche Chat-Widget.
//
// Warum zustandslos: Cloud Run faehrt bis zu zwei Instanzen ohne Session
// Affinity. Ein im Prozess gehaltener Sitzungsspeicher wuerde je nach Instanz
// mal greifen und mal nicht. Der Token traegt seine Gueltigkeit deshalb selbst:
// Ablaufzeit + Zufallswert, signiert mit HMAC-SHA256. Jede Instanz kann ihn
// allein aus CHAT_SESSION_SECRET pruefen, ohne gemeinsamen Zustand.
//
// Format (SI1): "<exp>.<start>.<nonce>.<sig>"
//   exp   Ablauf als ms seit Epoch (Leerlauf: SESSION_TTL_MS nach der letzten Antwort,
//         hoechstens start + SESSION_MAX_MS)
//   start Zeitpunkt der Bot-Pruefung (ms) - bleibt beim Verlaengern gleich
//   nonce 16 Zufallsbytes hex - macht zwei Token derselben Millisekunde
//         unterscheidbar und verhindert, dass der Token allein aus der Zeit
//         ableitbar ist
//   sig   HMAC-SHA256 ueber "<exp>.<start>.<nonce>"
// S11 (AUD1): vorher verlaengerte jede Antwort den Token ohne Obergrenze - eine bestandene Bot-Pruefung
// galt beliebig lange. Jetzt endet die Sitzung spaetestens SESSION_MAX_MS nach der Pruefung; danach neue
// Pruefung (pruefeSessionToken meldet "abgelaufen", die Route antwortet mit einem freundlichen Hinweis).
// Alte Token "<exp>.<nonce>.<sig>" (vor SI1, hoechstens 30 min alt) gelten im Uebergang weiter; ihr Start
// ist unbekannt und wird als exp - TTL angenommen (= letzte Ausstellung).
//
// Der Token ersetzt keine Benutzer-Authentifizierung. Er belegt nur, dass
// dieser Client einmal eine Turnstile-Pruefung bestanden hat.

import crypto from 'crypto';

export const SESSION_TTL_MS = 30 * 60 * 1000;        // Leerlauf
export const SESSION_MAX_MS = 2 * 60 * 60 * 1000;    // absolut ab der Bot-Pruefung (SI1)

const NONCE_RE = /^[0-9a-f]{32}$/;
const SIG_RE   = /^[0-9a-f]{64}$/;
const EXP_RE   = /^\d{1,15}$/;   // auch fuer start

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

/** Neuer Token; start = Zeitpunkt der Bot-Pruefung (beim Verlaengern der alte Start). */
export function issueSessionToken(now = Date.now(), start = now) {
  const exp     = Math.min(now + SESSION_TTL_MS, start + SESSION_MAX_MS);
  const nonce   = crypto.randomBytes(16).toString('hex');
  const payload = `${exp}.${start}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Pruefung mit Grund (SI1). Wirft nur, wenn CHAT_SESSION_SECRET fehlt.
 * @returns {{ gueltig: boolean, grund: 'fehlt'|'ungueltig'|'abgelaufen'|'ok', start?: number }}
 *   abgelaufen = Signatur stimmt, aber Leerlauf oder Hoechstdauer vorbei -> neue Bot-Pruefung, freundlicher Hinweis.
 */
export function pruefeSessionToken(token, now = Date.now()) {
  if (typeof token !== 'string' || token === '') return { gueltig: false, grund: 'fehlt' };
  const parts = token.split('.');
  let exp, start, nonce, sig, payload;
  if (parts.length === 4) { [exp, start, nonce, sig] = parts; payload = `${exp}.${start}.${nonce}`; }
  else if (parts.length === 3) { [exp, nonce, sig] = parts; start = null; payload = `${exp}.${nonce}`; }   // vor SI1
  else return { gueltig: false, grund: 'ungueltig' };
  // Form zuerst pruefen: danach haben sig und expected garantiert dieselbe
  // Laenge, was timingSafeEqual voraussetzt (wirft sonst).
  if (!EXP_RE.test(exp) || (start !== null && !EXP_RE.test(start)) || !NONCE_RE.test(nonce) || !SIG_RE.test(sig)) return { gueltig: false, grund: 'ungueltig' };
  const expected = sign(payload);
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return { gueltig: false, grund: 'ungueltig' };
  const beginn = start === null ? Number(exp) - SESSION_TTL_MS : Number(start);
  if (Number(exp) <= now || now - beginn >= SESSION_MAX_MS) return { gueltig: false, grund: 'abgelaufen', start: beginn };
  return { gueltig: true, grund: 'ok', start: beginn };
}

/**
 * true nur bei intakter Signatur UND nicht abgelaufenem Token.
 * Wirft nur, wenn CHAT_SESSION_SECRET fehlt (siehe getKey).
 */
export function verifySessionToken(token, now = Date.now()) {
  return pruefeSessionToken(token, now).gueltig;
}
