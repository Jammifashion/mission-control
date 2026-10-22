// Belege von L-Shop abrufen (BO4b-1) - Ein-/Ausgabe, Logik in utils/lshop-belege.js, FTP nur lesend
// ueber lib/lshopFtp.js.
//
//  - POST /api/intern/lshop-belege/abruf      Cloud Scheduler (Job lshop-belege-abruf, :07 und :37)
//  - POST /api/bestellen/lshop-belege/abruf   Knopf "Belege jetzt abrufen" (API-Key, mit Trockenlauf)
//
// Ablauf: Protokoll (LShop_Belege) und LShop_EDI_Dateien lesen -> EINE FTP-Verbindung: Ordner listen,
// nur neue/geaenderte Auftragsbestaetigungen laden -> bewerten -> Protokollzeilen anhaengen (Muster des
// Korbs, zurueckgelesen) -> erst DANN Chat. Dateien auf dem FTP bleiben liegen.
// FTP-Fehler (Server wackelt) sind kein 5xx: Zeile "Lauf/fehler", Chat erst ab 3 Fehllaeufen in Folge
// (hoechstens 1/h, Zustand im Reiter, weil Cloud-Run-Instanzen zwischen den Takten wegfallen).
// Andere Fehler (Sheets) bleiben 5xx -> Scheduler-Versuch rot -> Log-Alarm.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { mitLShopFtp, LShopFtpFehler } from './lshopFtp.js';
import { notify } from './chatNotify.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { ersteFreieZeile, bereichLeer, vergleicheZurueck } from '../utils/korb-logic.js';
import { EDI_TAB } from '../utils/edi-bestellung.js';
import {
  BELEGE_TAB, BELEGE_SPALTEN, ORDNER, ART, ERGEBNIS, belegeSpalten, belegeZeilen, protokollNachDatei, dekodiere, sha256,
  ediStatusMap, ftpZeit, bewerteOrderDatei, bewerteAb, eintragGeaendert, fehlerSerie, fehllaufMelden, belegZeile,
  buildBelegeAlarmNachricht, buildAbErkanntNachricht, buildFtpFehlerNachricht,
} from '../utils/lshop-belege.js';

export const LAUF_ZEITLIMIT_MS = 240_000;   // Scheduler-Versuchsfrist 300 s
const q = tab => `'${tab}'`;

function fehler(msg, status, extra = {}) {
  const e = new Error(msg);
  e.status = status;
  Object.assign(e, extra);
  return e;
}

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}

async function reiter(sheets, spreadsheetId, titel) {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId,gridProperties)' });
  return (data.sheets ?? []).map(s => s.properties).find(p => p.title === titel) ?? null;
}

async function werte(sheets, spreadsheetId, tab) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: q(tab), valueRenderOption: 'FORMATTED_VALUE' });
  return data.values ?? [];
}

// Eine Sperre je Instanz; instanzuebergreifend schuetzt die Pruefung vor dem Schreiben.
let laeuft = false;
export const BELEGE_BESCHAEFTIGT = 'Der Beleg-Abruf läuft gerade - bitte gleich noch einmal.';
export function _belegeSperreLoesen() { laeuft = false; }

/**
 * Neue Zeilen ohne append (Muster des Korbs): erste freie Zeile, Nachbarzeile oben und Zielbereich
 * (plus eine Zeile darunter) pruefen, values.update RAW, zuruecklesen.
 */
