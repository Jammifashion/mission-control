// KS3: Bestellseite in MC pruefen, aendern, ablehnen, in einen Auftrag je Termin uebernehmen, "schon bestellt – verknüpfen".
// Logik in utils/bestell-uebernahme.js. Alles hinter requireApiKey (routes/bestellseiten.js).
//
// Schreiben: Bestellseiten-Sperre (lib/bestellseite.js) UND Auftrags-Sperre (lib/auftraege.js), alle SSOT-Reiter frisch gelesen
// (UNFORMATTED), kein values.append (neue Zeilen in die ueber pruefeZielStrecke gepruefte Strecke), EIN values.batchUpdate
// ueber Auftraege + Auftrag_Positionen + Bestell_Eintraege + Bestell_Termine, zurueckgelesen. Trikots ueber den TR6-Weg
// (lib/trikotIntern.js, Business-Sheet, eigener Schreibvorgang VORHER; gleiche Vorgang-Kennung = schon angelegt -> ein
// erneuter Lauf nach einem Teil-Fehler legt nichts doppelt an). Nie Korb, nie Lager (das macht AM-3 "Rohlinge bereitstellen"),
// nie Partner-Reiter. Log: nur IDs und Anzahlen - nie Kürzel, Notizen, Rückennamen, Texte.

import { createHash } from 'crypto';
import { pruefeZielStrecke, spalteBuchstabe, zeilenAbweichungen } from './sheet-zeilen.js';
import { mitSperre, sheetsClient, sheetId, liesZugaengeTermine, liesEintraege, katalogFuer, termineDesZugangs } from './bestellseite.js';
import { mitAuftragSperre, liesAuftraege, lshopInfo, _auftraegeCacheLeeren } from './auftraege.js';
import { legeInterneTrikotsAn } from './trikotIntern.js';
import { bereitstellen } from './auftragBereitstellen.js';
import { leseReiterSpalten } from './ssot-reiter.js';
import { leseLagerFuerKorb } from './lager.js';
import { TAB_KORB, korbZeilen } from '../utils/korb-logic.js';
import { TAB_TERMINE, TAB_EINTRAEGE, fehler } from '../utils/bestellseite.js';
import { auswahlIndex, aenderungPlan, eintragFuerSeite, E_STATUS } from '../utils/bestell-eintraege.js';
import {
  TAB_AUFTRAEGE, TAB_POSITIONEN, AUFTRAG_SPALTEN, POSITION_SPALTEN, alsZeile as auZeile, HERKUNFT,
} from '../utils/auftraege.js';
import {
  mcPruefPlan, verknuepfKandidaten, verknuepfungAus, uebernahmePlan, anhaengbareAuftraege, terminAuftraege, eintraegeJePosition,
  ungepruefteZahlen, UEBERNEHMBAR, herkunftVorschlag, festpreisFuer,
} from '../utils/bestell-uebernahme.js';

const t = v => String(v ?? '').trim();

/** Bestell_Eintraege lesen oder 409 einrichtung; Pflicht fuer KS3: Status, Auftrag_Nr, Position_ID, Stand (+ optionale wie gebraucht). */
export async function eintraegeOder409(sheets, spreadsheetId, brauche = []) {
  const e = await liesEintraege(sheets, spreadsheetId);
  if (!e) throw fehler('Reiter Bestell_Eintraege fehlt – scripts/setup-bestellseiten-reiter.js --write.', 409, 'einrichtung');
  const fehlt = brauche.filter(s => e.idx[s] === undefined);
  if (fehlt.length) throw fehler(`Spalte fehlt in Bestell_Eintraege (${fehlt.join(', ')}) – scripts/setup-bestellseiten-reiter.js --write.`, 409, 'einrichtung');
  return e;
}

