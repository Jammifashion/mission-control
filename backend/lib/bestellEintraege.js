// Bestellseite KS2: Termine und Eintraege (Lesen/Schreiben), Logik in utils/bestell-eintraege.js.
// Schreibt NUR Bestell_Termine und Bestell_Eintraege - nie Korb, Auftrag, Trikots oder Reiter der Partner-Abrechnung.
// Schreiben: gemeinsame Sperre (lib/bestellseite.js), frisch gelesen (UNFORMATTED), kein values.append (pruefeZielStrecke /
// ersetzeZeile), zurueckgelesen. Log und Chat: nur Zugang_ID, Termin-Datum, Anzahl - nie Kürzel, Namen, Texte, Token.

import { ersetzeZeile } from './sheet-zeilen.js';
import { notify } from './chatNotify.js';
import {
  mitSperre, sheetsClient, sheetId, liesFuerToken, pruefeZugang, katalogFuer, termineDesZugangs, liesEintraege, alsZeile, schreibeBloecke,
  liesZugaengeTermine,
} from './bestellseite.js';
import { TAB_TERMINE, TAB_EINTRAEGE, fehler } from '../utils/bestellseite.js';
import {
  terminPlan, auswahlIndex, absendenPlan, aenderungPlan, stornoPlan, eintragFuerSeite, absendenNachricht, EINTRAG_OPTIONAL,
} from '../utils/bestell-eintraege.js';
import { standJe, standJeSeite } from './bestellStand.js';   // KS4
import { standFuerSeite, standSumme } from '../utils/bestell-stand.js';

const t = v => String(v ?? '').trim();
const OFFEN_MC = ['eingegangen', 'geprüft'];   // KS3

async function kontext({ token, sheets: s, jetzt }) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  const daten = await liesFuerToken(sheets, spreadsheetId);
  const zugang = pruefeZugang(daten, token, jetzt);
  return { sheets, spreadsheetId, daten, zugang };
}
async function eintraegeOderEinrichtung(sheets, spreadsheetId) {
  const e = await liesEintraege(sheets, spreadsheetId);
  if (!e) throw fehler('Bestellseite ist noch nicht fertig eingerichtet – bitte bei JammiFashion melden.', 409, 'einrichtung');
  return e;
}

/**
 * GET /eintraege?termin= - alle Eintraege des Termins (dieses Zugangs), aelteste zuerst.
 * KS4: je Eintrag `fortschritt` (nur Schritt/Text/Datum/Hinweis - keine internen Angaben), `summe` je Termin (nur Zahlen) und die von hier
 * weg verschobenen Eintraege (`verschobenAuf`, nur lesen).
 */
export async function leseEintraege({ token, termin, sheets: s, jetzt = () => new Date(), quellen } = {}) {
  const { sheets, spreadsheetId, daten, zugang } = await kontext({ token, sheets: s, jetzt: jetzt() });
  const k = await katalogFuer(sheets, spreadsheetId, zugang);
  const termine = termineDesZugangs(daten, zugang, k);
  const tr = termine.find(x => x.Termin_ID === t(termin));
  if (!tr) throw fehler('Termin gibt es auf dieser Bestellseite nicht.', 404);
  const e = await liesEintraege(sheets, spreadsheetId);
  const sort = (a, b) => t(a.Zeit).localeCompare(t(b.Zeit)) || t(a.Eintrag_ID).localeCompare(t(b.Eintrag_ID));
  const alle = (e?.zeilen ?? []).filter(x => x.Zugang_ID === zugang.Zugang_ID);
  const liste = alle.filter(x => x.Termin_ID === tr.Termin_ID).sort(sort);
  const weg = alle.filter(x => x.Termin_ID !== tr.Termin_ID && t(x.Verschoben_Von) === tr.Termin_ID).sort(sort);
  const terminDatum = new Map(termine.map(x => [x.Termin_ID, t(x.Datum)]));
  let je = new Map();
  try { je = await standJeSeite({ zugangId: zugang.Zugang_ID, eintraege: liste, terminDatum, sheets, spreadsheetId, quellen }); }
  catch (err) { console.warn(`Bestellseite ${zugang.Zugang_ID}: Stand nicht lesbar (${err?.status ?? err?.code ?? 'Fehler'}).`); }
  return {
    termin: tr.Termin_ID,
    eintraege: liste.map(x => ({ ...eintragFuerSeite(x), ...(je.has(x.Eintrag_ID) ? { fortschritt: standFuerSeite(je.get(x.Eintrag_ID)) } : {}) })),
    ...(je.size ? { summe: standSumme(liste.map(x => je.get(x.Eintrag_ID))) } : {}),
    verschoben: weg.map(x => ({ ...eintragFuerSeite(x), verschobenAuf: terminDatum.get(x.Termin_ID) ?? '' })),
  };
}

