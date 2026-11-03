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
import { ladeLShopZeilen, lshopAuswertung } from './lshop.js';
import { leseLieferbarkeit } from './lieferbarkeitLesen.js';
import { leseKunden } from './kunden.js';
import { leseLager } from './lager.js';
import { TAB_KORB, korbZeilen } from '../utils/korb-logic.js';   // AM-3: Korb nur lesen (Rueckmeldung)   // AM-2-2: nur Lagerorte lesen - der Auftrag bucht nie im Lager (das kommt mit AM-3)
import {
  TAB_AUFTRAEGE, TAB_POSITIONEN, AUFTRAG_SPALTEN, POSITION_SPALTEN, POSITION_OPTIONAL, AUFTRAG_OPTIONAL, brauchtHerkunftSpalten, zeilenAus,
  korbStand, wareStand, autoBestellt, ART, HERKUNFT, alsZeile, anlagePlan, bearbeitenPlan,
  statusWechsel, fertigPlan, fertigVorschlag, aktivePositionen, auftragZahlen, auftraegeAntwort, fehler,
} from '../utils/auftraege.js';

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
  const { data: zurueck } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId, ranges: [`'${TAB_AUFTRAEGE}'`, `'${TAB_POSITIONEN}'`], valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const neu = { [TAB_AUFTRAEGE]: zurueck.valueRanges?.[0]?.values ?? [], [TAB_POSITIONEN]: zurueck.valueRanges?.[1]?.values ?? [] };
  let ab = 0;
  for (const z of zellen) ab += zeilenAbweichungen([[z.wert]], [[neu[z.tab][z.zeile - 1]?.[z.spalte]]]).length;
  for (const s of strecken) ab += zeilenAbweichungen(s.zeilen, neu[s.tab].slice(s.start - 1, s.ende)).length;
  if (ab) throw fehler(`Aufträge: Rücklesen weicht in ${ab} Zelle(n) ab – bitte prüfen.`, 500, 'ruecklesen');
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
  });
  const ware = new Map();
  const auftraege = auftraegeAntwort(a.zeilen, p.zeilen, anreichern).map(x => {
    const akt = aktivePositionen(p.zeilen, x.Auftrag_Nr);
    const w = wareStand(akt, korbJe);
    ware.set(x.Auftrag_Nr, w);
    return {
      ...x, vorschlagFertig: fertigVorschlag(x, akt), ware: w,
      freiOffen: akt.filter(y => y.Art === ART.FREI && !y.Herkunft).length,
      autoBestellt: gesetzt.includes(x.Auftrag_Nr),
    };
  });
  const antwort = { auftraege, zahlen: auftragZahlen(a.zeilen, jetzt().toISOString(), ware), designSpalte: a.idx.Design_Am !== undefined };
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
    await schreibe(sheets, spreadsheetId, { bloecke: [
      { tab: TAB_AUFTRAEGE, alt: wa, zeilen: [alsZeile(a.idx, plan.auftrag, AUFTRAG_SPALTEN, wa[0].length)] },
      { tab: TAB_POSITIONEN, alt: wp, zeilen: plan.positionen.map(x => alsZeile(p.idx, x, POSITION_SPALTEN, wp[0].length)) },
    ] });
    return { ok: true, schon: false, auftragNr: plan.auftrag.Auftrag_Nr, positionen: plan.positionen.length };
  });
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

/** Statuswechsel (weiter | zurueck | bezahlt | bezahlt_zurueck | stornieren | storno_zurueck). */
export async function wechsleStatus({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitAuftrag(eingabe, s, async ({ sheets, spreadsheetId, a, auftrag }) => {
    pruefeStand(auftrag, eingabe);
    const felder = { ...statusWechsel(auftrag, String(eingabe?.aktion ?? ''), jetzt().toISOString(), { ueberspringen: !!eingabe?.ueberspringen }), Stand: jetzt().toISOString() };
    // AM-3: Schritt "Design" braucht die Spalte Design_Am - sonst klare Meldung statt still verlorenem Datum.
    if (felder.Design_Am && a.idx.Design_Am === undefined) {
      throw fehler('Spalte Design_Am fehlt in Auftraege – erst scripts/setup-auftraege-reiter.js --write (oder „Design überspringen“).', 409, 'einrichtung');
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