/** Zellen + neue Zeilen in EINEM batchUpdate (gleiches Sheet), danach die beschriebenen Bereiche zurueckgelesen. */
export async function schreibe(sheets, spreadsheetId, { zellen = [], bloecke = [] }) {   // KS4: auch fuer Verschieben/geliefert
  const data = zellen.map(z => ({ range: `'${z.tab}'!${spalteBuchstabe(z.spalte)}${z.zeile}`, values: [[z.wert]] }));
  const strecken = [];
  for (const b of bloecke) {
    if (!b.zeilen.length) continue;
    const s = await pruefeZielStrecke(sheets, spreadsheetId, b.tab, b.alt, b.zeilen);
    strecken.push({ ...b, ...s });
    data.push({ range: s.range, values: b.zeilen });
  }
  if (!data.length) return;
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
  const { data: zurueck } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: data.map(d => d.range), valueRenderOption: 'UNFORMATTED_VALUE' });
  const ab = data.reduce((n, d, i) => n + zeilenAbweichungen(d.values, zurueck.valueRanges?.[i]?.values ?? []).length, 0);
  if (ab) throw fehler(`Bestellseite/Auftrag: Rücklesen weicht in ${ab} Zelle(n) ab – bitte prüfen.`, 500, 'ruecklesen');
}
export const zellenAus = (tab, idx, zeile, felder) => Object.entries(felder).filter(([f]) => idx[f] !== undefined).map(([f, wert]) => ({ tab, zeile, spalte: idx[f], wert }));

export async function zugangUndTermin(sheets, spreadsheetId, zugangId, terminId) {
  const daten = await liesZugaengeTermine(sheets, spreadsheetId);
  const zugang = daten.z.zeilen.find(x => x.Zugang_ID === t(zugangId));
  if (!zugang) throw fehler('Zugang gibt es nicht.', 404);
  const termin = terminId === undefined ? null : daten.tr.zeilen.find(x => x.Termin_ID === t(terminId) && x.Zugang_ID === zugang.Zugang_ID);
  if (terminId !== undefined && !termin) throw fehler('Termin gibt es auf dieser Bestellseite nicht.', 404);
  return { daten, zugang, termin };
}

// ── Pruefen / Ablehnen / Aendern ─────────────────────────────────────────────

/** POST /api/bestellseiten/eintraege/pruefen { zugangId, aktion: geprueft|zurueck|ablehnen, auswahl:[{id,stand}], grund } */
export async function pruefeEintraege({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const aktion = t(eingabe?.aktion);
    const e = await eintraegeOder409(sheets, spreadsheetId, aktion === 'ablehnen' ? ['Ablehn_Grund', 'Geaendert_Von'] : []);
    const { plan, unveraendert } = mcPruefPlan({ zugangId: eingabe?.zugangId, eintraege: e.zeilen, auswahl: eingabe?.auswahl, aktion, grund: eingabe?.grund, jetzt: jetzt().toISOString() });
    const felder = aktion === 'ablehnen' ? ['Status', 'Ablehn_Grund', 'Geaendert_Von', 'Stand'] : ['Status', 'Stand'];
    await schreibe(sheets, spreadsheetId, { zellen: plan.flatMap(p => zellenAus(TAB_EINTRAEGE, e.idx, p.eintrag._zeile, Object.fromEntries(felder.map(f => [f, p.neu[f]])))) });
    console.log(`Bestellseite ${t(eingabe?.zugangId)}: ${plan.length} Einträge ${aktion}.`);
    return { ok: true, geaendert: plan.length, unveraendert, eintraege: plan.map(p => eintragFuerSeite(p.neu)) };
  });
}

