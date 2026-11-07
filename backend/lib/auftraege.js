// Auftraege (AM-2): Reiter `Auftraege` + `Auftrag_Positionen` im SSOT (GOOGLE_SHEET_ID), nur mit Kunden_Nr.
// Logik in utils/auftraege.js. L-Shop-Daten nur gelesen (LShop_Modelle, LShop_Lieferbarkeit); kein Korb (AM-3).
//
// Schreiben: eine Sperre je Instanz, beide Reiter frisch gelesen (UNFORMATTED), kein values.append: neue Zeilen in die
// ueber pruefeZielStrecke gepruefte Strecke, geaenderte Zellen einzeln - alles in EINEM values.batchUpdate (gleiches
// Sheet), danach zurueckgelesen. Auftrag-Stand wie gesehen (sonst 409 konflikt). Nie loeschen (Positionen: Entfernt).
// Log und Fehlertexte: nur Auftrag_Nr/Kunden_Nr und Zahlen, nie Namen.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { pruefeZielStrecke, spalteBuchstabe, zeilenAbweichungen } from './sheet-zeilen.js';
import { berlinDatum } from '../utils/berlin-tag.js';
import { ladeLShopZeilen, lshopAuswertung, TAB_LSHOP } from './lshop.js';
import { leseReiterSpalten } from './ssot-reiter.js';
import { euro } from '../utils/edi-bestellung.js';
import { leseLieferbarkeit } from './lieferbarkeitLesen.js';
import { leseKunden } from './kunden.js';
import { leseLager, ladePartner } from './lager.js';
import { TAB_KORB, korbZeilen } from '../utils/korb-logic.js';   // AM-3: Korb nur lesen (Rueckmeldung)   // AM-2-2: nur Lagerorte lesen - der Auftrag bucht nie im Lager (das kommt mit AM-3)
import {
  TAB_AUFTRAEGE, TAB_POSITIONEN, AUFTRAG_SPALTEN, POSITION_SPALTEN, POSITION_OPTIONAL, AUFTRAG_OPTIONAL, brauchtHerkunftSpalten, zeilenAus,
  korbStand, wareStand, autoBestellt, ART, HERKUNFT, alsZeile, anlagePlan, bearbeitenPlan, VERWEIS_KORB,
  statusWechsel, fertigPlan, fertigVorschlag, aktivePositionen, auftragZahlen, auftraegeAntwort, fehler,
  PREIS_SPALTEN, ANGEBOT_SPALTEN, brauchtPreisSpalten, POSITIONEN_PFLICHT_AB,
} from '../utils/auftraege.js';
import { kundenHistorie } from '../utils/auftrag-historie.js';   // AM-6
import { auftragSummen, positionAusZeile, rabattAus, angebotAbweichung, ZUSTAENDIG } from '../utils/auftrag-preise.js';
import {
  TAB_AUFGABEN, TAB_TODOS, AUFGABE_SPALTEN, TODO_SPALTEN, VERWORFEN, istBezug, aufgabeOffen, aufgabeAnlagePlan, aufgabeBearbeitenPlan,
  aufgabeStatusWechsel, todoAnlagePlan, todoAendernPlan, todoArchivPlan, todoVerschiebenPlan, aufgabenZahlen, ohneIntern, todoAktiv,
} from '../utils/aufgaben.js';

const CACHE_MS = 30 * 1000;
let cache = null;
export function _auftraegeCacheLeeren() { cache = null; }

let laeuft = false;
export async function mitAuftragSperre(fn) { return mitSperre(fn); }
export function _auftragSpreadsheet() { return sheetId(); }
async function mitSperre(fn) {
  if (laeuft) throw fehler('Aufträge werden gerade gespeichert – gleich noch einmal.', 409, 'laeuft_gerade');
  laeuft = true;
  try { return await fn(); } finally { laeuft = false; cache = null; }
}

async function sheetsClient() { return google.sheets({ version: 'v4', auth: await getGoogleAuth() }); }
function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  return id;
}

export async function liesAuftraege(sheets, spreadsheetId) { return lies(sheets, spreadsheetId); }
async function lies(sheets, spreadsheetId) {
  let data;
  try {
    ({ data } = await sheets.spreadsheets.values.batchGet({
      spreadsheetId, ranges: [`'${TAB_AUFTRAEGE}'`, `'${TAB_POSITIONEN}'`], valueRenderOption: 'UNFORMATTED_VALUE',
    }));
  } catch (err) {
    if (err?.code === 400 || err?.response?.status === 400) throw fehler('Reiter Auftraege/Auftrag_Positionen fehlen – scripts/setup-auftraege-reiter.js --write.', 409, 'einrichtung');
    throw err;
  }
  const [wa = [], wp = []] = (data.valueRanges ?? []).map(v => v.values ?? []);
  const a = zeilenAus(wa, AUFTRAG_SPALTEN, 'Auftrag_Nr', AUFTRAG_OPTIONAL);
  const p = zeilenAus(wp, POSITION_SPALTEN, 'Position_ID', POSITION_OPTIONAL);
  if (!wa.length || !wp.length || a.fehlt.length || p.fehlt.length) {
    throw fehler(`Spalten fehlen (${[...a.fehlt, ...p.fehlt].join(', ') || 'Kopfzeile'}) – scripts/setup-auftraege-reiter.js.`, 409, 'einrichtung');
  }
  return { wa, wp, a, p };
}

