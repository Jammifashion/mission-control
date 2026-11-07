// KS3: Bestellseite -> Pruefen in MC und Uebernehmen in einen Auftrag je Termin. Reine Logik ohne Netz; Lesen/Schreiben in
// lib/bestellUebernahme.js.
//
// Fluss (bericht-KS0 Plan 2): Eintrag (Seite) -> geprüft (MC) -> übernommen (AU-Positionen bzw. TR6-Trikot) -> "Rohlinge
// bereitstellen" (AM-3, Korb/Lager). Ein AU je Termin (Kunde des Zugangs, Termin = Datum, Kanal "Bestellseite"); Nachtrag:
// steht der Termin-Auftrag schon hinter "bestellt", bekommt der Termin einen weiteren AU (Bestell_Termine.Auftrag_Nr = Liste).
// Kürzel und Notiz des Eintrags werden NICHT in den Auftrag kopiert (AM-Regel: Freitexte im Auftrag ohne Personennamen) -
// MC zeigt sie ueber Bestell_Eintraege.Position_ID nur an. Keine Preise. Nie Partner-Reiter.

import { E_STATUS, E_ART } from './bestell-eintraege.js';
import {
  AUFTRAG_SPALTEN, POSITION_SPALTEN, ART, HERKUNFT, STORNIERT, schrittIndex, naechsteAuftragNr, naechstePositionId, fehler, VERWEIS_KORB,
} from './auftraege.js';
import { berlinDatum } from './berlin-tag.js';

const t = v => String(v ?? '').trim();
const ein = v => t(v).replace(/\s+/g, ' ');
export const MC_KUERZEL = 'MC';
export const GRUND_MAX = 100;
export const KANAL = 'Bestellseite';
/** Bis zu diesem Status haengt die Uebernahme Positionen an den Termin-Auftrag an (Bereitstellen AM-3 geht bis "bestellt"). */
export const ANHAENGEN_BIS = 'bestellt';
export const VERWEIS_OHNE = 'ohne Verweis:';
export const KANDIDAT_TAGE = 60;
const FREITEXT_MAX = 120, MOTIV_MAX = 120;

