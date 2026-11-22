// GS1: der EINE Schreibweg fuer Gutschriften - POST /v1/credit-notes als ENTWURF (nie `finalize`, nie PUT/DELETE, nie versenden,
// ohne Bezugsrechnung `precedingSalesVoucherId`). Schluessel = derselbe wie fuer Rechnungen (LEXWARE_API_KEY_RECHNUNGEN, Inhaber 22.11.:
// "beide greifen auf dasselbe zu"; gemessen 22.11.: er darf GET /v1/credit-notes/{id}). Fehlt er, startet das Backend trotzdem (nicht in
// SECRET_KEYS) und der Knopf meldet "nicht eingerichtet".
//
// GENAU EIN Versuch, keine Wiederholung - auch nicht bei 429. Ergebnis wie RE1 (lib/lexwareRechnung.js):
// angelegt (2xx mit id) · nicht (4xx = sicher nicht angelegt) · unklar (Zeitlimit, Netzfehler, 5xx, 2xx ohne id) -> nie automatisch erneut.
// Fehlertexte: Pfad + Status (+ Feldnamen aus der IssueList), nie Antwortinhalt, nie Schluessel, nie Namen/Betraege.

import { getSecret } from '../utils/secrets.js';
import { BASIS, taktgeber } from './lexware.js';
import { SCHLUESSEL_RECHNUNGEN } from './lexwareRechnung.js';

export const SCHLUESSEL_GUTSCHRIFTEN = SCHLUESSEL_RECHNUNGEN;   // ein Schluessel fuer Rechnungen und Gutschriften
export const NICHT_EINGERICHTET = 'Lexware-Gutschriften nicht eingerichtet';
export const ZEITLIMIT_MS = 30000;
const PFAD = '/v1/credit-notes';
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let takt = taktgeber();
export function _gutschriftTaktNeu(warte, jetzt) { takt = taktgeber(warte, jetzt); }

export class GutschriftSchluesselFehlt extends Error {
  constructor(zusatz = '') {
    super(`${NICHT_EINGERICHTET}${zusatz ? ` (${zusatz})` : ' (Secret LEXWARE_API_KEY_RECHNUNGEN fehlt)'}.`);
    this.status = 503; this.code = 'lexware_gutschriften';
  }
}

/** Schluessel lesen; fehlt er -> GutschriftSchluesselFehlt. Wert nie loggen. */
export async function gutschriftSchluessel(lesen = getSecret) {
  let k = '';
  try { k = await lesen(SCHLUESSEL_GUTSCHRIFTEN); } catch { throw new GutschriftSchluesselFehlt('Secret nicht lesbar'); }
  if (!k) throw new GutschriftSchluesselFehlt();
  return k;
}
export async function gutschriftenBereit(lesen = getSecret) {
  try { await gutschriftSchluessel(lesen); return true; } catch { return false; }
}

async function felderAus(res) {
  try {
    const j = await res.json();
    const liste = Array.isArray(j?.IssueList) ? j.IssueList : Array.isArray(j?.details) ? j.details : [];
    return [...new Set(liste.map(i => String(i?.source ?? i?.field ?? '').replace(/[^\w.\[\]]/g, '')).filter(Boolean))].slice(0, 5);
  } catch { return []; }
}

/**
 * Gutschrift-Entwurf anlegen - genau ein POST.
 * @returns {{ ergebnis: 'angelegt', id } | { ergebnis: 'nicht', grund, status } | { ergebnis: 'unklar', grund }}
 */
export async function legeGutschriftsentwurfAn({ payload, schluessel, fetchFn = fetch, zeitlimitMs = ZEITLIMIT_MS, mitTakt = true } = {}) {
  const key = schluessel ?? await gutschriftSchluessel();
  if (mitTakt) await takt();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), zeitlimitMs);
  let res;
  try {
    res = await fetchFn(`${BASIS}${PFAD}`, {   // ohne ?finalize - Lexware legt per Standard einen Entwurf an
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), redirect: 'error', signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return { ergebnis: 'unklar', grund: err?.name === 'AbortError' ? `Zeitlimit ${Math.round(zeitlimitMs / 1000)} s` : `keine Antwort (${err?.code ?? err?.name ?? 'Netz'})` };
  }
  clearTimeout(timer);
  if (res.status === 401 || res.status === 403) return { ergebnis: 'nicht', status: res.status, grund: `${NICHT_EINGERICHTET} (Lexware ${res.status}: Schlüssel ohne Recht auf Gutschriften oder ungültig)` };
  if (res.status === 429) return { ergebnis: 'nicht', status: 429, grund: 'Lexware: Ratenlimit (429) – nichts angelegt, bitte gleich noch einmal' };
  if (res.status >= 400 && res.status < 500) {
    const f = await felderAus(res);
    return { ergebnis: 'nicht', status: res.status, grund: `Lexware lehnt den Entwurf ab (Status ${res.status}${f.length ? `, Felder: ${f.join(', ')}` : ''})` };
  }
  if (!res.ok) return { ergebnis: 'unklar', grund: `Lexware ${PFAD}: Status ${res.status}` };
  let id = '';
  try { id = String((await res.json())?.id ?? '').trim(); } catch { /* unklar */ }
  if (!ID_RE.test(id)) return { ergebnis: 'unklar', grund: `Lexware ${PFAD}: Antwort ohne id` };
  return { ergebnis: 'angelegt', id };
}
