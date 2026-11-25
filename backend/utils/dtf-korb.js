// DTF-Warenkorb (DT1) - reine Logik ohne Netz. Lesen/Schreiben in lib/dtfKorb.js, Drive in lib/dtfAblage.js.
//
// Ablauf (Inhaber 24./25.11., antwort-DT1-1): Der Abgleich legt je offener Shop-Position (nur JFN, ohne Trikots, Druckart DTF) bzw.
// je DTF-Auftragsposition und je Druckposition EINE Zeile im SSOT-Reiter `Warenkorb_DTF` an (Schluessel
// `Quelle:Nummer:Position:Druckposition`, Druckposition "-" = noch unbekannt). Zeilen werden nie geloescht; der Abgleich aendert nie
// den Status und schreibt nur `Hinweis`. Mass und Datei werden LIVE nachgeschlagen (Druckmasse bzw. Druckmasse_Hand, DTF_Dateien) -
// nach dem "Zuordnen" sind alle passenden Zeilen sofort gruen; beim Absenden werden sie in der Zeile festgeschrieben.
// Nie in XML, Chat oder Log: Kundennamen, Preise, Adressen, Drucknamen.

import { masseFuer, handTeile, istDtf, normBezug, normGroesse, istAktiv, GROESSE_ALLE, FUEHREND, fuehrendAus, positionAusListe } from './druckkosten.js';

export const TAB_DTF_KORB = 'Warenkorb_DTF';
export const KORB_SPALTEN = [
  'Schluessel', 'Quelle', 'Nummer', 'Position', 'Druckposition', 'Kuerzel', 'Modell', 'Textilfarbe', 'Groesse', 'Menge', 'Express',
  'Status', 'Grund', 'Notiz', 'DTF_Bestellung', 'Druck_ID', 'Breite_cm', 'Hoehe_cm', 'Fuehrend', 'Datei_ID', 'Datei_Pfad', 'Hinweis',
  'Angelegt', 'Status_Datum', 'Stand',
];
export const TAB_DTF_DATEIEN = 'DTF_Dateien';
export const DATEI_SPALTEN = ['Bezug', 'Position', 'Modell', 'Textilfarbe', 'Groesse', 'Datei_ID', 'Datei_Name', 'Notiz', 'Aktiv', 'Angelegt', 'Stand'];
export const TAB_DTF_PROTOKOLL = 'DTF_Bestellprotokoll';
export const PROTOKOLL_SPALTEN = [
  'Bestell_ID', 'Erstellt', 'Status', 'Lieferart', 'Express', 'Notiz', 'Positionen', 'Stueck', 'Laenge_cm', 'Datei_ID', 'Dateiname',
  'Abgelegt', 'Geliefert_Am', 'Posten', 'Hinweis', 'Stand', 'Ersetzt',
];

export const QUELLE = { JFN: 'JFN', AU: 'AU' };
export const STATUS = { OFFEN: 'offen', ABGEWAEHLT: 'abgewählt', BESTELLT: 'bestellt', GELIEFERT: 'geliefert' };
// BO5-9 Teil B (antwort-BO5-9-1): "DTF aus dem Lager" = abgewaehlt mit diesem Grund - nur eine Markierung, keine Lager-Buchung.
export const GRUND_LAGER = 'schon da (aus dem Lager)';
export const GRUENDE = ['schon gedruckt', GRUND_LAGER, 'anderer Drucker', 'Kunde hat storniert', 'wird nicht gedruckt', 'Sonstiges'];
export const BESTELL_STATUS = { WIRD: 'wird abgelegt', ABGELEGT: 'abgelegt', UNKLAR: 'unklar', ABGEBROCHEN: 'abgebrochen', GELIEFERT: 'geliefert' };
export const LIEFERARTEN = { abholung: 'Abholung', versand_dhl: 'Versand DHL' };
export const LIEFERART_XML = { abholung: 'abholung', versand_dhl: 'versand-dhl' };
export const NOTIZ_MAX = 300;
export const POSTEN_MAX = 200;
export const HAENGT_MIN = 10;
export const PLATZHALTER = '-';
export const SHOP_STATUS_OFFEN = ['processing', 'on-hold'];
// AU-Status: bis "in Produktion" kommen neue Zeilen; danach ist der Druck vorbei
export const AU_OFFEN = ['Anfrage', 'Angebot', 'Design', 'bestellt', 'in Produktion'];
export const CONFIG = {
  start: 'dtf.start_datum', mindest: 'dtf.mindest_laenge_cm', scanBasis: 'dtf.scan_basis_url',
};
export const BREITE_STANDARD_CM = 57;
export const VERSCHNITT_STANDARD = 15;
export const RUNDUNG_CM = 10;
export const BESTELL_ID_RE = /^DTF-\d{4}-\d{4}$/;
export const DRUCK_ID_RE = /^DTF-\d{4}-\d{4}-\d{2,3}$/;
export const DATEI_TYPEN = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf', 'image/tiff'];
export const DATEI_MAX_BYTE = 40 * 1024 * 1024;

const t = v => String(v ?? '').trim();
export const fehler = (text, status = 422, code) => Object.assign(new Error(text), { status, ...(code ? { code } : {}) });
const istPlatzhalter = p => !t(p) || t(p) === PLATZHALTER;

// ── Schluessel und Zeilen ────────────────────────────────────────────────────

export const dtfSchluessel = (quelle, nummer, position, druckposition) =>
  `${t(quelle)}:${t(nummer)}:${t(position)}:${istPlatzhalter(druckposition) ? PLATZHALTER : t(druckposition)}`;
/** Gruppe der Bestellposition (ohne Druckposition). */
export const positionsSchluessel = z => `${t(z.Quelle)}:${t(z.Nummer)}:${t(z.Position)}`;
export const quellSchluessel = (quelle, nummer) => `${t(quelle)}:${t(nummer)}`;
export const referenzFuer = z => (t(z.Quelle) === QUELLE.AU ? t(z.Nummer) : `${t(z.Quelle)}-${t(z.Nummer)}`);
export const istJa = v => /^(ja|true|1|x)$/i.test(t(v));

