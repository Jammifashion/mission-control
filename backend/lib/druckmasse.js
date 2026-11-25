// Druckmasse und DTF-Preise (DK1): Reiter `Druckmasse` (SSOT, GOOGLE_SHEET_ID) und Config dtf.* (Business-Sheet).
// Logik in utils/druckkosten.js. Nur MC (hinter dem API-Key): Druckkosten gehen nie in Bestellseite, Portal, Lexware,
// Chat oder Log - Log und Fehlertexte nennen hoechstens die Druckmass_ID.
//
// Schreiben: eine Sperre je Instanz, Reiter frisch gelesen (UNFORMATTED), neue Zeilen ohne append (schreibeNeueZeilen),
// Aenderung ueber ersetzeZeile (alter Inhalt geprueft, nur geaenderte Zellen, zurueckgelesen). Nie loeschen: "inaktiv".

import { google } from 'googleapis';
import { frischLesen } from './sheetsZentral.js';   // QU1: unter der Sperre immer frisch lesen
import { getGoogleAuth } from './googleAuth.js';
import { schreibeNeueZeilen, ersetzeZeile } from './sheet-zeilen.js';
import { normHeader } from '../utils/sheet-headers.js';
import { berlinDatum } from '../utils/berlin-tag.js';
import { _auftraegeCacheLeeren } from './auftraege.js';   // zyklisch, nur zur Laufzeit benutzt
import {
  TAB_DRUCKMASSE, DRUCKMASSE_SPALTEN, DRUCKMASSE_OPTIONAL, DTF_CONFIG_SCHLUESSEL, DTF_START_SCHLUESSEL, startDatumAus, dtfPreise, druckmassEingabe, istAktiv, massSchluessel,
  naechsteDruckmassId, normBezug, GROESSE_ALLE, FUEHREND, fuehrendAus, massSets, POSITIONEN,
} from '../utils/druckkosten.js';

const TAB_CONFIG = 'Config';
const t = v => String(v ?? '').trim();
const fehler = (text, status = 422, code) => Object.assign(new Error(text), { status, code });

async function sheetsClient() {
  return google.sheets({ version: 'v4', auth: await getGoogleAuth() });
}

let laeuft = null;
async function mitSperre(fn) {
  if (laeuft) throw fehler('Druckmaße werden gerade gespeichert – gleich noch einmal.', 409, 'laeuft_gerade');
  laeuft = true;
  try { return await frischLesen(fn); } finally { laeuft = null; _auftraegeCacheLeeren(); }   // neue Masse wirken sofort in der Auftragsansicht
}

/** Reiter lesen -> { werte, idx, zeilen [{ ...Spalten, _zeile }] } oder null (Reiter fehlt). */
async function liesReiter(sheets, spreadsheetId) {
  let werte;
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_DRUCKMASSE}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    werte = data.values ?? [];
  } catch (err) {
    if (err?.code === 400 || err?.response?.status === 400) return null;
    throw err;
  }
  const kopf = (werte[0] ?? []).map(normHeader);
  const alle = [...DRUCKMASSE_SPALTEN, ...DRUCKMASSE_OPTIONAL];   // DK2: Fuehrend, Modell optional hinten
  const idx = Object.fromEntries(alle.map(s => [s, kopf.indexOf(normHeader(s))]).filter(([, i]) => i >= 0));
  if (DRUCKMASSE_SPALTEN.some(s => idx[s] === undefined)) return null;
  const zeilen = werte.slice(1).map((r, i) => ({ ...Object.fromEntries(alle.map(s => [s, idx[s] === undefined ? '' : r[idx[s]] ?? ''])), _zeile: i + 2 }))
    .filter(z => t(z.Druckmass_ID));
  return { werte, idx, zeilen, breite: (werte[0] ?? []).length };
}
const brauche = x => {
  if (!x) throw fehler(`Reiter "${TAB_DRUCKMASSE}" fehlt oder Spalten fehlen – erst scripts/setup-druckmasse.js --write.`, 409, 'einrichtung');
  return x;
};
/** DK2: Hoehe fuehrend oder ein Modell brauchen die optionalen Spalten (Breite fuehrend = leer, geht auch ohne). */
function pruefeOptional(r, liste) {
  const fehlt = [];
  if (r.idx.Fuehrend === undefined && liste.some(e => e.Fuehrend === FUEHREND.HOEHE)) fehlt.push('Fuehrend');
  if (r.idx.Modell === undefined && liste.some(e => t(e.Modell))) fehlt.push('Modell');
  if (fehlt.length) throw fehler(`Spalte fehlt in ${TAB_DRUCKMASSE} (${fehlt.join(', ')}) – erst scripts/setup-druckmasse.js --write.`, 409, 'einrichtung');
}

