// RE2: Lexware-Belegleser - NUR LESEN. Belegliste (GET /v1/voucherlist) und einzelne Rechnung (GET /v1/invoices/{id}).
// Nie POST/PUT/PATCH/DELETE (Quelltext-Test lexware-belege.test.js). Zugriff ueber `lexwareGet` aus lib/lexware.js (BASIS, 429,
// Fehlertexte nur Pfad + Status) mit eigenem Takt (< 2/s) und Zeitlimit je Anfrage.
//
// Eigener Schluessel: Secret LEXWARE_API_KEY_BELEGE (Recht nur "Belege lesen"; gemessen 22.11.: der Rechnungen-Schluessel und der
// Kontakte-Leseschluessel bekommen auf /v1/voucherlist 403). NICHT in SECRET_KEYS - fehlt er, startet das Backend, die Leser melden
// "nicht eingerichtet" (503 `lexware_belege`).
//
// Datenschutz: Lexware liefert in der Belegliste `contactName` und in der Rechnung Adresse/Positionen. Weitergegeben wird nur eine
// feste Feldauswahl OHNE Namen/Adressen/Positionstexte (`belegAus`, `rechnungAus`); nichts davon in Log, Chat, Fehlertext.

import { getSecret } from '../utils/secrets.js';
import { lexwareGet, LexwareFehler, taktgeber, SEITE_GROESSE } from './lexware.js';

export const SCHLUESSEL_BELEGE = 'LEXWARE_API_KEY_BELEGE';
export const BELEGE_NICHT_EINGERICHTET = 'Lexware-Belegleser nicht eingerichtet';
export const ZEITLIMIT_MS = 15000;
export const MAX_SEITEN_BELEGE = 20;   // 20 x 250 = 5000 Belege je Abfrage, danach Abbruch mit Meldung
const RECHT = 'Belege lesen';

// Feste Wertelisten laut Lexware-Doku (voucherlist). Anderes -> 422, nie ungeprueft in die Adresse.
export const BELEG_TYPEN = ['salesinvoice', 'salescreditnote', 'purchaseinvoice', 'purchasecreditnote', 'invoice', 'downpaymentinvoice',
  'creditnote', 'orderconfirmation', 'quotation', 'deliverynote', 'dunning', 'any'];
export const BELEG_STATUS = ['draft', 'open', 'overdue', 'paid', 'paidoff', 'voided', 'transferred', 'sepadebit', 'accepted', 'rejected', 'unchecked', 'any'];
export const DATUMS_FILTER = ['voucherDateFrom', 'voucherDateTo', 'createdDateFrom', 'createdDateTo', 'updatedDateFrom', 'updatedDateTo'];
export const SORTIERUNG = ['voucherDate', 'voucherNumber', 'createdDate', 'updatedDate', 'dueDate', 'totalAmount', 'openAmount'];
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG_RE = /^\d{4}-\d{2}-\d{2}$/;

const schlafen = ms => new Promise(r => setTimeout(r, ms));

// Ein Takt fuer alle Beleg-Abrufe dieser Instanz (< 2/s).
let takt = taktgeber();
export function _belegTaktNeu(warte, jetzt) { takt = taktgeber(warte, jetzt); }

export class BelegSchluesselFehlt extends Error {
  constructor(zusatz = '') {
    super(`${BELEGE_NICHT_EINGERICHTET}${zusatz ? ` (${zusatz})` : ''}.`);
    this.name = 'BelegSchluesselFehlt';
    this.status = 503; this.code = 'lexware_belege';
  }
}

/** Schluessel lesen; fehlt er -> BelegSchluesselFehlt. Wert nie loggen. */
export async function belegSchluessel(lesen = getSecret) {
  let k = '';
  try { k = await lesen(SCHLUESSEL_BELEGE); } catch { throw new BelegSchluesselFehlt('Secret nicht lesbar'); }
  if (!k) throw new BelegSchluesselFehlt();
  return k;
}
export async function belegeBereit(lesen = getSecret) {
  try { await belegSchluessel(lesen); return true; } catch { return false; }
}

function ungueltig(text) { const e = new Error(text); e.status = 422; e.code = 'filter'; return e; }

/** Liste aus Werten pruefen ("draft,open" oder ['draft','open']). */
function liste(wert, erlaubt, name) {
  const w = (Array.isArray(wert) ? wert : String(wert ?? '').split(',')).map(x => String(x).trim()).filter(Boolean);
  if (!w.length) throw ungueltig(`Belegliste: ${name} fehlt.`);
  const falsch = w.filter(x => !erlaubt.includes(x));
  if (falsch.length) throw ungueltig(`Belegliste: ${name} unbekannt.`);   // ohne den Wert (kann Eingabe sein)
  return [...new Set(w)].join(',');
}

/**
 * Abfrage der Belegliste aus geprueften Filtern bauen (ohne page/size). Reihenfolge fest:
 * voucherType, voucherStatus, contactId, archived, voucherNumber, Datumsfilter, sort.
 */
