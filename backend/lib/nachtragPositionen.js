// Fehlende Verkaufszeilen nachtragen (gleiche Position mehrfach in einer Bestellung, alter Sync-Schluessel).
// Lizenz (Partner_Verkaeufe, JFN) und Festpreis (FP_Verkaeufe). Rechnung genau wie der Sync:
// Lizenz verkaufsBetraege (wie Sync/Entsperren), Festpreis fpVerkaufszeile (routes/festpreis-portal.js),
// Kostensatz zum Bestelldatum. Trockenlauf Standard; --write sichert vorher den ganzen Reiter (JSON), legt
// bei Bedarf die Spalte Positions-ID an und schreibt ohne append in gepruefte Zielzeilen (zurueckgelesen).
// Ausgabe nur Anzahlen, Bestellnummern und Partner-IDs - nie Betraege, nie Kundendaten.

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getWcClient } from './shopConfig.js';
import { schreibeNeueZeilen } from './sheet-zeilen.js';
import { sichereSpalte } from '../utils/sheet-spalten.js';
import { parseKonfiguration, baueLizenzSaetze, baueVertragsbeginne, verkaufsBetraege } from '../utils/partner-kalkulation.js';
import {
  toFloat, toDE, leerWert, sperrGrund, vorVertragsbeginn, STATUS_GESPERRT, SPALTE_SPERRE, SPALTE_POSITION,
  bestellTag, konfigJeTag, fixkostenLuecken, fixkostenFehler,
} from '../utils/sync-logic.js';
import { festpreisZuordnungen, sperreZeile } from '../utils/fp-sperre.js';
import { fehlendePositionen, bestellungenMitZeilen } from '../utils/nachtrag-positionen.js';
import { fpVerkaufszeile } from '../routes/festpreis-portal.js';

const t = v => String(v ?? '').trim();
const POSITION_INDEX_FP = 26;   // FP_Verkaeufe Spalte AA

const ARTEN = {
  lizenz: { tab: 'Partner_Verkäufe', spalten: { bestellung: 'Order-ID', artikel: 'Artikelnummer' } },
  fp:     { tab: 'FP_Verkäufe',      spalten: { bestellung: 'WC-Bestellnummer', artikel: 'Artikelname' } },
};

async function lies(sheets, spreadsheetId, tab, render = 'FORMATTED_VALUE') {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'`, valueRenderOption: render });
  return data.values ?? [];
}

/** Bestellungen im Shop lesen (je 100, Takt per drossel), nur id, Status, Datum, Positionen, Versand. */
async function ladeBestellungen(wc, ids, drossel) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    if (i) await drossel();
    const { data } = await wc.get('orders', {
      include: ids.slice(i, i + 100).join(','), per_page: 100, status: 'any',
      _fields: 'id,status,date_created,date_paid,shipping_total,shipping_lines,line_items',
    });
    if (!Array.isArray(data)) throw new Error('Shop-Antwort ist keine Liste – abgebrochen.');
    for (const o of data) out.set(t(o.id), o);
  }
  return out;
}

/**
 * @param {object} o
 * @param {'lizenz'|'fp'} o.art
 * @param {Set<string>|null} [o.nur]   nur diese Bestellnummern
 * @param {boolean} [o.write]
 * @param {string} [o.sicherungOrdner]
 * @returns {Promise<{ art, tab, geprueft, bestellungen: {bestellung, zeilen, partner:string[]}[], zeilen: number, gesperrt: number, geschrieben: number, sicherung?: string }>}
 */
