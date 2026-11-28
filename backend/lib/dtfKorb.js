// DTF-Warenkorb (DT1): Sheets, Shop und Drive. Logik in utils/dtf-korb.js, Drive in lib/dtfAblage.js.
//
// Reiter im SSOT: `Warenkorb_DTF` (stehender Bestand, Zeilen nie geloescht), `DTF_Dateien` (Datei je Bezug/Position/Modell/Farbe/
// Groesse), `DTF_Bestellprotokoll` (je DTF-JJJJ-NNNN eine Zeile). Config (Business): dtf.start_datum, dtf.mindest_laenge_cm,
// dtf.scan_basis_url (+ DK1-Preise dtf.*). Shop: nur JFN, nur GET. Schreiben: eine Sperre je Instanz (frischLesen), neue Zeilen ohne
// append (schreibeNeueZeilen), Aenderungen ueber ersetzeZeile bzw. EIN values.batchUpdate nach Vorher-Pruefung, zurueckgelesen.
// Log/Chat: nur Bestell-IDs, Zahlen - nie Namen, Preise, Drucknamen.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { frischLesen } from './sheetsZentral.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { getWcClient } from './shopConfig.js';
import { seitenGrenze, seitenListe } from './hosterPruefseite.js';
import { leseReiterSpalten } from './ssot-reiter.js';
import { schreibeNeueZeilen, ersetzeZeile, zeilenAbweichungen, spalteBuchstabe } from './sheet-zeilen.js';
import { leseDruckKontext, merkeDruckmasse } from './druckmasse.js';
import { notify, notifyFehler } from './chatNotify.js';
import * as ablageStandard from './dtfAblage.js';
import { normHeader } from '../utils/sheet-headers.js';
import { wcVariationMap, varianteDerPosition } from '../utils/varianten-zeilen.js';
import { berlinDatum, berlinJahr, wcTagDE } from '../utils/berlin-tag.js';
import { dtfPreise, istDtf, POSITIONEN, normBezug, istAktiv, masseFuer, GROESSE_ALLE, startDatumAus } from '../utils/druckkosten.js';
import {
  TAB_DTF_KORB, KORB_SPALTEN, TAB_DTF_DATEIEN, DATEI_SPALTEN, TAB_DTF_PROTOKOLL, PROTOKOLL_SPALTEN, QUELLE, STATUS, GRUENDE,
  BESTELL_STATUS, LIEFERARTEN, CONFIG, SHOP_STATUS_OFFEN, BREITE_STANDARD_CM, VERSCHNITT_STANDARD, BESTELL_ID_RE, DRUCK_ID_RE,
  fehler, reiterZeilen, alsZeile, shopEinstufung, druckpositionenFuer, dtfAbgleichPlan, shopZustand, auZustand, nachtragOffen, quellSchluessel,
  zeileAnsicht, sichtbareZeilen, meterSchaetzung, naechsteBestellId, druckIdFuer, bestellEingabe, bestellAuswahl, baueDtfXml,
  nachrichtAnNico, chatText, haengt, statusPlan, zuordnenPlan, dateiSchluessel, dateiFuer, wasFehlt, verkaufSchluessel, istJa, referenzFuer,
  scanAdresse, farbeGroesse, GRUND_LAGER, istLagerZeile, dtfStandJePosition, dtfKartenPlan, DTF_STAND, positionsSchluessel, KORB_OPTIONAL,
} from '../utils/dtf-korb.js';

const TAB_VARIANTEN = 'Varianten', TAB_MASKE = 'Erfassungsmaske', TAB_MOTIVE = 'Motive', TAB_TRIKOT = 'Trikot_Artikel', TAB_CONFIG = 'Config';
const SHOP = 'JFN';
const ORDER_FELDER = 'id,status,date_created,line_items';
const BLOCK = 100;
const t = v => String(v ?? '').trim();

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}
const ssotId = () => process.env.GOOGLE_SHEET_ID;

export const DTF_BESCHAEFTIGT = 'Der DTF-Korb wird gerade bearbeitet – bitte gleich noch einmal.';
let laeuft = false;
export async function mitDtfSperre(fn) {
  if (laeuft) throw fehler(DTF_BESCHAEFTIGT, 409, 'laeuft_gerade');
  laeuft = true;
  try { return await frischLesen(fn); } finally { laeuft = false; }
}

let letzterAbgleich = null;   // { zeit, aelter, zaehler } - fuer die Anzeige "ältere Bestellungen"
export function _dtfKorbZustandLeeren() { letzterAbgleich = null; verkaufCache = null; }

// ── Lesen ────────────────────────────────────────────────────────────────────

async function liesTab(sheets, spreadsheetId, tab) {
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    return data.values ?? [];
  } catch (err) {
    if (err?.code === 400 || err?.response?.status === 400) return null;   // Reiter fehlt
    throw err;
  }
}
function tabelle(werte, spalten, pflicht = spalten) {
  if (!werte) return null;
  const kopf = (werte[0] ?? []).map(normHeader);
  const idx = Object.fromEntries(spalten.map(s => [s, kopf.indexOf(normHeader(s))]).filter(([, i]) => i >= 0));
  return {
    idx, werte, breite: (werte[0] ?? []).length, fehlt: pflicht.filter(s => idx[s] === undefined),
    zeilen: werte.slice(1).map((z, i) => ({ ...Object.fromEntries(spalten.map(s => [s, idx[s] === undefined ? '' : z?.[idx[s]] ?? ''])), _zeile: i + 2 })),
  };
}
const brauche = (x, tab) => {
  if (!x || x.fehlt.length) throw fehler(`Reiter ${tab} fehlt${x?.fehlt?.length ? ` (Spalten: ${x.fehlt.join(', ')})` : ''} – erst scripts/setup-dtf-korb.js --write.`, 409, 'einrichtung');
  return x;
};

async function liesAlles(sheets, spreadsheetId = ssotId()) {
  const [k, d, p] = await Promise.all([TAB_DTF_KORB, TAB_DTF_DATEIEN, TAB_DTF_PROTOKOLL].map(tab => liesTab(sheets, spreadsheetId, tab)));
  return {
    korb: tabelle(k, [...KORB_SPALTEN, ...KORB_OPTIONAL], KORB_SPALTEN),   // LG1: Aus_Lager optional
    dateien: tabelle(d, DATEI_SPALTEN),
    protokoll: tabelle(p, PROTOKOLL_SPALTEN, PROTOKOLL_SPALTEN.filter(x => x !== 'Ersetzt')),
  };
}

/** Config dtf.* (Business) -> { schluessel: wert }. */
export async function leseDtfEinstellungen({ sheets, spreadsheetId = process.env.BUSINESS_SHEET_ID } = {}) {
  if (!spreadsheetId) return {};
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_CONFIG}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    const [kopf = [], ...rest] = data.values ?? [];
    const n = kopf.map(normHeader);
    const iS = n.indexOf(normHeader('Schlüssel')), iW = n.indexOf(normHeader('Wert'));
    if (iS < 0 || iW < 0) return {};
    return Object.fromEntries(rest.filter(r => t(r[iS]).startsWith('dtf.')).map(r => [t(r[iS]), r[iW] ?? '']));
  } catch { return {}; }
}
export { startDatumAus };   // AU-UX1: Parser liegt in utils/druckkosten.js (auch fuer die Auftragsansicht)
function meterEinstellungen(cfg) {
  const p = dtfPreise(cfg);
  const breite = Number(String(cfg['dtf.breite_cm'] ?? '').replace(',', '.')) || BREITE_STANDARD_CM;
  return {
    breiteCm: breite, verschnitt: p.verschnitt ?? VERSCHNITT_STANDARD,
    mindestCm: Number(String(cfg[CONFIG.mindest] ?? '').replace(',', '.')) || null,
    tarif: { normal: p.normal, express: p.express },
    scanBasis: t(cfg[CONFIG.scanBasis]), start: startDatumAus(cfg[CONFIG.start]),
  };
}

