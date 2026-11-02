// Lieferbarkeit L-Shop (BO7-1) - Ein-/Ausgabe, Logik in utils/lshop-lieferbarkeit.js.
//
//  - POST /api/intern/lshop-lieferbarkeit/abruf     Cloud Scheduler (Job lshop-lieferbarkeit, stuendlich :47)
//  - POST /api/bestellen/lshop-lieferbarkeit/abruf  Knopf "Lieferbarkeit jetzt" (API-Key, mit Trockenlauf)
//
// Ablauf: Reiter LShop_Lieferbarkeit + genutzte Nummern (Varianten, Warenkorb_LShop, Lager_Buchungen) lesen ->
// Bestandsdatei vom FTP (lib/lshopFtp.js, Konto "bestand", nur lesen) -> neueste Auslaufliste aus Drive (nur lesen)
// -> Plan -> Reiter in EINEM values.update ueber die ganze Strecke (kein append; vorher frisch gelesen und mit dem
// Stand vom Anfang verglichen, danach zurueckgelesen) -> erst DANN Chat (nur offene Korb-Positionen).
// FTP-Fehler: 200 mit ftp "fehler", nichts geschrieben; ist der letzte Stand aelter als STAND_ALT_STUNDEN -> 502
// (Scheduler rot -> Log-Alarm). Auslaufliste nicht lesbar -> Auslauf-Spalten bleiben, Hinweis.

import { google } from 'googleapis';
import ExcelJS from 'exceljs';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { ladeBestandsdatei, LShopFtpFehler } from './lshopFtp.js';
import { _lieferbarkeitCacheLeeren } from './lieferbarkeitLesen.js';
import { richteAuslaufOrdnerEin } from './belegArchiv.js';
import { notify } from './chatNotify.js';
import { leseReiterSpalten } from './ssot-reiter.js';
import { zeilenAbweichungen, spalteBuchstabe } from './sheet-zeilen.js';
import { legeReiterAn, reiter } from './lshopBelege.js';
import {
  LIEFERBARKEIT_TAB, LIEFERBARKEIT_SPALTEN, AUSLAUF_ORDNER, AUSLAUF_DATEI_RE, LISTE_ALT_TAGE, STAND_ALT_STUNDEN,
  FormatFehler, leseBestandCsv, waehleNeuesteListe, leseAuslaufListe, listenAlterTage, genutzteNummern,
  planLieferbarkeit, alsWerte, altAusWerten, letzterStand, buildLieferbarkeitNachricht,
} from '../utils/lshop-lieferbarkeit.js';

export const LIEFERBARKEIT_BESCHAEFTIGT = 'Die Lieferbarkeit wird gerade abgerufen - bitte gleich noch einmal.';
export const MAX_LISTE_BYTES = 10 * 1024 * 1024;
const q = tab => `'${tab}'`;
const t = v => String(v ?? '').trim();

function fehler(msg, status, extra = {}) {
  const e = new Error(msg);
  e.status = status;
  Object.assign(e, extra);
  return e;
}

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}
async function driveClient() {
  return google.drive({ version: 'v3', auth: await getGoogleAuth() });   // drive.readonly: sieht auch von Hand Abgelegtes
}

let laeuft = false;
export function _lieferbarkeitSperreLoesen() { laeuft = false; }