// AM-4: Aufgaben + To-dos (eigene Reiter). Fehlt ein Reiter, ist er null - Lesen laeuft weiter, Schreiben meldet 409.
const ZUSATZ = [
  { tab: TAB_AUFGABEN, spalten: AUFGABE_SPALTEN, schluessel: 'Aufgabe_Nr', optional: ['Zustaendig'] },   // AM-5: Zustaendig hinten
  { tab: TAB_TODOS, spalten: TODO_SPALTEN, schluessel: 'Todo_ID' },
];
async function liesZusatz(sheets, spreadsheetId) {
  const aus = {};
  for (const z of ZUSATZ) {
    let werte = null;
    try {
      const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${z.tab}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
      werte = data.values ?? [];
    } catch (err) {
      if (!(err?.code === 400 || err?.response?.status === 400)) throw err;
    }
    if (!werte) { aus[z.tab] = null; continue; }
    const r = zeilenAus(werte, z.spalten, z.schluessel, z.optional ?? []);
    aus[z.tab] = { werte, ...r, kaputt: !werte.length || r.fehlt.length > 0 };
  }
  return { g: aus[TAB_AUFGABEN], d: aus[TAB_TODOS] };
}
function brauche(x, tab) {
  if (!x || x.kaputt) throw fehler(`Reiter ${tab} fehlt oder Spalten fehlen${x?.fehlt?.length ? ` (${x.fehlt.join(', ')})` : ''} – erst scripts/setup-auftraege-reiter.js --write.`, 409, 'einrichtung');
  return x;
}

// ── AM-5: EK je ArticleNr (10CartonsPrice, LShop_Modelle) und Summen je Auftrag ──
// Nur Anzeige in MC. EK = L-Shop-Preis ab 10 Kartons der ArticleNr (je Groesse; keine Mengenstaffel in der Quelle).
async function leseEkJe(sheets, spreadsheetId) {
  try {
    const zeilen = await leseReiterSpalten({ tab: TAB_LSHOP, spalten: { articleNr: 'ArticleNr' }, optional: { preis: '10CartonsPrice', stand: 'Quelle_Datum' }, sheets, spreadsheetId });
    return new Map(zeilen.map(z => [String(z.articleNr ?? '').trim(), { ek: euro(z.preis), stand: z.stand ?? '' }]));   // formatiert gelesen ("4,10") -> Zahl
  } catch { return new Map(); }
}
/** Summen eines Auftrags aus den aktiven Positionen (Groesse aus info, EK aus ekJe). */
function summenFuer(auftrag, aktive, info, ekJe) {
  const eingaben = aktive.map(p => positionAusZeile(p, { groesse: info.get(p.LShop_ArticleNr)?.groesse ?? '', ekAuto: p.LShop_ArticleNr ? ekJe.get(p.LShop_ArticleNr)?.ek ?? null : null }));
  let rabatt = null;
  try { rabatt = rabattAus(auftrag.Rabatt); } catch { /* ungueltig im Sheet -> ohne Rabatt */ }
  return auftragSummen(eingaben, rabatt);
}
/** Angebotsstand festhalten (Status "Angebot" bzw. Knopf): netto/brutto nach Rabatt (Euro) + Tag. */
const angebotFelder = (summen, tag) => ({ Angebot_Netto: summen.nettoNach / 100, Angebot_Brutto: summen.brutto / 100, Angebot_Stand: tag });
function pruefeSpalten(idx, spalten, was) {
  const fehlt = spalten.filter(s => idx[s] === undefined);
  if (fehlt.length) throw fehler(`Spalte fehlt (${fehlt.join(', ')}) – erst scripts/setup-auftraege-reiter.js --write (${was}).`, 409, 'einrichtung');
}

// ── L-Shop: waehlbare Nummern und Anzeige je Position (nur lesen) ─────────────

export async function lshopInfo(sheets, spreadsheetId, nummern) {
  const zeilen = await ladeLShopZeilen({ sheets, spreadsheetId });
  const nr = new Set([...nummern].filter(Boolean));
  const modelle = [...new Set(zeilen.filter(z => nr.has(z.articleNr)).map(z => z.catalogNr))];
  if (!modelle.length) return { waehlbar: new Set(), info: new Map() };
  const lb = await leseLieferbarkeit({ sheets, spreadsheetId });
  const waehlbar = new Set(), info = new Map();
  for (const m of modelle) {
    const zm = zeilen.filter(z => z.catalogNr === m);
    const a = lshopAuswertung(zm, { lieferbarkeit: lb.je });
    const bez = zm.find(z => z.bezeichnung)?.bezeichnung ?? '';
    for (const v of a.varianten) {
      waehlbar.add(v.articleNr);
      info.set(v.articleNr, { modell: m, bezeichnung: bez, farbe: v.farbe, groesse: v.groesse, bestellbar: true, ...(v.lieferbar ? { lieferbar: v.lieferbar } : {}) });
    }
    for (const g of a.gesperrt ?? []) {
      if (!info.has(g.articleNr)) info.set(g.articleNr, { modell: m, bezeichnung: bez, farbe: g.farbe, groesse: g.groesse, bestellbar: false });
    }
  }
  return { waehlbar, info };
}

// AM-2-2: aktive Lagerorte nur, wenn eine Position "aus Lager" kommt (sonst kein Lese-Aufruf).
async function lagerOrte(sheets, spreadsheetId, positionen) {
  if (!(positionen ?? []).some(p => String(p?.herkunft ?? '').trim() === 'lager')) return null;
  const l = await leseLager(sheets, spreadsheetId);
  return (l.orte ?? []).filter(o => o.status === 'aktiv').map(o => o.ort);
}
// Herkunft lager/vorhanden braucht die Spalten Herkunft + Lager_Ort; ohne sie wuerde die Wahl still verloren gehen.
function pruefeHerkunftSpalten(idx, positionen) {
  if (brauchtHerkunftSpalten(positionen) && ['Herkunft', 'Lager_Ort'].some(s => idx[s] === undefined)) {
    throw fehler('Spalten Herkunft/Lager_Ort fehlen in Auftrag_Positionen – erst scripts/setup-auftraege-reiter.js --write.', 409, 'einrichtung');
  }
}