/** Reiter-Werte (Kopf + Zeilen) -> { idx, zeilen [{...Spalten, _zeile}] }; fehlende Pflichtspalten -> { fehlt }. */
export function reiterZeilen(werte, spalten, pflicht = spalten) {
  const kopf = (werte?.[0] ?? []).map(x => t(x));
  const idx = Object.fromEntries(spalten.map(s => [s, kopf.indexOf(s)]).filter(([, i]) => i >= 0));
  const fehlt = pflicht.filter(s => idx[s] === undefined);
  const zeilen = (werte ?? []).slice(1).map((r, i) => ({
    ...Object.fromEntries(spalten.map(s => [s, idx[s] === undefined ? '' : r?.[idx[s]] ?? ''])), _zeile: i + 2,
  }));
  return { idx, zeilen, fehlt, breite: kopf.length };
}

/** Objekt -> Sheet-Zeile in Spaltenreihenfolge des Kopfes. */
export function alsZeile(idx, breite, felder) {
  const r = Array.from({ length: Math.max(breite, ...Object.values(idx).map(i => i + 1)) }, () => '');
  for (const [f, w] of Object.entries(felder)) if (idx[f] !== undefined) r[idx[f]] = w ?? '';
  return r;
}

// ── Shop-Position: Kuerzel, Modell, Farbe, Groesse ───────────────────────────

const FARB_ACHSE = /^(textil)?farbe$/i;
const GROESSE_ACHSE = /^gr(ö|oe)(ß|ss)e$/i;
/** Werte einer Variante: Farbe (Achse "Farbe"), Groesse; sonst aus den Positions-Metadaten. */
export function farbeGroesse(variante, metaData) {
  let farbe = '', groesse = '';
  for (const n of [1, 2, 3]) {
    const e = t(variante?.[`e${n}`]), v = t(variante?.[`v${n}`]);
    if (!farbe && FARB_ACHSE.test(e)) farbe = v;
    if (!groesse && GROESSE_ACHSE.test(e)) groesse = v;
  }
  for (const m of metaData ?? []) {
    const k = t(m?.key).replace(/^pa_/, '');
    const w = t(m?.display_value ?? m?.value);
    if (!farbe && /^(textil)?farbe$/i.test(k)) farbe = w;
    if (!groesse && /^gr(o|oe|ö)(e|ss|ß)?e?$/i.test(k)) groesse = w;
  }
  return { farbe, groesse };
}
/** Modell = Teil der Artikelnummer vor "/" (L-Shop-Modell), sonst ''. */
export const modellAusArtikelnummer = nr => (t(nr).includes('/') ? t(nr).split('/')[0].trim() : '');

/**
 * Einstufung einer Shop-Position.
 * @param li WC line_item
 * @param ctx { trikotIds:Set, maskeJeProdukt: Map pid -> { kurz, artikelnummer, ssotId }, motivDruckart: Map kurz(norm) -> Druckart,
 *   variante: Varianten-Zeile oder null }
 * @returns {{ dtf: boolean, grund?: string, kuerzel, modell, farbe, groesse }}
 */
export function shopEinstufung(li, ctx) {
  if (ctx.trikotIds?.has(t(li?.product_id))) return { dtf: false, grund: 'trikot' };
  const m = ctx.maskeJeProdukt?.get(t(li?.product_id)) ?? null;
  const kuerzel = t(m?.kurz);
  const { farbe, groesse } = farbeGroesse(ctx.variante, li?.meta_data);
  const modell = modellAusArtikelnummer(m?.artikelnummer);
  if (kuerzel) {
    const druckart = ctx.motivDruckart?.get(normBezug(kuerzel)) ?? '';
    if (!istDtf(druckart)) return { dtf: false, grund: 'druckart', kuerzel, modell, farbe, groesse };
  }
  return { dtf: true, kuerzel, modell, farbe, groesse };
}

/** Druckpositionen einer Bestellposition: Hand-Masse (Auftrag) vor Druckmasse-Tabelle (Bezug + Groesse + Modell). */
export function druckpositionenFuer({ hand, bezug, groesse, modell }, masse) {
  const h = handTeile(hand).filter(x => !x.zuordnen);
  if (h.length) return h.map(x => x.position);
  return masseFuer(masse, bezug, groesse, modell).map(x => x.position);
}

// ── Abgleich ─────────────────────────────────────────────────────────────────

const ZUSTAND_TEXT = {
  storniert: 'Bestellung storniert', erstattet: 'Bestellung erstattet', abgeschlossen: 'Bestellung abgeschlossen',
  weg: 'nicht mehr im Shop', au_storniert: 'Auftrag storniert', au_fertig: 'Auftrag schon fertig', au_weg: 'Auftrag fehlt',
};
// Hinweise, die das Bestellen sperren (alles ausser "Namensdruck separat" und "Menge jetzt …")
export const SPERR_HINWEISE = [...Object.values(ZUSTAND_TEXT), 'Position weg', 'Position entfernt', 'kein DTF mehr'];
export const NAMENSDRUCK = 'Namensdruck separat';
export const hinweisSperrt = h => t(h).split(' · ').some(x => SPERR_HINWEISE.includes(t(x)));

/** WooCommerce-Status -> Zustand. */
export function shopZustand(order) {
  if (!order) return 'weg';
  const s = t(order.status);
  if (s === 'cancelled' || s === 'failed' || s === 'trash') return 'storniert';
  if (s === 'refunded') return 'erstattet';
  if (s === 'completed') return 'abgeschlossen';
  return 'offen';
}
/** AP1: Position kam nach "bestellt" dazu und ist noch nicht fertig - geht auch bei fertigem Auftrag in den DTF-Korb. */
export const nachtragOffen = p => !!t(p?.Nachtrag_Am) && t(p?.Fertig) !== 'ja';
/** AU-Status -> Zustand. */
export function auZustand(a) {
  if (!a) return 'au_weg';
  if (t(a.Status) === 'storniert') return 'au_storniert';
  return AU_OFFEN.includes(t(a.Status)) ? 'offen' : 'au_fertig';
}

