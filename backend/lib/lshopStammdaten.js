// L-Shop-Stammdaten-Update (Befehl LS1) - einzige Quelle. Kein Sprachmodell.
//
// Ablauf: neueste Datei "DE_Standard_DE_EUR_<TT.MM.JJJJ>.csv" in der geteilten
// Ablage (Drive-API, supportsAllDrives) -> streamen, nie speichern -> nur die
// gebrauchten Modelle behalten -> gegen den Reiter "LShop_Modelle" (SSOT)
// abgleichen -> Trockenlauf (nur Zaehler) oder Uebernehmen (schreiben,
// zuruecklesen, Chat).
//
// Die Datei hat 180.000 Zeilen x 106 Spalten (Befund LS0b): Semikolon, UTF-8
// mit BOM, CRLF, Felder mit ";" in Anfuehrungszeichen. Zugeordnet wird NUR ueber
// den Spaltennamen; fehlt ein benoetigter Name oder steht er doppelt, bricht der
// Lauf ab, bevor irgendetwas geschrieben wird.
//
// Reiter LShop_Modelle: die 15 CSV-Spalten (Namen exakt wie CSV) + Status,
// Quelle_Datei, Quelle_Datum, Stand.
//  - Schluessel ArticleNr. Eine Zeile, deren ArticleNr in der Datei fehlt, bleibt
//    stehen und bekommt Status "ausgelaufen" (Varianten.LShop_ArticleNr soll nie
//    ins Leere zeigen). Taucht sie wieder auf, wird sie wieder "aktiv".
//  - Quelle_Datei/Quelle_Datum = letzte Datei, in der die Zeile stand.
//    Stand = Zeitpunkt der letzten inhaltlichen Aenderung (neu, geaendert,
//    Status).
//  - ArticleNr, EAN, CatNrManufacturer als TEXT (Spaltenformat + RAW-String):
//    als Zahl verliert CatNrManufacturer die fuehrende Null (03581 -> 3581) und
//    EAN wird zu 4,25E+12 (Befund LS0/LS0b). EAN bleibt Rohtext, auch mit 12
//    oder 14 Ziffern.
//  - 10CartonsPrice als Zahl (Komma selbst umgewandelt, nie Text).
//    Discontinued und QtyCarton als Zahl, wenn ganzzahlig, sonst Rohtext.
//  - Partner_Artikel und Verkaufszeilen werden nie beruehrt: EK wirkt nie
//    rueckwirkend.
//
// Die Leser (lshop.js TAB_LSHOP, partnerArtikel.js) lesen noch SKU_LShop; die
// Umstellung ist LS2.
//
// Datenschutz/Geheimhaltung: nichts aus der Datei geht ins Log oder in die
// Antwort ausser Zaehlern, CatalogNr und (bei der Stichprobe) ArticleNr.
// Keine Preise.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { getWcClient } from './shopConfig.js';
import { leseReiterSpalten } from './ssot-reiter.js';
import { colLetter } from '../utils/sheet-spalten.js';

export const TAB_ZIEL   = 'LShop_Modelle';
export const TAB_ZUSATZ = 'Modelle_Zusatz';

export const CSV_SPALTEN = [
  'ArticleNr', 'CatalogNr', 'color1', 'color2', 'color3', 'color4', 'Size',
  'Consistence', 'Grammage', 'Brand', 'CatNrManufacturer', 'Discontinued',
  '10CartonsPrice', 'EAN', 'QtyCarton',
];
export const ZUSATZ_SPALTEN = ['Status', 'Quelle_Datei', 'Quelle_Datum', 'Stand'];
export const KOPF = [...CSV_SPALTEN, ...ZUSATZ_SPALTEN];
export const TEXT_SPALTEN = ['ArticleNr', 'EAN', 'CatNrManufacturer'];
export const PREIS_SPALTE = '10CartonsPrice';
const ZAHL_SPALTEN = ['Discontinued', 'QtyCarton'];

export const STATUS_AKTIV       = 'aktiv';
export const STATUS_AUSGELAUFEN = 'ausgelaufen';

