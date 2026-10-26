// Belege von L-Shop abrufen (BO4b-1, BO4b-2) - Ein-/Ausgabe, Logik in utils/lshop-belege.js, FTP nur
// lesend ueber lib/lshopFtp.js, Archiv in Drive ueber lib/belegArchiv.js.
//
//  - POST /api/intern/lshop-belege/abruf      Cloud Scheduler (Job lshop-belege-abruf, :07 und :37)
//  - POST /api/bestellen/lshop-belege/abruf   Knopf "Belege jetzt abrufen" (API-Key, mit Trockenlauf)
//
// Ablauf: Protokoll (LShop_Belege), LShop_EDI_Dateien, LShop_Sendungen lesen -> EINE FTP-Verbindung:
// Ordner listen, nur neue/geaenderte Belege laden -> je Datei: (Lieferbestaetigung lesen) -> archivieren
// -> bewerten -> Sendungen anhaengen -> EDI-Status "versandt" -> Protokollzeilen -> erst DANN Chat.
// Jeder Schritt ist wiederholbar (Drive: Name + MD5, Sendungen: Paketnummer, EDI: nur aus gesendet/
// bestaetigt), damit ein Abbruch nach einem Schritt im naechsten Takt nichts doppelt anlegt.
// Dateien auf dem FTP bleiben liegen. Erstbestand still: noch keine Zeile "Lieferbestaetigung" oder
// Datei mit Namensdatum bis ERSTBESTAND_BIS. Hoechstens MAX_NEUE_BELEGE_JE_LAUF neue Belege je Lauf.
// FTP- und Archiv-Fehler sind kein 5xx: Zeile "Lauf/fehler", Chat erst ab 3 Fehllaeufen in Folge
// (hoechstens 1/h, Zustand im Reiter, weil Cloud-Run-Instanzen zwischen den Takten wegfallen).
// Eine Datei, deren Archivierung scheitert, gilt als nicht verarbeitet (keine Zeile, naechster Takt).
// Andere Fehler (Sheets) bleiben 5xx -> Scheduler-Versuch rot -> Log-Alarm.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { mitLShopFtp, LShopFtpFehler } from './lshopFtp.js';
import { archiviere, richteArchivEin, ArchivFehler, ArchivKonflikt } from './belegArchiv.js';
import { notify } from './chatNotify.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { normHeader } from '../utils/sheet-headers.js';
import { ersteFreieZeile, bereichLeer, vergleicheZurueck } from '../utils/korb-logic.js';
import { EDI_TAB, HAENGT_MIN } from '../utils/edi-bestellung.js';
import {
  BELEGE_TAB, BELEGE_SPALTEN, ORDNER, ART, ERGEBNIS, belegeSpalten, belegeZeilen, protokollNachDatei, dekodiere, sha256,
  ediStatusMap, ftpZeit, bewerteOrderDatei, bewerteAb, eintragGeaendert, fehlerSerie, fehllaufMelden, belegZeile,
  buildBelegeAlarmNachricht, buildAbErkanntNachricht, buildFtpFehlerNachricht,
  SENDUNGEN_TAB, SENDUNGEN_SPALTEN, ARCHIV_ART, BELEG_ART, MAX_PDF_BYTES, EDI_VERSANDT, EDI_VOR_VERSAND,
  BelegFormatFehler, leseLieferbestaetigung, bewertePaket, archivJahr, mimeFuer, istErstbestand, istErstbestandsDatei, MAX_NEUE_BELEGE_JE_LAUF,
  sendungenSpalten, sendungenZeilen, gleicheSendung, sendungZeile, buildVersandtNachricht,
  abgeholtPlan, haengendPlan, buildZuLangeNachricht, buildHaengtNachricht, MERKER_ZU_LANGE,
} from '../utils/lshop-belege.js';

