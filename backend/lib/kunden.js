// Kundenstamm (AM-1): Reiter `Kunden` im eigenen Sheet "Kunden" (Secret KUNDEN_SHEET_ID), getrennt vom SSOT.
// Logik in utils/kunden.js, Lexware-Abruf (nur lesen) in lib/lexware.js.
//
// Schreiben wie im Korb: eine Sperre je Instanz, Reiter frisch lesen (UNFORMATTED), kein values.append
// (neue Zeilen ueber lib/sheet-zeilen.js, gelesener Stand gilt -> 409), bestehende Zeilen ueber ersetzeZeile
// (Vorher-Pruefung der ganzen Zeile, nur geaenderte Zellen, RAW, zurueckgelesen). Nie loeschen.
// Log und Fehlertexte: nur Kunden_Nr und Zahlen, nie Namen/Adressen/Mail/Telefon.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { schreibeNeueZeilen, ersetzeZeile, pruefeZielStrecke, spalteBuchstabe, zeilenAbweichungen } from './sheet-zeilen.js';
import { leseKundenKontakte, sucheKundenKontakte, leseKontakt } from './lexware.js';
import {
  TAB_KUNDEN, kundenZeilen, alsSheetZeile, neuerKunde, bearbeitenPlan, archivPlan, dsgvoPlan, importPlan,
  zaehleKontakte, kundenAntwort, fehler, KUNDEN_SPALTEN, lexTreffer, uebernahmePlan, kundenZahlen,
} from '../utils/kunden.js';

const CACHE_MS = 30 * 1000;
let cache = null;   // { zeit, antwort }
export function _kundenCacheLeeren() { cache = null; }

let laeuft = null;
async function mitSperre(fn) {
  if (laeuft) throw fehler('Kundenliste wird gerade gespeichert – gleich noch einmal.', 409, 'laeuft_gerade');
  laeuft = true;
  try { return await fn(); } finally { laeuft = null; cache = null; }
}

async function sheetsClient() {
  return google.sheets({ version: 'v4', auth: await getGoogleAuth() });
}

function sheetId() {
  const id = process.env.KUNDEN_SHEET_ID;
  if (!id) throw fehler('KUNDEN_SHEET_ID fehlt – Kunden-Sheet erst einrichten.', 503, 'einrichtung');
  return id;
}

async function leseWerte(sheets, spreadsheetId) {
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_KUNDEN}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    return data.values ?? [];
  } catch (err) {
    if (err?.code === 400 || err?.response?.status === 400) throw fehler(`Reiter "${TAB_KUNDEN}" fehlt – scripts/setup-kunden-reiter.js --write.`, 409, 'einrichtung');
    if (err?.code === 403 || err?.code === 404) throw fehler('Kunden-Sheet nicht erreichbar – Freigabe für das Dienstkonto prüfen.', 503, 'einrichtung');
    throw err;
  }
}

async function lies(sheets, spreadsheetId) {
  const werte = await leseWerte(sheets, spreadsheetId);
  const z = kundenZeilen(werte);
  if (!werte.length || z.fehlt.length) throw fehler(`Reiter "${TAB_KUNDEN}": Spalten fehlen (${z.fehlt.join(', ')}).`, 409, 'einrichtung');
  return { werte, ...z, breite: (werte[0] ?? []).length };
}

/** GET /api/kunden: alle Kunden (nur hinter dem API-Key), 30 s Zwischenspeicher, jede Aenderung leert ihn. */
export async function leseKunden({ sheets: s } = {}) {
  if (cache && cache.zeit > Date.now() - CACHE_MS && !s) return cache.antwort;
  const sheets = s ?? await sheetsClient();
  const { kunden } = await lies(sheets, sheetId());
  const antwort = { kunden: kundenAntwort(kunden), anzahl: kunden.length };
  if (!s) cache = { zeit: Date.now(), antwort };
  return antwort;
}

/** Neuer Kunde in MC (Quelle mc). Kunden-Nr. vergibt der Server. */
export async function legeKundeAn({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { werte, idx, kunden, breite } = await lies(sheets, spreadsheetId);
    const k = neuerKunde({ eingabe, kunden, jetzt: jetzt().toISOString() });
    const start = await schreibeNeueZeilen(sheets, spreadsheetId, TAB_KUNDEN, [alsSheetZeile(idx, k, breite)], { alt: werte });
    return { ok: true, kundenNr: k.Kunden_Nr, zeile: start, kunde: kundenAntwort([k])[0] };
  });
}

// Eine bestehende Zeile ersetzen (Plan aus utils/kunden.js).
async function ersetze(planFn, { eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { werte, idx, kunden, breite } = await lies(sheets, spreadsheetId);
    const plan = planFn({ kunden, eingabe, jetzt: jetzt().toISOString() });
    if (plan.unveraendert) return { ok: true, kundenNr: plan.kunde.Kunden_Nr, unveraendert: true, kunde: kundenAntwort([plan.kunde])[0] };
    const zeile = plan.kunde._zeile;
    await ersetzeZeile(sheets, spreadsheetId, TAB_KUNDEN, zeile, werte[zeile - 1] ?? [], alsSheetZeile(idx, plan.nachher, breite));
    return { ok: true, kundenNr: plan.kunde.Kunden_Nr, kunde: kundenAntwort([plan.nachher])[0] };
  });
}

export const bearbeiteKunde = o => ersetze(bearbeitenPlan, o);
export const archiviereKunde = o => ersetze(archivPlan, o);
export const sperreKundeDsgvo = o => ersetze(dsgvoPlan, o);