export const nummernAus = liste => new Set((liste ?? []).map(p => String(p?.articleNr ?? p?.LShop_ArticleNr ?? '').trim()).filter(Boolean));

async function kundeOk(kundenNr) {
  const { kunden } = await leseKunden();
  const k = kunden.find(x => x.Kunden_Nr === kundenNr);
  if (!k) throw fehler(`Kunde ${kundenNr || '(leer)'} gibt es nicht.`, 422, 'kunde');
  if (k.Status === 'gesperrt-DSGVO') throw fehler(`${kundenNr} ist gesperrt (DSGVO).`, 422, 'kunde');
}

// ── Schreiben: ein batchUpdate fuer Zellen + neue Zeilen, zurueckgelesen ──────

async function schreibe(sheets, spreadsheetId, { zellen = [], bloecke = [] }) {
  const data = [];
  for (const z of zellen) data.push({ range: `'${z.tab}'!${spalteBuchstabe(z.spalte)}${z.zeile}`, values: [[z.wert]] });
  const strecken = [];
  for (const b of bloecke) {
    if (!b.zeilen.length) continue;
    const s = await pruefeZielStrecke(sheets, spreadsheetId, b.tab, b.alt, b.zeilen);
    strecken.push({ ...b, ...s });
    data.push({ range: s.range, values: b.zeilen });
  }
  if (!data.length) return { strecken };
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  const tabs = [...new Set([...zellen.map(z => z.tab), ...strecken.map(x => x.tab)])];   // AM-4: nur die beschriebenen Reiter zuruecklesen
  const { data: zurueck } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId, ranges: tabs.map(x => `'${x}'`), valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const neu = Object.fromEntries(tabs.map((x, i) => [x, zurueck.valueRanges?.[i]?.values ?? []]));
  let ab = 0;
  for (const z of zellen) ab += zeilenAbweichungen([[z.wert]], [[neu[z.tab][z.zeile - 1]?.[z.spalte]]]).length;
  for (const s of strecken) ab += zeilenAbweichungen(s.zeilen, neu[s.tab].slice(s.start - 1, s.ende)).length;
  if (ab) throw fehler(`Aufträge/Aufgaben: Rücklesen weicht in ${ab} Zelle(n) ab – bitte prüfen.`, 500, 'ruecklesen');
  return { strecken };
}

const zellenAus = (tab, idx, zeile, felder) => Object.entries(felder).filter(([f]) => idx[f] !== undefined)
  .map(([f, wert]) => ({ tab, zeile, spalte: idx[f], wert }));

// ── Lesen ────────────────────────────────────────────────────────────────────

/** GET /api/auftraege: alle Auftraege mit aktiven Positionen (L-Shop-Anzeige dazu), 30 s Zwischenspeicher. */
// AM-3: Korb-Zeilen je Schluessel (nur lesen). Fehlt der Reiter, ohne Rueckmeldung weiter.
export async function leseKorbJe(sheets, spreadsheetId) {
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_KORB}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    return new Map(korbZeilen(data.values ?? []).zeilen.map(z => [z.Schluessel, z]));
  } catch { return new Map(); }
}

/**
 * AM-3: automatisches "bestellt" (nur nach vorn) fuer die Auftraege, bei denen alle 🛒 im Korb mind. bestellt und alle
 * 📦 ausgebucht sind. Unter der Auftrags-Sperre frisch gelesen, EIN Schreibaufruf, zurueckgelesen. Laeuft gerade ein
 * anderer Schreiber, wird still uebersprungen (der naechste Blick bzw. der stuendliche Abgleich holt es nach).
 * @returns {string[]} die gesetzten Auftragsnummern
 */
