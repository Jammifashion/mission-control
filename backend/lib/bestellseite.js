// Bestellseite per Token (KS1): Reiter Bestellseiten, Bestell_Termine, Bestell_Bilder im SSOT (GOOGLE_SHEET_ID).
// Logik in utils/bestellseite.js. Katalog nur aus dem SSOT (Kategorien, Maske, Varianten, LShop_Modelle, Lieferbarkeit) plus
// Bild-URLs aus dem Zwischenspeicher Bestell_Bilder - die oeffentliche Seite greift NIE in den Shop (Hoster-Schutz).
// Den Zwischenspeicher fuellt nur der MC-Knopf "Artikelliste aktualisieren" (getWcClient, 2-s-Takt, nacheinander).
//
// Schreiben: eine Sperre je Instanz, frisch gelesen (UNFORMATTED), kein values.append (pruefeZielStrecke/ersetzeZeile),
// zurueckgelesen. Token-Klartext verlaesst diese Datei nur in der Antwort an MC (einmal), nie ins Sheet, nie ins Log.
// Log: nur Zugang_ID, Zahlen.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { pruefeZielStrecke, ersetzeZeile, zeilenAbweichungen, spalteBuchstabe } from './sheet-zeilen.js';
import { leseReiterSpalten } from './ssot-reiter.js';
import { leseLieferbarkeit } from './lieferbarkeitLesen.js';
import { ladeLShopZeilen, lshopAuswertung } from './lshop.js';
import { liesAuftraege, lshopInfo, nummernAus } from './auftraege.js';
import { leseKunden } from './kunden.js';
import { getWcClient } from './shopConfig.js';
import { seitenGrenze, seitenListe } from './hosterPruefseite.js';
import { zeilenAus, aktivePositionen } from '../utils/auftraege.js';
import {
  TAB_ZUGAENGE, TAB_TERMINE, TAB_EINTRAEGE, TAB_BILDER, ZUGANG_SPALTEN, ZUGANG_OPTIONAL, ZUGANG_ALLE, TERMIN_SPALTEN, BILD_SPALTEN,
  ART, STATUS, fehler, erzeugeToken, tokenHash, findeZugang, zugangStatus, anlagePlan, bearbeitenPlan, katalogDauer, katalogAuftrag,
  seitenAntwort, zugangFuerMc, sortimentNamen,
} from '../utils/bestellseite.js';

const t = v => String(v ?? '').trim();
const KATALOG_MS = 5 * 60 * 1000;
export const TAKT_MS = 2000;
let katalogCache = new Map();   // Zugang_ID|Stand -> { zeit, daten }
export function _bestellseiteCacheLeeren() { katalogCache = new Map(); }

let laeuft = false;
async function mitSperre(fn) {
  if (laeuft) throw fehler('Bestellseiten werden gerade gespeichert – gleich noch einmal.', 409, 'laeuft_gerade');
  laeuft = true;
  try { return await fn(); } finally { laeuft = false; katalogCache = new Map(); }
}
async function sheetsClient() { return google.sheets({ version: 'v4', auth: await getGoogleAuth() }); }
function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  return id;
}
const istFehlenderReiter = err => err?.code === 400 || err?.response?.status === 400;

/** Zugaenge + Termine frisch lesen. Fehlen Reiter/Spalten -> 409 einrichtung. */
async function lies(sheets, spreadsheetId) {
  let data;
  try {
    ({ data } = await sheets.spreadsheets.values.batchGet({
      spreadsheetId, ranges: [`'${TAB_ZUGAENGE}'`, `'${TAB_TERMINE}'`], valueRenderOption: 'UNFORMATTED_VALUE',
    }));
  } catch (err) {
    if (istFehlenderReiter(err)) throw fehler('Reiter Bestellseiten/Bestell_Termine fehlen – scripts/setup-bestellseiten-reiter.js --write.', 409, 'einrichtung');
    throw err;
  }
  const [wz = [], wt = []] = (data.valueRanges ?? []).map(v => v.values ?? []);
  const z = zeilenAus(wz, ZUGANG_SPALTEN, 'Zugang_ID', ZUGANG_OPTIONAL);
  const tr = zeilenAus(wt, TERMIN_SPALTEN, 'Termin_ID');
  if (!wz.length || !wt.length || z.fehlt.length || tr.fehlt.length) {
    throw fehler(`Spalten fehlen (${[...z.fehlt, ...tr.fehlt].join(', ') || 'Kopfzeile'}) – scripts/setup-bestellseiten-reiter.js.`, 409, 'einrichtung');
  }
  return { wz, wt, z, tr };
}

