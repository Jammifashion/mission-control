// Belege von L-Shop (BO4b-1): reine Logik fuer Abruf und Waechter, ohne Netz und ohne Sheets.
// Ein-/Ausgabe in lib/lshopBelege.js, FTP nur lesend in lib/lshopFtp.js.
//
// Waechter:
//  - ORDER: jede Datei, die nicht von uns stammt, ist ein Alarm. "Von uns" = Name
//    <order_id>_<JJJJMMTT-HHMM>.xml und die order_id steht in LShop_EDI_Dateien mit Status "gesendet"
//    (den setzt erst BO4c - bis dahin ist also jede Datei in ORDER fremd).
//    Eine eigene Datei liegt dort hoechstens ~8 min (L-Shop holt ab); liegt sie deutlich laenger,
//    meldet `orderLiegtZuLange` das. Alarm darauf erst ab BO4c.
//  - ORDERCONFIRMATION: jede neue AB wird geladen und nach unserer order_id durchsucht. Fehlt sie, ist
//    sie unbekannt oder in LShop_EDI_Dateien nur Entwurf/Testdatei -> Alarm (Bestellung nicht von uns?).
//    Sonst: "AB eingegangen - Auswertung folgt" (die Auswertung baut BO4b-4).
//  - Gleicher Dateiname mit anderem Inhalt (Hash) -> Alarm "Datei veraendert", nicht neu verarbeitet.
// Lieferbestaetigungen und Rechnungen werden in BO4b-1 nur gezaehlt (Auswertung ab BO4b-2).

import { createHash } from 'crypto';
import { normHeader } from './sheet-headers.js';

export const BELEGE_TAB = 'LShop_Belege';
export const BELEGE_SPALTEN = [
  'Ordner', 'Datei', 'Groesse', 'Hash', 'Geaendert_FTP', 'Gelesen', 'Art', 'order_id', 'VA', 'LA', 'Ergebnis', 'Hinweis', 'Lauf',
];

// Ordner auf dem EDI-FTP (gemessen 22.10.2026, Grossschreibung wie dort).
export const ORDNER = {
  ORDER: 'ORDER',
  AB: 'ORDERCONFIRMATION',
  LB: 'DELIVERYCONFIRMATION',
  RE_XML: 'INVOICE/XML',
  RE_PDF: 'INVOICE/PDF',
};

export const ART = { ORDER: 'Order', AB: 'Auftragsbestätigung', LAUF: 'Lauf' };
export const ERGEBNIS = {
  EIGEN: 'eigen', ALARM: 'alarm', ERKANNT: 'erkannt', VERAENDERT: 'verändert',
  FEHLER: 'fehler', FEHLER_GEMELDET: 'fehler (gemeldet)', OK_NACH_FEHLERN: 'ok nach Fehlern',
};

// Status in LShop_EDI_Dateien, die NICHT an L-Shop gegangen sind (AB dazu = Alarm).
export const EDI_NICHT_GESENDET = ['Entwurf', 'Testdatei'];
export const EDI_GESENDET = 'gesendet';

export const ORDER_LIEGT_MAX_MIN = 8;      // laut Inhaber holt L-Shop nach spaetestens ~8 min ab
export const ORDER_ZU_LANGE_MIN = 20;      // "deutlich laenger" - Alarm erst ab BO4c
export const FEHLLAEUFE_BIS_MELDUNG = 3;
export const MELDUNG_DROSSEL_MS = 60 * 60 * 1000;

const ORDER_ID = /JFN-\d{4}-\d{4}/g;
const EIGENE_ORDER_DATEI = /^(JFN-\d{4}-\d{4})_\d{8}-\d{4}\.xml$/;

const t = v => String(v ?? '').trim();

/** Spaltenindizes ueber den Namen; fehlende Spalte -> Fehler mit Namen (422, nichts geschrieben). */
export function belegeSpalten(header) {
  const norm = (header ?? []).map(normHeader);
  const idx = {};
  const fehlt = [];
  for (const name of BELEGE_SPALTEN) {
    const i = norm.indexOf(normHeader(name));
    if (i < 0) fehlt.push(name); else idx[name] = i;
  }
  if (fehlt.length) {
    const e = new Error(`Reiter "${BELEGE_TAB}": Spalte(n) fehlen: ${fehlt.join(', ')}`);
    e.status = 422;
    throw e;
  }
  return idx;
}

