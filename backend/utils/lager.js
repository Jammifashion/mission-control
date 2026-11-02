// Lager (BO5-1) - reine Logik, ohne Zugriffe. Ein- und Ausgabe in lib/lager.js.
//
// Modell A (Inhaber 30.10.): Buchungsjournal "Lager_Buchungen", der Bestand wird gerechnet
// (Summe Menge je Schluessel + Ort). Nie ueberschreiben: eine Korrektur ist eine Gegenbuchung,
// eine Umlagerung sind zwei Zeilen. Bestand nie negativ, ausser ueber eine Zaehlung (die bucht
// nur die Differenz zum gezaehlten Stand, kann also nie unter 0 fuehren). Nur Stueckzahlen.
//
// Schluessel je Warenart:
//   Rohling     LS:<ArticleNr>          (10 Ziffern, LShop_Modelle)
//   Fertigware  WC:<WC_Variation_ID>    (Reiter Varianten)
//   Trikot      TR:<Produkt-ID>:<Groesse>  (Trikot_Artikel; "beflockt" nur in der Notiz, nie der Rueckenname)
//   Fremdware   EX:<SKU_Extern.ArticleNr>
//   Freitext    FREI:LA-NNNN            (Lager_Artikel)

export const TAB_BUCHUNGEN = 'Lager_Buchungen';
export const TAB_ARTIKEL   = 'Lager_Artikel';
export const TAB_ORTE      = 'Lager_Orte';

// Spalten aus bericht-BO5-0 Abschnitt 2; "Vorgang" hinten (Kennung eines Dialog-Schritts: ein zweiter
// Klick mit derselben Kennung bucht nichts doppelt). Gelesen/geschrieben wird nur ueber den Namen.
export const BUCHUNG_SPALTEN = ['Buchung_ID', 'Datum', 'Art', 'Warenart', 'Schluessel', 'Menge', 'Ort', 'Grund',
  'Bezug', 'Quelle', 'Notiz', 'Storno_von', 'Stand', 'Vorgang'];
export const ARTIKEL_SPALTEN = ['LA-Nr', 'Bezeichnung', 'Warenart', 'Modell', 'Farbe', 'Größe', 'Notiz', 'Status'];
export const ORTE_SPALTEN    = ['Ort', 'Status', 'Notiz'];

export const WARENART = { ROHLING: 'rohling', FERTIG: 'fertig', TRIKOT: 'trikot', FREMD: 'fremd', FREI: 'frei' };
export const WARENARTEN = Object.values(WARENART);
const PRAEFIX = { LS: WARENART.ROHLING, WC: WARENART.FERTIG, TR: WARENART.TRIKOT, EX: WARENART.FREMD, FREI: WARENART.FREI };
// Warenart eines Freitext-Artikels (was er "eigentlich" ist), Buchungen tragen immer "frei".
export const ARTIKEL_WARENARTEN = ['rohling', 'fertig', 'trikot', 'fremd', 'sonstiges'];

export const ART = {
  VORRAT: 'vorrat', UEBERSCHUSS: 'zugang_ueberschuss', RETOURE: 'retoure', STORNO: 'storno', INVENTUR: 'inventur',
  ABGANG_SHOP: 'abgang_shop', ABGANG_VORORT: 'abgang_vorort', ABGANG_AUFTRAG: 'abgang_auftrag', ABGANG_PARTNER: 'abgang_partner',
  ABGANG_EIGEN: 'abgang_eigen', UMLAGERUNG: 'umlagerung', KORREKTUR: 'korrektur',
};
export const ART_TEXT = {
  vorrat: 'Vorratskauf', zugang_ueberschuss: 'Überschuss Wareneingang', retoure: 'Retoure', storno: 'Storno',
  inventur: 'Zählung', abgang_shop: 'Shop-Bestellung', abgang_vorort: 'Verkauf vor Ort / Event',
  abgang_auftrag: 'eigener Auftrag', abgang_partner: 'Partner / Muster', abgang_eigen: 'eigene Korb-Position', umlagerung: 'Umlagerung', korrektur: 'Gegenbuchung',
};
export const ZUGANG_ARTEN = [ART.VORRAT, ART.UEBERSCHUSS, ART.RETOURE, ART.STORNO];
export const ABGANG_ARTEN = [ART.ABGANG_VORORT, ART.ABGANG_AUFTRAG, ART.ABGANG_PARTNER, ART.ABGANG_SHOP];
// BO5-3: Quelle korb = "aus Lager nehmen" bzw. "zurück in den Korb" im L-Shop-Warenkorb (Bezug = Korb-Schluessel).
export const QUELLE = { KNOPF: 'knopf', START: 'start', INVENTUR: 'inventur', KORB: 'korb' };
export const AKTIONEN = ['einbuchen', 'ausbuchen', 'umlagern', 'zaehlung', 'start'];

