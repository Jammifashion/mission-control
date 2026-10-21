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
/**
 * L-Shop-Zeile einer ArticleNr in L-Shop-Schreibweise:
 * "1000386845 · MRS5004 · <Kurzbezeichnung> · White/Green · 37/41". Leere Teile fallen weg
 * (heute fehlt die Kurzbezeichnung im Reiter, siehe lib/lshop.js).
 */
export function lshopText(nr, m = {}) {
  const farbe = [t(m.color1), t(m.color2)].filter(Boolean).join('/');
  return [t(nr), t(m.catalogNr), t(m.bezeichnung), farbe, t(m.size)].filter(Boolean).join(' · ');
}

export function buendele(zeilen, modelle = new Map(), namen = {}, jetzt = new Date()) {
  const gruppen = new Map();
  for (const z of zeilen) {
    const nr = z.LShop_ArticleNr;
    if (!gruppen.has(nr)) {
      const m = modelle.get(nr) ?? {};
      gruppen.set(nr, {
        articleNr: nr, catalogNr: t(m.catalogNr), bezeichnung: t(m.bezeichnung),
        farbe: [t(m.color1), t(m.color2)].filter(Boolean).join('/'), groesse: t(m.size),
        lshopText: lshopText(nr, m), zuBestellen: 0, unbezahlt: 0, positionen: [],
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
      lshopText: g.lshopText,
      menge, status: z.Status, grund: z.Grund, notiz: z.Notiz, hinweis: z.Hinweis, vorschlag,
      angelegt: z.Angelegt, statusDatum: z.Status_Datum,
      // Nur fuer abgewaehlte Zeilen von Bedeutung: in den letzten 14 Tagen (oder unbezahlt).
      rausAktuell: z.Status === STATUS.ABGEWAEHLT && rausAktuell(z, jetzt),
      // BO3: nur offen <-> abgewaehlt ist in MC bearbeitbar; bestellt/geliefert/Lager setzt erst BO4.
      bearbeitbar: z.Status === STATUS.OFFEN || z.Status === STATUS.ABGEWAEHLT,
      grundVorschlag: grundVorschlag(z.Hinweis),
    });
  }
  return [...gruppen.values()].sort((a, b) => b.zuBestellen - a.zuBestellen || a.articleNr.localeCompare(b.articleNr));
}

// Filter "Herausgenommen": standardmaessig nur die letzten 14 Tage (nach Status_Datum).
export const RAUS_TAGE = 14;

/**
 * Gehoert eine abgewaehlte Zeile in die Standardansicht "Herausgenommen"?
 * Ja, wenn Status_Datum hoechstens RAUS_TAGE zurueckliegt, oder wenn sie den Hinweis
 * "noch nicht bezahlt" traegt (immer). Fehlt das Datum oder ist es unlesbar, ebenfalls
 * ja - lieber zeigen als still verstecken. Gezaehlt wird in ms ab jetzt (fester
 * 14x24h-Abstand, keine Kalendertage). Es wird nichts geloescht, aeltere blendet die
 * Ansicht per Link ein.
 */
export function rausAktuell(z, jetzt) {
  if (t(z.Hinweis).split(TRENNER).includes(HINWEIS.UNBEZAHLT)) return true;
  const d = Date.parse(t(z.Status_Datum));
  if (Number.isNaN(d)) return true;
  return new Date(jetzt).getTime() - d <= RAUS_TAGE * 24 * 60 * 60 * 1000;
}

/** Zaehler oben in der Ansicht: offen / herausgenommen (davon aktuell) / offen mit Hinweis. */
export function korbZaehler(zeilen, jetzt = new Date()) {
  const offen = zeilen.filter(z => z.Status === STATUS.OFFEN);
  const raus  = zeilen.filter(z => z.Status === STATUS.ABGEWAEHLT);
  return {
    offen: offen.length,
    herausgenommen: raus.length,
    herausgenommenAktuell: raus.filter(z => rausAktuell(z, jetzt)).length,
    mitHinweis: offen.filter(z => t(z.Hinweis)).length,
  };
}

// ── BO3: Status aendern (herausnehmen / zurueck auf offen) ───────────────────

// Werteliste "Grund" (antwort-BO1 Frage 5).
export const GRUENDE = ['Ware da / Lager', 'schon bestellt', 'Bestellung storniert', 'Sonstiges'];
export const ZIEL_STATUS_BO3 = [STATUS.ABGEWAEHLT, STATUS.OFFEN];
const NOTIZ_MAX = 200;

/**
 * Vorbelegung fuer den Grund aus dem Hinweis des Laufs. Sperrende Hinweise, bei
 * denen die Bestellung weg ist -> "Bestellung storniert"; abgeschlossen (die
 * Ware ging also schon raus) -> "schon bestellt". Sonst keine Vorbelegung.
 */
export function grundVorschlag(hinweis) {
  const h = t(hinweis).split(TRENNER);
  if (h.some(x => [HINWEIS.STORNIERT, HINWEIS.ERSTATTET, HINWEIS.NICHT_IM_SHOP, HINWEIS.POSITION_WEG].includes(x))) return 'Bestellung storniert';
  if (h.includes(HINWEIS.ABGESCHLOSSEN)) return 'schon bestellt';
  return '';
}

function fehler422(msg) { const e = new Error(msg); e.status = 422; return e; }
function fehler409(msg) { const e = new Error(msg); e.status = 409; return e; }

/**
 * Plan fuer einen Statuswechsel mehrerer Zeilen - alles oder nichts.
 * @param {object} o
 * @param {object[]} o.zeilen     korbZeilen() aus einem FRISCHEN Lesen
 * @param {{schluessel: string, status: string}[]} o.auswahl  Schluessel + Status, den der Browser gesehen hat
 * @param {string} o.ziel         'abgewählt' | 'offen'
 * @param {string} [o.grund]      Pflicht bei abgewählt, aus GRUENDE
 * @param {string} [o.notiz]      optional; undefined = Notiz bleibt
 * @param {string} o.jetzt        ISO
 * @returns {{ zeile: number, schluessel: string, werte: object }[]}
 */
export function statusPlan({ zeilen, auswahl, ziel, grund, notiz, jetzt }) {
  if (!ZIEL_STATUS_BO3.includes(ziel)) throw fehler422(`Status "${ziel}" ist hier nicht erlaubt (nur ${ZIEL_STATUS_BO3.join(' / ')}).`);
  if (!Array.isArray(auswahl) || !auswahl.length) throw fehler422('Keine Position gewählt.');
  if (ziel === STATUS.ABGEWAEHLT && !GRUENDE.includes(t(grund))) throw fehler422(`Grund fehlt oder ist nicht in der Liste (${GRUENDE.join(' · ')}).`);
  if (notiz !== undefined && t(notiz).length > NOTIZ_MAX) throw fehler422(`Notiz ist länger als ${NOTIZ_MAX} Zeichen.`);
  const doppelt = auswahl.map(a => t(a?.schluessel)).filter((s, i, l) => l.indexOf(s) !== i);
  if (doppelt.length) throw fehler422(`Position doppelt gewählt: ${doppelt[0]}`);

  const jeSchluessel = new Map();
  for (const z of zeilen) {
    if (jeSchluessel.has(z.Schluessel)) throw fehler409(`Schlüssel ${z.Schluessel} steht mehrfach im Reiter - nichts geändert.`);
    jeSchluessel.set(z.Schluessel, z);
  }
  const von = ziel === STATUS.ABGEWAEHLT ? STATUS.OFFEN : STATUS.ABGEWAEHLT;
  return auswahl.map(a => {
    const s = t(a.schluessel);
    const z = jeSchluessel.get(s);
    if (!z) throw fehler409(`Position ${s} gibt es nicht (mehr) - nichts geändert.`);
    if (z.Status !== t(a.status)) throw fehler409(`Position ${s} hat sich geändert (jetzt "${z.Status}") - nichts geändert. Bitte neu laden.`);
    if (z.Status !== von) throw fehler422(`Position ${s} ist "${z.Status}" - von dort geht "${ziel}" nicht.`);
    const werte = {
      Status: ziel,
      Grund: ziel === STATUS.ABGEWAEHLT ? t(grund) : '',
      Status_Datum: jetzt,
      Stand: jetzt,
    };
    if (notiz !== undefined) werte.Notiz = t(notiz);
    return { zeile: z._zeile, schluessel: s, vorher: z, werte };
  });
}

// ── BO3: eigene Positionen ──────────────────────────────────────────────────

export const EIGEN_PRAEFIX = 'EIGEN:';
const REFERENZ_MAX = 80;
const MENGE_MAX = 999;

/** Naechste Nummer EIGEN:<Jahr>-NNNN: hoechste vorhandene des Jahres + 1 (aus dem Reiter, nie aus dem Browser). */
export function naechsteEigenNummer(zeilen, jahr) {
  const praefix = `${EIGEN_PRAEFIX}${jahr}-`;
  let max = 0;
  for (const z of zeilen) {
    const s = t(z.Schluessel);
    if (!s.startsWith(praefix)) continue;
    const n = Number(s.slice(praefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${praefix}${String(max + 1).padStart(4, '0')}`;
}

/**
 * Bestellbare Varianten eines Artikels fuer die Auswahl (nur synchronisiert, Aktiv,
 * gueltige ArticleNr, in LShop_Modelle, nicht ausgelaufen / Discontinued 3/6).
 * @param {object[]} variantenZeilen  Reiter Varianten als Objekte (Spaltennamen)
 * @param {Map<string,object>} modelle
 */
export function bestellbareVarianten(variantenZeilen, modelle) {
  const aus = [];
  for (const v of variantenZeilen) {
    const aktiv = /^(true|wahr)$/i.test(t(v.Aktiv));
    const wc = t(v.WC_Variation_ID);
    const nr = t(v.LShop_ArticleNr);
    if (!aktiv || !wc || wc === '0' || !/^\d{10}$/.test(nr)) continue;
    const m = modelle.get(nr);
    if (!m || t(m.status) === 'ausgelaufen' || gesperrtDisc(m.discontinued)) continue;
    const achsen = [['E1', 'V1'], ['E2', 'V2'], ['E3', 'V3']]
      .map(([e, w]) => [t(v[e]), t(v[w])]).filter(([e, w]) => e && w);
    const farbe = achsen.find(([e]) => /^farbe$/i.test(e))?.[1] ?? '';
    const rest  = achsen.filter(([e]) => !/^farbe$/i.test(e)).map(([, w]) => w).join(' · ');
    aus.push({ wcVariationId: wc, farbe, rest, articleNr: nr });
  }
  return aus;
}

/**
 * Neue eigene Zeile pruefen und bauen.
 * @param {object} o  { eingabe: { ssotId, wcVariationId, menge, referenz, notiz }, artikel, varianten, schluessel, jetzt }
 *   artikel: Maske-Zeile { id, pid } oder undefined; varianten: bestellbareVarianten() dieses Artikels
 */
export function eigeneZeile({ eingabe = {}, artikel, varianten, schluessel, jetzt }) {
  if (!artikel || !t(artikel.pid)) throw fehler422('Artikel nicht gefunden oder nicht synchronisiert - im SSOT nachpflegen.');
  const v = varianten.find(x => x.wcVariationId === t(eingabe.wcVariationId));
  if (!v) throw fehler422('Variante ist nicht L-Shop-bestellbar (Aktiv, gültige LShop_ArticleNr, nicht ausgelaufen) - im SSOT nachpflegen.');
  const menge = Number(eingabe.menge);
  if (!Number.isInteger(menge) || menge < 1 || menge > MENGE_MAX) throw fehler422(`Menge muss eine ganze Zahl von 1 bis ${MENGE_MAX} sein.`);
  const referenz = t(eingabe.referenz);
  if (!referenz) throw fehler422('Referenz fehlt (z. B. "Lager", "Muster", "Verein X Auftrag 12").');
  if (referenz.length > REFERENZ_MAX) throw fehler422(`Referenz ist länger als ${REFERENZ_MAX} Zeichen.`);
  const notiz = t(eingabe.notiz);
  if (notiz.length > NOTIZ_MAX) throw fehler422(`Notiz ist länger als ${NOTIZ_MAX} Zeichen.`);
  return {
    Schluessel: schluessel, Shop: 'JFN', Herkunft: HERKUNFT.EIGEN, Bestellnummer: '', Position: '',
    Referenz: referenz, 'SSOT-ID': t(artikel.id), LShop_ArticleNr: v.articleNr, Menge: String(menge),
    Status: STATUS.OFFEN, Grund: '', Hinweis: '', Status_Datum: jetzt, Bestell_ID: '', Notiz: notiz,
    Angelegt: jetzt, Quelle_Lauf: 'Knopf', Stand: jetzt,
  };
}
