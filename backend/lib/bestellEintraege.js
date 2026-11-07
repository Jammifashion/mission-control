// Bestellseite KS2: Termine und Eintraege (Lesen/Schreiben), Logik in utils/bestell-eintraege.js.
// Schreibt NUR Bestell_Termine und Bestell_Eintraege - nie Korb, Auftrag, Trikots oder Reiter der Partner-Abrechnung.
// Schreiben: gemeinsame Sperre (lib/bestellseite.js), frisch gelesen (UNFORMATTED), kein values.append (pruefeZielStrecke /
// ersetzeZeile), zurueckgelesen. Log und Chat: nur Zugang_ID, Termin-Datum, Anzahl - nie Kürzel, Namen, Texte, Token.

import { ersetzeZeile } from './sheet-zeilen.js';
import { notify } from './chatNotify.js';
import {
  mitSperre, sheetsClient, sheetId, liesFuerToken, pruefeZugang, katalogFuer, termineDesZugangs, liesEintraege, alsZeile, schreibeBloecke,
} from './bestellseite.js';
import { TAB_TERMINE, TAB_EINTRAEGE, fehler } from '../utils/bestellseite.js';
import {
  terminPlan, auswahlIndex, absendenPlan, aenderungPlan, stornoPlan, eintragFuerSeite, absendenNachricht, EINTRAG_OPTIONAL,
} from '../utils/bestell-eintraege.js';

const t = v => String(v ?? '').trim();

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

/** GET /eintraege?termin= - alle Eintraege des Termins (dieses Zugangs), aelteste zuerst. */
export async function leseEintraege({ token, termin, sheets: s, jetzt = () => new Date() } = {}) {
  const { sheets, spreadsheetId, daten, zugang } = await kontext({ token, sheets: s, jetzt: jetzt() });
  const k = await katalogFuer(sheets, spreadsheetId, zugang);
  const tr = termineDesZugangs(daten, zugang, k).find(x => x.Termin_ID === t(termin));
  if (!tr) throw fehler('Termin gibt es auf dieser Bestellseite nicht.', 404);
  const e = await liesEintraege(sheets, spreadsheetId);
  const liste = (e?.zeilen ?? []).filter(x => x.Zugang_ID === zugang.Zugang_ID && x.Termin_ID === tr.Termin_ID)
    .sort((a, b) => t(a.Zeit).localeCompare(t(b.Zeit)) || t(a.Eintrag_ID).localeCompare(t(b.Eintrag_ID)));
  return { termin: tr.Termin_ID, eintraege: liste.map(eintragFuerSeite) };
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
    const neu = plan({ zugang, termin, eintrag, idx: auswahlIndex({ artikel: k.artikel, trikots: k.trikots, art: zugang.Art }), eingabe, jetzt: jetzt().toISOString() });
    spaltenPruefen(e, [neu]);
    await ersetzeEintrag(sheets, spreadsheetId, e, eintrag, neu);
    console.log(`Bestellseite ${zugang.Zugang_ID}: Eintrag ${eintrag.Eintrag_ID} ${neu.Status === 'storniert' ? 'storniert' : 'geändert'}.`);
    return { ok: true, eintrag: eintragFuerSeite(neu) };
  });
}
/** POST /aendern { eintrag, stand, kuerzel, menge?, id?, freitext?, fuer?, groesse?, name?, nummer?, wunsch? } */
export const aendereEintragSeite = ({ token, eingabe, sheets, jetzt = () => new Date() } = {}) => aendereEintrag({ token, eingabe, sheets, jetzt, plan: aenderungPlan });
/** POST /stornieren { eintrag, stand, kuerzel } */
export const storniereEintragSeite = ({ token, eingabe, sheets, jetzt = () => new Date() } = {}) => aendereEintrag({ token, eingabe, sheets, jetzt, plan: stornoPlan });

// ── MC (hinter requireApiKey): Eintraege eines Zugangs nur ansehen ───────────

/** GET /api/bestellseiten/:zugangId/eintraege - Termine mit Eintraegen (alle Status), nur lesen. */
export async function leseEintraegeMc({ zugangId, sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  const e = await liesEintraege(sheets, spreadsheetId);
  const liste = (e?.zeilen ?? []).filter(x => x.Zugang_ID === t(zugangId))
    .sort((a, b) => t(a.Zeit).localeCompare(t(b.Zeit)) || t(a.Eintrag_ID).localeCompare(t(b.Eintrag_ID)));
  return { zugangId: t(zugangId), eintraege: liste.map(eintragFuerSeite), eingerichtet: !!e };
}