export async function setzeAutoBestellt({ sheets: s, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  try {
    return await mitSperre(async () => {
      const { a, p } = await lies(sheets, spreadsheetId);
      const korbJe = await leseKorbJe(sheets, spreadsheetId);
      const iso = jetzt().toISOString(), tag = berlinDatum(jetzt());
      const ziele = a.zeilen.filter(x => autoBestellt(x, aktivePositionen(p.zeilen, x.Auftrag_Nr), korbJe));
      if (!ziele.length) return [];
      await schreibe(sheets, spreadsheetId, {
        zellen: ziele.flatMap(x => zellenAus(TAB_AUFTRAEGE, a.idx, x._zeile, { Status: 'bestellt', Bestellt_Am: x.Bestellt_Am || tag, Stand: iso })),
      });
      return ziele.map(x => x.Auftrag_Nr);
    });
  } catch (err) {
    if (err?.code === 'laeuft_gerade') return [];
    throw err;
  }
}

export async function leseAuftraege({ sheets: s, jetzt = () => new Date(), autoBestellen = true } = {}) {
  if (cache && cache.zeit > Date.now() - CACHE_MS && !s) return cache.antwort;
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  // AM-3: erst das automatische "bestellt" (nur nach vorn), dann frisch lesen - so sieht man den Stand sofort.
  const gesetzt = autoBestellen ? await setzeAutoBestellt({ sheets, jetzt }) : [];
  const { a, p } = await lies(sheets, spreadsheetId);
  const korbJe = await leseKorbJe(sheets, spreadsheetId);
  const { info } = await lshopInfo(sheets, spreadsheetId, nummernAus(p.zeilen.filter(x => !x.Entfernt)));
  const anreichern = x => ({
    ...x,
    ...(x.LShop_ArticleNr ? { lshop: info.get(x.LShop_ArticleNr) ?? { bestellbar: false } } : {}),
    ...(x.Korb_Schluessel ? { korb: korbStand(korbJe.get(x.Korb_Schluessel)) } : {}),
    ...(VERWEIS_KORB.test(String(x.Verweis ?? '')) ? { verweisKorb: korbStand(korbJe.get(String(x.Verweis).trim())) } : {}),   // KS3-1
  });
  const ware = new Map();
  const ekJe = await leseEkJe(sheets, spreadsheetId);   // AM-5
  const auftraege = auftraegeAntwort(a.zeilen, p.zeilen, x => {
    const y = anreichern(x);
    const e = x.LShop_ArticleNr ? ekJe.get(x.LShop_ArticleNr) : null;
    return e ? { ...y, ekAuto: e.ek, ekStand: e.stand } : y;
  }).map(x => {
    const akt = aktivePositionen(p.zeilen, x.Auftrag_Nr);
    const summen = summenFuer(x, akt, info, ekJe);
    const w = wareStand(akt, korbJe);
    ware.set(x.Auftrag_Nr, w);
    return {
      ...x, vorschlagFertig: fertigVorschlag(x, akt), ware: w,
      freiOffen: akt.filter(y => y.Art === ART.FREI && !y.Herkunft).length,
      autoBestellt: gesetzt.includes(x.Auftrag_Nr),
      preise: { ...summen, angebotGeaendert: angebotAbweichung(x, summen) },   // AM-5: Cent
    };
  });
  // AM-4: Aufgaben und To-dos (eigene Reiter); fehlen sie, leer + Kennzeichen fuer die Oberflaeche.
  const { g, d } = await liesZusatz(sheets, spreadsheetId);
  const aufgaben = g && !g.kaputt ? g.zeilen : [];
  const todos = d && !d.kaputt ? d.zeilen.filter(todoAktiv) : [];
  const offenJe = new Map([...a.zeilen.map(x => [x.Auftrag_Nr, x.Status !== 'storniert' && x.Status !== 'bezahlt']), ...aufgaben.map(x => [x.Aufgabe_Nr, aufgabeOffen(x)])]);
  const antwort = {
    auftraege, aufgaben: aufgaben.map(ohneIntern), todos: todos.map(ohneIntern),
    zahlen: { ...auftragZahlen(a.zeilen, jetzt().toISOString(), ware), ...aufgabenZahlen(aufgaben, todos, jetzt().toISOString(), nr => offenJe.get(nr) ?? false) },
    designSpalte: a.idx.Design_Am !== undefined,
    // AM-5: welche Spalten es schon gibt (Oberflaeche sperrt sonst Preise/Zustaendig mit Hinweis), feste Auswahl "Zuständig"
    spalten: { preise: PREIS_SPALTEN.every(s => p.idx[s] !== undefined), rabatt: a.idx.Rabatt !== undefined, angebot: ANGEBOT_SPALTEN.every(s => a.idx[s] !== undefined),
      zustaendig: a.idx.Zustaendig !== undefined, zustaendigAufgaben: !!g && !g.kaputt && g.idx.Zustaendig !== undefined,
      preisEingabe: a.idx.Preis_Eingabe !== undefined, designLink: a.idx.Design_Link !== undefined },   // AMQ1
    zustaendigAuswahl: ZUSTAENDIG,
    einrichtung: { aufgaben: !!g && !g.kaputt, todos: !!d && !d.kaputt },
  };
  if (!s) cache = { zeit: Date.now(), antwort };
  return antwort;
}

/** Nur Zahlen (Dashboard-Kachel). */
export async function leseAuftragZahlen({ sheets, jetzt } = {}) {
  return (await leseAuftraege({ sheets, jetzt })).zahlen;
}

// ── Schreiben ────────────────────────────────────────────────────────────────

/** Neuer Auftrag + Positionen in einem Schreibvorgang. Gleiche Vorgang-Kennung = schon angelegt (Doppelklick). */
export async function legeAuftragAn({ eingabe, sheets: s, jetzt = () => new Date(), kundePruefen = kundeOk } = {}) {
  const vorgang = String(eingabe?.vorgang ?? '').trim();
  if (!/^[\w-]{8,64}$/.test(vorgang)) throw fehler('Vorgangs-Kennung fehlt.', 422);
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { wa, wp, a, p } = await lies(sheets, spreadsheetId);
    const schon = a.zeilen.find(x => x.Vorgang === vorgang);
    if (schon) return { ok: true, schon: true, auftragNr: schon.Auftrag_Nr };
    await kundePruefen(String(eingabe?.Kunden_Nr ?? '').trim());
    const { waehlbar } = await lshopInfo(sheets, spreadsheetId, nummernAus(eingabe?.positionen));
    const orte = await lagerOrte(sheets, spreadsheetId, eingabe?.positionen);
    const plan = anlagePlan({ auftraege: a.zeilen, positionen: p.zeilen, eingabe, waehlbar, orte, jetzt: jetzt().toISOString() });
    pruefeHerkunftSpalten(p.idx, plan.positionen);
    if (brauchtPreisSpalten(plan.positionen)) pruefeSpalten(p.idx, PREIS_SPALTEN, 'Preise');   // AM-5
    if (plan.auftrag.Rabatt !== undefined && plan.auftrag.Rabatt !== '') pruefeSpalten(a.idx, ['Rabatt'], 'Rabatt');
    pruefeAmq1Spalten(a.idx, plan.auftrag);   // AMQ1
    // AM-6: ohne Spalte Vorlage_Von wird trotzdem angelegt (nur ohne Vermerk) - die Antwort sagt es der Oberflaeche
    const vorlageOhneSpalte = !!plan.auftrag.Vorlage_Von && a.idx.Vorlage_Von === undefined;
    if (plan.auftrag.Status === 'Angebot' && a.idx.Angebot_Stand !== undefined) {   // AM-5: Angebotsstand festhalten
      const { info } = await lshopInfo(sheets, spreadsheetId, nummernAus(plan.positionen));
      Object.assign(plan.auftrag, angebotFelder(summenFuer(plan.auftrag, plan.positionen, info, await leseEkJe(sheets, spreadsheetId)), plan.auftrag.Anfrage_Am));
    }
    await schreibe(sheets, spreadsheetId, { bloecke: [
      { tab: TAB_AUFTRAEGE, alt: wa, zeilen: [alsZeile(a.idx, plan.auftrag, AUFTRAG_SPALTEN, wa[0].length)] },
      { tab: TAB_POSITIONEN, alt: wp, zeilen: plan.positionen.map(x => alsZeile(p.idx, x, POSITION_SPALTEN, wp[0].length)) },
    ] });
    return { ok: true, schon: false, auftragNr: plan.auftrag.Auftrag_Nr, positionen: plan.positionen.length, ...(vorlageOhneSpalte ? { vorlageNichtVermerkt: true } : {}) };
  });
}

