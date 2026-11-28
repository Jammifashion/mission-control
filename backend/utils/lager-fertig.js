// Fertigware im Lager (LG1) - reine Logik, ohne Zugriffe. Ein-/Ausgabe in lib/lagerFertig.js.
//
// Inhaber 28.11.: Fertigware = unser Shop-Artikel im JFN-Shop. Schluessel WC:<WC_Variation_ID>, bei einfachen Artikeln
// (ohne Variationen) WC:<Produkt-ID> - Produkt- und Variations-IDs sind WooCommerce-Beitrags-IDs aus derselben Zaehlung.
// Nur JFN, nie Trikots (eigener Schluessel TR:).
//
// "aus Lager nehmen" in der Bestellkarte (Teil C): EIN Schritt - Abgang im Journal (Art abgang_shop, Quelle fertig, Bezug
// JFN:<Nr>:<Position>) UND die offene Zeile der Position im L-Shop-Korb und im DTF-Korb:
//   - Lager deckt die ganze Menge -> Zeile abgewaehlt, Grund GRUND_FERTIG (Menge bleibt).
//   - Teilmenge (Inhaber 28.11., Variante a) -> Zeile bleibt offen, Menge = Rest, Spalte Aus_Lager = genommen. So bestellen
//     EDI/Matrix/Zaehlliste/DTF-Absenden nur den Rest; die Abgleiche vergleichen die Shop-Menge mit Menge + Aus_Lager.
// Zeilen, die nicht offen sind (schon bestellt, Lager, abgewaehlt), bleiben unveraendert (Hinweis).
// Rueckweg "zurück" = Gegenbuchung + Zeilen zurueck (offen bzw. Menge + Aus_Lager). Der Grund ist NICHT von Hand waehlbar
// und eine Zeile mit diesem Grund laesst sich im Korb nicht von Hand zurueckholen (sonst stimmt der Lager-Bestand nicht).

import { ART, QUELLE, WARENART, BESTELL_POSITION, bestandAus, bestandVon, naechsteBuchungNr, buchungId, VORGANG_MUSTER, buchungenDesVorgangs } from './lager.js';
import { berlinJahr, berlinDatum } from './berlin-tag.js';
import { GRUND_FERTIG } from './korb-logic.js';

const t = v => String(v ?? '').trim();
const fehler = (msg, status, extra = {}) => Object.assign(new Error(msg), { status, ...extra });

/** Neuer Grund in beiden Koerben (nicht umbenennen, sobald geschrieben); eine Stelle: utils/korb-logic.js. */
export { GRUND_FERTIG };
/** Optionale Spalte hinten in Warenkorb_LShop und Warenkorb_DTF. */
export const SPALTE_AUS_LAGER = 'Aus_Lager';
export const SUCHE_MAX = 25;

/** Lager-Schluessel einer Shop-Position: WC:<Variation>, ohne Variation WC:<Produkt>; sonst ''. */
export function fertigSchluessel(li) {
  const vid = t(li?.variation_id), pid = t(li?.product_id);
  if (/^\d{1,12}$/.test(vid) && vid !== '0') return `WC:${vid}`;
  if (/^\d{1,12}$/.test(pid) && pid !== '0') return `WC:${pid}`;
  return '';
}

/** Menge einer Korb-Zeile, die schon aus dem Lager kam (Spalte Aus_Lager, leer = 0). */
export const ausLagerVon = z => {
  const n = Number(t(z?.[SPALTE_AUS_LAGER]));
  return Number.isInteger(n) && n > 0 ? n : 0;
};
/** Shop-Menge, mit der die Abgleiche eine Zeile vergleichen: Menge + Aus_Lager. */
export const mengeGesamt = z => (Number(t(z?.Menge)) || 0) + ausLagerVon(z);
/** Steht die Zeile wegen "aus Lager nehmen" (Fertigware) so da? */
export const istFertigZeile = z => t(z?.Grund) === GRUND_FERTIG || ausLagerVon(z) > 0;

// ── Suche und Varianten (Shop-Daten) ─────────────────────────────────────────

const klein = v => t(v).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

