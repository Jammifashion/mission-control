// Kundenanfragen (KA1): Lesen und Schreiben des Reiters `Kundenanfragen` im Business-Sheet. Logik utils/anfragen.js.
// Schreiben: eine Sperre je Instanz, frisch gelesen, kein values.append (lib/sheet-zeilen.js), RAW, zurueckgelesen.
// Kundendaten nie ins Log oder in Fehlertexte - nur KA-/AU-Nummern.
import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { frischLesen } from './sheetsZentral.js';
import { schreibeNeueZeilen, ersetzeZeile } from './sheet-zeilen.js';
import {
  TAB, SPALTE_AUFTRAG, KA_NR, anfragenAus, fehlendeSpalten, naechsteAnfrageId, neueAnfrage, alsZeile,
  bearbeitenPlan, verknuepfenPlan, fehler,
} from '../utils/anfragen.js';
import { deHeuteBerlin, berlinJahr } from '../utils/berlin-tag.js';

async function sheetsClient() { return google.sheets({ version: 'v4', auth: await getGoogleAuth() }); }
function sheetId() {
  const id = process.env.BUSINESS_SHEET_ID;
  if (!id) throw fehler('BUSINESS_SHEET_ID nicht konfiguriert.', 503);
  return id;
}

let kette = Promise.resolve();
/** Eine Sperre je Instanz fuer alle Schreiber (Nummer und Zielzeile nie doppelt). */
export function mitAnfragenSperre(fn) {
  const lauf = kette.then(() => frischLesen(fn), () => frischLesen(fn));
  kette = lauf.then(() => {}, () => {});
  return lauf;
}

async function lies(sheets, spreadsheetId) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const werte = data.values ?? [];
  const r = anfragenAus(werte);
  const fehlt = fehlendeSpalten(r.idx);
  if (fehlt.length) throw fehler(`Reiter ${TAB}: Spalte ${fehlt.join(', ')} fehlt.`, 500, 'einrichtung');
  return { werte, ...r };
}

/** GET /api/anfragen: alle Anfragen + ob die Spalte Auftrag_Nr da ist. */
export async function leseAnfragen({ sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  const { anfragen, idx } = await lies(sheets, sheetId());
  return { anfragen, spalten: { auftragNr: idx[SPALTE_AUFTRAG] !== undefined } };
}

/** Neue Anfrage (Kundenchat oder MC "von Hand"), ohne append. @returns {Promise<{ anfrageId, anfrage }>} */
export async function legeAnfrageAn({ eingabe, kanalErsatz, locker = false, sheets: s, jetzt = () => new Date() } = {}) {
  return mitAnfragenSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { werte, idx, breite, anfragen } = await lies(sheets, spreadsheetId);
    const anfrageId = naechsteAnfrageId(anfragen.map(a => a.anfrageId), berlinJahr(jetzt()));
    const obj = neueAnfrage({ eingabe, anfrageId, datum: deHeuteBerlin(jetzt()), kanalErsatz, locker });
    await schreibeNeueZeilen(sheets, spreadsheetId, TAB, [alsZeile(idx, obj, Math.max(breite, 1))], { alt: werte });
    return { anfrageId, anfrage: obj };
  });
}

async function aendere(sheets, spreadsheetId, gelesen, anfrage, aenderung) {
  if (!Object.keys(aenderung).length) return false;
  const alt = gelesen.werte[anfrage.zeile - 1] ?? [];
  const altVoll = Array.from({ length: gelesen.breite }, (_, i) => alt[i] ?? '');
  const neu = [...altVoll];
  for (const [s, w] of Object.entries(aenderung)) neu[gelesen.idx[s]] = w;
  await ersetzeZeile(sheets, spreadsheetId, TAB, anfrage.zeile, altVoll, neu);
  return true;
}

function finde(gelesen, anfrageId) {
  if (!KA_NR.test(String(anfrageId ?? ''))) throw fehler('Anfrage-Nummer ungültig.');
  const treffer = gelesen.anfragen.filter(a => a.anfrageId === anfrageId);
  if (!treffer.length) throw fehler('Anfrage nicht gefunden.', 404);
  if (treffer.length > 1) throw fehler(`${anfrageId} steht mehrfach im Reiter – bitte im Sheet klären.`, 409, 'mehrfach');
  return treffer[0];
}

/**
 * POST /api/anfragen/bearbeiten { anfrageId, stand, felder }: nur geaenderte Zellen, Stand wie gesehen (sonst 409).
 * @returns {Promise<{ anfrage, unveraendert }>}
 */
export async function bearbeiteAnfrage({ eingabe, sheets: s } = {}) {
  return mitAnfragenSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const g = await lies(sheets, spreadsheetId);
    const a = finde(g, eingabe?.anfrageId);
    if (String(eingabe?.stand ?? '') !== a.stand) throw fehler(`${a.anfrageId} wurde inzwischen geändert – bitte neu laden.`, 409, 'konflikt');
    const { aenderung } = bearbeitenPlan({ anfrage: a, felder: eingabe?.felder });
    const geaendert = await aendere(sheets, spreadsheetId, g, a, aenderung);
    const neu = geaendert ? finde(await lies(sheets, spreadsheetId), a.anfrageId) : a;
    return { anfrage: neu, unveraendert: !geaendert };
  });
}

/**
 * Anfrage mit Auftrag verknuepfen (nach "Als Auftrag übernehmen"): Auftrag_Nr + Status "Bestätigt".
 * Fehlt die Spalte Auftrag_Nr -> 409 einrichtung.
 */
export async function verknuepfeAuftrag({ anfrageId, auftragNr, sheets: s } = {}) {
  return mitAnfragenSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const g = await lies(sheets, spreadsheetId);
    if (g.idx[SPALTE_AUFTRAG] === undefined)
      throw fehler(`Spalte ${SPALTE_AUFTRAG} fehlt in ${TAB} (Setup: scripts/setup-kundenanfragen-ka1.js --write).`, 409, 'einrichtung');
    const a = finde(g, anfrageId);
    const { aenderung } = verknuepfenPlan({ anfrage: a, auftragNr });
    await aendere(sheets, spreadsheetId, g, a, aenderung);
    return { anfrageId: a.anfrageId, auftragNr };
  });
}

/**
 * Vor dem Anlegen eines Auftrags: gibt es die Anfrage? (nur lesen). Doppelt uebernommen sperrt der Auftrag selbst
 * (Anfrage_ID in Auftraege, 409 anfrage_schon) - so bleibt der Doppelklick-Schutz ueber `vorgang` erhalten.
 */
export async function pruefeAnfrageDa({ anfrageId, sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  finde(await lies(sheets, sheetId()), anfrageId);
  return true;
}