/** Config dtf.* (Business) -> { schluessel: wert }; fehlt der Reiter/das Sheet: leer. Werte nie ins Log. */
export async function leseDtfConfig({ sheets, spreadsheetId = process.env.BUSINESS_SHEET_ID } = {}) {
  if (!spreadsheetId) return {};
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_CONFIG}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    const [kopf = [], ...rest] = data.values ?? [];
    const norm = kopf.map(normHeader);
    const iS = norm.indexOf(normHeader('Schlüssel')), iW = norm.indexOf(normHeader('Wert'));
    if (iS < 0 || iW < 0) return {};
    return Object.fromEntries(rest.filter(r => DTF_CONFIG_SCHLUESSEL.includes(t(r[iS])) || t(r[iS]) === DTF_START_SCHLUESSEL).map(r => [t(r[iS]), r[iW] ?? '']));
  } catch { return {}; }
}

/**
 * Fuer GET /api/auftraege: aktive Druckmasse + Preise. Faellt etwas aus, rechnet die Kalkulation ohne (Hinweis).
 * @returns {{ masse: object[], preise: object, einrichtung: boolean }}
 */
export async function leseDruckKontext({ sheets, spreadsheetId = process.env.GOOGLE_SHEET_ID } = {}) {
  let r = null;
  try { r = await liesReiter(sheets, spreadsheetId); } catch { r = null; }
  const cfg = await leseDtfConfig({ sheets });
  const preise = dtfPreise(cfg);
  // AU-UX1: Startdatum des DTF-Korbs nur fuer die Anzeige (Maß-Warnung erst fuer Auftraege ab diesem Tag)
  return { masse: r ? r.zeilen.filter(istAktiv) : [], preise, einrichtung: !!r, start: startDatumAus(cfg[DTF_START_SCHLUESSEL]), spalten: { fuehrend: r?.idx.Fuehrend !== undefined, modell: r?.idx.Modell !== undefined } };
}

/** Anzeige der Einstellungen in der Pflege-Ansicht: Preis je m² (Euro brutto) bzw. was fehlt. */
function preiseAnzeige(p) {
  const tf = x => (x.fehlt?.length || x.doppelt ? { ok: false, text: x.text, fehlt: x.fehlt ?? [] } : { ok: true, modell: x.modell, qmBrutto: Math.round(x.qmBruttoCent) / 100 });
  return { normal: tf(p.normal), express: tf(p.express), verschnitt: p.verschnitt };
}

const antwortZeile = z => ({
  id: t(z.Druckmass_ID), bezug: t(z.Bezug), position: t(z.Position), groesse: t(z.Groesse) || GROESSE_ALLE,
  breite: Number(z.Breite_cm) || null, hoehe: Number(z.Hoehe_cm) || null, aktiv: istAktiv(z), notiz: t(z.Notiz), stand: t(z.Stand),
  fuehrend: fuehrendAus(z.Fuehrend), modell: t(z.Modell),   // DK2
});