/** POST /api/bestellseiten/eintraege/aendern { zugangId, eintrag, stand, menge?, id?, freitext?, fuer?, groesse?, name?, nummer?, wunsch?, notiz? } */
export async function aendereEintragMc({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  return mitSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { daten, zugang } = await zugangUndTermin(sheets, spreadsheetId, eingabe?.zugangId);
    const e = await eintraegeOder409(sheets, spreadsheetId, ['Geaendert_Von']);
    const eintrag = e.zeilen.find(x => x.Eintrag_ID === t(eingabe?.eintrag) && x.Zugang_ID === zugang.Zugang_ID);
    const k = await katalogFuer(sheets, spreadsheetId, zugang);
    const termin = eintrag ? termineDesZugangs(daten, zugang, k).find(x => x.Termin_ID === eintrag.Termin_ID) : null;
    const neu = aenderungPlan({ zugang, termin, eintrag, idx: auswahlIndex({ artikel: k.artikel, trikots: k.trikots, art: zugang.Art, personalisierung: String(zugang.Personalisierung ?? '').trim() === 'ja' }), eingabe, jetzt: jetzt().toISOString(), vonMc: true });
    const felder = Object.fromEntries(Object.keys(e.idx).filter(f => f !== '_zeile' && t(neu[f]) !== t(eintrag[f])).map(f => [f, neu[f]]));
    await schreibe(sheets, spreadsheetId, { zellen: zellenAus(TAB_EINTRAEGE, e.idx, eintrag._zeile, felder) });
    console.log(`Bestellseite ${zugang.Zugang_ID}: Eintrag ${eintrag.Eintrag_ID} in MC geändert.`);
    return { ok: true, eintrag: eintragFuerSeite(neu) };
  });
}

// ── Kandidaten fuer "schon bestellt – verknüpfen" ────────────────────────────

async function kandidatenKontext(sheets, spreadsheetId) {
  let korb = [];
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_KORB}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    korb = korbZeilen(data.values ?? []).zeilen;
  } catch { korb = []; }
  const { bestand } = await leseLagerFuerKorb(sheets, spreadsheetId);
  const lager = new Map([...bestand.entries()].map(([nr, g]) => [`LS:${nr}`, g.orte]));
  return { korb, lager, bestand };
}