/**
 * Import aus Lexware (nur lesen dort). Trockenlauf: nur Zahlen (Kontakte + Plan), schreibt nichts.
 * Schreiben: unter der Sperre frisch gelesen, Plan neu, EIN values.batchUpdate (geaenderte Zellen + neue Zeilen in
 * die gepruefte Zielstrecke), danach der ganze Reiter zurueckgelesen und verglichen.
 * @returns {{ dryRun, seiten, kontakte: object, plan: object, geschrieben?: { neu, geaendert } }}  nur Zahlen
 */
export async function importiereKunden({ dryRun = true, nurFirmen = false, sheets: s, kontakteLesen = leseKundenKontakte, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  const { kontakte, seiten } = await kontakteLesen();
  const zahlen = zaehleKontakte(kontakte);
  if (dryRun) {
    const { kunden } = await lies(sheets, spreadsheetId);
    const { zaehler } = importPlan({ kunden, kontakte, nurFirmen, jetzt: jetzt().toISOString() });
    return { dryRun: true, seiten, kontakte: zahlen, plan: zaehler, kundenVorher: kunden.length };
  }
  return mitSperre(async () => {
    const { werte, idx, kunden, breite } = await lies(sheets, spreadsheetId);
    const { neu, aenderungen, zaehler } = importPlan({ kunden, kontakte, nurFirmen, jetzt: jetzt().toISOString() });
    const q = `'${TAB_KUNDEN}'`;
    const data = [];
    for (const a of aenderungen) {
      for (const [f, w] of Object.entries(a.felder)) {
        if (idx[f] === undefined) continue;
        data.push({ range: `${q}!${spalteBuchstabe(idx[f])}${a.zeile}`, values: [[w]] });
      }
    }
    let ziel = null;
    const neuZeilen = neu.map(k => alsSheetZeile(idx, k, breite));
    if (neuZeilen.length) {
      ziel = await pruefeZielStrecke(sheets, spreadsheetId, TAB_KUNDEN, werte, neuZeilen);
      data.push({ range: ziel.range, values: neuZeilen });
    }
    if (data.length) {
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
      // Zuruecklesen: jede geaenderte Zelle und jede neue Zeile.
      const nachher = await leseWerte(sheets, spreadsheetId);
      let abweichend = 0;
      for (const a of aenderungen) {
        for (const [f, w] of Object.entries(a.felder)) {
          if (idx[f] !== undefined && zeilenAbweichungen([[w]], [[nachher[a.zeile - 1]?.[idx[f]]]]).length) abweichend++;
        }
      }
      if (ziel) abweichend += zeilenAbweichungen(neuZeilen, nachher.slice(ziel.start - 1, ziel.ende)).length;
      if (abweichend) throw fehler(`${TAB_KUNDEN}: Rücklesen weicht in ${abweichend} Zelle(n) ab – bitte prüfen.`, 500, 'ruecklesen');
    }
    return {
      dryRun: false, seiten, kontakte: zahlen, plan: zaehler, kundenVorher: kunden.length,
      geschrieben: { neu: neu.length, geaendert: aenderungen.length, ersteNeueZeile: ziel?.start ?? null },
    };
  });
}

/** GET /api/kunden/zahlen: nur Zahlen (Dashboard-Kachel). */
export async function leseKundenZahlen({ sheets } = {}) {
  const { kunden } = await leseKunden({ sheets });
  return kundenZahlen(kunden);
}

/**
 * AM-1-1: Suche in Lexoffice (nur lesen, nur Kunden, eine Seite). Die Treffer gehen nur in die Antwort - kein
 * Zwischenspeicher, kein Log. "schon in MC" ueber Lexoffice-ID bzw. -Nr. im Kunden-Sheet.
 */
export async function sucheInLexoffice({ feld, q, sheets: s, suche = sucheKundenKontakte } = {}) {
  const { kontakte, mehr } = await suche({ feld, q });
  const sheets = s ?? await sheetsClient();
  const { kunden } = await lies(sheets, sheetId());
  return { treffer: lexTreffer(kontakte, kunden), mehr };
}

/**
 * AM-1-1: genau einen Lexoffice-Kontakt uebernehmen. Kontakt frisch aus Lexware (GET, ausserhalb der Sperre), dann
 * unter der Sperre das Sheet frisch lesen und ueber die ID pruefen (nie doppelt, auch beim Doppelklick: zweiter Aufruf
 * liefert { schon: true }). Neue Zeile ohne append, zurueckgelesen.
 */
export async function uebernehmeAusLexoffice({ lexofficeId, sheets: s, kontaktLesen = leseKontakt, jetzt = () => new Date() } = {}) {
  const kontakt = await kontaktLesen({ id: lexofficeId });
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { werte, idx, kunden, breite } = await lies(sheets, spreadsheetId);
    const plan = uebernahmePlan({ kunden, kontakt, jetzt: jetzt().toISOString() });
    if (plan.schon) return { ok: true, schon: true, kundenNr: plan.schon.Kunden_Nr, kunde: kundenAntwort([plan.schon])[0] };
    const zeile = await schreibeNeueZeilen(sheets, spreadsheetId, TAB_KUNDEN, [alsSheetZeile(idx, plan.neu, breite)], { alt: werte });
    return { ok: true, schon: false, kundenNr: plan.neu.Kunden_Nr, zeile, kunde: kundenAntwort([plan.neu])[0] };
  });
}

export { KUNDEN_SPALTEN };
