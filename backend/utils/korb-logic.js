// L-Shop-Warenkorb (BO2): reine Logik, keine Zugriffe. Ein-/Ausgabe in lib/lshopKorb.js.
//
// Der Korb ist ein STEHENDER Bestand (Inhaber 21.10.): jede L-Shop-bestellfaehige
// Shop-Position ist eine Zeile im SSOT-Reiter "Warenkorb_LShop" und bleibt dort,
// bis der Inhaber etwas damit macht. Der Abgleichlauf
//  - haengt nur NEUE Positionen an (Schluessel Shop:Bestellnummer:Position),
//  - fasst vorhandene Schluessel nie an - ausser dem Feld "Hinweis",
//  - aendert nie den Status und loescht nie.
// Nicht bestellfaehige Positionen (Trikot, einfache Artikel, ohne Treffer) kommen
// nur als Zaehler ins Laufprotokoll.
//
// Spalten nur ueber den Namen; die Kopfzeile legt scripts/setup-lshop-korb-reiter.js an.

import { normHeader } from './sheet-headers.js';
import { varianteDerPosition } from './varianten-zeilen.js';
import { normalizeShop, shopWert } from './shop-spalte.js';

export const TAB_KORB = 'Warenkorb_LShop';

// Reihenfolge der Kopfzeile beim Anlegen. Gelesen/geschrieben wird nur ueber den Namen.
export const KORB_SPALTEN = [
  'Schluessel', 'Shop', 'Herkunft', 'Bestellnummer', 'Position', 'Referenz', 'SSOT-ID',
  'LShop_ArticleNr', 'Menge', 'Status', 'Grund', 'Hinweis', 'Status_Datum', 'Bestell_ID',
  'Notiz', 'Angelegt', 'Quelle_Lauf', 'Stand',
];

export const STATUS = { OFFEN: 'offen', ABGEWAEHLT: 'abgewählt', BESTELLT: 'bestellt', GELIEFERT: 'geliefert', LAGER: 'Lager' };
export const HERKUNFT = { SHOP: 'shop', EIGEN: 'eigen' };

// Der Abgleich liest diese Status. Shop: nur JFN, bis HONK selbst EDI-bestellbar ist.
export const KORB_STATUS_SHOP = ['processing', 'on-hold'];
export const KORB_SHOPS = ['jfn'];

// Hinweise schreibt nur der Lauf. Die ersten fuenf stehen in antwort-BO1;
// die letzten beiden decken Faelle ab, die sonst still blieben.
export const HINWEIS = {
  UNBEZAHLT:       'noch nicht bezahlt',
  STORNIERT:       'Bestellung storniert',
  ERSTATTET:       'erstattet',
  ABGESCHLOSSEN:   'abgeschlossen',
  MENGE:           'Menge im Shop geändert',
  NICHT_IM_SHOP:   'Bestellung nicht mehr im Shop',
  POSITION_WEG:    'Position nicht mehr in der Bestellung',
};
// Mit diesen Hinweisen wird eine Position nicht mehr zum Bestellen vorgeschlagen.
export const HINWEIS_SPERRT = new Set([HINWEIS.STORNIERT, HINWEIS.ERSTATTET, HINWEIS.ABGESCHLOSSEN,
  HINWEIS.NICHT_IM_SHOP, HINWEIS.POSITION_WEG]);
const TRENNER = ' · ';

// Klassen der Einstufung (Reihenfolge der Pruefung wie in BO1).
export const KLASSE = {
  BESTELLBAR:        'bestellbar',
  TRIKOT:            'Trikot',
  EXTERN:            'Fremdware (SKU_Extern)',
  EINFACH:           'einfacher Artikel ohne Variation',
  PRODUKT_FEHLT:     'Produkt im Shop nicht lesbar',
  OHNE_VARIANTE:     'Variations-ID nicht in Varianten',
  FREMDES_PRODUKT:   'Varianten-Zeile gehört zu anderem Produkt',
  NR_LEER:           'LShop_ArticleNr leer',
  NR_FORMAT:         'LShop_ArticleNr nicht 10 Ziffern',
  NR_UNBEKANNT:      'ArticleNr nicht in LShop_Modelle',
  AUSGELAUFEN:       'ausgelaufen / Discontinued 3 oder 6',
};

const t = v => String(v ?? '').trim();

export const korbSchluessel = (shop, bestellnummer, position) =>
  `${shopWert(shop)}:${t(bestellnummer)}:${t(position)}`;