/**
 * Suche in der Artikelliste des Shops: jedes Wort muss in Name, SKU oder Produkt-ID stehen (ae = ä). Trikots raus.
 * @param {object[]} liste  [{ id, name, sku, type, status }]
 * @param {string} q
 * @param {object} o  { ausschluss: Set<Produkt-ID>, zusatz: Map<Produkt-ID, string> (weitere Suchtexte, z. B. aus der Maske) }
 */
export function fertigSuche(liste, q, { ausschluss = new Set(), zusatz = new Map() } = {}) {
  const woerter = klein(q).split(/\s+/).filter(Boolean);
  if (!woerter.length || klein(q).length < 2) return { artikel: [], mehr: false };
  const treffer = (liste ?? []).filter(p => {
    const id = t(p.id);
    if (!id || ausschluss.has(id) || !['simple', 'variable'].includes(t(p.type)) || t(p.status) === 'trash') return false;
    const text = klein(`${t(p.name)} ${t(p.sku)} ${id} ${zusatz.get(id) ?? ''}`);
    return woerter.every(w => text.includes(w));
  });
  // genaue SKU / ID zuerst, sonst Name
  const qq = klein(q);
  const rang = p => (klein(p.sku) === qq || t(p.id) === qq ? 0 : 1);
  treffer.sort((a, b) => rang(a) - rang(b) || t(a.name).localeCompare(t(b.name), 'de'));
  return {
    artikel: treffer.slice(0, SUCHE_MAX).map(p => ({ id: t(p.id), name: t(p.name), artikelnummer: t(p.sku), typ: t(p.type), status: t(p.status) })),
    mehr: treffer.length > SUCHE_MAX,
  };
}

/** Attribute einer Variation -> { farbe (alles ausser Groesse), groesse }. */
export function teileAusAttributen(attributes, istGroesse) {
  const achsen = (attributes ?? []).map(a => ({ name: t(a?.name), wert: t(a?.option) })).filter(a => a.name && a.wert);
  const g = achsen.find(a => istGroesse(a.name));
  return { groesse: g?.wert ?? '', farbe: achsen.filter(a => a !== g).map(a => a.wert).join(' · ') };
}

/**
 * Auswahl im Dialog: einfacher Artikel = eine Zeile (WC:<Produkt-ID>), variabler = je Variation (WC:<Variation>).
 * @returns {{ id, name, typ, varianten: [{ schluessel, farbe, groesse, sku, aktiv }] }}
 */
export function variantenAusShop(produkt, variationen, istGroesse) {
  const id = t(produkt?.id);
  if (t(produkt?.type) === 'simple') {
    return { id, name: t(produkt.name), typ: 'simple', varianten: [{ schluessel: `WC:${id}`, farbe: '', groesse: '', sku: t(produkt.sku), aktiv: t(produkt.status) !== 'trash' }] };
  }
  return {
    id, name: t(produkt?.name), typ: t(produkt?.type),
    varianten: (variationen ?? []).filter(v => t(v?.id)).map(v => ({
      schluessel: `WC:${t(v.id)}`, ...teileAusAttributen(v.attributes, istGroesse), sku: t(v.sku), aktiv: t(v.status) === 'publish',
    })),
  };
}

/**
 * Was ein WC-Schluessel im Shop ist (GET products/<id>): Variation oder einfacher Artikel = gueltig; variabler Elternartikel,
 * Trikot oder unbekannt = nicht.
 * @returns {{ gueltig, grund?, name, farbe, groesse, produktId }}
 */
export function fertigInfoAus(p, { istGroesse, trikotIds = new Set() } = {}) {
  if (!p || !t(p.id)) return { gueltig: false, grund: 'im Shop nicht gefunden', name: '', farbe: '', groesse: '', produktId: '' };
  const typ = t(p.type);
  const produktId = typ === 'variation' ? t(p.parent_id) : t(p.id);
  const teile = typ === 'variation' ? teileAusAttributen(p.attributes, istGroesse) : { farbe: '', groesse: '' };
  const basis = { name: t(p.name), ...teile, produktId };
  if (trikotIds.has(produktId)) return { ...basis, gueltig: false, grund: 'Trikot – bitte als Trikot buchen' };
  if (typ === 'variable') return { ...basis, gueltig: false, grund: 'bitte Farbe/Größe wählen' };
  if (!['variation', 'simple'].includes(typ)) return { ...basis, gueltig: false, grund: `Artikeltyp „${typ}“ geht nicht` };
  return { ...basis, gueltig: true };
}

