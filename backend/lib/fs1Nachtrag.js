// FS1 (einmalig): Fanshop-Bestueckung FP-001 als Nachtrag in die Bestellseite BS-001. Logik in utils/fs1-nachtrag.js,
// Aufruf scripts/fs1-fanshop-nachtrag.js (Trockenlauf Standard, --write erst nach Freigabe).
// Schreibt Bestell_Termine + Bestell_Eintraege wie die Bestellseite (gemeinsame Sperre, kein append, zurueckgelesen) und danach
// NUR Status + Verweis der Quellzeilen in Partner_Interne_Bestellungen (Zeile vorher frisch geprueft, zurueckgelesen).
// Nie Korb, Auftrag, Trikots, FP_Verkaeufe. Log/Ausgabe: keine Namen, keine Preise.

import {
  mitSperre, sheetsClient, sheetId, liesZugaengeTermine, liesEintraege, katalogFuer, alsZeile, schreibeBloecke,
} from './bestellseite.js';
import { TAB_TERMINE, TAB_EINTRAEGE, fristen, zugangTage } from '../utils/bestellseite.js';
import { auswahlIndex } from '../utils/bestell-eintraege.js';
import { nachtragPlan, schreibPlan, preisPlan } from '../utils/fs1-nachtrag.js';
import { mitAuftragSperre, liesAuftraege } from './auftraege.js';
import { TAB_AUFTRAEGE, TAB_POSITIONEN } from '../utils/auftraege.js';
import { nettoAusBrutto } from '../utils/auftrag-preise.js';

export const TAB_INTERN = 'Partner_Interne_Bestellungen';
export const SPALTE_VERWEIS = 'Verweis';
const t = v => String(v ?? '').trim();

const spalte = i => { let s = ''; i++; while (i > 0) { i--; s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26); } return s; };

/** Quellzeilen (formatiert, wie im Sheet sichtbar) mit echter Zeilennummer. */
export async function leseQuelle(sheets, businessId) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: businessId, range: `'${TAB_INTERN}'!A1:Z` });
  const [kopf = [], ...rest] = data.values ?? [];
  const h = n => kopf.indexOf(n);
  for (const n of ['Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Einzelpreis', 'Summe', 'Status'])
    if (h(n) === -1) throw new Error(`${TAB_INTERN}: Spalte ${n} fehlt.`);
  const zeilen = rest.map((r, i) => ({
    zeile: i + 2, partnerId: t(r[h('Partner-ID')]), datum: t(r[h('Datum')]), text: t(r[h('Bezeichnung')]), menge: t(r[h('Anzahl')]),
    einzelpreis: t(r[h('Einzelpreis')]), summe: t(r[h('Summe')]), status: t(r[h('Status')]),
    verweis: h(SPALTE_VERWEIS) === -1 ? '' : t(r[h(SPALTE_VERWEIS)]),
  }));
  return { kopf, zeilen };
}

/** ArticleNr -> CatalogNr aus LShop_Modelle (nur diese zwei Spalten). */
async function leseCatalogJe(sheets, spreadsheetId) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'LShop_Modelle'!A1:B" });
  const [kopf = [], ...rest] = data.values ?? [];
  const a = kopf.indexOf('ArticleNr'), c = kopf.indexOf('CatalogNr');
  return new Map(rest.map(r => [t(r[a]), t(r[c])]));
}

/** Alles lesen und planen (schreibt nichts). */
export async function plane({ zugangId, partnerId, von, bis, schonAb, bestaetigt, sheets: s }) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  const businessId = process.env.BUSINESS_SHEET_ID;
  const { z, tr } = await liesZugaengeTermine(sheets, spreadsheetId);
  const zugang = z.zeilen.find(x => x.Zugang_ID === zugangId);
  if (!zugang) throw new Error(`${zugangId} nicht gefunden.`);
  const termine = tr.zeilen;
  const e = await liesEintraege(sheets, spreadsheetId);
  if (!e) throw new Error('Bestell_Eintraege fehlt.');
  const k = await katalogFuer(sheets, spreadsheetId, zugang);
  const catalogJe = await leseCatalogJe(sheets, spreadsheetId);
  const quelle = await leseQuelle(sheets, businessId);
  const terminDaten = termine.filter(x => x.Zugang_ID === zugangId).map(x => t(x.Datum));
  const plan = nachtragPlan({ zeilen: quelle.zeilen, partnerId, von, bis, terminDaten, schonAb, artikel: k.artikel, catalogJe, bestaetigt });
  return { sheets, spreadsheetId, businessId, zugang, termine, eintraege: e, katalog: k, quelle, plan, terminDaten };
}

/** --write Teil 1: Termine + Eintraege. Rueckgabe: Zuordnung Quellzeile -> Termin/Eintrag. */
export async function schreibeEintraege({ ctx, kuerzel, terminNotiz, jetzt = new Date(), dryRun }) {
  return mitSperre(async () => {
    const { sheets, spreadsheetId, zugang } = ctx;
    const { tr, wt } = await liesZugaengeTermine(sheets, spreadsheetId);   // frisch
    const e = await liesEintraege(sheets, spreadsheetId);
    const idx = auswahlIndex({ artikel: ctx.katalog.artikel, trikots: ctx.katalog.trikots, art: zugang.Art });
    const p = schreibPlan({
      eintragen: ctx.plan.eintragen, zugang, termine: tr.zeilen, eintraege: e.zeilen, idx, kuerzel, terminNotiz, jetzt,
      bestellschlussFuer: d => fristen(d, zugangTage(zugang)).bestellschluss,
    });
    // Schon geschriebene (Vorgang FS1-<Zeile>) fuer die Zuordnung nachtragen.
    for (const zeile of p.uebersprungen) {
      const vor = e.zeilen.find(x => t(x.Vorgang) === `FS1-${zeile}`);
      if (vor) p.zuordnung.push({ zeile, terminId: vor.Termin_ID, eintragId: vor.Eintrag_ID, schon: true });
    }
    if (dryRun) return p;
    await schreibeBloecke(sheets, spreadsheetId, [
      { tab: TAB_TERMINE, alt: wt, zeilen: p.termineNeu.map(x => alsZeile(tr.idx, x, wt[0].length)) },
      { tab: TAB_EINTRAEGE, alt: e.werte, zeilen: p.eintraegeNeu.map(x => alsZeile(e.idx, x, e.werte[0].length)) },
    ]);
    return p;
  });
}

