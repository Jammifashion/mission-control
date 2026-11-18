// PO1: offene FP_Verkaeufe-Zeilen ab 01.07.2026 auf "Porto je Bestellung" umstellen. Logik in utils/festpreis-porto.js
// (umstellungsPlan). Ablauf: Plan (Trockenlauf) -> nur mit write: Sicherung des ganzen Reiters (lokale JSON-Datei, nicht im
// Repo/Postfach) -> Kopf X/Y/Z anlegen (wie der Sync) -> je Zeile frisch gelesen Schluessel + Status offen + Porto_Bestellung
// leer geprueft -> EIN values.batchUpdate RAW nur der Zellen I, J, K, M, N, Y, Z -> zurueckgelesen. Unter der FP-Sperre.
// Zeilen vor 01.07., abgerechnet, gesperrt oder Storno: nie.
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { mitFpSperre } from './fpSperre.js';
import { seitenListe } from './hosterPruefseite.js';
import { umstellungsPlan, satzAus, PORTO_BESTELLUNG, PORTO_VERSANDART, PORTO_SPALTEN } from '../utils/festpreis-porto.js';
import { berechneFestpreisAnteil } from '../utils/festpreis-kalkulation.js';
import { parseKonfiguration } from '../utils/partner-kalkulation.js';
import { SPALTE_SPERRE, SPERRE_INDEX, SYNC_BREITE } from '../utils/fp-sperre.js';

export const TAB = 'FP_Verkäufe';
const PORTO_INDEX = SPERRE_INDEX + 1;
const ZELLEN = ['Porto-Einnahme', 'Porto-Kosten', 'Versandnebenkosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto', PORTO_BESTELLUNG, PORTO_VERSANDART];
export const buchstabe = i => { let s = ''; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

async function lies(sheets, id, tab) {
  // FORMATTED wie der Sync und die Abrechnung (deutsche Zahlen "12,34"; toFloat/zahl lesen beides)
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${tab}'` });
  const [kopf = [], ...rows] = data.values ?? [];
  rows.forEach((r, i) => { r._sheetRow = i + 2; });
  return { kopf, rows, roh: data.values ?? [] };
}

/** Volles Porto (shipping_total, netto) je Bestellung - nur GET, include je 100, drossel() vor jedem Abruf. */
export async function ladePortoJe(wc, ids, drossel) {
  const je = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    await drossel();
    const liste = seitenListe((await wc.get('orders', { include: ids.slice(i, i + 100).join(','), per_page: 100, _fields: 'id,shipping_total' })).data, { wc, pfad: 'orders' });
    for (const o of liste) je.set(String(o.id), Number(o.shipping_total) || 0);
  }
  return je;
}

/**
 * @param {object} o { sheets, sheetId, partnerId, wc, drossel, write, sicherungOrdner, jetzt }
 * @returns Zaehler (summeAlt/summeNeu nur fuer die lokale Anzeige - nie ins Postfach oder Log)
 */
