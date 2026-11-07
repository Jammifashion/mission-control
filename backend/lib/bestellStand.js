// KS4: Stand je Eintrag der Bestellseite (Seite + MC), "fertig", "an Fanshop geliefert", "in Termin … verschieben".
// Logik in utils/bestell-stand.js und utils/bestell-verschieben.js.
//
// Lesen: Eintraege -> AU-Positionen (Fertig = fertig, Versendet = geliefert), Korb (Status + AB-Liefertermin), Rueckstandsliste RS1,
// Lieferbarkeit BO7, Trikot-Zeilen (Business-Sheet, nur gelesen). Teure Quellen nur, wenn sie gebraucht werden (RS1 nur bei bestellten
// Korb-Zeilen, Trikots nur bei uebernommenen Trikots). Fuer die Seite ein Zwischenspeicher je Zugang + juengstem Eintrags-Stand,
// hoechstens STAND_MS alt; jeder MC-Schreibweg leert ihn. Faellt eine Quelle aus, fehlt nur ihr Teil (nie die ganze Liste).
// Schreiben: Bestellseiten- UND Auftrags-Sperre, frisch gelesen, kein values.append, EIN batchUpdate, zurueckgelesen. Nie Korb, nie Trikots.
// Log: nur IDs und Anzahlen.

import { liesAuftraege, leseKorbJe, mitAuftragSperre, _auftraegeCacheLeeren } from './auftraege.js';
import { leseLieferbarkeit } from './lieferbarkeitLesen.js';
import { leseRueckstand } from './rueckstand.js';
import { mitSperre, sheetsClient, sheetId, liesZugaengeTermine, alsZeile } from './bestellseite.js';
import { schreibe, zellenAus, eintraegeOder409 } from './bestellUebernahme.js';
import { TAB_TRIKOTS, trikotZeilen } from '../utils/trikot-ansicht.js';
import { TAB_TERMINE, TAB_EINTRAEGE, fehler } from '../utils/bestellseite.js';
import { terminPlan } from '../utils/bestell-eintraege.js';
import { TAB_AUFTRAEGE, TAB_POSITIONEN, AUFTRAG_SPALTEN, POSITION_SPALTEN, alsZeile as auZeile, HERKUNFT } from '../utils/auftraege.js';
import { standFuer, rueckstandJeKorb } from '../utils/bestell-stand.js';
import { verschiebenPlan, geliefertPlan, fertigMehrPlan } from '../utils/bestell-verschieben.js';

const t = v => String(v ?? '').trim();
/** Stand auf der Seite hoechstens so alt (Korb/AB/RS1 aendern sich stuendlich bzw. woechentlich; MC-Schreibwege leeren sofort). */
export const STAND_MS = 3 * 60 * 1000;
let standCache = new Map();
export function _standCacheLeeren() { standCache = new Map(); }

/** Trikot-Zeilen (Business-Sheet, nur lesen): Zeilen-ID -> { charge, bestelltAm, geliefertAm, status }. Fehlt etwas: leer. */
export async function leseTrikotStand(sheets) {
  const id = process.env.BUSINESS_SHEET_ID;
  if (!id) return new Map();
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${TAB_TRIKOTS}'`, valueRenderOption: 'FORMATTED_VALUE' });
  return new Map(trikotZeilen(data.values ?? []).zeilen.filter(z => z.id).map(z => [z.id, { charge: z.charge, bestelltAm: z.bestelltAm, geliefertAm: z.geliefertAm, status: z.status }]));
}

const STANDARD_QUELLEN = {
  auftraege: liesAuftraege, korb: leseKorbJe,
  lieferbarkeit: (sheets, spreadsheetId) => leseLieferbarkeit({ sheets, spreadsheetId }).then(x => x.je),
  rueckstand: (sheets, spreadsheetId) => leseRueckstand({ sheets, spreadsheetId }).then(x => rueckstandJeKorb(x.positionen)),
  trikots: leseTrikotStand,
};
async function versuch(fn, was) {
  try { return await fn(); } catch (err) { console.warn(`Bestellseite Stand: ${was} nicht lesbar (${err?.status ?? err?.code ?? 'Fehler'}).`); return null; }
}

