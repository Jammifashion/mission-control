// PA8: FP-Sperre - kein stiller Festpreis 0 mehr. Reine Logik, Lesen/Schreiben in lib/fpSperre.js und routes/festpreis-portal.js.
//
// Der FP-Sync holt den Festpreis ueber die Artikelkategorie der FP_Artikel-Zeile aus FP_Artikel_Kategorie. Fehlt diese
// Zuordnung (Kategorie leer oder ohne Zeile fuer den Partner), schrieb er frueher still Festpreis 0 = der Partner bekam den
// ganzen VK-Netto. Jetzt (wie PA2 bei Lizenz-Partnern): Zeile mit Status "gesperrt", Spalte "Sperre" = Grund, LEERE Betraege
// (Festpreis, Handlingskosten, Gesamt-Partner-Netto/-Brutto). Die Eingaben (VK-Netto, Stueck, Porto, PayPal) bleiben stehen,
// daraus rechnet das Nachrechnen spaeter mit DERSELBEN Rechnung wie der Mehrkosten-Weg (berechneFestpreisAnteil).
// Ein bewusst gesetzter Festpreis 0 in FP_Artikel_Kategorie ist eine gueltige Zuordnung und bleibt abrechenbar.
// Abgerechnete Zeilen fasst nichts hiervon an. Nie Preise in Log, Chat, Meldungstexten.

import { berechneFestpreisAnteil } from './festpreis-kalkulation.js';

export const STATUS_GESPERRT = 'gesperrt';
export const STATUS_OFFEN = 'offen';
export const SPALTE_SPERRE = 'Sperre';
export const GRUND_KATEGORIE = 'Festpreis-Kategorie fehlt';
export const STATUS_SPALTE = 'Status Abrechnung';
/** Spalten, die eine gesperrte Zeile LEER laesst (das Nachrechnen fuellt sie). */
export const LEERE_BETRAEGE = ['Festpreis', 'Handlingskosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto'];
/** Positionsfeste Spalten des Syncs (A:W) - X = Sperre kommt additiv dahinter. */
export const SYNC_BREITE = 23;
export const SPERRE_INDEX = 23;

const t = v => String(v ?? '').trim();
const zahl = v => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
};

/** Festpreis-Zuordnungen `${partnerId}|${kategorie}` -> { festpreis, handlingskosten } (Festpreis 0 = bewusst, zaehlt). */
export function festpreisZuordnungen(kopf, zeilen) {
  const h = c => kopf.indexOf(c);
  const map = new Map();
  for (const r of zeilen ?? []) {
    const pid = t(r[h('Festpreispartner-ID')]), kat = t(r[h('Kategorie')]);
    if (pid && kat) map.set(`${pid}|${kat}`, { festpreis: zahl(r[h('Festpreis')]), handlingskosten: zahl(r[h('Handlingskosten')]) });
  }
  return map;
}

/** Gueltige Zuordnung fuer Partner + Artikelkategorie, sonst null (Kategorie leer oder ohne Zeile). */
export function zuordnungFuer(map, partnerId, kategorie) {
  const k = t(kategorie);
  if (!k) return null;
  return map.get(`${t(partnerId)}|${k}`) ?? null;
}

/** Sync-Zeile (A:W, positionsfest) sperren: Betraege leer, Status gesperrt, Grund an Index 23 (Spalte X). */
export function sperreZeile(zeile, kopf) {
  const z = [...zeile];
  while (z.length < SYNC_BREITE) z.push('');
  for (const s of LEERE_BETRAEGE) { const i = kopf.indexOf(s); if (i !== -1) z[i] = ''; }
  z[kopf.indexOf(STATUS_SPALTE)] = STATUS_GESPERRT;
  z[SPERRE_INDEX] = GRUND_KATEGORIE;
  return z;
}

const istStorno = (kopf, r) => t(r[kopf.indexOf('Storno-Status')]) !== '';
const rund = n => Math.round(n * 100) / 100;

/**
 * Nachrechnen-Plan: gesperrte Zeilen, deren Artikel JETZT eine gueltige Zuordnung hat.
 * Kategorie = aktuelle Artikelkategorie der FP_Artikel-Zeile (Partner + Produkt-ID). Storno-Gegenbuchung: Eingaben stehen
 * negiert -> mit Betraegen gerechnet, Ergebnis negiert (wie buildFpStornoRows).
 * @param {object} o
 * @param {string[]} o.kopf        Kopfzeile FP_Verkaeufe
 * @param {any[][]} o.zeilen       Zeilen (mit _sheetRow)
 * @param {(partnerId:string, produktId:string)=>string|null} o.kategorieFuer  aktuelle Artikelkategorie oder null (kein Eintrag)
 * @param {Map} o.zuordnungen      aus festpreisZuordnungen
 * @param {number} o.mwstProzent
 * @returns {{ plan: {sheetRow, zeile, werte: Object<string, any>}[], nochGesperrt: number, gesperrt: number }}
 */
