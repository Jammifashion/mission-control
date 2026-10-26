// Belege von L-Shop (BO4b-1): reine Logik fuer Abruf und Waechter, ohne Netz und ohne Sheets.
// Ein-/Ausgabe in lib/lshopBelege.js, FTP nur lesend in lib/lshopFtp.js.
//
// Waechter:
//  - ORDER: jede Datei, die nicht von uns stammt, ist ein Alarm. "Von uns" = Name
//    <order_id>_<JJJJMMTT-HHMM>.xml und die order_id steht in LShop_EDI_Dateien mit einem Status aus
//    EDI_EIGEN_ORDER (BO4c: auch "wird gesendet" und "unklar" - die Datei kann gerade erst gesendet sein).
//    Eine eigene Datei liegt dort hoechstens ~8 min (L-Shop holt ab); liegt sie laenger als
//    ORDER_ZU_LANGE_MIN, meldet der Lauf das einmal je Datei (BO4c).
//  - BO4c: Ist eine von MC gesendete Datei (Sendeversuch gesetzt) nicht mehr in ORDER, setzt der Lauf
//    `Abgeholt` = Laufzeit ("spaetestens"). Haengt "wird gesendet" laenger als HAENGT_MIN, meldet er das
//    einmal (Merker in Sende_Hinweis); den Status aendert er nie.
//  - ORDERCONFIRMATION: jede neue AB wird geladen und nach unserer order_id durchsucht. Fehlt sie, ist
//    sie unbekannt oder in LShop_EDI_Dateien nur Entwurf/Testdatei -> Alarm (Bestellung nicht von uns?).
//    Sonst: "AB eingegangen - Auswertung folgt" (die Auswertung baut BO4b-4).
//  - Gleicher Dateiname mit anderem Inhalt (Hash) -> Alarm "Datei veraendert", nicht neu verarbeitet.
// BO4b-2: Lieferbestaetigungen je PAKET auswerten (eine Datei = Tagesstand aller Pakete eines Abends,
// mehrere VA moeglich, ein VA kommt in Teillieferungen/LA ueber mehrere Tage) -> LShop_Sendungen.
// Jede neu verarbeitete Belegdatei geht unveraendert ins Archiv (lib/belegArchiv.js, Drive).
// Aus der Lieferbestaetigung werden NUR Paketnummer, VA/LA, KdBestellNrDE, Frachtfuehrer, Gewicht und
// Url gelesen - Kundennummer, Adressfelder, Mail, INETNummer und Kommission nie.

import { createHash } from 'crypto';
import { normHeader } from './sheet-headers.js';

export const BELEGE_TAB = 'LShop_Belege';
export const BELEGE_SPALTEN = [
  'Ordner', 'Datei', 'Groesse', 'Hash', 'Geaendert_FTP', 'Gelesen', 'Art', 'order_id', 'VA', 'LA', 'Ergebnis', 'Hinweis', 'Lauf',
  'Drive_ID',   // BO4b-2, hinten angehaengt
];

// Ordner auf dem EDI-FTP (gemessen 22.10.2026, Grossschreibung wie dort).
export const ORDNER = {
  ORDER: 'ORDER',
  AB: 'ORDERCONFIRMATION',
  LB: 'DELIVERYCONFIRMATION',
  RE_XML: 'INVOICE/XML',
  RE_PDF: 'INVOICE/PDF',
};

export const ART = { ORDER: 'Order', AB: 'Auftragsbestätigung', LB: 'Lieferbestätigung', RE: 'Rechnung', LAUF: 'Lauf' };
export const ERGEBNIS = {
  EIGEN: 'eigen', ALARM: 'alarm', ERKANNT: 'erkannt', VERAENDERT: 'verändert', PORTAL: 'portal', ARCHIVIERT: 'archiviert',
  FEHLER: 'fehler', FEHLER_GEMELDET: 'fehler (gemeldet)', OK_NACH_FEHLERN: 'ok nach Fehlern',
};