export const MENGE_MAX = 9999;
export const POSTEN_MAX = 60;
export const TEXT_MAX = 200;
export const ORT_MAX = 40;
export const STATUS_AKTIV = 'aktiv';

const t = v => String(v ?? '').trim();
const klein = v => t(v).toLowerCase();
const fehlerText = (code, text, extra = {}) => ({ code, text, ...extra });

// ── Schluessel ────────────────────────────────────────────────────────────────

const MUSTER = {
  LS: /^LS:\d{10}$/,
  WC: /^WC:\d{1,12}$/,
  TR: /^TR:\d{1,12}:[A-Za-z0-9/()]{1,12}$/,
  EX: /^EX:[^\s:][^:]{0,59}$/,
  FREI: /^FREI:LA-\d{4}$/,
};
/** Warenart eines Schluessels oder null, wenn das Format nicht stimmt. */
export function warenartVon(schluessel) {
  const s = t(schluessel);
  const p = s.slice(0, s.indexOf(':'));
  return MUSTER[p]?.test(s) ? PRAEFIX[p] : null;
}
export const trikotSchluessel = (produktId, groesse) => `TR:${t(produktId)}:${t(groesse).replace(/\s+/g, '')}`;

// ── Lesen ─────────────────────────────────────────────────────────────────────

/** Kopf + Zeilen eines Reiters -> { idx, zeilen: [{ _zeile, <Spalte>: Wert }] }, ganz leere Zeilen fallen weg. */
export function reiterZeilen(werte, spalten) {
  const [kopf = [], ...rest] = werte ?? [];
  const idx = Object.fromEntries(spalten.map(n => [n, kopf.findIndex(k => t(k) === n)]));
  const fehlt = spalten.filter(n => idx[n] < 0);
  const zeilen = [];
  rest.forEach((r, i) => {
    if (!(r ?? []).some(c => t(c))) return;
    const z = { _zeile: i + 2 };
    for (const n of spalten) z[n] = idx[n] >= 0 ? r[idx[n]] ?? '' : '';
    zeilen.push(z);
  });
  return { kopf, idx, fehlt, zeilen };
}

const zahl = v => { const n = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

/** Journal-Zeilen -> Buchungen (Menge als Zahl; unlesbare Menge = 0 + Hinweis). */
export function buchungenAus(werte) {
  const r = reiterZeilen(werte, BUCHUNG_SPALTEN);
  const hinweise = [];
  const buchungen = r.zeilen.map(z => {
    const m = zahl(z.Menge);
    if (!Number.isInteger(m)) hinweise.push(`Zeile ${z._zeile}: Menge "${t(z.Menge)}" ist keine ganze Zahl - zählt als 0.`);
    return {
      zeile: z._zeile, id: t(z.Buchung_ID), datum: t(z.Datum), art: t(z.Art), warenart: t(z.Warenart), schluessel: t(z.Schluessel),
      menge: Number.isInteger(m) ? m : 0, ort: t(z.Ort), grund: t(z.Grund), bezug: t(z.Bezug), quelle: t(z.Quelle),
      notiz: t(z.Notiz), stornoVon: t(z.Storno_von), vorgang: t(z.Vorgang),
    };
  });
  return { ...r, buchungen, hinweise };
}

const bk = (schluessel, ort) => `${schluessel}\u0000${ort}`;

/** Bestand je Schluessel + Ort: Map "<schluessel>\0<ort>" -> { schluessel, ort, warenart, menge, letzte }. */
export function bestandAus(buchungen) {
  const m = new Map();
  for (const b of buchungen ?? []) {
    if (!b.schluessel || !b.ort) continue;
    const k = bk(b.schluessel, b.ort);
    const e = m.get(k) ?? { schluessel: b.schluessel, ort: b.ort, warenart: warenartVon(b.schluessel) ?? b.warenart, menge: 0, letzte: '' };
    e.menge += b.menge;
    if (b.datum > e.letzte) e.letzte = b.datum;
    m.set(k, e);
  }
  return m;
}
export const bestandVon = (bestand, schluessel, ort) => bestand.get(bk(schluessel, ort))?.menge ?? 0;

/** Naechste Buchungsnummer LB-JJJJ-NNNNN (hoechste + 1 im Jahr, nie wiederverwendet). */
export function naechsteBuchungNr(buchungen, jahr) {
  const re = new RegExp(`^LB-${jahr}-(\\d{5})$`);
  const max = Math.max(0, ...(buchungen ?? []).map(b => Number(b.id.match(re)?.[1] ?? 0)));
  return max + 1;
}
export const buchungId = (jahr, n) => `LB-${jahr}-${String(n).padStart(5, '0')}`;

// ── Vorgang (Doppelklick) ─────────────────────────────────────────────────────

export const VORGANG_MUSTER = /^[A-Za-z0-9-]{8,64}$/;
/** Buchungen, die schon zu diesem Vorgang gehoeren (zweiter Klick). */
export const buchungenDesVorgangs = (buchungen, vorgang) => (buchungen ?? []).filter(b => b.vorgang && b.vorgang === t(vorgang));

// ── Buchung planen ────────────────────────────────────────────────────────────

function mengeLesen(roh, { null: nullErlaubt = false } = {}) {
  const s = t(roh);
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < (nullErlaubt ? 0 : 1) || n > MENGE_MAX) return NaN;
  return n;
}