/** Hinweis einer Zeile aus dem Stand ihrer Quelle; undefined = Quelle nicht gelesen (nichts aendern). */
export function hinweisFuer(z, quellen) {
  const st = quellen.get(quellSchluessel(z.Quelle, z.Nummer));
  if (!st) return undefined;
  const p = st.positionen.get(t(z.Position));
  // AP1: Nachtrags-Position (noch nicht fertig) in einem schon fertigen Auftrag gilt fuer sich als offen
  if (st.zustand !== 'offen' && !(st.zustand === 'au_fertig' && p?.nachtragOffen)) return ZUSTAND_TEXT[st.zustand] ?? st.zustand;
  if (!p) return t(z.Quelle) === QUELLE.AU ? 'Position entfernt' : 'Position weg';
  const teile = [];
  if (!p.dtf) teile.push('kein DTF mehr');
  if (Number(p.menge) !== Number(z.Menge) && t(z.Menge) !== '') teile.push(`Menge jetzt ${p.menge}`);
  if (p.druckname) teile.push(NAMENSDRUCK);
  return teile.join(' · ');
}

/**
 * Abgleich-Plan (schreibt nichts).
 * @param {object} a
 * @param {object[]} a.vorhanden  Zeilen aus reiterZeilen (Warenkorb_DTF)
 * @param {object[]} a.kandidaten [{ quelle, nummer, position, datum JJJJ-MM-TT, kuerzel, modell, farbe, groesse, menge, express, druckname,
 *   druckpositionen: string[] }] - nur DTF-Positionen offener Quellen
 * @param {Map} a.quellen       quellSchluessel -> { zustand, positionen: Map position -> { menge, dtf, druckname } }
 * @param {string} a.start      JJJJ-MM-TT (leer = alles)
 * @param {Set} [a.zwang]       quellSchluessel, die trotz Startdatum aufgenommen werden ("trotzdem aufnehmen")
 * @returns {{ neu: object[], hinweise: [{ zeile, schluessel, alt, neu }], aelter: [{ quelle, nummer, datum, positionen }] }}
 */
export function dtfAbgleichPlan({ vorhanden = [], kandidaten = [], quellen = new Map(), start = '', zwang = new Set(), alsLager = new Set() } = {}) {
  const schon = new Set(vorhanden.map(z => t(z.Schluessel)));
  // BO5-9: Zeilen, die nur aus "DTF aus dem Lager" in der Bestellkarte stammen, machen eine aeltere Bestellung NICHT bekannt -
  // sonst holte der naechste Abgleich alle anderen Positionen dieser Bestellung als offen in den Korb.
  const bekannt = new Set(vorhanden.filter(z => !istLagerZeile(z)).map(z => quellSchluessel(z.Quelle, z.Nummer)));
  const neu = [], aelterJe = new Map();
  for (const k of kandidaten) {
    const qs = quellSchluessel(k.quelle, k.nummer);
    if (start && t(k.datum) && t(k.datum) < start && !bekannt.has(qs) && !zwang.has(qs)) {
      const a = aelterJe.get(qs) ?? { quelle: k.quelle, nummer: t(k.nummer), datum: t(k.datum), positionen: 0 };
      a.positionen += 1;
      aelterJe.set(qs, a);
      continue;
    }
    const dps = (k.druckpositionen ?? []).filter(x => !istPlatzhalter(x));
    for (const dp of dps.length ? dps : [PLATZHALTER]) {
      const s = dtfSchluessel(k.quelle, k.nummer, k.position, dp);
      if (schon.has(s)) continue;
      // Platzhalter nur, wenn es fuer die Bestellposition noch gar keine Zeile gibt
      if (dp === PLATZHALTER && vorhanden.some(z => positionsSchluessel(z) === `${k.quelle}:${t(k.nummer)}:${t(k.position)}`)) continue;
      schon.add(s);
      neu.push({
        Schluessel: s, Quelle: k.quelle, Nummer: t(k.nummer), Position: t(k.position), Druckposition: dp,
        Kuerzel: t(k.kuerzel), Modell: t(k.modell), Textilfarbe: t(k.farbe), Groesse: t(k.groesse), Menge: Number(k.menge) || 0,
        Express: k.express ? 'ja' : '', Status: STATUS.OFFEN, Hinweis: k.druckname ? NAMENSDRUCK : '',
        // BO5-9: aus der Bestellkarte "DTF aus dem Lager" ohne Korb-Zeile - gleich abgewaehlt mit dem Grund anlegen
        ...(alsLager.has(`${k.quelle}:${t(k.nummer)}:${t(k.position)}`) ? { Status: STATUS.ABGEWAEHLT, Grund: GRUND_LAGER } : {}),
      });
    }
  }
  const hinweise = [];
  for (const z of vorhanden) {
    if (![STATUS.OFFEN, STATUS.ABGEWAEHLT, STATUS.BESTELLT].includes(t(z.Status))) continue;
    const h = hinweisFuer(z, quellen);
    if (h === undefined || h === t(z.Hinweis)) continue;
    hinweise.push({ zeile: z._zeile, schluessel: t(z.Schluessel), alt: t(z.Hinweis), neu: h });
  }
  return { neu, hinweise, aelter: [...aelterJe.values()].sort((a, b) => a.datum.localeCompare(b.datum)) };
}

// ── Datei-Zuordnung (DTF_Dateien) ────────────────────────────────────────────