// Status in LShop_EDI_Dateien, die NICHT an L-Shop gegangen sind (AB dazu = Alarm).
export const EDI_NICHT_GESENDET = ['Entwurf', 'Testdatei'];
export const EDI_GESENDET = 'gesendet';
// Status, ab denen eine Bestellung bei L-Shop ist (Lieferbestaetigung dazu = eigene Sendung).
export const EDI_BEI_LSHOP = ['gesendet', 'bestätigt', 'versandt', 'geliefert'];
export const EDI_VERSANDT = 'versandt';
// Nur aus diesen Status wird bei der ersten Sendung auf "versandt" gesetzt (Teillieferung zaehlt mit).
export const EDI_VOR_VERSAND = ['gesendet', 'bestätigt'];

export const ORDER_LIEGT_MAX_MIN = 8;      // laut Inhaber holt L-Shop nach spaetestens ~8 min ab
export const ORDER_ZU_LANGE_MIN = 20;      // "deutlich laenger" - Alarm seit BO4c, einmal je Datei
// BO4c: Status, bei denen eine Datei in ORDER von uns ist (gerade gesendet, unklar oder spaeter).
export const EDI_EIGEN_ORDER = ['wird gesendet', 'gesendet', 'unklar', 'bestätigt', 'versandt', 'geliefert'];
export const MERKER_ZU_LANGE = 'zu lange in ORDER – gemeldet';
export const MERKER_HAENGT = 'hängt – gemeldet';
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

/** Eigene Datei in ORDER, die L-Shop nicht abholt (Alarm einmal je Datei, BO4c). */
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
  if (orderId && EDI_EIGEN_ORDER.includes(status)) {
    const zuLange = orderLiegtZuLange(eintrag, jetzt);
    return { ergebnis: ERGEBNIS.EIGEN, orderId, zuLange, hinweis: zuLange ? `liegt seit ${liegtSeitMinuten(eintrag, jetzt)} min` : '' };
  }
  let hinweis;
  if (!orderId) hinweis = 'Datei nicht von MC (Name passt nicht zu <order_id>_<Zeit>.xml)';
  else if (status === undefined) hinweis = `order_id ${orderId} nicht in LShop_EDI_Dateien`;
  else hinweis = `order_id ${orderId} ist "${status}", nicht gesendet`;   // Entwurf, Testdatei
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

// ── BO4c: Abgeholt, zu lange in ORDER, haengendes Senden ─────────────────────

/**
 * EDI-Zeilen, deren von MC gesendete Datei nicht mehr in ORDER liegt -> Abgeholt setzen.
 * Nur mit Sendeversuch (per Knopf gesendet; von Hand gesendete wie JFN-2026-0003 nie), Abgeholt leer,
 * Status gesendet/unklar oder spaeter (nicht "wird gesendet": der Upload kann noch laufen).
 * -> [{ orderId, zeile, spalte: 'Abgeholt', alt: '', neu }]
 */
export function abgeholtPlan({ ediWerte, orderListe, jetzt }) {
  const [kopf = [], ...rest] = ediWerte ?? [];
  const norm = kopf.map(normHeader);
  const sp = n => norm.indexOf(normHeader(n));
  const i = { id: sp('order_id'), st: sp('Status'), ab: sp('Abgeholt'), sv: sp('Sendeversuch') };
  if (Object.values(i).some(x => x < 0)) return [];
  const inOrder = new Set((orderListe ?? []).map(e => orderIdAusDateiname(e.name)).filter(Boolean));
  return rest.map((r, n) => ({ r, zeile: n + 2 }))
    .filter(({ r }) => t(r[i.id]) && t(r[i.sv]) && !t(r[i.ab])
      && EDI_EIGEN_ORDER.includes(t(r[i.st])) && t(r[i.st]) !== 'wird gesendet' && !inOrder.has(t(r[i.id])))
    .map(({ r, zeile }) => ({ orderId: t(r[i.id]), zeile, spalte: 'Abgeholt', alt: '', neu: jetzt.toISOString() }));
}

/**
 * "wird gesendet" laenger als haengtMin -> einmal melden (Merker hinten an Sende_Hinweis).
 * -> [{ orderId, zeile, spalte: 'Sende_Hinweis', alt, neu, seitMin }]
 */