const lies = async (sheets, spreadsheetId, tab) =>
  (await sheets.spreadsheets.values.get({ spreadsheetId, range: q(tab), valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];

// ── Auslaufliste (Drive, nur lesen) ─────────────────────────────────────────

const qText = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function listeDrive(drive, driveId, qZusatz) {
  const { data } = await drive.files.list({
    corpora: 'drive', driveId, includeItemsFromAllDrives: true, supportsAllDrives: true,
    q: `${qZusatz} and trashed = false`, fields: 'files(id,name,size,modifiedTime,mimeType)', pageSize: 100,
  });
  return data.files ?? [];
}

/** Neueste Auslaufliste: zuerst Ordner "L-Shop Auslauf", sonst ablageweit nach dem Namen. -> { datei, quelle } | null */
export async function findeAuslaufListe({ drive, driveId }) {
  const ordner = (await listeDrive(drive, driveId, `name = '${qText(AUSLAUF_ORDNER)}' and mimeType = 'application/vnd.google-apps.folder'`));
  if (ordner.length === 1) {
    const datei = waehleNeuesteListe(await listeDrive(drive, driveId, `'${ordner[0].id}' in parents and name contains 'Auslaufartikel'`));
    if (datei) return { datei, quelle: 'ordner' };
  }
  const datei = waehleNeuesteListe(await listeDrive(drive, driveId, "name contains 'Auslaufartikel - Stand'"));
  return datei ? { datei, quelle: ordner.length > 1 ? 'suche (Ordner mehrfach)' : 'suche' } : null;
}

/** XLSX laden und erstes Blatt lesen (nur im Speicher). */
export async function ladeAuslaufListe({ drive, datei }) {
  if (Number(datei.size) > MAX_LISTE_BYTES) throw new FormatFehler(`${datei.name} ist größer als ${MAX_LISTE_BYTES} Bytes.`);
  const res = await drive.files.get({ fileId: datei.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(res.data));
  const ws = wb.worksheets[0];
  if (!ws) throw new FormatFehler(`${datei.name}: kein Blatt.`);
  const kopf = ws.getRow(1).values.slice(1).map(v => t(v?.text ?? v));
  const zeilen = [];
  ws.eachRow((r, i) => { if (i > 1) zeilen.push(r.values.slice(1)); });
  return leseAuslaufListe({ kopf, zeilen });
}

// ── Lauf ─────────────────────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {boolean} [o.dryRun]   rechnet alles, schreibt nichts, meldet nichts
 * @param {'scheduler'|'knopf'|'skript'} [o.quelle]
 */
export async function runLieferbarkeit({
  dryRun = false, quelle = 'knopf', laufId, sheets: s, drive: d, ftpLade = ladeBestandsdatei, notifyFn = notify,
  driveId = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID, jetzt = () => new Date(),
} = {}) {
  if (typeof dryRun !== 'boolean') throw fehler('dryRun erwartet true oder false.', 400);
  if (laeuft) throw fehler(LIEFERBARKEIT_BESCHAEFTIGT, 409);
  laeuft = true;
  const start = jetzt();
  const lauf = laufId ?? `LB-${start.toISOString().slice(0, 16)}Z`;
  const hinweise = [];
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
    const sheets = s ?? await sheetsClient();

    // 1. Reiter + genutzte Nummern
    const info = await reiter(sheets, spreadsheetId, LIEFERBARKEIT_TAB);
    if (!info && !dryRun) throw fehler(`Reiter ${LIEFERBARKEIT_TAB} fehlt - erst scripts/setup-lshop-lieferbarkeit.js --write.`, 409, { code: 'einrichtung' });
    if (!info) hinweise.push(`Reiter ${LIEFERBARKEIT_TAB} fehlt noch (Trockenlauf rechnet ohne Vorher-Stand).`);
    const altWerte = info ? await lies(sheets, spreadsheetId, LIEFERBARKEIT_TAB) : [];
    const alt = altAusWerten(altWerte);
    const [varianten, korb, buchungen] = await Promise.all([
      leseReiterSpalten({ tab: 'Varianten', sheets, spreadsheetId, spalten: { LShop_ArticleNr: 'LShop_ArticleNr' }, optional: { Aktiv: 'Aktiv' } }),
      leseReiterSpalten({ tab: 'Warenkorb_LShop', sheets, spreadsheetId, spalten: { LShop_ArticleNr: 'LShop_ArticleNr', Status: 'Status' } }).catch(() => []),
      leseReiterSpalten({ tab: 'Lager_Buchungen', sheets, spreadsheetId, spalten: { Schluessel: 'Schluessel' } }).catch(() => []),
    ]);
    const { nummern, korbOffen } = genutzteNummern({ varianten, korb, buchungen });

    // 2. Bestandsdatei
    let datei;
    try {
      datei = await ftpLade();
    } catch (err) {
      if (!(err instanceof LShopFtpFehler)) throw err;
      const letzter = letzterStand(alt);
      const alterH = letzter ? (start.getTime() - Date.parse(letzter)) / 3_600_000 : Infinity;
      if (!dryRun && info && alterH > STAND_ALT_STUNDEN) {
        throw fehler(`Bestandsdatei nicht lesbar (${err.message}); letzter Stand ${letzter || 'nie'} - älter als ${STAND_ALT_STUNDEN} h.`, 502, { code: 'lshop_ftp' });
      }
      return { lauf, dryRun, quelle, ftp: 'fehler', grund: err.message, letzterStand: letzter, hinweise };
    }
    const { bestand, ungueltig } = leseBestandCsv(datei.buf);
    if (ungueltig) hinweise.push(`Bestandsdatei: ${ungueltig} Zeile(n) ohne gültige Nummer/Menge übersprungen.`);

    // 3. Auslaufliste
    let auslauf = null, listeName = '', liste = { name: '', quelle: '', alterTage: null };
    try {
      const drive = d ?? await driveClient();
      if (!driveId) throw new Error('GOOGLE_DRIVE_SHARED_DRIVE_ID fehlt');
      const f = await findeAuslaufListe({ drive, driveId });
      if (!f) hinweise.push(`Keine Auslaufliste gefunden - bitte "Auslaufartikel - Stand …xlsx" in "${AUSLAUF_ORDNER}" ablegen. Auslauf bleibt wie bisher.`);
      else {
        auslauf = await ladeAuslaufListe({ drive, datei: f.datei });
        listeName = f.datei.name;
        liste = { name: listeName, quelle: f.quelle, alterTage: listenAlterTage(listeName, start) };
        if (liste.alterTage > LISTE_ALT_TAGE) hinweise.push(`Auslaufliste vom ${listeName.match(AUSLAUF_DATEI_RE).slice(1, 4).join('.')} ist ${liste.alterTage} Tage alt - bitte neue ablegen.`);
        if (f.quelle !== 'ordner') hinweise.push(`Auslaufliste nicht im Ordner "${AUSLAUF_ORDNER}" gefunden, sondern per Suche.`);
      }
    } catch (err) {
      auslauf = null;
      hinweise.push(`Auslaufliste nicht lesbar (${String(err?.message ?? err).slice(0, 120)}) - Auslauf bleibt wie bisher.`);
    }

    // 4. Plan
    const plan = planLieferbarkeit({ nummern, bestand, auslauf, listeName, alt, standDatei: datei.stand, jetzt: start });
    const nachricht = buildLieferbarkeitNachricht(plan.wechsel, korbOffen);
    const antwort = {
      lauf, dryRun, quelle, ftp: 'ok', stand: datei.stand, bytes: datei.bytes, dateiZeilen: bestand.size, liste,
      summen: plan.summen, wechsel: plan.wechsel.length,
      korbOffen: { positionen: [...korbOffen.values()].reduce((a, n) => a + n, 0), nichtLieferbar: [...korbOffen.keys()].filter(nr => { const z = plan.zeilen.find(x => x.ArticleNr === nr); return z && (z.stock === '' || z.stock === 0); }).length },
      zuMelden: nachricht ? plan.wechsel.filter(w => korbOffen.has(w.nr)).length : 0,
      hinweise,
    };
    if (dryRun) return { ...antwort, geschrieben: 0, chat: 'trockenlauf' };

    // 5. Schreiben: ganze Strecke in EINEM values.update, kein append
    const neu = [LIEFERBARKEIT_SPALTEN, ...alsWerte(plan.zeilen)];
    const hoehe = Math.max(neu.length, altWerte.length);
    const breite = Math.max(LIEFERBARKEIT_SPALTEN.length, ...altWerte.map(r => r.length));
    const ziel = Array.from({ length: hoehe }, (_, i) => Array.from({ length: breite }, (_, j) => neu[i]?.[j] ?? ''));
    const range = `${q(LIEFERBARKEIT_TAB)}!A1:${spalteBuchstabe(breite - 1)}${hoehe}`;
    const frisch = await lies(sheets, spreadsheetId, LIEFERBARKEIT_TAB);
    if (zeilenAbweichungen(altWerte, frisch).length || frisch.length !== altWerte.length) {
      throw fehler(`${LIEFERBARKEIT_TAB} hat sich während des Laufs geändert - nichts geschrieben, nächster Takt.`, 409, { code: 'konflikt' });
    }
    const raster = info.gridProperties?.rowCount ?? 0;
    if (raster < hoehe) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
        { appendDimension: { sheetId: info.sheetId, dimension: 'ROWS', length: hoehe - raster } },
      ] } });
    }
    await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: ziel } });
    const zurueck = (await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
    const ab = zeilenAbweichungen(neu, zurueck);
    if (ab.length || zurueck.length !== neu.length) throw fehler(`${LIEFERBARKEIT_TAB}: Rücklesen weicht ab (${ab.length} Zellen).`, 500);
    _lieferbarkeitCacheLeeren();   // BO7-2: Anzeige liest den neuen Stand sofort

    // 6. Chat erst nach dem Schreiben
    let chat = 'nichts zu melden';
    if (nachricht) chat = (await notifyFn(nachricht)) ? 'gesendet' : 'fehlgeschlagen';
    return { ...antwort, geschrieben: plan.zeilen.length, chat };
  } finally {
    laeuft = false;
  }
}