const zuLang = (v, max = TEXT_MAX) => t(v).length > max;

/**
 * Zeilen fuer einen Dialog-Schritt. Alles oder nichts: jedes Problem verhindert die ganze Buchung.
 * @param {object} e  { aktion, art, ort, zielOrt, grund, bezug, notiz, posten: [{ schluessel, menge }], vorgang }
 * @param {object} k  { buchungen, orte: string[] (aktiv), gueltig: schluessel -> true|Text, jetzt: Date }
 * @returns {{ zeilen: object[], probleme: object[], schonGebucht?: object[] }}
 */
export function planBuchung(e, { buchungen, orte, gueltig = () => true, bezugPruefen = () => true, jetzt = new Date() }) {
  const probleme = [];
  const aktion = t(e?.aktion);
  const vorgang = t(e?.vorgang);
  if (!VORGANG_MUSTER.test(vorgang)) probleme.push(fehlerText('vorgang', 'Interne Kennung fehlt - Seite neu laden.'));
  const schon = vorgang ? buchungenDesVorgangs(buchungen, vorgang) : [];
  if (schon.length) return { zeilen: [], probleme: [], schonGebucht: schon };
  if (!AKTIONEN.includes(aktion)) return { zeilen: [], probleme: [...probleme, fehlerText('aktion', `Unbekannte Aktion "${aktion}".`)] };

  let art;
  if (aktion === 'einbuchen') art = t(e.art);
  else if (aktion === 'ausbuchen') art = t(e.art);
  else if (aktion === 'umlagern') art = ART.UMLAGERUNG;
  else art = ART.INVENTUR;
  if (aktion === 'einbuchen' && !ZUGANG_ARTEN.includes(art)) probleme.push(fehlerText('art', 'Bitte eine Art des Zugangs wählen.'));
  if (aktion === 'ausbuchen' && !ABGANG_ARTEN.includes(art)) probleme.push(fehlerText('art', 'Bitte eine Art des Abgangs wählen.'));
  const quelle = aktion === 'start' ? QUELLE.START : aktion === 'zaehlung' ? QUELLE.INVENTUR : QUELLE.KNOPF;

  const ortListe = (orte ?? []).map(t);
  const ort = t(e.ort);
  // BO5-5 Sammelausbuchen: jede Zeile der Liste darf ihren eigenen Ort tragen (sonst gilt der Ort des Dialogs).
  const eigenerOrt = aktion === 'ausbuchen';
  const ortVon = p => (eigenerOrt && t(p?.ort)) || ort;
  const roh = Array.isArray(e.posten) ? e.posten : [];
  const orteGenutzt = new Set(roh.length ? roh.map(ortVon) : [ort]);
  for (const o of orteGenutzt) if (!ortListe.includes(o)) probleme.push(fehlerText('ort', o ? `Ort "${o}" gibt es nicht (mehr).` : 'Bitte einen Ort wählen.'));
  // BO5-5: Bezug je Abgangsart (Event, Auftrag, Partner/Muster) - die Regeln liefert lib/lager.js (Events, Partnerliste).
  if (aktion === 'ausbuchen' && ABGANG_ARTEN.includes(art)) {
    const b = bezugPruefen(art, t(e.bezug));
    if (b !== true) probleme.push(fehlerText('bezug', typeof b === 'string' ? b : 'Bezug fehlt.'));
  }
  const zielOrt = t(e.zielOrt);
  if (aktion === 'umlagern') {
    if (!ortListe.includes(zielOrt)) probleme.push(fehlerText('zielOrt', zielOrt ? `Ort "${zielOrt}" gibt es nicht (mehr).` : 'Bitte den neuen Ort wählen.'));
    else if (zielOrt === ort) probleme.push(fehlerText('zielOrt', 'Neuer Ort ist derselbe wie der alte.'));
  }
  for (const [feld, wert] of [['grund', e.grund], ['bezug', e.bezug], ['notiz', e.notiz]])
    if (zuLang(wert)) probleme.push(fehlerText(feld, `${feld[0].toUpperCase()}${feld.slice(1)} ist zu lang (höchstens ${TEXT_MAX} Zeichen).`));

  if (roh.length > POSTEN_MAX) probleme.push(fehlerText('posten', `Höchstens ${POSTEN_MAX} Zeilen auf einmal.`));
  const gesehen = new Set();
  const posten = [];
  for (const p of roh) {
    const s = t(p?.schluessel);
    const wa = warenartVon(s);
    if (!wa) { probleme.push(fehlerText('schluessel', `Unbekannter Artikel "${s}".`, { schluessel: s })); continue; }
    const k = `${s}|${ortVon(p)}`;
    if (gesehen.has(k)) { probleme.push(fehlerText('doppelt', `${s} steht doppelt in der Auswahl${eigenerOrt ? ` (Ort ${ortVon(p)})` : ''}.`, { schluessel: s })); continue; }
    gesehen.add(k);
    const g = gueltig(s);
    if (g !== true) { probleme.push(fehlerText('schluessel', typeof g === 'string' ? g : `${s} ist nicht (mehr) gepflegt.`, { schluessel: s })); continue; }
    const zaehlt = aktion === 'zaehlung';
    const m = mengeLesen(p?.menge, { null: zaehlt });
    if (m === null) continue;   // leer = nicht buchen
    if (Number.isNaN(m)) { probleme.push(fehlerText('menge', `Menge bei ${s} ungültig (ganze Zahl ${zaehlt ? 0 : 1}–${MENGE_MAX}).`, { schluessel: s })); continue; }
    posten.push({ schluessel: s, warenart: wa, menge: m, ort: ortVon(p) });
  }

  const bestand = bestandAus(buchungen);
  const bewegungen = [];   // { schluessel, warenart, ort, menge, bezugIdx? }
  for (const p of posten) {
    const ort = p.ort;   // je Zeile (Sammelausbuchen), sonst der Ort des Dialogs
    const da = bestandVon(bestand, p.schluessel, ort);
    if (aktion === 'zaehlung') {
      const diff = p.menge - da;
      if (diff !== 0) bewegungen.push({ ...p, ort, menge: diff });
    } else if (aktion === 'ausbuchen' || aktion === 'umlagern') {
      if (p.menge > da) {
        probleme.push(fehlerText('bestand', `${p.schluessel}: am Ort "${ort}" ${da === 0 ? 'nichts' : `nur ${da}`} da, ${p.menge} gewünscht.`, { schluessel: p.schluessel, da }));
        continue;
      }
      bewegungen.push({ ...p, ort, menge: -p.menge });
      if (aktion === 'umlagern') bewegungen.push({ ...p, ort: zielOrt, menge: p.menge, paar: bewegungen.length - 1 });
    } else {
      bewegungen.push({ ...p, ort, menge: p.menge });
    }
  }
  if (!probleme.length && !bewegungen.length) {
    probleme.push(fehlerText('leer', aktion === 'zaehlung' ? 'Gezählter Stand = Bestand, nichts zu buchen.' : 'Noch keine Menge eingetragen.'));
  }
  if (probleme.length) return { zeilen: [], probleme };

  const jahr = jetzt.getUTCFullYear();
  const n0 = naechsteBuchungNr(buchungen, jahr);
  const ids = bewegungen.map((_, i) => buchungId(jahr, n0 + i));
  const iso = jetzt.toISOString();
  const zeilen = bewegungen.map((b, i) => {
    const partner = b.paar !== undefined ? b.paar : bewegungen.findIndex(x => x.paar === i);
    return {
      Buchung_ID: ids[i], Datum: iso, Art: art, Warenart: b.warenart, Schluessel: b.schluessel, Menge: b.menge, Ort: b.ort,
      Grund: t(e.grund), Bezug: art === ART.UMLAGERUNG && partner >= 0 ? ids[partner] : t(e.bezug), Quelle: quelle,
      Notiz: t(e.notiz), Storno_von: '', Stand: iso, Vorgang: vorgang,
    };
  });
  return { zeilen, probleme: [] };
}

