// Halloween-Kollektion 2026 anlegen (Auftrag HW2) - Kategorie + 5 variable
// Artikel als ENTWURF, Achsen Farbe (global, ein Wert) x Groesse (global) x
// Motiv (lokal, 8 Werte). Aufrufer: backend/scripts/anlage-halloween.js.
//
// Grundlage: bericht-HW1 + Entscheidungen Inhaber 10.10. (Postfach). Die Maske
// kann das nicht sicher: sie legt Variationen einzeln und ungedrosselt an (je
// Artikel 48-72 POSTs, Hoster-Pruefseite nach ~11 schnellen Abrufen) und bietet
// keinen freien Achsennamen an. Darum hier, mit denselben Bausteinen:
//   sku.js (Artikelnummer, Varianten-SKUs, 50 Zeichen, Dubletten)
//   varianten-achsen.js (Farbachse Pflicht, _wc_gla_color = Farbwert 1:1)
//   lieferzeiten.js (Standard am Elternartikel, "-1" an jeder Variation)
//   lshop.js (lshopAuswertung: Farben, Groessen, ArticleNr, Discontinued)
//   groessen.js (Rang/Sortierung, menu_order), varianten-zeilen.js (Zeilen),
//   wc-variation-ids.js (Sperre gegen doppelte Variationen, Zuordnung der IDs
//   NUR ueber die Kombination).
//
// Global oder lokal (Befund HW1, Luecke 2): WooCommerce REST v3 macht ein
// Attribut nur dann global, wenn es mit `id` kommt; `name` allein ergibt ein
// lokales Attribut. Die Maske sendet nie eine id. Hier: Farbe und Groesse MIT
// id (ermittelt ueber den Namen aus products/attributes, keine IDs im Code),
// Motiv OHNE id. Ein globales Attribut "Motiv" ist dafuer NICHT noetig - gaebe
// es eins, bliebe "Motiv" trotzdem lokal, weil es ohne id gesendet wird.
//
// Variations-SKU: Die vollen Motivtitel passen nicht in 50 Zeichen
// ("JH030F/HW-Halloween-deep-black-xxl-ich-bin-wegen-des-kuchens-hier" = 65).
// Der SKU-Teil des Motivs ist darum ein fester Kurzwert je Motiv (MOTIVE.sku),
// gebaut mit baueVariantenSkus wie in der Maske. Achse und Varianten-Reiter
// tragen den vollen Titel.
//
// Ablauf --write je Artikel: GET products?sku (Fortsetzen) -> Produkt-POST als
// Entwurf -> variations/batch in Bloecken <= 50, 2 s Takt -> alle Variationen
// zuruecklesen -> erst wenn ALLE Kombinationen im Shop stehen: Maske- und
// Varianten-Zeile (mit WC_Variation_ID). Pruefseite, Zeitlimit oder 502 ->
// AnlageStopp mit Stand; der naechste Lauf findet Produkt und Variationen ueber
// SKU und Kombination wieder und legt nur Fehlendes an.

import { baueArtikelnummer, baueVariantenSkus } from './sku.js';
import { achsenVon, pruefeFarbAchse, mitGoogleFarbe, FARB_ACHSE } from './varianten-achsen.js';
import { LIEFERZEIT_WIE_ELTERN, mitLieferzeit, parseLieferzeiten } from './lieferzeiten.js';
import { lshopAuswertung } from './lshop.js';
import { groessenRang, sortiereGroessen, variantenReihenfolge } from './groessen.js';
import { leseAlleVariationen, sperreDoppelte, wcSchluessel, paareAusWc, ordneWcIdsZu } from './wc-variation-ids.js';
import { istLaufStopp, seitenGrenze, seitenListe } from './hosterPruefseite.js';
import { baueVariantenZeilen, pruefeVariantenPayload } from '../utils/varianten-zeilen.js';
import { buildRow } from '../utils/sheet-rows.js';
import { findHeader, requireHeader, requireHeaderAny } from '../utils/sheet-headers.js';

// ── Festlegungen (Entscheidungen Inhaber 10.10.) ────────────────────────────

export const KURZ        = 'HW-Halloween';
export const MOTIV_ACHSE = 'Motiv';
export const GROESSE_ACHSE = 'Größe';
export const KATEGORIE   = { name: 'Halloween', slug: 'halloween', parent: 0 };
export const TAKT_MS     = 2000;
export const BLOCK_MAX   = 50;
// Platzhalter: Entwurf, der Text kommt danach ueber den normalen SEO-Flow.
export const TEXT_PLATZHALTER = '<p>Text folgt (SEO-Flow).</p>';