/** GET /api/druckmasse: alle Zeilen (auch inaktive) + Einstellungen. */
export async function leseDruckmasse({ sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  const r = await liesReiter(sheets, process.env.GOOGLE_SHEET_ID);
  const preise = preiseAnzeige(dtfPreise(await leseDtfConfig({ sheets })));
  // DK2: Maß-Sets fuer die Auswahl im Auftrag, feste Positionsliste, Spalten (Fuehrend/Modell da?)
  return { einrichtung: !!r, zeilen: r ? r.zeilen.map(antwortZeile) : [], preise, sets: massSets(r?.zeilen ?? []), positionen: POSITIONEN,
    spalten: { fuehrend: r?.idx.Fuehrend !== undefined, modell: r?.idx.Modell !== undefined } };
}

function zeileAus(idx, breite, felder) {
  const r = Array.from({ length: breite }, () => '');
  for (const [f, w] of Object.entries(felder)) if (idx[f] !== undefined) r[idx[f]] = w;
  return r;
}
const doppeltText = e => `Für ${e.Bezug} · ${e.Position} · ${e.Groesse} gibt es schon ein aktives Druckmaß.`;

/** POST /api/druckmasse/neu { bezug, position, groesse, breite, hoehe, notiz } */
export async function legeDruckmassAn({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  const e = druckmassEingabe(eingabe);
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const id = process.env.GOOGLE_SHEET_ID;
    const r = brauche(await liesReiter(sheets, id));
    pruefeOptional(r, [e]);
    if (r.zeilen.some(z => istAktiv(z) && massSchluessel(z) === massSchluessel(e))) throw fehler(doppeltText(e), 409, 'vorhanden');
    const nr = naechsteDruckmassId(r.zeilen.map(z => z.Druckmass_ID));
    const zeit = jetzt();
    await schreibeNeueZeilen(sheets, id, TAB_DRUCKMASSE, [zeileAus(r.idx, r.breite, { ...e, Druckmass_ID: nr, Aktiv: 'ja', Angelegt: berlinDatum(zeit), Stand: zeit.toISOString() })], { alt: r.werte });
    return { ok: true, id: nr };
  });
}

/** POST /api/druckmasse/aendern { id, stand, bezug, position, groesse, breite, hoehe, notiz, aktiv } */
export async function aendereDruckmass({ eingabe = {}, sheets: s, jetzt = () => new Date() } = {}) {
  const aktiv = eingabe.aktiv !== false;
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const id = process.env.GOOGLE_SHEET_ID;
    const r = brauche(await liesReiter(sheets, id));
    const z = r.zeilen.find(x => t(x.Druckmass_ID) === t(eingabe.id));
    if (!z) throw fehler('Druckmaß gibt es nicht.', 404);
    const e = druckmassEingabe({ ...eingabe, positionAlt: z.Position });   // DK2: alte Position (nicht aus der Liste) bleibt erlaubt
    pruefeOptional(r, [e]);
    if (t(z.Stand) !== t(eingabe.stand)) throw fehler(`${z.Druckmass_ID} wurde inzwischen geändert – neu laden.`, 409, 'konflikt');
    if (aktiv && r.zeilen.some(x => x !== z && istAktiv(x) && massSchluessel(x) === massSchluessel(e))) throw fehler(doppeltText(e), 409, 'vorhanden');
    const alt = r.werte[z._zeile - 1] ?? [];
    const neu = Array.from({ length: Math.max(alt.length, r.breite) }, (_, i) => alt[i] ?? '');
    for (const [f, w] of Object.entries({ ...e, Aktiv: aktiv ? 'ja' : 'nein', Stand: jetzt().toISOString() })) if (r.idx[f] !== undefined) neu[r.idx[f]] = w;
    await ersetzeZeile(sheets, id, TAB_DRUCKMASSE, z._zeile, alt, neu);
    return { ok: true, id: z.Druckmass_ID };
  });
}

/**
 * POST /api/druckmasse/merken { bezug, groesse, modell, teile: [{ position, breite, hoehe, fuehrend }], ersetzen }
 * "für dieses Motiv merken": je Teil eine Zeile Bezug + Position + Groesse (+ Modell). Gleiche aktive Zeile mit gleichen
 * Massen = schon da; mit anderen Massen -> 409 `anders` (Liste), es sei denn `ersetzen`. Erst alles pruefen, dann schreiben.
 * Danach rechnet der Auftrag sofort damit (Sperre leert den Auftrags-Zwischenspeicher, der Reiter wird frisch gelesen).
 */