/**
 * Gegenbuchung zu einer Buchung (bei einer Umlagerung zu beiden Zeilen). Nie doppelt, nie zu einer
 * Gegenbuchung, und der Bestand darf dadurch nicht negativ werden (dann: Zaehlung benutzen).
 */
export function planGegenbuchung({ buchungId: id, vorgang }, { buchungen, jetzt = new Date() }) {
  const v = t(vorgang);
  if (!VORGANG_MUSTER.test(v)) return { zeilen: [], probleme: [fehlerText('vorgang', 'Interne Kennung fehlt - Seite neu laden.')] };
  const schon = buchungenDesVorgangs(buchungen, v);
  if (schon.length) return { zeilen: [], probleme: [], schonGebucht: schon };
  const b = (buchungen ?? []).find(x => x.id === t(id));
  if (!b) return { zeilen: [], probleme: [fehlerText('fehlt', `Buchung ${t(id)} gibt es nicht.`)], status: 404 };
  if (b.art === ART.KORREKTUR || b.stornoVon) return { zeilen: [], probleme: [fehlerText('korrektur', 'Eine Gegenbuchung kann man nicht gegenbuchen.')] };
  // BO5-3: Abgaenge aus dem Korb nur ueber "zurück in den Korb" - sonst stimmt der Korb-Status nicht mehr.
  if (b.quelle === QUELLE.KORB) return { zeilen: [], probleme: [fehlerText('korb', 'Diese Buchung kam aus dem Warenkorb - bitte dort „zurück in den Korb“ nehmen.')] };
  const ziele = [b];
  if (b.art === ART.UMLAGERUNG) {
    const p = buchungen.find(x => x.id === b.bezug && x.bezug === b.id);
    if (!p) return { zeilen: [], probleme: [fehlerText('umlagerung', `Zur Umlagerung ${b.id} fehlt die zweite Zeile - bitte von Hand prüfen.`)] };
    ziele.push(p);
  }
  const schonGegen = ziele.find(z => buchungen.some(x => x.stornoVon === z.id));
  if (schonGegen) return { zeilen: [], probleme: [fehlerText('doppelt', `${schonGegen.id} ist schon gegengebucht.`)] };

  const bestand = bestandAus(buchungen);
  const nachher = new Map();
  for (const z of ziele) {
    const k = bk(z.schluessel, z.ort);
    nachher.set(k, (nachher.get(k) ?? bestandVon(bestand, z.schluessel, z.ort)) - z.menge);
  }
  const zuWenig = ziele.find(z => nachher.get(bk(z.schluessel, z.ort)) < 0);
  if (zuWenig) {
    return { zeilen: [], probleme: [fehlerText('bestand', `Geht nicht: am Ort "${zuWenig.ort}" ist davon nichts mehr da (schon ausgebucht). Stimmt der Bestand nicht, bitte zählen.`)] };
  }
  const jahr = jetzt.getUTCFullYear();
  const n0 = naechsteBuchungNr(buchungen, jahr);
  const iso = jetzt.toISOString();
  const zeilen = ziele.map((z, i) => ({
    Buchung_ID: buchungId(jahr, n0 + i), Datum: iso, Art: ART.KORREKTUR, Warenart: z.warenart || warenartVon(z.schluessel),
    Schluessel: z.schluessel, Menge: -z.menge, Ort: z.ort, Grund: 'Gegenbuchung', Bezug: '', Quelle: QUELLE.KNOPF,
    Notiz: '', Storno_von: z.id, Stand: iso, Vorgang: v,
  }));
  return { zeilen, probleme: [] };
}