/** Kontext fuer die Shop-Einstufung (Varianten, Maske, Motive, Trikots). */
async function shopKontext(sheets, spreadsheetId) {
  const varianten = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_VARIANTEN}'` })).data.values ?? [];
  const varMap = wcVariationMap(varianten, 'DTF-Korb');
  const maske = await leseReiterSpalten({ tab: TAB_MASKE, spalten: { id: 'ID', pid: 'Produkt-ID' },
    optional: { kurz: 'Artikelkurzbezeichnung', artikelnummer: 'Artikelnummer' }, sheets, spreadsheetId });
  const motive = await leseReiterSpalten({ tab: TAB_MOTIVE, spalten: { kurz: 'Artikelkurzbezeichnung' }, optional: { druckart: 'Druckart' }, sheets, spreadsheetId });
  let trikot = [];
  try { trikot = await leseReiterSpalten({ tab: TAB_TRIKOT, spalten: { pid: 'Produkt-ID' }, sheets, spreadsheetId: process.env.BUSINESS_SHEET_ID }); } catch { trikot = []; }
  const produktIdJeSsot = Object.fromEntries(maske.map(m => [t(m.id), t(m.pid)]));
  return {
    varMap, produktIdJeSsot, varianten,
    maskeJeProdukt: new Map(maske.filter(m => t(m.pid)).map(m => [t(m.pid), { kurz: t(m.kurz), artikelnummer: t(m.artikelnummer), ssotId: t(m.id) }])),
    maskeZeilen: maske,
    motivDruckart: new Map(motive.map(m => [normBezug(m.kurz), t(m.druckart)])),
    trikotIds: new Set(trikot.map(x => t(x.pid)).filter(Boolean)),
  };
}
const einstufen = (li, ctx) => shopEinstufung(li, { ...ctx, variante: varianteDerPosition(ctx.varMap, ctx.produktIdJeSsot, li) });

/** Bestellungen ueber IDs (je 100 eine Anfrage); nicht zurueckgegeben (geloescht) -> null. */
async function ladeBestellungenNachId(wc, ids, felder) {
  const map = new Map(ids.map(id => [String(id), null]));
  for (let i = 0; i < ids.length; i += BLOCK) {
    const liste = seitenListe((await wc.get('orders', { include: ids.slice(i, i + BLOCK).join(','), status: 'any', per_page: BLOCK, _fields: felder })).data, { wc, pfad: 'orders' });
    for (const o of liste) map.set(String(o.id), o);
  }
  return map;
}

async function ladeOffeneBestellungen(wc) {
  const alle = [];
  for (const status of SHOP_STATUS_OFFEN) {
    for (let page = 1; ; page++) {
      seitenGrenze(page, { wc, pfad: 'orders' });
      const liste = seitenListe((await wc.get('orders', { status, per_page: BLOCK, page, _fields: ORDER_FELDER })).data, { wc, pfad: 'orders' });
      alle.push(...liste);
      if (liste.length < BLOCK) break;
    }
  }
  return alle;
}