const alsZeile = (idx, obj, breite) => {
  const z = Array.from({ length: breite }, () => '');
  for (const s of ZUGANG_ALLE.concat(TERMIN_SPALTEN)) if (idx[s] !== undefined && obj[s] !== undefined) z[idx[s]] = obj[s];
  return z;
};

/** Neue Zeilen in mehreren Reitern in EINEM batchUpdate, danach zurueckgelesen. */
async function schreibeBloecke(sheets, spreadsheetId, bloecke) {
  const data = [], strecken = [];
  for (const b of bloecke.filter(x => x.zeilen.length)) {
    const s = await pruefeZielStrecke(sheets, spreadsheetId, b.tab, b.alt, b.zeilen);
    strecken.push({ ...b, ...s });
    data.push({ range: s.range, values: b.zeilen });
  }
  if (!data.length) return;
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  const { data: zurueck } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId, ranges: strecken.map(s => s.range), valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const ab = strecken.reduce((n, s, i) => n + zeilenAbweichungen(s.zeilen, zurueck.valueRanges?.[i]?.values ?? []).length, 0);
  if (ab) throw fehler(`Bestellseiten: Rücklesen weicht in ${ab} Zelle(n) ab – bitte prüfen.`, 500, 'ruecklesen');
}

// ── SSOT-Stammdaten (nur lesen) ──────────────────────────────────────────────

export const leseKategorien = sheets => leseReiterSpalten({
  tab: 'Struktur_Kategorien', spalten: { nr: 'Kategorienummer', pfad: 'Kategorien', name: 'Kategoriename' }, sheets,
});
const leseMaske = sheets => leseReiterSpalten({
  tab: 'Erfassungsmaske', spalten: { id: 'ID', status: 'Status Shop', produktId: 'Produkt-ID', name: 'Produktname', kategorien: 'Kategorien' }, sheets,
});
const leseVarianten = sheets => leseReiterSpalten({
  tab: 'Varianten',
  spalten: { ssotId: 'SSOT-ID', E1: 'E1', V1: 'V1', aktiv: 'Aktiv', wcId: 'WC_Variation_ID' },
  optional: { E2: 'E2', V2: 'V2', E3: 'E3', V3: 'V3', articleNr: 'LShop_ArticleNr' }, sheets,
});

/** Bild-Zwischenspeicher: WC_ID -> { url, status }. Fehlt der Reiter: leer (Seite ohne Bilder). */
export async function leseBilder(sheets, spreadsheetId) {
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_BILDER}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    const r = zeilenAus(data.values ?? [], BILD_SPALTEN, 'WC_ID');
    if (r.fehlt.length) return { je: new Map(), stand: '' };
    const je = new Map(r.zeilen.map(x => [x.WC_ID, { url: x.Bild_URL, status: x.Status }]));
    const stand = r.zeilen.map(x => x.Stand).filter(Boolean).sort().at(-1) ?? '';
    return { je, stand, werte: data.values ?? [] };
  } catch (err) {
    if (istFehlenderReiter(err)) return { je: new Map(), stand: '' };
    throw err;
  }
}

// ── Katalog je Zugang ────────────────────────────────────────────────────────