// ── Orte und Freitext-Artikel ─────────────────────────────────────────────────

export const orteAus = werte => reiterZeilen(werte, ORTE_SPALTEN).zeilen
  .map(z => ({ ort: t(z.Ort), status: t(z.Status) || STATUS_AKTIV, notiz: t(z.Notiz), zeile: z._zeile }))
  .filter(o => o.ort);
export const aktiveOrte = orte => orte.filter(o => klein(o.status) === STATUS_AKTIV).map(o => o.ort);

/** Neuer Lagerort: 2-40 Zeichen, eindeutig (Gross/Klein egal). */
export function planNeuerOrt(eingabe, orte) {
  const ort = t(eingabe?.ort).replace(/\s+/g, ' ');
  if (ort.length < 2 || ort.length > ORT_MAX) return { probleme: [fehlerText('ort', `Ort: 2–${ORT_MAX} Zeichen.`)] };
  const da = orte.find(o => klein(o.ort) === klein(ort));
  if (da) return { probleme: [fehlerText('doppelt', `Den Ort "${da.ort}" gibt es schon.`)], vorhanden: da.ort };
  if (zuLang(eingabe?.notiz)) return { probleme: [fehlerText('notiz', `Notiz ist zu lang (höchstens ${TEXT_MAX} Zeichen).`)] };
  return { probleme: [], zeile: { Ort: ort, Status: STATUS_AKTIV, Notiz: t(eingabe?.notiz) } };
}