export const LAUF_ZEITLIMIT_MS = 240_000;   // Scheduler-Versuchsfrist 300 s
const q = tab => `'${tab}'`;
const t = v => String(v ?? '').trim();
// Ordner mit Belegen, die geladen, archiviert und protokolliert werden (ORDER nur Liste).
const BELEG_ORDNER = [ORDNER.AB, ORDNER.LB, ORDNER.RE_XML, ORDNER.RE_PDF];

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
async function haengeAn({ sheets, spreadsheetId, tab, info, alt, zeilen }) {
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
    spreadsheetId, range: `${q(tab)}!A${start - 1}:${ende}${letzte + 1}`, valueRenderOption: 'FORMATTED_VALUE',
  });
  const umgebung = um.values ?? [];
  if (vergleicheZurueck([(alt[start - 2] ?? []).slice(0, breite)], [umgebung[0] ?? []]).length) {
    throw fehler(`${tab}: Zeile ${start - 1} hat sich seit dem Lesen geaendert - nichts geschrieben.`, 409);
  }
  if (!bereichLeer(umgebung.slice(1))) throw fehler(`${tab}: Zielzeilen ab ${start} sind nicht leer - nichts geschrieben.`, 409);
  const range = `${q(tab)}!A${start}:${ende}${letzte}`;
  await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: zeilen } });
  const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'FORMATTED_VALUE' });
  if (vergleicheZurueck(zeilen, zurueck.values ?? []).length) throw fehler(`${tab}: Rücklesen ab Zeile ${start} weicht ab.`, 500);
  return { von: start, bis: letzte };
}

/**
 * LShop_EDI_Dateien: Status der order_ids auf "versandt", nur aus gesendet/bestaetigt. Zellen vorher frisch
 * lesen (order_id + alter Status gleich), sonst diese Zeile auslassen. Nur die Status-Zelle wird geschrieben.
 */
async function setzeEdiVersandt({ sheets, spreadsheetId, orderIds }) {
  if (!orderIds.length) return [];
  const w = await werte(sheets, spreadsheetId, EDI_TAB);
  const norm = (w[0] ?? []).map(normHeader);
  const iId = norm.indexOf(normHeader('order_id')), iSt = norm.indexOf(normHeader('Status'));
  const data = [];
  const gesetzt = [];
  w.slice(1).forEach((r, i) => {
    const id = t(r[iId]);
    if (orderIds.includes(id) && EDI_VOR_VERSAND.includes(t(r[iSt]))) {
      data.push({ range: `${q(EDI_TAB)}!${colLetter(iSt)}${i + 2}`, values: [[EDI_VERSANDT]] });
      gesetzt.push(id);
    }
  });
  if (!data.length) return [];
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  return gesetzt;
}

/**
 * BO4c: einzelne Zellen (Plan aus abgeholtPlan/haengendPlan bzw. Belege-Hinweise) schreiben: Reiter frisch
 * lesen, je Zelle Kennung (order_id bzw. Datei) und alten Wert pruefen, sonst auslassen; EIN batchUpdate RAW,
 * zuruecklesen. -> Anzahl geschrieben.
 */
async function setzeZellenSicher({ sheets, spreadsheetId, tab, kennSpalte, plan }) {
  if (!plan.length) return 0;
  const w = await werte(sheets, spreadsheetId, tab);
  const norm = (w[0] ?? []).map(normHeader);
  const sp = n => norm.indexOf(normHeader(n));
  const ok = plan.filter(p => sp(p.spalte) >= 0 && t(w[p.zeile - 1]?.[sp(kennSpalte)]) === p.kennung && t(w[p.zeile - 1]?.[sp(p.spalte)]) === p.alt);
  if (!ok.length) return 0;
  const data = ok.map(p => ({ range: `${q(tab)}!${colLetter(sp(p.spalte))}${p.zeile}`, values: [[p.neu]] }));
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  const { data: z } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: data.map(d => d.range), valueRenderOption: 'FORMATTED_VALUE' });
  const abweichend = ok.filter((p, n) => t(z.valueRanges?.[n]?.values?.[0]?.[0]) !== p.neu);
  if (abweichend.length) throw fehler(`${tab}: Rücklesen weicht ab (${abweichend.map(p => p.kennung).join(', ')}).`, 500);
  return ok.length;
}

/** FTP-Teil: eine Verbindung, Listen + Laden der neuen/geaenderten Belege. */
async function holeVomFtp(ftp, protokoll, deadline) {
  const listen = {};
  for (const o of [ORDNER.ORDER, ...BELEG_ORDNER]) {
    listen[o] = (await ftp.liste(o)).filter(e => e.istDatei);
  }
  const geladen = new Map();   // "ORDNER/Datei" -> Buffer
  let offen = 0;
  for (const o of BELEG_ORDNER) {
    for (const e of listen[o]) {
      const p = protokoll.get(`${o}/${e.name}`);
      if (p && !eintragGeaendert(e, p)) continue;
      if (Date.now() > deadline || geladen.size >= MAX_NEUE_BELEGE_JE_LAUF) { offen++; continue; }
      geladen.set(`${o}/${e.name}`, await ftp.lade(o, e.name, o === ORDNER.RE_PDF ? { maxBytes: MAX_PDF_BYTES } : undefined));
    }
  }
  return { listen, geladen, offen };
}