/**
 * Stand je Eintrag (MC-Form, mit `intern`). Nur uebernommene brauchen Quellen; die anderen kommen aus dem Eintrag selbst.
 * @param {object} o
 * @param {object[]} o.eintraege  Eintrags-Zeilen (Spaltennamen)
 * @param {Map<string,string>} o.terminDatum  Termin_ID -> Datum
 * @returns {Promise<Map<string, object>>}  Eintrag_ID -> Stand
 */
export async function standJe({ eintraege, terminDatum = new Map(), sheets, spreadsheetId, quellen = {} }) {
  const q = { ...STANDARD_QUELLEN, ...quellen };
  const ue = (eintraege ?? []).filter(e => t(e.Status) === 'übernommen');
  const ctx = { posJe: new Map(), korbJe: new Map(), rsJe: new Map(), lfbJe: new Map(), trikotJe: new Map() };
  if (ue.some(e => t(e.Art) !== 'trikot')) {
    const au = await versuch(() => q.auftraege(sheets, spreadsheetId), 'Aufträge');
    ctx.posJe = new Map((au?.p?.zeilen ?? []).map(p => [p.Position_ID, p]));
    ctx.korbJe = (await versuch(() => q.korb(sheets, spreadsheetId), 'Korb')) ?? new Map();
    ctx.lfbJe = (await versuch(() => q.lieferbarkeit(sheets, spreadsheetId), 'Lieferbarkeit')) ?? new Map();
    // RS1 nur, wenn eine betroffene Korb-Zeile bestellt ist (Drive + xlsx sind teuer)
    const bestellt = ue.some(e => {
      const p = ctx.posJe.get(t(e.Position_ID));
      const k = p && (t(p.Korb_Schluessel) || (/^(EIGEN|JFN|HONK):/.test(t(p.Verweis)) ? t(p.Verweis) : ''));
      return k && ['bestellt'].includes(t(ctx.korbJe.get(k)?.Status));
    });
    if (bestellt) ctx.rsJe = (await versuch(() => q.rueckstand(sheets, spreadsheetId), 'Rückstandsliste')) ?? new Map();
  }
  if (ue.some(e => t(e.Art) === 'trikot')) ctx.trikotJe = (await versuch(() => q.trikots(sheets), 'Trikots')) ?? new Map();
  return new Map((eintraege ?? []).map(e => [e.Eintrag_ID, standFuer(e, { ...ctx, terminDatum: terminDatum.get(e.Termin_ID) ?? '' })]));
}

/** Seite: wie standJe, aber je Zugang + juengstem Eintrags-Stand zwischengespeichert (STAND_MS). */
export async function standJeSeite({ zugangId, eintraege, terminDatum, sheets, spreadsheetId, quellen, jetzt = Date.now() }) {
  const k = `${zugangId}|${(eintraege ?? []).map(e => t(e.Stand)).sort().at(-1) ?? ''}|${(eintraege ?? []).length}`;
  const c = standCache.get(k);
  if (c && jetzt - c.zeit < STAND_MS) return c.je;
  const je = await standJe({ eintraege, terminDatum, sheets, spreadsheetId, quellen });
  standCache.set(k, { zeit: jetzt, je });
  return je;
}

// ── MC: gedruckt / geliefert / verschieben ───────────────────────────────────

function fertigLeeren() { _standCacheLeeren(); _auftraegeCacheLeeren(); }

/** POST /api/bestellseiten/fertig { positionIds, fertig } - Haken "fertig" fuer mehrere Positionen (KS4-1; `gedruckt` als alter Name erlaubt). */
export async function setzeFertig({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitAuftragSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { a, p } = await liesAuftraege(sheets, spreadsheetId);
    const soll = (eingabe?.fertig ?? eingabe?.gedruckt) !== false;
    const plan = fertigMehrPlan({ positionIds: eingabe?.positionIds, fertig: soll, auftraege: a.zeilen, positionen: p.zeilen, jetzt: jetzt().toISOString() });
    if (plan.aenderungen.length) await schreibe(sheets, spreadsheetId, { zellen: plan.aenderungen.flatMap(x => zellenAus(TAB_POSITIONEN, p.idx, x.zeile, x.felder)) });
    fertigLeeren();
    console.log(`Bestellseite/Auftrag: ${plan.aenderungen.length} Positionen ${soll ? 'fertig' : 'nicht mehr fertig'}.`);
    return { ok: true, geaendert: plan.aenderungen.length, unveraendert: plan.unveraendert };
  });
}