// Reihenfolge = Reihenfolge der Auswahl im Shop. sku = SKU-Teil (normalisiert).
export const MOTIVE = [
  { titel: 'There the Dog',                    sku: 'dog',       bild: 'Mops in der Pfanne' },
  { titel: 'There the Otter',                  sku: 'otter',     bild: 'Otter in der Pfanne' },
  { titel: 'Free Hugs',                        sku: 'freehugs',  bild: 'Sensenmann' },
  { titel: "Trust me, I'm a Doctor",           sku: 'doctor',    bild: 'Pestdoktor' },
  { titel: 'Vertrau mir, ich bin Arzt',        sku: 'arzt',      bild: 'Pestdoktor, deutscher Text' },
  { titel: 'Ich will doch nur spielen',        sku: 'clown',     bild: 'Horror-Clown' },
  { titel: 'Stay alive – Challenge accepted',  sku: 'stayalive', bild: 'Zombie-T-Rex' },
  { titel: 'Ich bin wegen des Kuchens hier',   sku: 'kuchen',    bild: 'Maskierter mit Axt' },
];

// Groessen: von/bis in L-Shop-Schreibweise; null = alle waehlbaren (JH180 nach LS1).
// farbe null = aus LS1: genau eine Modellfarbe mit "wash" und "black".
export const ARTIKEL = [
  { titel: 'Halloween Shirt Herren',   modell: 'E3000',  farbe: 'Black',      von: 'XS', bis: '5XL', versand: 'grossbrief',
    keyphrase: 'Halloween Shirt Herren',   synonyme: ['Halloween T-Shirt Herren', 'Horror Shirt Herren', 'Grusel Shirt'] },
  { titel: 'Halloween Shirt Damen',    modell: 'E3005',  farbe: 'Black',      von: 'XS', bis: '3XL', versand: 'grossbrief',
    keyphrase: 'Halloween Shirt Damen',    synonyme: ['Halloween T-Shirt Damen', 'Horror Shirt Damen'] },
  { titel: 'Halloween Pullover Herren', modell: 'JH030', farbe: 'Deep Black', von: 'XS', bis: '5XL', versand: 'paket',
    keyphrase: 'Halloween Pullover Herren', synonyme: ['Halloween Sweatshirt Herren', 'Horror Pullover'] },
  { titel: 'Halloween Pullover Damen', modell: 'JH030F', farbe: 'Deep Black', von: 'XS', bis: 'XXL', versand: 'paket',
    keyphrase: 'Halloween Pullover Damen', synonyme: ['Halloween Sweatshirt Damen'] },
  { titel: 'Halloween Hoodie Vintage', modell: 'JH180',  farbe: null,         von: null, bis: null,  versand: 'paket',
    keyphrase: 'Halloween Hoodie',         synonyme: ['Vintage Hoodie Halloween', 'Washed Hoodie Horror'] },
];

export const KATEGORIE_KARTE = {
  keyphrase: 'Halloween Shirts',
  synonyme:  ['Halloween T-Shirts', 'Horror Shirts', 'Halloween Pullover'],
};

// Vorschlaege fuer SSOT-Texte (gehen in den SEO-Prompt -> FREIGABE INHABER vor --write).
export const KATEGORIE_SEO_HINWEIS =
  'Halloween von JammiFashion: bedruckte Shirts, Pullover und Hoodies mit Halloween-Motiven, '
  + 'gedruckt nach Bestellung in Wrist. Herren im geraden Schnitt, Damen tailliert. '
  + 'Das Motiv wird am Artikel ausgewählt.';
export const MOTIV_ZEILE = {
  motiv: `Halloween-Kollektion mit ${MOTIVE.length} Motiven zur Auswahl: `
    + MOTIVE.map(m => `„${m.titel}“ (${m.bild})`).join('; '),
  druckposition: '',
  druckfarben: '',
  druckfarbeJeTextilfarbe: 'nein, fest',
  serieKontext: 'Halloween-Kollektion 2026',
  nurIntern: '',
  offen: 'Druckposition, Druckfarben, Fanart-Hinweis je Motiv (Inhaber)',
};

const t = v => String(v ?? '').trim();
const klein = v => t(v).toLowerCase();

// ── Reine Logik ─────────────────────────────────────────────────────────────

