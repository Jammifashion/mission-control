// Teilerstattungen nachtragen (NB1 Teil A): Erstattungen, die der taegliche Sync nicht mehr sieht (er liest nur
// Bestellungen, die in den letzten ERSTATTUNG_TAGE geaendert wurden). Dieselbe Rechnung wie der Sync
// (buildErstattungRows in utils/teilerstattung.js), nur Lizenz-Reiter (Partner_Verkäufe / HK_Partner_Verkäufe).
// Trockenlauf Standard; write sichert vorher den ganzen Reiter (JSON), schreibt ohne append in gepruefte
// Zielzeilen (zurueckgelesen) und misst danach nach (erneuter Lauf muss 0 Zeilen ergeben).
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getWcClient, getShopConfig } from './shopConfig.js';
import { seitenGrenze, seitenListe } from './hosterPruefseite.js';
import { schreibeNeueZeilen } from './sheet-zeilen.js';
import { buildErstattungRows } from '../utils/teilerstattung.js';
import { WC_STATES_VERKAUF, STORNO_MARKER, konfigJeTag, bestellTag } from '../utils/sync-logic.js';
import { parseKonfiguration, normalisierePortoModell } from '../utils/partner-kalkulation.js';

const t = v => String(v ?? '').trim();

async function lies(sheets, spreadsheetId, tab, valueRenderOption) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'`, ...(valueRenderOption ? { valueRenderOption } : {}) });
  return data.values ?? [];
}

/**
 * @param {object} o
 * @param {'jfn'|'honk'} o.shop
 * @param {Set<string>|null} [o.nur]  nur diese Bestellnummern (sonst alle Bestellungen seit `seit` mit Erstattung)
 * @returns {Promise<{ tab, geprueft, bestellungen: {bestellung, status, zeilen, marken:string[]}[], zeilen, hinweise, geschrieben, sicherung?, nachmessung?, rows }>}
 */
export async function nachtragErstattungen({ sheets, spreadsheetId, shop, nur = null, write = false, sicherungOrdner,
  seit = '2025-01-01T00:00:00', drossel = () => new Promise(r => setTimeout(r, 1500)), jetzt = () => new Date(), wcFuer = getWcClient }) {
  const tab = getShopConfig(shop).tabVerkaeufe;
  const werte = await lies(sheets, spreadsheetId, tab);
  const kopf = (werte[0] ?? []).map(t);
  const vh = c => kopf.indexOf(c);
  const zeilen = werte.slice(1);

  const pRows = await lies(sheets, spreadsheetId, 'Partner'); const pH = (pRows[0] ?? []).map(t);
  const porto = new Map(pRows.slice(1).map(r => [t(r[pH.indexOf('Partner-ID')]), r[pH.indexOf('Porto-Modell')] ?? 'geteilt-50-50']));
  const kRows = await lies(sheets, spreadsheetId, 'Kalkulation_Fixkosten');
  const konfigFuer = konfigJeTag(d => parseKonfiguration(kRows.slice(1), (kRows[0] ?? []).map(t), d));

  const wc = wcFuer(shop);
  const mitZeilen = new Set(zeilen.map(r => t(r[vh('Order-ID')])));
  let ids;
  if (nur) ids = [...nur].filter(id => mitZeilen.has(id));
  else {
    ids = [];
    for (const status of WC_STATES_VERKAUF) {
      for (let page = 1; ; page++) {
        seitenGrenze(page, { wc, pfad: 'orders' });
        const liste = seitenListe((await wc.get('orders', { per_page: 100, page, status, after: seit, _fields: 'id,refunds' })).data, { wc, pfad: 'orders' });
        for (const o of liste) if ((o.refunds ?? []).length && mitZeilen.has(String(o.id))) ids.push(String(o.id));
        await drossel();
        if (liste.length < 100) break;
      }
    }
  }

  const bestellungen = [];
  const bericht = [];
  for (const id of ids) {
    const order = (await wc.get(`orders/${id}`)).data; await drossel();
    if (!WC_STATES_VERKAUF.includes(order.status)) { bericht.push({ bestellung: id, status: order.status, zeilen: 0, marken: [] }); continue; }   // Ganz-Storno macht der Sync
    const refunds = seitenListe((await wc.get(`orders/${id}/refunds`, { per_page: 100 })).data, { wc, pfad: 'orders/refunds' }); await drossel();
    bestellungen.push({ order, refunds });
  }

  const rechne = vRows => buildErstattungRows({
    vRows, vh, bestellungen,
    portoFaktor: p => (normalisierePortoModell(porto.get(p)) === 'partner-trägt' ? 1 : 0.5),
    mwstFuer: o => Number(konfigFuer(bestellTag(o)).mwstProzent),
    stornoMarker: STORNO_MARKER,
  });
  const erg = rechne(zeilen);
  for (const { order } of bestellungen) {
    const eigene = erg.rows.filter(r => t(r[vh('Order-ID')]) === String(order.id));
    bericht.push({ bestellung: String(order.id), status: order.status, zeilen: eigene.length,
      marken: eigene.map(r => `${r[vh('Partner-ID')]} ${r[vh('Storno-Status')]} (Stück ${r[vh('Stückzahl')]})`) });
  }
  const ergebnis = { tab, geprueft: ids.length, bestellungen: bericht, zeilen: erg.rows.length, hinweise: erg.hinweise, geschrieben: 0, rows: erg.rows, kopf };
  if (!write || !erg.rows.length) return ergebnis;

  // Sicherung des ganzen Reiters (ungeformte Werte), dann schreiben
  const roh = await lies(sheets, spreadsheetId, tab, 'UNFORMATTED_VALUE');
  mkdirSync(sicherungOrdner, { recursive: true });
  const datei = join(sicherungOrdner, `${tab.replace(/[^A-Za-z_]/g, '')}_vor_Erstattung_${jetzt().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(datei, JSON.stringify({ tab, gesichert: jetzt().toISOString(), values: roh }));
  ergebnis.sicherung = datei;
  const breite = Math.max(kopf.length, ...erg.rows.map(r => r.length));
  await schreibeNeueZeilen(sheets, spreadsheetId, tab, erg.rows.map(r => Array.from({ length: breite }, (_, i) => r[i] ?? '')), { alt: roh });
  ergebnis.geschrieben = erg.rows.length;

  // Nachmessung: frisch gelesen muss dieselbe Rechnung 0 neue Zeilen ergeben.
  const nachher = (await lies(sheets, spreadsheetId, tab)).slice(1);
  ergebnis.nachmessung = rechne(nachher).rows.length;
  return ergebnis;
}