/** POST /api/bestellseiten/geliefert { zugangId, terminId | auftragNr, zurueck } - "an Fanshop geliefert" bzw. Ruecknahme. */
export async function setzeGeliefert({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitSperre(() => mitAuftragSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const zurueck = eingabe?.zurueck === true;
    const daten = await liesZugaengeTermine(sheets, spreadsheetId);
    const termin = t(eingabe?.terminId) ? daten.tr.zeilen.find(x => x.Termin_ID === t(eingabe.terminId) && x.Zugang_ID === t(eingabe?.zugangId)) : null;
    if (t(eingabe?.terminId) && !termin) throw fehler('Termin gibt es auf dieser Bestellseite nicht.', 404);
    if (!termin && !t(eingabe?.auftragNr)) throw fehler('Termin oder Auftrag fehlt.');
    const e = await eintraegeOder409(sheets, spreadsheetId, []);
    const { a, p } = await liesAuftraege(sheets, spreadsheetId);
    const plan = geliefertPlan({ termin, auftragNr: eingabe?.auftragNr, zurueck, eintraege: e.zeilen, auftraege: a.zeilen, positionen: p.zeilen, jetzt: jetzt().toISOString() });
    if (plan.eintraege.length && e.idx.Geliefert_Am === undefined) throw fehler('Spalte Geliefert_Am fehlt in Bestell_Eintraege – erst scripts/setup-bestellseiten-reiter.js --write.', 409, 'einrichtung');
    if (!plan.unveraendert) {
      await schreibe(sheets, spreadsheetId, { zellen: [
        ...plan.positionen.flatMap(x => zellenAus(TAB_POSITIONEN, p.idx, x.zeile, x.felder)),
        ...plan.eintraege.flatMap(x => zellenAus(TAB_EINTRAEGE, e.idx, x.eintrag._zeile, x.felder)),
        ...plan.auftraege.flatMap(x => zellenAus(TAB_AUFTRAEGE, a.idx, x.auftrag._zeile, x.felder)),
      ] });
    }
    fertigLeeren();
    console.log(`Bestellseite ${t(eingabe?.zugangId) || '-'}: ${zurueck ? 'geliefert zurück' : 'an Fanshop geliefert'} – ${plan.positionen.length} Positionen, ${plan.eintraege.length} Trikots, ${plan.auftraege.length} Aufträge.`);
    return { ok: true, positionen: plan.positionen.length, trikots: plan.eintraege.length, auftraege: plan.auftraege.map(x => ({ auftragNr: x.auftrag.Auftrag_Nr, status: x.felder.Status })),
      hinweise: plan.hinweise, unveraendert: plan.unveraendert };
  }));
}

/**
 * POST /api/bestellseiten/verschieben { zugangId, auswahl:[{id,stand}], zielTermin | neuesDatum (+ notiz), grund, vorgang, dryRun }
 * Neuer Termin (nur Art dauer) wie "+ Termin" auf der Seite (gleiches Datum = vorhandener Termin).
 */