export const DATEI_RE = /^DE_Standard_DE_EUR_(\d{2})\.(\d{2})\.(\d{4})\.csv$/;
const SCHREIB_BLOCK = 5000;

const t = v => String(v ?? '').trim();
const U = v => t(v).toUpperCase();

function fehler(msg, status = 400, extra = {}) {
  return Object.assign(new Error(msg), { status, ...extra });
}

// ── Datei ───────────────────────────────────────────────────────────────────

/** "DE_Standard_DE_EUR_07.09.2026.csv" -> "2026-09-07"; kein Muster -> null. */
export function namensDatum(name) {
  const m = DATEI_RE.exec(t(name));
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo}-${d}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** Neueste Datei nach Namensdatum (nicht Upload-Zeit); Gleichstand: juenger geaendert. */
export function neuesteDatei(dateien) {
  const passend = (dateien ?? []).filter(f => namensDatum(f.name));
  passend.sort((a, b) =>
    namensDatum(b.name).localeCompare(namensDatum(a.name))
    || t(b.modifiedTime).localeCompare(t(a.modifiedTime)));
  return passend[0] ?? null;
}

// ── CSV-Parser ──────────────────────────────────────────────────────────────

/**
 * Stream-Parser fuer Semikolon-CSV: BOM am Anfang weg, CRLF oder LF,
 * Anfuehrungszeichen ("" = ein "), Trenner und Zeilenumbruch im Feld erlaubt.
 * Leere Zeilen werden uebersprungen.
 * @param {(felder: string[]) => void} onZeile
 */
export function csvParser(onZeile, { trenner = ';' } = {}) {
  let feld = '', felder = [], inQ = false, qOffen = false, anfang = true, feldBegonnen = false;

  function zeileFertig() {
    if (feld.endsWith('\r')) feld = feld.slice(0, -1);
    felder.push(feld);
    if (!(felder.length === 1 && felder[0] === '')) onZeile(felder);
    felder = []; feld = ''; feldBegonnen = false;
  }

  function schreibe(text) {
    let s = String(text ?? '');
    if (anfang && s.length) { if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); anfang = false; }
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQ) {
        if (qOffen) {
          qOffen = false;
          if (c === '"') { feld += '"'; continue; }
          inQ = false;                    // Feld zu - Zeichen normal verarbeiten
        } else if (c === '"') { qOffen = true; continue; }
        else { feld += c; continue; }
      }
      if (c === '"' && !feldBegonnen) { inQ = true; feldBegonnen = true; continue; }
      if (c === trenner) { felder.push(feld); feld = ''; feldBegonnen = false; continue; }
      if (c === '\n') { zeileFertig(); continue; }
      feld += c; feldBegonnen = true;
    }
  }

  function ende() {
    if (inQ && qOffen) { inQ = false; qOffen = false; }
    if (feld !== '' || felder.length) zeileFertig();
  }
  return { schreibe, ende };
}

/**
 * Index je benoetigter Spalte, nur ueber den exakten Namen (BOM/Leerzeichen am
 * Rand weg). Fehlt einer oder steht er doppelt -> Fehler mit den Namen.
 */
export function spaltenIndex(kopf, benoetigt = CSV_SPALTEN) {
  const namen = (kopf ?? []).map(n => t(String(n ?? '').replace(/^﻿/, '')));
  const fehlt = benoetigt.filter(n => !namen.includes(n));
  const doppelt = benoetigt.filter(n => namen.indexOf(n) !== namen.lastIndexOf(n));
  if (fehlt.length || doppelt.length) {
    const teile = [];
    if (fehlt.length) teile.push(`fehlt: ${fehlt.join(', ')}`);
    if (doppelt.length) teile.push(`doppelt: ${doppelt.join(', ')}`);
    throw fehler(`Kopfzeile der Stammdatei unbrauchbar (${teile.join('; ')}) – nichts geschrieben.`, 422);
  }
  return Object.fromEntries(benoetigt.map(n => [n, namen.indexOf(n)]));
}

/**
 * Preis als Zahl: "4,25" -> 4.25, "1.234,50" -> 1234.5, "4.25" -> 4.25,
 * Zahl bleibt Zahl. Leer -> null, unlesbar -> NaN.
 */