export async function nachtragenPositionen({ sheets, spreadsheetId, art, nur = null, write = false, sicherungOrdner,
  drossel = () => new Promise(r => setTimeout(r, 2000)), jetzt = () => new Date(), wcFuer = getWcClient }) {
  const cfg = ARTEN[art];
  if (!cfg) throw new Error(`Unbekannte Art "${art}" (lizenz | fp).`);
  const werte = await lies(sheets, spreadsheetId, cfg.tab);
  const kopf = (werte[0] ?? []).map(t);
  const vh = c => kopf.indexOf(c);
  const zeilen = werte.slice(1);

  const kRows = await lies(sheets, spreadsheetId, 'Kalkulation_Fixkosten');
  const konfigFuer = konfigJeTag(d => parseKonfiguration(kRows.slice(1), (kRows[0] ?? []).map(t), d));

  // Stammdaten fuer die Rechnung
  let eintragFuer, fpShop = new Map(), extra = {};
  if (art === 'lizenz') {
    const aRows = await lies(sheets, spreadsheetId, 'Partner_Artikel'); const ah = c => (aRows[0] ?? []).indexOf(c);
    const pRows = await lies(sheets, spreadsheetId, 'Partner'); const pH = (pRows[0] ?? []).map(t);
    const map = new Map();
    for (const r of aRows.slice(1)) {
      const pid = t(r[ah('Produkt-ID')]), partnerId = t(r[ah('Partner-ID')]);
      if (!pid || !partnerId) continue;
      (map.get(pid) ?? map.set(pid, []).get(pid)).push({
        partnerId, ekPreis: toFloat(r[ah('EK-Preis-Netto')]), druckkosten: toFloat(r[ah('Druckkosten')]),
        ekLeer: leerWert(r[ah('EK-Preis-Netto')]), druckLeer: leerWert(r[ah('Druckkosten')]),
        versandart: t(r[ah('Versandart')]).toUpperCase() === 'B' ? 'B' : 'P',
      });
    }
    const porto = new Map(pRows.slice(1).map(r => [t(r[pH.indexOf('Partner-ID')]), r[pH.indexOf('Porto-Modell')] ?? 'geteilt-50-50']));
    extra = { map, lizenzSatz: baueLizenzSaetze(pH, pRows.slice(1)), vertragsbeginn: baueVertragsbeginne(pH, pRows.slice(1)), porto };
    eintragFuer = (pid, partnerId) => (map.get(pid) ?? []).find(e => e.partnerId === partnerId) ?? null;
  } else {
    const aRows = await lies(sheets, spreadsheetId, 'FP_Artikel'); const ah = c => (aRows[0] ?? []).indexOf(c);
    const akRows = await lies(sheets, spreadsheetId, 'FP_Artikel_Kategorie');
    const pRows = await lies(sheets, spreadsheetId, 'FP_Partner'); const pH = (pRows[0] ?? []).map(t);
    for (const r of pRows.slice(1)) fpShop.set(t(r[pH.indexOf('Partner-ID')]), t(r[pH.indexOf('Shop')]).toLowerCase() === 'honk' ? 'honk' : 'jfn');
    extra = { zuordnungen: festpreisZuordnungen((akRows[0] ?? []).map(t), akRows.slice(1)) };
    eintragFuer = (pid, partnerId) => {
      const r = aRows.slice(1).find(x => t(x[ah('Produkt-ID')]) === pid && t(x[ah('Partner-ID')]) === partnerId);
      return r ? {
        partnerId, festpreisEK: toFloat(r[ah('Festpreis-EK-Netto')]), handlingGebuehr: toFloat(r[ah('Handling-Gebühr')]),
        versandart: t(r[ah('Versandart')]).toUpperCase() === 'B' ? 'B' : 'P', artikelkategorie: r[ah('Artikelkategorie')] ?? '',
      } : null;
    };
  }

  // Bestellungen: Lizenz nur JFN; FP je Shop des Partners
  const ids = bestellungenMitZeilen(zeilen, vh, cfg.spalten, nur);
  const shopVon = id => {
    if (art === 'lizenz') return 'jfn';
    const p = zeilen.find(r => t(r[vh(cfg.spalten.bestellung)]) === id);
    return fpShop.get(t(p?.[vh('Partner-ID')])) ?? 'jfn';
  };
  const bestellungen = new Map();
  for (const shop of ['jfn', 'honk']) {
    const teil = ids.filter(id => shopVon(id) === shop);
    if (!teil.length) continue;
    for (const [id, o] of await ladeBestellungen(wcFuer(shop), teil, drossel)) bestellungen.set(id, o);
  }

  // Fehlende Positionen je Bestellung und neue Zeilen
  const neu = [], bericht = [];
  for (const [id, order] of bestellungen) {
    const fehlend = fehlendePositionen({ order, zeilen, vh, spalten: cfg.spalten });
    if (!fehlend.length) continue;
    const luecken = fixkostenLuecken([bestellTag(order)], konfigFuer);
    if (luecken.length) throw fixkostenFehler(luecken);
    const k = konfigFuer(bestellTag(order));
    const partner = new Set();
    for (const { item, partnerId } of fehlend) {
      const e = eintragFuer(t(item.product_id), partnerId);
      if (!e) throw new Error(`Bestellung ${id}: Produkt ${item.product_id} hat für ${partnerId} keinen Artikel-Eintrag mehr – nichts geschrieben.`);
      partner.add(partnerId);
      if (art === 'lizenz') neu.push(lizenzZeile({ order, item, e, k, extra }));
      else {
        const { zeile, katPreis } = fpVerkaufszeile({ order, item, e, k, zuordnungen: extra.zuordnungen });
        neu.push(katPreis ? zeile : sperreZeile(zeile, kopf));
      }
    }
    bericht.push({ bestellung: id, zeilen: fehlend.length, partner: [...partner] });
  }
  const gesperrt = neu.filter(r => r[art === 'lizenz' ? 8 : 14] === STATUS_GESPERRT).length;
  const ergebnis = { art, tab: cfg.tab, geprueft: bestellungen.size, bestellungen: bericht, zeilen: neu.length, gesperrt, geschrieben: 0 };
  if (!write || !neu.length) return ergebnis;

  // Sicherung des ganzen Reiters (ungeformte Werte), dann Spalte Positions-ID, dann schreiben
  const roh = await lies(sheets, spreadsheetId, cfg.tab, 'UNFORMATTED_VALUE');
  mkdirSync(sicherungOrdner, { recursive: true });
  const datei = join(sicherungOrdner, `${art === 'lizenz' ? 'Partner_Verkaeufe' : 'FP_Verkaeufe'}_vor_Nachtrag_${jetzt().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(datei, JSON.stringify({ tab: cfg.tab, gesichert: jetzt().toISOString(), values: roh }));
  ergebnis.sicherung = datei;

  const kopfNeu = [...kopf];
  let iPos;
  if (art === 'lizenz') {
    if (neu.some(r => r._sperre)) {
      const iS = await sichereSpalte(sheets, spreadsheetId, cfg.tab, kopfNeu, SPALTE_SPERRE);
      for (const r of neu.filter(x => x._sperre)) { while (r.length <= iS) r.push(''); r[iS] = r._sperre; }
    }
    iPos = await sichereSpalte(sheets, spreadsheetId, cfg.tab, kopfNeu, SPALTE_POSITION);
    for (const r of neu) { while (r.length <= iPos) r.push(''); r[iPos] = r._pos; }
  } else {
    iPos = kopfNeu.indexOf(SPALTE_POSITION);
    if (iPos === -1) {
      if (kopfNeu.length !== POSITION_INDEX_FP) throw new Error(`${cfg.tab}: ${kopfNeu.length} Spalten, Positions-ID nicht anlegbar – nichts geschrieben.`);
      await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${cfg.tab}'!AA1`, valueInputOption: 'RAW', requestBody: { values: [[SPALTE_POSITION]] } });
      kopfNeu.push(SPALTE_POSITION); iPos = POSITION_INDEX_FP;
    } else if (iPos !== POSITION_INDEX_FP) throw new Error(`${cfg.tab}: Positions-ID steht nicht in Spalte AA – nichts geschrieben.`);
  }
  const breite = Math.max(kopfNeu.length, ...neu.map(r => r.length));
  await schreibeNeueZeilen(sheets, spreadsheetId, cfg.tab, neu.map(r => Array.from({ length: breite }, (_, i) => r[i] ?? '')), { alt: roh });
  ergebnis.geschrieben = neu.length;
  return ergebnis;
}