export const artikelAus = werte => reiterZeilen(werte, ARTIKEL_SPALTEN).zeilen
  .map(z => ({ laNr: t(z['LA-Nr']), bezeichnung: t(z.Bezeichnung), warenart: t(z.Warenart), modell: t(z.Modell),
    farbe: t(z.Farbe), groesse: t(z['Größe']), notiz: t(z.Notiz), status: t(z.Status) || STATUS_AKTIV, zeile: z._zeile }))
  .filter(a => a.laNr);

export function naechsteLaNr(artikel) {
  const max = Math.max(0, ...artikel.map(a => Number(a.laNr.match(/^LA-(\d{4})$/)?.[1] ?? 0)));
  return `LA-${String(max + 1).padStart(4, '0')}`;
}

/** Neuer Freitext-Artikel: Bezeichnung Pflicht; gleiche Bezeichnung + Farbe + Groesse -> der vorhandene. */
export function planNeuerArtikel(eingabe, artikel) {
  const e = Object.fromEntries(['bezeichnung', 'warenart', 'modell', 'farbe', 'groesse', 'notiz'].map(k => [k, t(eingabe?.[k]).replace(/\s+/g, ' ')]));
  const probleme = [];
  if (e.bezeichnung.length < 2 || e.bezeichnung.length > 80) probleme.push(fehlerText('bezeichnung', 'Bezeichnung: 2–80 Zeichen.'));
  if (!ARTIKEL_WARENARTEN.includes(e.warenart)) probleme.push(fehlerText('warenart', 'Bitte wählen, was es ist.'));
  for (const k of ['modell', 'farbe', 'groesse']) if (e[k].length > 40) probleme.push(fehlerText(k, `${k}: höchstens 40 Zeichen.`));
  if (zuLang(e.notiz)) probleme.push(fehlerText('notiz', `Notiz ist zu lang (höchstens ${TEXT_MAX} Zeichen).`));
  if (probleme.length) return { probleme };
  const gleich = artikel.find(a => klein(a.bezeichnung) === klein(e.bezeichnung) && klein(a.farbe) === klein(e.farbe) && klein(a.groesse) === klein(e.groesse));
  if (gleich) return { probleme: [fehlerText('doppelt', `Gibt es schon: ${gleich.laNr} ${gleich.bezeichnung}.`)], vorhanden: gleich.laNr };
  const laNr = naechsteLaNr(artikel);
  return { probleme: [], laNr, zeile: { 'LA-Nr': laNr, Bezeichnung: e.bezeichnung, Warenart: e.warenart, Modell: e.modell,
    Farbe: e.farbe, 'Größe': e.groesse, Notiz: e.notiz, Status: STATUS_AKTIV } };
}

/** Objekt -> Zeile in der Spaltenreihenfolge des Reiters (idx aus reiterZeilen). */
export function alsZeile(obj, idx) {
  const breite = Math.max(...Object.values(idx)) + 1;
  const z = Array(breite).fill('');
  for (const [n, i] of Object.entries(idx)) if (i >= 0) z[i] = obj[n] ?? '';
  return z;
}

// ── Anzeige ───────────────────────────────────────────────────────────────────

/**
 * Bestandsliste: je Schluessel + Ort eine Zeile mit Beschreibung. Auch Bestand 0 (der Browser blendet ihn
 * standardmaessig aus). beschreibe(schluessel) -> { modell, name, farbe, groesse, hinweis }.
 */