async function katalogFuer(sheets, spreadsheetId, zugang) {
  const k = `${zugang.Zugang_ID}|${zugang.Stand}`;
  const c = katalogCache.get(k);
  if (c && Date.now() - c.zeit < KATALOG_MS) return c.daten;
  const lb = await leseLieferbarkeit({ sheets, spreadsheetId });
  let daten;
  if (zugang.Art === ART.DAUER) {
    const [kategorien, maske, varianten, bilder] = [await leseKategorien(sheets), await leseMaske(sheets), await leseVarianten(sheets), await leseBilder(sheets, spreadsheetId)];
    daten = { artikel: katalogDauer({ sortiment: zugang.Sortiment, kategorien, maske, varianten, lieferbarkeit: lb.je, bilder: bilder.je }), stand: bilder.stand };
  } else {
    const { a, p } = await liesAuftraege(sheets, spreadsheetId);
    const auftrag = a.zeilen.find(x => x.Auftrag_Nr === zugang.Auftrag_Nr);
    if (!auftrag) throw fehler('Diese Bestellseite gibt es nicht mehr.', 403, 'weg');
    const pos = aktivePositionen(p.zeilen, auftrag.Auftrag_Nr);
    const { info } = await lshopInfo(sheets, spreadsheetId, nummernAus(pos));
    const groessenJe = await groessenJeGruppe(sheets, spreadsheetId, pos, info, lb.je);
    daten = { artikel: katalogAuftrag({ auftrag, positionen: pos, info, groessenJe }), stand: '', auftrag };
  }
  katalogCache.set(k, { zeit: Date.now(), daten });
  return daten;
}

/** Fuer jede Gruppe Modell + Farbe des Auftrags: alle waehlbaren Groessen des Modells in dieser Farbe (LShop_Modelle). */
async function groessenJeGruppe(sheets, spreadsheetId, positionen, info, lieferbarkeit) {
  const modelle = new Set(positionen.map(p => info.get(t(p.LShop_ArticleNr))?.modell).filter(Boolean));
  if (!modelle.size) return new Map();
  const zeilen = await ladeLShopZeilen({ sheets, spreadsheetId });
  const aus = new Map();
  for (const m of modelle) {
    const a = lshopAuswertung(zeilen.filter(z => z.catalogNr === m), { lieferbarkeit });
    for (const v of a.varianten) {
      const k = `${m}|${v.farbe}`;
      if (!aus.has(k)) aus.set(k, []);
      aus.get(k).push({ articleNr: v.articleNr, groesse: v.groesse, lieferbar: v.lieferbar?.stufe ?? '' });
    }
  }
  return aus;
}

// ── Oeffentlich: GET /api/bestellseite/zugang ────────────────────────────────