/** Liste in Bloecke von hoechstens n Eintraegen (Reihenfolge bleibt). */
export function teileInBloecke(liste, n = BLOCK_MAX) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Blockgroesse ${n} ungueltig.`);
  const out = [];
  for (let i = 0; i < (liste ?? []).length; i += n) out.push(liste.slice(i, i + n));
  return out;
}

/**
 * Shop-Term zur L-Shop-Groesse: exakt (Gross/Klein egal), sonst gleicher Rang
 * in derselben Klasse (L-Shop "XXL" = Shop "2XL"). Kein oder mehrere -> null.
 */
export function shopGroesse(lshopGroesse, shopTerme) {
  const terme = (shopTerme ?? []).map(t);
  const exakt = terme.find(x => klein(x) === klein(lshopGroesse));
  if (exakt) return exakt;
  const r = groessenRang(lshopGroesse);
  if (!r) return null;
  const gleich = terme.filter(x => { const s = groessenRang(x); return s && s.klasse === r.klasse && s.rang === r.rang; });
  return gleich.length === 1 ? gleich[0] : null;
}

/** Groessen im Bereich von..bis (Rang, inklusive). Ohne Grenzen: alle. */
export function groessenImBereich(groessen, von, bis) {
  if (!von && !bis) return [...groessen];
  const rv = von ? groessenRang(von)?.rang : -Infinity;
  const rb = bis ? groessenRang(bis)?.rang : Infinity;
  return groessen.filter(g => { const r = groessenRang(g)?.rang; return r != null && r >= rv && r <= rb; });
}

/** Erwartete Groessen von..bis (nur Buchstabengroessen), fuer die Vollstaendigkeitspruefung. */
function erwarteteRaenge(von, bis) {
  const a = groessenRang(von)?.rang, b = groessenRang(bis)?.rang;
  if (a == null || b == null) return [];
  const r = [];
  for (let i = a; i <= b; i++) r.push(i);
  return r;
}

/**
 * Preis je Groesse aus der lokalen Preisdatei: { <Modell>: { basis, groessen: { "3XL": .. } } }.
 * Groessen-Schluessel in Shop- oder L-Shop-Schreibweise (Rang-Vergleich).
 * @returns {string|null} "25.00" oder null (fehlt)
 */
export function preisFuer(preise, modell, groesse) {
  const p = preise?.[modell];
  if (!p) return null;
  const r = groessenRang(groesse);
  let wert = null;
  for (const [k, v] of Object.entries(p.groessen ?? {})) {
    const rk = groessenRang(k);
    if ((klein(k) === klein(groesse) || (r && rk && rk.klasse === r.klasse && rk.rang === r.rang)) && v !== null && v !== '') wert = v;
  }
  if (wert === null) wert = p.basis;
  if (wert === null || wert === undefined || wert === '') return null;
  const n = Number(String(wert).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
}

/** Vorlage der Preisdatei: alle Modelle, Groessen der Planung, leere Werte. */
export function preisVorlage(plaene) {
  const out = { _hinweis: 'Preise in EUR brutto, z. B. 25 oder "25,00". basis = alle Groessen, groessen = Abweichung je Groesse. Datei nie einchecken.' };
  for (const p of plaene) {
    const groessen = p.groessen?.length ? p.groessen.map(g => g.shop ?? g.lshop) : [];
    out[p.artikel.modell] = { basis: null, groessen: Object.fromEntries(groessen.map(g => [g, null])) };
  }
  return out;
}

/**
 * Plan EINES Artikels (ohne Shop-Zugriff).
 * @param {object} o
 * @param {object} o.artikel    Eintrag aus ARTIKEL
 * @param {object[]} o.lshopZeilen  alle Zeilen aus LShop_Modelle (ladeLShopZeilen)
 * @param {string[]} o.groessenTerme  Namen der Terme von "Größe" im Shop
 * @param {object} [o.preise]
 * @returns {{ artikel, status: 'bereit'|'wartet auf LS1'|'fehler', artikelnummer, farbe,
 *             groessen: {lshop, shop, articleNr}[], varianten: object[], hinweise: string[] }}
 */
export function planeArtikel({ artikel, lshopZeilen, groessenTerme, preise }) {
  const hinweise = [];
  const plan = { artikel, status: 'bereit', artikelnummer: '', farbe: artikel.farbe, groessen: [], varianten: [], hinweise };
  const fehler = (msg, status = 'fehler') => { hinweise.push(msg); plan.status = status; return plan; };

  const nr = baueArtikelnummer(artikel.modell, KURZ);
  if (nr.fehler) return fehler(nr.fehler);
  plan.artikelnummer = nr.artikelnummer;

  const zeilen = (lshopZeilen ?? []).filter(z => klein(z.catalogNr) === klein(artikel.modell));
  if (!zeilen.length) return fehler(`${artikel.modell} steht nicht in LShop_Modelle – wartet auf LS1 (Modelle_Zusatz + Übernehmen).`, 'wartet auf LS1');

  let farbe = artikel.farbe;
  if (!farbe) {
    const alle = lshopAuswertung(zeilen).alleFarben;
    const treffer = alle.filter(f => /wash/i.test(f) && /black/i.test(f));
    if (treffer.length !== 1)
      return fehler(`${artikel.modell}: gewaschene schwarze Farbe nicht eindeutig (${treffer.length ? treffer.join(', ') : 'keine'}; Modellfarben: ${alle.join(', ')}) – Inhaber legt fest.`);
    farbe = treffer[0];
  }
  plan.farbe = farbe;

  const aus = lshopAuswertung(zeilen, { farben: [farbe] });
  hinweise.push(...aus.hinweise);
  if (!aus.farben.length) return fehler(`${artikel.modell}: Farbe "${farbe}" nicht wählbar.`);
  if (aus.auslaufend.some(a => a.farbe === farbe))
    hinweise.push(`${artikel.modell} ${farbe}: läuft aus (${aus.auslaufend.filter(a => a.farbe === farbe).map(a => `${a.groesse}=${a.wert}`).join(', ')}).`);

  const imBereich = groessenImBereich(aus.groessen, artikel.von, artikel.bis);
  if (artikel.von && artikel.bis) {
    const fehlt = erwarteteRaenge(artikel.von, artikel.bis).filter(r => !imBereich.some(g => groessenRang(g)?.rang === r));
    if (fehlt.length) return fehler(`${artikel.modell} ${farbe}: ${fehlt.length} Größe(n) zwischen ${artikel.von} und ${artikel.bis} nicht wählbar.`);
  }
  if (!imBereich.length) return fehler(`${artikel.modell} ${farbe}: keine wählbare Größe.`);

  for (const g of sortiereGroessen(imBereich).sortiert) {
    const v = aus.varianten.find(x => x.farbe === farbe && x.groesse === g);
    const shop = shopGroesse(g, groessenTerme);
    if (!shop) hinweise.push(`Größe "${g}" hat keinen Term in "Größe" – wird beim Anlegen neu angelegt.`);
    plan.groessen.push({ lshop: g, shop: shop ?? g, articleNr: v.articleNr, neuTerm: !shop });
  }

  // Varianten: Groesse aufsteigend, je Groesse die Motive in fester Reihenfolge.
  for (const g of plan.groessen) {
    for (const m of MOTIVE) {
      plan.varianten.push({
        farbe, groesse: g.shop, lshopGroesse: g.lshop, motiv: m.titel, motivSku: m.sku,
        articleNr: g.articleNr, preis: preisFuer(preise, artikel.modell, g.shop),
      });
    }
  }
  const skus = baueVariantenSkus(plan.artikelnummer,
    plan.varianten.map(v => ({ attrs: [{ value: v.farbe }, { value: v.groesse }, { value: v.motivSku }] })));
  if (skus.fehler) return fehler(skus.fehler);
  plan.varianten.forEach((v, i) => { v.sku = skus.skus[i]; });

  const achsenFehler = pruefeFarbAchse(achsenVon({ varianten: plan.varianten.map(variationsAttribute) }));
  if (achsenFehler) return fehler(achsenFehler.fehler);

  const ohnePreis = plan.varianten.filter(v => !v.preis).length;
  if (ohnePreis) hinweise.push(`${ohnePreis} von ${plan.varianten.length} Variationen ohne Preis (Preisdatei).`);
  return plan;
}

/** Variations-Attribute im WooCommerce-Format; ids nur, wenn bekannt (global). */
export function variationsAttribute(v, attrIds = {}) {
  return [
    { ...(attrIds.farbe ? { id: attrIds.farbe } : {}), name: FARB_ACHSE, option: v.farbe },
    { ...(attrIds.groesse ? { id: attrIds.groesse } : {}), name: GROESSE_ACHSE, option: v.groesse },
    { name: MOTIV_ACHSE, option: v.motiv },
  ];
}

/**
 * Body fuer POST products (Entwurf).
 * @param {object} plan  aus planeArtikel (status bereit)
 * @param {object} o  { kategorieId, attrIds: {farbe, groesse}, markeId, lieferzeit }
 */
export function produktPayload(plan, { kategorieId, attrIds, markeId, lieferzeit }) {
  if (!attrIds?.farbe || !attrIds?.groesse) throw new Error('Attribut-IDs fuer Farbe/Größe fehlen.');
  return {
    name: plan.artikel.titel,
    type: 'variable',
    status: 'draft',
    sku: plan.artikelnummer,
    description: TEXT_PLATZHALTER,
    short_description: '',
    reviews_allowed: true,
    shipping_class: plan.artikel.versand,
    categories: kategorieId ? [{ id: kategorieId }] : [],
    ...(markeId ? { brands: [{ id: markeId }] } : {}),
    meta_data: mitLieferzeit([], lieferzeit),
    attributes: [
      { id: attrIds.farbe,   position: 0, visible: true, variation: true, options: [plan.farbe] },
      { id: attrIds.groesse, position: 1, visible: true, variation: true, options: plan.groessen.map(g => g.shop) },
      { name: MOTIV_ACHSE,   position: 2, visible: true, variation: true, options: MOTIVE.map(m => m.titel) },
    ],
  };
}

/**
 * Bodies fuer variations/batch create, sortiert (Farbe, Groesse, dann Motiv-
 * Reihenfolge) mit menu_order. Jede Variation: "-1" Lieferzeit, _wc_gla_color.
 */
export function variationsPayloads(plan, attrIds) {
  const roh = plan.varianten.map(v => ({ v, attributes: variationsAttribute(v, attrIds) }));
  const reihenfolge = variantenReihenfolge(roh.map(r => ({ attributes: r.attributes })),
    [{ name: FARB_ACHSE, options: [plan.farbe] }]);
  return reihenfolge.map((i, pos) => {
    const { v, attributes } = roh[i];
    return {
      sku: v.sku,
      regular_price: v.preis ?? '',
      status: 'publish',
      menu_order: pos + 1,
      attributes,
      meta_data: mitGoogleFarbe(mitLieferzeit([], LIEFERZEIT_WIE_ELTERN), attributes),
    };
  });
}

/** Payload fuer den Reiter Varianten (utils/varianten-zeilen.js) mit WC-IDs. */
export function variantenSheetPayload(plan, wcIds = []) {
  return plan.varianten.map((v, i) => ({
    nr: i + 1,
    e1: FARB_ACHSE, v1: v.farbe,
    e2: GROESSE_ACHSE, v2: v.groesse,
    e3: MOTIV_ACHSE, v3: v.motiv,
    preis: v.preis !== null && v.preis !== undefined && v.preis !== '' ? Number(v.preis) : '',
    aktiv: true,
    wcVariationId: wcIds[i] ? Number(wcIds[i]) : '',
    googleFarbe: v.farbe,
    lshopArticleNr: v.articleNr,
  }));
}

/** Body fuer die Erfassungsmaske (wie buildSheetPayload + Nachlauf der Maske). */
export function maskeBody(plan, { produktId = '', marke = '' } = {}) {
  return {
    'Status': 'Im Shop',
    'Status Shop': 'Entwurf',
    'Produkt-ID': String(produktId ?? ''),
    'SEO_Status': 'Ausstehend',
    'Produktname': plan.artikel.titel,
    'Produktart': 'Variabel',
    'L-Shop-Artikelnummer': plan.artikel.modell,
    'Artikelkurzbezeichnung': KURZ,
    'Artikelnummer': plan.artikelnummer,
    'Versandklasse': plan.artikel.versand,
    'Kategorien': KATEGORIE.name,
    'Marke': marke,
    'Fokus_Keyphrase': plan.artikel.keyphrase,
    'Fokus_Synonyme': plan.artikel.synonyme.join(', '),
  };
}

/** Naechste SSOT-ID nach dem Muster der Maske (JFN-<Jahr>-<4 Ziffern>, max + 1). */
export function naechsteSsotIds(ids, anzahl, jahr = new Date().getFullYear()) {
  const prefix = `JFN-${jahr}-`;
  let max = 0;
  for (const id of ids ?? []) {
    const s = t(id);
    if (!s.startsWith(prefix)) continue;
    const n = parseInt(s.slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return Array.from({ length: anzahl }, (_, i) => `${prefix}${String(max + 1 + i).padStart(4, '0')}`);
}

/** Letzte belegte Zeile (1-basiert) eines Reiters: letzte Zeile mit irgendeinem Wert. */
export function letzteZeile(werte) {
  for (let i = (werte ?? []).length - 1; i >= 0; i--)
    if ((werte[i] ?? []).some(c => t(c))) return i + 1;
  return 0;
}

/**
 * Sheet-Plan: SSOT-IDs, Zeilennummern und Zeileninhalte - aus den aktuell
 * gelesenen Reitern (Zaehler werden jedes Mal neu gemessen).
 * @param {object} reiter  { Erfassungsmaske, Varianten, Motive, Struktur_Kategorien, SEO_Karte } (Werte inkl. Kopf)
 * @param {object[]} plaene  aus planeArtikel
 */
export function planeSheets(reiter, plaene, { kategorieId = '', heute } = {}) {
  const E = reiter.Erfassungsmaske ?? [[]], V = reiter.Varianten ?? [[]], M = reiter.Motive ?? [[]];
  const K = reiter.Struktur_Kategorien ?? [[]], S = reiter.SEO_Karte ?? [[]];
  const eh = E[0] ?? [];
  const eId = requireHeaderAny(eh, ['SSOT-ID', 'ID'], 'Erfassungsmaske');
  const eArt = requireHeader(eh, 'Artikelnummer', 'Erfassungsmaske');
  const ssotIds = naechsteSsotIds(E.slice(1).map(r => r[eId]), plaene.length);

  const vorhandenMaske = new Map(E.slice(1).map((r, i) => [t(r[eArt]), { ssot: t(r[eId]), zeile: i + 2 }]));
  let maskeZeile = letzteZeile(E), variantenZeile = letzteZeile(V);
  let n = 0;
  const artikel = plaene.map(p => {
    if (p.status !== 'bereit') return { plan: p, ssot: '', maskeZeile: null, variantenVon: null, variantenBis: null };
    const da = vorhandenMaske.get(p.artikelnummer);
    if (da) return { plan: p, ssot: da.ssot, maskeZeile: da.zeile, vorhanden: true, variantenVon: null, variantenBis: null };
    const ssot = ssotIds[n++];
    maskeZeile += 1;
    const von = variantenZeile + 1;
    variantenZeile += p.varianten.length;
    return { plan: p, ssot, maskeZeile, variantenVon: von, variantenBis: variantenZeile };
  });

  const mh = M[0] ?? [];
  const mKurz = requireHeader(mh, 'Artikelkurzbezeichnung', 'Motive');
  const motivDa = M.slice(1).some(r => t(r[mKurz]) === KURZ);
  const kh = K[0] ?? [];
  const kName = requireHeader(kh, 'Kategoriename', 'Struktur_Kategorien');
  const kategorieDa = K.slice(1).some(r => klein(r[kName]) === klein(KATEGORIE.name));
  const sh = S[0] ?? [];
  const sTyp = requireHeader(sh, 'Typ', 'SEO_Karte'), sName = requireHeader(sh, 'Name', 'SEO_Karte');
  const karteDa = S.slice(1).some(r => t(r[sTyp]) === 'Kategorie' && klein(r[sName]) === klein(KATEGORIE.name));

  return {
    artikel,
    zaehler: {
      ssotZuletzt: maxSsot(E.slice(1).map(r => r[eId])),
      maskeZuletzt: letzteZeile(E), variantenZuletzt: letzteZeile(V), motiveZuletzt: letzteZeile(M),
      kategorienZuletzt: letzteZeile(K), karteZuletzt: letzteZeile(S),
    },
    motive:     motivDa ? { vorhanden: true } : { zeile: letzteZeile(M) + 1, werte: motivZeile(mh, heute) },
    kategorie:  kategorieDa ? { vorhanden: true } : { zeile: letzteZeile(K) + 1, werte: kategorieZeile(kh, kategorieId) },
    karte:      karteDa ? { vorhanden: true } : { zeile: letzteZeile(S) + 1, werte: karteZeile(sh, kategorieId, heute) },
  };
}

function maxSsot(ids) {
  const s = (ids ?? []).map(t).filter(x => /^JFN-\d{4}-\d+$/.test(x)).sort();
  return s[s.length - 1] ?? '';
}

function zeileNachKopf(header, felder) {
  return header.map(h => { const k = Object.keys(felder).find(n => findHeader([h], n) === 0); return k ? felder[k] : ''; });
}

export function motivZeile(header, heute) {
  return zeileNachKopf(header, {
    Artikelkurzbezeichnung: KURZ, Motiv: MOTIV_ZEILE.motiv, Druckposition: MOTIV_ZEILE.druckposition,
    Druckfarben: MOTIV_ZEILE.druckfarben, Druckfarbe_je_Textilfarbe: MOTIV_ZEILE.druckfarbeJeTextilfarbe,
    Serie_Kontext: MOTIV_ZEILE.serieKontext, Nur_intern: MOTIV_ZEILE.nurIntern, Offen: MOTIV_ZEILE.offen, Stand: heute ?? '',
  });
}

export function kategorieZeile(header, kategorieId) {
  return zeileNachKopf(header, {
    Kategorienummer: kategorieId ? String(kategorieId) : '', Kategorien: KATEGORIE.name,
    Kategoriename: KATEGORIE.name, SEO_Hinweis: KATEGORIE_SEO_HINWEIS,
  });
}

export function karteZeile(header, kategorieId, heute) {
  return zeileNachKopf(header, {
    Typ: 'Kategorie', Name: KATEGORIE.name, Pfad: KATEGORIE.name, WC_ID: kategorieId ? String(kategorieId) : '',
    Oberkategorie: KATEGORIE.name, Soll_Keyphrase: KATEGORIE_KARTE.keyphrase,
    Soll_Synonyme: KATEGORIE_KARTE.synonyme.join(', '), Status: 'Vorschlag', Stand: heute ?? '',
    Notiz: 'HW2: vorbereitet, Yoast-Werte folgen',
  });
}

/**
 * Anzahl Shop-Aufrufe fuer --write (Planung, ohne Zuruecklesen von Fehlern).
 * Je Artikel: GET sku + POST Produkt + Bloecke + Zuruecklesen (100 je Seite).
 */
export function geplanteAufrufe(plaene, { kategorieFehlt = true, neueTerme = 0 } = {}) {
  const bereit = plaene.filter(p => p.status === 'bereit');
  const jeArtikel = bereit.map(p => {
    const n = p.varianten.length;
    return 2 + teileInBloecke(p.varianten, BLOCK_MAX).length + Math.max(1, Math.ceil((n + 1) / 100));
  });
  const vorlauf = 5;   // attributes, terms Farbe, terms Groesse, shipping_classes, brands
  const summe = vorlauf + (kategorieFehlt ? 2 : 0) + neueTerme + jeArtikel.reduce((a, b) => a + b, 0);
  return { jeArtikel, summe, sekunden: summe * TAKT_MS / 1000 };
}

// ── Shop-Zugriff (getaktet) ─────────────────────────────────────────────────

/** Fehler, der den Lauf beendet; traegt den Stand (was schon angelegt ist). */
export class AnlageStopp extends Error {
  constructor(grund, stand, ursache) {
    super(`Lauf gestoppt: ${grund}`);
    this.name = 'AnlageStopp';
    this.stand = stand;
    this.ursache = ursache;
  }
}

export const istStoppFehler = err => istLaufStopp(err) || err?.response?.status === 502;

/**
 * WooCommerce-Client mit Takt: hoechstens ein Aufruf je `taktMs`, gezaehlt.
 * Gleiche Schnittstelle wie getWcClient (get/post/put), damit
 * leseAlleVariationen ihn ebenfalls nutzt.
 */
export function getakteterClient(wc, { taktMs = TAKT_MS, warte = ms => new Promise(r => setTimeout(r, ms)), jetzt = () => Date.now() } = {}) {
  let letzte = -Infinity;
  const zaehler = { get: 0, post: 0, put: 0 };
  const takt = async () => {
    const w = letzte + taktMs - jetzt();
    if (w > 0) await warte(w);
    letzte = jetzt();
  };
  const mach = m => async (...args) => { await takt(); zaehler[m]++; return wc[m](...args); };
  return { get: mach('get'), post: mach('post'), put: mach('put'), zaehler, shopLabel: wc.shopLabel };
}

/** Globale Attribut-IDs ueber den Namen (Farbe, Größe). Fehlt eins -> Fehler. */
export function attributIds(attribute) {
  const finde = name => (attribute ?? []).find(a => klein(a.name) === klein(name))?.id ?? null;
  const ids = { farbe: finde(FARB_ACHSE), groesse: finde(GROESSE_ACHSE), motivGlobal: finde(MOTIV_ACHSE) };
  if (!ids.farbe || !ids.groesse) throw new Error(`Globales Attribut fehlt: ${[!ids.farbe && FARB_ACHSE, !ids.groesse && GROESSE_ACHSE].filter(Boolean).join(', ')}.`);
  return ids;
}

/** Alle Terme eines Attributs (Namen), alle Seiten. */
export async function leseTerme(wc, attributId) {
  const alle = [];
  for (let page = 1; ; page++) {
    seitenGrenze(page, { wc, pfad: 'products/attributes/terms' });
    const { data } = await wc.get(`products/attributes/${attributId}/terms`, { per_page: 100, page });
    const liste = seitenListe(data, { wc, pfad: 'products/attributes/terms' });
    alle.push(...liste.map(x => ({ id: x.id, name: x.name })));
    if (liste.length < 100) return alle;
  }
}

/** Shop-Vorlauf (nur GET): Attribute, Terme, Versandklassen, Kategorie, Marke. */
export async function leseShopStand(wc, { markenSlug = 'jammifashion' } = {}) {
  const attrListe = seitenListe((await wc.get('products/attributes', { per_page: 100 })).data, { wc, pfad: 'products/attributes' });
  const ids = attributIds(attrListe);
  const farbTerme = await leseTerme(wc, ids.farbe);
  const groessenTerme = await leseTerme(wc, ids.groesse);
  const klassen = seitenListe((await wc.get('products/shipping_classes', { per_page: 100 })).data, { wc, pfad: 'products/shipping_classes' });
  const kats = seitenListe((await wc.get('products/categories', { search: KATEGORIE.name, per_page: 100 })).data, { wc, pfad: 'products/categories' });
  const kategorie = kats.find(k => klein(k.name) === klein(KATEGORIE.name) && Number(k.parent) === 0) ?? null;
  const marken = (await wc.get('products/brands', { slug: markenSlug })).data;
  const marke = (Array.isArray(marken) ? marken : [marken]).find(m => m?.slug === markenSlug) ?? null;
  return {
    attrIds: { farbe: ids.farbe, groesse: ids.groesse }, motivGlobal: ids.motivGlobal,
    farbTerme: farbTerme.map(x => x.name), groessenTerme: groessenTerme.map(x => x.name),
    versandklassen: klassen.map(k => k.slug), kategorie: kategorie ? { id: kategorie.id, count: kategorie.count } : null,
    marke: marke ? { id: marke.id, name: marke.name } : null,
  };
}

/** Produkt ueber die exakte SKU (status any) - fuer Fortsetzen ohne Doppelanlage. */
export async function findeProdukt(wc, sku) {
  const { data } = await wc.get('products', { sku, status: 'any', per_page: 10, _fields: 'id,sku,status,type,name' });
  const liste = seitenListe(data, { wc, pfad: 'products' }).filter(p => t(p.sku) === t(sku));
  if (liste.length > 1) throw new Error(`SKU "${sku}" ist im Shop ${liste.length}-mal vergeben (${liste.map(p => p.id).join(', ')}) – nichts angelegt.`);
  return liste[0] ?? null;
}

/**
 * Einen Artikel im Shop anlegen bzw. vervollstaendigen (nur mit --write).
 * Gibt { produktId, angelegt, vorhanden, fehler, variationen } zurueck.
 * Pruefseite/Zeitlimit/502 -> AnlageStopp mit Stand.
 */
export async function legeArtikelAn(wc, plan, kontext, { log = () => {} } = {}) {
  const stand = { artikel: plan.artikel.titel, sku: plan.artikelnummer, produktId: null, produktNeu: false, angelegt: 0, vorhanden: 0, fehler: [] };
  try {
    let produkt = await findeProdukt(wc, plan.artikelnummer);
    if (produkt) {
      if (produkt.type !== 'variable') throw new Error(`SKU "${plan.artikelnummer}" gehört zu Produkt ${produkt.id} vom Typ ${produkt.type} – nichts angelegt.`);
      log(`  vorhanden: Produkt ${produkt.id} (${produkt.status}) – nur Fehlendes wird ergänzt`);
    } else {
      const { data } = await wc.post('products', produktPayload(plan, kontext));
      produkt = Array.isArray(data) ? data[0] : data;
      if (!produkt?.id) throw new Error('WooCommerce hat keine Produkt-ID zurückgegeben – keine Variationen angelegt.');
      stand.produktNeu = true;
      log(`  angelegt: Produkt ${produkt.id} (Entwurf)`);
    }
    stand.produktId = produkt.id;

    const neu = variationsPayloads(plan, kontext.attrIds);
    const bestehend = stand.produktNeu ? [] : await leseAlleVariationen(wc, produkt.id);
    const sperre = sperreDoppelte(neu, bestehend);
    stand.vorhanden = sperre.vorhanden.length;
    const anlegen = sperre.anlegen.map(i => neu[i]);
    for (const block of teileInBloecke(anlegen, BLOCK_MAX)) {
      const { data } = await wc.post(`products/${produkt.id}/variations/batch`, { create: block });
      for (const [i, c] of (data?.create ?? []).entries()) {
        if (c?.id && !c.error) stand.angelegt++;
        else stand.fehler.push(`${block[i]?.sku}: ${c?.error?.message ?? 'ohne ID'}`);
      }
      log(`  Block: ${block.length} gesendet, bisher ${stand.angelegt} angelegt`);
    }

    const imShop = await leseAlleVariationen(wc, produkt.id);
    const zuordnung = ordneWcIdsZu(plan.varianten.map(v => ({ paare: paareAusWc(variationsAttribute(v)), wcVariationId: '' })),
      imShop.map(v => ({ id: v.id, attributes: v.attributes })));
    const ids = [];
    for (const z of zuordnung.zuordnung) ids[z.index] = z.id;
    const fehlend = plan.varianten.filter((_, i) => !ids[i]).length;
    return { ...stand, variationen: imShop.length, wcIds: ids, fehlend, hinweise: zuordnung.hinweise };
  } catch (err) {
    if (istStoppFehler(err)) throw new AnlageStopp(err.message, stand, err);
    throw Object.assign(err, { stand });
  }
}

/** Shop-Kombinationen vollstaendig? (Schluessel ueber wcSchluessel). */
export function fehlendeKombinationen(plan, shopVariationen) {
  const da = new Set((shopVariationen ?? []).map(v => wcSchluessel(paareAusWc(v.attributes))));
  return plan.varianten.filter(v => !da.has(wcSchluessel(paareAusWc(variationsAttribute(v)))));
}

// ── Sheets schreiben (nur --write, nach vollstaendiger Shop-Anlage) ─────────

/**
 * Maske- und Varianten-Zeilen eines Artikels anhaengen (RAW). Liest vorher neu:
 * Artikelnummer schon in der Maske -> keine zweite Zeile; SSOT-ID hat schon
 * Varianten-Zeilen -> keine neuen (Nachtrag: scripts/fill-wc-variation-ids.js).
 */
export async function schreibeArtikelSheets(sheets, spreadsheetId, plan, { produktId, marke, wcIds }) {
  const lies = async tab => (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'` })).data.values ?? [];
  const E = await lies('Erfassungsmaske');
  const eh = E[0] ?? [];
  const eId = requireHeaderAny(eh, ['SSOT-ID', 'ID'], 'Erfassungsmaske');
  const eArt = requireHeader(eh, 'Artikelnummer', 'Erfassungsmaske');
  let ssot, maskeNeu = false;
  const da = E.slice(1).find(r => t(r[eArt]) === plan.artikelnummer);
  if (da) ssot = t(da[eId]);
  else {
    ssot = naechsteSsotIds(E.slice(1).map(r => r[eId]), 1)[0];
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: "'Erfassungsmaske'!A1", valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [buildRow(eh, maskeBody(plan, { produktId, marke }), ssot)] },
    });
    maskeNeu = true;
  }

  const V = await lies('Varianten');
  const vh = V[0] ?? [];
  const vSsot = requireHeader(vh, 'SSOT-ID', 'Varianten');
  if (V.slice(1).some(r => t(r[vSsot]) === ssot)) return { ssot, maskeNeu, variantenNeu: 0, hinweis: `${ssot}: Varianten-Zeilen schon da – nicht neu geschrieben.` };
  const payload = variantenSheetPayload(plan, wcIds);
  pruefeVariantenPayload(ssot, payload);
  if (findHeader(vh, 'LShop_ArticleNr') < 0) throw new Error('Reiter Varianten: Spalte LShop_ArticleNr fehlt – nichts geschrieben.');
  const zeilen = baueVariantenZeilen(vh, ssot, payload, []);
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: "'Varianten'!A1", valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: zeilen },
  });
  return { ssot, maskeNeu, variantenNeu: zeilen.length, hinweis: null };
}

/** Eine fertige Zeile anhaengen (Motive, Struktur_Kategorien, SEO_Karte), RAW. */
export async function haengeZeileAn(sheets, spreadsheetId, tab, werte) {
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: `'${tab}'!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [werte] },
  });
}

/** Lieferzeit-Standard aus den Zeilen von Struktur_Lieferzeiten. */
export function standardLieferzeit(rows) {
  return parseLieferzeiten(rows).find(l => l.standard);
}