/** GET /api/bestellseiten/:zugangId/termin/:terminId/uebernahme - Vorschau: anhaengbare Auftraege + Kandidaten je Eintrag. Nur lesen. */
export async function uebernahmeVorschau({ zugangId, terminId, sheets: s, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  const { zugang, termin } = await zugangUndTermin(sheets, spreadsheetId, zugangId, terminId);
  const e = await liesEintraege(sheets, spreadsheetId);
  const { a, p } = await liesAuftraege(sheets, spreadsheetId);
  const ctx = await kandidatenKontext(sheets, spreadsheetId);
  // KS8: alle offenen Eintraege (eingegangen + Altstand geprüft), dazu ein Herkunft-Vorschlag je Eintrag
  const geprueft = (e?.zeilen ?? []).filter(x => x.Termin_ID === termin.Termin_ID && x.Zugang_ID === zugang.Zugang_ID && UEBERNEHMBAR.includes(t(x.Status) || E_STATUS.EINGEGANGEN));
  const ohne = terminAuftraege(termin);
  const { waehlbar } = await lshopInfo(sheets, spreadsheetId, new Set(geprueft.map(x => t(x.LShop_ArticleNr)).filter(Boolean)));
  return {
    vorschlag: Object.fromEntries(geprueft.map(x => [x.Eintrag_ID, herkunftVorschlag(x, { waehlbar, bestand: ctx.bestand })])),
    terminAuftraege: ohne, anhaengbar: anhaengbareAuftraege({ zugang, termin, auftraege: a.zeilen }),
    kandidaten: Object.fromEntries(geprueft.map(x => [x.Eintrag_ID, verknuepfKandidaten({
      eintrag: x, korb: ctx.korb, auftraege: a.zeilen, positionen: p.zeilen, kundenNr: zugang.Kunden_Nr, lager: ctx.lager, ohneAuftraege: ohne, jetzt: jetzt().toISOString(),
    })])),
    spalten: { verweis: p.idx.Verweis !== undefined, zugang: a.idx.Zugang_ID !== undefined && a.idx.Termin_ID !== undefined, herkunft: p.idx.Herkunft !== undefined },
  };
}

// ── Uebernehmen ──────────────────────────────────────────────────────────────

const trikotVorgang = (terminId, ids) => `KS3-${t(terminId)}-${createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 16)}`;

/**
 * POST /api/bestellseiten/uebernehmen { zugangId, terminId, auswahl:[{id,stand}], ziel: ''|'neu'|'AU-…', verknuepfen: { <Eintrag_ID>: { verweis } | { ohne, notiz } }, vorgang, dryRun }
 * Ein AU je Termin; Trikots ueber TR6 (Referenz = AU-Nr., Wunsch im Rohtext). dryRun: nur Plan (Anzahlen), nichts geschrieben.
 */
export async function uebernehmen({ eingabe, sheets: s, jetzt = () => new Date(), trikotsAnlegen = legeInterneTrikotsAn } = {}) {
  const vorgang = t(eingabe?.vorgang);
  const dryRun = eingabe?.dryRun === true;
  if (!dryRun && !/^[\w-]{8,64}$/.test(vorgang)) throw fehler('Vorgangs-Kennung fehlt.', 422);
  return mitSperre(() => mitAuftragSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { daten, zugang, termin } = await zugangUndTermin(sheets, spreadsheetId, eingabe?.zugangId, eingabe?.terminId);
    const e = await eintraegeOder409(sheets, spreadsheetId, ['Status', 'Auftrag_Nr', 'Position_ID', 'Stand']);
    const { wa, wp, a, p } = await liesAuftraege(sheets, spreadsheetId);
    // Doppelklick: dieselbe Vorgang-Kennung hat schon einen Auftrag angelegt
    const schon = a.zeilen.find(x => x.Vorgang === `KS3-${vorgang}`);
    if (schon && !dryRun) return { ok: true, schon: true, auftragNr: schon.Auftrag_Nr };
    const k = await katalogFuer(sheets, spreadsheetId, zugang);
    const idx = auswahlIndex({ artikel: k.artikel, trikots: k.trikots, art: zugang.Art, personalisierung: String(zugang.Personalisierung ?? '').trim() === 'ja' });
    const auswahl = Array.isArray(eingabe?.auswahl) ? eingabe.auswahl : [];
    const gewaehlt = e.zeilen.filter(x => auswahl.some(w => t(w?.id) === x.Eintrag_ID));
    const { waehlbar } = await lshopInfo(sheets, spreadsheetId, new Set(gewaehlt.map(x => t(x.LShop_ArticleNr)).filter(Boolean)));
    // Verknuepfungen: nur Kandidaten, die der Server selbst findet (oder "ohne Verweis" mit Notiz)
    const wahl = eingabe?.verknuepfen && typeof eingabe.verknuepfen === 'object' ? eingabe.verknuepfen : {};
    const verknuepft = new Map();
    if (Object.keys(wahl).length) {
      const ctx = await kandidatenKontext(sheets, spreadsheetId);
      for (const [id, w] of Object.entries(wahl)) {
        const x = gewaehlt.find(y => y.Eintrag_ID === id);
        if (!x) throw fehler(`Eintrag ${id} ist nicht in der Auswahl.`);
        const kandidaten = verknuepfKandidaten({ eintrag: x, korb: ctx.korb, auftraege: a.zeilen, positionen: p.zeilen, kundenNr: zugang.Kunden_Nr,
          lager: ctx.lager, ohneAuftraege: terminAuftraege(termin), jetzt: jetzt().toISOString() });
        verknuepft.set(id, verknuepfungAus(w, kandidaten, id));
      }
    }
    // KS8: Herkunft je Eintrag (Vorschlag aus der Vorschau, am Eintrag aenderbar) - eine Verknuepfung "schon bestellt" geht vor
    const herkunftWahl = eingabe?.herkunft && typeof eingabe.herkunft === 'object' ? eingabe.herkunft : {};
    if (Object.keys(herkunftWahl).length) {
      const ctx = await kandidatenKontext(sheets, spreadsheetId);
      for (const [id, wahl] of Object.entries(herkunftWahl)) {
        if (verknuepft.has(id)) continue;
        const x = gewaehlt.find(y => y.Eintrag_ID === id);
        if (!x) throw fehler(`Eintrag ${id} ist nicht in der Auswahl.`);
        if (wahl === HERKUNFT.VORHANDEN) verknuepft.set(id, { herkunft: HERKUNFT.VORHANDEN, verweis: '', lagerOrt: '' });
        else if (wahl === HERKUNFT.LAGER) {
          const v = herkunftVorschlag(x, { waehlbar, bestand: ctx.bestand });
          if (v.herkunft !== HERKUNFT.LAGER) throw fehler(`Eintrag ${id}: nicht genug im Lager – „neu bestellen“ wählen.`, 409, 'knapp');
          verknuepft.set(id, { herkunft: HERKUNFT.LAGER, verweis: '', lagerOrt: v.ort });
        } else if (wahl !== HERKUNFT.BESTELLEN) throw fehler(`Eintrag ${id}: Herkunft unbekannt.`);
      }
    }
    // KS8: Festpreis bei Kunden mit Festpreis-Partner (nur lesen, Business-Sheet)
    const preisJe = await festpreiseFuer({ sheets, zugang, eintraege: gewaehlt, idx });
    const plan = uebernahmePlan({
      zugang, termin, eintraege: e.zeilen, auswahl, auftraege: a.zeilen, positionen: p.zeilen,
      motivJe: new Map([...idx.je.entries()].map(([id, x]) => [id, { motiv: x.motiv }])), waehlbar, verknuepft,
      ziel: eingabe?.ziel, vorgang, jetzt: jetzt().toISOString(), preisJe,
    });
    if (plan.positionenNeu.some(x => x.Preis_Netto !== undefined && x.Preis_Netto !== '') && p.idx.Preis_Netto === undefined)
      throw fehler('Spalte Preis_Netto fehlt in Auftrag_Positionen – erst scripts/setup-auftraege-reiter.js --write.', 409, 'einrichtung');
    // Spalten pruefen, bevor irgendetwas geschrieben wird
    if (plan.auftragNeu && (a.idx.Zugang_ID === undefined || a.idx.Termin_ID === undefined))
      throw fehler('Spalten Zugang_ID/Termin_ID fehlen in Auftraege – erst scripts/setup-auftraege-reiter.js --write.', 409, 'einrichtung');
    if (plan.auftragNeu && a.idx.Design_Am === undefined) throw fehler('Spalte Design_Am fehlt in Auftraege – erst scripts/setup-auftraege-reiter.js --write.', 409, 'einrichtung');   // AM-8
    if (plan.positionenNeu.some(x => x.Verweis) && p.idx.Verweis === undefined)
      throw fehler('Spalte Verweis fehlt in Auftrag_Positionen – erst scripts/setup-auftraege-reiter.js --write.', 409, 'einrichtung');
    if (plan.positionenNeu.some(x => x.Herkunft && x.Herkunft !== HERKUNFT.BESTELLEN) && (p.idx.Herkunft === undefined || p.idx.Lager_Ort === undefined))
      throw fehler('Spalten Herkunft/Lager_Ort fehlen in Auftrag_Positionen – erst scripts/setup-auftraege-reiter.js --write.', 409, 'einrichtung');
    const zusammen = {
      auftragNr: plan.auftragNr, neu: !!plan.auftragNeu, nachtrag: plan.nachtrag, eintraege: plan.anzahl,
      positionen: plan.positionenNeu.length, lshop: plan.positionenNeu.filter(x => x.Art === 'lshop').length, frei: plan.positionenNeu.filter(x => x.Art === 'frei').length,
      vorhanden: plan.positionenNeu.filter(x => x.Herkunft === HERKUNFT.VORHANDEN).length, lager: plan.positionenNeu.filter(x => x.Herkunft === HERKUNFT.LAGER).length,
      trikots: plan.trikots.length, hinweise: plan.hinweise, positionIds: plan.positionenNeu.map(x => x.Position_ID),
      festpreis: preisJe ? { partner: preisJe.partner, mitPreis: plan.positionenNeu.filter(x => x.Preis_Netto !== undefined && x.Preis_Netto !== '').length } : null,
    };
    if (dryRun) return { ok: true, dryRun: true, ...zusammen };

    // 1. Trikots (TR6, Business-Sheet) - gleiche Eintraege = gleiche Vorgang-Kennung = schon angelegt
    let trikotIds = [];
    if (plan.trikots.length) {
      const r = await trikotsAnlegen({
        trikots: plan.trikots.map(({ produktId, groesse, name, nummer, notiz }) => ({ produktId, groesse, name, nummer, notiz })),
        referenz: plan.auftragNr, vorgang: trikotVorgang(termin.Termin_ID, plan.trikots.map(x => x.eintragId)),
      });
      trikotIds = r.ids ?? [];
      if (trikotIds.length !== plan.trikots.length) throw fehler('Trikots: Anzahl der angelegten Zeilen passt nicht – bitte prüfen, nichts weiter geschrieben.', 500, 'trikots');
    }
    // 2. SSOT in EINEM Schreibvorgang: Auftrag (neu), Positionen, Eintraege, Termin
    const zellen = [];
    for (const f of plan.eintragFelder) {
      const felder = f.trikot !== undefined ? { ...f.felder, Position_ID: trikotIds[f.trikot] } : f.felder;
      zellen.push(...zellenAus(TAB_EINTRAEGE, e.idx, f.eintrag._zeile, felder));
    }
    if (plan.terminAuftragNr) zellen.push(...zellenAus(TAB_TERMINE, daten.tr.idx, termin._zeile, { Auftrag_Nr: plan.terminAuftragNr, Stand: jetzt().toISOString() }));
    await schreibe(sheets, spreadsheetId, {
      zellen,
      bloecke: [
        ...(plan.auftragNeu ? [{ tab: TAB_AUFTRAEGE, alt: wa, zeilen: [auZeile(a.idx, plan.auftragNeu, AUFTRAG_SPALTEN, wa[0].length)] }] : []),
        { tab: TAB_POSITIONEN, alt: wp, zeilen: plan.positionenNeu.map(x => auZeile(p.idx, x, POSITION_SPALTEN, wp[0].length)) },
      ],
    });
    _auftraegeCacheLeeren();
    console.log(`Bestellseite ${zugang.Zugang_ID}: ${plan.anzahl} Einträge von ${termin.Termin_ID} übernommen in ${plan.auftragNr} (${plan.positionenNeu.length} Positionen, ${plan.trikots.length} Trikots).`);
    return { ok: true, schon: false, ...zusammen, trikotIds };
  }));
}