export function preisZahl(v) {
  if (typeof v === 'number') return v;
  const s = t(v);
  if (!s) return null;
  let norm = s;
  if (s.includes(',')) norm = s.replace(/\./g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(norm) ? Number(norm) : NaN;
}

const ganzzahl = v => (/^-?\d+$/.test(t(v)) ? Number(t(v)) : t(v));

// ── Gebrauchte Modelle ──────────────────────────────────────────────────────

const MODELL_RE = /^[A-Z]{1,5}\d{2,5}[A-Z]{0,2}$/;
const ALTPRAEFIX_RE = /^(KING|QUEEN)[\s_-]+/i;

/**
 * Modellnummer aus einer SKU/Artikelnummer (Regel wie LS0): Altpraefix
 * King/Queen weg, erster Token bis "/", "_", "-" oder Leerzeichen, gross.
 * Zaehlt nur, wenn er wie eine L-Shop-Nummer aussieht (Buchstaben + Ziffern
 * [+ Buchstaben]); "Tasse", "POLY-CB-20x25" -> null.
 */
export function modellAus(wert) {
  const token = U(t(wert).replace(ALTPRAEFIX_RE, '')).split(/[\s/_-]/)[0];
  return MODELL_RE.test(token) ? token : null;
}

/**
 * @param {Object<string, string[]>} quellen  Quelle -> Werte (SKUs, Nummern, CatalogNr)
 * @returns {Map<string, Set<string>>} Modell -> Quellen
 */
export function gebrauchteModelle(quellen) {
  const modelle = new Map();
  for (const [quelle, werte] of Object.entries(quellen ?? {})) {
    for (const w of werte ?? []) {
      const m = modellAus(w);
      if (!m) continue;
      if (!modelle.has(m)) modelle.set(m, new Set());
      modelle.get(m).add(quelle);
    }
  }
  return modelle;
}

// Levenshtein, fuer Kandidaten bei Nicht-Treffern (nur Hinweis, nie geraten).
function abstand(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function kandidaten(modell, katalog, max = 5) {
  const m = U(modell);
  const out = [];
  for (const k of katalog ?? []) {
    if (k === m) continue;
    const nah = Math.abs(k.length - m.length) <= 1 && abstand(k, m) <= 1;
    const praefix = k.length >= 3 && m.length > k.length && m.startsWith(k);
    if (nah || praefix) out.push(k);
  }
  return out.sort().slice(0, max);
}

// ── Datei lesen ─────────────────────────────────────────────────────────────

/**
 * Liest die CSV (Stream aus Buffern oder Strings) und behaelt nur die Zeilen
 * der gebrauchten Modelle und der Bestandsnummern.
 *
 * @param {AsyncIterable<Buffer|string>} stream
 * @param {object} o
 * @param {Set<string>} o.modelle       CatalogNr (gross)
 * @param {Set<string>} [o.bestandNrs]  ArticleNr aus LShop_Modelle
 * @param {Set<string>} [o.variantenNrs] ArticleNr aus Varianten
 */
export async function leseCsv(stream, { modelle, bestandNrs = new Set(), variantenNrs = new Set() } = {}) {
  const zeilen = new Map();                 // ArticleNr -> Datensatz (CSV-Spalten, Rohtext)
  const katalog = new Set();                // alle CatalogNr der Datei (gross)
  const variantenKatalog = new Map();       // ArticleNr -> CatalogNr (gross)
  const z = { dateiZeilen: 0, ungueltigeArticleNr: 0, doppelteArticleNr: 0, falscheFeldzahl: 0 };
  let idx = null, breite = 0;
  const gesehen = new Set();

  const parser = csvParser(felder => {
    if (!idx) { idx = spaltenIndex(felder); breite = felder.length; return; }
    z.dateiZeilen++;
    if (felder.length !== breite) z.falscheFeldzahl++;
    const art = t(felder[idx.ArticleNr]);
    const cat = U(felder[idx.CatalogNr]);
    if (cat) katalog.add(cat);
    if (!/^\d{10}$/.test(art)) { z.ungueltigeArticleNr++; return; }
    if (variantenNrs.has(art) && cat) variantenKatalog.set(art, cat);
    if (!modelle.has(cat) && !bestandNrs.has(art)) return;
    if (gesehen.has(art)) { z.doppelteArticleNr++; return; }
    gesehen.add(art);
    const d = {};
    for (const n of CSV_SPALTEN) d[n] = t(felder[idx[n]]);
    zeilen.set(art, d);
  });

  const dec = new TextDecoder('utf-8');
  for await (const chunk of stream) parser.schreibe(typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true }));
  parser.schreibe(dec.decode());
  parser.ende();
  if (!idx) throw fehler('Stammdatei ist leer – nichts geschrieben.', 422);
  return { zeilen, katalog, variantenKatalog, zaehler: z };
}