export function bestandListe(buchungen, beschreibe) {
  return [...bestandAus(buchungen).values()].map(e => ({ ...e, ...beschreibe(e.schluessel) }))
    .sort((a, b) => a.warenart.localeCompare(b.warenart) || (a.modell ?? '').localeCompare(b.modell ?? '')
      || (a.farbe ?? '').localeCompare(b.farbe ?? '') || a.schluessel.localeCompare(b.schluessel) || a.ort.localeCompare(b.ort));
}

/** Verlauf, neueste oben; je Buchung, ob sie schon gegengebucht ist / gegengebucht werden kann. */
export function buchungsVerlauf(buchungen, beschreibe, { limit = 300 } = {}) {
  const gegen = new Set(buchungen.filter(b => b.stornoVon).map(b => b.stornoVon));
  return [...buchungen].sort((a, b) => b.datum.localeCompare(a.datum) || b.id.localeCompare(a.id)).slice(0, limit).map(b => ({
    id: b.id, datum: b.datum, art: b.art, artText: ART_TEXT[b.art] ?? b.art, warenart: b.warenart, schluessel: b.schluessel,
    menge: b.menge, ort: b.ort, grund: b.grund, bezug: b.bezug, quelle: b.quelle, notiz: b.notiz, stornoVon: b.stornoVon,
    gegengebucht: gegen.has(b.id), gegenbuchbar: !gegen.has(b.id) && b.art !== ART.KORREKTUR && !b.stornoVon && b.quelle !== QUELLE.KORB,
    ...beschreibe(b.schluessel),
  }));
}

// ── BO5-5: Events, Bezug je Abgangsart, Auswertung ────────────────────────────

export const TAB_EVENTS = 'Lager_Events';
export const EVENT_SPALTEN = ['Event_ID', 'Name', 'Datum', 'Ort', 'Status', 'Notiz'];
export const EVENT_OFFEN = 'offen';
export const MUSTER_PRAEFIX = 'Muster: ';
const EVENT_ID = /^EV-\d{4}$/;
const PARTNER_ID = /^P-\d{3,}$/;

export const eventsAus = werte => reiterZeilen(werte, EVENT_SPALTEN).zeilen
  .map(z => ({ id: t(z.Event_ID), name: t(z.Name), datum: t(z.Datum), ort: t(z.Ort), status: t(z.Status) || EVENT_OFFEN, notiz: t(z.Notiz) }))
  .filter(ev => ev.id);