/**
 * AM-6: GET /api/auftraege/kunden/:kundenNr/historie - "Hatte bisher" je Modell + Farbe und freie Positionen (nur lesen).
 * Nur MC-Auftraege, nur Kunden_Nr in der Antwort; Lieferbarkeit/Katalog heute ueber lshopInfo. Nichts ins Log.
 */
export async function leseKundenHistorie({ kundenNr, sheets: s } = {}) {
  const nr = String(kundenNr ?? '').trim();
  if (!/^K-\d{5}$/.test(nr)) throw fehler('Kunden-Nr. ungültig.', 422);
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  const { a, p } = await lies(sheets, spreadsheetId);
  const eigene = new Set(a.zeilen.filter(x => x.Kunden_Nr === nr).map(x => x.Auftrag_Nr));
  const pos = p.zeilen.filter(x => eigene.has(x.Auftrag_Nr) && !x.Entfernt);
  const { info } = await lshopInfo(sheets, spreadsheetId, nummernAus(pos));
  return kundenHistorie({ auftraege: a.zeilen, positionen: pos, info, kundenNr: nr });
}

async function mitAuftrag(eingabe, s, fn) {
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const daten = await lies(sheets, spreadsheetId);
    const auftrag = daten.a.zeilen.find(x => x.Auftrag_Nr === String(eingabe?.auftragNr ?? '').trim());
    if (!auftrag) throw fehler('Auftrag gibt es nicht.', 404);
    return fn({ sheets, spreadsheetId, ...daten, auftrag });
  });
}
const pruefeStand = (auftrag, eingabe) => {
  if (String(eingabe?.stand ?? '').trim() !== auftrag.Stand) throw fehler(`${auftrag.Auftrag_Nr} wurde inzwischen geändert – bitte neu laden.`, 409, 'konflikt');
};

/** Bearbeiten (Kopf/Positionen bis Angebot, danach nur Notiz/Termin). */
export async function bearbeiteAuftrag({ eingabe, sheets: s, jetzt = () => new Date(), kundePruefen = kundeOk } = {}) {
  return mitAuftrag(eingabe, s, async ({ sheets, spreadsheetId, wp, a, p, auftrag }) => {
    pruefeStand(auftrag, eingabe);
    const { waehlbar } = await lshopInfo(sheets, spreadsheetId, nummernAus(eingabe?.positionen));
    const orte = await lagerOrte(sheets, spreadsheetId, eingabe?.positionen);
    const plan = bearbeitenPlan({ auftrag, positionen: p.zeilen, eingabe, waehlbar, orte, jetzt: jetzt().toISOString() });
    pruefeHerkunftSpalten(p.idx, [...plan.neuePositionen, ...plan.aenderungPositionen.map(x => x.felder)]);
    if (brauchtPreisSpalten([...plan.neuePositionen, ...plan.aenderungPositionen.map(x => x.felder)])) pruefeSpalten(p.idx, PREIS_SPALTEN, 'Preise');   // AM-5
    if (plan.aenderungAuftrag.Rabatt !== undefined) pruefeSpalten(a.idx, ['Rabatt'], 'Rabatt');
    pruefeAmq1Spalten(a.idx, plan.aenderungAuftrag);   // AMQ1
    if (plan.unveraendert) return { ok: true, auftragNr: auftrag.Auftrag_Nr, unveraendert: true };
    if (plan.aenderungAuftrag.Kunden_Nr) await kundePruefen(plan.aenderungAuftrag.Kunden_Nr);
    await schreibe(sheets, spreadsheetId, {
      zellen: [
        ...zellenAus(TAB_AUFTRAEGE, a.idx, auftrag._zeile, plan.aenderungAuftrag),
        ...plan.aenderungPositionen.flatMap(x => zellenAus(TAB_POSITIONEN, p.idx, x.zeile, x.felder)),
      ],
      bloecke: [{ tab: TAB_POSITIONEN, alt: wp, zeilen: plan.neuePositionen.map(x => alsZeile(p.idx, x, POSITION_SPALTEN, wp[0].length)) }],
    });
    return { ok: true, auftragNr: auftrag.Auftrag_Nr, positionenGeaendert: plan.aenderungPositionen.length, positionenNeu: plan.neuePositionen.length };
  });
}