export async function portoUmstellen({ sheets, sheetId, partnerId, wc, drossel = async () => {}, write = false, sicherungOrdner, jetzt = () => new Date() }) {
  return mitFpSperre(async () => {
    const v = await lies(sheets, sheetId, TAB);
    const a = await lies(sheets, sheetId, 'FP_Artikel');
    const k = await lies(sheets, sheetId, 'Kalkulation_Fixkosten');
    const ai = c => a.kopf.indexOf(c);
    const arten = new Map(a.rows.filter(r => String(r[ai('Partner-ID')] ?? '') === partnerId)
      .map(r => [String(r[ai('Produkt-ID')] ?? '').trim(), String(r[ai('Versandart')] ?? 'P').toUpperCase() === 'B' ? 'B' : 'P']));
    const mwstProzent = parseKonfiguration(k.rows, k.kopf).mwstProzent;
    const satzAm = satzAus(parseKonfiguration, k.rows, k.kopf);
    const vi = c => v.kopf.indexOf(c);
    const kandidaten = v.rows.filter(r => String(r[vi('Partner-ID')] ?? '') === partnerId);
    const planMit = portoJe => umstellungsPlan({ kopf: v.kopf, zeilen: kandidaten, partnerId, portoJe, versandartJe: p => arten.get(p) ?? null,
      satzAm, berechne: berechneFestpreisAnteil, mwstProzent });
    const ids = [...new Set(kandidaten.map(r => String(r[vi('WC-Bestellnummer')] ?? '')).filter(Boolean))];
    const brauche = [...new Set(planMit(new Map(ids.map(x => [x, 0]))).aenderungen.map(x => x.oid))];
    const plan = planMit(await ladePortoJe(wc, brauche, drossel));
    const ergebnis = { zeilen: plan.aenderungen.length, bestellungen: plan.bestellungen, mehr: plan.mehr, weniger: plan.weniger, gleich: plan.gleich,
      fehlt: plan.fehlt, ohneVersandart: plan.ohneVersandart, summeAlt: plan.summeAlt, summeNeu: plan.summeNeu, geschrieben: 0 };
    if (!write || !plan.aenderungen.length) return ergebnis;

    // Sicherung des ganzen Reiters vor dem Schreiben (lokal, Zeitstempel im Namen)
    mkdirSync(sicherungOrdner, { recursive: true });
    const datei = join(sicherungOrdner, `FP_Verkaeufe_vor_PO1_${jetzt().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(datei, JSON.stringify(v.roh));
    ergebnis.sicherung = datei;

    // frisch lesen, Kopf pruefen bzw. X/Y/Z anlegen, je Zeile pruefen
    const frisch = await lies(sheets, sheetId, TAB);
    const fi = c => frisch.kopf.indexOf(c);
    const kopfNeu = [...frisch.kopf];
    const data = [];
    if (fi(PORTO_BESTELLUNG) === -1) {
      const breitOk = frisch.kopf.length === SYNC_BREITE || (frisch.kopf.length === SYNC_BREITE + 1 && fi(SPALTE_SPERRE) === SPERRE_INDEX);
      if (!breitOk) throw Object.assign(new Error(`${TAB}: ${frisch.kopf.length} Spalten – Porto-Spalten nicht anlegbar, nichts geschrieben.`), { status: 409 });
      kopfNeu[SPERRE_INDEX] = SPALTE_SPERRE; kopfNeu[PORTO_INDEX] = PORTO_BESTELLUNG; kopfNeu[PORTO_INDEX + 1] = PORTO_VERSANDART;
      data.push({ range: `'${TAB}'!X1:Z1`, values: [[SPALTE_SPERRE, ...PORTO_SPALTEN]] });
    } else if (fi(PORTO_BESTELLUNG) !== PORTO_INDEX || fi(PORTO_VERSANDART) !== PORTO_INDEX + 1) {
      throw Object.assign(new Error(`${TAB}: Porto-Spalten stehen nicht in Y/Z, nichts geschrieben.`), { status: 409 });
    }
    const ki = c => kopfNeu.indexOf(c);
    const nachZeile = new Map(frisch.rows.map(r => [r._sheetRow, r]));
    for (const x of plan.aenderungen) {
      const r = nachZeile.get(x.zeile);
      const sch = r ? `${String(r[fi('WC-Bestellnummer')] ?? '').trim()}|${String(r[fi('Artikelname')] ?? '').trim()}|${String(r[fi('Variante')] ?? '').trim()}` : '';
      const schonNeu = fi(PORTO_BESTELLUNG) !== -1 && String(r?.[fi(PORTO_BESTELLUNG)] ?? '') !== '';
      if (!r || sch !== x.schluessel || String(r[fi('Status Abrechnung')] ?? '').toLowerCase() !== 'offen' || schonNeu)
        throw Object.assign(new Error(`${TAB}: Zeile ${x.zeile} hat sich seit dem Plan geändert – nichts geschrieben, bitte neu starten.`), { status: 409 });
      for (const z of ZELLEN) data.push({ range: `'${TAB}'!${buchstabe(ki(z))}${x.zeile}`, values: [[x.werte[z]]] });
    }
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: sheetId, requestBody: { valueInputOption: 'RAW', data } });

    // zurueckgelesen (UNFORMATTED, Zahlen als Zahl)
    const { data: d } = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `'${TAB}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    const [nk = [], ...nr] = d.values ?? [];
    const ni = c => nk.indexOf(c);
    const abweichung = plan.aenderungen.filter(x => ZELLEN.some(z => String(nr[x.zeile - 2]?.[ni(z)] ?? '') !== String(x.werte[z])));
    ergebnis.geschrieben = plan.aenderungen.length - abweichung.length;
    if (abweichung.length) ergebnis.abweichung = abweichung.map(x => x.zeile);
    return ergebnis;
  });
}
