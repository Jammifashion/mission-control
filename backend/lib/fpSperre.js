// PA8: FP-Sperre - Nachrechnen gesperrter FP_Verkaeufe-Zeilen und Sperre je Instanz. Logik in utils/fp-sperre.js.
// Schreiben: unter der Sperre, frisch gelesen, je Zeile vor dem Schreiben Schluessel + Status "gesperrt" geprueft (sonst
// uebersprungen), EIN batchUpdate RAW nur der geaenderten Zellen, zurueckgelesen. Abgerechnete/offene Zeilen fasst das nie an.
// Log/Antwort: nur Anzahlen und Produkt-IDs, nie Betraege.

import { colLetter } from '../utils/sheet-spalten.js';
import { parseKonfiguration } from '../utils/partner-kalkulation.js';
import {
  STATUS_GESPERRT, STATUS_SPALTE, SPALTE_SPERRE, festpreisZuordnungen, nachrechnenPlan, zeilenSchluessel, gesperrtZaehlen,
} from '../utils/fp-sperre.js';

export const TAB_FP_VERKAEUFE = 'FP_Verkäufe';
const t = v => String(v ?? '').trim();

let laeuft = false;
/** Eine Sperre je Instanz fuer FP-Sync und Nachrechnen. Belegt -> 409 laeuft_gerade. */
export async function mitFpSperre(fn) {
  if (laeuft) throw Object.assign(new Error('FP-Verkäufe werden gerade geschrieben – gleich noch einmal.'), { status: 409, code: 'laeuft_gerade' });
  laeuft = true;
  try { return await fn(); } finally { laeuft = false; }
}

async function lies(sheets, spreadsheetId, tab) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'` });
  const [kopf = [], ...z] = data.values ?? [];
  z.forEach((r, i) => { r._sheetRow = i + 2; });
  return { kopf: kopf.map(k => t(k)), zeilen: z.filter(r => r.some(c => t(c))) };
}

/**
 * Gesperrte Zeilen nachrechnen, deren Artikel jetzt eine gueltige Festpreis-Zuordnung hat.
 * Ohne eigene Sperre - Aufrufer: `nachrechnen` (Knopf) und der FP-Sync (erster Schritt, schon unter der Sperre).
 * @returns {Promise<{ nachgerechnet: number, nochGesperrt: number, produktIds: string[], dryRun: boolean }>}
 */
export async function nachrechnenInSperre({ sheets, spreadsheetId, dryRun = false } = {}) {
  const v = await lies(sheets, spreadsheetId, TAB_FP_VERKAEUFE);
  const h = c => v.kopf.indexOf(c);
  if (h(SPALTE_SPERRE) === -1 || !v.zeilen.some(r => t(r[h(STATUS_SPALTE)]) === STATUS_GESPERRT))
    return { nachgerechnet: 0, nochGesperrt: 0, produktIds: [], dryRun };
  const art = await lies(sheets, spreadsheetId, 'FP_Artikel');
  const ah = c => art.kopf.indexOf(c);
  const katJe = new Map();
  for (const r of art.zeilen) {
    const k = `${t(r[ah('Partner-ID')])}|${t(r[ah('Produkt-ID')])}`;
    katJe.set(k, katJe.has(k) ? null : t(r[ah('Artikelkategorie')]));   // doppelt = nicht eindeutig -> nicht nachrechnen
  }
  const ak = await lies(sheets, spreadsheetId, 'FP_Artikel_Kategorie');
  const fk = await lies(sheets, spreadsheetId, 'Kalkulation_Fixkosten');
  const mwstProzent = parseKonfiguration(fk.zeilen, fk.kopf).mwstProzent;
  const { plan, nochGesperrt } = nachrechnenPlan({
    kopf: v.kopf, zeilen: v.zeilen, zuordnungen: festpreisZuordnungen(ak.kopf, ak.zeilen), mwstProzent,
    kategorieFuer: (pid, produkt) => katJe.get(`${pid}|${produkt}`) ?? null,
  });
  if (!plan.length || dryRun) return { nachgerechnet: dryRun ? plan.length : 0, nochGesperrt, produktIds: [...new Set(plan.map(p => t(p.zeile[h('Produkt-ID')])))], dryRun };

  // Direkt vor dem Schreiben: steht unter der Zeilennummer noch genau diese gesperrte Zeile?
  const ende = colLetter(v.kopf.length - 1);
  const { data: jetzt } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId, ranges: plan.map(p => `'${TAB_FP_VERKAEUFE}'!A${p.sheetRow}:${ende}${p.sheetRow}`),
  });
  const data = [];
  const geschrieben = [];
  plan.forEach((p, i) => {
    const akt = jetzt.valueRanges?.[i]?.values?.[0] ?? [];
    if (zeilenSchluessel(v.kopf, akt) !== zeilenSchluessel(v.kopf, p.zeile) || t(akt[h(STATUS_SPALTE)]) !== STATUS_GESPERRT) return;
    for (const [spalte, w] of Object.entries(p.werte)) {
      if (h(spalte) === -1) continue;
      data.push({ range: `'${TAB_FP_VERKAEUFE}'!${colLetter(h(spalte))}${p.sheetRow}`, values: [[w]] });
    }
    geschrieben.push(p);
  });
  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } });
    const { data: zurueck } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: data.map(d => d.range), valueRenderOption: 'UNFORMATTED_VALUE' });
    const ab = data.filter((d, i) => String(zurueck.valueRanges?.[i]?.values?.[0]?.[0] ?? '') !== String(d.values[0][0]));
    if (ab.length) throw Object.assign(new Error(`FP_Verkäufe: Rücklesen nach dem Nachrechnen weicht in ${ab.length} Zelle(n) ab – bitte prüfen.`), { status: 500, code: 'ruecklesen' });
  }
  return {
    nachgerechnet: geschrieben.length, nochGesperrt: nochGesperrt + (plan.length - geschrieben.length),
    produktIds: [...new Set(geschrieben.map(p => t(p.zeile[h('Produkt-ID')])))], dryRun,
  };
}

/** Knopf "gesperrte nachrechnen" (MC). */
export async function nachrechnen({ sheets, spreadsheetId, dryRun = false } = {}) {
  return mitFpSperre(async () => {
    const r = await nachrechnenInSperre({ sheets, spreadsheetId, dryRun });
    console.log(`[fpSperre] Nachrechnen${dryRun ? ' (Trockenlauf)' : ''}: ${r.nachgerechnet} Zeile(n), ${r.nochGesperrt} weiter gesperrt.`);
    return r;
  });
}

/** Gesperrte Zeilen je Partner (nur Anzahl + Produkt-IDs) - fuer MC und den taeglichen Abgleich. Fehlt der Reiter: leer. */
export async function leseGesperrte({ sheets, spreadsheetId, partnerId } = {}) {
  let v;
  try { v = await lies(sheets, spreadsheetId, TAB_FP_VERKAEUFE); } catch (err) {
    // Reiter fehlt ("Unable to parse range", 400) = nichts gesperrt; alles andere ist ein echter Fehler.
    if (err?.code === 400 || err?.status === 400 || err?.response?.status === 400 || /Unable to parse range/i.test(err?.message ?? '')) return { anzahl: 0, jePartner: [] };
    throw err;
  }
  return gesperrtZaehlen(v.kopf, v.zeilen, { partnerId });
}