export function beleglisteAbfrage({ voucherType = 'invoice', voucherStatus, contactId, archived, voucherNumber, sort, ...rest } = {}) {
  const q = new URLSearchParams();
  q.set('voucherType', liste(voucherType, BELEG_TYPEN, 'Belegart'));
  q.set('voucherStatus', liste(voucherStatus, BELEG_STATUS, 'Belegstatus'));
  if (contactId !== undefined && contactId !== '') {
    if (!ID_RE.test(String(contactId))) throw ungueltig('Belegliste: Kontakt-ID ungültig.');
    q.set('contactId', String(contactId));
  }
  if (archived !== undefined) q.set('archived', archived ? 'true' : 'false');
  if (voucherNumber !== undefined && voucherNumber !== '') {
    if (!/^[\w-]{1,40}$/.test(String(voucherNumber))) throw ungueltig('Belegliste: Belegnummer ungültig.');
    q.set('voucherNumber', String(voucherNumber));
  }
  for (const k of Object.keys(rest)) if (!DATUMS_FILTER.includes(k)) throw ungueltig('Belegliste: unbekannter Filter.');
  for (const k of DATUMS_FILTER) {
    if (rest[k] === undefined || rest[k] === '') continue;
    if (!TAG_RE.test(String(rest[k]))) throw ungueltig(`Belegliste: ${k} braucht JJJJ-MM-TT.`);
    q.set(k, String(rest[k]));
  }
  if (sort) {
    const [feld, richtung = 'DESC'] = String(sort).split(',');
    if (!SORTIERUNG.includes(feld) || !['ASC', 'DESC'].includes(richtung)) throw ungueltig('Belegliste: Sortierung ungültig.');
    q.set('sort', `${feld},${richtung}`);
  }
  return q;
}

const zahl = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const text = x => (x === undefined || x === null ? '' : String(x));

/** Feste Feldauswahl eines Belegs der Liste - OHNE contactName. */
export function belegAus(x) {
  return {
    id: text(x?.id), voucherType: text(x?.voucherType), voucherStatus: text(x?.voucherStatus), voucherNumber: text(x?.voucherNumber),
    voucherDate: text(x?.voucherDate).slice(0, 10), createdDate: text(x?.createdDate), updatedDate: text(x?.updatedDate),
    dueDate: text(x?.dueDate).slice(0, 10), contactId: text(x?.contactId), totalAmount: zahl(x?.totalAmount), openAmount: zahl(x?.openAmount),
    currency: text(x?.currency), archived: x?.archived === true,
  };
}

/**
 * Belegliste lesen (alle Seiten bis `maxSeiten`, je SEITE_GROESSE). Nur GET.
 * @returns {{ belege: object[], seiten: number, mehr: boolean }}  mehr = es gaebe weitere Seiten (nur bei maxSeiten < Gesamt)
 */
export async function leseBelegliste(filter = {}, { schluessel, fetchFn = fetch, warte = schlafen, zeitlimitMs = ZEITLIMIT_MS, maxSeiten = MAX_SEITEN_BELEGE, groesse = SEITE_GROESSE } = {}) {
  const q = beleglisteAbfrage(filter);
  const key = schluessel ?? await belegSchluessel();
  const grenze = Math.max(1, Math.min(Number(maxSeiten) || 1, MAX_SEITEN_BELEGE));
  const size = Math.max(1, Math.min(Number(groesse) || SEITE_GROESSE, SEITE_GROESSE));
  const belege = [];
  for (let seite = 0; seite < grenze; seite++) {
    q.set('page', String(seite)); q.set('size', String(size));
    const d = await lexwareGet(`/v1/voucherlist?${q}`, { schluessel: key, fetchFn, warte, takt, zeitlimitMs, recht: RECHT });
    if (!Array.isArray(d?.content)) throw new LexwareFehler('Lexware /v1/voucherlist: Antwort ohne Liste (content).', 200);
    belege.push(...d.content.map(belegAus));
    const letzte = d.last === true || d.content.length < size || (Number.isFinite(d.totalPages) && seite + 1 >= d.totalPages);
    if (letzte) return { belege, seiten: seite + 1, mehr: false };
  }
  return { belege, seiten: grenze, mehr: true };
}

/** Feste Feldauswahl einer Rechnung - ohne Adresse, Positionstexte, Bemerkungen. */
export function rechnungAus(r) {
  const tp = r?.totalPrice ?? {};
  return {
    id: text(r?.id), voucherNumber: text(r?.voucherNumber), voucherStatus: text(r?.voucherStatus), voucherDate: text(r?.voucherDate).slice(0, 10),
    createdDate: text(r?.createdDate), updatedDate: text(r?.updatedDate), dueDate: text(r?.dueDate).slice(0, 10),
    contactId: text(r?.address?.contactId), archived: r?.archived === true, taxType: text(r?.taxConditions?.taxType),
    totalNetAmount: zahl(tp.totalNetAmount), totalGrossAmount: zahl(tp.totalGrossAmount), totalTaxAmount: zahl(tp.totalTaxAmount),
    currency: text(tp.currency), positionen: Array.isArray(r?.lineItems) ? r.lineItems.length : 0,
  };
}

/** Eine Rechnung lesen (GET /v1/invoices/{id}). 404 -> LexwareFehler mit lexwareStatus 404. */
export async function leseRechnung({ id, schluessel, fetchFn = fetch, warte = schlafen, zeitlimitMs = ZEITLIMIT_MS } = {}) {
  const sid = String(id ?? '').trim();
  if (!ID_RE.test(sid)) throw ungueltig('Rechnungs-ID ungültig.');
  const key = schluessel ?? await belegSchluessel();
  return rechnungAus(await lexwareGet(`/v1/invoices/${sid}`, { schluessel: key, fetchFn, warte, takt, zeitlimitMs, recht: RECHT }));
}