export async function merkeDruckmasse({ eingabe = {}, sheets: s, jetzt = () => new Date() } = {}) {
  const teile = Array.isArray(eingabe.teile) ? eingabe.teile : [];
  if (!teile.length) throw fehler('Keine Druckmaße zum Merken.');
  const liste = teile.map(x => druckmassEingabe({ bezug: eingabe.bezug, groesse: eingabe.groesse, modell: eingabe.modell, position: x.position, breite: x.breite, hoehe: x.hoehe, fuehrend: x.fuehrend }));
  if (new Set(liste.map(massSchluessel)).size !== liste.length) throw fehler('Eine Druckposition steht doppelt.');
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const id = process.env.GOOGLE_SHEET_ID;
    const r = brauche(await liesReiter(sheets, id));
    pruefeOptional(r, liste);
    const zeit = jetzt();
    const neu = [], ersetzen = [], anders = [];
    let schon = 0;
    for (const e of liste) {
      const z = r.zeilen.find(x => istAktiv(x) && massSchluessel(x) === massSchluessel(e));
      if (!z) { neu.push(e); continue; }
      const gleich = (a, b) => (t(a) === '' && t(b) === '') || Number(a) === Number(b);
      if (gleich(z.Breite_cm, e.Breite_cm) && gleich(z.Hoehe_cm, e.Hoehe_cm) && fuehrendAus(z.Fuehrend) === e.Fuehrend) { schon += 1; continue; }
      const txt = (b, h, f) => `${t(b) || '?'} × ${t(h) || '?'}${fuehrendAus(f) === FUEHREND.HOEHE ? ' (Höhe führend)' : ''}`;
      anders.push({ position: e.Position, alt: txt(z.Breite_cm, z.Hoehe_cm, z.Fuehrend), neu: txt(e.Breite_cm, e.Hoehe_cm, e.Fuehrend) });
      ersetzen.push({ z, e });
    }
    if (anders.length && eingabe.ersetzen !== true) throw Object.assign(fehler('Für dieses Motiv sind schon andere Druckmaße hinterlegt.', 409, 'anders'), { anders });
    for (const { z, e } of ersetzen) {
      const alt = r.werte[z._zeile - 1] ?? [];
      const zeile = Array.from({ length: Math.max(alt.length, r.breite) }, (_, i) => alt[i] ?? '');
      zeile[r.idx.Breite_cm] = e.Breite_cm; zeile[r.idx.Hoehe_cm] = e.Hoehe_cm; zeile[r.idx.Stand] = zeit.toISOString();
      if (r.idx.Fuehrend !== undefined) zeile[r.idx.Fuehrend] = e.Fuehrend;
      await ersetzeZeile(sheets, id, TAB_DRUCKMASSE, z._zeile, alt, zeile);
    }
    if (neu.length) {
      const ids = r.zeilen.map(z => z.Druckmass_ID);
      const zeilen = neu.map(e => {
        const nr = naechsteDruckmassId(ids);
        ids.push(nr);
        return zeileAus(r.idx, r.breite, { ...e, Notiz: t(eingabe.notiz) || 'aus Auftrag gemerkt', Druckmass_ID: nr, Aktiv: 'ja', Angelegt: berlinDatum(zeit), Stand: zeit.toISOString() });
      });
      await schreibeNeueZeilen(sheets, id, TAB_DRUCKMASSE, zeilen, { alt: ersetzen.length ? undefined : r.werte });
    }
    return { ok: true, neu: neu.length, ersetzt: ersetzen.length, schon, bezug: normBezug(eingabe.bezug) ? liste[0].Bezug : '' };
  });
}

// ── Setup (scripts/setup-druckmasse.js) ─────────────────────────────────────
/**
 * Reiter Druckmasse (Kopfzeile) im SSOT + Config-Zeilen dtf.* im Business-Sheet. Idempotent, nur Fehlendes; schreibt nur mit
 * write=true. Config: Breite 57, Verschnitt 15 vorbelegt, Bogenlaenge und Preise LEER (traegt der Inhaber ein).
 */