/** AMQ1: Preis_Eingabe "brutto" bzw. ein Design-Link brauchen ihre Spalte - sonst klare Meldung statt still verloren. */
function pruefeAmq1Spalten(idx, felder) {
  if (felder.Preis_Eingabe) pruefeSpalten(idx, ['Preis_Eingabe'], 'Preis-Eingabe brutto');
  if (felder.Design_Link) pruefeSpalten(idx, ['Design_Link'], 'Design-Link');
}

/** Statuswechsel (weiter | zurueck | bezahlt | bezahlt_zurueck | stornieren | storno_zurueck). */
export async function wechsleStatus({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitAuftrag(eingabe, s, async ({ sheets, spreadsheetId, a, p, auftrag }) => {
    pruefeStand(auftrag, eingabe);
    const felder = { ...statusWechsel(auftrag, String(eingabe?.aktion ?? ''), jetzt().toISOString(), { ueberspringen: !!eingabe?.ueberspringen }), Stand: jetzt().toISOString() };
    // AMQ1: Positionen sind bis "Design" freiwillig - zu "bestellt" (Ware bestellen/bereitstellen) gehoert mindestens eine.
    if (felder.Status === POSITIONEN_PFLICHT_AB && !aktivePositionen(p.zeilen, auftrag.Auftrag_Nr).length) {
      throw fehler(`${auftrag.Auftrag_Nr}: erst Positionen erfassen – „bestellt“ geht nicht ohne Position.`, 422, 'ohne_positionen');
    }
    // AM-3: Schritt "Design" braucht die Spalte Design_Am - sonst klare Meldung statt still verlorenem Datum.
    if (felder.Design_Am && a.idx.Design_Am === undefined) {
      throw fehler('Spalte Design_Am fehlt in Auftraege – erst scripts/setup-auftraege-reiter.js --write (oder „Design überspringen“).', 409, 'einrichtung');
    }
    // AM-5: beim Wechsel auf "Angebot" Summe netto/brutto + Tag festhalten. Ohne Spalten: mit Preisen 409, ohne Preise still weiter.
    if (felder.Status === 'Angebot') {
      const akt = aktivePositionen(p.zeilen, auftrag.Auftrag_Nr);
      const { info } = await lshopInfo(sheets, spreadsheetId, nummernAus(akt));
      const summen = summenFuer(auftrag, akt, info, await leseEkJe(sheets, spreadsheetId));
      if (ANGEBOT_SPALTEN.every(s => a.idx[s] !== undefined)) Object.assign(felder, angebotFelder(summen, felder.Angebot_Am || berlinDatum(jetzt())));
      else if (summen.netto) pruefeSpalten(a.idx, ANGEBOT_SPALTEN, 'Angebotsstand');
    }
    await schreibe(sheets, spreadsheetId, { zellen: zellenAus(TAB_AUFTRAEGE, a.idx, auftrag._zeile, felder) });
    return { ok: true, auftragNr: auftrag.Auftrag_Nr, status: felder.Status ?? auftrag.Status };
  });
}

/** Haken "fertig" je Position; Antwort mit vorschlagFertig (der Mensch bestaetigt den Statuswechsel). */
export async function setzePositionFertig({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitAuftrag(eingabe, s, async ({ sheets, spreadsheetId, p, auftrag }) => {
    const plan = fertigPlan({ auftrag, positionen: p.zeilen, positionId: eingabe?.positionId, fertig: !!eingabe?.fertig, jetzt: jetzt().toISOString() });
    if (plan.felder) await schreibe(sheets, spreadsheetId, { zellen: zellenAus(TAB_POSITIONEN, p.idx, plan.position._zeile, plan.felder) });
    return { ok: true, auftragNr: auftrag.Auftrag_Nr, positionId: plan.position.Position_ID, vorschlagFertig: plan.vorschlagFertig, unveraendert: !plan.felder };
  });
}

// ── AM-4: Aufgaben ───────────────────────────────────────────────────────────

// "fuer": Kunde muss es geben (nicht gesperrt), Partner aktiv in der Partnerliste; Artikel nur die Produkt-ID (aus der Suche).
async function pruefeFuer(sheets, felder, kundePruefen) {
  if (felder.Fuer_Art === 'kunde') await kundePruefen(felder.Fuer);
  if (felder.Fuer_Art === 'partner') {
    const p = await ladePartner(sheets);
    if (!p.liste.length) throw fehler('Partnerliste gerade nicht lesbar – bitte gleich noch einmal.', 503, 'partner');
    if (!p.liste.some(x => x.id === felder.Fuer)) throw fehler(`Partner ${felder.Fuer} gibt es nicht (aktiv).`, 422, 'partner');
  }
}

async function mitAufgabe(eingabe, s, fn) {
  if (eingabe?.stand === undefined) throw fehler('Stand fehlt – bitte neu laden.', 422);
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const daten = await lies(sheets, spreadsheetId);
    const g = brauche((await liesZusatz(sheets, spreadsheetId)).g, TAB_AUFGABEN);
    const aufgabe = g.zeilen.find(x => x.Aufgabe_Nr === String(eingabe?.aufgabeNr ?? '').trim());
    if (!aufgabe) throw fehler('Aufgabe gibt es nicht.', 404);
    if (String(eingabe.stand).trim() !== aufgabe.Stand) throw fehler(`${aufgabe.Aufgabe_Nr} wurde inzwischen geändert – bitte neu laden.`, 409, 'konflikt');
    return fn({ sheets, spreadsheetId, ...daten, g, aufgabe });
  });
}

