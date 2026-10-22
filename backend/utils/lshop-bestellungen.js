// L-Shop-Bestellungen (BO4d): reine Logik fuer den Unterreiter "L-Shop-Bestellungen (JFN)".
// Eine Bestellung = Zeile in LShop_EDI_Dateien mit Status ab "gesendet" (Entwurf/Testdatei nie).
// Positionen: Korb-Zeilen mit Bestell_ID = order_id (setzt BO4c beim Senden), ersatzweise die
// Korb_Schluessel der EDI-Zeile. Lieferscheine/Pakete aus LShop_Sendungen (BO4b-2), nach LA gruppiert.
// Der Status wird aus den Daten abgeleitet (kein eigenes Feld):
//   geliefert           alle Positionen "geliefert"
//   teilweise geliefert mind. eine Position "geliefert" oder ein Paket mit Wareneingang
//   versandt            es gibt Pakete (Lieferbestaetigung)
//   bestätigt           EDI-Status "bestätigt" (Auftragsbestaetigung, BO4b-4)
//   gesendet            sonst
// Portal-Sendungen (order_id leer) stehen getrennt, nach VA gruppiert.
// Nur lesen: hier wird nichts geschrieben.

import { normHeader } from './sheet-headers.js';
import { referenzFuer } from './edi-bestellung.js';
import { EDI_BEI_LSHOP, TRACKING_PREFIX } from './lshop-belege.js';

export const BESTELL_STATUS = {
  GESENDET: 'gesendet', BESTAETIGT: 'bestätigt', VERSANDT: 'versandt', TEILWEISE: 'teilweise geliefert', GELIEFERT: 'geliefert',
};
// Reihenfolge der Stufen (fuer Sortierung und Tests).
export const STATUS_FOLGE = Object.values(BESTELL_STATUS);
export const GELIEFERT_TAGE = 14;   // Filter "Geliefert": letzte 14 Tage
export const PORTAL_TAGE = 30;      // Portalbestellungen: letzte 30 Tage, aeltere auf Wunsch

const t = v => String(v ?? '').trim();
const TAG_MS = 24 * 60 * 60 * 1000;

/** LShop_EDI_Dateien -> Bestellungen ab "gesendet". */
export function ediBestellZeilen(werte) {
  if (!werte?.length) return [];   // Reiter fehlt oder leer: noch keine Bestellung
  const [kopf = [], ...rest] = werte;
  const norm = kopf.map(normHeader);
  const sp = n => norm.indexOf(normHeader(n));
  const i = { id: sp('order_id'), erzeugt: sp('Erzeugt'), status: sp('Status'), pos: sp('Positionen'), stueck: sp('Stueck'), com: sp('Commission'), schl: sp('Korb_Schluessel') };
  if (i.id < 0 || i.status < 0) {
    const e = new Error('Reiter "LShop_EDI_Dateien": Spalten order_id/Status fehlen.');
    e.status = 422;
    throw e;
  }
  const w = (r, k) => (i[k] < 0 ? '' : t(r[i[k]]));
  return rest
    .map(r => ({
      orderId: w(r, 'id'), erzeugt: w(r, 'erzeugt'), ediStatus: w(r, 'status'), positionen: w(r, 'pos'),
      stueck: w(r, 'stueck'), commission: w(r, 'com'), korbSchluessel: w(r, 'schl').split(/\s+/).filter(Boolean),
    }))
    .filter(b => b.orderId && EDI_BEI_LSHOP.includes(b.ediStatus));
}

/** Status einer Bestellung aus EDI-Status, Positionen und Paketen. */
export function bestellStatus({ ediStatus, positionen = [], pakete = [] }) {
  const geliefert = positionen.filter(p => p.status === 'geliefert').length;
  if (positionen.length && geliefert === positionen.length) return BESTELL_STATUS.GELIEFERT;
  if (geliefert || pakete.some(p => p.wareneingang)) return BESTELL_STATUS.TEILWEISE;
  if (pakete.length) return BESTELL_STATUS.VERSANDT;
  if (ediStatus === 'bestätigt' || ediStatus === 'versandt' || ediStatus === 'geliefert') {
    // versandt/geliefert ohne Pakete (Daten unvollstaendig): hoechstens "bestaetigt" anzeigen
    return BESTELL_STATUS.BESTAETIGT;
  }
  return BESTELL_STATUS.GESENDET;
}

/** Pakete nach Lieferschein (LA) gruppieren, Reihenfolge wie im Reiter. */
export function lieferscheine(sendungen) {
  const m = new Map();
  for (const s of sendungen) {
    const la = t(s.LA) || '(ohne LA)';
    if (!m.has(la)) m.set(la, { la, va: t(s.VA), datum: datumAusDatei(s.Datei), pakete: [] });
    m.get(la).pakete.push({
      paketnummer: t(s.Paketnummer), frachtfuehrer: t(s.Frachtfuehrer),
      url: t(s.Tracking_URL).startsWith(TRACKING_PREFIX) ? t(s.Tracking_URL) : '', wareneingang: t(s.Wareneingang),
    });
  }
  return [...m.values()];
}