/** Token pruefen und die Seite liefern. Unbekannt 401, gesperrt/abgelaufen 403 (freundlicher Text). */
export async function leseSeite({ token, sheets: s, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  let daten;
  try { daten = await lies(sheets, spreadsheetId); } catch (err) {
    if (err.code === 'einrichtung') throw fehler('Bestellseite nicht gefunden.', 401, 'unbekannt');
    throw err;
  }
  const zugang = findeZugang(daten.z.zeilen, token);
  if (!zugang) throw fehler('Bestellseite nicht gefunden.', 401, 'unbekannt');
  const st = zugangStatus(zugang, jetzt());
  if (st === STATUS.GESPERRT) throw fehler('Diese Bestellseite ist gesperrt. Bitte bei JammiFashion melden.', 403, 'gesperrt');
  if (st === STATUS.ABGELAUFEN) throw fehler('Dieser Link ist abgelaufen. Bitte bei JammiFashion einen neuen anfordern.', 403, 'abgelaufen');
  const k = await katalogFuer(sheets, spreadsheetId, zugang);
  let termine = daten.tr.zeilen.filter(x => x.Zugang_ID === zugang.Zugang_ID);
  // Art auftrag: das Datum fuehrt der Auftrag (Termin), die Termin-Zeile traegt die ID.
  if (zugang.Art === ART.AUFTRAG && k.auftrag) termine = termine.map(x => ({ ...x, Datum: /^\d{4}-\d{2}-\d{2}$/.test(t(k.auftrag.Termin)) ? t(k.auftrag.Termin) : x.Datum }));
  const designLink = zugang.Art === ART.AUFTRAG && t(zugang.Design_Link_Zeigen) === 'ja' ? t(k.auftrag?.Design_Link) : '';
  return seitenAntwort({ zugang, termine, artikel: k.artikel, designLink, katalogStand: k.stand });
}

// ── MC: Liste, Anlegen, Bearbeiten, neuer Link ───────────────────────────────

export async function leseZugaenge({ sheets: s, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  const { z, tr } = await lies(sheets, spreadsheetId);
  const bilder = await leseBilder(sheets, spreadsheetId);
  return {
    zugaenge: z.zeilen.map(x => zugangFuerMc(x, jetzt(), tr.zeilen)).sort((a, b) => b.Zugang_ID.localeCompare(a.Zugang_ID)),
    bilderStand: bilder.stand, bilderAnzahl: bilder.je.size,
    spalten: { designLink: z.idx.Design_Link_Zeigen !== undefined },
  };
}

const kundeDaAus = kunden => nr => kunden.some(k => k.Kunden_Nr === nr && k.Status !== 'gesperrt-DSGVO' && k.Status !== 'archiviert');

/** Neuer Zugang. Antwort enthaelt den Token-Klartext EINMAL (nie gespeichert). Gleiche Vorgang-Kennung = schon angelegt. */
export async function legeZugangAn({ eingabe, sheets: s, jetzt = () => new Date(), kundenLesen = leseKunden, zufall } = {}) {
  const vorgang = t(eingabe?.vorgang);
  if (!/^[\w-]{8,64}$/.test(vorgang)) throw fehler('Vorgangs-Kennung fehlt.', 422);
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { wz, wt, z, tr } = await lies(sheets, spreadsheetId);
    if (z.idx.Vorgang === undefined) throw fehler('Spalte Vorgang fehlt in Bestellseiten – scripts/setup-bestellseiten-reiter.js --write.', 409, 'einrichtung');
    const schon = z.zeilen.find(x => x.Vorgang === vorgang);
    if (schon) return { ok: true, schon: true, zugangId: schon.Zugang_ID };
    const art = t(eingabe?.art);
    const auftraege = art === ART.AUFTRAG ? (await liesAuftraege(sheets, spreadsheetId)).a.zeilen : [];
    const kategorien = art === ART.DAUER ? await leseKategorien(sheets) : [];
    const { kunden } = await kundenLesen();
    const plan = anlagePlan({ eingabe, zugaenge: z.zeilen, termine: tr.zeilen, auftraege, kategorien, kundeDa: kundeDaAus(kunden), jetzt: jetzt().toISOString() });
    if (plan.zugang.Design_Link_Zeigen && z.idx.Design_Link_Zeigen === undefined) throw fehler('Spalte Design_Link_Zeigen fehlt – Setup.', 409, 'einrichtung');
    const token = erzeugeToken(zufall);
    plan.zugang.Token_Hash = tokenHash(token);
    await schreibeBloecke(sheets, spreadsheetId, [
      { tab: TAB_ZUGAENGE, alt: wz, zeilen: [alsZeile(z.idx, plan.zugang, wz[0].length)] },
      { tab: TAB_TERMINE, alt: wt, zeilen: plan.termin ? [alsZeile(tr.idx, plan.termin, wt[0].length)] : [] },
    ]);
    console.log(`Bestellseite ${plan.zugang.Zugang_ID} angelegt (${plan.zugang.Art}).`);
    return { ok: true, schon: false, zugangId: plan.zugang.Zugang_ID, token, ablauf: plan.zugang.Ablauf };
  });
}