// ── Abgleich ────────────────────────────────────────────────────────────────

function vergleichswert(spalte, v) {
  if (spalte === PREIS_SPALTE) {
    const p = preisZahl(v);
    return p === null ? '' : Number.isFinite(p) ? String(Math.round(p * 10000) / 10000) : `?${t(v)}`;
  }
  return t(v);
}

/**
 * @param {object} o
 * @param {object[]} o.bestand  Zeilen aus LShop_Modelle als { Spalte: Wert }
 * @param {Map<string, object>} o.csv  ArticleNr -> Datensatz (nur CSV-Spalten)
 * @param {{ name: string, datum: string }} o.datei  datum = "TT.MM.JJJJ"
 * @param {string} o.stand  Zeitstempel dieses Laufs
 * @returns {{ zeilen: object[], zaehler: object }}
 */
export function abgleich({ bestand = [], csv = new Map(), datei, stand }) {
  const zaehler = {
    neu: 0, geaendert: 0, unveraendert: 0, ausgelaufen: 0, bleibtAusgelaufen: 0, reaktiviert: 0,
    preisAenderungen: 0, spalten: {},
  };
  const nrs = new Set();
  const zeilen = [];
  for (const alt of bestand) {
    const nr = t(alt.ArticleNr);
    if (nrs.has(nr)) throw fehler(`ArticleNr ${nr} steht doppelt im Reiter ${TAB_ZIEL} – nichts geschrieben.`, 409);
    nrs.add(nr);
    const neu = csv.get(nr);
    const warAus = t(alt.Status) === STATUS_AUSGELAUFEN;
    if (!neu) {
      if (warAus) { zaehler.bleibtAusgelaufen++; zeilen.push({ ...alt }); }
      else { zaehler.ausgelaufen++; zeilen.push({ ...alt, Status: STATUS_AUSGELAUFEN, Stand: stand }); }
      continue;
    }
    const diff = CSV_SPALTEN.filter(n => vergleichswert(n, alt[n]) !== vergleichswert(n, neu[n]));
    for (const n of diff) {
      if (n === PREIS_SPALTE) zaehler.preisAenderungen++;
      else zaehler.spalten[n] = (zaehler.spalten[n] ?? 0) + 1;
    }
    if (warAus) zaehler.reaktiviert++;
    const geaendert = diff.length > 0 || warAus;
    if (geaendert) zaehler.geaendert++; else zaehler.unveraendert++;
    zeilen.push({
      ...neu, Status: STATUS_AKTIV, Quelle_Datei: datei.name, Quelle_Datum: datei.datum,
      Stand: geaendert ? stand : t(alt.Stand),
    });
  }
  const neue = [...csv.entries()].filter(([nr]) => !nrs.has(nr)).map(([, d]) => d);
  neue.sort((a, b) => a.CatalogNr.localeCompare(b.CatalogNr));   // stabil: innerhalb Modell CSV-Reihenfolge
  for (const d of neue) {
    zaehler.neu++;
    zeilen.push({ ...d, Status: STATUS_AKTIV, Quelle_Datei: datei.name, Quelle_Datum: datei.datum, Stand: stand });
  }
  return { zeilen, zaehler };
}