const FELD_GEWICHT = [['Modell', 4, normBezug], ['Textilfarbe', 2, normBezug], ['Groesse', 1, normGroesse]];
const istAlle = v => !t(v) || normBezug(v) === GROESSE_ALLE;
/**
 * Datei fuer Bezug + Position + Modell/Farbe/Groesse: je Feld genau vor "alle"; ein abweichender Wert schliesst aus.
 * @returns {{ id, name, zeile }|null}
 */
export function dateiFuer(zeilen, { bezug, position, modell, farbe, groesse }) {
  const b = normBezug(bezug), p = normBezug(position);
  if (!b || !p) return null;
  const wert = { Modell: modell, Textilfarbe: farbe, Groesse: groesse };
  let best = null, bestRang = -1;
  for (const z of zeilen ?? []) {
    if (!istAktiv(z) || normBezug(z.Bezug) !== b || normBezug(z.Position) !== p || !t(z.Datei_ID)) continue;
    let rang = 0, passt = true;
    for (const [f, g, norm] of FELD_GEWICHT) {
      if (istAlle(z[f])) continue;
      if (norm(z[f]) !== norm(wert[f])) { passt = false; break; }
      rang += g;
    }
    if (passt && rang > bestRang) { best = z; bestRang = rang; }
  }
  return best ? { id: t(best.Datei_ID), name: t(best.Datei_Name), zeile: best._zeile } : null;
}
export const dateiSchluessel = z => [z.Bezug, z.Position, z.Modell, z.Textilfarbe].map(x => (istAlle(x) ? GROESSE_ALLE : normBezug(x))).join('|')
  + `|${istAlle(z.Groesse) ? GROESSE_ALLE : normGroesse(z.Groesse)}`;

/** Hoehe aus der Breite und dem Seitenverhaeltnis der Datei (Pixel), auf 0,1 cm; null bei unklarem Verhaeltnis. */
export function hoeheAusVerhaeltnis(breite, px, py) {
  const b = Number(breite), w = Number(px), h = Number(py);
  if (!(b > 0) || !(w > 0) || !(h > 0)) return null;
  return Math.round((b * h / w) * 10) / 10;
}
export function breiteAusVerhaeltnis(hoehe, px, py) {
  const hh = Number(hoehe), w = Number(px), h = Number(py);
  if (!(hh > 0) || !(w > 0) || !(h > 0)) return null;
  return Math.round((hh * w / h) * 10) / 10;
}

/** Pixelmasse aus PNG/JPEG-Bytes (Kopf), sonst null (PDF, SVG, unklar). */
export function pixelMasse(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { breite: buf.readUInt32BE(16), hoehe: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const laenge = buf.readUInt16BE(i + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { breite: buf.readUInt16BE(i + 7), hoehe: buf.readUInt16BE(i + 5) };
      }
      i += 2 + laenge;
    }
  }
  return null;
}

/** Dateiname fuer den Upload: Originalname, ohne Pfadteile/Steuerzeichen, hoechstens 120 Zeichen. */
export function sichererDateiname(name) {
  const n = t(name).split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '').trim();
  if (!n || n === '.' || n === '..') throw fehler('Dateiname fehlt.');
  if (n.length > 120) throw fehler('Dateiname: höchstens 120 Zeichen.');
  return n;
}

// ── Live-Ansicht einer Zeile ─────────────────────────────────────────────────

/** Mass der Zeile: { breite, hoehe, fuehrend, quelle } | null. Bestellte Zeilen: festgeschrieben. */
export function massFuerZeile(z, { masse = [], handJe = new Map() } = {}) {
  if (istPlatzhalter(z.Druckposition)) return null;
  if ([STATUS.BESTELLT, STATUS.GELIEFERT].includes(t(z.Status)) && (Number(z.Breite_cm) || Number(z.Hoehe_cm))) {
    return { breite: Number(z.Breite_cm) || null, hoehe: Number(z.Hoehe_cm) || null, fuehrend: fuehrendAus(z.Fuehrend), quelle: 'bestellt' };
  }
  const p = normBezug(z.Druckposition);
  if (t(z.Quelle) === QUELLE.AU) {
    const h = handTeile(handJe.get(t(z.Position)) ?? '').find(x => !x.zuordnen && normBezug(x.position) === p);
    if (h) return { breite: h.breite, hoehe: h.hoehe, fuehrend: h.fuehrend, quelle: 'hand' };
  }
  const m = masseFuer(masse, z.Kuerzel, z.Groesse, z.Modell).find(x => normBezug(x.position) === p);
  return m ? { breite: m.breite, hoehe: m.hoehe, fuehrend: m.fuehrend, quelle: 'tabelle', id: m.id } : null;
}

/**
 * Anzeige einer Korb-Zeile mit Ampeln (Mass, Datei) und `bereit` (darf in eine Bestellung).
 * @param ctx { masse, handJe, dateien (DTF_Dateien-Zeilen), dateiInfo: Map id -> { da, name, breitePx, hoehePx, pfad, quelle } }
 */