// ── Bestellkarte: aus Lager nehmen / zurueck ─────────────────────────────────

/** Offene (nicht gegengebuchte) Fertigware-Abgaenge je Position: Map bezug -> [{ id, ort, menge (positiv), schluessel }]. */
export function fertigAbgaengeJePosition(buchungen) {
  const gegen = new Set((buchungen ?? []).filter(b => b.stornoVon).map(b => b.stornoVon));
  const m = new Map();
  for (const b of buchungen ?? []) {
    if (b.quelle !== QUELLE.FERTIG || b.art !== ART.ABGANG_SHOP || gegen.has(b.id) || !BESTELL_POSITION.test(b.bezug)) continue;
    const l = m.get(b.bezug) ?? [];
    l.push({ id: b.id, ort: b.ort, menge: -b.menge, schluessel: b.schluessel });
    m.set(b.bezug, l);
  }
  return m;
}

function vorgangPruefen(buchungen, vorgang) {
  const v = t(vorgang);
  if (!VORGANG_MUSTER.test(v)) throw fehler('Interne Kennung fehlt - Seite neu laden.', 422, { code: 'vorgang' });
  return { v, schon: buchungenDesVorgangs(buchungen, v) };
}

/**
 * Aenderung einer offenen Korb-Zeile (L-Shop oder DTF) fuer m Stueck aus dem Lager.
 * @returns {{ werte }|{ hinweis }}
 */
function zeileNehmen(z, m, { hatSpalte, iso, datum, was }) {
  if (t(z.Status) !== 'offen') return { hinweis: `${was}: „${t(z.Status)}“ – bleibt so` };
  if (ausLagerVon(z)) throw fehler(`${was} ${t(z.Schluessel)}: schon ${ausLagerVon(z)} aus dem Lager vermerkt – nichts geändert.`, 409, { code: 'konflikt' });
  const menge = Number(t(z.Menge));
  if (!Number.isInteger(menge) || menge < 1) throw fehler(`${was} ${t(z.Schluessel)}: Menge „${t(z.Menge)}“ ist ungültig.`, 422);
  if (m >= menge) return { werte: { Status: 'abgewählt', Grund: GRUND_FERTIG, Status_Datum: datum, Stand: iso } };
  if (!hatSpalte) throw fehler(`${was}: Spalte ${SPALTE_AUS_LAGER} fehlt – Teilmenge geht erst nach scripts/setup-lg1-aus-lager.js --write.`, 409, { code: 'einrichtung' });
  return { werte: { Menge: String(menge - m), [SPALTE_AUS_LAGER]: String(m), Status_Datum: datum, Stand: iso } };
}

/** Rueckweg einer Korb-Zeile; nur was dieser Weg gesetzt hat. */
function zeileZurueck(z, { iso, datum, was }) {
  if (t(z.Status) === 'abgewählt' && t(z.Grund) === GRUND_FERTIG) return { werte: { Status: 'offen', Grund: '', Status_Datum: datum, Stand: iso } };
  const aus = ausLagerVon(z);
  if (aus && t(z.Status) === 'offen') return { werte: { Menge: String((Number(t(z.Menge)) || 0) + aus), [SPALTE_AUS_LAGER]: '', Status_Datum: datum, Stand: iso } };
  if (aus) return { hinweis: `${was}: Rest schon „${t(z.Status)}“ – fehlende ${aus} Stück bitte von Hand nachbestellen` };
  return null;
}

