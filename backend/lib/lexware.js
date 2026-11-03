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

// ── AM-1-1: einzelne Kunden bei Bedarf (Suche -> auswaehlen -> uebernehmen) ──────────────────────────────
// Ein Takt fuer alle Such-/Einzelabrufe dieser Instanz (zwei schnelle Klicks bleiben unter 2/s).
export const SUCH_GROESSE = 25;
export const SUCH_FELDER = ['name', 'email', 'number'];
let suchTakt = taktgeber();
export function _suchTaktNeu(warte, jetzt) { suchTakt = taktgeber(warte, jetzt); }

/** Eingabe der Lexware-Suche pruefen. name/email ab 3 Zeichen, number nur Ziffern. Fehlertext ohne den Suchbegriff. */
export function suchAnfrage(feld, q) {
  const f = String(feld ?? 'name').trim();
  const w = String(q ?? '').trim();
  if (!SUCH_FELDER.includes(f)) { const e = new Error('Suche nur nach Name, E-Mail oder Kundennummer.'); e.status = 422; throw e; }
  if (f === 'number' ? !/^\d{1,12}$/.test(w) : w.length < 3) {
    const e = new Error(f === 'number' ? 'Kundennummer nur aus Ziffern.' : 'Bitte mindestens 3 Zeichen eingeben.');
    e.status = 422; e.code = 'zu_kurz'; throw e;
  }
  return `/v1/contacts?customer=true&${f}=${encodeURIComponent(w)}&page=0&size=${SUCH_GROESSE}`;
}

/**
 * Lexware-Suche (nur Kunden, eine Seite). Liefert die Kontakte unveraendert nur an den Aufrufer - kein
 * Zwischenspeicher, kein Log (Suchbegriff und Treffer sind Personendaten).
 * @returns {{ kontakte: object[], mehr: boolean }}
 */
export async function sucheKundenKontakte({ feld, q, schluessel, fetchFn = fetch, warte = schlafen } = {}) {
  const pfad = suchAnfrage(feld, q);
  const key = schluessel ?? await getSecret('LEXWARE_API_KEY');
  const seite = async p => {
    const d = await lexwareGet(p, { schluessel: key, fetchFn, warte, takt: suchTakt });
    if (!Array.isArray(d?.content)) throw new LexwareFehler('Lexware /v1/contacts: Antwort ohne Liste (content).', 200);
    return d;
  };
  const d = await seite(pfad);
  const mehr = (Number.isFinite(d.totalElements) && d.totalElements > d.content.length) || d.last === false;
  const woerter = String(q ?? '').trim().split(/\s+/).filter(Boolean);
  if (d.content.length || (feld ?? 'name') !== 'name' || woerter.length < 2) return { kontakte: d.content.slice(0, SUCH_GROESSE), mehr };
  return ausweichSuche(woerter, seite);
}

// Befund Inhaber 03.11.: Lexware vergleicht "name" bei Personen mit Vor- ODER Nachname einzeln - "Vorname Nachname" findet
// nichts. Ausweich (nur wenn die ganze Eingabe 0 Treffer hat): mit dem laengsten Wort (>= 3) suchen, hoechstens
// AUSWEICH_SEITEN Seiten, und hier filtern: jedes Wort muss im ganzen Namen (Firma bzw. Vor- + Nachname) vorkommen.
export const AUSWEICH_SEITEN = 4;
const kontaktName = c => (c?.company?.name ?? [c?.person?.firstName, c?.person?.lastName].filter(Boolean).join(' ')).toLowerCase();
async function ausweichSuche(woerter, seite) {
  const wort = [...woerter].sort((a, b) => b.length - a.length)[0];
  if (wort.length < 3) return { kontakte: [], mehr: false };
  const klein = woerter.map(w => w.toLowerCase());
  const treffer = [];
  let weitere = false;
  for (let p = 0; p < AUSWEICH_SEITEN; p++) {
    const d = await seite(`/v1/contacts?customer=true&name=${encodeURIComponent(wort)}&page=${p}&size=${SUCH_GROESSE}`);
    treffer.push(...d.content.filter(c => klein.every(w => kontaktName(c).includes(w))));
    const letzte = d.last === true || d.content.length < SUCH_GROESSE || (Number.isFinite(d.totalPages) && p + 1 >= d.totalPages);
    if (letzte) break;
    if (p === AUSWEICH_SEITEN - 1) weitere = true;
  }
  return { kontakte: treffer.slice(0, SUCH_GROESSE), mehr: weitere || treffer.length > SUCH_GROESSE };
}

/** Einen Kontakt ueber die ID lesen (GET /v1/contacts/{id}). */
export async function leseKontakt({ id, schluessel, fetchFn = fetch, warte = schlafen } = {}) {
  const sid = String(id ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) {
    const e = new Error('Lexoffice-ID ungültig.'); e.status = 422; throw e;
  }
  const key = schluessel ?? await getSecret('LEXWARE_API_KEY');
  return lexwareGet(`/v1/contacts/${sid}`, { schluessel: key, fetchFn, warte, takt: suchTakt });
}