async function haengeAn({ sheets, spreadsheetId, info, alt, zeilen }) {
  if (!zeilen.length) return null;
  const breite = Math.max(...zeilen.map(z => z.length));
  const ende = colLetter(breite - 1);
  const start = ersteFreieZeile(alt);
  const letzte = start + zeilen.length - 1;
  const raster = info?.gridProperties?.rowCount ?? 0;
  if (raster < letzte + 1) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
      { appendDimension: { sheetId: info.sheetId, dimension: 'ROWS', length: letzte + 1 - raster } },
    ] } });
  }
  const { data: um } = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${q(BELEGE_TAB)}!A${start - 1}:${ende}${letzte + 1}`, valueRenderOption: 'FORMATTED_VALUE',
  });
  const umgebung = um.values ?? [];
  if (vergleicheZurueck([(alt[start - 2] ?? []).slice(0, breite)], [umgebung[0] ?? []]).length) {
    throw fehler(`${BELEGE_TAB}: Zeile ${start - 1} hat sich seit dem Lesen geaendert - nichts geschrieben.`, 409);
  }
  if (!bereichLeer(umgebung.slice(1))) throw fehler(`${BELEGE_TAB}: Zielzeilen ab ${start} sind nicht leer - nichts geschrieben.`, 409);
  const range = `${q(BELEGE_TAB)}!A${start}:${ende}${letzte}`;
  await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: zeilen } });
  const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'FORMATTED_VALUE' });
  if (vergleicheZurueck(zeilen, zurueck.values ?? []).length) throw fehler(`${BELEGE_TAB}: Rücklesen ab Zeile ${start} weicht ab.`, 500);
  return { von: start, bis: letzte };
}

/** FTP-Teil: eine Verbindung, Listen + Laden der neuen/geaenderten Auftragsbestaetigungen. */
async function holeVomFtp(ftp, protokoll, deadline) {
  const listen = {};
  for (const o of [ORDNER.ORDER, ORDNER.AB, ORDNER.LB, ORDNER.RE_XML, ORDNER.RE_PDF]) {
    listen[o] = (await ftp.liste(o)).filter(e => e.istDatei);
  }
  const geladen = new Map();
  let offen = 0;
  for (const e of listen[ORDNER.AB]) {
    const p = protokoll.get(`${ORDNER.AB}/${e.name}`);
    if (p && !eintragGeaendert(e, p)) continue;
    if (Date.now() > deadline) { offen++; continue; }
    geladen.set(e.name, await ftp.lade(ORDNER.AB, e.name));
  }
  return { listen, geladen, offen };
}

/**
 * Ein Abruf. Rueckgabe = Zusammenfassung ohne Zugangsdaten und ohne Inhalte.
 * @param {{ dryRun?: boolean, quelle?: string, laufId?: string, sheets?: any, ftp?: Function, melde?: Function, jetzt?: () => Date }} o
 */
export async function runBelegeAbruf({
  dryRun = false, quelle = 'knopf', laufId, sheets: s, ftp = mitLShopFtp, melde = notify, jetzt = () => new Date(),
} = {}) {
  if (laeuft) throw fehler(BELEGE_BESCHAEFTIGT, 409);
  laeuft = true;
  try {
    const nun = jetzt();
    const lauf = laufId || `${quelle === 'scheduler' ? 'BA' : 'K'}-${nun.toISOString().slice(0, 16)}Z`;
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
    const info = await reiter(sheets, spreadsheetId, BELEGE_TAB);
    if (!info) throw fehler(`Reiter "${BELEGE_TAB}" fehlt - erst anlegen (scripts/setup-lshop-belege-reiter.js).`, 409);
    if (!await reiter(sheets, spreadsheetId, EDI_TAB)) throw fehler(`Reiter "${EDI_TAB}" fehlt.`, 409);
    const alt = await werte(sheets, spreadsheetId, BELEGE_TAB);
    const idx = belegeSpalten(alt[0]);
    const zeilen = belegeZeilen(alt);
    const protokoll = protokollNachDatei(zeilen);
    const ediStatus = ediStatusMap(await werte(sheets, spreadsheetId, EDI_TAB));
    const serie = fehlerSerie(zeilen);
    const zeile = felder => belegZeile(idx, { Gelesen: nun.toISOString(), Lauf: lauf, ...felder });

    // ── FTP ──
    let ftpDaten;
    try {
      ftpDaten = await ftp(f => holeVomFtp(f, protokoll, Date.now() + LAUF_ZEITLIMIT_MS));
    } catch (err) {
      if (!(err instanceof LShopFtpFehler)) throw err;
      const melden = !dryRun && fehllaufMelden(serie, nun);
      if (!dryRun) {
        await haengeAn({ sheets, spreadsheetId, info, alt, zeilen: [zeile({
          Art: ART.LAUF, Ergebnis: melden ? ERGEBNIS.FEHLER_GEMELDET : ERGEBNIS.FEHLER, Hinweis: err.message,
        })] });
      }
      const inFolge = serie.inFolge + 1;
      let gemeldet = false;
      if (melden) gemeldet = await melde(buildFtpFehlerNachricht({ inFolge, grund: err.message }));
      return { lauf, dryRun, ftp: 'fehler', grund: err.message, inFolge, gemeldet };
    }

    // ── Bewerten ──
    const neu = [];
    const alarme = [];
    const abErkannt = [];
    const orderZuLange = [];
    const { listen, geladen, offen } = ftpDaten;

    for (const e of listen[ORDNER.ORDER]) {
      const b = bewerteOrderDatei(e, ediStatus, nun);
      if (b.zuLange) orderZuLange.push({ datei: e.name, hinweis: b.hinweis });   // Alarm erst ab BO4c
      if (protokoll.has(`${ORDNER.ORDER}/${e.name}`)) continue;
      neu.push(zeile({
        Ordner: ORDNER.ORDER, Datei: e.name, Groesse: e.size, Geaendert_FTP: ftpZeit(e), Art: ART.ORDER,
        order_id: b.orderId, Ergebnis: b.ergebnis, Hinweis: b.hinweis,
      }));
      if (b.ergebnis === ERGEBNIS.ALARM) alarme.push({ ordner: ORDNER.ORDER, datei: e.name, hinweis: b.hinweis });
    }

    for (const e of listen[ORDNER.AB]) {
      const buf = geladen.get(e.name);
      if (!buf) continue;
      const hash = sha256(buf);
      const basis = { Ordner: ORDNER.AB, Datei: e.name, Groesse: e.size, Hash: hash, Geaendert_FTP: ftpZeit(e), Art: ART.AB };
      const p = protokoll.get(`${ORDNER.AB}/${e.name}`);
      if (p) {
        if (p.Hash === hash) {
          neu.push(zeile({ ...basis, order_id: p.order_id, Ergebnis: p.Ergebnis, Hinweis: 'Zeitstempel/Größe neu, Inhalt gleich' }));
        } else {
          const hinweis = 'Datei verändert (gleicher Name, anderer Inhalt) - nicht neu verarbeitet';
          neu.push(zeile({ ...basis, order_id: p.order_id, Ergebnis: ERGEBNIS.VERAENDERT, Hinweis: hinweis }));
          alarme.push({ ordner: ORDNER.AB, datei: e.name, hinweis });
        }
        continue;
      }
      const b = bewerteAb(dekodiere(buf), ediStatus);
      neu.push(zeile({ ...basis, order_id: b.orderIds.join(' '), Ergebnis: b.ergebnis, Hinweis: b.hinweis }));
      if (b.ergebnis === ERGEBNIS.ALARM) alarme.push({ ordner: ORDNER.AB, datei: e.name, hinweis: b.hinweis });
      else abErkannt.push({ datei: e.name, orderIds: b.orderIds });
    }

    if (serie.inFolge > 0) neu.push(zeile({ Art: ART.LAUF, Ergebnis: ERGEBNIS.OK_NACH_FEHLERN, Hinweis: `nach ${serie.inFolge} Fehllauf/-läufen` }));

    // ── Schreiben, erst danach melden ──
    let geschrieben = null;
    const gemeldet = { alarm: false, ab: false };
    if (!dryRun) {
      geschrieben = await haengeAn({ sheets, spreadsheetId, info, alt, zeilen: neu });
      if (alarme.length) gemeldet.alarm = await melde(buildBelegeAlarmNachricht(alarme));
      if (abErkannt.length) gemeldet.ab = await melde(buildAbErkanntNachricht(abErkannt));
    }

    const anzahl = o => listen[o].length;
    return {
      lauf, dryRun, ftp: 'ok',
      ordner: {
        [ORDNER.ORDER]: anzahl(ORDNER.ORDER), [ORDNER.AB]: anzahl(ORDNER.AB), [ORDNER.LB]: anzahl(ORDNER.LB),
        [ORDNER.RE_XML]: anzahl(ORDNER.RE_XML), [ORDNER.RE_PDF]: anzahl(ORDNER.RE_PDF),
      },
      neueZeilen: neu.length, alarme, abErkannt, orderZuLange, offen, geschrieben, gemeldet,
    };
  } finally {
    laeuft = false;
  }
}

// ── Einrichtung (scripts/setup-lshop-belege-reiter.js) ──────────────────────

/** Reiter LShop_Belege (SSOT) mit Kopfzeile anlegen. Idempotent; schreibt nur mit write=true. */
export async function richteBelegeEin({ write = false, sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  const ssot = process.env.GOOGLE_SHEET_ID;
  if (!ssot) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  const log = [];
  const info = await reiter(sheets, ssot, BELEGE_TAB);
  if (info) {
    const alt = await werte(sheets, ssot, BELEGE_TAB);
    belegeSpalten(alt[0]);   // wirft, wenn Spalten fehlen
    log.push(`Reiter "${BELEGE_TAB}" vorhanden (${Math.max(alt.length - 1, 0)} Zeilen), Kopf vollständig - nicht angefasst.`);
    return { write, log };
  }
  log.push(`Reiter "${BELEGE_TAB}" fehlt -> ${write ? 'anlegen' : 'wuerde angelegt'}: ${BELEGE_SPALTEN.join(' | ')}.`);
  if (write) {
    const { data: add } = await sheets.spreadsheets.batchUpdate({ spreadsheetId: ssot, requestBody: { requests: [
      { addSheet: { properties: { title: BELEGE_TAB, gridProperties: { rowCount: 500, columnCount: BELEGE_SPALTEN.length, frozenRowCount: 1 } } } },
    ] } });
    const sheetId = add.replies[0].addSheet.properties.sheetId;
    await sheets.spreadsheets.values.update({ spreadsheetId: ssot, range: `${q(BELEGE_TAB)}!A1`, valueInputOption: 'RAW', requestBody: { values: [BELEGE_SPALTEN] } });
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: ssot, requestBody: { requests: [
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
    ] } });
    const zurueck = await werte(sheets, ssot, BELEGE_TAB);
    const ok = !vergleicheZurueck([BELEGE_SPALTEN], zurueck.slice(0, 1)).length;
    log.push(ok ? '✓ Reiter angelegt, Kopf zurueckgelesen.' : '✗ Zuruecklesen weicht ab.');
    if (!ok) throw fehler(`${BELEGE_TAB}: Zuruecklesen weicht ab.`, 500);
  }
  return { write, log };
}