export function haengendPlan({ ediWerte, jetzt, haengtMin }) {
  const [kopf = [], ...rest] = ediWerte ?? [];
  const norm = kopf.map(normHeader);
  const sp = n => norm.indexOf(normHeader(n));
  const i = { id: sp('order_id'), st: sp('Status'), sh: sp('Sende_Hinweis'), sv: sp('Sendeversuch') };
  if (Object.values(i).some(x => x < 0)) return [];
  return rest.map((r, n) => ({ r, zeile: n + 2 }))
    .filter(({ r }) => t(r[i.st]) === 'wird gesendet' && !t(r[i.sh]).includes(MERKER_HAENGT))
    .map(({ r, zeile }) => {
      const seit = Date.parse(t(r[i.sv]));
      return { r, zeile, seitMin: Number.isFinite(seit) ? Math.floor((jetzt.getTime() - seit) / 60000) : null };
    })
    .filter(x => x.seitMin === null || x.seitMin > haengtMin)
    .map(({ r, zeile, seitMin }) => {
      const alt = t(r[i.sh]);
      return { orderId: t(r[i.id]), zeile, spalte: 'Sende_Hinweis', alt, neu: [alt, MERKER_HAENGT].filter(Boolean).join(' · '), seitMin };
    });
}

export function buildZuLangeNachricht(dateien) {
  return ['🟠 L-Shop: eigene Bestelldatei liegt zu lange in ORDER', ...dateien.map(d => `• ${d.datei}: ${d.hinweis}`),
    `L-Shop holt sonst nach höchstens ${ORDER_LIEGT_MAX_MIN} min ab. Bitte bei L-Shop nachfragen.`].join('\n');
}

export function buildHaengtNachricht(zeilen) {
  return ['🟠 L-Shop: Senden hängt', ...zeilen.map(z => `• ${z.orderId}: "wird gesendet" seit ${z.seitMin ?? '?'} min`),
    'Nicht nochmal senden. Prüfen, ob eine AB kommt; dann in MC „Als gesendet markieren“ oder „zurück auf Entwurf“.'].join('\n');
}

export function buildFtpFehlerNachricht({ inFolge, grund }) {
  return [`🔴 L-Shop-Belege kommen nicht an · ${inFolge} Läufe in Folge`, grund, 'Nächster Versuch beim nächsten Takt (alle 30 min).'].filter(Boolean).join('\n');
}

// ── BO4b-2: Lieferbestaetigung, Sendungen, Archiv ────────────────────────────

export const SENDUNGEN_TAB = 'LShop_Sendungen';
export const SENDUNGEN_SPALTEN = [
  'Paketnummer', 'VA', 'LA', 'order_id', 'Frachtfuehrer', 'Gewicht', 'Tracking_URL', 'Datei', 'Gelesen', 'Wareneingang', 'Notiz',
];
// Erlaubte Tracking-Links (nur https, nur diese Hosts). BO4e: als Liste vorbereitet; ein weiterer Host
// (z. B. fuer GLS) kommt erst dazu, wenn er an einer echten Lieferbestaetigung gemessen ist. Frontend-Spiegel:
// LB_TRACKING im Block "L-Shop-Bestellungen" (Test lshop-bestellungen.test.js vergleicht beide).
export const TRACKING_HOSTS = ['https://textilelogistics.eu/'];
export const TRACKING_PREFIX = TRACKING_HOSTS[0];
export const istTrackingUrl = url => TRACKING_HOSTS.some(h => String(url ?? '').startsWith(h));

// Archiv-Ordner je FTP-Ordner (Drive: L-Shop Belege/<Art>/<Jahr>/). Die Bestandsdatei nie.
export const ARCHIV_ART = {
  [ORDNER.LB]: 'Lieferbestaetigung',
  [ORDNER.AB]: 'Auftragsbestaetigung',
  [ORDNER.RE_XML]: 'Rechnung_XML',
  [ORDNER.RE_PDF]: 'Rechnung_PDF',
};
export const BELEG_ART = { [ORDNER.LB]: ART.LB, [ORDNER.AB]: ART.AB, [ORDNER.RE_XML]: ART.RE, [ORDNER.RE_PDF]: ART.RE };
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export class BelegFormatFehler extends Error {
  constructor(message) { super(message); this.name = 'BelegFormatFehler'; }
}

