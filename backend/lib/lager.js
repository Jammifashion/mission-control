// Lager (BO5-1) - Ein-/Ausgabe, Logik in utils/lager.js.
// Reiter im SSOT-Sheet: Lager_Buchungen (Journal), Lager_Artikel (Freitext-Artikel), Lager_Orte (feste Liste).
// Einrichtung: scripts/setup-lager-reiter.js (Trockenlauf, --write).
//
// Schreiben: eine Sperre je Instanz fuer alle drei Reiter, frisch gelesen, Bestand vor jedem Abgang geprueft,
// EIN values.update in die vorher gepruefte Zielstrecke (lib/sheet-zeilen.js, nie values.append), zurueckgelesen.
// Hat sich der Reiter seit dem Lesen geaendert (andere Instanz), wird nichts geschrieben (409). Ein zweiter Klick
// mit derselben Vorgangs-Kennung bucht nichts doppelt. Jede Buchung leert den Zwischenspeicher des Bestands.
// Stammdaten nur lesen: LShop_Modelle, Varianten, Erfassungsmaske, SKU_Extern (SSOT), Trikot_Artikel + Trikots (Business).

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { leseReiterSpalten } from './ssot-reiter.js';
import { ladeLShopZeilen, farbwert, discontinuedWert, DISCONTINUED_GESPERRT, STATUS_AUSGELAUFEN } from './lshop.js';
import { istGroessenAchse } from './groessen.js';
import { schreibeNeueZeilen } from './sheet-zeilen.js';
import { sucheModelle } from '../utils/korb-logic.js';
import {
  TAB_BUCHUNGEN, TAB_ARTIKEL, TAB_ORTE, BUCHUNG_SPALTEN, ARTIKEL_SPALTEN, ORTE_SPALTEN, WARENART, STATUS_AKTIV,
  buchungenAus, reiterZeilen, orteAus, aktiveOrte, artikelAus, warenartVon, planBuchung, planGegenbuchung,
  planNeuerOrt, planNeuerArtikel, alsZeile, bestandListe, buchungsVerlauf, ART_TEXT, ZUGANG_ARTEN, ABGANG_ARTEN,
  ARTIKEL_WARENARTEN, MENGE_MAX,
} from '../utils/lager.js';

const TAB_VARIANTEN = 'Varianten';
const TAB_MASKE = 'Erfassungsmaske';
const TAB_EXTERN = 'SKU_Extern';
const TAB_TRIKOT_ARTIKEL = 'Trikot_Artikel';
const TAB_TRIKOTS = 'Trikots';
// Trikot-Groessen, die es immer zur Wahl gibt; dazu jede Groesse, die im Reiter Trikots fuer das Produkt vorkommt.
const TRIKOT_GROESSEN = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];

export const CACHE_MS = 60 * 1000;          // Bestand/Verlauf, wie TR5
export const STAMM_MS = 5 * 60 * 1000;      // Stammdaten
const t = v => String(v ?? '').trim();
const fehler = (msg, status, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
const q = tab => `'${tab}'`;

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}
const ssotId = () => {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  return id;
};

// ── Zwischenspeicher ─────────────────────────────────────────────────────────
let cache = { bis: 0, daten: null };
let stammCache = { bis: 0, daten: null };
export const lagerCacheLeeren = () => { cache = { bis: 0, daten: null }; };
export const _stammCacheLeeren = () => { stammCache = { bis: 0, daten: null }; };

// ── Lesen ────────────────────────────────────────────────────────────────────