/**
 * "aus Lager nehmen" (Fertigware) einer Shop-Position.
 * @param {object} e  { nummer, position, schluessel, verteilung: [{ ort, menge }], korb: { schluessel, status }|null, dtf: [{ schluessel, stand }], vorgang }
 * @param {object} k  { li (frisch aus dem Shop), trikot (bool), korbZeilen, korbHatAusLager, dtfZeilen (der Position), dtfHatAusLager,
 *                      buchungen, orte (aktiv), jetzt }
 * @returns {{ schonGebucht?, lagerZeilen, korb: [{ zeile, schluessel, werte }], dtf: [...], hinweise: string[] }}
 */
export function fertigAusLagerPlan(e, { li, trikot = false, korbZeilen = [], korbHatAusLager = false, dtfZeilen = [], dtfHatAusLager = false, buchungen, orte, jetzt = new Date() }) {
  const { v, schon } = vorgangPruefen(buchungen, e?.vorgang);
  if (schon.length) return { schonGebucht: schon };
  const nummer = t(e?.nummer), position = t(e?.position);
  if (!li || t(li.id) !== position) throw fehler(`Position ${position} gibt es in Bestellung ${nummer} nicht (mehr).`, 409, { code: 'konflikt' });
  if (trikot) throw fehler('Trikots gehen über die Trikot-Seite, nicht als Fertigware.', 422);
  const schluessel = fertigSchluessel(li);
  if (!schluessel || schluessel !== t(e?.schluessel)) throw fehler('Die Position passt nicht mehr zum Lager-Artikel – Karte neu laden.', 409, { code: 'konflikt' });
  const bezug = `JFN:${nummer}:${position}`;
  if (fertigAbgaengeJePosition(buchungen).get(bezug)?.length) {
    throw fehler('Für diese Position ist schon Fertigware aus dem Lager genommen – erst „zurück“, dann neu.', 409, { code: 'konflikt' });
  }
  // was schon von Hand (BO5-9) fuer die Position ausgebucht ist, zaehlt mit
  const gegen = new Set((buchungen ?? []).filter(b => b.stornoVon).map(b => b.stornoVon));
  const schonHand = (buchungen ?? []).filter(b => b.art === ART.ABGANG_SHOP && b.bezug === bezug && b.quelle !== QUELLE.KORB && !gegen.has(b.id))
    .reduce((a, b) => a - b.menge, 0);
  const bedarf = (Number(li.quantity) || 0) - schonHand;

  const verteilung = (Array.isArray(e?.verteilung) ? e.verteilung : []).map(x => ({ ort: t(x?.ort), menge: Number(x?.menge) })).filter(x => x.ort || x.menge);
  const probleme = [];
  if (!verteilung.length || verteilung.length > 2) probleme.push({ code: 'verteilung', text: 'Bitte einen Ort wählen (höchstens zwei).' });
  const orteSet = new Set(orte ?? []);
  const bestand = bestandAus(buchungen);
  const gesehen = new Set();
  for (const x of verteilung) {
    if (!orteSet.has(x.ort)) probleme.push({ code: 'ort', text: x.ort ? `Ort "${x.ort}" gibt es nicht (mehr).` : 'Bitte einen Ort wählen.' });
    else if (gesehen.has(x.ort)) probleme.push({ code: 'ort', text: `Ort "${x.ort}" doppelt.` });
    gesehen.add(x.ort);
    if (!Number.isInteger(x.menge) || x.menge < 1) { probleme.push({ code: 'menge', text: `Menge bei "${x.ort}" ungültig.` }); continue; }
    const da = bestandVon(bestand, schluessel, x.ort);
    if (x.menge > da) probleme.push({ code: 'bestand', text: `Am Ort "${x.ort}" ${da ? `nur ${da}` : 'nichts'} da, ${x.menge} gewünscht.`, da });
  }
  const m = verteilung.reduce((a, x) => a + (Number.isInteger(x.menge) ? x.menge : 0), 0);
  if (!probleme.length && bedarf < 1) probleme.push({ code: 'menge', text: 'Für diese Position ist schon alles aus dem Lager genommen.' });
  else if (!probleme.length && m > bedarf) probleme.push({ code: 'summe', text: `Die Position braucht noch ${bedarf}, gewählt sind ${m}.` });
  if (probleme.length) throw fehler(probleme[0].text, 422, { probleme, code: 'nicht_gebucht' });

  const iso = jetzt.toISOString(), datum = berlinDatum(jetzt);
  const hinweise = [];
  // L-Shop-Korb: Zeile JFN:<Nr>:<Position>, Status wie gesehen
  const korbSchl = `JFN:${nummer}:${position}`;
  const kz = korbZeilen.filter(z => t(z.Schluessel) === korbSchl);
  if (kz.length > 1) throw fehler(`Position ${korbSchl} steht mehrfach im L-Shop-Korb - nichts geändert.`, 409, { code: 'konflikt' });
  const gesehenKorb = e?.korb ? t(e.korb.status) : '';
  if ((kz[0] ? t(kz[0].Status) : '') !== gesehenKorb) throw fehler('Der L-Shop-Korb hat sich geändert – Karte neu laden.', 409, { code: 'konflikt' });
  const korb = [];
  if (kz[0]) {
    if (t(kz[0].Status) === 'offen' && /storniert|erstattet|nicht mehr im Shop|Position weg/.test(t(kz[0].Hinweis))) {
      throw fehler(`L-Shop-Korb: ${t(kz[0].Hinweis)} – nicht aus dem Lager nehmen.`, 422);
    }
    const r = zeileNehmen(kz[0], m, { hatSpalte: korbHatAusLager, iso, datum: iso, was: 'L-Shop-Korb' });
    if (r.werte) korb.push({ zeile: kz[0]._zeile, schluessel: korbSchl, werte: r.werte });
    else hinweise.push(r.hinweis);
  }
  // DTF-Korb: alle Druckpositionen der Position, Stand wie gesehen (wie dtfKartenPlan)
  const sicht = new Map((e?.dtf ?? []).map(g => [t(g.schluessel), t(g.stand)]));
  if (dtfZeilen.some(z => !sicht.has(t(z.Schluessel)) || sicht.get(t(z.Schluessel)) !== t(z.Stand)) || sicht.size !== dtfZeilen.length) {
    throw fehler('Der DTF-Korb hat sich geändert – Karte neu laden.', 409, { code: 'konflikt' });
  }
  const dtf = [];
  for (const z of dtfZeilen) {
    const r = zeileNehmen(z, m, { hatSpalte: dtfHatAusLager, iso, datum, was: 'DTF-Korb' });
    if (r.werte) dtf.push({ zeile: z._zeile, schluessel: t(z.Schluessel), werte: r.werte });
    else if (!hinweise.includes(r.hinweis)) hinweise.push(r.hinweis);
  }

  const jahr = berlinJahr(jetzt);
  const n0 = naechsteBuchungNr(buchungen, jahr);
  return {
    korb, dtf, hinweise, menge: m,
    lagerZeilen: verteilung.map((x, i) => ({
      Buchung_ID: buchungId(jahr, n0 + i), Datum: iso, Art: ART.ABGANG_SHOP, Warenart: WARENART.FERTIG, Schluessel: schluessel, Menge: -x.menge,
      Ort: x.ort, Grund: GRUND_FERTIG, Bezug: bezug, Quelle: QUELLE.FERTIG, Notiz: '', Storno_von: '', Stand: iso, Vorgang: v,
    })),
  };
}