/**
 * Ein Abruf. Rueckgabe = Zusammenfassung ohne Zugangsdaten, ohne Inhalte, ohne Adressen.
 * @param {{ dryRun?: boolean, quelle?: string, laufId?: string, sheets?: any, ftp?: Function, archiv?: Function, melde?: Function, jetzt?: () => Date }} o
 */
export async function runBelegeAbruf({
  dryRun = false, quelle = 'knopf', laufId, sheets: s, ftp = mitLShopFtp, archiv = archiviere, melde = notify, jetzt = () => new Date(),
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
    const sInfo = await reiter(sheets, spreadsheetId, SENDUNGEN_TAB);
    if (!sInfo) throw fehler(`Reiter "${SENDUNGEN_TAB}" fehlt - erst anlegen (scripts/setup-lshop-belege-reiter.js).`, 409);
    if (!await reiter(sheets, spreadsheetId, EDI_TAB)) throw fehler(`Reiter "${EDI_TAB}" fehlt.`, 409);
    const alt = await werte(sheets, spreadsheetId, BELEGE_TAB);
    const idx = belegeSpalten(alt[0]);
    const zeilen = belegeZeilen(alt);
    const protokoll = protokollNachDatei(zeilen);
    const ediWerte = await werte(sheets, spreadsheetId, EDI_TAB);
    const ediStatus = ediStatusMap(ediWerte);
    const sAlt = await werte(sheets, spreadsheetId, SENDUNGEN_TAB);
    const sIdx = sendungenSpalten(sAlt[0]);
    const sendungen = new Map(sendungenZeilen(sAlt).map(z => [z.Paketnummer, z]));
    const serie = fehlerSerie(zeilen);
    const erstbestand = istErstbestand(zeilen);
    const zeile = felder => belegZeile(idx, { Gelesen: nun.toISOString(), Lauf: lauf, ...felder });

    // ── Fehllauf (FTP oder Archiv): Zeile "Lauf", Chat ab 3 in Folge ──
    const fehllauf = async grund => {
      const melden = !dryRun && fehllaufMelden(serie, nun);
      const z = zeile({ Art: ART.LAUF, Ergebnis: melden ? ERGEBNIS.FEHLER_GEMELDET : ERGEBNIS.FEHLER, Hinweis: grund });
      const inFolge = serie.inFolge + 1;
      return { z, melden, inFolge, nachricht: buildFtpFehlerNachricht({ inFolge, grund }) };
    };

    // ── FTP ──
    let ftpDaten;
    try {
      ftpDaten = await ftp(f => holeVomFtp(f, protokoll, Date.now() + LAUF_ZEITLIMIT_MS));
    } catch (err) {
      if (!(err instanceof LShopFtpFehler)) throw err;
      const f = await fehllauf(err.message);
      if (!dryRun) await haengeAn({ sheets, spreadsheetId, tab: BELEGE_TAB, info, alt, zeilen: [f.z] });
      let gemeldet = false;
      if (f.melden) gemeldet = await melde(f.nachricht);
      return { lauf, dryRun, ftp: 'fehler', grund: err.message, inFolge: f.inFolge, gemeldet };
    }

    // ── Bewerten ──
    const neu = [];                // Protokollzeilen
    const neueSendungen = [];      // Zeilen LShop_Sendungen
    const alarme = [];             // { ordner, datei, hinweis, lb? }
    const abErkannt = [];
    const orderZuLange = [];
    const zuLangeMelden = [];      // BO4c: einmal je Datei (Merker im Hinweis der Protokollzeile)
    const belegHinweise = [];      // Plan fuer setzeZellenSicher (vorhandene Protokollzeilen)
    const versandt = [];           // { orderId, datei, pakete[] } fuer den Chat
    const archivFehler = [];
    const archivZaehler = { neu: 0, vorhanden: 0, wuerdeAngelegt: 0, konflikt: 0 };
    const { listen, geladen, offen } = ftpDaten;

    for (const e of listen[ORDNER.ORDER]) {
      const b = bewerteOrderDatei(e, ediStatus, nun);
      const p = protokoll.get(`${ORDNER.ORDER}/${e.name}`);
      if (b.zuLange) {
        orderZuLange.push({ datei: e.name, hinweis: b.hinweis });
        if (!String(p?.Hinweis ?? '').includes(MERKER_ZU_LANGE)) {
          zuLangeMelden.push({ datei: e.name, hinweis: b.hinweis });
          if (p) belegHinweise.push({ zeile: p.zeile, kennung: e.name, spalte: 'Hinweis', alt: p.Hinweis, neu: [p.Hinweis, MERKER_ZU_LANGE].filter(Boolean).join(' · ') });
        }
      }
      if (p) continue;
      neu.push(zeile({
        Ordner: ORDNER.ORDER, Datei: e.name, Groesse: e.size, Geaendert_FTP: ftpZeit(e), Art: ART.ORDER,
        order_id: b.orderId, Ergebnis: b.ergebnis,
        Hinweis: [b.hinweis, b.zuLange ? MERKER_ZU_LANGE : ''].filter(Boolean).join(' · '),
      }));
      if (b.ergebnis === ERGEBNIS.ALARM) alarme.push({ ordner: ORDNER.ORDER, datei: e.name, hinweis: b.hinweis });
    }

    for (const o of BELEG_ORDNER) {
      for (const e of listen[o]) {
        const buf = geladen.get(`${o}/${e.name}`);
        if (!buf) continue;
        const hash = sha256(buf);
        // Erstbestand still: noch keine Zeile Lieferbestaetigung oder Datei aus dem Bestand bis zum Stichtag.
        const still = o === ORDNER.LB && (erstbestand || istErstbestandsDatei(e.name));
        const basis = { Ordner: o, Datei: e.name, Groesse: e.size, Hash: hash, Geaendert_FTP: ftpZeit(e), Art: BELEG_ART[o] };
        const p = protokoll.get(`${o}/${e.name}`);
        if (p) {
          if (p.Hash === hash) {
            neu.push(zeile({ ...basis, order_id: p.order_id, VA: p.VA, LA: p.LA, Ergebnis: p.Ergebnis, Drive_ID: p.Drive_ID, Hinweis: 'Zeitstempel/Größe neu, Inhalt gleich' }));
          } else {
            const hinweis = 'Datei verändert (gleicher Name, anderer Inhalt) - nicht neu verarbeitet';
            neu.push(zeile({ ...basis, order_id: p.order_id, Ergebnis: ERGEBNIS.VERAENDERT, Hinweis: hinweis }));
            alarme.push({ ordner: o, datei: e.name, hinweis, still });
          }
          continue;
        }

        // Lieferbestaetigung zuerst lesen: ein Formatfehler ist ein Alarm, die Datei wird trotzdem archiviert.
        let pakete = null, formatFehler = '';
        if (o === ORDNER.LB) {
          try { pakete = leseLieferbestaetigung(buf); } catch (err) {
            if (!(err instanceof BelegFormatFehler)) throw err;
            formatFehler = `unlesbar: ${err.message}`;
          }
        }

        // Archiv: Fehler -> Datei nicht verarbeitet; Konflikt -> Alarm, Datei verarbeitet (ohne Drive_ID).
        let driveId = '', archivHinweis = '';
        try {
          const a = await archiv({ art: ARCHIV_ART[o], jahr: archivJahr(e.name, e, nun), name: e.name, buf, mime: mimeFuer(e.name), dryRun });
          driveId = a.id ?? '';
          if (a.status === 'neu') archivZaehler.neu++;
          else if (a.status === 'vorhanden') archivZaehler.vorhanden++;
          else archivZaehler.wuerdeAngelegt++;
        } catch (err) {
          if (err instanceof ArchivFehler) { archivFehler.push(`${o}/${e.name}: ${err.message}`); continue; }
          if (!(err instanceof ArchivKonflikt)) throw err;
          archivZaehler.konflikt++;
          archivHinweis = `Archiv: ${err.message}`;
          alarme.push({ ordner: o, datei: e.name, hinweis: archivHinweis, still });
        }

        if (o === ORDNER.AB) {
          const b = bewerteAb(dekodiere(buf), ediStatus);
          neu.push(zeile({ ...basis, order_id: b.orderIds.join(' '), Ergebnis: b.ergebnis, Hinweis: [b.hinweis, archivHinweis].filter(Boolean).join('; '), Drive_ID: driveId }));
          if (b.ergebnis === ERGEBNIS.ALARM) alarme.push({ ordner: o, datei: e.name, hinweis: b.hinweis });
          else abErkannt.push({ datei: e.name, orderIds: b.orderIds });
          continue;
        }
        if (o !== ORDNER.LB) {   // Rechnung XML/PDF: nur Archiv, keine Auswertung, kein zweiter Weg nach Lexware
          neu.push(zeile({ ...basis, Ergebnis: archivHinweis ? ERGEBNIS.ALARM : ERGEBNIS.ARCHIVIERT, Hinweis: archivHinweis, Drive_ID: driveId }));
          continue;
        }
        if (formatFehler) {
          neu.push(zeile({ ...basis, Ergebnis: ERGEBNIS.ALARM, Hinweis: [formatFehler, archivHinweis].filter(Boolean).join('; '), Drive_ID: driveId }));
          alarme.push({ ordner: o, datei: e.name, hinweis: formatFehler, still });
          continue;
        }

        // Lieferbestaetigung: je Paket zuordnen und als Sendung speichern (wiederholbar ueber die Paketnummer).
        const hinweise = [];
        const eigene = new Map();   // orderId -> Pakete dieser Datei
        let portal = 0, alarmPakete = 0;
        for (const pk of pakete) {
          const b = bewertePaket(pk, ediStatus);
          if (b.art === ERGEBNIS.PORTAL) portal++;
          if (b.art === ERGEBNIS.ALARM) { alarmPakete++; hinweise.push(b.hinweis); alarme.push({ ordner: o, datei: e.name, hinweis: `Paket ${pk.paketnummer}: ${b.hinweis}`, still }); }
          if (b.art === ERGEBNIS.EIGEN) (eigene.get(b.orderId) ?? eigene.set(b.orderId, []).get(b.orderId)).push(pk);
          const sz = {
            Paketnummer: pk.paketnummer, VA: pk.va, LA: pk.la, order_id: b.orderId, Frachtfuehrer: pk.frachtfuehrer,
            Gewicht: pk.gewicht, Tracking_URL: pk.url, Datei: e.name, Gelesen: nun.toISOString(), Wareneingang: '',
            Notiz: [b.hinweis, ...pk.hinweise].filter(Boolean).join('; '),
          };
          const da = sendungen.get(pk.paketnummer);
          if (da) {
            if (!gleicheSendung(da, sz)) {
              const h = `Paket ${pk.paketnummer} schon gespeichert mit anderem Inhalt - nicht überschrieben`;
              hinweise.push(h);
              alarme.push({ ordner: o, datei: e.name, hinweis: h, still });
            }
            continue;
          }
          sendungen.set(pk.paketnummer, sz);
          neueSendungen.push(sendungZeile(sIdx, sz));
        }
        for (const [orderId, pk] of eigene) versandt.push({ orderId, datei: e.name, pakete: pk, still });
        const ergebnis = alarmPakete || archivHinweis ? ERGEBNIS.ALARM : eigene.size ? ERGEBNIS.ERKANNT : ERGEBNIS.PORTAL;
        neu.push(zeile({
          ...basis, order_id: [...eigene.keys()].join(' '),
          VA: [...new Set(pakete.map(pk => pk.va))].join(' '), LA: [...new Set(pakete.map(pk => pk.la))].join(' '),
          Ergebnis: ergebnis, Drive_ID: driveId,
          Hinweis: [`${pakete.length} Paket${pakete.length !== 1 ? 'e' : ''}, ${portal} Portal`, ...new Set(hinweise), archivHinweis].filter(Boolean).join('; '),
        }));
      }
    }

    // Archiv-Fehler zaehlen wie FTP-Fehler (eine Serie); sonst nach Fehlern "ok".
    let fehlerLauf = null;
    if (archivFehler.length) {
      fehlerLauf = await fehllauf(`Archiv: ${archivFehler.length} Datei(en) nicht archiviert, nächster Takt versucht es erneut (${archivFehler[0]})`);
      neu.push(fehlerLauf.z);
    } else if (serie.inFolge > 0) {
      neu.push(zeile({ Art: ART.LAUF, Ergebnis: ERGEBNIS.OK_NACH_FEHLERN, Hinweis: `nach ${serie.inFolge} Fehllauf/-läufen` }));
    }

    // BO4c: Abgeholt (von MC gesendete Datei nicht mehr in ORDER) und haengendes "wird gesendet".
    const abgeholt = abgeholtPlan({ ediWerte, orderListe: listen[ORDNER.ORDER], jetzt: nun });
    const haengend = haengendPlan({ ediWerte, jetzt: nun, haengtMin: HAENGT_MIN });

    // ── Schreiben (Sendungen -> EDI-Status -> Protokoll), erst danach melden ──
    let geschrieben = null;
    let ediVersandt = [];
    const gemeldet = { alarm: false, ab: false, versandt: 0, fehler: false, zuLange: false, haengt: false };
    // Erstbestand: Lieferbestaetigungen still (Alarme und Infos dazu); ORDER und AB melden wie immer.
    const zuMelden = alarme.filter(a => !a.still);
    if (!dryRun) {
      const sGeschrieben = await haengeAn({ sheets, spreadsheetId, tab: SENDUNGEN_TAB, info: sInfo, alt: sAlt, zeilen: neueSendungen });
      ediVersandt = await setzeEdiVersandt({ sheets, spreadsheetId, orderIds: [...new Set(versandt.map(v => v.orderId))] });
      geschrieben = { belege: await haengeAn({ sheets, spreadsheetId, tab: BELEGE_TAB, info, alt, zeilen: neu }), sendungen: sGeschrieben };
      geschrieben.edi = await setzeZellenSicher({ sheets, spreadsheetId, tab: EDI_TAB, kennSpalte: 'order_id',
        plan: [...abgeholt, ...haengend].map(x => ({ ...x, kennung: x.orderId })) });
      geschrieben.belegHinweise = await setzeZellenSicher({ sheets, spreadsheetId, tab: BELEGE_TAB, kennSpalte: 'Datei', plan: belegHinweise });
      if (zuLangeMelden.length) gemeldet.zuLange = await melde(buildZuLangeNachricht(zuLangeMelden));
      if (haengend.length) gemeldet.haengt = await melde(buildHaengtNachricht(haengend));
      if (zuMelden.length) gemeldet.alarm = await melde(buildBelegeAlarmNachricht(zuMelden));
      if (abErkannt.length) gemeldet.ab = await melde(buildAbErkanntNachricht(abErkannt));
      for (const v of versandt) if (!v.still && await melde(buildVersandtNachricht(v))) gemeldet.versandt++;
      if (fehlerLauf?.melden) gemeldet.fehler = await melde(fehlerLauf.nachricht);
    }

    const anzahl = o => listen[o].length;
    return {
      lauf, dryRun, ftp: 'ok', erstbestand,
      ordner: Object.fromEntries([ORDNER.ORDER, ...BELEG_ORDNER].map(o => [o, anzahl(o)])),
      neueZeilen: neu.length, sendungenNeu: neueSendungen.length,
      archiv: { ...archivZaehler, fehler: archivFehler.length },
      alarme: alarme.map(({ still, ...a }) => a), abErkannt, orderZuLange, offen,
      abgeholt: abgeholt.map(a => a.orderId), haengend: haengend.map(h => h.orderId),
      versandt: versandt.map(v => ({ orderId: v.orderId, datei: v.datei, pakete: v.pakete.length })), ediVersandt,
      geschrieben, gemeldet,
    };
  } finally {
    laeuft = false;
  }
}

