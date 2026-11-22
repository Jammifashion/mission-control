// RE1: der EINE Schreibweg fuer Lexware-Belege - POST /v1/invoices als ENTWURF (nie `finalize`, nie PUT/DELETE, nie versenden).
// Nur mit dem eigenen Schluessel LEXWARE_API_KEY_RECHNUNGEN (Recht "Rechnungen"); fehlt er, startet das Backend trotzdem
// (nicht in SECRET_KEYS) und der Knopf meldet "nicht eingerichtet".
//
// GENAU EIN Versuch, keine Wiederholung - auch nicht bei 429 (dann ist laut Doku nichts angelegt -> "nicht").
// Ergebnis: angelegt (2xx mit id) · nicht (4xx = sicher nicht angelegt) · unklar (Zeitlimit, Netzfehler, 5xx, 2xx ohne id):
// dann NIE automatisch erneut senden (Muster L-Shop BO4c) - der Aufrufer setzt das Kennzeichen "unklar".
// Fehlertexte: Pfad + Status (+ Feldnamen aus der IssueList), nie Antwortinhalt, nie Schluessel, nie Namen/Betraege.

import { getSecret } from '../utils/secrets.js';
import { BASIS, taktgeber, LexwareFehler } from './lexware.js';
import { leseBelegliste, BelegSchluesselFehlt, SCHLUESSEL_BELEGE, BELEGE_NICHT_EINGERICHTET } from './lexwareBelege.js';   // RE2

export const SCHLUESSEL_RECHNUNGEN = 'LEXWARE_API_KEY_RECHNUNGEN';
export const NICHT_EINGERICHTET = 'Lexware-Rechnungen nicht eingerichtet';
export const ZEITLIMIT_MS = 30000;
const PFAD = '/v1/invoices';
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ein Takt fuer alle Rechnungs-Aufrufe dieser Instanz (< 2/s).
let takt = taktgeber();
export function _rechnungTaktNeu(warte, jetzt) { takt = taktgeber(warte, jetzt); }

export class RechnungSchluesselFehlt extends Error {
  constructor(zusatz = '') {
    super(`${NICHT_EINGERICHTET}${zusatz ? ` (${zusatz})` : ''}.`);
    this.status = 503; this.code = 'lexware_rechnungen';
  }
}

/** Schluessel lesen; fehlt er -> RechnungSchluesselFehlt. Wert nie loggen. */
export async function rechnungSchluessel(lesen = getSecret) {
  let k = '';
  try { k = await lesen(SCHLUESSEL_RECHNUNGEN); } catch { throw new RechnungSchluesselFehlt('Secret nicht lesbar'); }
  if (!k) throw new RechnungSchluesselFehlt();
  return k;
}
export async function rechnungenBereit(lesen = getSecret) {
  try { await rechnungSchluessel(lesen); return true; } catch { return false; }
}

async function felderAus(res) {
  try {
    const j = await res.json();
    const liste = Array.isArray(j?.IssueList) ? j.IssueList : Array.isArray(j?.details) ? j.details : [];
    return [...new Set(liste.map(i => String(i?.source ?? i?.field ?? '').replace(/[^\w.\[\]]/g, '')).filter(Boolean))].slice(0, 5);
  } catch { return []; }
}

/**
 * Rechnungsentwurf anlegen - genau ein POST.
 * @returns {{ ergebnis: 'angelegt', id } | { ergebnis: 'nicht', grund, status } | { ergebnis: 'unklar', grund }}
 */
export async function legeRechnungsentwurfAn({ payload, schluessel, fetchFn = fetch, zeitlimitMs = ZEITLIMIT_MS, mitTakt = true } = {}) {
  const key = schluessel ?? await rechnungSchluessel();
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
  if (res.status === 401 || res.status === 403) return { ergebnis: 'nicht', status: res.status, grund: `${NICHT_EINGERICHTET} (Lexware ${res.status}: Schlüssel ohne Recht „Rechnungen“ oder ungültig)` };
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

/**
 * NUR LESEN: Rechnungs-Entwuerfe (GS1: voucherType 'creditnote' = Gutschriften) des Kontakts seit einem Tag (Belegliste). Fuer "In Lexware nachsehen" bei unklar.
 * RE2: ueber den Belegleser (lib/lexwareBelege.js, Schluessel LEXWARE_API_KEY_BELEGE) - der Rechnungen-Schluessel bekommt auf
 * /v1/voucherlist 403 (gemessen 22.11.). Fehlt der Belege-Schluessel: ok false mit Hinweis, kein Absturz.
 * @returns {{ ok: true, entwuerfe: [{ id, voucherDate, createdDate, totalAmount }] } | { ok: false, grund }}
 */
export async function sucheEntwuerfe({ kontaktId, seit, voucherType = 'invoice', schluessel, fetchFn = fetch, zeitlimitMs = 15000, lesen = leseBelegliste } = {}) {
  if (!ID_RE.test(String(kontaktId ?? ''))) return { ok: false, grund: 'Kunde ohne Lexoffice-Verknüpfung' };
  const filter = { voucherType, voucherStatus: 'draft', contactId: kontaktId, sort: 'createdDate,DESC' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(seit ?? ''))) filter.createdDateFrom = seit;
  try {
    const { belege } = await lesen(filter, { schluessel, fetchFn, zeitlimitMs, maxSeiten: 1, groesse: 25 });
    return { ok: true, entwuerfe: belege.map(x => ({ id: x.id, voucherDate: x.voucherDate, createdDate: x.createdDate, totalAmount: x.totalAmount })) };
  } catch (err) {
    if (err instanceof BelegSchluesselFehlt) return { ok: false, grund: `${BELEGE_NICHT_EINGERICHTET} (Secret ${SCHLUESSEL_BELEGE} fehlt)` };
    if (err?.lexwareStatus === 403 || err?.lexwareStatus === 401) return { ok: false, grund: `Belege-Schlüssel darf die Belegliste nicht lesen (${err.lexwareStatus})` };
    return { ok: false, grund: err instanceof LexwareFehler ? err.message : 'keine Verbindung' };
  }
}