/**
 * "zurück": Gegenbuchung jeder offenen Fertigware-Buchung der Position + Korb-Zeilen zurueck.
 * @param {object} e  { nummer, position, vorgang }
 */
export function fertigZurueckPlan(e, { korbZeilen = [], dtfZeilen = [], buchungen, jetzt = new Date() }) {
  const { v, schon } = vorgangPruefen(buchungen, e?.vorgang);
  if (schon.length) return { schonGebucht: schon };
  const nummer = t(e?.nummer), position = t(e?.position);
  const bezug = `JFN:${nummer}:${position}`;
  const ab = fertigAbgaengeJePosition(buchungen).get(bezug) ?? [];
  if (!ab.length) throw fehler('Zu dieser Position gibt es keine offene Fertigware-Buchung – nichts geändert.', 409, { code: 'konflikt' });
  const iso = jetzt.toISOString(), datum = berlinDatum(jetzt);
  const hinweise = [], korb = [], dtf = [];
  for (const z of korbZeilen.filter(x => t(x.Schluessel) === bezug)) {
    const r = zeileZurueck(z, { iso, datum: iso, was: 'L-Shop-Korb' });
    if (r?.werte) korb.push({ zeile: z._zeile, schluessel: t(z.Schluessel), werte: r.werte });
    else if (r?.hinweis) hinweise.push(r.hinweis);
  }
  for (const z of dtfZeilen) {
    const r = zeileZurueck(z, { iso, datum, was: 'DTF-Korb' });
    if (r?.werte) dtf.push({ zeile: z._zeile, schluessel: t(z.Schluessel), werte: r.werte });
    else if (r?.hinweis && !hinweise.includes(r.hinweis)) hinweise.push(r.hinweis);
  }
  const jahr = berlinJahr(jetzt);
  const n0 = naechsteBuchungNr(buchungen, jahr);
  return {
    korb, dtf, hinweise, menge: ab.reduce((a, x) => a + x.menge, 0),
    lagerZeilen: ab.map((a, i) => ({
      Buchung_ID: buchungId(jahr, n0 + i), Datum: iso, Art: ART.KORREKTUR, Warenart: WARENART.FERTIG, Schluessel: a.schluessel, Menge: a.menge,
      Ort: a.ort, Grund: 'zurück – Fertigware nicht aus Lager', Bezug: bezug, Quelle: QUELLE.FERTIG, Notiz: '', Storno_von: a.id, Stand: iso, Vorgang: v,
    })),
  };
}