async function ersetzeZugang(sheets, spreadsheetId, wz, z, alt, neu) {
  const breite = wz[0].length;
  const altZeile = wz[alt._zeile - 1] ?? [];
  const neuZeile = Array.from({ length: breite }, (_, i) => altZeile[i] ?? '');
  for (const s of ZUGANG_ALLE) if (z.idx[s] !== undefined) neuZeile[z.idx[s]] = neu[s] ?? '';
  try {
    await ersetzeZeile(sheets, spreadsheetId, TAB_ZUGAENGE, alt._zeile, altZeile, neuZeile);
  } catch (err) {
    if (err.status === 409) throw fehler('Zugang wurde inzwischen geändert – bitte neu laden.', 409, 'konflikt');
    throw err;
  }
}

export async function bearbeiteZugang({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { wz, z } = await lies(sheets, spreadsheetId);
    const alt = z.zeilen.find(x => x.Zugang_ID === t(eingabe?.zugangId));
    const kategorien = eingabe?.sortiment !== undefined ? await leseKategorien(sheets) : [];
    const neu = bearbeitenPlan({ zugang: alt, eingabe, kategorien, jetzt: jetzt().toISOString() });
    await ersetzeZugang(sheets, spreadsheetId, wz, z, alt, neu);
    console.log(`Bestellseite ${alt.Zugang_ID} geändert.`);
    return { ok: true, zugangId: alt.Zugang_ID, status: zugangStatus(neu, jetzt().toISOString()), stand: neu.Stand };
  });
}

/** Neuer Link: neuer Token, der alte ist sofort ungueltig. Klartext einmal in der Antwort. */
export async function neuerLink({ eingabe, sheets: s, jetzt = () => new Date(), zufall } = {}) {
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { wz, z } = await lies(sheets, spreadsheetId);
    const alt = z.zeilen.find(x => x.Zugang_ID === t(eingabe?.zugangId));
    if (!alt) throw fehler('Zugang gibt es nicht.', 404);
    if (t(eingabe?.stand) !== t(alt.Stand)) throw fehler('Zugang wurde inzwischen geändert – bitte neu laden.', 409, 'konflikt');
    const token = erzeugeToken(zufall);
    const neu = { ...alt, Token_Hash: tokenHash(token), Stand: jetzt().toISOString() };
    await ersetzeZugang(sheets, spreadsheetId, wz, z, alt, neu);
    console.log(`Bestellseite ${alt.Zugang_ID}: neuer Link erzeugt.`);
    return { ok: true, zugangId: alt.Zugang_ID, token, stand: neu.Stand, status: zugangStatus(neu, jetzt().toISOString()) };
  });
}

// ── MC-Knopf "Artikelliste aktualisieren": Bild-URLs schonend aus dem Shop ────

const warte = ms => new Promise(r => setTimeout(r, ms));

/**
 * Bild-URLs (Hauptbild je Produkt, Bild je Variation) der Produkte aller Dauer-Sortimente in Bestell_Bilder.
 * Nacheinander, 2 s Takt, nur _fields id/status/images bzw. id/image. Ganzer Reiter in EINEM values.update
 * (vorher frisch gelesen = Stand vom Anfang, sonst 409; Rest darunter geleert; zurueckgelesen).
 */