export async function verschiebe({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  const vorgang = t(eingabe?.vorgang);
  const dryRun = eingabe?.dryRun === true;
  if (!dryRun && !/^[\w-]{8,64}$/.test(vorgang)) throw fehler('Vorgangs-Kennung fehlt.', 422);
  return mitSperre(() => mitAuftragSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const iso = jetzt().toISOString();
    const daten = await liesZugaengeTermine(sheets, spreadsheetId);
    const zugang = daten.z.zeilen.find(x => x.Zugang_ID === t(eingabe?.zugangId));
    if (!zugang) throw fehler('Zugang gibt es nicht.', 404);
    const termine = daten.tr.zeilen.filter(x => x.Zugang_ID === zugang.Zugang_ID);
    let zielTermin, terminNeu = null;
    if (t(eingabe?.zielTermin)) zielTermin = termine.find(x => x.Termin_ID === t(eingabe.zielTermin));
    else if (t(eingabe?.neuesDatum)) {
      const tp = terminPlan({ zugang, termine: daten.tr.zeilen, eingabe: { datum: eingabe.neuesDatum, notiz: eingabe.notiz }, jetzt: iso });
      zielTermin = tp.vorhanden ?? tp.neu;
      terminNeu = tp.neu ?? null;
    }
    if (!zielTermin) throw fehler('Ziel-Termin fehlt.', 422);
    const e = await eintraegeOder409(sheets, spreadsheetId, ['Verschoben_Von', 'Verschoben_Grund']);
    const { wa, wp, a, p } = await liesAuftraege(sheets, spreadsheetId);
    const plan = verschiebenPlan({ zugang, termine, zielTermin, eintraege: e.zeilen, auswahl: eingabe?.auswahl, grund: eingabe?.grund,
      auftraege: a.zeilen, positionen: p.zeilen, vorgang, jetzt: iso });
    if (plan.schon) return { ok: true, schon: true, anzahl: plan.anzahl, zielTermin: zielTermin.Termin_ID };
    if (plan.positionAenderungen.length && p.idx.Verschoben_Nach === undefined) throw fehler('Spalte Verschoben_Nach fehlt in Auftrag_Positionen – erst scripts/setup-auftraege-reiter.js --write.', 409, 'einrichtung');
    if (plan.positionenNeu.some(x => x.Verweis) && p.idx.Verweis === undefined) throw fehler('Spalte Verweis fehlt in Auftrag_Positionen – erst Setup.', 409, 'einrichtung');
    if (plan.positionenNeu.some(x => x.Herkunft && x.Herkunft !== HERKUNFT.BESTELLEN) && (p.idx.Herkunft === undefined || p.idx.Lager_Ort === undefined))
      throw fehler('Spalten Herkunft/Lager_Ort fehlen in Auftrag_Positionen – erst Setup.', 409, 'einrichtung');
    if (plan.auftragNeu && (a.idx.Zugang_ID === undefined || a.idx.Termin_ID === undefined)) throw fehler('Spalten Zugang_ID/Termin_ID fehlen in Auftraege – erst Setup.', 409, 'einrichtung');
    const zusammen = { anzahl: plan.anzahl, zielTermin: zielTermin.Termin_ID, terminNeu: !!terminNeu, auftragNr: plan.zielAuftragNr || null, auftragNeu: !!plan.auftragNeu,
      nachtrag: plan.nachtrag, positionenNeu: plan.positionenNeu.length, positionenGeaendert: plan.positionAenderungen.length, hinweise: plan.hinweise };
    if (dryRun) return { ok: true, dryRun: true, ...zusammen };
    const terminZeile = terminNeu ? { ...terminNeu, Auftrag_Nr: plan.terminAuftragNr ?? '' } : null;
    await schreibe(sheets, spreadsheetId, {
      zellen: [
        ...plan.eintragFelder.flatMap(x => zellenAus(TAB_EINTRAEGE, e.idx, x.eintrag._zeile, x.felder)),
        ...plan.positionAenderungen.flatMap(x => zellenAus(TAB_POSITIONEN, p.idx, x.zeile, x.felder)),
        ...(!terminNeu && plan.terminAuftragNr ? zellenAus(TAB_TERMINE, daten.tr.idx, zielTermin._zeile, { Auftrag_Nr: plan.terminAuftragNr, Stand: iso }) : []),
      ],
      bloecke: [
        ...(terminZeile ? [{ tab: TAB_TERMINE, alt: daten.wt, zeilen: [alsZeile(daten.tr.idx, terminZeile, daten.wt[0].length)] }] : []),
        ...(plan.auftragNeu ? [{ tab: TAB_AUFTRAEGE, alt: wa, zeilen: [auZeile(a.idx, plan.auftragNeu, AUFTRAG_SPALTEN, wa[0].length)] }] : []),
        { tab: TAB_POSITIONEN, alt: wp, zeilen: plan.positionenNeu.map(x => auZeile(p.idx, x, POSITION_SPALTEN, wp[0].length)) },
      ],
    });
    fertigLeeren();
    console.log(`Bestellseite ${zugang.Zugang_ID}: ${plan.anzahl} Einträge nach ${zielTermin.Termin_ID} verschoben (${plan.positionenNeu.length} neue Positionen${plan.zielAuftragNr ? ` in ${plan.zielAuftragNr}` : ''}).`);
    return { ok: true, schon: false, ...zusammen };
  }));
}