/** "DeliveryConfirmation_20261021204643.xml" -> "2026-10-21"; sonst ''. */
export function datumAusDatei(name) {
  const m = /_(20\d{2})(\d{2})(\d{2})\d{6}\.xml$/i.exec(String(name ?? ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function position(z, modelle) {
  const nr = t(z.LShop_ArticleNr);
  const m = modelle.get(nr) ?? {};
  return {
    schluessel: z.Schluessel, articleNr: nr, catalogNr: t(m.catalogNr), bezeichnung: t(m.bezeichnung),
    farbe: [t(m.color1), t(m.color2)].filter(Boolean).join('/'), groesse: t(m.size),   // Farbe wie der Korb
    menge: Number(z.Menge) || 0, reference: referenzFuer(z),
    status: z.Status, statusDatum: t(z.Status_Datum), liefertermin: '',   // Liefertermin: BO4b-4
  };
}

/**
 * Bestellungen fuer die Anzeige.
 * @param {object}   o
 * @param {object[]} o.edi        aus ediBestellZeilen
 * @param {object[]} o.korb       Korb-Zeilen als Objekte (korbZeilen)
 * @param {Map}      o.modelle    ArticleNr -> LShop_Modelle-Zeile
 * @param {object[]} o.sendungen  LShop_Sendungen als Objekte (sendungenZeilen)
 * @param {Date}     o.jetzt
 */
export function baueBestellungen({ edi, korb, modelle, sendungen, jetzt = new Date() }) {
  const nachBestellId = new Map();
  for (const z of korb) if (t(z.Bestell_ID)) (nachBestellId.get(t(z.Bestell_ID)) ?? nachBestellId.set(t(z.Bestell_ID), []).get(t(z.Bestell_ID))).push(z);
  const nachSchluessel = new Map(korb.map(z => [t(z.Schluessel), z]));

  const bestellungen = edi.map(b => {
    const zeilen = nachBestellId.get(b.orderId) ?? b.korbSchluessel.map(s => nachSchluessel.get(s)).filter(Boolean);
    const positionen = zeilen.map(z => position(z, modelle));
    const ls = lieferscheine(sendungen.filter(s => t(s.order_id) === b.orderId));
    const pakete = ls.flatMap(l => l.pakete);
    const status = bestellStatus({ ediStatus: b.ediStatus, positionen, pakete });
    const geliefertDaten = positionen.filter(p => p.status === 'geliefert').map(p => Date.parse(p.statusDatum)).filter(Number.isFinite);
    const geliefertSeit = geliefertDaten.length ? new Date(Math.max(...geliefertDaten)).toISOString() : '';
    return {
      filter: {   // der Browser filtert nur noch ueber diese Kennzeichen
        unterwegs: status !== BESTELL_STATUS.GELIEFERT,
        geliefert: status === BESTELL_STATUS.GELIEFERT && Boolean(geliefertSeit) && jetzt.getTime() - Date.parse(geliefertSeit) <= GELIEFERT_TAGE * TAG_MS,
      },
      orderId: b.orderId, erzeugt: b.erzeugt, gesendet: '',   // Sendedatum: BO4c
      va: [...new Set(ls.map(l => l.va).filter(Boolean))], commission: b.commission,
      positionenZahl: positionen.length || Number(b.positionen) || 0,
      stueck: positionen.length ? positionen.reduce((n, p) => n + p.menge, 0) : Number(b.stueck) || 0,
      status, pakete: pakete.length, positionen, lieferscheine: ls,
      geliefertSeit,
    };
  }).sort((a, b) => b.orderId.localeCompare(a.orderId));

  const grenzePortal = jetzt.getTime() - PORTAL_TAGE * TAG_MS;
  const portalMap = new Map();
  for (const s of sendungen.filter(x => !t(x.order_id))) {
    const va = t(s.VA) || '(ohne VA)';
    if (!portalMap.has(va)) portalMap.set(va, []);
    portalMap.get(va).push(s);
  }
  const portal = [...portalMap.entries()].map(([va, ss]) => {
    const ls = lieferscheine(ss);
    const datum = ls.map(l => l.datum).filter(Boolean).sort().at(-1) ?? '';
    return { va, datum, lieferscheine: ls, pakete: ls.reduce((n, l) => n + l.pakete.length, 0), aelter: !datum || Date.parse(datum) < grenzePortal };
  }).sort((a, b) => b.datum.localeCompare(a.datum) || b.va.localeCompare(a.va));

  return { bestellungen, portal };
}