export async function richteDruckmasseEin({ write = false, sheets: s } = {}) {
  const { DTF_CONFIG_VORGABE } = await import('../utils/druckkosten.js');
  const sheets = s ?? await sheetsClient();
  const ssot = process.env.GOOGLE_SHEET_ID, business = process.env.BUSINESS_SHEET_ID;
  if (!ssot || !business) throw new Error('GOOGLE_SHEET_ID / BUSINESS_SHEET_ID fehlen.');
  const plan = [];
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: ssot, fields: 'sheets.properties.title' });
  const da = meta.sheets.some(x => x.properties.title === TAB_DRUCKMASSE);
  let kopf = [];
  if (da) kopf = ((await sheets.spreadsheets.values.get({ spreadsheetId: ssot, range: `'${TAB_DRUCKMASSE}'!1:1` })).data.values ?? [[]])[0] ?? [];
  if (!da) plan.push(`Reiter ${TAB_DRUCKMASSE} anlegen + Kopfzeile (${DRUCKMASSE_SPALTEN.join(' | ')})`);
  else if (!kopf.length) plan.push(`Kopfzeile ${TAB_DRUCKMASSE} schreiben`);
  else {
    const fehlt = DRUCKMASSE_SPALTEN.filter(x => !kopf.map(normHeader).includes(normHeader(x)));
    if (fehlt.length) throw new Error(`${TAB_DRUCKMASSE} hat eine andere Kopfzeile (fehlt: ${fehlt.join(', ')}) – bitte von Hand prüfen.`);
  }
  // DK2: optionale Spalten Fuehrend, Modell hinten anhaengen (nur Kopfzellen; leere Zellen lesen sich als Breite / alle Modelle)
  const optFehlt = DRUCKMASSE_OPTIONAL.filter(x => !kopf.map(normHeader).includes(normHeader(x)));
  const kopfLaenge = da && kopf.length ? kopf.length : 0;
  if (kopfLaenge && optFehlt.length) plan.push(`Spalten hinten in ${TAB_DRUCKMASSE}: ${optFehlt.join(', ')} (bestehende Zeilen bleiben leer = Breite führend)`);
  const { data: c } = await sheets.spreadsheets.values.get({ spreadsheetId: business, range: `'${TAB_CONFIG}'`, valueRenderOption: 'UNFORMATTED_VALUE' });   // wie schreibeNeueZeilen vergleicht (Datum = Zahl)
  const [ck = [], ...cz] = c.values ?? [];
  const iS = ck.map(normHeader).indexOf(normHeader('Schlüssel')), iW = ck.map(normHeader).indexOf(normHeader('Wert'));
  if (iS < 0 || iW < 0) throw new Error('Config: Spalten Schlüssel/Wert fehlen.');
  const vorhanden = new Set(cz.map(r => t(r[iS])));
  const configNeu = DTF_CONFIG_SCHLUESSEL.filter(k => !vorhanden.has(k)).map(k => {
    const r = Array.from({ length: Math.max(iS, iW) + 1 }, () => '');
    r[iS] = k; r[iW] = DTF_CONFIG_VORGABE[k] ?? '';
    return r;
  });
  for (const r of configNeu) plan.push(`Config-Zeile ${r[iS]} = ${r[iW] === '' ? '(leer – Inhaber trägt ein)' : r[iW]}`);
  if (!write || !plan.length) return { plan, geschrieben: false };
  if (!da) await sheets.spreadsheets.batchUpdate({ spreadsheetId: ssot, requestBody: { requests: [{ addSheet: { properties: { title: TAB_DRUCKMASSE, gridProperties: { frozenRowCount: 1 } } } }] } });
  if (!da || !kopf.length) {
    await sheets.spreadsheets.values.update({ spreadsheetId: ssot, range: `'${TAB_DRUCKMASSE}'!A1`, valueInputOption: 'RAW', requestBody: { values: [[...DRUCKMASSE_SPALTEN, ...DRUCKMASSE_OPTIONAL]] } });
  } else if (optFehlt.length) {
    const spalte = n => { let x = ''; for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) x = String.fromCharCode(65 + ((i - 1) % 26)) + x; return x; };
    const ziel = `'${TAB_DRUCKMASSE}'!${spalte(kopfLaenge)}1:${spalte(kopfLaenge + optFehlt.length - 1)}1`;
    const vorher = (await sheets.spreadsheets.values.get({ spreadsheetId: ssot, range: ziel })).data.values ?? [];
    if ((vorher[0] ?? []).some(v => t(v))) throw new Error(`${ziel} ist nicht leer – bitte von Hand prüfen.`);
    await sheets.spreadsheets.values.update({ spreadsheetId: ssot, range: ziel, valueInputOption: 'RAW', requestBody: { values: [optFehlt] } });
    const nach = ((await sheets.spreadsheets.values.get({ spreadsheetId: ssot, range: ziel })).data.values ?? [[]])[0] ?? [];
    if (nach.join('|') !== optFehlt.join('|')) throw new Error(`${ziel}: Rücklesen weicht ab.`);
  }
  if (configNeu.length) await schreibeNeueZeilen(sheets, business, TAB_CONFIG, configNeu, { alt: c.values ?? [] });
  return { plan, geschrieben: true };
}