/** Neues Event: Name 2-60, Datum JJJJ-MM-TT (Pflicht), Ort optional; gleicher Name + Datum -> das vorhandene. */
export function planNeuesEvent(eingabe, events) {
  const name = t(eingabe?.name).replace(/\s+/g, ' ');
  const datum = t(eingabe?.datum);
  const ort = t(eingabe?.ort).replace(/\s+/g, ' ');
  const probleme = [];
  if (name.length < 2 || name.length > 60) probleme.push(fehlerText('name', 'Name des Events: 2–60 Zeichen.'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || isNaN(Date.parse(datum))) probleme.push(fehlerText('datum', 'Datum fehlt (TT.MM.JJJJ).'));
  if (ort.length > 60) probleme.push(fehlerText('ort', 'Ort: höchstens 60 Zeichen.'));
  if (zuLang(eingabe?.notiz)) probleme.push(fehlerText('notiz', `Notiz ist zu lang (höchstens ${TEXT_MAX} Zeichen).`));
  if (probleme.length) return { probleme };
  const gleich = events.find(ev => klein(ev.name) === klein(name) && ev.datum === datum);
  if (gleich) return { probleme: [fehlerText('doppelt', `Das Event gibt es schon: ${gleich.name} (${gleich.datum}).`)], vorhanden: gleich.id };
  const max = Math.max(0, ...events.map(ev => Number(ev.id.match(/^EV-(\d{4})$/)?.[1] ?? 0)));
  const id = `EV-${String(max + 1).padStart(4, '0')}`;
  return { probleme: [], id, zeile: { Event_ID: id, Name: name, Datum: datum, Ort: ort, Status: EVENT_OFFEN, Notiz: t(eingabe?.notiz) } };
}

/**
 * Bezug je Abgangsart -> true oder Text. Verkauf vor Ort = offenes Event (EV-NNNN); eigener Auftrag = Freitext
 * 2-80 Zeichen (spaeter die Auftragsnummer aus dem Auftragsmanagement - das Feld nimmt beides); Partner = P-… aus
 * der Partnerliste oder "Muster: <Empfaenger>" ohne Klarnamen; Shop-Bestellung von Hand = optional.
 */
export function bezugRegel(art, bezug, { events = [], partner = [] } = {}) {
  const b = t(bezug);
  if (art === ART.ABGANG_VORORT) {
    if (!b) return 'Bitte das Event wählen (oder „+ neues Event“).';
    const ev = events.find(x => x.id === b);
    if (!EVENT_ID.test(b) || !ev) return `Event "${b}" gibt es nicht.`;
    return ev.status === EVENT_OFFEN || `Event ${ev.name} ist ${ev.status} - bitte ein offenes wählen.`;
  }
  if (art === ART.ABGANG_AUFTRAG) return (b.length >= 2 && b.length <= 80) || 'Bitte die Auftragsreferenz eintragen (2–80 Zeichen, ohne Namen).';
  if (art === ART.ABGANG_PARTNER) {
    if (b.startsWith(MUSTER_PRAEFIX.trim())) {
      const rest = b.slice(MUSTER_PRAEFIX.trim().length).trim();
      return (rest.length >= 2 && rest.length <= 60) || 'Bitte eintragen, wer das Muster bekommt (2–60 Zeichen, ohne Namen).';
    }
    if (!b) return 'Bitte den Partner wählen oder „Muster“.';
    return (PARTNER_ID.test(b) && partner.some(p => p.id === b)) || `Partner "${b}" steht nicht in der Partnerliste.`;
  }
  return true;
}

/** Vorschlag im Dialog: das Event der juengsten Buchung "Verkauf vor Ort", wenn es noch offen ist, sonst das neueste offene. */
export function eventVorschlag(buchungen, events) {
  const offen = new Map(events.filter(ev => ev.status === EVENT_OFFEN).map(ev => [ev.id, ev]));
  const letzte = [...(buchungen ?? [])].filter(b => b.art === ART.ABGANG_VORORT && offen.has(b.bezug)).sort((a, b) => b.datum.localeCompare(a.datum))[0];
  if (letzte) return letzte.bezug;
  return [...offen.values()].sort((a, b) => b.datum.localeCompare(a.datum) || b.id.localeCompare(a.id))[0]?.id ?? '';
}

export const ABGANG_AUSWERTUNG_ARTEN = [...ABGANG_ARTEN, ART.ABGANG_EIGEN];
const tagVon = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }); };

/**
 * Auswertung "Abgaenge": was ging raus, Gegenbuchungen abgezogen. Filter art, bezug, von/bis (JJJJ-MM-TT, Berlin).
 * -> { posten: [{ schluessel, warenart, menge }], stueck, buchungen, bezuege: [{ art, bezug, stueck }] }
 */
export function abgaengeAuswertung(buchungen, f = {}) {
  const alle = buchungen ?? [];
  const gegen = new Map();
  for (const b of alle) if (b.stornoVon) gegen.set(b.stornoVon, (gegen.get(b.stornoVon) ?? 0) + b.menge);
  const arten = f.art ? [t(f.art)] : ABGANG_AUSWERTUNG_ARTEN;
  const treffer = alle.filter(b => arten.includes(b.art) && b.menge < 0 && !b.stornoVon
    && (!f.bezug || b.bezug === t(f.bezug))
    && (!f.von || tagVon(b.datum) >= t(f.von)) && (!f.bis || tagVon(b.datum) <= t(f.bis)));
  const je = new Map(), bezuege = new Map();
  let buchungenZahl = 0;
  for (const b of treffer) {
    const raus = -b.menge - (gegen.get(b.id) ?? 0);   // Gegenbuchung (+) zieht ab
    if (raus <= 0) continue;
    buchungenZahl++;
    const e = je.get(b.schluessel) ?? { schluessel: b.schluessel, warenart: warenartVon(b.schluessel) ?? b.warenart, menge: 0 };
    e.menge += raus;
    je.set(b.schluessel, e);
    const k = `${b.art}|${b.bezug}`;
    const z = bezuege.get(k) ?? { art: b.art, bezug: b.bezug, stueck: 0 };
    z.stueck += raus;
    bezuege.set(k, z);
  }
  const posten = [...je.values()];
  return { posten, stueck: posten.reduce((a, p) => a + p.menge, 0), buchungen: buchungenZahl, bezuege: [...bezuege.values()] };
}