/** Neue Aufgabe (AG-JJJJ-NNNN, eigener Zaehler). Gleiche Vorgang-Kennung = schon angelegt (Doppelklick). */
export async function legeAufgabeAn({ eingabe, sheets: s, jetzt = () => new Date(), kundePruefen = kundeOk } = {}) {
  const vorgang = String(eingabe?.vorgang ?? '').trim();
  if (!/^[\w-]{8,64}$/.test(vorgang)) throw fehler('Vorgangs-Kennung fehlt.', 422);
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { a } = await lies(sheets, spreadsheetId);
    const g = brauche((await liesZusatz(sheets, spreadsheetId)).g, TAB_AUFGABEN);
    const schon = g.zeilen.find(x => x.Vorgang === vorgang);
    if (schon) return { ok: true, schon: true, aufgabeNr: schon.Aufgabe_Nr };
    const plan = aufgabeAnlagePlan({ aufgaben: g.zeilen, eingabe, auftragNummern: new Set(a.zeilen.map(x => x.Auftrag_Nr)), jetzt: jetzt().toISOString() });
    await pruefeFuer(sheets, plan, kundePruefen);
    await schreibe(sheets, spreadsheetId, { bloecke: [{ tab: TAB_AUFGABEN, alt: g.werte, zeilen: [alsZeile(g.idx, plan, AUFGABE_SPALTEN, g.werte[0].length)] }] });
    return { ok: true, schon: false, aufgabeNr: plan.Aufgabe_Nr };
  });
}

/** Aufgabe bearbeiten (Kurztitel, Notiz, Faellig, fuer, gehoert zu, "wartet auf" im Schritt wartet). */
export async function bearbeiteAufgabe({ eingabe, sheets: s, jetzt = () => new Date(), kundePruefen = kundeOk } = {}) {
  return mitAufgabe(eingabe, s, async ({ sheets, spreadsheetId, a, g, aufgabe }) => {
    const plan = aufgabeBearbeitenPlan({ aufgabe, eingabe, auftragNummern: new Set(a.zeilen.map(x => x.Auftrag_Nr)), jetzt: jetzt().toISOString() });
    if (plan.unveraendert) return { ok: true, aufgabeNr: aufgabe.Aufgabe_Nr, unveraendert: true };
    if (plan.aenderung.Fuer_Art !== undefined || plan.aenderung.Fuer !== undefined) await pruefeFuer(sheets, { ...aufgabe, ...plan.aenderung }, kundePruefen);
    await schreibe(sheets, spreadsheetId, { zellen: zellenAus(TAB_AUFGABEN, g.idx, aufgabe._zeile, plan.aenderung) });
    return { ok: true, aufgabeNr: aufgabe.Aufgabe_Nr };
  });
}

/** Statuswechsel einer Aufgabe (weiter | erledigt | zurueck | verwerfen | verwerfen_zurueck), wartetAuf beim Schritt "wartet". */
export async function wechsleAufgabeStatus({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitAufgabe(eingabe, s, async ({ sheets, spreadsheetId, g, aufgabe }) => {
    const felder = { ...aufgabeStatusWechsel(aufgabe, String(eingabe?.aktion ?? ''), jetzt().toISOString(), { wartetAuf: eingabe?.wartetAuf }), Stand: jetzt().toISOString() };
    await schreibe(sheets, spreadsheetId, { zellen: zellenAus(TAB_AUFGABEN, g.idx, aufgabe._zeile, felder) });
    return { ok: true, aufgabeNr: aufgabe.Aufgabe_Nr, status: felder.Status ?? aufgabe.Status };
  });
}

// ── AM-4: To-dos (Auftraege und Aufgaben) ────────────────────────────────────

async function mitTodos(s, fn) {
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { a } = await lies(sheets, spreadsheetId);
    const { g, d } = await liesZusatz(sheets, spreadsheetId);
    return fn({ sheets, spreadsheetId, a, g: g && !g.kaputt ? g : null, d: brauche(d, TAB_TODOS) });
  });
}
const todoAus = (d, eingabe) => {
  const todo = d.zeilen.find(x => x.Todo_ID === String(eingabe?.todoId ?? '').trim());
  if (!todo) throw fehler('To-do gibt es nicht (mehr) – bitte neu laden.', 404);
  return todo;
};

