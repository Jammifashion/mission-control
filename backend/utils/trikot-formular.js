// Produzenten-Bestellung der Trikots (TR3) - reine Logik. Ein-/Ausgabe in lib/trikotFormular.js.
//
// Das Formular des Produzenten (Muster "6. Crocodiles Hamburg 26_27.xls", Blatt "Sheet1"): Kopf A1-A5
// Beschriftung, D1-D5 Werte (Bestelltag, +30 Tage, Team, "JJJJ/NN", Wiederholung), Tabelle ab Zeile 7
// mit einer Zeile je Trikot. ITEM/MATERIAL/COLLAR kommen aus Trikot_Artikel (Formular_*), nie aus dem
// Code; zugeordnet wird ueber den Produktnamen der Trikots-Zeile = Shop-Name der Produkt-ID.
//
// Charge (P) bleibt im Sheet eine Zahl (naechste = hoechste + 1), im Formular "JJJJ/NN" mit dem Jahr
// des Bestelltags (Europe/Berlin). Bestellt_Am (Q) ist im Sheet ein Datumswert (Seriennummer, Format
// dd.mm.yyyy) - geschrieben wird deshalb die Seriennummer, RAW.

import { requireHeader, findHeader } from './sheet-headers.js';
import { groessenRang } from '../lib/groessen.js';
import { berlinDatum } from './berlin-tag.js';

export const TAB_ARTIKEL = 'Trikot_Artikel';
export const ARTIKEL_FORMULAR_SPALTEN = ['Formular_Artikel', 'Formular_Material', 'Formular_Kragen'];
// Fest fuer dieses Formular (Inhaber 30.10.): Team, Saison im Dateinamen, "Repeat order", Lieferfrist.
export const FORMULAR = { team: 'Crocodiles Hamburg', saison: '26_27', wiederholung: 'NO', lieferTage: 30 };
// Wortlaut wie im Muster, inklusive der Leerzeichen am Ende.
export const KOPF_BESCHRIFTUNG = ['DATE OF ORDER:   ', 'DELIVERY DATE:  ', 'TEAM NAME:  ', 'YOUR ORDER NUMBER:  ', 'REPEAT ORDER:    YES / NO / PARTLY'];
export const TABELLE_KOPF = ['QUANTITY', 'ITEM - PRODUCT NAME', 'COLLAR ', 'MATERIAL ', 'SIZE', 'NAME', 'NUMBER ', 'EXTRA'];

const t = v => String(v ?? '').trim();
const fehler = (msg, status, extra = {}) => Object.assign(new Error(msg), { status, ...extra });

/** Trikot_Artikel (Werte mit Kopfzeile) + Shop-Namen je Produkt-ID -> Zuordnung Produktname -> Formularwerte. */
export function formularZuordnung(werte, shopNamen) {
  const [kopf = [], ...rows] = werte ?? [];
  const ctx = `Reiter ${TAB_ARTIKEL}`;
  const iId = requireHeader(kopf, 'Produkt-ID', ctx), iAktiv = requireHeader(kopf, 'Aktiv', ctx);
  const iF = ARTIKEL_FORMULAR_SPALTEN.map(n => findHeader(kopf, n));
  const fehlend = ARTIKEL_FORMULAR_SPALTEN.filter((_, i) => iF[i] < 0);
  const jeName = new Map();
  rows.forEach((r, reihenfolge) => {
    const produktId = t(r[iId]);
    if (!produktId || !['true', 'wahr', 'ja', 'x', '1'].includes(t(r[iAktiv]).toLowerCase())) return;
    const name = t(shopNamen?.get?.(produktId));
    const [artikel, material, kragen] = iF.map(i => (i >= 0 ? t(r[i]) : ''));
    if (!name || !artikel) return;   // ohne Shop-Namen oder Formular_Artikel keine Zuordnung
    if (jeName.has(name)) { jeName.set(name, { ...jeName.get(name), mehrdeutig: true }); return; }
    jeName.set(name, { produktId, artikel, material, kragen, reihenfolge });
  });
  for (const [n, z] of jeName) if (z.mehrdeutig) jeName.delete(n);
  return { jeName, fehlend };
}

/** Trikots-Zeilen (utils/trikot-ansicht.js trikotZeilen) -> Formularpositionen; ohne Zuordnung mit Fehler. */
export function formularPositionen(zeilen, zuordnung) {
  return zeilen.map(z => {
    const f = zuordnung.jeName.get(t(z.produkt));
    return {
      id: z.id, zeile: z.zeile, produkt: z.produktKurz ?? z.produkt, groesse: t(z.groesse), name: t(z.name), nummer: t(z.nummer),
      artikel: f?.artikel ?? '', material: f?.material ?? '', kragen: f?.kragen ?? '', reihenfolge: f?.reihenfolge ?? Infinity,
      fehler: f ? [] : ['ohne_zuordnung'],
    };
  });
}