/** Auftraege (nur lesen, ohne automatisches "bestellt"). Zyklischer Import erst zur Laufzeit. */
async function auftraegeLesen() {
  const { leseAuftraege } = await import('./auftraege.js');
  return (await leseAuftraege({ autoBestellen: false })).auftraege ?? [];
}
const tagAus = v => {
  const s = t(v);
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  if (de) return `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};

// ── Abgleich ─────────────────────────────────────────────────────────────────

/**
 * Abgleich: legt fehlende Zeilen an, schreibt nur Hinweise. Knopf (POST /api/dtf/abgleich), Scheduler (/api/intern/dtf-korb/abgleich).
 * @param {object} o { dryRun, quelle, laufId, zwang: Set quellSchluessel ("trotzdem aufnehmen") }
 */
export async function runDtfAbgleich({ sheets: s, ...rest } = {}) {
  return mitDtfSperre(async () => abgleichKern({ ...rest, sheets: s ?? await sheetsClient() }));
}
/**
 * Abgleich unter der schon gehaltenen Sperre. BO5-9: `nurPosition` ("JFN:<Nr>:<Pos>") nimmt aus der gezwungenen Bestellung nur diese
 * Position; `alsLager` legt sie gleich als abgewaehlt mit GRUND_LAGER an ("DTF aus dem Lager" ohne Korb-Zeile).
 */
async function abgleichKern({ dryRun = false, quelle = 'knopf', laufId, zwang = new Set(), nurPosition = '', alsLager = false, sheets, wcFuer = getWcClient, auftraege = auftraegeLesen } = {}) {
  const lauf = laufId ?? `DTF-${new Date().toISOString().slice(0, 16)}Z`;
  {
    const spreadsheetId = ssotId();
    let { korb } = await liesAlles(sheets, spreadsheetId);
    // Trockenlauf geht auch vor dem Setup (leerer Korb) - so laesst sich messen, was der erste Lauf anlegen wuerde
    if (dryRun && (!korb || korb.fehlt.length)) korb = tabelle([KORB_SPALTEN], KORB_SPALTEN);
    brauche(korb, TAB_DTF_KORB);
    const cfg = meterEinstellungen(await leseDtfEinstellungen({ sheets }));
    const { masse } = await leseDruckKontext({ sheets, spreadsheetId });
    const ctx = await shopKontext(sheets, spreadsheetId);

    const kandidaten = [], quellen = new Map();
    // Shop JFN: offene Bestellungen + die, zu denen schon Zeilen stehen (Storno/Abschluss erkennen)
    const wc = wcFuer(SHOP);
    const offen = await ladeOffeneBestellungen(wc);
    const gesehen = new Set(offen.map(o => t(o.id)));
    const nachzulesen = [...new Set(korb.zeilen.filter(z => t(z.Quelle) === QUELLE.JFN && [STATUS.OFFEN, STATUS.ABGEWAEHLT, STATUS.BESTELLT].includes(t(z.Status)))
      .map(z => t(z.Nummer)).filter(n => n && !gesehen.has(n)))];
    const weitere = nachzulesen.length ? await ladeBestellungenNachId(wc, nachzulesen, 'id,status,line_items') : new Map();
    const bestellungen = [...offen.map(o => [t(o.id), o]), ...[...weitere.entries()]];
    let shopPositionen = 0;
    for (const [nr, o] of bestellungen) {
      const zustand = shopZustand(o);
      const positionen = new Map();
      for (const li of o?.line_items ?? []) {
        const e = einstufen(li, ctx);
        positionen.set(t(li.id), { menge: Number(li.quantity) || 0, dtf: e.dtf, druckname: false });
        if (zustand !== 'offen' || !e.dtf) continue;
        shopPositionen += 1;
        kandidaten.push({
          quelle: QUELLE.JFN, nummer: nr, position: t(li.id), datum: o.date_created ? wcTagDE(o.date_created)?.split('.').reverse().join('-') ?? '' : '',
          kuerzel: e.kuerzel, modell: e.modell, farbe: e.farbe, groesse: e.groesse, menge: Number(li.quantity) || 0, express: false, druckname: false,
          druckpositionen: e.kuerzel ? druckpositionenFuer({ bezug: e.kuerzel, groesse: e.groesse, modell: e.modell }, masse) : [],
        });
      }
      quellen.set(quellSchluessel(QUELLE.JFN, nr), { zustand, positionen });
    }
    // Auftraege
    const aus = await auftraege();
    let auPositionen = 0;
    for (const a of aus) {
      const zustand = auZustand(a);
      const positionen = new Map();
      for (const p of a.positionen ?? []) {
        const dtf = istDtf(p.Druck);
        const nachtrag = zustand === 'au_fertig' && nachtragOffen(p);   // AP1
        positionen.set(t(p.Position_ID), { menge: Number(p.Menge) || 0, dtf, druckname: !!t(p.Druckname), ...(nachtrag ? { nachtragOffen: true } : {}) });
        if ((zustand !== 'offen' && !nachtrag) || !dtf) continue;
        auPositionen += 1;
        const info = p.lshop ?? {};
        kandidaten.push({
          quelle: QUELLE.AU, nummer: t(a.Auftrag_Nr), position: t(p.Position_ID), datum: tagAus(p.Nachtrag_Am) || tagAus(a.Angelegt),   // AP1: Nachtrag zaehlt ab seinem Tag
          kuerzel: t(p.Motiv), modell: t(info.modell), farbe: t(info.farbe), groesse: t(info.groesse), menge: Number(p.Menge) || 0,
          express: istJa(a.DTF_Express), druckname: !!t(p.Druckname),
          druckpositionen: t(p.Motiv) || t(p.Druckmasse_Hand) ? druckpositionenFuer({ hand: p.Druckmasse_Hand, bezug: p.Motiv, groesse: info.groesse, modell: info.modell }, masse) : [],
        });
      }
      quellen.set(quellSchluessel(QUELLE.AU, a.Auftrag_Nr), { zustand, positionen });
    }

    const nur = t(nurPosition);
    const nurQs = nur ? nur.split(':').slice(0, 2).join(':') : '';
    const auswahl = nur ? kandidaten.filter(k => quellSchluessel(k.quelle, k.nummer) !== nurQs || `${k.quelle}:${t(k.nummer)}:${t(k.position)}` === nur) : kandidaten;
    const plan = dtfAbgleichPlan({ vorhanden: korb.zeilen, kandidaten: auswahl, quellen, start: cfg.start, zwang,
      alsLager: nur && alsLager ? new Set([nur]) : new Set() });
    const zaehler = { shopPositionen, auPositionen, neu: plan.neu.length, hinweise: plan.hinweise.length, aelter: plan.aelter.length };
    letzterAbgleich = { zeit: new Date().toISOString(), aelter: plan.aelter, zaehler, start: cfg.start };
    if (dryRun) return { lauf, dryRun: true, quelle, ...zaehler, aelter: plan.aelter };

    const jetzt = new Date();
    if (plan.neu.length) {
      const zeilen = plan.neu.map(z => alsZeile(korb.idx, korb.breite, { ...z, Angelegt: berlinDatum(jetzt), Status_Datum: berlinDatum(jetzt), Stand: jetzt.toISOString() }));
      await schreibeNeueZeilen(sheets, spreadsheetId, TAB_DTF_KORB, zeilen, { alt: korb.werte });
    }
    if (plan.hinweise.length) {
      const sp = spalteBuchstabe(korb.idx.Hinweis);
      const daten = plan.hinweise.map(h => ({ range: `'${TAB_DTF_KORB}'!${sp}${h.zeile}`, values: [[h.neu]] }));
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: daten } });
    }
    console.log(`DTF-Abgleich ${lauf} (${quelle}): shop=${shopPositionen} au=${auPositionen} neu=${plan.neu.length} hinweise=${plan.hinweise.length} aelter=${plan.aelter.length}`);
    return { lauf, quelle, ...zaehler, aelter: plan.aelter };
  }
}

// ── Anzeige ──────────────────────────────────────────────────────────────────

async function handJeAus(korb, auftraege) {
  if (!korb.zeilen.some(z => t(z.Quelle) === QUELLE.AU)) return new Map();
  const m = new Map();
  for (const a of await auftraege()) for (const p of a.positionen ?? []) if (t(p.Druckmasse_Hand)) m.set(t(p.Position_ID), t(p.Druckmasse_Hand));
  return m;
}

async function ansichtKontext({ sheets, spreadsheetId, daten, ablage, auftraege, frisch = false }) {
  const { masse } = await leseDruckKontext({ sheets, spreadsheetId });
  const dateien = daten.dateien?.zeilen ?? [];
  const handJe = await handJeAus(daten.korb, auftraege);
  const ids = new Set();
  for (const z of daten.korb.zeilen) {
    if (t(z.Status) !== STATUS.OFFEN) continue;
    const d = dateiFuer(dateien, { bezug: z.Kuerzel, position: z.Druckposition, modell: z.Modell, farbe: z.Textilfarbe, groesse: z.Groesse });
    if (d) ids.add(d.id);
  }
  let dateiInfo = new Map();
  try { dateiInfo = await ablage.dateiInfos([...ids], { frisch }); } catch { dateiInfo = new Map(); }
  return { masse, dateien, handJe, dateiInfo };
}

/** GET /api/dtf/korb -> Zeilen (Live-Ampeln), Bestellungen, Einstellungen fuer die Meter-Schaetzung. */
export async function leseDtfKorb({ sheets: s, ablage = ablageStandard, auftraege = auftraegeLesen, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = ssotId();
  const daten = await liesAlles(sheets, spreadsheetId);
  const einrichtung = { korb: !!daten.korb && !daten.korb.fehlt.length, dateien: !!daten.dateien && !daten.dateien.fehlt.length,
    protokoll: !!daten.protokoll && !daten.protokoll.fehlt.length };
  const cfg = meterEinstellungen(await leseDtfEinstellungen({ sheets }));
  let ablageOk = true;
  try { await ablage.dtfAblageId(); } catch { ablageOk = false; }
  const einstellungen = {
    breiteCm: cfg.breiteCm, verschnitt: cfg.verschnitt, mindestCm: cfg.mindestCm, start: cfg.start, scanBasis: !!scanAdresse(cfg.scanBasis, 'x'),
    tarif: Object.fromEntries(Object.entries(cfg.tarif).map(([k, v]) => [k, v.fehlt?.length || v.doppelt ? { fehlt: true, text: v.text } : { qmBruttoCent: v.qmBruttoCent }])),
  };
  if (!einrichtung.korb) return { einrichtung, ablage: ablageOk, zeilen: [], bestellungen: [], einstellungen, positionen: POSITIONEN, gruende: GRUENDE, lieferarten: LIEFERARTEN };
  const ctx = await ansichtKontext({ sheets, spreadsheetId, daten, ablage, auftraege });
  const zeilen = sichtbareZeilen(daten.korb.zeilen).map(z => zeileAnsicht(z, ctx));
  const bestellungen = (daten.protokoll?.zeilen ?? []).filter(p => t(p.Bestell_ID)).map(p => ({
    id: t(p.Bestell_ID), erstellt: t(p.Erstellt), status: t(p.Status), lieferart: t(p.Lieferart), express: istJa(p.Express),
    positionen: Number(p.Positionen) || 0, stueck: Number(p.Stueck) || 0, laengeCm: Number(p.Laenge_cm) || 0, abgelegt: t(p.Abgelegt),
    geliefert: t(p.Geliefert_Am), hinweis: t(p.Hinweis), haengt: haengt(p, jetzt()),
    nachricht: [BESTELL_STATUS.ABGELEGT, BESTELL_STATUS.GELIEFERT].includes(t(p.Status))
      ? nachrichtAnNico({ id: t(p.Bestell_ID), anzahl: Number(p.Positionen) || 0, laengeCm: Number(p.Laenge_cm) || 0, lieferart: t(p.Lieferart), express: istJa(p.Express), notiz: t(p.Notiz), ersetzt: t(p.Ersetzt) }) : '',
    ersetzt: t(p.Ersetzt),
  })).reverse();
  return {
    einrichtung, ablage: ablageOk, zeilen, bestellungen, einstellungen, positionen: POSITIONEN, gruende: GRUENDE, lieferarten: LIEFERARTEN,
    aelter: letzterAbgleich?.aelter ?? null, abgleich: letzterAbgleich ? { zeit: letzterAbgleich.zeit, ...letzterAbgleich.zaehler } : null,
  };
}

// ── Status von Hand ──────────────────────────────────────────────────────────

/** POST /api/dtf/status { schluessel, ziel offen|abgewählt, grund, notiz, stand } */
export async function setzeDtfStatus({ eingabe = {}, sheets: s, jetzt = () => new Date() } = {}) {
  return mitDtfSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = ssotId();
    const korb = brauche((await liesAlles(sheets, spreadsheetId)).korb, TAB_DTF_KORB);
    const z = korb.zeilen.find(x => t(x.Schluessel) === t(eingabe.schluessel));
    const felder = statusPlan(z, eingabe);
    const zeit = jetzt();
    const alt = korb.werte[z._zeile - 1] ?? [];
    const neu = Array.from({ length: Math.max(alt.length, korb.breite) }, (_, i) => alt[i] ?? '');
    for (const [f, w] of Object.entries({ ...felder, Status_Datum: berlinDatum(zeit), Stand: zeit.toISOString() })) neu[korb.idx[f]] = w;
    await ersetzeZeile(sheets, spreadsheetId, TAB_DTF_KORB, z._zeile, alt, neu);
    return { ok: true, schluessel: t(z.Schluessel), status: felder.Status, stand: zeit.toISOString() };
  });
}

// ── Zuordnen ─────────────────────────────────────────────────────────────────

/** GET /api/dtf/zuordnen?schluessel= -> Zeile, Geschwister (andere Groessen/Farben), schon verwendete Dateien, Entwuerfe (AU). */
export async function zuordnenKontext({ schluessel, sheets: s, ablage = ablageStandard, auftraege = auftraegeLesen } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = ssotId();
  const daten = await liesAlles(sheets, spreadsheetId);
  const korb = brauche(daten.korb, TAB_DTF_KORB);
  const z = korb.zeilen.find(x => t(x.Schluessel) === t(schluessel));
  if (!z) throw fehler('Zeile gibt es nicht mehr.', 404);
  const bezug = t(z.Kuerzel);
  if (!bezug) throw fehler('Für diese Zeile ist kein Kürzel/Motiv bekannt – erst in der Erfassungsmaske bzw. im Auftrag eintragen.', 422, 'bezug');
  const { masse } = await leseDruckKontext({ sheets, spreadsheetId });
  const dateien = daten.dateien?.zeilen ?? [];
  // Geschwister: Shop = alle Varianten der Artikel mit diesem Kuerzel; Auftrag = Positionen desselben Auftrags mit gleichem Motiv
  const geschwister = [];
  const dazu = (modell, farbe, groesse) => {
    if (geschwister.some(g => normBezug(g.modell) === normBezug(modell) && normBezug(g.farbe) === normBezug(farbe) && normBezug(g.groesse) === normBezug(groesse))) return;
    geschwister.push({ modell, farbe, groesse });
  };
  if (t(z.Quelle) === QUELLE.JFN) {
    const ctx = await shopKontext(sheets, spreadsheetId);
    const ssot = new Set(ctx.maskeZeilen.filter(m => normBezug(m.kurz) === normBezug(bezug)).map(m => t(m.id)));
    const modellJe = new Map(ctx.maskeZeilen.map(m => [t(m.id), (t(m.artikelnummer).split('/')[0] ?? '').trim()]));
    for (const v of Object.values(ctx.varMap)) {
      if (!ssot.has(v.ssotId)) continue;
      const { farbe, groesse } = farbeGroesse(v, []);
      dazu(modellJe.get(v.ssotId) ?? '', farbe, groesse);
    }
  } else {
    const a = (await auftraege()).find(x => t(x.Auftrag_Nr) === t(z.Nummer));
    for (const p of a?.positionen ?? []) if (normBezug(p.Motiv) === normBezug(bezug)) dazu(t(p.lshop?.modell), t(p.lshop?.farbe), t(p.lshop?.groesse));
  }
  dazu(t(z.Modell), t(z.Textilfarbe), t(z.Groesse));
  const position = t(z.Druckposition) === '-' ? '' : t(z.Druckposition);
  const mitStand = geschwister.map(g => {
    const m = position ? masseFuer(masse, bezug, g.groesse, g.modell).find(x => normBezug(x.position) === normBezug(position)) : null;
    const d = position ? dateiFuer(dateien, { bezug, position, modell: g.modell, farbe: g.farbe, groesse: g.groesse }) : null;
    return { ...g, eigen: normBezug(g.modell) === normBezug(z.Modell) && normBezug(g.farbe) === normBezug(z.Textilfarbe) && normBezug(g.groesse) === normBezug(z.Groesse),
      mass: m ? { breite: m.breite, hoehe: m.hoehe, fuehrend: m.fuehrend === 'Hoehe' ? 'hoehe' : 'breite' } : null, datei: d ? { id: d.id, name: d.name } : null };
  });
  const ids = [...new Set(dateien.filter(d => istAktiv(d) && normBezug(d.Bezug) === normBezug(bezug) && t(d.Datei_ID)).map(d => t(d.Datei_ID)))];
  let verwendet = [];
  let entwuerfe = [];
  let ablageOk = true;
  try {
    const info = await ablage.dateiInfos(ids);
    verwendet = ids.map(id => ablage.dateiOeffentlich(id, info.get(id))).filter(x => x.da !== false);
    if (t(z.Quelle) === QUELLE.AU) entwuerfe = await ablage.auftragEntwuerfe(t(z.Nummer));
  } catch (err) { if (err?.code === 'dtf_einrichtung') ablageOk = false; else throw err; }
  return {
    schluessel: t(z.Schluessel), quelle: t(z.Quelle), referenz: referenzFuer(z), bezug, position, modell: t(z.Modell), farbe: t(z.Textilfarbe), groesse: t(z.Groesse),
    geschwister: mitStand.sort((a, b) => Number(b.eigen) - Number(a.eigen) || a.modell.localeCompare(b.modell) || a.farbe.localeCompare(b.farbe, 'de')),
    verwendet, entwuerfe, positionen: POSITIONEN, ablage: ablageOk,
  };
}

/**
 * POST /api/dtf/zuordnen - Datei in DTF_Dateien (neu bzw. aktive Zeile gleichen Schluessels ersetzt) und Mass in Druckmasse (DK1-Weg,
 * gleiche Zeile ersetzt). Danach sind alle passenden Korb-Zeilen sofort gruen (Masse/Dateien werden live nachgeschlagen).
 */
export async function zuordnen({ eingabe = {}, sheets: s, ablage = ablageStandard, merke = merkeDruckmasse, jetzt = () => new Date() } = {}) {
  const plan = zuordnenPlan(eingabe);
  if (plan.datei) {
    const info = (await ablage.dateiInfos([plan.datei.id])).get(plan.datei.id);
    if (!info?.da || !['dtf', 'mc'].includes(info.ablage)) throw fehler('Datei nicht gefunden (nur DTF-Ablage bzw. Entwürfe des Auftrags).', 422, 'datei');
    plan.datei.name = info.name;
    for (const z of plan.dateiZeilen) z.Datei_Name = info.name;
  }
  let dateiErgebnis = { neu: 0, ersetzt: 0, schon: 0 };
  if (plan.dateiZeilen.length) {
    dateiErgebnis = await mitDtfSperre(async () => {
      const sheets = s ?? await sheetsClient();
      const spreadsheetId = ssotId();
      const d = brauche((await liesAlles(sheets, spreadsheetId)).dateien, TAB_DTF_DATEIEN);
      const zeit = jetzt();
      const neu = [], erg = { neu: 0, ersetzt: 0, schon: 0 };
      for (const e of plan.dateiZeilen) {
        const alt = d.zeilen.find(x => istAktiv(x) && dateiSchluessel(x) === dateiSchluessel(e));
        if (!alt) { neu.push(alsZeile(d.idx, d.breite, { ...e, Aktiv: 'ja', Angelegt: berlinDatum(zeit), Stand: zeit.toISOString() })); erg.neu += 1; continue; }
        if (t(alt.Datei_ID) === e.Datei_ID) { erg.schon += 1; continue; }
        const r = d.werte[alt._zeile - 1] ?? [];
        const z = Array.from({ length: Math.max(r.length, d.breite) }, (_, i) => r[i] ?? '');
        z[d.idx.Datei_ID] = e.Datei_ID; z[d.idx.Datei_Name] = e.Datei_Name; z[d.idx.Stand] = zeit.toISOString();
        await ersetzeZeile(sheets, spreadsheetId, TAB_DTF_DATEIEN, alt._zeile, r, z);
        erg.ersetzt += 1;
      }
      if (neu.length) await schreibeNeueZeilen(sheets, spreadsheetId, TAB_DTF_DATEIEN, neu, { alt: erg.ersetzt ? undefined : d.werte });
      return erg;
    });
  }
  const massErgebnis = { neu: 0, ersetzt: 0, schon: 0 };
  for (const g of plan.massGruppen) {
    const r = await merke({ eingabe: { bezug: plan.bezug, groesse: g.groesse, modell: g.modell === GROESSE_ALLE ? '' : g.modell, notiz: 'DTF-Zuordnung', ersetzen: true,
      teile: [{ position: plan.position, breite: g.breite, hoehe: g.hoehe, fuehrend: g.fuehrend === 'hoehe' ? 'Hoehe' : 'Breite' }] }, sheets: s });
    massErgebnis.neu += r.neu; massErgebnis.ersetzt += r.ersetzt; massErgebnis.schon += r.schon;
  }
  return { ok: true, datei: dateiErgebnis, mass: massErgebnis };
}

/** POST /api/dtf/datei/hochladen?bezug=&name= (Rohdaten) -> Datei in Motive/<Bezug>/ */
export async function dateiHochladen({ bezug, name, mime, buf, ablage = ablageStandard } = {}) {
  const r = await ablage.ladeMotivHoch({ bezug, name, mime, buf });
  return { ok: true, vorhanden: r.vorhanden, datei: { id: r.id, name: r.name, breitePx: r.px?.breite ?? null, hoehePx: r.px?.hoehe ?? null, ablage: 'dtf', da: true } };
}

// ── Bestellung ───────────────────────────────────────────────────────────────

async function bestellDaten({ sheets, spreadsheetId, ablage, auftraege, frisch }) {
  const daten = await liesAlles(sheets, spreadsheetId);
  brauche(daten.korb, TAB_DTF_KORB);
  brauche(daten.protokoll, TAB_DTF_PROTOKOLL);
  const ctx = await ansichtKontext({ sheets, spreadsheetId, daten, ablage, auftraege, frisch });
  const ansichten = new Map(daten.korb.zeilen.map(z => [t(z.Schluessel), zeileAnsicht(z, ctx)]));
  const cfg = meterEinstellungen(await leseDtfEinstellungen({ sheets }));
  return { daten, ctx, ansichten, cfg };
}
function pruefeErsetzt(ersetzt, protokoll) {
  if (!ersetzt) return;
  const alt = protokoll.zeilen.find(p => t(p.Bestell_ID) === ersetzt);
  if (!alt || ![BESTELL_STATUS.ABGELEGT, BESTELL_STATUS.GELIEFERT].includes(t(alt.Status))) throw fehler(`${ersetzt} gibt es nicht als abgelegte Bestellung.`, 422, 'ersetzt');
}
const offeneSchluessel = protokoll => new Set(protokoll.zeilen.filter(p => [BESTELL_STATUS.WIRD, BESTELL_STATUS.UNKLAR].includes(t(p.Status)))
  .flatMap(p => { try { return JSON.parse(t(p.Posten) || '[]').map(x => x.s); } catch { return []; } }));

function postenFuer(posten, bestellId) {
  return posten.map((p, i) => ({
    druckId: druckIdFuer(bestellId, i), schluessel: p.schluessel, pfad: p.datei.pfad || p.datei.name, dateiId: p.datei.id,
    breite: p.mass.breite, hoehe: p.mass.hoehe, fuehrend: p.mass.fuehrend, menge: p.menge, referenz: p.referenz, kuerzel: p.kuerzel,
    druckposition: p.druckposition, quelle: p.quelle, nummer: p.nummer,
  }));
}

/** POST /api/dtf/bestellung/vorschau { auswahl, lieferart, notiz } - schreibt nichts. */
export async function bestellVorschau({ eingabe = {}, sheets: s, ablage = ablageStandard, auftraege = auftraegeLesen, jetzt = () => new Date() } = {}) {
  const e = bestellEingabe(eingabe);
  const sheets = s ?? await sheetsClient();
  const { daten, ctx, ansichten, cfg } = await bestellDaten({ sheets, spreadsheetId: ssotId(), ablage, auftraege });
  const { posten, probleme, express } = bestellAuswahl(eingabe.auswahl, ansichten);
  const gebunden = offeneSchluessel(daten.protokoll);
  for (const p of posten) if (gebunden.has(p.schluessel)) probleme.push({ schluessel: p.schluessel, text: 'steckt in einer Bestellung, die noch nicht geklärt ist' });
  try { pruefeErsetzt(e.ersetzt, daten.protokoll); } catch (err) { probleme.push({ schluessel: '', text: err.message }); }
  const id = `DTF-${berlinJahr(jetzt())}-____`;
  const pp = postenFuer(posten, id);
  const meter = meterSchaetzung(pp, { breiteCm: cfg.breiteCm, verschnitt: cfg.verschnitt, tarif: cfg.tarif[express ? 'express' : 'normal'], mindestCm: cfg.mindestCm });
  const warnungen = [];
  if (!scanAdresse(cfg.scanBasis, id)) warnungen.push('Scan-Adresse fehlt (Config dtf.scan_basis_url) – die XML bekommt keine QR-Inhalte.');
  let kunden = 0;
  for (const p of pp) {
    if (ctx.dateiInfo.get(p.dateiId)?.ablage !== 'mc') continue;
    kunden += 1;
    p.pfad = `Kunden/${p.nummer}/${p.pfad.split('/').pop()}`;
  }
  if (meter.lohnt === false) warnungen.push(`Noch ${meter.fehltCm} cm bis zur Schwelle (${meter.mindestCm} cm).`);
  const xml = baueDtfXml({ id, datum: berlinDatum(jetzt()), lieferart: e.lieferart, express, notiz: e.notiz, ersetzt: e.ersetzt, laengeCm: meter.laengeCm, breiteCm: cfg.breiteCm, scanBasis: cfg.scanBasis,
    posten: pp });
  return { ok: !probleme.length, probleme, warnungen, express, anzahl: pp.length, stueck: pp.reduce((x, p) => x + p.menge, 0), meter, xml, kundenmotive: kunden };
}

/** Korb-Zeilen + Protokoll nach "liegt" buchen - EIN values.batchUpdate, vorher geprueft, zurueckgelesen. */
async function bucheAbgelegt({ sheets, spreadsheetId, korb, protokoll, pz, posten, xmlId, dateiname, zeit }) {
  const daten = [];
  const probleme = [];
  for (const p of posten) {
    const z = korb.zeilen.find(x => t(x.Schluessel) === p.s);
    if (!z || t(z.Status) !== STATUS.OFFEN) { probleme.push(p.s); continue; }
    const r = Object.entries({ Status: STATUS.BESTELLT, DTF_Bestellung: t(pz.Bestell_ID), Druck_ID: p.d, Breite_cm: p.b ?? '', Hoehe_cm: p.h ?? '',
      Fuehrend: p.f === 'hoehe' ? 'Hoehe' : 'Breite', Datei_ID: p.i, Datei_Pfad: p.p, Status_Datum: berlinDatum(zeit), Stand: zeit.toISOString() });
    for (const [f, w] of r) daten.push({ range: `'${TAB_DTF_KORB}'!${spalteBuchstabe(korb.idx[f])}${z._zeile}`, values: [[w]] });
  }
  if (probleme.length) throw fehler(`Zeilen nicht mehr offen (${probleme.length}) – Bestellung liegt, bitte von Hand prüfen.`, 409, 'nicht_offen');
  for (const [f, w] of Object.entries({ Status: BESTELL_STATUS.ABGELEGT, Datei_ID: xmlId ?? '', Dateiname: dateiname, Abgelegt: zeit.toISOString(), Stand: zeit.toISOString() })) {
    daten.push({ range: `'${TAB_DTF_PROTOKOLL}'!${spalteBuchstabe(protokoll.idx[f])}${pz._zeile}`, values: [[w]] });
  }
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: daten } });
  const { data } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: daten.map(d => d.range), valueRenderOption: 'UNFORMATTED_VALUE' });
  const ab = (data.valueRanges ?? []).filter((vr, i) => zeilenAbweichungen(daten[i].values, vr.values ?? [[]]).length);
  if (ab.length) throw fehler(`Rücklesen weicht ab (${ab.length} Zellen) – bitte Warenkorb_DTF prüfen.`, 500, 'ruecklesen');
}
async function setzeProtokoll({ sheets, spreadsheetId, protokoll, pz, felder }) {
  const alt = protokoll.werte[pz._zeile - 1] ?? [];
  const neu = Array.from({ length: Math.max(alt.length, protokoll.breite) }, (_, i) => alt[i] ?? '');
  for (const [f, w] of Object.entries(felder)) if (protokoll.idx[f] !== undefined) neu[protokoll.idx[f]] = w;
  await ersetzeZeile(sheets, spreadsheetId, TAB_DTF_PROTOKOLL, pz._zeile, alt, neu);
}

/**
 * POST /api/dtf/bestellung/absenden { auswahl, lieferart, notiz }: XML in Bestellungen/, Kundenmotive kopieren, Zeilen -> bestellt.
 * Genau EIN Ablege-Versuch; unklar -> Status "unklar" + Chat, nie automatisch erneut (Knopf "Prüfen").
 */
export async function bestellungAbsenden({ eingabe = {}, sheets: s, ablage = ablageStandard, auftraege = auftraegeLesen, melde = notify, alarm = notifyFehler, jetzt = () => new Date() } = {}) {
  const e = bestellEingabe(eingabe);
  return mitDtfSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = ssotId();
    const { daten, ansichten, cfg } = await bestellDaten({ sheets, spreadsheetId, ablage, auftraege, frisch: true });
    const { posten, probleme, express } = bestellAuswahl(eingabe.auswahl, ansichten);
    const gebunden = offeneSchluessel(daten.protokoll);
    for (const p of posten) if (gebunden.has(p.schluessel)) probleme.push({ schluessel: p.schluessel, text: 'steckt in einer Bestellung, die noch nicht geklärt ist' });
    if (probleme.length) throw Object.assign(fehler('Bestellung so nicht möglich – Liste prüfen.', 422, 'probleme'), { probleme });
    pruefeErsetzt(e.ersetzt, daten.protokoll);
    const zeit = jetzt();
    const id = naechsteBestellId(daten.protokoll.zeilen.map(p => p.Bestell_ID), berlinJahr(zeit));
    const pp = postenFuer(posten, id);
    // antwort-DT1-3: erst ALLE Bilder des Satzes (Motive frisch pruefen, Kundenmotive hochladen + MD5 pruefen), XML ganz zuletzt -
    // die XML ist fuer Nicos Programm das Signal "vollstaendig". Scheitert ein Bild, entsteht keine XML und keine Protokollzeile.
    const info = await ablage.dateiInfos(pp.map(p => p.dateiId), { frisch: true });
    for (const p of pp) {
      const i = info.get(p.dateiId);
      if (!i?.da) throw Object.assign(fehler('Nicht abgelegt: eine Datei fehlt in Drive – Liste prüfen, dann erneut.', 422, 'probleme'), { probleme: [{ schluessel: p.schluessel, text: 'Datei nicht gefunden' }] });
      if (i.ablage === 'mc') {
        if (p.quelle !== QUELLE.AU) throw fehler('Kundenmotiv nur für Aufträge.', 422);
        try {
          const k = await ablage.kopiereKundenmotiv({ id: p.dateiId, auNr: p.nummer });
          p.dateiId = k.id; p.pfad = k.pfad;
        } catch (err) {
          throw fehler(`Nicht abgelegt: Kundenmotiv ${p.referenz} ging nicht hoch (${err.message}). Die Zeilen bleiben offen – bitte erneut.`, err?.status === 409 ? 409 : 502, 'nicht_abgelegt');
        }
      } else p.pfad = i.pfad || p.pfad;
    }
    const meter = meterSchaetzung(pp, { breiteCm: cfg.breiteCm, verschnitt: cfg.verschnitt, tarif: cfg.tarif[express ? 'express' : 'normal'], mindestCm: cfg.mindestCm });
    const xml = baueDtfXml({ id, datum: berlinDatum(zeit), lieferart: e.lieferart, express, notiz: e.notiz, ersetzt: e.ersetzt, laengeCm: meter.laengeCm, breiteCm: cfg.breiteCm, scanBasis: cfg.scanBasis, posten: pp });
    const dateiname = `${id}.xml`;
    const postenJson = JSON.stringify(pp.map(p => ({ s: p.schluessel, d: p.druckId, b: p.breite, h: p.hoehe, f: p.fuehrend, i: p.dateiId, p: p.pfad })));
    const pr = daten.protokoll;
    await schreibeNeueZeilen(sheets, spreadsheetId, TAB_DTF_PROTOKOLL, [alsZeile(pr.idx, pr.breite, {
      Bestell_ID: id, Erstellt: zeit.toISOString(), Status: BESTELL_STATUS.WIRD, Lieferart: e.lieferart, Express: express ? 'ja' : '', Notiz: e.notiz,
      Positionen: pp.length, Stueck: pp.reduce((x, p) => x + p.menge, 0), Laenge_cm: meter.laengeCm, Dateiname: dateiname, Posten: postenJson, Stand: zeit.toISOString(), Ersetzt: e.ersetzt,
    })], { alt: pr.werte });
    const nachher = await liesAlles(sheets, spreadsheetId);
    const pz = nachher.protokoll.zeilen.find(p => t(p.Bestell_ID) === id);
    const r = await ablage.legeXmlAb({ dateiname, inhalt: xml });
    if (r.ergebnis === 'nicht-da') {
      await setzeProtokoll({ sheets, spreadsheetId, protokoll: nachher.protokoll, pz, felder: { Status: BESTELL_STATUS.ABGEBROCHEN, Hinweis: `nicht abgelegt: ${r.grund}`, Stand: new Date().toISOString() } });
      throw fehler(`Nicht abgelegt (${r.grund}) – die Zeilen bleiben offen, bitte noch einmal.`, 502, 'nicht_abgelegt');
    }
    if (r.ergebnis === 'unklar') {
      await setzeProtokoll({ sheets, spreadsheetId, protokoll: nachher.protokoll, pz, felder: { Status: BESTELL_STATUS.UNKLAR, Hinweis: `unklar: ${r.grund}`, Stand: new Date().toISOString() } });
      await alarm({ art: 'DTF-Bestellung', status: 502, text: `${id}: Ablegen unklar (${r.grund}) – in MC „Prüfen“, nicht erneut absenden.`, titel: 'Unklar' });
      throw fehler(`${id}: Ergebnis unklar (${r.grund}). Nicht erneut absenden – „Prüfen“ in der Liste der Bestellungen.`, 502, 'unklar');
    }
    await bucheAbgelegt({ sheets, spreadsheetId, korb: nachher.korb, protokoll: nachher.protokoll, pz, posten: JSON.parse(postenJson), xmlId: r.id, dateiname, zeit: new Date() });
    await melde(chatText({ id, laengeCm: meter.laengeCm, lieferart: e.lieferart, express }));
    console.log(`DTF-Bestellung ${id}: abgelegt (${pp.length} Motive, ${meter.laengeCm} cm)`);
    return { ok: true, id, anzahl: pp.length, laengeCm: meter.laengeCm, nachricht: nachrichtAnNico({ id, anzahl: pp.length, laengeCm: meter.laengeCm, lieferart: e.lieferart, express, notiz: e.notiz, ersetzt: e.ersetzt }) };
  });
}

/** POST /api/dtf/bestellung/pruefen { id } - bei "unklar" bzw. haengendem "wird abgelegt": liegt die XML? Dann buchen, sonst abgebrochen. */
export async function bestellungPruefen({ id, sheets: s, ablage = ablageStandard, melde = notify, jetzt = () => new Date() } = {}) {
  if (!BESTELL_ID_RE.test(t(id))) throw fehler('Bestellung unbekannt.', 404);
  return mitDtfSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = ssotId();
    const d = await liesAlles(sheets, spreadsheetId);
    const pr = brauche(d.protokoll, TAB_DTF_PROTOKOLL);
    const pz = pr.zeilen.find(p => t(p.Bestell_ID) === t(id));
    if (!pz) throw fehler('Bestellung unbekannt.', 404);
    if (!(t(pz.Status) === BESTELL_STATUS.UNKLAR || haengt(pz, jetzt()))) throw fehler('Nur unklare oder hängende Bestellungen lassen sich prüfen.', 409, 'status');
    const f = await ablage.findeXml(t(pz.Dateiname) || `${id}.xml`);
    if (!f.liegt) {
      await setzeProtokoll({ sheets, spreadsheetId, protokoll: pr, pz, felder: { Status: BESTELL_STATUS.ABGEBROCHEN, Hinweis: 'geprüft: nicht abgelegt', Stand: jetzt().toISOString() } });
      return { ok: true, id, ergebnis: 'abgebrochen' };
    }
    const posten = JSON.parse(t(pz.Posten) || '[]');
    await bucheAbgelegt({ sheets, spreadsheetId, korb: brauche(d.korb, TAB_DTF_KORB), protokoll: pr, pz, posten, xmlId: f.id, dateiname: t(pz.Dateiname), zeit: jetzt() });
    await melde(chatText({ id, laengeCm: Number(pz.Laenge_cm) || 0, lieferart: t(pz.Lieferart), express: istJa(pz.Express) }));
    return { ok: true, id, ergebnis: 'abgelegt', nachricht: nachrichtAnNico({ id, anzahl: posten.length, laengeCm: Number(pz.Laenge_cm) || 0, lieferart: t(pz.Lieferart), express: istJa(pz.Express), notiz: t(pz.Notiz) }) };
  });
}

/** POST /api/dtf/bestellung/geliefert { id } - "DTF-Lieferung da": Zeilen bestellt -> geliefert, Protokoll geliefert. */
export async function lieferungDa({ id, sheets: s, jetzt = () => new Date() } = {}) {
  if (!BESTELL_ID_RE.test(t(id))) throw fehler('Bestellung unbekannt.', 404);
  return mitDtfSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = ssotId();
    const d = await liesAlles(sheets, spreadsheetId);
    const korb = brauche(d.korb, TAB_DTF_KORB), pr = brauche(d.protokoll, TAB_DTF_PROTOKOLL);
    const pz = pr.zeilen.find(p => t(p.Bestell_ID) === t(id));
    if (!pz) throw fehler('Bestellung unbekannt.', 404);
    if (t(pz.Status) !== BESTELL_STATUS.ABGELEGT) throw fehler('Nur abgelegte Bestellungen lassen sich als geliefert markieren.', 409, 'status');
    const zeit = jetzt();
    const daten = [];
    let n = 0;
    for (const z of korb.zeilen.filter(x => t(x.DTF_Bestellung) === t(id) && t(x.Status) === STATUS.BESTELLT)) {
      n += 1;
      for (const [f, w] of Object.entries({ Status: STATUS.GELIEFERT, Status_Datum: berlinDatum(zeit), Stand: zeit.toISOString() }))
        daten.push({ range: `'${TAB_DTF_KORB}'!${spalteBuchstabe(korb.idx[f])}${z._zeile}`, values: [[w]] });
    }
    for (const [f, w] of Object.entries({ Status: BESTELL_STATUS.GELIEFERT, Geliefert_Am: berlinDatum(zeit), Stand: zeit.toISOString() }))
      daten.push({ range: `'${TAB_DTF_PROTOKOLL}'!${spalteBuchstabe(pr.idx[f])}${pz._zeile}`, values: [[w]] });
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: daten } });
    return { ok: true, id, zeilen: n };
  });
}

// ── Scan (QR) ────────────────────────────────────────────────────────────────

const vorname = v => t(v).split(/\s+/)[0] ?? '';
/** GET /api/dtf/scan/:id - Druck-ID oder Bestell-ID; nur MC (API-Key). Vorname nur hier, nie in XML/QR/Log. */
export async function scan({ id, sheets: s, wcFuer = getWcClient, auftraege = auftraegeLesen } = {}) {
  const k = t(id);
  if (!DRUCK_ID_RE.test(k) && !BESTELL_ID_RE.test(k)) throw fehler('Unbekannte Kennung.', 404);
  const sheets = s ?? await sheetsClient();
  const korb = brauche((await liesAlles(sheets, ssotId())).korb, TAB_DTF_KORB);
  const zeilen = korb.zeilen.filter(z => (DRUCK_ID_RE.test(k) ? t(z.Druck_ID) === k : t(z.DTF_Bestellung) === k))
    .sort((a, b) => t(a.Druck_ID).localeCompare(t(b.Druck_ID)));
  if (!zeilen.length) throw fehler('Zu dieser Kennung gibt es nichts (mehr).', 404);
  const fuer = new Map();
  const shop = [...new Set(zeilen.filter(z => t(z.Quelle) === QUELLE.JFN).map(z => t(z.Nummer)))];
  if (shop.length) {
    try {
      const m = await ladeBestellungenNachId(wcFuer(SHOP), shop, 'id,billing');
      for (const [nr, o] of m) if (o) fuer.set(`${QUELLE.JFN}:${nr}`, vorname(o.billing?.first_name));
    } catch { /* ohne Vorname */ }
  }
  if (zeilen.some(z => t(z.Quelle) === QUELLE.AU)) {
    try { for (const a of await auftraege()) fuer.set(`${QUELLE.AU}:${t(a.Auftrag_Nr)}`, t(a.Kurztitel)); } catch { /* ohne */ }
  }
  return {
    id: k, art: DRUCK_ID_RE.test(k) ? 'motiv' : 'bestellung', bestellung: t(zeilen[0].DTF_Bestellung),
    motive: zeilen.map(z => ({
      druckId: t(z.Druck_ID), quelle: t(z.Quelle), nummer: t(z.Nummer), referenz: referenzFuer(z), kuerzel: t(z.Kuerzel), druckposition: t(z.Druckposition),
      modell: t(z.Modell), farbe: t(z.Textilfarbe), groesse: t(z.Groesse), menge: Number(z.Menge) || 0, status: t(z.Status),
      fuer: fuer.get(`${t(z.Quelle)}:${t(z.Nummer)}`) ?? '',
    })),
  };
}

// ── Auftraege: "Druck bestellt" je Position ──────────────────────────────────

/** Position_ID -> { status: bestellt|geliefert, bestellung } (nur AU-Zeilen ab bestellt). Fehlt der Reiter: leer. */
export async function leseDtfJeAuPosition({ sheets, spreadsheetId = ssotId() } = {}) {
  const w = await liesTab(sheets, spreadsheetId, TAB_DTF_KORB).catch(() => null);
  const k = tabelle(w, KORB_SPALTEN);
  const m = new Map();
  if (!k || k.fehlt.length) return m;
  for (const z of k.zeilen) {
    if (t(z.Quelle) !== QUELLE.AU) continue;
    // BO5-9: "DTF aus dem Lager" heisst im Auftrag "schon da" (nur wenn keine Zeile der Position bestellt ist)
    if (istLagerZeile(z)) { if (!m.has(t(z.Position))) m.set(t(z.Position), { status: 'schon da', bestellung: '' }); continue; }
    if (![STATUS.BESTELLT, STATUS.GELIEFERT].includes(t(z.Status))) continue;
    const alt = m.get(t(z.Position));
    if (!alt || alt.status === 'schon da' || (alt.status === STATUS.GELIEFERT && t(z.Status) === STATUS.BESTELLT)) m.set(t(z.Position), { status: t(z.Status), bestellung: t(z.DTF_Bestellung) });
  }
  return m;
}

// ── BO5-9 Teil B: DTF-Stand in der Bestellkarte ──────────────────────────────

/** Fuer die Bestellansicht: Stand je "JFN:<Nr>:<Pos>" aus Warenkorb_DTF. Reiter fehlt -> einrichtung false (Knoepfe aus, mit Grund). */
/**
 * LG1: Zeilen des DTF-Korbs fuer "Fertigware aus Lager" (lib/lagerFertig.js) - nur lesen, unter dessen Sperren.
 * @returns {{ einrichtung: boolean, idx, zeilen, hatAusLager }}
 */
export async function leseDtfKorbZeilen({ sheets, spreadsheetId = ssotId() } = {}) {
  const k = (await liesAlles(sheets, spreadsheetId)).korb;
  if (!k || k.fehlt.length) return { einrichtung: false, idx: {}, zeilen: [], hatAusLager: false };
  return { einrichtung: true, idx: k.idx, zeilen: k.zeilen, hatAusLager: k.idx.Aus_Lager !== undefined };
}

export async function leseDtfJePosition({ sheets, spreadsheetId = ssotId() } = {}) {
  const w = await liesTab(sheets, spreadsheetId, TAB_DTF_KORB);
  const k = tabelle(w, KORB_SPALTEN);
  if (!k || k.fehlt.length) return { einrichtung: false, je: new Map() };
  return { einrichtung: true, je: dtfStandJePosition(k.zeilen.filter(z => t(z.Quelle) === QUELLE.JFN)) };
}

/**
 * POST /api/dtf/karte { nummer, position, ziel: bestellen|lager, gesehen: [{ schluessel, stand }] } - die Knoepfe der Bestellkarte.
 * Derselbe Schreibweg wie "abwählen"/"zurückholen" im Korb (Sperre, frisch gelesen, ersetzeZeile mit Vorher-Pruefung). Ohne
 * Korb-Zeile: "bestellen" = wie "trotzdem aufnehmen" (ganze Bestellung), "lager" = nur diese Position, gleich abgewaehlt.
 * Gibt den neuen Stand der Position zurueck.
 */
export async function setzeDtfKarte({ eingabe = {}, sheets: s, wcFuer = getWcClient, auftraege = auftraegeLesen, jetzt = () => new Date() } = {}) {
  const nummer = t(eingabe.nummer), position = t(eingabe.position), ziel = t(eingabe.ziel);
  if (!/^\d{1,12}$/.test(nummer) || !/^\d{1,12}$/.test(position)) throw fehler('Bestellung/Position unbekannt.');
  if (![DTF_STAND.BESTELLEN, DTF_STAND.LAGER].includes(ziel)) throw fehler('Ziel unbekannt.');
  const posKey = `${QUELLE.JFN}:${nummer}:${position}`;
  return mitDtfSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = ssotId();
    const zeilenDerPosition = async () => {
      const korb = brauche((await liesAlles(sheets, spreadsheetId)).korb, TAB_DTF_KORB);
      return { korb, zeilen: korb.zeilen.filter(z => positionsSchluessel(z) === posKey) };
    };
    let { korb, zeilen } = await zeilenDerPosition();
    let angelegt = 0;
    if (!zeilen.length) {
      const r = await abgleichKern({ sheets, quelle: 'karte', zwang: new Set([`${QUELLE.JFN}:${nummer}`]), wcFuer, auftraege,
        ...(ziel === DTF_STAND.LAGER ? { nurPosition: posKey, alsLager: true } : {}) });
      ({ korb, zeilen } = await zeilenDerPosition());
      angelegt = r.neu ?? 0;
      if (!zeilen.length) throw fehler('Für diese Position legt der DTF-Korb keine Zeile an (kein DTF-Druck, Trikot oder Bestellung nicht offen).', 422, 'kein_dtf');
      if (ziel === DTF_STAND.BESTELLEN || zeilen.every(istLagerZeile)) {
        return { ok: true, angelegt, dtf: dtfStandJePosition(zeilen).get(posKey) };
      }
    }
    const plan = dtfKartenPlan(zeilen, { ziel, gesehen: angelegt ? zeilen.map(z => ({ schluessel: z.Schluessel, stand: z.Stand })) : eingabe.gesehen });
    const zeit = jetzt();
    for (const { schluessel, felder } of plan) {
      const z = zeilen.find(x => t(x.Schluessel) === schluessel);
      const alt = korb.werte[z._zeile - 1] ?? [];
      const neu = Array.from({ length: Math.max(alt.length, korb.breite) }, (_, i) => alt[i] ?? '');
      for (const [f, w] of Object.entries({ ...felder, Status_Datum: berlinDatum(zeit), Stand: zeit.toISOString() })) neu[korb.idx[f]] = w;
      await ersetzeZeile(sheets, spreadsheetId, TAB_DTF_KORB, z._zeile, alt, neu);
    }
    if (plan.length) ({ zeilen } = await zeilenDerPosition());
    console.log(`DTF-Karte ${posKey}: ${ziel}, ${plan.length} Zeile(n)${angelegt ? `, ${angelegt} angelegt` : ''}`);
    return { ok: true, angelegt, geaendert: plan.length, dtf: dtfStandJePosition(zeilen).get(posKey) };
  });
}

// ── "Was fehlt" ──────────────────────────────────────────────────────────────

let verkaufCache = null;   // { zeit, map }
const VERKAUF_MS = 30 * 60 * 1000;
/** Stueck je Kuerzel/Modell/Farbe/Groesse der letzten 90 Tage (JFN, 30 min zwischengespeichert). */
async function verkauft90({ sheets, spreadsheetId, wcFuer }) {
  if (verkaufCache && Date.now() - verkaufCache.zeit < VERKAUF_MS) return verkaufCache.map;
  const ctx = await shopKontext(sheets, spreadsheetId);
  const wc = wcFuer(SHOP);
  const after = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 19);
  const map = new Map();
  for (const status of ['processing', 'on-hold', 'completed']) {
    for (let page = 1; ; page++) {
      seitenGrenze(page, { wc, pfad: 'orders' });
      const liste = seitenListe((await wc.get('orders', { status, after, per_page: BLOCK, page, _fields: 'id,line_items' })).data, { wc, pfad: 'orders' });
      for (const o of liste) for (const li of o.line_items ?? []) {
        const e = einstufen(li, ctx);
        if (!e.dtf || !e.kuerzel) continue;
        const k = verkaufSchluessel(e.kuerzel, e.modell, e.farbe, e.groesse);
        map.set(k, (map.get(k) ?? 0) + (Number(li.quantity) || 0));
      }
      if (liste.length < BLOCK) break;
    }
  }
  verkaufCache = { zeit: Date.now(), map };
  return map;
}
/** GET /api/dtf/was-fehlt */
export async function leseWasFehlt({ sheets: s, ablage = ablageStandard, auftraege = auftraegeLesen, wcFuer = getWcClient } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = ssotId();
  const daten = await liesAlles(sheets, spreadsheetId);
  brauche(daten.korb, TAB_DTF_KORB);
  const ctx = await ansichtKontext({ sheets, spreadsheetId, daten, ablage, auftraege });
  const ansichten = sichtbareZeilen(daten.korb.zeilen).map(z => zeileAnsicht(z, ctx));
  let verkauft = new Map(), verkaufHinweis = '';
  try { verkauft = await verkauft90({ sheets, spreadsheetId, wcFuer }); } catch (err) {
    if (err?.code === 'hoster_pruefseite') throw err;
    verkaufHinweis = 'Verkäufe der letzten 90 Tage gerade nicht lesbar.';
  }
  return { liste: wasFehlt(ansichten, verkauft), verkaufHinweis };
}

// ── Setup ────────────────────────────────────────────────────────────────────

/**
 * Einrichtung (scripts/setup-dtf-korb.js): drei Reiter im SSOT, Config dtf.start_datum (= heute, Berlin), dtf.mindest_laenge_cm (leer),
 * dtf.scan_basis_url (leer), Spalte Druckart hinten in Motive, Ordner in der DTF-Ablage. Idempotent, schreibt nur mit write.
 */
export async function richteDtfKorbEin({ write = false, sheets: s, ablage = ablageStandard, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const ssot = ssotId(), business = process.env.BUSINESS_SHEET_ID;
  if (!ssot || !business) throw new Error('GOOGLE_SHEET_ID / BUSINESS_SHEET_ID fehlen.');
  const plan = [];
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: ssot, fields: 'sheets.properties.title' });
  const titel = new Set(meta.sheets.map(x => x.properties.title));
  const reiter = [[TAB_DTF_KORB, KORB_SPALTEN], [TAB_DTF_DATEIEN, DATEI_SPALTEN], [TAB_DTF_PROTOKOLL, PROTOKOLL_SPALTEN]];
  const anlegen = [];
  for (const [tab, spalten] of reiter) {
    if (!titel.has(tab)) { plan.push(`Reiter ${tab} anlegen + Kopfzeile (${spalten.length} Spalten)`); anlegen.push([tab, spalten]); continue; }
    const kopf = ((await sheets.spreadsheets.values.get({ spreadsheetId: ssot, range: `'${tab}'!1:1` })).data.values ?? [[]])[0] ?? [];
    if (!kopf.length) { plan.push(`Kopfzeile ${tab} schreiben`); anlegen.push([tab, spalten, true]); continue; }
    const fehlt = spalten.filter(x => !kopf.map(normHeader).includes(normHeader(x)));
    if (fehlt.length) throw new Error(`${tab} hat eine andere Kopfzeile (fehlt: ${fehlt.join(', ')}) – bitte von Hand prüfen.`);
  }
  // Motive: optionale Spalte Druckart hinten
  const mk = ((await sheets.spreadsheets.values.get({ spreadsheetId: ssot, range: `'${TAB_MOTIVE}'!1:1` })).data.values ?? [[]])[0] ?? [];
  const druckartFehlt = mk.length && !mk.map(normHeader).includes(normHeader('Druckart'));
  if (druckartFehlt) plan.push(`Spalte Druckart hinten in ${TAB_MOTIVE} (leer = DTF)`);
  // Config
  const { data: c } = await sheets.spreadsheets.values.get({ spreadsheetId: business, range: `'${TAB_CONFIG}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const [ck = [], ...cz] = c.values ?? [];
  const iS = ck.map(normHeader).indexOf(normHeader('Schlüssel')), iW = ck.map(normHeader).indexOf(normHeader('Wert'));
  if (iS < 0 || iW < 0) throw new Error('Config: Spalten Schlüssel/Wert fehlen.');
  const vorhanden = new Set(cz.map(r => t(r[iS])));
  const vorgabe = { [CONFIG.start]: berlinDatum(jetzt()), [CONFIG.mindest]: '', [CONFIG.scanBasis]: '' };
  const configNeu = Object.entries(vorgabe).filter(([k]) => !vorhanden.has(k)).map(([k, w]) => {
    const r = Array.from({ length: Math.max(iS, iW) + 1 }, () => '');
    r[iS] = k; r[iW] = w;
    return r;
  });
  for (const r of configNeu) plan.push(`Config-Zeile ${r[iS]} = ${r[iW] === '' ? '(leer – Inhaber trägt ein)' : r[iW]}`);
  let drive = [];
  try { drive = await ablage.richteDtfAblageEin({ write }); } catch (err) { drive = [`✗ DTF-Ablage: ${err.message}`]; }
  if (!write) return { plan, drive, geschrieben: false };
  if (anlegen.some(([, , nurKopf]) => !nurKopf)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: ssot, requestBody: { requests: anlegen.filter(([, , nurKopf]) => !nurKopf)
      .map(([tab]) => ({ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } })) } });
  }
  for (const [tab, spalten] of anlegen) {
    await sheets.spreadsheets.values.update({ spreadsheetId: ssot, range: `'${tab}'!A1`, valueInputOption: 'RAW', requestBody: { values: [spalten] } });
  }
  if (druckartFehlt) {
    const ziel = `'${TAB_MOTIVE}'!${spalteBuchstabe(mk.length)}1`;
    const vorher = (await sheets.spreadsheets.values.get({ spreadsheetId: ssot, range: ziel })).data.values ?? [];
    if ((vorher[0] ?? []).some(v => t(v))) throw new Error(`${ziel} ist nicht leer – bitte von Hand prüfen.`);
    await sheets.spreadsheets.values.update({ spreadsheetId: ssot, range: ziel, valueInputOption: 'RAW', requestBody: { values: [['Druckart']] } });
  }
  if (configNeu.length) await schreibeNeueZeilen(sheets, business, TAB_CONFIG, configNeu, { alt: c.values ?? [] });
  return { plan, drive, geschrieben: true };
}