// ── KS8: Festpreis, Uebernehmen + gleich bereitstellen ───────────────────────

/**
 * Festpreise der gewaehlten Eintraege (Map Eintrag_ID -> { netto } | { grund }) oder null, wenn der Kunde keinen Festpreis-Partner hat.
 * Partner: `Partner_ID` am Zugang (FP-…) bzw. FP_Partner mit gleicher Kunden_Nr (wie GS2). Nur lesen.
 */
async function festpreiseFuer({ sheets, zugang, eintraege, idx }) {
  const business = process.env.BUSINESS_SHEET_ID;
  if (!business) return null;
  let partnerId = /^FP-\d+$/.test(t(zugang.Partner_ID)) ? t(zugang.Partner_ID) : '';
  try {
    if (!partnerId) {
      let fp;
      try { fp = await leseReiterSpalten({ tab: 'FP_Partner', spalten: { partnerId: 'Partner-ID' }, optional: { kundenNr: 'Kunden_Nr' }, sheets, spreadsheetId: business }); }
      catch (err) { if (/Unable to parse range/i.test(err.message ?? '') || err.code === 400 || err.status === 400) return null; throw err; }   // keine FP-Partner eingerichtet
      partnerId = t(fp.find(x => t(x.kundenNr) && t(x.kundenNr) === t(zugang.Kunden_Nr))?.partnerId);
    }
    if (!partnerId) return null;
    const [fpArtikel, fpKategorie] = [
      await leseReiterSpalten({ tab: 'FP_Artikel', spalten: { partnerId: 'Partner-ID', produktId: 'Produkt-ID', artikelkategorie: 'Artikelkategorie' }, sheets, spreadsheetId: business }),
      await leseReiterSpalten({ tab: 'FP_Artikel_Kategorie', spalten: { kategorie: 'Kategorie', partnerId: 'Festpreispartner-ID', festpreis: 'Festpreis' }, sheets, spreadsheetId: business }),
    ];
    const aus = new Map();
    for (const e of eintraege) {
      const karte = idx.je.get(t(e.WC_Variation_ID))?.karte ?? '';
      aus.set(e.Eintrag_ID, festpreisFuer({ produktId: karte.split('|')[0], partnerId, fpArtikel, fpKategorie }));
    }
    aus.partner = partnerId;
    return aus;
  } catch (err) {
    const aus = new Map(eintraege.map(e => [e.Eintrag_ID, { grund: `Festpreis nicht lesbar (${err.code || err.status || 'Fehler'})` }]));
    aus.partner = partnerId || '?';
    return aus;
  }
}