/** Sortierschluessel Groesse: Kinder (reine Zahl, cm) aufsteigend vor Erwachsenen (S -> 4XL), Unbekanntes ans Ende. */
function groessenSchluessel(g) {
  if (/^\d+$/.test(g)) return [0, Number(g)];
  const r = groessenRang(g);
  return r?.klasse === 'buchstabe' ? [1, r.rang] : [2, 0, g];
}
const vergleich = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (typeof a[i] === 'number' && typeof b[i] === 'number') return a[i] - b[i];
    return String(a[i] ?? '').localeCompare(String(b[i] ?? ''), 'de', { numeric: true });
  }
  return 0;
};
/** Reihenfolge: Produkt (Reihenfolge in Trikot_Artikel: Heim vor Auswaerts), Groesse, Nummer. */
export function sortierePositionen(pos) {
  return [...pos].sort((a, b) => (a.reihenfolge - b.reihenfolge)
    || vergleich(groessenSchluessel(a.groesse), groessenSchluessel(b.groesse))
    || vergleich([Number(a.nummer) || 0, a.nummer], [Number(b.nummer) || 0, b.nummer])
    || a.zeile - b.zeile);
}

/** Je Produkt und Groesse die Anzahl, in Formular-Reihenfolge. */
export function zaehleJeGroesse(sortiert) {
  const m = new Map();
  for (const p of sortiert) { const k = `${p.produkt}\u0000${p.groesse}`; m.set(k, { produkt: p.produkt, groesse: p.groesse, anzahl: (m.get(k)?.anzahl ?? 0) + 1 }); }
  return [...m.values()];
}

/** Hoechste Charge (Zahl) im Reiter + 1. werte = UNFORMATTED/FORMATTED mit Kopfzeile. */
export function naechsteCharge(werte) {
  const [kopf = [], ...rows] = werte ?? [];
  const i = requireHeader(kopf, 'Charge', 'Reiter Trikots');
  const zahlen = rows.map(r => Number(t(r[i]))).filter(n => Number.isInteger(n) && n > 0);
  return (zahlen.length ? Math.max(...zahlen) : 0) + 1;
}

/** "JJJJ/NN" - Jahr des Bestelltags in Berlin. */
export const bestellNummer = (charge, jetzt) => `${berlinDatum(jetzt).slice(0, 4)}/${String(charge).padStart(2, '0')}`;
export const dateiName = charge => `${charge}. ${FORMULAR.team} ${FORMULAR.saison}.xlsx`;

/** Berliner Tag (JJJJ-MM-TT) + n Tage -> { ymd, text "TT.MM.JJJJ", serial (Tabellen-Datumswert) }. */
export function tagWerte(jetzt, plusTage = 0) {
  const [y, m, d] = berlinDatum(jetzt).split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d + plusTage);
  const dt = new Date(utc);
  const ymd = dt.toISOString().slice(0, 10);
  return { ymd, text: `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`, serial: Math.round((utc - Date.UTC(1899, 11, 30)) / 86400000), utc };
}

/**
 * Plan "Als bestellt eintragen": nur P (Charge) und Q (Bestellt_Am) der gewaehlten Zeilen, nur leere Zellen,
 * Zeilen-ID wie gesehen, Charge = hoechste + 1 im frisch gelesenen Reiter. werte = UNFORMATTED_VALUE.
 */
export function eintragPlan(werte, auswahl, { charge, serial }) {
  const [kopf = []] = werte ?? [];
  const ctx = 'Reiter Trikots';
  const iId = requireHeader(kopf, 'Zeilen-ID', ctx), iP = requireHeader(kopf, 'Charge', ctx), iQ = requireHeader(kopf, 'Bestellt_Am', ctx);
  const probleme = [];
  if (!Array.isArray(auswahl) || !auswahl.length) throw fehler('Keine Trikots gewählt.', 400);
  const frei = naechsteCharge(werte);
  if (Number(charge) !== frei) probleme.push({ grund: 'nummer_vergeben', text: `Bestellung ${charge} ist nicht mehr frei (nächste: ${frei}) – bitte neu öffnen.` });
  const gesehen = new Set();
  for (const a of auswahl) {
    const z = Number(a?.zeile);
    const r = werte[z - 1];
    if (!Number.isInteger(z) || z < 2 || !r) { probleme.push({ zeile: a?.zeile, grund: 'zeile_fehlt', text: `Zeile ${a?.zeile} gibt es nicht.` }); continue; }
    if (gesehen.has(z)) { probleme.push({ zeile: z, grund: 'doppelt', text: `Zeile ${z} doppelt gewählt.` }); continue; }
    gesehen.add(z);
    if (t(r[iId]) !== t(a.id)) probleme.push({ zeile: z, grund: 'zeile_geaendert', text: `Zeile ${z} hat sich geändert (andere Zeilen-ID).` });
    if (t(r[iP])) probleme.push({ zeile: z, grund: 'charge_belegt', text: `Zeile ${z} hat schon eine Bestellung (${t(r[iP])}).` });
    if (t(r[iQ])) probleme.push({ zeile: z, grund: 'bestellt_am_belegt', text: `Zeile ${z} hat schon ein Bestelldatum.` });
  }
  const spalte = i => String.fromCharCode(65 + i);
  const zellen = probleme.length ? [] : [...gesehen].sort((a, b) => a - b).flatMap(z => [
    { range: `'Trikots'!${spalte(iP)}${z}`, values: [[Number(charge)]] },
    { range: `'Trikots'!${spalte(iQ)}${z}`, values: [[serial]] },
  ]);
  return { probleme, zellen, frei, spalten: { P: spalte(iP), Q: spalte(iQ) } };
}