/** Spaltenindizes ueber den Namen; fehlende Spalten -> Fehler mit Namen (422, nichts geschrieben). */
export function korbSpalten(header) {
  const norm = (header ?? []).map(normHeader);
  const idx = {};
  const fehlt = [];
  for (const name of KORB_SPALTEN) {
    const i = norm.indexOf(normHeader(name));
    if (i < 0) fehlt.push(name); else idx[name] = i;
  }
  if (fehlt.length) {
    const e = new Error(`Reiter "${TAB_KORB}": Spalte(n) fehlen: ${fehlt.join(', ')}`);
    e.status = 422;
    throw e;
  }
  return idx;
}

/** Datenzeilen als Objekte mit Zeilennummer (1-basiert, Kopf = 1). Ganz leere Zeilen fallen weg. */
export function korbZeilen(werte) {
  const [header = [], ...daten] = werte ?? [];
  const idx = korbSpalten(header);
  const zeilen = [];
  daten.forEach((r, n) => {
    if (!(r ?? []).some(z => t(z))) return;
    const o = { _zeile: n + 2 };
    for (const [name, i] of Object.entries(idx)) o[name] = t(r[i]);
    zeilen.push(o);
  });
  return { idx, zeilen };
}

/** Zeile in Kopfreihenfolge (fehlende Felder leer). */
export function alsSheetZeile(idx, obj) {
  const breite = Math.max(...Object.values(idx)) + 1;
  const r = Array(breite).fill('');
  for (const [name, i] of Object.entries(idx)) r[i] = obj[name] ?? '';
  return r;
}

// ── Kontext fuer die Einstufung ─────────────────────────────────────────────

/**
 * @param {object} o
 * @param {object} o.varMap          aus wcVariationMap (Reiter Varianten)
 * @param {string[][]} o.varianten   Reiter Varianten (ganze Breite) fuer LShop_ArticleNr
 * @param {object} o.produktIdJeSsot SSOT-ID -> Produkt-ID (Erfassungsmaske)
 * @param {object[]} o.lshop         ladeLShopZeilen() ({ articleNr, status, discontinued, ... })
 * @param {object[]} o.extern        SKU_Extern als { CatalogNr, Artikel_WC_IDs }
 * @param {string[]} o.trikotIds     Produkt-IDs aus Trikot_Artikel
 */
export function baueKontext({ varMap, varianten, produktIdJeSsot, lshop, extern = [], trikotIds = [] }) {
  const [vh = [], ...vz] = varianten ?? [];
  const norm = vh.map(normHeader);
  const iWc = norm.indexOf(normHeader('WC_Variation_ID'));
  const iNr = norm.indexOf(normHeader('LShop_ArticleNr'));
  const nrJeVariation = new Map();
  if (iWc >= 0 && iNr >= 0) for (const r of vz) {
    const id = t(r[iWc]);
    if (id && id !== '0') nrJeVariation.set(id, t(r[iNr]));
  }
  return {
    varMap, produktIdJeSsot, nrJeVariation,
    modelle: new Map((lshop ?? []).map(z => [t(z.articleNr), z])),
    externIds: new Set(extern.flatMap(e => t(e.Artikel_WC_IDs).split(/[,;\s]+/)).filter(Boolean)),
    externCat: new Set(extern.map(e => t(e.CatalogNr)).filter(Boolean)),
    trikotIds: new Set(trikotIds.map(t).filter(Boolean)),
  };
}

const gesperrtDisc = v => { const n = Number(t(v).replace(',', '.')); return n === 3 || n === 6; };

/**
 * Einstufung einer Shop-Position.
 * @param {object} position  WC-line_item ({ product_id, variation_id, sku, quantity })
 * @param {{ type, lieferzeit }|undefined} produkt  Elternprodukt aus dem Shop
 * @returns {{ klasse, ssotId?, articleNr? }}
 */
export function stufeEin(position, produkt, ktx) {
  const pid = t(position.product_id);
  const vid = t(position.variation_id);
  if (ktx.trikotIds.has(pid) || t(produkt?.lieferzeit) === '666') return { klasse: KLASSE.TRIKOT };
  if (ktx.externIds.has(pid) || ktx.externCat.has(t(position.sku).split('/')[0])) return { klasse: KLASSE.EXTERN };
  if (!produkt) return { klasse: KLASSE.PRODUKT_FEHLT };
  if (!vid || vid === '0') return { klasse: KLASSE.EINFACH };
  if (!ktx.varMap[vid]) return { klasse: KLASSE.OHNE_VARIANTE };
  const v = varianteDerPosition(ktx.varMap, ktx.produktIdJeSsot, position);
  if (!v) return { klasse: KLASSE.FREMDES_PRODUKT };
  const nr = ktx.nrJeVariation.get(vid) ?? '';
  if (!nr) return { klasse: KLASSE.NR_LEER };
  if (!/^\d{10}$/.test(nr)) return { klasse: KLASSE.NR_FORMAT };
  const m = ktx.modelle.get(nr);
  if (!m) return { klasse: KLASSE.NR_UNBEKANNT };
  if (t(m.status) === 'ausgelaufen' || gesperrtDisc(m.discontinued)) return { klasse: KLASSE.AUSGELAUFEN };
  return { klasse: KLASSE.BESTELLBAR, ssotId: v.ssotId, articleNr: nr };
}