export function nachrechnenPlan({ kopf, zeilen, kategorieFuer, zuordnungen, mwstProzent }) {
  const h = c => kopf.indexOf(c);
  const gesperrt = (zeilen ?? []).filter(r => t(r[h(STATUS_SPALTE)]) === STATUS_GESPERRT);
  const plan = [];
  for (const r of gesperrt) {
    const pid = t(r[h('Partner-ID')]), produkt = t(r[h('Produkt-ID')]);
    const kat = kategorieFuer(pid, produkt);
    const z = zuordnungFuer(zuordnungen, pid, kat);
    if (!z) continue;
    const vz = istStorno(kopf, r) ? -1 : 1;
    const abs = c => Math.abs(zahl(r[h(c)]));
    const { netto, brutto } = berechneFestpreisAnteil({
      vkNetto: abs('VK-Netto'), festpreisEK: z.festpreis, handlingskosten: z.handlingskosten,
      stueckzahl: abs('Stückzahl') || 1, mehrkosten: abs('Mehrkosten'),
      portoEinnahmeAnteil: abs('Porto-Einnahme'), portoKostenAnteil: abs('Porto-Kosten'),
      versandnkAnteil: abs('Versandnebenkosten'), paypalKosten: abs('PayPal-Kosten'), mwstProzent,
    });
    const neg = x => (vz < 0 ? (x === 0 ? 0 : rund(-x)) : x);
    plan.push({
      sheetRow: r._sheetRow, zeile: r,
      werte: {
        Artikelkategorie: t(kat), Festpreis: neg(z.festpreis), Handlingskosten: neg(z.handlingskosten),
        'Gesamt-Partner-Netto': neg(netto), 'Gesamt-Partner-Brutto': neg(brutto),
        [STATUS_SPALTE]: STATUS_OFFEN, [SPALTE_SPERRE]: '',
      },
    });
  }
  return { plan, gesperrt: gesperrt.length, nochGesperrt: gesperrt.length - plan.length };
}

/** Schluessel einer Verkaufszeile (zum Wiederfinden vor dem Schreiben). */
export function zeilenSchluessel(kopf, r) {
  const h = c => kopf.indexOf(c);
  const v = r[h('Variante')];
  return [h('WC-Bestellnummer'), h('Artikelname')].map(i => t(r[i])).concat(t(v) === '' ? '0' : t(v), t(r[h('Partner-ID')]), t(r[h('Produkt-ID')]), t(r[h('Storno-Status')])).join('|');
}

/**
 * Gesperrte Zeilen zaehlen (fuer MC, Chat): je Partner Anzahl + Produkt-IDs. Nur offene Sperren, keine Betraege.
 * @returns {{ anzahl: number, jePartner: {partnerId, anzahl, produktIds: string[]}[] }}
 */
export function gesperrtZaehlen(kopf, zeilen, { partnerId } = {}) {
  const h = c => kopf.indexOf(c);
  const je = new Map();
  for (const r of zeilen ?? []) {
    if (t(r[h(STATUS_SPALTE)]) !== STATUS_GESPERRT) continue;
    const pid = t(r[h('Partner-ID')]);
    if (partnerId && pid !== partnerId) continue;
    if (!je.has(pid)) je.set(pid, { partnerId: pid, anzahl: 0, produktIds: [] });
    const e = je.get(pid);
    e.anzahl++;
    const p = t(r[h('Produkt-ID')]);
    if (p && !e.produktIds.includes(p)) e.produktIds.push(p);
  }
  const jePartner = [...je.values()];
  return { anzahl: jePartner.reduce((s, e) => s + e.anzahl, 0), jePartner };
}

/**
 * Hinweise fuer Vorschau und Erstellen einer FP-Abrechnung (wie PA2 `abrechnungHinweise`): gesperrte Zeilen im Zeitraum
 * (nicht abgerechnet) und offene Nachzuegler VOR dem Zeitraumbeginn (z. B. spaeter nachgerechnete Verkaeufe).
 */
export function fpAbrechnungHinweise({ kopf, zeilen, partnerId, von, bis, parseDate }) {
  const h = c => kopf.indexOf(c);
  const eigene = (zeilen ?? []).filter(r => t(r[h('Partner-ID')]) === partnerId);
  const datum = r => parseDate(r[h('Datum')] ?? '');
  const im = r => { const d = datum(r); return d && (!von || d >= von) && (!bis || d <= bis); };
  const gesperrt = eigene.filter(r => t(r[h(STATUS_SPALTE)]) === STATUS_GESPERRT && im(r));
  const nach = von ? eigene.filter(r => t(r[h(STATUS_SPALTE)]).toLowerCase() === STATUS_OFFEN).filter(r => { const d = datum(r); return d && d < von; }) : [];
  const fruehest = nach.map(r => r[h('Datum')]).sort((a, b) => parseDate(a) - parseDate(b))[0] ?? null;
  const hinweise = [];
  if (gesperrt.length) hinweise.push(`${gesperrt.length} Zeile(n) im Zeitraum gesperrt – ${GRUND_KATEGORIE}, nicht abgerechnet.`);
  if (nach.length) hinweise.push(`${nach.length} offene Zeile(n) vor dem Zeitraumbeginn (früheste ${fruehest}) – nicht in dieser Abrechnung, Zeitraum früher beginnen lassen.`);
  return {
    gesperrtImZeitraum: gesperrt.length, gesperrtProduktIds: [...new Set(gesperrt.map(r => t(r[h('Produkt-ID')])))],
    nachzuegler: nach.length, fruehesterNachzuegler: fruehest, hinweise,
  };
}