/** POST /termin { datum, notiz } - nur Art dauer; gleiches Datum = vorhandener Termin. */
export async function legeTerminAn({ token, eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitSperre(async () => {
    const { sheets, spreadsheetId, daten, zugang } = await kontext({ token, sheets: s, jetzt: jetzt() });
    const plan = terminPlan({ zugang, termine: daten.tr.zeilen, eingabe, jetzt: jetzt().toISOString() });
    if (plan.vorhanden) return { ok: true, schon: true, termin: plan.vorhanden.Termin_ID };
    await schreibeBloecke(sheets, spreadsheetId, [{ tab: TAB_TERMINE, alt: daten.wt, zeilen: [alsZeile(daten.tr.idx, plan.neu, daten.wt[0].length)] }]);
    console.log(`Bestellseite ${zugang.Zugang_ID}: Termin ${plan.neu.Termin_ID} angelegt.`);
    return { ok: true, schon: false, termin: plan.neu.Termin_ID };
  });
}

function spaltenPruefen(e, zeilen) {
  const brauch = new Set(zeilen.flatMap(z => EINTRAG_OPTIONAL.filter(s => t(z[s]))));
  const fehlt = [...brauch].filter(s => e.idx[s] === undefined);
  if (fehlt.length) throw fehler('Bestellseite ist noch nicht fertig eingerichtet – bitte bei JammiFashion melden.', 409, 'einrichtung');
}

/**
 * POST /absenden { termin, kuerzel, vorgang, positionen } - EIN Schreibvorgang; gleiche Vorgang-Kennung = schon gespeichert.
 * Danach Chat an den Inhaber: nur Zugang, Anzahl, Termin-Datum.
 */
export async function sendeAb({ token, eingabe, sheets: s, jetzt = () => new Date(), melden = notify } = {}) {
  const vorgang = t(eingabe?.vorgang);
  if (!/^[\w-]{8,64}$/.test(vorgang)) throw fehler('Bitte Seite neu laden (Vorgangs-Kennung fehlt).');
  const r = await mitSperre(async () => {
    const { sheets, spreadsheetId, daten, zugang } = await kontext({ token, sheets: s, jetzt: jetzt() });
    const e = await eintraegeOderEinrichtung(sheets, spreadsheetId);
    if (e.idx.Vorgang === undefined) throw fehler('Bestellseite ist noch nicht fertig eingerichtet – bitte bei JammiFashion melden.', 409, 'einrichtung');
    const schon = e.zeilen.filter(x => x.Zugang_ID === zugang.Zugang_ID && x.Vorgang === vorgang);
    if (schon.length) return { ok: true, schon: true, anzahl: schon.length };
    const k = await katalogFuer(sheets, spreadsheetId, zugang);
    const termin = termineDesZugangs(daten, zugang, k).find(x => x.Termin_ID === t(eingabe?.termin));
    const zeilen = absendenPlan({ zugang, termin, eintraege: e.zeilen, idx: auswahlIndex({ artikel: k.artikel, trikots: k.trikots, art: zugang.Art }),
      eingabe, jetzt: jetzt().toISOString() });
    spaltenPruefen(e, zeilen);
    await schreibeBloecke(sheets, spreadsheetId, [{ tab: TAB_EINTRAEGE, alt: e.werte, zeilen: zeilen.map(z => alsZeile(e.idx, z, e.werte[0].length)) }]);
    console.log(`Bestellseite ${zugang.Zugang_ID}: ${zeilen.length} Positionen für ${termin.Termin_ID}.`);
    return { ok: true, schon: false, anzahl: zeilen.length, nachSchluss: zeilen[0]?.Nach_Schluss === 'ja', zugangId: zugang.Zugang_ID, datum: termin.Datum };
  });
  if (!r.schon) await melden(absendenNachricht({ zugangId: r.zugangId, anzahl: r.anzahl, datum: r.datum }));   // notify wirft nie
  return { ok: true, schon: r.schon, anzahl: r.anzahl, ...(r.nachSchluss ? { nachSchluss: true } : {}) };
}

async function ersetzeEintrag(sheets, spreadsheetId, e, alt, neu) {
  const breite = e.werte[0].length;
  const altZeile = e.werte[alt._zeile - 1] ?? [];
  const neuZeile = Array.from({ length: breite }, (_, i) => altZeile[i] ?? '');
  for (const [s, i] of Object.entries(e.idx)) if (neu[s] !== undefined && s !== '_zeile') neuZeile[i] = neu[s];
  try {
    await ersetzeZeile(sheets, spreadsheetId, TAB_EINTRAEGE, alt._zeile, altZeile, neuZeile);
  } catch (err) {
    if (err.status === 409) throw fehler('Wurde inzwischen geändert – bitte neu laden.', 409, 'konflikt');
    throw err;
  }
}

async function aendereEintrag({ token, eingabe, sheets: s, jetzt, plan }) {
  return mitSperre(async () => {
    const { sheets, spreadsheetId, daten, zugang } = await kontext({ token, sheets: s, jetzt: jetzt() });
    const e = await eintraegeOderEinrichtung(sheets, spreadsheetId);
    if (e.idx.Geaendert_Von === undefined) throw fehler('Bestellseite ist noch nicht fertig eingerichtet – bitte bei JammiFashion melden.', 409, 'einrichtung');
    const eintrag = e.zeilen.find(x => x.Eintrag_ID === t(eingabe?.eintrag));
    const k = await katalogFuer(sheets, spreadsheetId, zugang);
    const termin = eintrag ? termineDesZugangs(daten, zugang, k).find(x => x.Termin_ID === eintrag.Termin_ID) : null;
    const termine = termineDesZugangs(daten, zugang, k);
    const neu = plan({ zugang, termin, eintrag, idx: auswahlIndex({ artikel: k.artikel, trikots: k.trikots, art: zugang.Art }), eingabe, jetzt: jetzt().toISOString(), termine });
    spaltenPruefen(e, [neu]);
    await ersetzeEintrag(sheets, spreadsheetId, e, eintrag, neu);
    console.log(`Bestellseite ${zugang.Zugang_ID}: Eintrag ${eintrag.Eintrag_ID} ${neu.Status === 'storniert' ? 'storniert' : 'geändert'}.`);
    return { ok: true, eintrag: eintragFuerSeite(neu) };
  });
}
/** POST /aendern { eintrag, stand, kuerzel, menge?, id?, freitext?, fuer?, groesse?, name?, nummer?, wunsch?, notiz?, termin? (KS4) } */
export const aendereEintragSeite = ({ token, eingabe, sheets, jetzt = () => new Date() } = {}) => aendereEintrag({ token, eingabe, sheets, jetzt, plan: aenderungPlan });
/** POST /stornieren { eintrag, stand, kuerzel } */
export const storniereEintragSeite = ({ token, eingabe, sheets, jetzt = () => new Date() } = {}) => aendereEintrag({ token, eingabe, sheets, jetzt, plan: stornoPlan });

// ── MC (hinter requireApiKey): Eintraege eines Zugangs nur ansehen ───────────

/** GET /api/bestellseiten/:zugangId/eintraege - Termine mit Eintraegen (alle Status), nur lesen. */
export async function leseEintraegeMc({ zugangId, sheets: s, quellen } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  const e = await liesEintraege(sheets, spreadsheetId);
  const liste = (e?.zeilen ?? []).filter(x => x.Zugang_ID === t(zugangId))
    .sort((a, b) => t(a.Zeit).localeCompare(t(b.Zeit)) || t(a.Eintrag_ID).localeCompare(t(b.Eintrag_ID)));
  // KS3: fuer "ändern" in MC die waehlbaren Groessen derselben Karte bzw. des Trikots (nur offene Eintraege)
  let idx = null;
  if (liste.some(x => OFFEN_MC.includes(t(x.Status) || 'eingegangen'))) {
    try {
      const daten = await liesZugaengeTermine(sheets, spreadsheetId);
      const zugang = daten.z.zeilen.find(x => x.Zugang_ID === t(zugangId));
      if (zugang) { const k = await katalogFuer(sheets, spreadsheetId, zugang); idx = auswahlIndex({ artikel: k.artikel, trikots: k.trikots, art: zugang.Art }); }
    } catch { idx = null; }   // nur Komfort - ohne Katalog geht "ändern" ohne Groessenwahl
  }
  const alternativen = x => {
    if (!idx || t(x.Art) !== 'artikel') return undefined;
    const karte = idx.je.get(t(x.WC_Variation_ID) || t(x.LShop_ArticleNr))?.karte;
    return karte ? [...idx.je.entries()].filter(([, w]) => w.karte === karte).map(([id, w]) => ({ id, groesse: w.groesse })) : undefined;
  };
  // KS4: Stand je Eintrag (mit internen Angaben, nur MC), frisch (ohne Zwischenspeicher der Seite)
  let stand = new Map(), terminDatum = new Map();
  try {
    const d = await liesZugaengeTermine(sheets, spreadsheetId);
    terminDatum = new Map(d.tr.zeilen.filter(x => x.Zugang_ID === t(zugangId)).map(x => [x.Termin_ID, t(x.Datum)]));
    stand = await standJe({ eintraege: liste, terminDatum, sheets, spreadsheetId, quellen });
  } catch (err) { console.warn(`Bestellseite ${t(zugangId)}: Stand nicht lesbar (${err?.status ?? err?.code ?? 'Fehler'}).`); }
  // KS3: in MC zusaetzlich Auftrag/Position (Packliste, Sprung in den Auftrag) und ob die KS3-Spalte da ist
  return { zugangId: t(zugangId), eintraege: liste.map(x => ({ ...eintragFuerSeite(x), auftragNr: t(x.Auftrag_Nr), positionId: t(x.Position_ID),
      ...(stand.has(x.Eintrag_ID) ? { fortschritt: stand.get(x.Eintrag_ID) } : {}),   // KS4 (nicht `stand` - das ist der Zeitstempel)
      ...(OFFEN_MC.includes(t(x.Status) || 'eingegangen') ? { alternativen: alternativen(x), trikotGroessen: t(x.Art) === 'trikot' ? idx?.trikots.get(t(x.Trikot_Produkt))?.groessen : undefined } : {}) })),
    eingerichtet: !!e, ablehnen: !!e && e.idx.Ablehn_Grund !== undefined,
    spalten: { verschieben: !!e && e.idx.Verschoben_Von !== undefined && e.idx.Verschoben_Grund !== undefined, geliefert: !!e && e.idx.Geliefert_Am !== undefined } };
}