async function reiterTitel(sheets, spreadsheetId) {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title)' });
  return new Set((data.sheets ?? []).map(s => s.properties.title));
}
const leseWerte = async (sheets, spreadsheetId, tab) =>
  (await sheets.spreadsheets.values.get({ spreadsheetId, range: q(tab), valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];

/** Alle drei Lager-Reiter frisch. Fehlt einer oder eine Spalte: einrichtung = Liste der Maengel. */
async function leseLager(sheets, spreadsheetId) {
  const titel = await reiterTitel(sheets, spreadsheetId);
  const einrichtung = [];
  const lies = async (tab, spalten) => {
    if (!titel.has(tab)) { einrichtung.push(`Reiter ${tab} fehlt`); return [[]]; }
    const w = await leseWerte(sheets, spreadsheetId, tab);
    const fehlt = reiterZeilen(w, spalten).fehlt;
    if (fehlt.length) einrichtung.push(`${tab}: Spalte ${fehlt.join(', ')} fehlt`);
    return w;
  };
  const werteB = await lies(TAB_BUCHUNGEN, BUCHUNG_SPALTEN);
  const werteA = await lies(TAB_ARTIKEL, ARTIKEL_SPALTEN);
  const werteO = await lies(TAB_ORTE, ORTE_SPALTEN);
  const j = buchungenAus(werteB);
  return {
    einrichtung, werteB, werteA, werteO, idxB: j.idx, buchungen: j.buchungen, hinweise: j.hinweise,
    idxA: reiterZeilen(werteA, ARTIKEL_SPALTEN).idx, artikel: artikelAus(werteA),
    idxO: reiterZeilen(werteO, ORTE_SPALTEN).idx, orte: orteAus(werteO),
  };
}

/** Stammdaten fuer Beschreibung und Pruefung der Schluessel (5 min). */
async function ladeStamm(sheets) {
  if (stammCache.daten && Date.now() < stammCache.bis) return stammCache.daten;
  const spreadsheetId = ssotId();
  const business = process.env.BUSINESS_SHEET_ID;
  const lshop = await ladeLShopZeilen({ sheets, spreadsheetId });
  const varianten = await leseReiterSpalten({ tab: TAB_VARIANTEN, sheets, spreadsheetId,
    spalten: { ssotId: 'SSOT-ID', wcId: 'WC_Variation_ID' },
    optional: { e1: 'E1', v1: 'V1', e2: 'E2', v2: 'V2', e3: 'E3', v3: 'V3', aktiv: 'Aktiv' } });
  const maske = await leseReiterSpalten({ tab: TAB_MASKE, sheets, spreadsheetId,
    spalten: { id: 'ID', name: 'Produktname' }, optional: { produktId: 'Produkt-ID', artikelnummer: 'Artikelnummer' } });
  const extern = await leseReiterSpalten({ tab: TAB_EXTERN, sheets, spreadsheetId,
    spalten: { articleNr: 'ArticleNr' }, optional: { catalogNr: 'CatalogNr', name: 'Description', farbe: 'color1', groesse: 'Size', lieferant: 'Lieferant' } });
  // Trikots liegen im Business-Sheet. Ist es nicht lesbar, fehlen nur die Trikots (Hinweis), das Lager laeuft weiter.
  let trikotArtikel = [], trikots = [], trikotHinweis = '';
  try {
    if (!business) throw new Error('BUSINESS_SHEET_ID fehlt');
    trikotArtikel = await leseReiterSpalten({ tab: TAB_TRIKOT_ARTIKEL, sheets, spreadsheetId: business,
      spalten: { produktId: 'Produkt-ID' }, optional: { aktiv: 'Aktiv' } });
    trikots = await leseReiterSpalten({ tab: TAB_TRIKOTS, sheets, spreadsheetId: business,
      spalten: { produktname: 'Produktname', groesse: 'Groesse' } });
  } catch (err) {
    trikotHinweis = 'Trikot-Liste gerade nicht lesbar - Trikots können nicht gebucht werden.';
    console.warn(`Lager: Trikot-Stammdaten nicht lesbar (${err?.status ?? err?.code ?? 'Fehler'})`);
  }
  const daten = {
    lshop, lshopNr: new Map(lshop.map(z => [t(z.articleNr), z])),
    varianten, wc: new Map(varianten.filter(v => t(v.wcId)).map(v => [t(v.wcId), v])),
    maske, maskeId: new Map(maske.map(m => [t(m.id), m])), maskePid: new Map(maske.filter(m => t(m.produktId)).map(m => [t(m.produktId), m])),
    extern: new Map(extern.filter(e => t(e.articleNr)).map(e => [t(e.articleNr), e])),
    trikotArtikel: trikotArtikel.filter(a => t(a.produktId)), trikots, trikotHinweis,
  };
  stammCache = { bis: Date.now() + STAMM_MS, daten };
  return daten;
}

/** Achsen einer Varianten-Zeile -> { farbe (alles ausser Groesse), groesse }. */
function variantenTeile(v) {
  const achsen = [[v.e1, v.v1], [v.e2, v.v2], [v.e3, v.v3]].map(([n, w]) => ({ name: t(n), wert: t(w) })).filter(a => a.name && a.wert);
  const g = achsen.find(a => istGroessenAchse(a.name));
  return { achsen, groesse: g?.wert ?? '', farbe: achsen.filter(a => a !== g).map(a => a.wert).join(' · ') };
}

/** schluessel -> { modell, name, farbe, groesse, hinweis } fuer Anzeige und Gruppen. */
function beschreiber(stamm, artikel) {
  const la = new Map(artikel.map(a => [a.laNr, a]));
  return schluessel => {
    const s = t(schluessel);
    const wa = warenartVon(s);
    const rest = s.slice(s.indexOf(':') + 1);
    if (wa === WARENART.ROHLING) {
      const z = stamm.lshopNr.get(rest);
      return z ? { modell: t(z.catalogNr), name: t(z.bezeichnung), farbe: farbwert(z.color1, z.color2), groesse: t(z.size), hinweis: '' }
        : { modell: rest, name: '', farbe: '', groesse: '', hinweis: 'nicht in den L-Shop-Stammdaten' };
    }
    if (wa === WARENART.FERTIG) {
      const v = stamm.wc.get(rest);
      if (!v) return { modell: `Variante ${rest}`, name: '', farbe: '', groesse: '', hinweis: 'Variante nicht mehr gepflegt' };
      const teile = variantenTeile(v);
      return { modell: t(stamm.maskeId.get(t(v.ssotId))?.name) || `Artikel ${t(v.ssotId)}`, name: '', farbe: teile.farbe, groesse: teile.groesse, hinweis: '' };
    }
    if (wa === WARENART.TRIKOT) {
      const [pid, groesse] = rest.split(':');
      const m = stamm.maskePid.get(pid);
      return { modell: t(m?.name) || `Trikot ${pid}`, name: '', farbe: '', groesse, hinweis: stamm.trikotArtikel.some(a => t(a.produktId) === pid) ? '' : 'nicht in Trikot_Artikel' };
    }
    if (wa === WARENART.FREMD) {
      const e = stamm.extern.get(rest);
      return e ? { modell: t(e.catalogNr) || rest, name: t(e.name), farbe: t(e.farbe), groesse: t(e.groesse), hinweis: '' }
        : { modell: rest, name: '', farbe: '', groesse: '', hinweis: 'nicht mehr in SKU_Extern' };
    }
    if (wa === WARENART.FREI) {
      const a = la.get(rest);
      return a ? { modell: a.modell || a.bezeichnung, name: a.modell ? a.bezeichnung : '', farbe: a.farbe, groesse: a.groesse, hinweis: '' }
        : { modell: rest, name: '', farbe: '', groesse: '', hinweis: 'nicht in Lager_Artikel' };
    }
    return { modell: s, name: '', farbe: '', groesse: '', hinweis: 'unbekannter Schlüssel' };
  };
}

/** Ist der Schluessel gepflegt? true oder Text. */
function pruefer(stamm, artikel) {
  const la = new Map(artikel.map(a => [a.laNr, a]));
  return schluessel => {
    const s = t(schluessel), wa = warenartVon(s), rest = s.slice(s.indexOf(':') + 1);
    if (wa === WARENART.ROHLING) return stamm.lshopNr.has(rest) || `${rest} steht nicht in den L-Shop-Stammdaten.`;
    if (wa === WARENART.FERTIG) return stamm.wc.has(rest) || `Variante ${rest} ist nicht gepflegt.`;
    if (wa === WARENART.TRIKOT) return stamm.trikotArtikel.some(a => t(a.produktId) === rest.split(':')[0]) || `Trikot ${rest.split(':')[0]} ist nicht gepflegt.`;
    if (wa === WARENART.FREMD) return stamm.extern.has(rest) || `${rest} steht nicht in der Fremdware-Liste.`;
    if (wa === WARENART.FREI) return (la.has(rest) && la.get(rest).status === STATUS_AKTIV) || `${rest} gibt es nicht (mehr).`;
    return `Unbekannter Artikel "${s}".`;
  };
}

// ── Anzeige ──────────────────────────────────────────────────────────────────

/** GET /api/lager/bestand - Bestand je Schluessel + Ort, Orte, Freitext-Artikel, Arten fuer den Dialog. */
export async function leseBestand({ sheets: s, jetzt = Date.now() } = {}) {
  if (!s && cache.daten && jetzt < cache.bis) return cache.daten;
  const sheets = s ?? await sheetsClient();
  const l = await leseLager(sheets, ssotId());
  const stamm = await ladeStamm(sheets);
  const beschreibe = beschreiber(stamm, l.artikel);
  const daten = {
    einrichtung: l.einrichtung,
    posten: bestandListe(l.buchungen, beschreibe),
    verlauf: buchungsVerlauf(l.buchungen, beschreibe),
    orte: l.orte, artikel: l.artikel.filter(a => a.status === STATUS_AKTIV),
    arten: { zugang: ZUGANG_ARTEN, abgang: ABGANG_ARTEN, text: ART_TEXT }, artikelWarenarten: ARTIKEL_WARENARTEN, mengeMax: MENGE_MAX,
    hinweise: [...l.hinweise, ...(stamm.trikotHinweis ? [stamm.trikotHinweis] : [])], buchungen: l.buchungen.length, stand: new Date(jetzt).toISOString(),
  };
  if (!s) cache = { bis: jetzt + CACHE_MS, daten };
  return daten;
}

// ── Auswahl im Dialog (nur lesen) ────────────────────────────────────────────

export async function sucheRohling({ q: suche, sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  return sucheModelle((await ladeStamm(sheets)).lshop, suche);
}

/** Alle Varianten eines L-Shop-Modells - auch ausgelaufene (die Ware kann im Regal liegen), markiert. */
export async function rohlingVarianten({ catalogNr, sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  const nr = t(catalogNr);
  const zeilen = (await ladeStamm(sheets)).lshop.filter(z => t(z.catalogNr) === nr && /^\d{10}$/.test(t(z.articleNr)));
  if (!zeilen.length) throw fehler(`Modell "${nr}" steht nicht in den L-Shop-Stammdaten.`, 404);
  return {
    catalogNr: nr, bezeichnung: t(zeilen.find(z => t(z.bezeichnung))?.bezeichnung), marke: t(zeilen.find(z => t(z.marke))?.marke),
    varianten: zeilen.map(z => ({
      articleNr: t(z.articleNr), schluessel: `LS:${t(z.articleNr)}`, farbe: farbwert(z.color1, z.color2), groesse: t(z.size),
      auslauf: t(z.status) === STATUS_AUSGELAUFEN || DISCONTINUED_GESPERRT.has(discontinuedWert(z.discontinued)),
    })),
  };
}

/** Fertigware: Artikel der Erfassungsmaske mit WC-Varianten, Suche ueber Name und Artikelnummer. */
export async function sucheFertig({ q: suche, sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  const stamm = await ladeStamm(sheets);
  const qq = t(suche).toLowerCase();
  if (qq.length < 2) return { artikel: [], mehr: false };
  const mitVarianten = new Set(stamm.varianten.filter(v => t(v.wcId)).map(v => t(v.ssotId)));
  const treffer = stamm.maske.filter(m => mitVarianten.has(t(m.id)) && [m.name, m.artikelnummer].some(x => t(x).toLowerCase().includes(qq)))
    .map(m => ({ ssotId: t(m.id), name: t(m.name), artikelnummer: t(m.artikelnummer) }));
  return { artikel: treffer.slice(0, 25), mehr: treffer.length > 25 };
}

export async function fertigVarianten({ ssotId: id, sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  const stamm = await ladeStamm(sheets);
  const varianten = stamm.varianten.filter(v => t(v.ssotId) === t(id) && t(v.wcId));
  if (!varianten.length) throw fehler(`Artikel ${t(id)} hat keine Varianten mit Shop-ID.`, 404);
  return {
    ssotId: t(id), name: t(stamm.maskeId.get(t(id))?.name),
    varianten: varianten.map(v => ({ wcId: t(v.wcId), schluessel: `WC:${t(v.wcId)}`, ...variantenTeile(v), aktiv: !/^false$/i.test(t(v.aktiv)) })),
  };
}

/** Trikots: Produkte aus Trikot_Artikel; Groessen = feste Liste + was im Reiter Trikots vorkommt. */
export async function trikotAuswahl({ sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  const stamm = await ladeStamm(sheets);
  return {
    produkte: stamm.trikotArtikel.map(a => {
      const pid = t(a.produktId);
      const name = t(stamm.maskePid.get(pid)?.name);
      const gesehen = stamm.trikots.filter(z => name && t(z.produktname) === name).map(z => t(z.groesse).replace(/\s+/g, '')).filter(Boolean);
      return { produktId: pid, name: name || `Trikot ${pid}`, aktiv: !/^false$/i.test(t(a.aktiv)), groessen: [...new Set([...gesehen, ...TRIKOT_GROESSEN])] };
    }),
  };
}

export async function fremdAuswahl({ sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  const stamm = await ladeStamm(sheets);
  return { artikel: [...stamm.extern.values()].map(e => ({ articleNr: t(e.articleNr), schluessel: `EX:${t(e.articleNr)}`, catalogNr: t(e.catalogNr),
    name: t(e.name), farbe: t(e.farbe), groesse: t(e.groesse), lieferant: t(e.lieferant) })) };
}

// ── Schreiben ────────────────────────────────────────────────────────────────

let laeuft = false;
export const BESCHAEFTIGT = 'Gerade wird schon gebucht - bitte gleich noch einmal.';
async function mitLagerSperre(fn) {
  if (laeuft) throw fehler(BESCHAEFTIGT, 409, { code: 'laeuft_gerade' });
  laeuft = true;
  try { return await fn(); } finally { laeuft = false; }
}

function pruefeEinrichtung(l) {
  if (l.einrichtung.length) throw fehler(`Lager ist noch nicht eingerichtet (${l.einrichtung.join('; ')}).`, 409, { code: 'einrichtung' });
}

/** Zeilen hinter die letzte belegte Zeile; Konflikt mit einem anderen Schreiber -> 409, nichts geschrieben. */
async function schreibe(sheets, spreadsheetId, tab, objekte, idx, werte) {
  try {
    return await schreibeNeueZeilen(sheets, spreadsheetId, tab, objekte.map(o => alsZeile(o, idx)), { alt: werte });
  } catch (err) {
    if (/geändert|nicht leer/.test(err.message)) throw fehler('Gerade hat jemand anders gebucht - bitte noch einmal.', 409, { code: 'konflikt' });
    throw err;
  }
}

const antwortZeilen = zeilen => ({
  buchungen: zeilen.map(z => z.Buchung_ID ?? z.id),
  zeilen: zeilen.length,
  stueck: zeilen.reduce((a, z) => a + Math.abs(Number(z.Menge ?? z.menge) || 0), 0),
});

/** POST /api/lager/buchen - Einbuchen, Ausbuchen, Umlagern, Zaehlung, Startbestand. Alles oder nichts. */
export async function bucheLager({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitLagerSperre(async () => {
    const spreadsheetId = ssotId();
    const sheets = s ?? await sheetsClient();
    const l = await leseLager(sheets, spreadsheetId);
    pruefeEinrichtung(l);
    const stamm = await ladeStamm(sheets);
    const plan = planBuchung(eingabe, { buchungen: l.buchungen, orte: aktiveOrte(l.orte), gueltig: pruefer(stamm, l.artikel), jetzt: jetzt() });
    if (plan.schonGebucht) return { ok: true, schonGebucht: true, ...antwortZeilen(plan.schonGebucht) };
    if (plan.probleme.length) {
      // In der Meldung den Artikel so nennen, wie ihn die Ansicht zeigt (Modell Farbe Groesse), nicht als Schluessel.
      const beschreibe = beschreiber(stamm, l.artikel);
      const probleme = plan.probleme.map(p => {
        if (!p.schluessel || !warenartVon(p.schluessel)) return p;
        const b = beschreibe(p.schluessel);
        const name = [b.modell, b.farbe, b.groesse].filter(Boolean).join(' ');
        return name ? { ...p, text: p.text.replace(p.schluessel, name) } : p;
      });
      throw fehler(probleme[0].text, 422, { probleme, code: 'nicht_gebucht' });
    }
    const start = await schreibe(sheets, spreadsheetId, TAB_BUCHUNGEN, plan.zeilen, l.idxB, l.werteB);
    lagerCacheLeeren();
    return { ok: true, startZeile: start, ...antwortZeilen(plan.zeilen) };
  });
}

/** POST /api/lager/gegenbuchung { buchungId, vorgang } */
export async function gegenbuchung({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitLagerSperre(async () => {
    const spreadsheetId = ssotId();
    const sheets = s ?? await sheetsClient();
    const l = await leseLager(sheets, spreadsheetId);
    pruefeEinrichtung(l);
    const plan = planGegenbuchung({ buchungId: eingabe?.buchungId, vorgang: eingabe?.vorgang }, { buchungen: l.buchungen, jetzt: jetzt() });
    if (plan.schonGebucht) return { ok: true, schonGebucht: true, ...antwortZeilen(plan.schonGebucht) };
    if (plan.probleme.length) throw fehler(plan.probleme[0].text, plan.status ?? 422, { probleme: plan.probleme, code: 'nicht_gebucht' });
    const start = await schreibe(sheets, spreadsheetId, TAB_BUCHUNGEN, plan.zeilen, l.idxB, l.werteB);
    lagerCacheLeeren();
    return { ok: true, startZeile: start, ...antwortZeilen(plan.zeilen) };
  });
}

/** POST /api/lager/orte { ort, notiz } */
export async function neuerOrt({ eingabe, sheets: s } = {}) {
  return mitLagerSperre(async () => {
    const spreadsheetId = ssotId();
    const sheets = s ?? await sheetsClient();
    const l = await leseLager(sheets, spreadsheetId);
    pruefeEinrichtung(l);
    const plan = planNeuerOrt(eingabe, l.orte);
    if (plan.probleme.length) throw fehler(plan.probleme[0].text, 422, { probleme: plan.probleme, vorhanden: plan.vorhanden, code: 'nicht_angelegt' });
    await schreibe(sheets, spreadsheetId, TAB_ORTE, [plan.zeile], l.idxO, l.werteO);
    lagerCacheLeeren();
    return { ok: true, ort: plan.zeile.Ort };
  });
}

/** POST /api/lager/artikel { bezeichnung, warenart, modell, farbe, groesse, notiz } */
export async function neuerArtikel({ eingabe, sheets: s } = {}) {
  return mitLagerSperre(async () => {
    const spreadsheetId = ssotId();
    const sheets = s ?? await sheetsClient();
    const l = await leseLager(sheets, spreadsheetId);
    pruefeEinrichtung(l);
    const plan = planNeuerArtikel(eingabe, l.artikel);
    if (plan.probleme.length) throw fehler(plan.probleme[0].text, 422, { probleme: plan.probleme, vorhanden: plan.vorhanden, code: 'nicht_angelegt' });
    await schreibe(sheets, spreadsheetId, TAB_ARTIKEL, [plan.zeile], l.idxA, l.werteA);
    lagerCacheLeeren();
    return { ok: true, laNr: plan.laNr, schluessel: `FREI:${plan.laNr}` };
  });
}
