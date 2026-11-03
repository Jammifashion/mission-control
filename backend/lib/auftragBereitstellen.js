// AM-3: Auftrag <-> Warenkorb und Lager. Logik in utils/auftrag-bereitstellen.js.
// POST /api/auftraege/bereitstellen/vorschau  { auftragNr, teilen, ortWahl }          - schreibt nichts
// POST /api/auftraege/bereitstellen           { auftragNr, stand, teilen, ortWahl, vorgang }
// POST /api/auftraege/zuruecknehmen           { auftragNr, positionId, vorgang }
//
// Ablauf (Muster lagerKorb.js): unter Auftrags-, Korb- UND Lager-Sperre alle vier Reiter frisch lesen (Auftraege,
// Auftrag_Positionen, Warenkorb_LShop, Lager_Buchungen - alle im SSOT), Plan pruefen (Lager nie negativ, Bestand jetzt),
// Zielstrecken fuer neue Zeilen pruefen (kein append), dann EIN values.batchUpdate ueber alle Reiter, danach zurueckgelesen.
// Nichts davon steht in Log, Chat oder EDI ausser Auftragsnummer und Zahlen.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { mitKorbSperre, _korbCacheLeeren } from './lshopKorb.js';
import { leseLager, mitLagerSperre, lagerCacheLeeren } from './lager.js';
import { mitAuftragSperre, liesAuftraege, lshopInfo, nummernAus } from './auftraege.js';
import { pruefeZielStrecke, zeilenAbweichungen, spalteBuchstabe } from './sheet-zeilen.js';
import { TAB_KORB, korbZeilen, alsSheetZeile as korbAlsZeile } from '../utils/korb-logic.js';
import { aktiveOrte, alsZeile as lagerAlsZeile, TAB_BUCHUNGEN } from '../utils/lager.js';
import { TAB_AUFTRAEGE, TAB_POSITIONEN, POSITION_SPALTEN, alsZeile, aktivePositionen, fehler } from '../utils/auftraege.js';
import { bereitstellenPlan, zuruecknehmenPlan, schonBereitgestellt } from '../utils/auftrag-bereitstellen.js';

const q = tab => `'${tab}'`;
async function sheetsClient() { return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() })); }
function ssot() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  return id;
}
const mitAllenSperren = fn => mitAuftragSperre(() => mitKorbSperre('auftrag', () => mitLagerSperre(fn)));

