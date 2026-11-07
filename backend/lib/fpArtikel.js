// PA7: Festpreis-Partner im taeglichen Artikel-Abgleich - NUR LESEN, nur melden (Variante B, Begruendung in utils/fp-artikel.js).
// Liest FP_Partner, FP_Artikel, FP_Artikel_Kategorie (Business-Sheet) und je Shop die Kategorien + veroeffentlichten Produkte
// (getWcClient, nacheinander mit Takt, nur _fields). Schreibt nichts, setzt nie einen Festpreis. Nie Preise in Antwort/Log.

import { getWcClient } from './shopConfig.js';
import { seitenGrenze, seitenListe, wirfWennPruefseite } from './hosterPruefseite.js';
import { fpPartnerBefund, fpOhneEintragInVerkaeufen } from '../utils/fp-artikel.js';

const t = v => String(v ?? '').trim();
export const TAKT_MS = 1500;
const warte = ms => new Promise(r => setTimeout(r, ms));

async function lies(sheets, sheetId, tab) {
  let data;
  try {
    ({ data } = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `'${tab}'` }));
  } catch (err) {
    // Reiter fehlt ("Unable to parse range", 400) = keine Festpreis-Partner/Zeilen; alles andere ist ein echter Fehler.
    if (err?.code === 400 || err?.response?.status === 400 || /Unable to parse range/i.test(err?.message ?? '')) return [];
    throw err;
  }
  const [kopf = [], ...z] = data.values ?? [];
  return z.filter(r => (r ?? []).some(c => t(c))).map(r => Object.fromEntries(kopf.map((k, i) => [t(k), t(r[i])])));
}

/** Aktive FP-Partner (Aktiv = ja) mit Shop und Kategorie-Liste. Optional nur einer. */
async function aktivePartner(sheets, sheetId, nurId) {
  return (await lies(sheets, sheetId, 'FP_Partner'))
    .filter(p => t(p.Aktiv).toLowerCase() === 'ja' && t(p['Partner-ID']) && (!nurId || t(p['Partner-ID']) === nurId))
    .map(p => ({ id: t(p['Partner-ID']), shop: t(p.Shop).toLowerCase() === 'honk' ? 'honk' : 'jfn', kategorien: t(p.Kategorien) }));
}

/** Alle Seiten eines Pfads, nacheinander mit Takt (Hoster-Schutz). */
function seitenHoler(takt) {
  let abrufe = 0;
  const hole = async (wc, pfad, params) => {
    const out = [];
    for (let page = 1; ; page++) {
      seitenGrenze(page, { wc, pfad });
      if (abrufe++ && takt) await warte(takt);
      const liste = seitenListe((await wc.get(pfad, { per_page: 100, page, ...params })).data, { wc, pfad });
      out.push(...liste);
      if (liste.length < 100) break;
    }
    return out;
  };
  return { hole, abrufe: () => abrufe };
}

/**
 * Befund je aktivem FP-Partner (fehlende Artikel, Zeilen ohne Festpreis, Kategorien nicht im Shop).
 * @returns {Promise<{ partner: object[], summen: { partner, fehlend, ohneFestpreis, kategorienWeg, fehler }, abrufe }>}
 */
export async function fpArtikelPruefung({ sheets, sheetId, wcFuer = getWcClient, nurPartner, takt = TAKT_MS } = {}) {
  const partner = await aktivePartner(sheets, sheetId, nurPartner);
  const artikel = await lies(sheets, sheetId, 'FP_Artikel');
  const festpreis = await lies(sheets, sheetId, 'FP_Artikel_Kategorie');
  const { hole, abrufe } = seitenHoler(takt);
  const shopDaten = new Map();
  const bericht = [];
  for (const p of partner) {
    try {
      if (!shopDaten.has(p.shop)) {
        const wc = wcFuer(p.shop);
        const kategorien = await hole(wc, 'products/categories', { _fields: 'id,parent' });
        const produkte = await hole(wc, 'products', { status: 'publish', _fields: 'id,name,status,categories' });
        shopDaten.set(p.shop, { kategorien, produkte });
      }
      const { kategorien, produkte } = shopDaten.get(p.shop);
      bericht.push(fpPartnerBefund({
        partner: p, kategorien, produkte,
        artikel: artikel.filter(a => t(a['Partner-ID']) === p.id).map(a => ({ produktId: a['Produkt-ID'], name: a.Artikelname, artikelkategorie: a.Artikelkategorie })),
        festpreisKategorien: new Set(festpreis.filter(f => t(f['Festpreispartner-ID']) === p.id).map(f => t(f.Kategorie)).filter(Boolean)),
      }));
    } catch (err) {
      wirfWennPruefseite(err);
      bericht.push({ id: p.id, fehlend: [], ohneFestpreis: [], kategorienWeg: [], fehler: err.message });
    }
  }
  const sum = f => bericht.reduce((s, e) => s + (e[f]?.length ?? 0), 0);
  return {
    partner: bericht,
    summen: { partner: bericht.length, fehlend: sum('fehlend'), ohneFestpreis: sum('ohneFestpreis'), kategorienWeg: sum('kategorienWeg'),
      fehler: bericht.filter(e => e.fehler).length },
    abrufe: abrufe(),
  };
}

/**
 * FP-Sync: uebersprungene Positionen (Produkt-ID nicht in FP_Artikel) gegen die Partner-Kategorien pruefen.
 * Nur fuer die uebersprungenen IDs: 1 Abruf je 100 Produkte (include, _fields id,categories) + Kategorien.
 * @param {object} o { wc, uebersprungen: [{produktId, bestellung, datum}], partner: [{id, kategorien}] }
 */
export async function fpUebersprungenePruefen({ wc, uebersprungen, partner, takt = TAKT_MS }) {
  const ids = [...new Set((uebersprungen ?? []).map(u => String(u.produktId)).filter(x => /^\d+$/.test(x) && x !== '0'))];
  if (!ids.length || !(partner ?? []).length) return [];
  const { hole } = seitenHoler(takt);
  const kategorien = await hole(wc, 'products/categories', { _fields: 'id,parent' });
  const produkte = [];
  for (let i = 0; i < ids.length; i += 100) {
    produkte.push(...await hole(wc, 'products', { include: ids.slice(i, i + 100).join(','), status: 'any', _fields: 'id,categories' }));
  }
  return fpOhneEintragInVerkaeufen({ uebersprungen, produkte, kategorien, partner });
}