/** Datenzeilen als Objekte (Reihenfolge = Reiter = Zeit). Ganz leere Zeilen fallen weg. */
export function belegeZeilen(werte) {
  const [kopf = [], ...rest] = werte ?? [];
  const idx = belegeSpalten(kopf);
  return rest
    .map((r, i) => ({ r, zeile: i + 2 }))
    .filter(({ r }) => r.some(v => t(v)))
    .map(({ r, zeile }) => {
      const o = { zeile };
      for (const n of BELEGE_SPALTEN) o[n] = t(r[idx[n]]);
      return o;
    });
}

/** Letzter Protokolleintrag je Ordner/Datei (Schluessel "ORDNER/Datei"). */
export function protokollNachDatei(zeilen) {
  const m = new Map();
  for (const z of zeilen) if (z.Art !== ART.LAUF && z.Datei) m.set(`${z.Ordner}/${z.Datei}`, z);
  return m;
}

/**
 * Text eines Belegs nach dem BOM dekodieren - NICHT nach der XML-Kopfzeile: die Lieferbestaetigungen
 * sind UTF-16 LE mit BOM, obwohl dort encoding="utf-8" steht (gemessen 22.10.2026).
 * Ohne BOM: UTF-16 LE, wenn jedes zweite Byte 0 ist (ASCII-Text), sonst UTF-8.
 */
export function dekodiere(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? []);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    const le = Buffer.from(b.subarray(2));
    le.swap16();
    return le.toString('utf16le');
  }
  const probe = b.subarray(0, 64);
  let nullen = 0;
  for (let i = 1; i < probe.length; i += 2) if (probe[i] === 0) nullen++;
  if (probe.length >= 4 && nullen >= probe.length / 2 - 1) return b.toString('utf16le');
  return b.toString('utf8');
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Alle order_ids JFN-JJJJ-NNNN im Text, je einmal, in Fundreihenfolge. */
export function findeOrderIds(text) {
  return [...new Set(String(text ?? '').match(ORDER_ID) ?? [])];
}

/** order_id aus einem eigenen Dateinamen in ORDER, sonst null. */
export function orderIdAusDateiname(name) {
  return EIGENE_ORDER_DATEI.exec(String(name ?? ''))?.[1] ?? null;
}

/** LShop_EDI_Dateien-Zeilen -> Map order_id -> Status. */
export function ediStatusMap(ediWerte) {
  const [kopf = [], ...rest] = ediWerte ?? [];
  const norm = kopf.map(normHeader);
  const iId = norm.indexOf(normHeader('order_id')), iSt = norm.indexOf(normHeader('Status'));
  if (iId < 0 || iSt < 0) {
    const e = new Error('Reiter "LShop_EDI_Dateien": Spalten order_id/Status fehlen.');
    e.status = 422;
    throw e;
  }
  const m = new Map();
  for (const r of rest) { const id = t(r[iId]); if (id) m.set(id, t(r[iSt])); }
  return m;
}

/** FTP-Zeitstempel als Text (ISO, wenn der Server ihn genau liefert). */
export function ftpZeit(eintrag) {
  const d = eintrag?.modifiedAt;
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
  return t(eintrag?.rawModifiedAt);
}

/** Minuten, seit eine Datei auf dem FTP liegt (nur mit genauem Zeitstempel, sonst null). */
export function liegtSeitMinuten(eintrag, jetzt) {
  const d = eintrag?.modifiedAt;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((jetzt.getTime() - d.getTime()) / 60000));
}

/** Eigene Datei in ORDER, die L-Shop nicht abholt (Alarm erst ab BO4c, hier nur vorgesehen). */
export function orderLiegtZuLange(eintrag, jetzt, grenzeMin = ORDER_ZU_LANGE_MIN) {
  const min = liegtSeitMinuten(eintrag, jetzt);
  return min !== null && min > grenzeMin;
}

/**
 * Datei in ORDER bewerten (nur Liste, nie geladen).
 * -> { ergebnis: eigen|alarm, orderId, hinweis, zuLange }
 */
export function bewerteOrderDatei(eintrag, ediStatus, jetzt) {
  const orderId = orderIdAusDateiname(eintrag?.name);
  const status = orderId ? ediStatus.get(orderId) : undefined;
  if (orderId && status === EDI_GESENDET) {
    const zuLange = orderLiegtZuLange(eintrag, jetzt);
    return { ergebnis: ERGEBNIS.EIGEN, orderId, zuLange, hinweis: zuLange ? `liegt seit ${liegtSeitMinuten(eintrag, jetzt)} min` : '' };
  }
  let hinweis;
  if (!orderId) hinweis = 'Datei nicht von MC (Name passt nicht zu <order_id>_<Zeit>.xml)';
  else if (status === undefined) hinweis = `order_id ${orderId} nicht in LShop_EDI_Dateien`;
  else hinweis = `order_id ${orderId} ist "${status}", nicht gesendet`;
  return { ergebnis: ERGEBNIS.ALARM, orderId: orderId ?? '', zuLange: false, hinweis };
}