export async function aktualisiereBilder({ sheets: s, wc: wcTest, jetzt = () => new Date(), takt = TAKT_MS, dryRun = false } = {}) {
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { z } = await lies(sheets, spreadsheetId);
    const vorher = await leseBilder(sheets, spreadsheetId);
    if (!vorher.werte) throw fehler(`Reiter ${TAB_BILDER} fehlt – scripts/setup-bestellseiten-reiter.js --write.`, 409, 'einrichtung');
    const sortimente = z.zeilen.filter(x => x.Art === ART.DAUER && zugangStatus(x, jetzt().toISOString()) !== STATUS.GESPERRT).map(x => x.Sortiment);
    const [kategorien, maske] = [await leseKategorien(sheets), await leseMaske(sheets)];
    const namen = new Set(sortimente.flatMap(so => [...sortimentNamen(so, kategorien)]));
    const ids = [...new Set(maske.filter(a => t(a.produktId) && /^\d+$/.test(t(a.produktId)) && t(a.status) === 'Veröffentlicht'
      && t(a.kategorien).split(',').map(t).some(n => namen.has(n))).map(a => t(a.produktId)))];
    const wc = wcTest ?? getWcClient('jfn');
    const zeilen = [];
    const stand = jetzt().toISOString();
    let abrufe = 0;
    const hole = async (pfad, params) => { if (abrufe++) await warte(takt); return (await wc.get(pfad, params)).data; };
    for (let i = 0; i < ids.length; i += 100) {
      const teil = ids.slice(i, i + 100);
      const liste = seitenListe(await hole('products', { include: teil.join(','), per_page: 100, _fields: 'id,status,images' }), { wc, pfad: 'products' });
      for (const p of liste) zeilen.push([String(p.id), 'produkt', https(p.images?.[0]?.src), String(p.status ?? ''), stand]);
    }
    for (const id of ids) {
      for (let page = 1; ; page++) {
        seitenGrenze(page, { wc, pfad: 'products/variations' });
        const liste = seitenListe(await hole(`products/${id}/variations`, { per_page: 100, page, _fields: 'id,image' }), { wc, pfad: 'products/variations' });
        for (const v of liste) zeilen.push([String(v.id), 'variante', https(v.image?.src), '', stand]);
        if (liste.length < 100) break;
      }
    }
    const ergebnis = { produkte: ids.length, zeilen: zeilen.length, mitBild: zeilen.filter(r => r[2]).length, abrufe };
    if (dryRun) return { ok: true, dryRun: true, ...ergebnis };
    // Stand vom Anfang noch gueltig?
    const jetztWerte = (await leseBilder(sheets, spreadsheetId)).werte ?? [];
    if (zeilenAbweichungen(vorher.werte, jetztWerte).length || jetztWerte.length !== vorher.werte.length) {
      throw fehler('Bilder wurden inzwischen geändert – gleich noch einmal.', 409, 'konflikt');
    }
    const kopf = vorher.werte[0];
    const idx = Object.fromEntries(kopf.map((k, j) => [t(k), j]));
    const breite = kopf.length;
    const voll = zeilen.map(r => { const x = Array.from({ length: breite }, () => ''); BILD_SPALTEN.forEach((n, j) => { x[idx[n]] = r[j]; }); return x; });
    const leer = Math.max(0, vorher.werte.length - 1 - voll.length);
    const werte = [...voll, ...Array.from({ length: leer }, () => Array.from({ length: breite }, () => ''))];
    const ende = 1 + werte.length;
    if (werte.length) {
      const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId,gridProperties)' });
      const info = (meta.sheets ?? []).map(x => x.properties).find(p => p.title === TAB_BILDER);
      const raster = info?.gridProperties?.rowCount ?? 0;
      if (raster < ende) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ appendDimension: { sheetId: info.sheetId, dimension: 'ROWS', length: ende - raster } }] } });
      const range = `'${TAB_BILDER}'!A2:${spalteBuchstabe(breite - 1)}${ende}`;
      await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: werte } });
      const { data: zur } = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' });
      if (zeilenAbweichungen(werte, zur.values ?? []).length) throw fehler('Bilder: Rücklesen weicht ab – bitte prüfen.', 500, 'ruecklesen');
    }
    console.log(`Bestellseite Bilder: ${ergebnis.produkte} Produkte, ${ergebnis.zeilen} Zeilen, ${ergebnis.abrufe} Abrufe.`);
    return { ok: true, ...ergebnis, stand };
  });
}
const https = u => (/^https:\/\/[^\s"'<>]+$/.test(t(u)) ? t(u) : '');

export { TAB_EINTRAEGE };