/**
 * --write Teil 2: Quellzeilen markieren. markierungen: [{ zeile, erwartet: { text, status }, verweis }].
 * Jede Zeile frisch gelesen und gegen Text + Status geprueft (sonst nichts geschrieben); nur Status + Verweis (RAW); zurueckgelesen.
 */
export async function markiereQuelle({ ctx, markierungen, statusWert, dryRun }) {
  const { sheets, businessId } = ctx;
  let { kopf, zeilen } = await leseQuelle(sheets, businessId);
  const stIdx = kopf.indexOf('Status');
  let vIdx = kopf.indexOf(SPALTE_VERWEIS);
  const probleme = [];
  for (const m of markierungen) {
    const z = zeilen.find(x => x.zeile === m.zeile);
    if (!z || z.text !== m.erwartet.text || z.status !== m.erwartet.status) probleme.push(m.zeile);
  }
  if (probleme.length) throw new Error(`Quellzeilen geändert seit dem Lesen: ${probleme.join(', ')} – nichts markiert.`);
  if (dryRun) return { anzahl: markierungen.length, spalteNeu: vIdx === -1 };
  const data = [];
  if (vIdx === -1) {   // additive Spalte hinten (Muster Fulfillment)
    vIdx = kopf.length;
    data.push({ range: `'${TAB_INTERN}'!${spalte(vIdx)}1`, values: [[SPALTE_VERWEIS]] });
  }
  for (const m of markierungen) {
    data.push({ range: `'${TAB_INTERN}'!${spalte(stIdx)}${m.zeile}`, values: [[statusWert]] });
    data.push({ range: `'${TAB_INTERN}'!${spalte(vIdx)}${m.zeile}`, values: [[m.verweis]] });
  }
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: businessId, requestBody: { valueInputOption: 'RAW', data } });
  ({ zeilen } = await leseQuelle(sheets, businessId));
  const falsch = markierungen.filter(m => { const z = zeilen.find(x => x.zeile === m.zeile); return !z || z.status !== statusWert || z.verweis !== m.verweis; });
  if (falsch.length) throw new Error(`Rücklesen weicht ab in Zeile(n) ${falsch.map(x => x.zeile).join(', ')}.`);
  return { anzahl: markierungen.length };
}


// ── Schritt 2: Preise an die Auftragspositionen (nach "Übernehmen" in MC) ─────────────────────────────────────────────────────

/** Plant (und mit write: schreibt) Preis_Netto leerer Positionen + Preis_Eingabe "brutto" + Stand am Auftrag; zurueckgelesen. */
export async function setzePreise({ statusWert, write = false, jetzt = new Date() }) {
  const sheets = await sheetsClient();
  const spreadsheetId = sheetId();
  const quelle = (await leseQuelle(sheets, process.env.BUSINESS_SHEET_ID)).zeilen.filter(z => z.partnerId === 'FP-001');
  const lauf = async () => {
    const e = await liesEintraege(sheets, spreadsheetId);
    const { a, p } = await liesAuftraege(sheets, spreadsheetId);
    const plan = preisPlan({ quelle, statusWert, eintraege: e.zeilen, positionen: p.zeilen, auftraege: a.zeilen, nettoAusBrutto });
    if (!write || !plan.setzen.length) return plan;
    for (const n of ['Preis_Netto']) if (p.idx[n] === undefined) throw new Error(`${TAB_POSITIONEN}: Spalte ${n} fehlt.`);
    for (const n of ['Preis_Eingabe', 'Stand']) if (a.idx[n] === undefined) throw new Error(`${TAB_AUFTRAEGE}: Spalte ${n} fehlt.`);
    const iso = jetzt.toISOString();
    const data = [
      ...plan.setzen.map(s => ({ range: `'${TAB_POSITIONEN}'!${spalte(p.idx.Preis_Netto)}${s.zeile}`, values: [[s.netto]] })),
      ...plan.auftraege.flatMap(x => [
        ...(x.setzeEingabe ? [{ range: `'${TAB_AUFTRAEGE}'!${spalte(a.idx.Preis_Eingabe)}${x.zeile}`, values: [['brutto']] }] : []),
        { range: `'${TAB_AUFTRAEGE}'!${spalte(a.idx.Stand)}${x.zeile}`, values: [[iso]] },
      ]),
    ];
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
    const { data: z } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: data.map(d => d.range), valueRenderOption: 'UNFORMATTED_VALUE' });
    const ab = data.filter((d, i) => String(z.valueRanges?.[i]?.values?.[0]?.[0] ?? '') !== String(d.values[0][0]));
    if (ab.length) throw new Error(`Rücklesen weicht in ${ab.length} Zelle(n) ab.`);
    return { ...plan, geschrieben: true };
  };
  return mitAuftragSperre(lauf);
}