/**
 * Auftragsbestaetigung bewerten (Text schon dekodiert).
 * -> { ergebnis: erkannt|alarm, orderIds, hinweis }
 */
export function bewerteAb(text, ediStatus) {
  const orderIds = findeOrderIds(text);
  if (!orderIds.length) return { ergebnis: ERGEBNIS.ALARM, orderIds, hinweis: 'keine order_id von uns in der AB' };
  const probleme = [];
  for (const id of orderIds) {
    const st = ediStatus.get(id);
    if (st === undefined) probleme.push(`${id} nicht in LShop_EDI_Dateien`);
    else if (EDI_NICHT_GESENDET.includes(st)) probleme.push(`${id} ist nur "${st}"`);
  }
  if (probleme.length) return { ergebnis: ERGEBNIS.ALARM, orderIds, hinweis: probleme.join('; ') };
  return { ergebnis: ERGEBNIS.ERKANNT, orderIds, hinweis: 'AB eingegangen - Auswertung folgt (BO4b-4)' };
}

/** Ist ein schon protokollierter Eintrag auf dem FTP anders (Groesse oder Zeitstempel)? */
export function eintragGeaendert(eintrag, protokoll) {
  return t(protokoll.Groesse) !== String(eintrag.size ?? '') || t(protokoll.Geaendert_FTP) !== ftpZeit(eintrag);
}

/**
 * Fehllaeufe in Folge: Zeilen Art "Lauf" am Ende des Protokolls ab der letzten "ok nach Fehlern".
 * -> { inFolge, zuletztGemeldet (ms|null) }
 */
export function fehlerSerie(zeilen) {
  const laeufe = zeilen.filter(z => z.Art === ART.LAUF);
  let inFolge = 0;
  for (let i = laeufe.length - 1; i >= 0; i--) {
    if (laeufe[i].Ergebnis === ERGEBNIS.OK_NACH_FEHLERN) break;
    if (laeufe[i].Ergebnis === ERGEBNIS.FEHLER || laeufe[i].Ergebnis === ERGEBNIS.FEHLER_GEMELDET) inFolge++;
  }
  const gemeldet = laeufe.filter(z => z.Ergebnis === ERGEBNIS.FEHLER_GEMELDET).map(z => Date.parse(z.Gelesen)).filter(Number.isFinite);
  return { inFolge, zuletztGemeldet: gemeldet.length ? Math.max(...gemeldet) : null };
}

/** Soll dieser Fehllauf (der inFolge+1-te) in den Chat? Ab 3 in Folge, hoechstens 1/h. */
export function fehllaufMelden(serie, jetzt) {
  if (serie.inFolge + 1 < FEHLLAEUFE_BIS_MELDUNG) return false;
  return serie.zuletztGemeldet === null || jetzt.getTime() - serie.zuletztGemeldet >= MELDUNG_DROSSEL_MS;
}

/** Protokollzeile in Kopfreihenfolge. */
export function belegZeile(idx, felder) {
  const zeile = Array(Math.max(...Object.values(idx)) + 1).fill('');
  for (const n of BELEGE_SPALTEN) zeile[idx[n]] = felder[n] == null ? '' : String(felder[n]);
  return zeile;
}

/** Chat-Text fuer Alarme eines Laufs - nur Ordner, Dateiname, order_id und Grund. */
export function buildBelegeAlarmNachricht(alarme) {
  const zeilen = alarme.slice(0, 10).map(a => `• ${a.ordner}/${a.datei}: ${a.hinweis}`);
  if (alarme.length > 10) zeilen.push(`• … und ${alarme.length - 10} weitere (Reiter ${BELEGE_TAB})`);
  return ['🔴 L-Shop-FTP: Beleg nicht von uns oder unerwartet', ...zeilen, 'Bitte prüfen, ob jemand anderes über unser Konto bestellt.'].join('\n');
}

export function buildAbErkanntNachricht(erkannt) {
  return ['📄 L-Shop: Auftragsbestätigung eingegangen', ...erkannt.map(a => `• ${a.orderIds.join(', ')} (${a.datei})`), 'Auswertung folgt mit BO4b-4.'].join('\n');
}

export function buildFtpFehlerNachricht({ inFolge, grund }) {
  return [`🔴 L-Shop-FTP nicht erreichbar · ${inFolge} Läufe in Folge`, grund, 'Nächster Versuch beim nächsten Takt (alle 30 min).'].filter(Boolean).join('\n');
}