const kurz = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const tm = ymd => (/^\d{4}-\d{2}-\d{2}$/.test(t(ymd)) ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.` : 'ohne Datum');
/** Termin-Auftraege als Liste (Spalte Auftrag_Nr kann mehrere tragen: "AU-…, AU-…"). */
export const terminAuftraege = termin => t(termin?.Auftrag_Nr).split(/[,;\s]+/).map(t).filter(Boolean);

// ── Pruefen in MC ────────────────────────────────────────────────────────────

/**
 * Sammelaktion aus MC: geprueft | zurueck (geprüft -> eingegangen) | ablehnen (Grund Pflicht, Status storniert).
 * auswahl = [{ id, stand }] - Stand wie gesehen (sonst 409). Liefert je Eintrag die neue Zeile; schon im Zielzustand = uebersprungen.
 */
export function mcPruefPlan({ zugangId, eintraege, auswahl, aktion, grund, jetzt }) {
  const liste = Array.isArray(auswahl) ? auswahl : [];
  if (!liste.length) throw fehler('Keine Einträge gewählt.');
  if (liste.length > 500) throw fehler('Höchstens 500 Einträge auf einmal.');
  let g = '';
  if (aktion === 'ablehnen') {
    g = ein(grund);
    if (!g) throw fehler('Bitte einen kurzen Grund angeben.');
    if (g.length > GRUND_MAX) throw fehler(`Grund: höchstens ${GRUND_MAX} Zeichen.`);
  } else if (!['geprueft', 'zurueck'].includes(aktion)) throw fehler('Unbekannte Aktion.');
  const stand = new Date(jetzt).toISOString();
  const aus = [];
  let unveraendert = 0;
  for (const w of liste) {
    const e = (eintraege ?? []).find(x => x.Eintrag_ID === t(w?.id) && x.Zugang_ID === t(zugangId));
    if (!e) throw fehler(`Eintrag ${t(w?.id)} gibt es auf dieser Bestellseite nicht.`, 404);
    if (t(w?.stand) !== t(e.Stand)) throw fehler(`Eintrag ${e.Eintrag_ID} wurde inzwischen geändert – bitte neu laden.`, 409, 'konflikt');
    const st = t(e.Status) || E_STATUS.EINGEGANGEN;
    if (st === E_STATUS.UEBERNOMMEN) throw fehler(`Eintrag ${e.Eintrag_ID} ist schon übernommen.`, 409, 'uebernommen');
    if (st === E_STATUS.STORNIERT) throw fehler(`Eintrag ${e.Eintrag_ID} ist storniert.`, 409, 'storniert');
    if (aktion === 'geprueft') {
      if (st === E_STATUS.GEPRUEFT) { unveraendert++; continue; }
      aus.push({ eintrag: e, neu: { ...e, Status: E_STATUS.GEPRUEFT, Stand: stand } });
    } else if (aktion === 'zurueck') {
      if (st === E_STATUS.EINGEGANGEN) { unveraendert++; continue; }
      aus.push({ eintrag: e, neu: { ...e, Status: E_STATUS.EINGEGANGEN, Stand: stand } });
    } else {
      aus.push({ eintrag: e, neu: { ...e, Status: E_STATUS.STORNIERT, Ablehn_Grund: g, Geaendert_Von: MC_KUERZEL, Stand: stand } });
    }
  }
  return { plan: aus, unveraendert };
}

// ── Kandidaten "schon bestellt – verknüpfen" ─────────────────────────────────

const KORB_KANDIDAT = ['offen', 'bestellt', 'geliefert', 'Lager'];
// KS3-1: Kennzeichen je Korb-Status in der Auswahl ("offen" = liegt im Korb, geht beim naechsten Senden normal raus).
export const KORB_STUFE = {
  offen: { stufe: 'offen', text: 'im Korb, noch nicht gesendet' }, bestellt: { stufe: 'bestellt', text: 'bei L-Shop bestellt' },
  geliefert: { stufe: 'geliefert', text: 'geliefert' }, Lager: { stufe: 'lager', text: 'im Lager' },
};
/** KS3-1: Wer ist schon mit einer Korb-Zeile verknuepft? Verweis = Korb-Schluessel, Position nicht entfernt. -> Map Schluessel -> { ids, menge } */
export function korbVerknuepfungen(positionen) {
  const je = new Map();
  for (const p of positionen ?? []) {
    const v = t(p.Verweis);
    if (!v || t(p.Entfernt) || !VERWEIS_KORB.test(v)) continue;
    const e = je.get(v) ?? { ids: [], menge: 0 };
    e.ids.push(t(p.Position_ID));
    e.menge += Number(t(p.Menge)) || 0;
    je.set(v, e);
  }
  return je;
}

/**
 * Passende Quellen fuer EINEN Eintrag (gleiche L-Shop-ArticleNr): Korb-Zeilen der letzten 60 Tage (nicht herausgenommen),
 * Positionen anderer Auftraege desselben Kunden, Lagerbestand. Keine Namen, nur Schluessel/Nummern/Status/Ort.
 * @param {object} o
 * @param {object} o.eintrag
 * @param {object[]} o.korb        Korb-Zeilen (Spaltennamen)
 * @param {object[]} o.auftraege   Auftraege (alle)
 * @param {object[]} o.positionen  Auftrag_Positionen (alle)
 * @param {string} o.kundenNr      Kunde des Zugangs
 * @param {Map<string, {ort, menge}[]>} o.lager  "LS:<nr>" -> Bestand je Ort (> 0)
 * @param {string[]} o.ohneAuftraege  AU-Nummern, die nicht vorgeschlagen werden (die Termin-Auftraege selbst)
 */
export function verknuepfKandidaten({ eintrag, korb, auftraege, positionen, kundenNr, lager, ohneAuftraege = [], jetzt }) {
  const nr = t(eintrag?.LShop_ArticleNr);
  if (t(eintrag?.Art) !== E_ART.ARTIKEL || !/^\d{10}$/.test(nr)) return [];
  const ab = berlinDatum(new Date(new Date(jetzt).getTime() - KANDIDAT_TAGE * 86400000));
  const aus = [];
  const verkn = korbVerknuepfungen(positionen);
  for (const k of korb ?? []) {
    if (t(k.LShop_ArticleNr) !== nr || !KORB_KANDIDAT.includes(t(k.Status))) continue;
    // KS3-1: Zeilen aus Shop-Bestellungen gehoeren einem Shop-Kunden - nie als "schon bestellt" fuer die Bestellseite vorschlagen
    if (t(k.Herkunft) === 'shop') continue;
    const tag = (t(k.Status_Datum) || t(k.Angelegt)).slice(0, 10);
    if (tag && tag < ab) continue;
    const ref = /^AU-\d{4}-\d{4}$/.test(t(k.Referenz)) ? ` · ${t(k.Referenz)}` : '';
    const st = KORB_STUFE[t(k.Status)];
    const menge = Number(t(k.Menge)) || 0;
    const v = verkn.get(t(k.Schluessel));
    aus.push({ art: 'korb', verweis: t(k.Schluessel), herkunft: HERKUNFT.VORHANDEN, menge, status: t(k.Status), stufe: st.stufe, stufeText: st.text,
      ...(v ? { verknuepftMit: v.ids, verknuepftMenge: v.menge } : {}),
      text: `Korb ${t(k.Schluessel)} · ${st.text} · ${menge} Stück${t(k.Bestell_ID) ? ` · ${t(k.Bestell_ID)}` : ''}${ref}`
        + (v ? ` · bereits verknüpft mit ${v.ids.join(', ')} (${v.menge} von ${menge} Stück)` : '') });
  }
  const auJe = new Map((auftraege ?? []).map(a => [a.Auftrag_Nr, a]));
  for (const p of positionen ?? []) {
    const a = auJe.get(p.Auftrag_Nr);
    if (!a || a.Kunden_Nr !== t(kundenNr) || a.Status === STORNIERT || t(p.Entfernt) || ohneAuftraege.includes(a.Auftrag_Nr)) continue;
    if (t(p.LShop_ArticleNr) !== nr) continue;
    aus.push({ art: 'auftrag', verweis: t(p.Position_ID), herkunft: HERKUNFT.VORHANDEN, menge: Number(t(p.Menge)) || 0,
      text: `${t(p.Position_ID)} · ${a.Status}${t(p.Korb_Schluessel) ? ` · Korb ${t(p.Korb_Schluessel)}` : ''}` });
  }
  for (const l of lager?.get(`LS:${nr}`) ?? []) {
    if (!(l.menge > 0)) continue;
    aus.push({ art: 'lager', verweis: `LAGER:${l.ort}`, herkunft: HERKUNFT.LAGER, lagerOrt: l.ort, menge: l.menge, text: `Lager ${l.ort}: ${l.menge} da` });
  }
  return aus;
}

/**
 * Wahl aus MC pruefen: { verweis } muss einer der Kandidaten sein, oder { ohne: true, notiz } (Pflicht, <= 100).
 * @returns {{ herkunft, verweis, lagerOrt }}
 */
export function verknuepfungAus(wahl, kandidaten, eintragId) {
  if (wahl?.ohne) {
    const n = ein(wahl.notiz);
    if (!n) throw fehler(`Eintrag ${eintragId}: „schon vorhanden (ohne Verweis)“ braucht eine kurze Notiz.`);
    if (n.length > GRUND_MAX) throw fehler(`Eintrag ${eintragId}: Notiz höchstens ${GRUND_MAX} Zeichen.`);
    return { herkunft: HERKUNFT.VORHANDEN, verweis: `${VERWEIS_OHNE} ${n}`, lagerOrt: '' };
  }
  const k = (kandidaten ?? []).find(x => x.verweis === t(wahl?.verweis));
  if (!k) throw fehler(`Eintrag ${eintragId}: diese Quelle passt nicht (mehr) – bitte neu wählen.`, 409, 'kandidat');
  return { herkunft: k.herkunft, verweis: k.verweis, lagerOrt: k.lagerOrt ?? '', ...(k.art === 'korb' ? { korbMenge: k.menge, korbVerknuepft: k.verknuepftMenge ?? 0 } : {}) };
}

// ── Uebernehmen ──────────────────────────────────────────────────────────────

/**
 * Ziel-Auftrag des Termins: gewaehlt (ziel = AU-…, gleicher Kunde, nicht storniert, hoechstens "bestellt"), sonst der letzte
 * Termin-Auftrag bis "bestellt", sonst neu (Nachtrag, wenn der Termin schon einen Auftrag hinter "bestellt" hat).
 * @returns {{ auftrag: object|null, neu: boolean, nachtrag: boolean }}
 */
export function zielAuftrag({ zugang, termin, auftraege, ziel }) {
  const je = new Map((auftraege ?? []).map(a => [a.Auftrag_Nr, a]));
  const offenBis = a => a && a.Status !== STORNIERT && schrittIndex(a.Status) >= 0 && schrittIndex(a.Status) <= schrittIndex(ANHAENGEN_BIS);
  const liste = terminAuftraege(termin);
  if (t(ziel) && t(ziel) !== 'neu') {
    const a = je.get(t(ziel));
    if (!a) throw fehler(`Auftrag ${t(ziel)} gibt es nicht.`, 404);
    if (a.Kunden_Nr !== zugang.Kunden_Nr) throw fehler(`${a.Auftrag_Nr} gehört zu einem anderen Kunden.`, 422, 'kunde');
    if (!offenBis(a)) throw fehler(`${a.Auftrag_Nr} steht schon auf „${a.Status}“ – Positionen gehen nur bis „${ANHAENGEN_BIS}“ dazu.`, 409, 'gesperrt');
    return { auftrag: a, neu: false, nachtrag: false };
  }
  if (t(ziel) === 'neu') return { auftrag: null, neu: true, nachtrag: liste.length > 0 };
  const letzter = [...liste].reverse().map(n => je.get(n)).find(offenBis);
  if (letzter) return { auftrag: letzter, neu: false, nachtrag: false };
  return { auftrag: null, neu: true, nachtrag: liste.length > 0 };
}

/** Vorhandene Auftraege desselben Kunden zum Termin-Datum (bis "bestellt") - Wahl "an vorhandenen Auftrag anhängen". */
export function anhaengbareAuftraege({ zugang, termin, auftraege }) {
  const liste = terminAuftraege(termin);
  return (auftraege ?? []).filter(a => a.Kunden_Nr === zugang.Kunden_Nr && a.Status !== STORNIERT
    && schrittIndex(a.Status) >= 0 && schrittIndex(a.Status) <= schrittIndex(ANHAENGEN_BIS)
    && (liste.includes(a.Auftrag_Nr) || t(a.Termin) === t(termin.Datum)))
    .map(a => ({ auftragNr: a.Auftrag_Nr, status: a.Status, termin: t(a.Termin), ausTermin: liste.includes(a.Auftrag_Nr) }));
}

/**
 * Plan der Uebernahme fuer EINEN Termin.
 * @param {object} o
 * @param {object} o.zugang, o.termin
 * @param {object[]} o.eintraege   alle Eintraege (frisch gelesen)
 * @param {{id, stand}[]} o.auswahl  zu uebernehmende geprüfte Eintraege (Stand wie gesehen)
 * @param {object[]} o.auftraege, o.positionen
 * @param {Map<string,{motiv}>} o.motivJe   Auswahl-ID (WC-Variation bzw. ArticleNr) -> Motiv-Text (Produktname · Design)
 * @param {Set<string>} o.waehlbar  bestellbare ArticleNr (ohne ausgelaufen/3/6)
 * @param {Map<string,{herkunft, verweis, lagerOrt}>} o.verknuepft  Eintrag_ID -> gepruefte Verknuepfung
 * @returns {{ auftragNr, auftragNeu, positionenNeu, eintragFelder: {eintrag, felder, trikot?}[], trikots, terminAuftragNr, hinweise, anzahl }}
 */
export function uebernahmePlan({ zugang, termin, eintraege, auswahl, auftraege, positionen, motivJe = new Map(), waehlbar = new Set(), verknuepft = new Map(), ziel, vorgang, jetzt }) {
  if (!termin || termin.Zugang_ID !== zugang.Zugang_ID) throw fehler('Termin gibt es auf dieser Bestellseite nicht.', 404);
  const liste = Array.isArray(auswahl) ? auswahl : [];
  if (!liste.length) throw fehler('Keine geprüften Einträge gewählt.');
  const gewaehlt = liste.map(w => {
    const e = (eintraege ?? []).find(x => x.Eintrag_ID === t(w?.id) && x.Zugang_ID === zugang.Zugang_ID);
    if (!e || e.Termin_ID !== termin.Termin_ID) throw fehler(`Eintrag ${t(w?.id)} gehört nicht zu diesem Termin.`, 404);
    if (t(w?.stand) !== t(e.Stand)) throw fehler(`Eintrag ${e.Eintrag_ID} wurde inzwischen geändert – bitte neu laden.`, 409, 'konflikt');
    if (t(e.Status) !== E_STATUS.GEPRUEFT) throw fehler(`Eintrag ${e.Eintrag_ID} ist nicht „geprüft“ (${t(e.Status) || 'eingegangen'}).`, 409, 'nicht_geprueft');
    return e;
  });
  const iso = new Date(jetzt).toISOString(), tag = berlinDatum(new Date(jetzt));
  const z = zielAuftrag({ zugang, termin, auftraege, ziel });
  const nr = z.auftrag ? z.auftrag.Auftrag_Nr : naechsteAuftragNr(auftraege, tag.slice(0, 4));
  const auftragNeu = z.neu ? {
    ...Object.fromEntries(AUFTRAG_SPALTEN.map(s => [s, ''])), Auftrag_Nr: nr, Kunden_Nr: zugang.Kunden_Nr,
    Kurztitel: `Bestellseite ${zugang.Zugang_ID} · Termin ${tm(termin.Datum)}${z.nachtrag ? ' · Nachtrag' : ''}`, Kanal: KANAL,
    Status: 'Anfrage', Termin: t(termin.Datum), Anfrage_Am: tag, Angelegt: iso, Stand: iso, Vorgang: `KS3-${t(vorgang)}`,
    Zugang_ID: zugang.Zugang_ID, Termin_ID: termin.Termin_ID,
  } : null;

  const gruppen = new Map();   // gleiche Variante (+ gleiche Herkunft/Verweis) = eine Position
  const trikots = [];
  const hinweise = [];
  const eintragFelder = [];
  let frei = 0;
  for (const e of gewaehlt) {
    const art = t(e.Art);
    const v = verknuepft.get(e.Eintrag_ID) ?? null;
    if (art === E_ART.TRIKOT) {
      if (v) throw fehler(`Eintrag ${e.Eintrag_ID}: Trikots laufen über die Trikot-Seite, nicht „schon bestellt“.`);
      trikots.push({ eintragId: e.Eintrag_ID, produktId: t(e.Trikot_Produkt), groesse: t(e.Groesse), name: t(e.Trikot_Name), nummer: t(e.Trikot_Nummer), notiz: t(e.Wunsch) });
      eintragFelder.push({ eintrag: e, felder: { Status: E_STATUS.UEBERNOMMEN, Auftrag_Nr: nr, Stand: iso }, trikot: trikots.length - 1 });
      continue;
    }
    let pos;
    const menge = Number(t(e.Menge)) || 0;
    if (menge < 1) throw fehler(`Eintrag ${e.Eintrag_ID}: Menge fehlt.`);
    const articleNr = t(e.LShop_ArticleNr);
    const lshop = art === E_ART.ARTIKEL && /^\d{10}$/.test(articleNr) && (waehlbar.has(articleNr) || (v && v.herkunft !== HERKUNFT.BESTELLEN));
    if (lshop) {
      const auswahlId = t(e.WC_Variation_ID) || articleNr;
      const herkunft = v?.herkunft ?? HERKUNFT.BESTELLEN;
      pos = { key: `L|${auswahlId}|${herkunft}|${v?.verweis ?? ''}`, Art: ART.LSHOP, LShop_ArticleNr: articleNr, Freitext: '',
        Motiv: kurz(t(motivJe.get(auswahlId)?.motiv), MOTIV_MAX), Herkunft: herkunft, Lager_Ort: v?.lagerOrt ?? '', Verweis: v?.verweis ?? '' };
    } else {
      if (v?.herkunft === HERKUNFT.LAGER) throw fehler(`Eintrag ${e.Eintrag_ID}: ohne L-Shop-Nummer geht „aus Lager“ nicht.`);
      if (art === E_ART.ARTIKEL && articleNr && !waehlbar.has(articleNr)) hinweise.push(`${e.Eintrag_ID}: L-Shop-Nummer nicht (mehr) bestellbar – als freie Position.`);
      const text = art === E_ART.EXTRA ? ein(e.Freitext) : [ein(e.Bezeichnung), ein(e.Groesse)].filter(Boolean).join(' · ');
      const freitext = kurz(text || 'Position aus Bestellseite', FREITEXT_MAX);
      pos = { key: `F|${art}|${t(e.WC_Variation_ID) || freitext}|${v?.verweis ?? ''}`, Art: ART.FREI, LShop_ArticleNr: '', Freitext: freitext,
        Motiv: '', Herkunft: v ? HERKUNFT.VORHANDEN : '', Lager_Ort: '', Verweis: v?.verweis ?? '' };
      frei++;
    }
    // Extras nie zusammenfassen (jeder Text eigen); Artikel gleicher Variante + Herkunft + Verweis schon.
    const key = art === E_ART.EXTRA ? `${pos.key}|${e.Eintrag_ID}` : pos.key;
    if (!gruppen.has(key)) gruppen.set(key, { ...pos, Menge: 0, eintraege: [] });
    const g = gruppen.get(key);
    g.Menge += menge;
    g.eintraege.push(e);
  }
  const bisher = [...(positionen ?? [])];
  const positionenNeu = [];
  for (const g of gruppen.values()) {
    const id = naechstePositionId([...bisher, ...positionenNeu], nr);
    positionenNeu.push({
      ...Object.fromEntries(POSITION_SPALTEN.map(s => [s, ''])),
      Position_ID: id, Auftrag_Nr: nr, Art: g.Art, LShop_ArticleNr: g.LShop_ArticleNr, Freitext: g.Freitext, Menge: String(g.Menge),
      Motiv: g.Motiv, Druck: '', Notiz: '', Stand: iso, Herkunft: g.Herkunft, Lager_Ort: g.Lager_Ort, Verweis: g.Verweis,
    });
    for (const e of g.eintraege) eintragFelder.push({ eintrag: e, felder: { Status: E_STATUS.UEBERNOMMEN, Auftrag_Nr: nr, Position_ID: id, Stand: iso } });
  }
  if (frei) hinweise.push(`${frei} Einträge ohne bestellbare L-Shop-Nummer bzw. Extras als freie Position(en).`);
  // KS3-1: Mengen-Schutz (nur Hinweis, kein Sperren): mehr mit einer Korb-Zeile verknuepft, als darin steht?
  const jeKorb = new Map();
  for (const g of gruppen.values()) {
    if (!VERWEIS_KORB.test(g.Verweis)) continue;
    const v = [...verknuepft.values()].find(x => x.verweis === g.Verweis);
    const e = jeKorb.get(g.Verweis) ?? { neu: 0, vorher: v?.korbVerknuepft ?? 0, menge: v?.korbMenge ?? 0 };
    e.neu += g.Menge;
    jeKorb.set(g.Verweis, e);
  }
  for (const [schluessel, e] of jeKorb) {
    if (e.menge && e.vorher + e.neu > e.menge) hinweise.push(`Korb ${schluessel}: verknüpft ${e.vorher + e.neu} Stück, in der Zeile stehen ${e.menge}.`);
  }
  const terminAlt = terminAuftraege(termin);
  const terminAuftragNr = terminAlt.includes(nr) ? null : [...terminAlt, nr].join(', ');
  return { auftragNr: nr, auftragNeu, nachtrag: z.nachtrag, positionenNeu, eintragFelder, trikots, terminAuftragNr, hinweise, anzahl: gewaehlt.length };
}

// ── Zahlen und Anzeige ───────────────────────────────────────────────────────

/** Dashboard: ungeprüfte Eintraege (Status eingegangen) je Zugang - nur Zahlen und Zugang-IDs. */
export function ungepruefteZahlen(eintraege) {
  const je = new Map();
  for (const e of eintraege ?? []) {
    if ((t(e.Status) || E_STATUS.EINGEGANGEN) !== E_STATUS.EINGEGANGEN) continue;
    je.set(e.Zugang_ID, (je.get(e.Zugang_ID) ?? 0) + 1);
  }
  const jeZugang = [...je.entries()].map(([zugangId, anzahl]) => ({ zugangId, anzahl })).sort((a, b) => b.anzahl - a.anzahl);
  return { zahl: jeZugang.reduce((s, x) => s + x.anzahl, 0), jeZugang };
}

/** Auftragsansicht: je Position die Eintraege (Kürzel, Notiz, Menge) - nur Anzeige in MC, nie kopiert. */
export function eintraegeJePosition(eintraege, auftragNr) {
  return (eintraege ?? []).filter(e => terminAuftraege({ Auftrag_Nr: e.Auftrag_Nr }).includes(t(auftragNr)) && t(e.Status) === E_STATUS.UEBERNOMMEN)
    .map(e => ({ eintragId: e.Eintrag_ID, positionId: t(e.Position_ID), zugangId: e.Zugang_ID, terminId: e.Termin_ID, art: t(e.Art),
      kuerzel: t(e.Kuerzel), notiz: t(e.Notiz), menge: Number(t(e.Menge)) || 0, groesse: t(e.Groesse),
      trikotName: t(e.Trikot_Name), trikotNummer: t(e.Trikot_Nummer), wunsch: t(e.Wunsch) }));
}