/**
 * KS8: Uebernehmen und die neuen Positionen gleich bereitstellen ("neu bestellen" -> L-Shop-Korb, "aus Lager" -> ausgebucht; Inhaber
 * 27.11.: sofort). Bereitstellen laeuft NACH dem Uebernehmen unter seinen eigenen Sperren; scheitert es, steht der Auftrag trotzdem und
 * die Antwort traegt `bereitstellen.fehler` (dann wie bisher "Rohlinge bereitstellen …" im Auftrag).
 */
export async function uebernehmenUndBereitstellen({ eingabe, sheets: s, jetzt = () => new Date(), trikotsAnlegen, bereitstellenFn = bereitstellen } = {}) {
  const r = await uebernehmen({ eingabe, sheets: s, jetzt, ...(trikotsAnlegen ? { trikotsAnlegen } : {}) });
  if (r.dryRun || r.schon || eingabe?.bereitstellen !== true || !r.positionIds?.length || !(r.lshop > 0)) return r;
  try {
    const sheets = s ?? await sheetsClient();
    const { a } = await liesAuftraege(sheets, sheetId());
    const au = a.zeilen.find(x => x.Auftrag_Nr === r.auftragNr);
    const b = await bereitstellenFn({ eingabe: { auftragNr: r.auftragNr, stand: au?.Stand ?? '', teilen: true, nurPositionen: r.positionIds,
      vorgang: `KS8-${t(eingabe.vorgang).replace(/_/g, '-')}`.slice(0, 64) }, sheets: s, jetzt });
    return { ...r, bereitstellen: { korb: b.korb ?? 0, lager: b.lager ?? 0, schon: !!b.schon } };
  } catch (err) {
    return { ...r, bereitstellen: { fehler: `Rohlinge nicht bereitgestellt (${err.message}) – im Auftrag „Rohlinge bereitstellen …“.` } };
  }
}

// ── Anzeige ──────────────────────────────────────────────────────────────────

/** GET /api/bestellseiten/auftrag/:nr/eintraege - Kürzel/Notiz je Position, nur Anzeige in MC (nie in den Auftrag kopiert). */
export async function eintraegeZumAuftrag({ auftragNr, sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  const e = await liesEintraege(sheets, sheetId());
  return { auftragNr: t(auftragNr), eintraege: eintraegeJePosition(e?.zeilen ?? [], auftragNr) };
}

/** Dashboard: ungeprüfte Eintraege je Zugang (nur Zahlen). Fehlt der Reiter: 0. */
export async function leseUngepruefte({ sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  const e = await liesEintraege(sheets, sheetId());
  return ungepruefteZahlen(e?.zeilen ?? []);
}