export function zeileAnsicht(z, ctx = {}) {
  const platzhalter = istPlatzhalter(z.Druckposition);
  const mass = massFuerZeile(z, ctx);
  const massAmpel = !mass ? 'fehlt' : mass.breite && mass.hoehe ? 'ok' : 'halb';
  const fest = [STATUS.BESTELLT, STATUS.GELIEFERT].includes(t(z.Status)) && t(z.Datei_ID);
  const datei = fest ? { id: t(z.Datei_ID), name: t(z.Datei_Pfad).split('/').pop(), pfad: t(z.Datei_Pfad) }
    : platzhalter ? null : dateiFuer(ctx.dateien, { bezug: z.Kuerzel, position: z.Druckposition, modell: z.Modell, farbe: z.Textilfarbe, groesse: z.Groesse });
  const info = datei ? ctx.dateiInfo?.get(datei.id) : null;
  const dateiAmpel = fest ? 'ok' : !datei ? 'fehlt' : info?.da === false ? 'weg' : info?.da === true ? 'ok' : 'unbekannt';
  const sperrt = hinweisSperrt(z.Hinweis);
  const grundNicht = t(z.Status) !== STATUS.OFFEN ? 'status' : platzhalter ? 'druckposition' : massAmpel !== 'ok' ? 'mass'
    : dateiAmpel !== 'ok' ? 'datei' : sperrt ? 'hinweis' : !t(z.Kuerzel) ? 'bezug' : '';
  return {
    schluessel: t(z.Schluessel), quelle: t(z.Quelle), nummer: t(z.Nummer), position: t(z.Position), referenz: referenzFuer(z),
    druckposition: platzhalter ? '' : t(z.Druckposition), kuerzel: t(z.Kuerzel), modell: t(z.Modell), farbe: t(z.Textilfarbe), groesse: t(z.Groesse),
    menge: Number(z.Menge) || 0, express: istJa(z.Express), status: t(z.Status), grund: t(z.Grund), notiz: t(z.Notiz), hinweis: t(z.Hinweis),
    bestellung: t(z.DTF_Bestellung), druckId: t(z.Druck_ID), angelegt: t(z.Angelegt), stand: t(z.Stand),
    mass: mass ? { breite: mass.breite, hoehe: mass.hoehe, fuehrend: mass.fuehrend === FUEHREND.HOEHE ? 'hoehe' : 'breite', quelle: mass.quelle } : null,
    massAmpel, datei: datei ? { id: datei.id, name: info?.name || datei.name, pfad: info?.pfad || datei.pfad || '' } : null, dateiAmpel,
    bereit: !grundNicht, grundNicht, platzhalter,
  };
}

/** Platzhalter, deren Bestellposition inzwischen echte Druckpositionen hat, sind erledigt (nur ausgeblendet). */
export function sichtbareZeilen(zeilen) {
  const mitEcht = new Set(zeilen.filter(z => !istPlatzhalter(z.Druckposition)).map(positionsSchluessel));
  return zeilen.filter(z => !(istPlatzhalter(z.Druckposition) && mitEcht.has(positionsSchluessel(z))));
}

// ── Meter-Schaetzung ─────────────────────────────────────────────────────────

/**
 * Laenge auf dem Bogen: Flaeche x Menge x (1 + Verschnitt) / Breite -> aufgerundet auf 10 cm; Kosten aus DK1-Preis (je m², brutto).
 * @param posten [{ breite, hoehe, menge }] cm
 * @param o { breiteCm, verschnitt (Prozent), tarif: { qmBruttoCent } | { fehlt }, mindestCm }
 * @returns {{ flaecheCm2, laengeCm, kostenBruttoCent, kostenNettoCent, mindestCm, lohnt, fehltCm, ohneMass }}
 */
export function meterSchaetzung(posten, { breiteCm = BREITE_STANDARD_CM, verschnitt = VERSCHNITT_STANDARD, tarif = null, mindestCm = null } = {}) {
  let flaeche = 0, ohneMass = 0;
  for (const p of posten ?? []) {
    const b = Number(p.breite), h = Number(p.hoehe), m = Number(p.menge) || 0;
    if (!(b > 0) || !(h > 0)) { ohneMass += 1; continue; }
    flaeche += b * h * m;
  }
  const v = Number.isFinite(Number(verschnitt)) ? Number(verschnitt) : VERSCHNITT_STANDARD;
  const roh = breiteCm > 0 ? (flaeche * (1 + v / 100)) / breiteCm : 0;
  const laengeCm = roh > 0 ? Math.ceil(Math.round(roh * 1000) / 1000 / RUNDUNG_CM) * RUNDUNG_CM : 0;
  const qm = tarif && !tarif.fehlt?.length && !tarif.doppelt && tarif.qmBruttoCent > 0 ? tarif.qmBruttoCent : null;
  const kostenBruttoCent = qm !== null ? Math.round((laengeCm / 100) * (breiteCm / 100) * qm) : null;
  const min = Number(mindestCm) > 0 ? Number(mindestCm) : null;
  return {
    flaecheCm2: Math.round(flaeche * 100) / 100, laengeCm,
    kostenBruttoCent, kostenNettoCent: kostenBruttoCent === null ? null : Math.round(kostenBruttoCent * 100 / 119),
    mindestCm: min, lohnt: min === null ? null : laengeCm >= min, fehltCm: min === null ? null : Math.max(0, min - laengeCm), ohneMass,
  };
}

/** "≈ 1,4 m" */
export const meterText = cm => `≈ ${(Math.round(Number(cm) / 10) / 10).toFixed(1).replace('.', ',')} m`;

// ── Bestellung, XML ──────────────────────────────────────────────────────────