// Lizenz-Zeile wie runVerkaeufeSync (JFN): Versandart der Bestellung = P, sobald ein Partner-Eintrag P ist.
function lizenzZeile({ order, item, e, k, extra }) {
  const orderDate = toDE(new Date(order.date_created));
  let versandart = 'B';
  for (const i of order.line_items ?? []) {
    const eintraege = (extra.map.get(t(i.product_id)) ?? []).filter(x => !vorVertragsbeginn(order.date_created, extra.vertragsbeginn(x.partnerId)));
    if (eintraege.some(x => x.versandart === 'P')) versandart = 'P';
  }
  const name = item.name || item.sku || String(item.product_id);
  const grund = sperrGrund(e);
  let row;
  if (grund) {
    row = [e.partnerId, orderDate, order.id, name, item.variation_id || 0, item.quantity, toFloat(item.total), '', STATUS_GESPERRT, item.product_id, '', '', '', ''];
    row._sperre = grund;
  } else {
    const b = verkaufsBetraege({ order, item, eintrag: e, versandart, portoModell: extra.porto.get(e.partnerId) ?? 'geteilt-50-50',
      lizenzProzent: extra.lizenzSatz(e.partnerId), konfiguration: k });
    row = [e.partnerId, orderDate, order.id, name, item.variation_id || 0, item.quantity,
      b.vkNetto, b.lizenz, 'offen', item.product_id, b.gewinnNetto, b.lizenzAnteil, b.portoSaldo, b.brutto];
  }
  row._pos = item.id;
  return row;
}
