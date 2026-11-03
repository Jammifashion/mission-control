// Lexware Office Public API (vormals lexoffice), NUR LESEN (AM-1). Einzige Stelle mit Zugriff auf api.lexware.io.
// Heute nur Kontakte (GET /v1/contacts, nur Kunden). Kein schreibender Aufruf (Test lexware.test.js: nur GET).
//
// Ratenlimit laut Doku 2 Anfragen/s ueber alle Endpunkte, sonst 429 - wiederholte Verstoesse koennen sperren.
// Darum ein fester Takt (TAKT_MS) zwischen den Abrufen und bei 429 warten (Retry-After, sonst steigend),
// hoechstens MAX_429 Wiederholungen je Seite, hoechstens MAX_SEITEN Seiten. Keine Endlosschleife.
//
// Der Schluessel kommt aus dem Secret LEXWARE_API_KEY (lokal .env im Hauptordner). Er steht nie in Log,
// Fehlertext oder Antwort; Fehlertexte nennen nur Pfad + Status, nie den Antwortinhalt (kann Namen tragen).

import { getSecret } from '../utils/secrets.js';

export const BASIS = 'https://api.lexware.io';
export const TAKT_MS = 600;          // < 2/s mit Luft
export const SEITE_GROESSE = 250;    // Maximum laut Doku
export const MAX_SEITEN = 200;
export const MAX_429 = 5;

const schlafen = ms => new Promise(r => setTimeout(r, ms));

export class LexwareFehler extends Error {
  constructor(text, status) {
    super(text);
    this.name = 'LexwareFehler';
    this.status = 502;   // fremder Dienst; der Lexware-Status steht in lexwareStatus
    this.code = 'lexware';
    this.lexwareStatus = status;
  }
}

/**
 * Ein GET mit Takt und 429-Behandlung. `pfad` ohne Basis, z. B. "/v1/contacts?page=0".
 * @param {object} o  { schluessel, fetchFn, warte, uhr } - fetchFn/warte im Test ersetzbar
 */
export async function lexwareGet(pfad, { schluessel, fetchFn = fetch, warte = schlafen, takt } = {}) {
  if (!schluessel) throw new LexwareFehler('Lexware: Schlüssel LEXWARE_API_KEY fehlt.', 0);
  const pfadOhneQuery = String(pfad).split('?')[0];
  for (let versuch = 0; ; versuch++) {
    if (takt) await takt();
    let res;
    try {
      res = await fetchFn(`${BASIS}${pfad}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${schluessel}`, Accept: 'application/json' },
        redirect: 'error',
      });
    } catch (err) {
      throw new LexwareFehler(`Lexware ${pfadOhneQuery}: keine Verbindung (${err?.code ?? err?.name ?? 'Netz'}).`, 0);
    }
    if (res.status === 429) {
      if (versuch >= MAX_429) throw new LexwareFehler(`Lexware ${pfadOhneQuery}: Ratenlimit (429) – ${MAX_429} Mal gewartet, abgebrochen.`, 429);
      const ra = Number(res.headers?.get?.('retry-after'));
      await warte(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : 1000 * 2 ** versuch);
      continue;
    }
    if (!res.ok) {
      const hinweis = res.status === 401 ? ' (Schlüssel ungültig oder abgelaufen)' : res.status === 403 ? ' (Schlüssel ohne Recht auf Kontakte)' : '';
      throw new LexwareFehler(`Lexware ${pfadOhneQuery}: Status ${res.status}${hinweis}.`, res.status);
    }
    try { return await res.json(); } catch {
      throw new LexwareFehler(`Lexware ${pfadOhneQuery}: Antwort ist kein JSON.`, res.status);
    }
  }
}

/** Takt: zwischen zwei Abrufen mindestens TAKT_MS. */
export function taktgeber(warte = schlafen, jetzt = () => Date.now(), ms = TAKT_MS) {
  let letzter = null;   // erster Abruf ohne Warten
  return async () => {
    const warten = letzter === null ? 0 : letzter + ms - jetzt();
    if (warten > 0) await warte(warten);
    letzter = jetzt();
  };
}

/**
 * Alle Kunden-Kontakte (customer=true), alle Seiten nacheinander. Liefert die Kontakte unveraendert
 * (nur fuer utils/kunden.js; nie loggen).
 */
export async function leseKundenKontakte({ schluessel, fetchFn = fetch, warte = schlafen, jetzt = () => Date.now() } = {}) {
  const key = schluessel ?? await getSecret('LEXWARE_API_KEY');
  const takt = taktgeber(warte, jetzt);
  const kontakte = [];
  for (let seite = 0; seite < MAX_SEITEN; seite++) {
    const d = await lexwareGet(`/v1/contacts?customer=true&page=${seite}&size=${SEITE_GROESSE}`, { schluessel: key, fetchFn, warte, takt });
    if (!Array.isArray(d?.content)) throw new LexwareFehler('Lexware /v1/contacts: Antwort ohne Liste (content).', 200);
    kontakte.push(...d.content);
    const letzte = d.last === true || (Number.isFinite(d.totalPages) && seite + 1 >= d.totalPages) || d.content.length === 0;
    if (letzte) return { kontakte, seiten: seite + 1 };
  }
  throw new LexwareFehler(`Lexware /v1/contacts: mehr als ${MAX_SEITEN} Seiten – abgebrochen.`, 200);
}