/**
 * Bestellkarte: Hinweis "Fertig im Lager" je Position (nur JFN, ohne Trikots, nicht fertig/versendet).
 * @returns {object|null} { schluessel, n, orte, genommen, menge, bedarf, bezug, korb: { schluessel, status }|null, dtf: [{ schluessel, stand }] }
 */
export function fertigFuerKarte({ jfn, orderId, li, trikot, fertig, versendet, korbZeile, dtfZeilen = [], bestandJe = new Map(), fertigJe = new Map(), genommenJe = new Map() }) {
  if (!jfn || trikot || fertig || versendet) return null;
  const schluessel = fertigSchluessel(li);
  if (!schluessel) return null;
  const bezug = `JFN:${t(orderId)}:${t(li?.id)}`;
  const best = bestandJe.get(schluessel);
  const genommen = (fertigJe.get(bezug) ?? []).reduce((a, x) => a + x.menge, 0);   // ueber diesen Knopf (zuruecknehmbar)
  const genommenAlle = genommenJe.get(bezug) ?? 0;                                   // dazu von Hand ausgebucht (BO5-9)
  if (!(best?.summe > 0) && !genommen && !genommenAlle) return null;
  const menge = Number(li?.quantity) || 1;
  return {
    schluessel, n: best?.summe ?? 0, orte: best?.orte ?? [], genommen, genommenAlle, menge, bezug,
    bedarf: Math.max(0, menge - genommenAlle), erledigt: genommenAlle >= menge,
    korb: korbZeile ? { schluessel: t(korbZeile.Schluessel), status: t(korbZeile.Status) } : null,
    dtf: (dtfZeilen ?? []).map(z => ({ schluessel: t(z.schluessel ?? z.Schluessel), stand: t(z.stand ?? z.Stand) })),
  };
}

/** Setup: Kopfzelle "Aus_Lager" hinter der letzten belegten Kopfspalte (wie lagerZielSpaltePlan). */
export function ausLagerSpaltePlan(werte) {
  const kopf = (werte?.[0] ?? []).map(k => t(k));
  const i = kopf.findIndex(k => k.toLowerCase() === SPALTE_AUS_LAGER.toLowerCase());
  if (i >= 0) return { da: true, spalte: i, belegt: 0, kopfBreite: kopf.length };
  let spalte = kopf.length;
  while (spalte > 0 && !kopf[spalte - 1]) spalte--;
  const belegt = (werte ?? []).slice(1).filter(r => t(r?.[spalte])).length;
  return { da: false, spalte, belegt, kopfBreite: kopf.length };
}