/** Neuer Punkt fuer eine AU-/AG-Nr., die es geben muss; storniert/verworfen -> 409. Doppelklick ueber Vorgang. */
export async function legeTodoAn({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  const vorgang = String(eingabe?.vorgang ?? '').trim();
  if (!/^[\w-]{8,64}$/.test(vorgang)) throw fehler('Vorgangs-Kennung fehlt.', 422);
  const bezug = String(eingabe?.bezug ?? '').trim();
  if (!istBezug(bezug)) throw fehler('Bezug muss AU-… oder AG-… sein.', 422);
  return mitTodos(s, async ({ sheets, spreadsheetId, a, g, d }) => {
    const schon = d.zeilen.find(x => x.Vorgang === vorgang);
    if (schon) return { ok: true, schon: true, todoId: schon.Todo_ID };
    const au = a.zeilen.find(x => x.Auftrag_Nr === bezug), ag = g?.zeilen.find(x => x.Aufgabe_Nr === bezug);
    if (!au && !ag) throw fehler(`${bezug} gibt es nicht.`, 404);
    const bezugOffen = au ? au.Status !== 'storniert' : ag.Status !== VERWORFEN;
    const plan = todoAnlagePlan({ todos: d.zeilen, bezug, eingabe, bezugOffen, jetzt: jetzt().toISOString() });
    await schreibe(sheets, spreadsheetId, { bloecke: [{ tab: TAB_TODOS, alt: d.werte, zeilen: [alsZeile(d.idx, plan, TODO_SPALTEN, d.werte[0].length)] }] });
    return { ok: true, schon: false, todoId: plan.Todo_ID };
  });
}

/** Haken / Text / Faelligkeit eines Punkts. */
export async function aendereTodo({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitTodos(s, async ({ sheets, spreadsheetId, d }) => {
    const todo = todoAus(d, eingabe);
    const plan = todoAendernPlan({ todo, eingabe, jetzt: jetzt().toISOString() });
    if (plan.felder) await schreibe(sheets, spreadsheetId, { zellen: zellenAus(TAB_TODOS, d.idx, todo._zeile, plan.felder) });
    return { ok: true, todoId: todo.Todo_ID, bezug: todo.Bezug, unveraendert: !plan.felder };
  });
}

/** Hoch/runter innerhalb des Bezugs. */
export async function verschiebeTodo({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitTodos(s, async ({ sheets, spreadsheetId, d }) => {
    const todo = todoAus(d, eingabe);
    const plan = todoVerschiebenPlan({ todos: d.zeilen, todo, richtung: String(eingabe?.richtung ?? ''), jetzt: jetzt().toISOString() });
    if (plan.length) await schreibe(sheets, spreadsheetId, { zellen: plan.flatMap(x => zellenAus(TAB_TODOS, d.idx, x.todo._zeile, x.felder)) });
    return { ok: true, todoId: todo.Todo_ID, unveraendert: !plan.length };
  });
}

/** Entfernen = archivieren (nie loeschen). */
export async function archiviereTodo({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitTodos(s, async ({ sheets, spreadsheetId, d }) => {
    const todo = todoAus(d, eingabe);
    const plan = todoArchivPlan({ todo, jetzt: jetzt().toISOString() });
    if (plan.felder) await schreibe(sheets, spreadsheetId, { zellen: zellenAus(TAB_TODOS, d.idx, todo._zeile, plan.felder) });
    return { ok: true, todoId: todo.Todo_ID, unveraendert: !plan.felder };
  });
}

// ── AM-5: Angebotsstand aktualisieren, "Zuständig" ───────────────────────────

/** Knopf "Angebotsstand aktualisieren": aktuelle Summe netto/brutto + heute festhalten (Stand wie gesehen). */
export async function aktualisiereAngebot({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitAuftrag(eingabe, s, async ({ sheets, spreadsheetId, a, p, auftrag }) => {
    pruefeStand(auftrag, eingabe);
    if (auftrag.Status === 'storniert') throw fehler(`${auftrag.Auftrag_Nr} ist storniert.`, 409, 'storniert');
    pruefeSpalten(a.idx, ANGEBOT_SPALTEN, 'Angebotsstand');
    const akt = aktivePositionen(p.zeilen, auftrag.Auftrag_Nr);
    const { info } = await lshopInfo(sheets, spreadsheetId, nummernAus(akt));
    const felder = { ...angebotFelder(summenFuer(auftrag, akt, info, await leseEkJe(sheets, spreadsheetId)), berlinDatum(jetzt())), Stand: jetzt().toISOString() };
    await schreibe(sheets, spreadsheetId, { zellen: zellenAus(TAB_AUFTRAEGE, a.idx, auftrag._zeile, felder) });
    return { ok: true, auftragNr: auftrag.Auftrag_Nr };
  });
}

/**
 * "Zuständig" (Christian · Nicole · leer) an Auftrag oder Aufgabe - einfach ueberschreiben: kein Stand-Vergleich, kein Verlauf,
 * der Stand der Zeile bleibt (offene Fenster werden nicht ungueltig). Fehlt die Spalte -> 409.
 */
export async function setzeZustaendig({ eingabe, sheets: s } = {}) {
  const nr = String(eingabe?.nr ?? '').trim();
  const wert = String(eingabe?.zustaendig ?? '').trim();
  if (wert && !ZUSTAENDIG.includes(wert)) throw fehler(`Zuständig: ${ZUSTAENDIG.join(', ')} oder leer.`, 422);
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    if (/^AG-/.test(nr)) {
      const g = brauche((await liesZusatz(sheets, spreadsheetId)).g, TAB_AUFGABEN);
      const x = g.zeilen.find(z => z.Aufgabe_Nr === nr);
      if (!x) throw fehler('Aufgabe gibt es nicht.', 404);
      pruefeSpalten(g.idx, ['Zustaendig'], 'Zuständig in Aufgaben');
      if (x.Zustaendig !== wert) await schreibe(sheets, spreadsheetId, { zellen: zellenAus(TAB_AUFGABEN, g.idx, x._zeile, { Zustaendig: wert }) });
      return { ok: true, nr, zustaendig: wert };
    }
    const { a } = await lies(sheets, spreadsheetId);
    const x = a.zeilen.find(z => z.Auftrag_Nr === nr);
    if (!x) throw fehler('Auftrag gibt es nicht.', 404);
    pruefeSpalten(a.idx, ['Zustaendig'], 'Zuständig in Aufträgen');
    if (x.Zustaendig !== wert) await schreibe(sheets, spreadsheetId, { zellen: zellenAus(TAB_AUFTRAEGE, a.idx, x._zeile, { Zustaendig: wert }) });
    return { ok: true, nr, zustaendig: wert };
  });
}