// ── Hinweise ────────────────────────────────────────────────────────────────

/**
 * Hinweis einer vorhandenen Korb-Zeile aus dem aktuellen Shop-Stand.
 * @param {object} zeile     Korb-Zeile ({ Position, Menge })
 * @param {object|null} bestellung  WC-Bestellung (id, status, line_items) oder null = nicht gefunden
 */
export function hinweisFuer(zeile, bestellung) {
  if (!bestellung) return HINWEIS.NICHT_IM_SHOP;
  const h = [];
  const s = t(bestellung.status);
  if (s === 'on-hold' || s === 'pending') h.push(HINWEIS.UNBEZAHLT);
  else if (s === 'cancelled' || s === 'failed') h.push(HINWEIS.STORNIERT);
  else if (s === 'refunded') h.push(HINWEIS.ERSTATTET);
  else if (s === 'completed') h.push(HINWEIS.ABGESCHLOSSEN);
  else if (s === 'trash') h.push(HINWEIS.NICHT_IM_SHOP);
  const li = (bestellung.line_items ?? []).find(l => t(l.id) === t(zeile.Position));
  if (!li) h.push(HINWEIS.POSITION_WEG);
  else if (t(zeile.Menge) && Number(t(zeile.Menge)) !== Number(li.quantity)) h.push(HINWEIS.MENGE);
  return h.join(TRENNER);
}

export const hinweisSperrt = hinweis => t(hinweis).split(TRENNER).some(h => HINWEIS_SPERRT.has(h));

// Diese Zeilen prueft der Lauf auf neue Hinweise; abgewaehlte, gelieferte und
// Lager-Zeilen hat der Inhaber schon erledigt.
export const brauchtHinweisPruefung = z =>
  t(z.Herkunft) === HERKUNFT.SHOP && [STATUS.OFFEN, STATUS.BESTELLT].includes(t(z.Status));

// ── Plan des Abgleichs ──────────────────────────────────────────────────────

/**
 * Was der Lauf anlegen und welche Hinweise er aendern wuerde - ohne Zugriffe.
 * @param {object} o
 * @param {string} o.shop
 * @param {object[]} o.vorhanden   korbZeilen().zeilen
 * @param {object[]} o.offene      offene WC-Bestellungen (processing, on-hold)
 * @param {Map<string,object>} o.produkte  Produkt-ID -> { type, lieferzeit }
 * @param {Map<string,object|null>} o.bekannte  Bestell-ID -> Bestellung|null fuer Korb-Zeilen,
 *                                  deren Bestellung nicht unter den offenen ist
 * @param {object} o.ktx           baueKontext()
 * @param {string} o.jetzt         ISO
 * @param {string} o.quelleLauf
 */
export function abgleichPlan({ shop, vorhanden, offene, produkte, bekannte = new Map(), ktx, jetzt, quelleLauf }) {
  const SH = shopWert(shop);
  const schonDa = new Map(vorhanden.map(z => [z.Schluessel, z]));
  const neu = [];
  const nichtBestellfaehig = {};
  let schon = 0;
  const offenJeId = new Map(offene.map(o => [t(o.id), o]));

  for (const o of offene) for (const li of o.line_items ?? []) {
    const schluessel = korbSchluessel(shop, o.id, li.id);
    if (schonDa.has(schluessel)) { schon++; continue; }
    const e = stufeEin(li, produkte.get(t(li.product_id)), ktx);
    if (e.klasse !== KLASSE.BESTELLBAR) { nichtBestellfaehig[e.klasse] = (nichtBestellfaehig[e.klasse] ?? 0) + 1; continue; }
    const zeile = {
      Schluessel: schluessel, Shop: SH, Herkunft: HERKUNFT.SHOP,
      Bestellnummer: t(o.id), Position: t(li.id), Referenz: '',
      'SSOT-ID': e.ssotId, LShop_ArticleNr: e.articleNr, Menge: String(li.quantity ?? 1),
      Status: STATUS.OFFEN, Grund: '', Status_Datum: jetzt, Bestell_ID: '', Notiz: '',
      Angelegt: jetzt, Quelle_Lauf: quelleLauf, Stand: jetzt,
    };
    zeile.Hinweis = hinweisFuer(zeile, o);
    neu.push(zeile);
    schonDa.set(schluessel, zeile);   // doppelte Position in derselben Antwort -> einmal
  }

  const hinweise = [];
  for (const z of vorhanden) {
    if (normalizeShop(z.Shop) !== normalizeShop(shop) || !brauchtHinweisPruefung(z)) continue;
    const b = offenJeId.get(z.Bestellnummer) ?? bekannte.get(z.Bestellnummer) ?? null;
    if (!offenJeId.has(z.Bestellnummer) && !bekannte.has(z.Bestellnummer)) continue;  // nicht gelesen -> nicht anfassen
    const h = hinweisFuer(z, b);
    if (h !== z.Hinweis) hinweise.push({ schluessel: z.Schluessel, zeile: z._zeile, alt: z.Hinweis, neu: h });
  }

  return { neu, hinweise, zaehler: { neu: neu.length, schonDa: schon, hinweiseGesetzt: hinweise.length, nichtBestellfaehig } };
}