/** Zeile fuer values.update (RAW): Text bleibt String, Preis/Zahlen als Zahl. */
export function zeileFuersSheet(z) {
  return KOPF.map(n => {
    const v = z[n];
    if (n === PREIS_SPALTE) { const p = preisZahl(v); return p === null || Number.isNaN(p) ? '' : p; }
    if (ZAHL_SPALTEN.includes(n)) return typeof v === 'number' ? v : ganzzahl(v);
    return t(v);
  });
}

// ── Google-Zugriffe ─────────────────────────────────────────────────────────

async function clients() {
  const auth = await getGoogleAuth();
  return { sheets: google.sheets({ version: 'v4', auth }), drive: google.drive({ version: 'v3', auth }) };
}

export async function findeDatei({ drive, driveId }) {
  if (!driveId) throw fehler('GOOGLE_DRIVE_SHARED_DRIVE_ID fehlt.', 500);
  const dateien = [];
  let pageToken;
  do {
    const { data } = await drive.files.list({
      corpora: 'drive', driveId, includeItemsFromAllDrives: true, supportsAllDrives: true,
      q: "name contains 'DE_Standard_DE_EUR_' and trashed = false",
      fields: 'nextPageToken, files(id, name, size, modifiedTime)', pageSize: 100, pageToken,
    });
    dateien.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  const f = neuesteDatei(dateien);
  if (!f) throw fehler('Keine Datei "DE_Standard_DE_EUR_<TT.MM.JJJJ>.csv" in der geteilten Ablage.', 404);
  const [y, m, d] = namensDatum(f.name).split('-');
  return { id: f.id, name: f.name, groesse: Number(f.size) || null, datum: `${d}.${m}.${y}`, anzahlPassend: dateien.filter(x => namensDatum(x.name)).length };
}

async function dateiStream({ drive, id }) {
  const res = await drive.files.get({ fileId: id, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
  return res.data;
}

async function wcSkus(wc) {
  const out = [];
  for (let page = 1; ; page++) {
    const { data } = await wc.get('products', { status: 'any', per_page: 100, page, _fields: 'id,sku' });
    const liste = Array.isArray(data) ? data : [];
    out.push(...liste.map(p => t(p.sku)).filter(Boolean));
    if (liste.length < 100) break;
  }
  return out;
}

async function leseOptionalenReiter(fn) {
  try { return { werte: await fn(), fehlt: false }; }
  catch (err) {
    const msg = String(err?.message ?? '');
    if (err?.status === 400 || /Unable to parse range|fehlt oder hat keine Kopfzeile/i.test(msg)) return { werte: [], fehlt: true };
    throw err;
  }
}

/**
 * Quellen der gebrauchten Modelle: Shop-SKUs JFN + HonkShop, Partner_Artikel
 * (Business-Sheet), Varianten.LShop_ArticleNr, Erfassungsmaske, Modelle_Zusatz.
 */
export async function sammleQuellen({ sheets, wcFuer, ssotId, businessId }) {
  const o = { sheets, spreadsheetId: ssotId };
  const [jfn, honk, partner, varianten, erfassung, zusatz] = await Promise.all([
    wcSkus(wcFuer('jfn')),
    wcSkus(wcFuer('honk')),
    leseReiterSpalten({ tab: 'Partner_Artikel', spalten: { nr: 'Artikelnummer' }, sheets, spreadsheetId: businessId }),
    leseReiterSpalten({ tab: 'Varianten', spalten: { ssot: 'SSOT-ID' }, optional: { nr: 'LShop_ArticleNr' }, ...o }),
    leseReiterSpalten({ tab: 'Erfassungsmaske', spalten: { nr: 'L-Shop-Artikelnummer' }, ...o }),
    leseOptionalenReiter(() => leseReiterSpalten({ tab: TAB_ZUSATZ, spalten: { cat: 'CatalogNr' }, ...o })),
  ]);
  return {
    quellen: {
      'Shop JFN': jfn,
      'Shop HonkShop': honk,
      Partner_Artikel: partner.map(z => z.nr),
      Erfassungsmaske: erfassung.map(z => z.nr),
      [TAB_ZUSATZ]: zusatz.werte.map(z => z.cat),
    },
    variantenNrs: new Set(varianten.map(z => t(z.nr)).filter(n => /^\d{10}$/.test(n))),
    zusatzFehlt: zusatz.fehlt,
  };
}

/** Bestand des Zielreiters (UNFORMATTED: Preis als Zahl, Text als String). */
export async function leseBestand({ sheets, ssotId }) {
  let werte;
  try {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: ssotId, range: TAB_ZIEL, valueRenderOption: 'UNFORMATTED_VALUE',
    });
    werte = data.values ?? [];
  } catch (err) {
    if (err?.status === 400 || /Unable to parse range/i.test(String(err?.message))) return { fehlt: true, zeilen: [] };
    throw err;
  }
  const kopf = (werte[0] ?? []).map(t);
  if (!kopf.length) return { fehlt: false, leer: true, zeilen: [] };
  if (kopf.length !== KOPF.length || kopf.some((n, i) => n !== KOPF[i]))
    throw fehler(`Kopfzeile von ${TAB_ZIEL} weicht ab (erwartet: ${KOPF.join(', ')}) – nichts geschrieben.`, 409);
  const zeilen = werte.slice(1)
    .filter(r => r.some(c => t(c)))
    .map(r => Object.fromEntries(KOPF.map((n, i) => [n, r[i] ?? ''])));
  return { fehlt: false, zeilen };
}

// ── Lauf ────────────────────────────────────────────────────────────────────

function berlinStand(jetzt = new Date()) {
  const s = jetzt.toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' });   // "2026-09-26 12:10:00"
  return s.slice(0, 16);
}

/**
 * Trockenlauf oder Uebernehmen.
 * @param {object} o
 * @param {'trockenlauf'|'uebernehmen'} o.modus
 * @param {string} [o.datei]  Dateiname des Trockenlaufs (Pflicht bei uebernehmen)
 */
export async function stammdatenLauf({
  modus, datei, sheets, drive, wcFuer = getWcClient, notify = null, baueMeldung = null,
  ssotId = process.env.GOOGLE_SHEET_ID, businessId = process.env.BUSINESS_SHEET_ID,
  driveId = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID, jetzt = new Date(), stream = dateiStream,
} = {}) {
  if (!['trockenlauf', 'uebernehmen'].includes(modus)) throw fehler('modus muss "trockenlauf" oder "uebernehmen" sein.');
  if (modus === 'uebernehmen' && !t(datei)) throw fehler('Übernehmen braucht den Dateinamen des Trockenlaufs (datei).');
  if (!sheets || !drive) { const c = await clients(); sheets ??= c.sheets; drive ??= c.drive; }

  const d = await findeDatei({ drive, driveId });
  if (modus === 'uebernehmen' && t(datei) !== d.name)
    throw fehler(`Der Trockenlauf beruhte auf "${t(datei)}", neueste Datei ist jetzt "${d.name}" – bitte neu prüfen.`, 409);

  const [q, bestand] = await Promise.all([
    sammleQuellen({ sheets, wcFuer, ssotId, businessId }),
    leseBestand({ sheets, ssotId }),
  ]);
  const modelle = gebrauchteModelle(q.quellen);
  const bestandNrs = new Set(bestand.zeilen.map(z => t(z.ArticleNr)));

  let gelesen = await leseCsv(await stream({ drive, id: d.id }), { modelle: new Set(modelle.keys()), bestandNrs, variantenNrs: q.variantenNrs });
  // Modelle, die nur ueber Varianten.LShop_ArticleNr bekannt sind: zweiter Durchlauf.
  const nurVarianten = [...new Set(gelesen.variantenKatalog.values())].filter(c => !modelle.has(c));
  for (const c of nurVarianten) modelle.set(c, new Set(['Varianten']));
  for (const c of new Set(gelesen.variantenKatalog.values())) modelle.get(c)?.add('Varianten');
  if (nurVarianten.length) {
    gelesen = await leseCsv(await stream({ drive, id: d.id }), { modelle: new Set(modelle.keys()), bestandNrs, variantenNrs: q.variantenNrs });
  }

  const stand = berlinStand(jetzt);
  const { zeilen, zaehler } = abgleich({ bestand: bestand.zeilen, csv: gelesen.zeilen, datei: d, stand });

  const nichtTreffer = [...modelle.entries()]
    .filter(([m]) => !gelesen.katalog.has(m))
    .map(([m, quellen]) => ({ catalogNr: m, quellen: [...quellen].sort(), kandidaten: kandidaten(m, gelesen.katalog) }))
    .sort((a, b) => a.catalogNr.localeCompare(b.catalogNr));
  const gefunden = [...modelle.keys()].filter(m => gelesen.katalog.has(m)).length;
  const aktiv = zeilen.filter(z => z.Status === STATUS_AKTIV);

  const antwort = {
    ok: true, modus,
    datei: { name: d.name, datum: d.datum, groesse: d.groesse, passendeDateien: d.anzahlPassend },
    reiter: { name: TAB_ZIEL, vorhanden: !bestand.fehlt, zeilenVorher: bestand.zeilen.length },
    modelle: { gebraucht: modelle.size, gefunden, ohneTreffer: nichtTreffer.length },
    zeilen: {
      gesamt: zeilen.length, aktiv: aktiv.length,
      neu: zaehler.neu, geaendert: zaehler.geaendert, unveraendert: zaehler.unveraendert,
      ausgelaufen: zaehler.ausgelaufen, bleibtAusgelaufen: zaehler.bleibtAusgelaufen, reaktiviert: zaehler.reaktiviert,
    },
    geaendertJeSpalte: zaehler.spalten,
    preisAenderungen: zaehler.preisAenderungen,
    discontinuedGesperrt: aktiv.filter(z => ['3', '6'].includes(t(z.Discontinued))).length,
    dateiZaehler: gelesen.zaehler,
    nichtTreffer,
    hinweise: [
      ...(q.zusatzFehlt ? [`Reiter ${TAB_ZUSATZ} fehlt – als leer behandelt.`] : []),
      ...(bestand.fehlt ? [`Reiter ${TAB_ZIEL} fehlt – wird beim Übernehmen angelegt.`] : []),
      ...(gelesen.zaehler.falscheFeldzahl ? [`${gelesen.zaehler.falscheFeldzahl} Zeile(n) der Datei mit abweichender Feldzahl.`] : []),
      ...(gelesen.zaehler.ungueltigeArticleNr ? [`${gelesen.zaehler.ungueltigeArticleNr} Zeile(n) ohne gültige ArticleNr (10 Ziffern) übersprungen.`] : []),
    ],
  };
  if (modus === 'trockenlauf') return antwort;

  // ── Uebernehmen ──
  const sheetId = await sichereReiter({ sheets, ssotId, zeilenBedarf: zeilen.length + 1 });
  await schreibeZeilen({ sheets, ssotId, zeilen, zeilenVorher: bestand.zeilen.length });
  antwort.rueckgelesen = await pruefeRueck({ sheets, ssotId, zeilen });
  antwort.reiter.sheetId = sheetId;

  if (notify && baueMeldung) {
    const text = baueMeldung({
      datum: d.datum, modelle: gefunden, neu: zaehler.neu, geaendert: zaehler.geaendert,
      ausgelaufen: zaehler.ausgelaufen, preisAenderungen: zaehler.preisAenderungen,
      ohneTreffer: nichtTreffer.map(n => n.catalogNr),
    });
    let ok = false;
    try { ok = await notify(text); } catch { ok = false; }
    antwort.chat = ok ? 'gesendet' : 'fehlgeschlagen';
  }
  return antwort;
}

// Reiter anlegen (Kopfzeile + Textformat) bzw. Raster vergroessern. Textformat
// wird jedes Mal gesetzt (idempotent), damit ein von Hand umformatierter
// Reiter nicht wieder Zahlen aus Nummern macht.
async function sichereReiter({ sheets, ssotId, zeilenBedarf }) {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId: ssotId, fields: 'sheets.properties(sheetId,title,gridProperties)' });
  let tab = (data.sheets ?? []).find(s => s.properties?.title === TAB_ZIEL)?.properties;
  const requests = [];
  if (!tab) {
    const antwort = await sheets.spreadsheets.batchUpdate({ spreadsheetId: ssotId, requestBody: { requests: [{ addSheet: { properties: {
      title: TAB_ZIEL, gridProperties: { rowCount: zeilenBedarf + 100, columnCount: KOPF.length, frozenRowCount: 1 },
    } } }] } });
    tab = antwort.data.replies[0].addSheet.properties;
    await sheets.spreadsheets.values.update({
      spreadsheetId: ssotId, range: `${TAB_ZIEL}!A1`, valueInputOption: 'RAW', requestBody: { values: [KOPF] },
    });
  } else if ((tab.gridProperties?.rowCount ?? 0) < zeilenBedarf) {
    requests.push({ appendDimension: { sheetId: tab.sheetId, dimension: 'ROWS', length: zeilenBedarf - tab.gridProperties.rowCount + 100 } });
  }
  for (const n of TEXT_SPALTEN) {
    const i = KOPF.indexOf(n);
    requests.push({ repeatCell: {
      range: { sheetId: tab.sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
      fields: 'userEnteredFormat.numberFormat',
    } });
  }
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: ssotId, requestBody: { requests } });
  return tab.sheetId;
}