// ── Einrichtung (scripts/setup-lshop-belege-reiter.js) ──────────────────────

async function legeReiterAn({ sheets, spreadsheetId, tab, spalten, textSpalten = [] }) {
  const { data: add } = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    { addSheet: { properties: { title: tab, gridProperties: { rowCount: 500, columnCount: spalten.length, frozenRowCount: 1 } } } },
  ] } });
  const sheetId = add.replies[0].addSheet.properties.sheetId;
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `${q(tab)}!A1`, valueInputOption: 'RAW', requestBody: { values: [spalten] } });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
    // Zahlen-artige Texte (20-stellige Paketnummer, Gewicht mit Punkt) bleiben auch bei Handeingabe Text.
    ...textSpalten.map(i => ({ repeatCell: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat',
    } })),
  ] } });
  const zurueck = await werte(sheets, spreadsheetId, tab);
  if (vergleicheZurueck([spalten], zurueck.slice(0, 1)).length) throw fehler(`${tab}: Zuruecklesen weicht ab.`, 500);
}

/**
 * Reiter LShop_Belege (mit Drive_ID hinten) und LShop_Sendungen anlegen bzw. ergaenzen, Archiv-Ordner in
 * Drive anlegen. Idempotent; schreibt nur mit write=true. Vorhandene Zeilen werden nie angefasst.
 */