/** Bestell-IDs vorhandener Zeilen, deren Bestellung nicht unter den offenen ist (Hinweise). */
export function nachzulesendeBestellungen({ shop, vorhanden, offene }) {
  const offenIds = new Set(offene.map(o => t(o.id)));
  return [...new Set(vorhanden
    .filter(z => normalizeShop(z.Shop) === normalizeShop(shop) && brauchtHinweisPruefung(z) && !offenIds.has(z.Bestellnummer))
    .map(z => z.Bestellnummer))];
}

// ── Schreiben ohne values.append ────────────────────────────────────────────

/** Erste Zeile nach der letzten nicht leeren Zeile (1-basiert). Nur Kopf -> 2. */
export function ersteFreieZeile(werte) {
  let letzte = 0;
  (werte ?? []).forEach((r, i) => { if ((r ?? []).some(z => t(z))) letzte = i + 1; });
  return Math.max(letzte, 1) + 1;
}

/** Sind alle Zeilen des Bereichs leer? */
export const bereichLeer = werte => !(werte ?? []).some(r => (r ?? []).some(z => t(z)));

/** Stimmt zurueckgelesener Inhalt mit dem Geschriebenen? Liefert Liste der Abweichungen (Zeile, Spalte). */
export function vergleicheZurueck(geschrieben, gelesen) {
  const ab = [];
  geschrieben.forEach((r, i) => r.forEach((w, j) => {
    if (t(w) !== t(gelesen?.[i]?.[j])) ab.push({ zeile: i, spalte: j });
  }));
  return ab;
}

// ── Anzeige: Buendel nach LShop_ArticleNr ───────────────────────────────────

/**
 * @param {object[]} zeilen   Korb-Zeilen (schon nach Shop gefiltert)
 * @param {Map<string,object>} modelle  ArticleNr -> LShop_Modelle-Zeile
 * @param {object} namen      SSOT-ID -> Produktname
 */
export function buendele(zeilen, modelle = new Map(), namen = {}) {
  const gruppen = new Map();
  for (const z of zeilen) {
    const nr = z.LShop_ArticleNr;
    if (!gruppen.has(nr)) {
      const m = modelle.get(nr) ?? {};
      gruppen.set(nr, {
        articleNr: nr, catalogNr: t(m.catalogNr), farbe: [t(m.color1), t(m.color2)].filter(Boolean).join('/'),
        groesse: t(m.size), zuBestellen: 0, unbezahlt: 0, positionen: [],
      });
    }
    const g = gruppen.get(nr);
    const menge = Number(z.Menge) || 0;
    const vorschlag = z.Status === STATUS.OFFEN && !hinweisSperrt(z.Hinweis);
    if (vorschlag) {
      g.zuBestellen += menge;
      if (t(z.Hinweis).split(TRENNER).includes(HINWEIS.UNBEZAHLT)) g.unbezahlt += menge;
    }
    g.positionen.push({
      schluessel: z.Schluessel, shop: z.Shop || 'JFN', herkunft: z.Herkunft, bestellnummer: z.Bestellnummer,
      position: z.Position, referenz: z.Referenz, ssotId: z['SSOT-ID'], produktname: namen[z['SSOT-ID']] ?? '',
      menge, status: z.Status, grund: z.Grund, hinweis: z.Hinweis, vorschlag, angelegt: z.Angelegt,
    });
  }
  return [...gruppen.values()].sort((a, b) => b.zuBestellen - a.zuBestellen || a.articleNr.localeCompare(b.articleNr));
}