// Erst ueberschreiben, dann den Rest leeren - nie erst leeren (bricht der Lauf
// ab, stuende sonst ein halb leerer Reiter da). Die Zeilenzahl waechst nur
// (ausgelaufene bleiben), der Rest ist also normal leer.
async function schreibeZeilen({ sheets, ssotId, zeilen, zeilenVorher }) {
  const letzte = colLetter(KOPF.length - 1);
  for (let i = 0; i < zeilen.length; i += SCHREIB_BLOCK) {
    const block = zeilen.slice(i, i + SCHREIB_BLOCK).map(zeileFuersSheet);
    await sheets.spreadsheets.values.update({
      spreadsheetId: ssotId, range: `${TAB_ZIEL}!A${i + 2}:${letzte}${i + 1 + block.length}`,
      valueInputOption: 'RAW', requestBody: { values: block },
    });
  }
  if (zeilenVorher > zeilen.length) {
    await sheets.spreadsheets.values.clear({ spreadsheetId: ssotId, range: `${TAB_ZIEL}!A${zeilen.length + 2}:${letzte}` });
  }
}

// Zuruecklesen: Zeilenzahl, Status-Zaehler, Stichprobe (erste, mittlere,
// letzte Zeile) - Textspalten muessen als identischer String zurueckkommen.
async function pruefeRueck({ sheets, ssotId, zeilen }) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: ssotId, range: TAB_ZIEL, valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rueck = (data.values ?? []).slice(1).filter(r => r.some(c => t(c)));
  const iArt = KOPF.indexOf('ArticleNr'), iStatus = KOPF.indexOf('Status');
  const byNr = new Map(rueck.map(r => [String(r[iArt] ?? ''), r]));
  const proben = [...new Set([0, Math.floor(zeilen.length / 2), zeilen.length - 1])].filter(i => i >= 0 && i < zeilen.length);
  const stichprobe = proben.map(i => {
    const soll = zeilen[i];
    const ist = byNr.get(t(soll.ArticleNr));
    const wert = n => ist[KOPF.indexOf(n)];
    const textOk = n => (t(soll[n]) === '' ? (wert(n) ?? '') === '' : typeof wert(n) === 'string' && wert(n) === t(soll[n]));
    const ok = !!ist && TEXT_SPALTEN.every(textOk)
      && ['CatalogNr', 'color1', 'Size', 'Status'].every(n => String(wert(n) ?? '') === t(soll[n]));
    return { articleNr: t(soll.ArticleNr), ok };
  });
  const aktiv = rueck.filter(r => r[iStatus] === STATUS_AKTIV).length;
  return {
    zeilen: rueck.length, erwartet: zeilen.length, aktiv, ausgelaufen: rueck.length - aktiv,
    stichprobe, ok: rueck.length === zeilen.length && stichprobe.every(s => s.ok),
  };
}