const ORDER_ID_GANZ = /^JFN-\d{4}-\d{4}$/;

/** Ein CDATA- oder Textfeld eines dataset, getrimmt; fehlt das Feld -> null. */
function feld(block, name) {
  const m = new RegExp(`<${name}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${name}>`).exec(block);
  if (!m) return null;
  return String(m[1] ?? m[2] ?? '').trim();
}

/**
 * Lieferbestaetigung lesen: je dataset (Paket) nur die benoetigten Felder.
 * -> [{ paketnummer, va, la, orderIdRoh, frachtfuehrer, gewicht, url, hinweise[] }]
 * Kein dataset, keine Paketnummer oder VorgangDE nicht "VA... / LA..." -> BelegFormatFehler.
 */
export function leseLieferbestaetigung(buf) {
  const text = dekodiere(buf);
  const bloecke = [...text.matchAll(/<dataset>([\s\S]*?)<\/dataset>/g)].map(m => m[1]);
  if (!bloecke.length) throw new BelegFormatFehler('keine Pakete (dataset) gefunden');
  return bloecke.map((b, i) => {
    const hinweise = [];
    const paketnummer = feld(b, 'Paketnummer') ?? '';
    if (!/^[0-9A-Za-z]{6,40}$/.test(paketnummer)) throw new BelegFormatFehler(`Paket ${i + 1}: Paketnummer fehlt oder ungültig`);
    const vorgang = /^(VA\d{4,12}) \/ (LA\d{4,12})$/.exec(feld(b, 'VorgangDE') ?? '');
    if (!vorgang) throw new BelegFormatFehler(`Paket ${i + 1}: VorgangDE nicht "VA... / LA..."`);
    let url = feld(b, 'Url') ?? '';
    if (url && !istTrackingUrl(url)) {
      hinweise.push(`Tracking-Link nicht freigegeben (${(/^https?:\/\/[^/]+/.exec(url) ?? ['?'])[0]}) - weggelassen`);
      url = '';
    }
    let gewicht = feld(b, 'Gewicht') ?? '';
    if (gewicht && !/^\d+(\.\d+)?$/.test(gewicht)) { hinweise.push('Gewicht unlesbar'); gewicht = ''; }
    return {
      paketnummer, va: vorgang[1], la: vorgang[2], orderIdRoh: feld(b, 'KdBestellNrDE') ?? '',
      frachtfuehrer: (feld(b, 'Frachtfuehrer') ?? '').slice(0, 30), gewicht, url, hinweise,
    };
  });
}

/**
 * Paket zuordnen -> { art: portal|eigen|alarm, orderId, hinweis }.
 * Leer = Portalbestellung; JFN-... mit Status bei L-Shop = eigen; sonst Alarm.
 */
export function bewertePaket(paket, ediStatus) {
  const roh = t(paket.orderIdRoh);
  if (!roh) return { art: ERGEBNIS.PORTAL, orderId: '', hinweis: '' };
  if (!ORDER_ID_GANZ.test(roh)) return { art: ERGEBNIS.ALARM, orderId: '', hinweis: `Bestellnummer "${roh.slice(0, 40)}" nicht von MC` };
  const st = ediStatus.get(roh);
  if (st === undefined) return { art: ERGEBNIS.ALARM, orderId: roh, hinweis: `${roh} nicht in LShop_EDI_Dateien` };
  if (!EDI_BEI_LSHOP.includes(st)) return { art: ERGEBNIS.ALARM, orderId: roh, hinweis: `${roh} ist nur "${st}"` };
  return { art: ERGEBNIS.EIGEN, orderId: roh, hinweis: '' };
}