// ── Einrichtung (scripts/setup-lshop-lieferbarkeit.js) ─────────────────────

/** Reiter anlegen (ArticleNr als Text) und Ordner "L-Shop Auslauf" in Drive. Idempotent; schreibt nur mit write. */
export async function richteLieferbarkeitEin({ write = false, sheets: s, ordnerEinrichten = richteAuslaufOrdnerEin } = {}) {
  const sheets = s ?? await sheetsClient();
  const ssot = process.env.GOOGLE_SHEET_ID;
  if (!ssot) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  const log = [];
  if (await reiter(sheets, ssot, LIEFERBARKEIT_TAB)) {
    altAusWerten(await lies(sheets, ssot, LIEFERBARKEIT_TAB));   // wirft, wenn Spalten fehlen
    log.push(`Reiter "${LIEFERBARKEIT_TAB}" vorhanden, Kopf vollständig - nicht angefasst.`);
  } else {
    log.push(`Reiter "${LIEFERBARKEIT_TAB}" fehlt -> ${write ? 'anlegen' : 'wuerde angelegt'}: ${LIEFERBARKEIT_SPALTEN.join(' | ')}.`);
    if (write) {
      await legeReiterAn({ sheets, spreadsheetId: ssot, tab: LIEFERBARKEIT_TAB, spalten: LIEFERBARKEIT_SPALTEN, textSpalten: [0] });
      log.push('✓ Reiter angelegt (ArticleNr als Text), Kopf zurueckgelesen.');
    }
  }
  log.push(...await ordnerEinrichten({ write }));
  return log;
}