async function lies(sheets, spreadsheetId, auftragNr) {
  const au = await liesAuftraege(sheets, spreadsheetId);
  const auftrag = au.a.zeilen.find(x => x.Auftrag_Nr === String(auftragNr ?? '').trim());
  if (!auftrag) throw fehler('Auftrag gibt es nicht.', 404);
  const korbWerte = (await sheets.spreadsheets.values.get({ spreadsheetId, range: q(TAB_KORB), valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
  const korb = korbZeilen(korbWerte);
  const l = await leseLager(sheets, spreadsheetId);
  return { au, auftrag, korbWerte, korb, l };
}

function brauchtSpalten(p, plan) {
  const fehlt = [];
  const brauche = new Set([...plan.posFelder.flatMap(x => Object.keys(x.felder)), ...(plan.posNeu.length ? ['Herkunft', 'Korb_Schluessel'] : [])]);
  for (const s of brauche) if (p.idx[s] === undefined) fehlt.push(s);
  if (fehlt.length) throw fehler(`Spalten fehlen in Auftrag_Positionen (${fehlt.join(', ')}) – erst scripts/setup-auftraege-reiter.js --write.`, 409, 'einrichtung');
}

/** Vorschau: was mit jeder Position passieren wuerde (schreibt nichts). */
export async function bereitstellenVorschau({ eingabe = {}, sheets: s, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = ssot();
  const { au, auftrag, korb, l } = await lies(sheets, spreadsheetId, eingabe.auftragNr);
  const akt = aktivePositionen(au.p.zeilen, auftrag.Auftrag_Nr);
  const { waehlbar, info } = await lshopInfo(sheets, spreadsheetId, nummernAus(akt));
  const plan = bereitstellenPlan({ auftrag, positionen: au.p.zeilen, korbZeilen: korb.zeilen, buchungen: l.buchungen, orte: aktiveOrte(l.orte),
    waehlbar, info, teilen: !!eingabe.teilen, ortWahl: eingabe.ortWahl ?? {}, jetzt: jetzt() });
  return { auftragNr: auftrag.Auftrag_Nr, stand: auftrag.Stand, vorschau: plan.vorschau, probleme: plan.probleme, knapp: plan.knapp,
    zuTun: plan.zuTun, orte: aktiveOrte(l.orte), lagerHinweis: l.einrichtung.length ? `Lager nicht eingerichtet (${l.einrichtung.join('; ')})` : '' };
}

/** Rohlinge bereitstellen: Korb + Lager + Positionen + Auftrag in EINEM Schreibaufruf. */
export async function bereitstellen({ eingabe = {}, sheets: s, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = ssot();
  return mitAllenSperren(async () => {
    const { au, auftrag, korbWerte, korb, l } = await lies(sheets, spreadsheetId, eingabe.auftragNr);
    if (schonBereitgestellt(l.buchungen, eingabe.vorgang)) return { ok: true, schon: true, auftragNr: auftrag.Auftrag_Nr };
    const akt = aktivePositionen(au.p.zeilen, auftrag.Auftrag_Nr);
    const { waehlbar, info } = await lshopInfo(sheets, spreadsheetId, nummernAus(akt));
    const plan = bereitstellenPlan({ auftrag, positionen: au.p.zeilen, korbZeilen: korb.zeilen, buchungen: l.buchungen, orte: aktiveOrte(l.orte),
      waehlbar, info, teilen: !!eingabe.teilen, ortWahl: eingabe.ortWahl ?? {}, vorgang: eingabe.vorgang, jetzt: jetzt() });
    if (!plan.zuTun && !plan.probleme.length) return { ok: true, schon: true, auftragNr: auftrag.Auftrag_Nr };   // alles schon uebergeben
    if (String(eingabe.stand ?? '').trim() !== auftrag.Stand) throw fehler(`${auftrag.Auftrag_Nr} wurde inzwischen geändert – bitte neu laden.`, 409, 'konflikt');
    if (plan.probleme.length) throw Object.assign(fehler(plan.probleme[0].text, 409, plan.probleme[0].code), { probleme: plan.probleme, knapp: plan.knapp });
    if (plan.lagerNeu.length && l.einrichtung.length) throw fehler(`Lager ist noch nicht eingerichtet (${l.einrichtung.join('; ')}).`, 409, 'einrichtung');
    brauchtSpalten(au.p, plan);

    const iso = jetzt().toISOString();
    const korbRows = plan.korbNeu.map(z => korbAlsZeile(korb.idx, z));
    const lagerRows = plan.lagerNeu.map(z => lagerAlsZeile(z, l.idxB));
    const posRows = plan.posNeu.map(z => alsZeile(au.p.idx, z, POSITION_SPALTEN, au.wp[0].length));
    const data = [], bloecke = [];
    for (const [tab, alt, rows] of [[TAB_KORB, korbWerte, korbRows], [TAB_BUCHUNGEN, l.werteB, lagerRows], [TAB_POSITIONEN, au.wp, posRows]]) {
      if (!rows.length) continue;
      const ziel = await pruefeZielStrecke(sheets, spreadsheetId, tab, alt, rows);
      bloecke.push({ tab, rows, ...ziel });
      data.push({ range: ziel.range, values: rows });
    }
    const zellen = [
      ...plan.posFelder.flatMap(x => Object.entries(x.felder).map(([f, w]) => ({ tab: TAB_POSITIONEN, zeile: x.zeile, spalte: au.p.idx[f], wert: w }))),
      { tab: TAB_AUFTRAEGE, zeile: auftrag._zeile, spalte: au.a.idx.Stand, wert: iso },
    ];
    for (const z of zellen) data.push({ range: `${q(z.tab)}!${spalteBuchstabe(z.spalte)}${z.zeile}`, values: [[z.wert]] });
    // EIN Schreibaufruf ueber Korb, Lager, Positionen und Auftrag: entweder kommt alles an oder nichts.
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
    lagerCacheLeeren();
    _korbCacheLeeren();
    await pruefeZurueck(sheets, spreadsheetId, bloecke, zellen);
    return {
      ok: true, auftragNr: auftrag.Auftrag_Nr, korb: plan.korbNeu.length, korbStueck: plan.korbNeu.reduce((x, z) => x + Number(z.Menge), 0),
      lager: plan.lagerNeu.length, lagerStueck: plan.lagerNeu.reduce((x, z) => x + Math.abs(z.Menge), 0), geteilt: plan.posNeu.length,
    };
  });
}

/** "Übergabe zurücknehmen" je Position: Korb abgewaehlt bzw. Lager-Gegenbuchung, Vermerk an der Position leer - ein Schritt. */
export async function zuruecknehmen({ eingabe = {}, sheets: s, jetzt = () => new Date() } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = ssot();
  return mitAllenSperren(async () => {
    const { au, auftrag, korb, l } = await lies(sheets, spreadsheetId, eingabe.auftragNr);
    const plan = zuruecknehmenPlan({ auftrag, positionen: au.p.zeilen, positionId: eingabe.positionId, korbZeilen: korb.zeilen,
      buchungen: l.buchungen, vorgang: eingabe.vorgang, jetzt: jetzt() });
    if (plan.unveraendert) return { ok: true, unveraendert: true, auftragNr: auftrag.Auftrag_Nr };
    const iso = jetzt().toISOString();
    const data = [], bloecke = [];
    const lagerRows = plan.lagerNeu.map(z => lagerAlsZeile(z, l.idxB));
    if (lagerRows.length) {
      const ziel = await pruefeZielStrecke(sheets, spreadsheetId, TAB_BUCHUNGEN, l.werteB, lagerRows);
      bloecke.push({ tab: TAB_BUCHUNGEN, rows: lagerRows, ...ziel });
      data.push({ range: ziel.range, values: lagerRows });
    }
    const zellen = [
      ...(plan.korb ? Object.entries(plan.korb.werte).map(([f, w]) => ({ tab: TAB_KORB, zeile: plan.korb.zeile, spalte: korb.idx[f], wert: w })) : []),
      ...Object.entries(plan.posFelder).filter(([f]) => au.p.idx[f] !== undefined).map(([f, w]) => ({ tab: TAB_POSITIONEN, zeile: plan.position._zeile, spalte: au.p.idx[f], wert: w })),
      { tab: TAB_AUFTRAEGE, zeile: auftrag._zeile, spalte: au.a.idx.Stand, wert: iso },
    ];
    for (const z of zellen) data.push({ range: `${q(z.tab)}!${spalteBuchstabe(z.spalte)}${z.zeile}`, values: [[z.wert]] });
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
    lagerCacheLeeren();
    _korbCacheLeeren();
    await pruefeZurueck(sheets, spreadsheetId, bloecke, zellen);
    return { ok: true, auftragNr: auftrag.Auftrag_Nr, positionId: plan.position.Position_ID, korb: !!plan.korb, lager: plan.lagerNeu.length };
  });
}

// Zuruecklesen: jede geschriebene Zelle und jede neue Zeile.
async function pruefeZurueck(sheets, spreadsheetId, bloecke, zellen) {
  const tabs = [...new Set([...bloecke.map(b => b.tab), ...zellen.map(z => z.tab)])];
  const { data } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: tabs.map(q), valueRenderOption: 'UNFORMATTED_VALUE' });
  const werte = Object.fromEntries(tabs.map((t, i) => [t, data.valueRanges?.[i]?.values ?? []]));
  let ab = 0;
  for (const z of zellen) ab += zeilenAbweichungen([[z.wert]], [[werte[z.tab][z.zeile - 1]?.[z.spalte]]]).length;
  for (const b of bloecke) ab += zeilenAbweichungen(b.rows, werte[b.tab].slice(b.start - 1, b.ende)).length;
  if (ab) throw fehler(`Rücklesen weicht in ${ab} Zelle(n) ab – bitte im Sheet prüfen.`, 500, 'ruecklesen');
}