/** Archiv-Jahr: aus dem Dateinamen (_JJJJMMTT...), sonst FTP-Zeit (Europe/Berlin), sonst jetzt. */
export function archivJahr(name, eintrag, jetzt = new Date()) {
  const m = /(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/.exec(String(name ?? ''));
  if (m) return m[1];
  const d = eintrag?.modifiedAt instanceof Date && !Number.isNaN(eintrag.modifiedAt.getTime()) ? eintrag.modifiedAt : jetzt;
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 4);
}

export function mimeFuer(name) {
  if (/\.pdf$/i.test(String(name))) return 'application/pdf';
  if (/\.xml$/i.test(String(name))) return 'application/xml';
  return 'application/octet-stream';
}

/** Erstbestand: solange keine Zeile Art "Lieferbestaetigung" im Protokoll steht, bleibt der Lauf still. */
export function istErstbestand(zeilen) {
  return !zeilen.some(z => z.Art === ART.LB);
}

// Die 29 Lieferbestaetigungen, die bei BO4b-2 schon auf dem FTP lagen, tragen im Namen ein Datum bis
// 22.10.2026. Sie bleiben still, auch wenn ihre Verarbeitung (MAX_NEUE_BELEGE_JE_LAUF) auf mehrere
// Laeufe verteilt wird und das Protokoll schon Zeilen "Lieferbestaetigung" hat.
export const ERSTBESTAND_BIS = '20261022';
export function istErstbestandsDatei(name) {
  const m = /_(20\d{6})\d{6}\.xml$/i.exec(String(name ?? ''));
  return Boolean(m) && m[1] <= ERSTBESTAND_BIS;
}

// Je Lauf hoechstens so viele neue Belege laden/archivieren (Scheduler-Frist 300 s; ein Upload nach
// Drive dauert ~1-3 s). Der Rest kommt im naechsten Takt (Antwortfeld "offen").
export const MAX_NEUE_BELEGE_JE_LAUF = 15;

/** Spaltenindizes LShop_Sendungen ueber den Namen; fehlende Spalte -> 422. */
export function sendungenSpalten(header) {
  const norm = (header ?? []).map(normHeader);
  const idx = {};
  const fehlt = [];
  for (const n of SENDUNGEN_SPALTEN) { const i = norm.indexOf(normHeader(n)); if (i < 0) fehlt.push(n); else idx[n] = i; }
  if (fehlt.length) {
    const e = new Error(`Reiter "${SENDUNGEN_TAB}": Spalte(n) fehlen: ${fehlt.join(', ')}`);
    e.status = 422;
    throw e;
  }
  return idx;
}

export function sendungenZeilen(werte) {
  const [kopf = [], ...rest] = werte ?? [];
  const idx = sendungenSpalten(kopf);
  return rest.filter(r => r.some(v => t(v))).map(r => Object.fromEntries(SENDUNGEN_SPALTEN.map(n => [n, t(r[idx[n]])])));
}

/** Ist eine vorhandene Sendung inhaltlich dieselbe (VA, LA, order_id, Tracking)? */
export function gleicheSendung(alt, neu) {
  return alt.VA === neu.VA && alt.LA === neu.LA && alt.order_id === neu.order_id && alt.Tracking_URL === neu.Tracking_URL;
}

// Anzeige je Bestellung: utils/lshop-bestellungen.js (BO4d).

/** Zeile fuer LShop_Sendungen in Kopfreihenfolge. */
export function sendungZeile(idx, felder) {
  const zeile = Array(Math.max(...Object.values(idx)) + 1).fill('');
  for (const n of SENDUNGEN_SPALTEN) zeile[idx[n]] = felder[n] == null ? '' : String(felder[n]);
  return zeile;
}

export function buildVersandtNachricht({ orderId, pakete }) {
  const fr = [...new Set(pakete.map(p => p.frachtfuehrer).filter(Boolean))].join('/') || 'Versand';
  const links = pakete.map(p => p.url).filter(Boolean);
  return [
    `📦 L-Shop versandt: ${orderId} · ${pakete.length} Paket${pakete.length !== 1 ? 'e' : ''} (${fr})`,
    links.length ? `Tracking: ${links.join(' · ')}` : '',
  ].filter(Boolean).join('\n');
}