/** Naechste DTF-JJJJ-NNNN (hoechste + 1 im Jahr, nie wiederverwendet). */
export function naechsteBestellId(ids, jahr) {
  const re = new RegExp(`^DTF-${jahr}-(\\d{4})$`);
  const max = (ids ?? []).reduce((m, id) => { const x = re.exec(t(id)); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return `DTF-${jahr}-${String(max + 1).padStart(4, '0')}`;
}
export const druckIdFuer = (bestellId, i) => `${bestellId}-${String(i + 1).padStart(2, '0')}`;

/** Eingaben der Bestellung pruefen -> { lieferart, notiz }. */
export function bestellEingabe(e = {}) {
  const lieferart = t(e.lieferart) || 'abholung';
  if (!Object.hasOwn(LIEFERARTEN, lieferart)) throw fehler('Lieferart bitte „Abholung“ oder „Versand DHL“.');
  const notiz = t(e.notiz).replace(/\s+/g, ' ');
  if (notiz.length > NOTIZ_MAX) throw fehler(`Notiz an Nico: höchstens ${NOTIZ_MAX} Zeichen.`);
  // antwort-DT1-3: eine abgelegte Bestellung wird nie geaendert - Korrektur = neue Bestellung mit "ersetzt <alte Nummer>"
  const ersetzt = t(e.ersetzt).toUpperCase();
  if (ersetzt && !BESTELL_ID_RE.test(ersetzt)) throw fehler('„ersetzt“ bitte als DTF-JJJJ-NNNN.');
  return { lieferart, notiz, ersetzt };
}

/**
 * Auswahl fuer eine Bestellung pruefen (Zeilen frisch gelesen).
 * @param auswahl [{ schluessel, stand }]
 * @param ansichten Map schluessel -> zeileAnsicht(...)
 * @returns {{ posten: object[], probleme: [{ schluessel, text }], express: boolean }}
 */
export function bestellAuswahl(auswahl, ansichten) {
  const liste = Array.isArray(auswahl) ? auswahl : [];
  if (!liste.length) throw fehler('Keine Zeilen gewählt.');
  if (liste.length > POSTEN_MAX) throw fehler(`Höchstens ${POSTEN_MAX} Zeilen je Bestellung.`);
  const probleme = [], posten = [], gesehen = new Set();
  for (const a of liste) {
    const s = t(a?.schluessel);
    if (gesehen.has(s)) continue;
    gesehen.add(s);
    const v = ansichten.get(s);
    if (!v) { probleme.push({ schluessel: s, text: 'Zeile gibt es nicht mehr' }); continue; }
    if (t(a?.stand) && t(a.stand) !== v.stand) { probleme.push({ schluessel: s, text: 'inzwischen geändert – neu laden' }); continue; }
    if (!v.bereit) { probleme.push({ schluessel: s, text: GRUND_TEXT[v.grundNicht] ?? 'nicht bestellbar' }); continue; }
    posten.push(v);
  }
  const arten = new Set(posten.map(p => p.express));
  if (arten.size > 1) probleme.push({ schluessel: '', text: 'Express- und normale Zeilen getrennt bestellen' });
  return { posten, probleme, express: posten[0]?.express ?? false };
}
export const GRUND_TEXT = {
  status: 'nicht offen', druckposition: 'Druckposition fehlt – „Zuordnen …“', mass: 'Druckmaß fehlt – „Zuordnen …“',
  datei: 'Datei fehlt – „Zuordnen …“', hinweis: 'gesperrt (Hinweis)', bezug: 'Kürzel unbekannt',
};

const attr = v => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cdata = v => `<![CDATA[${String(v ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const mm = cm => (Number(cm) > 0 ? Math.round(Number(cm) * 10) : '');
/** Scan-Adresse ("…/#dtf/scan/<id>") - nur https, sonst ''. */
export function scanAdresse(basis, id) {
  const b = t(basis);
  if (!/^https:\/\/[^\s#?]+$/i.test(b.replace(/\/$/, '').replace(/#.*$/, ''))) return '';
  return `${b.replace(/#.*$/, '').replace(/\/$/, '')}/#dtf/scan/${id}`;
}

/**
 * XML der DTF-Bestellung. Nur: Datei-Pfad, Masse (mm), fuehrende Seite, Anzahl, Referenz (Bestell-/AU-Nummer), Kuerzel, Druckposition,
 * Druck-ID + QR-Adresse. Keine Namen, Preise, Adressen, Drucknamen.
 * @param b { id, datum JJJJ-MM-TT, lieferart, express, notiz, laengeCm, breiteCm, scanBasis, posten: [{ druckId, pfad, breite, hoehe,
 *   fuehrend 'breite'|'hoehe', menge, referenz, kuerzel, druckposition }] }
 */
export function baueDtfXml(b) {
  const qrB = scanAdresse(b.scanBasis, b.id);
  const zeilen = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<dtfBestellung id="${attr(b.id)}" datum="${attr(b.datum)}" lieferart="${attr(LIEFERART_XML[b.lieferart] ?? 'abholung')}" express="${b.express ? 'ja' : 'nein'}"${b.ersetzt ? ` ersetzt="${attr(b.ersetzt)}"` : ''}${qrB ? ` qrBestellung="${attr(qrB)}"` : ''}>`,
    `  <notiz>${cdata(b.notiz ?? '')}</notiz>`,
  ];
  for (const p of b.posten ?? []) {
    const qr = scanAdresse(b.scanBasis, p.druckId);
    zeilen.push(`  <position druckId="${attr(p.druckId)}" datei="${attr(p.pfad)}" breite_mm="${mm(p.breite)}" hoehe_mm="${mm(p.hoehe)}"`
      + ` fuehrend="${p.fuehrend === 'hoehe' ? 'hoehe' : 'breite'}" anzahl="${Number(p.menge) || 0}" referenz="${attr(p.referenz)}"`
      + ` kuerzel="${attr(p.kuerzel)}" druckposition="${attr(p.druckposition)}"${qr ? ` qr="${attr(qr)}"` : ''}/>`);
  }
  zeilen.push(`  <summe geschaetzteLaengeCm="${Number(b.laengeCm) || 0}" breiteCm="${Number(b.breiteCm) || BREITE_STANDARD_CM}"/>`, '</dtfBestellung>', '');
  return zeilen.join('\n');
}

/** Text fuer Nico (Knopf "Nachricht an Nico kopieren"). */
export function nachrichtAnNico({ id, anzahl, laengeCm, lieferart, express, notiz, ersetzt }) {
  return `Hallo Nico, neue DTF-Bestellung ${id} liegt im Ordner „Bestellungen“ (${anzahl} Motiv${anzahl === 1 ? '' : 'e'}, ${meterText(laengeCm)}, `
    + `${LIEFERARTEN[lieferart] ?? 'Abholung'}${express ? ', Express' : ''}).${t(ersetzt) ? ` Sie ersetzt ${t(ersetzt)}.` : ''}${t(notiz) ? ` Notiz: ${t(notiz)}` : ''} Danke!`;
}
/** Chat an uns: nur ID, Laenge, Lieferart. */
export const chatText = ({ id, laengeCm, lieferart, express }) =>
  `🖨️ ${id} abgelegt · ${meterText(laengeCm)} · ${LIEFERARTEN[lieferart] ?? 'Abholung'}${express ? ' · Express' : ''}`;

// ── BO5-9 Teil B: DTF-Stand je Bestellposition (Bestellkarte) ──────────────────

export const istLagerZeile = z => t(z.Status) === STATUS.ABGEWAEHLT && t(z.Grund) === GRUND_LAGER;
export const DTF_STAND = { BESTELLEN: 'bestellen', BESTELLT: 'bestellt', LAGER: 'lager', ABGEWAEHLT: 'abgewaehlt' };
/**
 * Stand je Bestellposition "<Quelle>:<Nummer>:<Position>" aus den Korb-Zeilen (alle Druckpositionen; Platzhalter nur ohne echte).
 *  - bestellt: mind. eine Zeile bestellt/geliefert (Bestell-ID, "geliefert" erst wenn alle bestellten geliefert sind)
 *  - lager:    alle Zeilen abgewaehlt mit GRUND_LAGER
 *  - bestellen: mind. eine Zeile offen
 *  - abgewaehlt: sonst (anderer Grund) - Grund steht dabei
 * @returns {Map<string, { stand, geliefert, bestellung, grund, zeilen: [{ schluessel, status, stand }] }>}
 */
export function dtfStandJePosition(zeilen) {
  const je = new Map();
  for (const z of sichtbareZeilen(zeilen ?? [])) {
    const k = positionsSchluessel(z);
    const l = je.get(k) ?? [];
    l.push(z);
    je.set(k, l);
  }
  const m = new Map();
  for (const [k, l] of je) {
    const st = l.map(z => t(z.Status));
    const best = l.filter(z => [STATUS.BESTELLT, STATUS.GELIEFERT].includes(t(z.Status)));
    let stand = DTF_STAND.ABGEWAEHLT;
    if (best.length) stand = DTF_STAND.BESTELLT;
    else if (l.every(istLagerZeile)) stand = DTF_STAND.LAGER;
    else if (st.includes(STATUS.OFFEN)) stand = DTF_STAND.BESTELLEN;
    const grund = stand === DTF_STAND.ABGEWAEHLT ? [...new Set(l.map(z => t(z.Grund)).filter(Boolean))].join(', ') : '';
    m.set(k, {
      stand, geliefert: best.length > 0 && best.every(z => t(z.Status) === STATUS.GELIEFERT),
      bestellung: [...new Set(best.map(z => t(z.DTF_Bestellung)).filter(Boolean))].join(', '), grund,
      zeilen: l.map(z => ({ schluessel: t(z.Schluessel), status: t(z.Status), stand: t(z.Stand) })),
    });
  }
  return m;
}

/**
 * Was "DTF bestellen" (ziel offen) bzw. "DTF aus dem Lager" (ziel lager) an den Zeilen EINER Position aendert. Gesehener Stand je
 * Zeile wie im Browser (sonst 409). Bestellt/geliefert sperrt "aus dem Lager" (schliessen sich aus). Nichts zu tun = leere Liste.
 * @returns {{ schluessel, felder }[]}
 */
export function dtfKartenPlan(zeilen, { ziel, gesehen = [] }) {
  if (![DTF_STAND.BESTELLEN, DTF_STAND.LAGER].includes(ziel)) throw fehler('Ziel unbekannt.');
  const sicht = new Map((gesehen ?? []).map(g => [t(g.schluessel), t(g.stand)]));
  for (const z of zeilen) {
    if (sicht.has(t(z.Schluessel)) && sicht.get(t(z.Schluessel)) !== t(z.Stand)) throw fehler('Der DTF-Stand wurde inzwischen geändert – Karte neu laden.', 409, 'konflikt');
  }
  if (zeilen.some(z => !sicht.has(t(z.Schluessel)))) throw fehler('Inzwischen gibt es weitere DTF-Zeilen zu dieser Position – Karte neu laden.', 409, 'konflikt');
  if (ziel === DTF_STAND.LAGER) {
    if (zeilen.some(z => [STATUS.BESTELLT, STATUS.GELIEFERT].includes(t(z.Status)))) {
      throw fehler('DTF ist für diese Position schon bestellt – „aus dem Lager“ geht dann nicht.', 409, 'bestellt');
    }
    return zeilen.filter(z => t(z.Status) === STATUS.OFFEN || (t(z.Status) === STATUS.ABGEWAEHLT && t(z.Grund) !== GRUND_LAGER))
      .map(z => ({ schluessel: t(z.Schluessel), felder: { Status: STATUS.ABGEWAEHLT, Grund: GRUND_LAGER, Notiz: '' } }));
  }
  return zeilen.filter(z => t(z.Status) === STATUS.ABGEWAEHLT).map(z => ({ schluessel: t(z.Schluessel), felder: { Status: STATUS.OFFEN, Grund: '', Notiz: '' } }));
}

/** Haengt ein "wird abgelegt" laenger als HAENGT_MIN? */
export const haengt = (p, jetzt = new Date()) => t(p.Status) === BESTELL_STATUS.WIRD && t(p.Stand) && (jetzt - new Date(t(p.Stand))) > HAENGT_MIN * 60000;

// ── Status von Hand ──────────────────────────────────────────────────────────

/** abwaehlen / zurueck (offen) - nur offen <-> abgewaehlt; Grund aus GRUENDE beim Abwaehlen. */
export function statusPlan(z, { ziel, grund, notiz, stand }) {
  if (!z) throw fehler('Zeile gibt es nicht mehr.', 404);
  if (t(stand) !== t(z.Stand)) throw fehler('Zeile wurde inzwischen geändert – neu laden.', 409, 'konflikt');
  if (ziel === STATUS.ABGEWAEHLT) {
    if (t(z.Status) !== STATUS.OFFEN) throw fehler('Nur offene Zeilen lassen sich abwählen.', 409, 'status');
    if (!GRUENDE.includes(t(grund))) throw fehler('Grund bitte aus der Liste wählen.');
    const n = t(notiz);
    if (n.length > 200) throw fehler('Notiz: höchstens 200 Zeichen.');
    return { Status: STATUS.ABGEWAEHLT, Grund: t(grund), Notiz: n };
  }
  if (ziel === STATUS.OFFEN) {
    if (t(z.Status) !== STATUS.ABGEWAEHLT) throw fehler('Nur abgewählte Zeilen lassen sich zurückholen.', 409, 'status');
    return { Status: STATUS.OFFEN, Grund: '', Notiz: '' };
  }
  throw fehler('Ziel unbekannt.');
}

// ── Zuordnen: Eingabe pruefen ────────────────────────────────────────────────

/**
 * Zuordnen-Eingabe -> { bezug, position, datei: {id,name}|null, dateiZeilen: [...], massGruppen: [{ modell, groesse, breite, hoehe, fuehrend }] }
 * e = { bezug, position, modell, farbe, groesse, datei: { id, name }, mass: { breite, hoehe, fuehrend }, dateiAlleGroessen, dateiAlleFarben,
 *   massAlleGroessen, auch: [{ modell, farbe, groesse, datei: bool, mass: bool, breite, hoehe }] }
 */
export function zuordnenPlan(e = {}) {
  const bezug = t(e.bezug);
  if (!bezug) throw fehler('Bezug (Kürzel bzw. Motiv) fehlt.');
  if (bezug.length > 60) throw fehler('Bezug: höchstens 60 Zeichen.');
  const position = positionAusListe(e.position);
  if (!position) throw fehler(t(e.position) ? `Druckposition „${t(e.position)}“ gibt es nicht – bitte aus der Liste wählen.` : 'Druckposition bitte wählen (z. B. Brust).');
  const datei = e.datei && t(e.datei.id) ? { id: t(e.datei.id), name: t(e.datei.name) } : null;
  const mass = e.mass && (t(e.mass.breite) || t(e.mass.hoehe)) ? e.mass : null;
  if (!datei && !mass) throw fehler('Bitte eine Datei und/oder ein Maß angeben.');
  const auch = (Array.isArray(e.auch) ? e.auch : []).slice(0, 200);
  const eigene = { modell: t(e.modell), farbe: t(e.farbe), groesse: t(e.groesse), datei: !!datei, mass: !!mass, breite: mass?.breite, hoehe: mass?.hoehe };
  const alle = [eigene, ...auch.map(x => ({ modell: t(x.modell), farbe: t(x.farbe), groesse: t(x.groesse), datei: !!x.datei && !!datei, mass: !!x.mass && !!mass, breite: x.breite ?? mass?.breite, hoehe: x.hoehe ?? mass?.hoehe }))];
  const dateiJe = new Map();
  if (datei) {
    for (const x of alle.filter(y => y.datei)) {
      const z = { Bezug: bezug, Position: position, Modell: x.modell || GROESSE_ALLE, Textilfarbe: e.dateiAlleFarben ? GROESSE_ALLE : (x.farbe || GROESSE_ALLE),
        Groesse: e.dateiAlleGroessen || e.dateiAlleFarben ? GROESSE_ALLE : (x.groesse || GROESSE_ALLE), Datei_ID: datei.id, Datei_Name: datei.name };
      dateiJe.set(dateiSchluessel(z), z);
    }
  }
  const massJe = new Map();
  if (mass) {
    for (const x of alle.filter(y => y.mass)) {
      const groesse = e.massAlleGroessen ? GROESSE_ALLE : (x.groesse || GROESSE_ALLE);
      const k = `${normBezug(x.modell)}|${normGroesse(groesse)}`;
      if (!massJe.has(k)) massJe.set(k, { modell: x.modell, groesse, breite: x.breite, hoehe: x.hoehe, fuehrend: mass.fuehrend });
    }
  }
  return { bezug, position, datei, dateiZeilen: [...dateiJe.values()], massGruppen: [...massJe.values()] };
}

// ── "Was fehlt" ──────────────────────────────────────────────────────────────

/**
 * Je Bezug · Position · Modell/Farbe/Groesse: was fehlt (Mass/Datei), Stueck offen und in den letzten 90 Tagen verkauft.
 * @param ansichten zeileAnsicht(...) der offenen Zeilen
 * @param verkauft Map "<kuerzel>|<modell>|<farbe>|<groesse>" (normiert) -> Stueck
 */
export function wasFehlt(ansichten, verkauft = new Map()) {
  const je = new Map();
  for (const v of ansichten) {
    if (v.status !== STATUS.OFFEN || (v.massAmpel === 'ok' && v.dateiAmpel === 'ok') || !v.kuerzel) continue;
    const k = [v.kuerzel, v.druckposition || PLATZHALTER, v.modell, v.farbe, v.groesse].map(normBezug).join('|');
    const g = je.get(k) ?? {
      kuerzel: v.kuerzel, druckposition: v.druckposition, modell: v.modell, farbe: v.farbe, groesse: v.groesse, schluessel: v.schluessel,
      massFehlt: v.massAmpel !== 'ok', dateiFehlt: v.dateiAmpel !== 'ok', offen: 0,
      verkauft90: verkauft.get([v.kuerzel, v.modell, v.farbe, v.groesse].map(normBezug).join('|')) ?? 0,
    };
    g.offen += v.menge;
    je.set(k, g);
  }
  return [...je.values()].sort((a, b) => b.offen - a.offen || b.verkauft90 - a.verkauft90 || a.kuerzel.localeCompare(b.kuerzel, 'de'));
}
export const verkaufSchluessel = (kuerzel, modell, farbe, groesse) => [kuerzel, modell, farbe, groesse].map(normBezug).join('|');