export async function richteBelegeEin({ write = false, sheets: s, archivEinrichten = richteArchivEin } = {}) {
  const sheets = s ?? await sheetsClient();
  const ssot = process.env.GOOGLE_SHEET_ID;
  if (!ssot) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  const log = [];

  // 1. LShop_Belege
  const bInfo = await reiter(sheets, ssot, BELEGE_TAB);
  if (bInfo) {
    const kopf = (await werte(sheets, ssot, BELEGE_TAB))[0] ?? [];
    const norm = kopf.map(normHeader);
    const fehlen = BELEGE_SPALTEN.filter(n => !norm.includes(normHeader(n)));
    if (!fehlen.length) log.push(`Reiter "${BELEGE_TAB}" vorhanden, Kopf vollständig - nicht angefasst.`);
    else if (fehlen.some(n => n !== 'Drive_ID')) throw fehler(`${BELEGE_TAB}: Spalte(n) fehlen: ${fehlen.join(', ')} - bitte von Hand prüfen.`, 422);
    else {
      const ziel = `${q(BELEGE_TAB)}!${colLetter(kopf.length)}1`;
      log.push(`Reiter "${BELEGE_TAB}": Spalte Drive_ID fehlt -> ${write ? 'anhaengen' : 'wuerde angehaengt'} (${colLetter(kopf.length)}1).`);
      if (write) {
        // Der Reiter wurde mit genau so vielen Spalten angelegt wie der Kopf hatte: Raster erst verbreitern.
        const breite = bInfo.gridProperties?.columnCount ?? Infinity;
        if (breite < kopf.length + 1) {
          await sheets.spreadsheets.batchUpdate({ spreadsheetId: ssot, requestBody: { requests: [
            { appendDimension: { sheetId: bInfo.sheetId, dimension: 'COLUMNS', length: kopf.length + 1 - breite } },
          ] } });
        }
        await sheets.spreadsheets.values.update({ spreadsheetId: ssot, range: ziel, valueInputOption: 'RAW', requestBody: { values: [['Drive_ID']] } });
        const k2 = (await werte(sheets, ssot, BELEGE_TAB))[0] ?? [];
        if (k2[kopf.length] !== 'Drive_ID') throw fehler(`${BELEGE_TAB}: Drive_ID beim Zuruecklesen nicht gefunden.`, 500);
        log.push('✓ Drive_ID angehaengt und zurueckgelesen.');
      }
    }
  } else {
    log.push(`Reiter "${BELEGE_TAB}" fehlt -> ${write ? 'anlegen' : 'wuerde angelegt'}: ${BELEGE_SPALTEN.join(' | ')}.`);
    if (write) { await legeReiterAn({ sheets, spreadsheetId: ssot, tab: BELEGE_TAB, spalten: BELEGE_SPALTEN }); log.push('✓ Reiter angelegt, Kopf zurueckgelesen.'); }
  }

  // 2. LShop_Sendungen
  if (await reiter(sheets, ssot, SENDUNGEN_TAB)) {
    sendungenSpalten((await werte(sheets, ssot, SENDUNGEN_TAB))[0]);
    log.push(`Reiter "${SENDUNGEN_TAB}" vorhanden, Kopf vollständig - nicht angefasst.`);
  } else {
    log.push(`Reiter "${SENDUNGEN_TAB}" fehlt -> ${write ? 'anlegen' : 'wuerde angelegt'}: ${SENDUNGEN_SPALTEN.join(' | ')}.`);
    if (write) {
      const text = ['Paketnummer', 'VA', 'LA', 'Gewicht'].map(n => SENDUNGEN_SPALTEN.indexOf(n));
      await legeReiterAn({ sheets, spreadsheetId: ssot, tab: SENDUNGEN_TAB, spalten: SENDUNGEN_SPALTEN, textSpalten: text });
      log.push('✓ Reiter angelegt (Paketnummer/VA/LA/Gewicht als Text), Kopf zurueckgelesen.');
    }
  }

  // 3. Archiv-Ordner in Drive
  log.push(...await archivEinrichten({ write }));
  return { write, log };
}
