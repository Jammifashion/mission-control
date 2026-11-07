// KS4: Stand je Eintrag der Bestellseite - reine Logik ohne Netz. Lesen in lib/bestellStand.js.
//
// Schritte (Inhaber 07.11.): eingegangen → geprüft → übernommen → bestellt → lieferbar / ca. KW nn / Rückstand → bei uns → fertig → geliefert (KS4-1: "fertig" statt "gedruckt").
// Trikots: übernommen → beim Produzenten → bei uns → geliefert. "schon vorhanden" (ohne Korb-Verweis): ab übernommen direkt "bei uns".
// Quellen: AU-Position (Fertig = fertig, Versendet = geliefert, KS4 0.2), Korb (Status, Liefertermin/AB_Hinweis aus BO4i),
// Rueckstandsliste RS1 (KW), Lieferbarkeit BO7, Trikot-Zeile (Charge, Bestellt_Am, Geliefert_Am, Status), Eintrag `Geliefert_Am` (Trikots).
// Die Seite bekommt NUR `standFuerSeite` (Schritt, Text, Datum, Woche) - nie Lieferant, Nummern, Quelle, Preise.

import { korbSchluesselVon, HERKUNFT, ART } from './auftraege.js';

const t = v => String(v ?? '').trim();
const TAG = /^\d{4}-\d{2}-\d{2}/;
const tag = v => (TAG.test(t(v)) ? t(v).slice(0, 10) : '');
/** "TT.MM.JJJJ" (Trikot-Reiter, FORMATTED) oder JJJJ-MM-TT -> JJJJ-MM-TT. */
export function tagAus(v) {
  const s = t(v);
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : tag(s);
}

/** ISO-Kalenderwoche eines Tages (JJJJ-MM-TT) -> { kw, jahr }. */
export function isoWoche(ymd) {
  if (!TAG.test(t(ymd))) return null;
  const d = new Date(`${t(ymd).slice(0, 10)}T12:00:00Z`);
  const wt = (d.getUTCDay() + 6) % 7;   // Mo = 0
  d.setUTCDate(d.getUTCDate() - wt + 3);   // Donnerstag dieser Woche
  const jahr = d.getUTCFullYear();
  const vier = new Date(Date.UTC(jahr, 0, 4, 12));   // der 4. Januar liegt immer in KW 1
  return { kw: 1 + Math.round(((d - vier) / 864e5 - 3 + ((vier.getUTCDay() + 6) % 7)) / 7), jahr };
}
/** Montag einer ISO-Woche -> JJJJ-MM-TT (fuer "nach dem Termin": vorsichtig der frueheste Tag der Woche). */
export function montagDerWoche(kw, jahr) {
  const vier = new Date(Date.UTC(jahr, 0, 4, 12));
  const mo = new Date(vier.getTime() - ((vier.getUTCDay() + 6) % 7) * 864e5 + (kw - 1) * 7 * 864e5);
  return mo.toISOString().slice(0, 10);
}

// Schritte und feste Texte (kundensichtbar - Freigabe Inhaber).
export const SCHRITT_TEXT = {
  eingegangen: 'eingegangen', geprueft: 'geprüft', uebernommen: 'übernommen', bestellt: 'bestellt', unterwegs: 'unterwegs',
  beiUns: 'bei uns', fertig: 'fertig', geliefert: 'geliefert', produzent: 'beim Produzenten', abgelehnt: 'abgelehnt', storniert: 'storniert',
};
export const WEGE = {
  bestellen: ['eingegangen', 'geprueft', 'uebernommen', 'bestellt', 'unterwegs', 'beiUns', 'fertig', 'geliefert'],
  vorhanden: ['eingegangen', 'geprueft', 'uebernommen', 'beiUns', 'fertig', 'geliefert'],
  frei: ['eingegangen', 'geprueft', 'uebernommen', 'fertig', 'geliefert'],
  trikot: ['eingegangen', 'geprueft', 'uebernommen', 'produzent', 'beiUns', 'geliefert'],
};
export const LIEFERBAR = 'lieferbar';
export const RUECKSTAND = 'Rückstand';
export const kwText = kw => `ca. KW ${kw}`;
export const SPAET_TEXT = kw => `kommt voraussichtlich erst KW ${kw} – wir melden uns`;
const KORB_BESTELLT = ['bestellt', 'bestätigt'];
const BO7_RUECKSTAND = ['null', 'auslauf_null', 'nicht_gefuehrt'];

/**
 * RS1-Positionen (leseRueckstand().positionen) -> Map Korb-Schluessel -> { stufe, kw, jahr } (spaeteste KW, dringlichste Stufe).
 */
export function rueckstandJeKorb(positionen) {
  const rang = { klaerung: 4, unbekannt: 3, kw: 2, sofort: 1 };
  const je = new Map();
  for (const p of positionen ?? []) {
    const kws = (p.teile ?? []).filter(x => x.kw && x.jahr).map(x => ({ kw: x.kw, jahr: x.jahr }));
    for (const s of p.korbSchluessel ?? []) {
      const alt = je.get(s) ?? { stufe: p.stufe, kw: null, jahr: null };
      if ((rang[p.stufe] ?? 0) > (rang[alt.stufe] ?? 0)) alt.stufe = p.stufe;
      for (const k of kws) if (!alt.jahr || k.jahr * 100 + k.kw > alt.jahr * 100 + alt.kw) Object.assign(alt, k);
      je.set(s, alt);
    }
  }
  return je;
}

/**
 * Lieferinfo einer bestellten Korb-Zeile: RS1 (aktuellste Liste) vor AB-Liefertermin vor BO7.
 * @returns {{ text, erwartet?, kw?, quelle }|null}  erwartet = Tag, ab dem die Ware fruehestens kommt (fuer "nach dem Termin")
 */
export function lieferInfo({ korb, rs, lfb }) {
  if (rs) {
    if (rs.stufe === 'sofort') return { text: LIEFERBAR, quelle: 'Rückstandsliste' };
    if (rs.kw && rs.jahr) return { text: `${RUECKSTAND} – ${kwText(rs.kw)}`, erwartet: montagDerWoche(rs.kw, rs.jahr), kw: rs.kw, quelle: 'Rückstandsliste' };
    return { text: RUECKSTAND, quelle: 'Rückstandsliste' };
  }
  const lt = tag(korb?.Liefertermin);
  if (lt) { const w = isoWoche(lt); return { text: kwText(w.kw), erwartet: lt, kw: w.kw, quelle: 'AB' }; }
  if (t(korb?.AB_Hinweis)) return { text: LIEFERBAR, quelle: 'AB' };
  if (lfb?.stufe === 'lieferbar') return { text: LIEFERBAR, quelle: 'Lieferbarkeit' };
  if (BO7_RUECKSTAND.includes(lfb?.stufe)) return { text: RUECKSTAND, quelle: 'Lieferbarkeit' };
  return null;
}

/** Weg einer Auftragsposition: bestellen (🛒 / Verweis auf Korb) · vorhanden (Lager, ohne Verweis) · frei. */
function wegUndKorb(pos, posJe) {
  const h = t(pos.Herkunft) || (pos.Art === ART.LSHOP ? HERKUNFT.BESTELLEN : '');
  const k = korbSchluesselVon(pos);
  if (k) return { weg: 'bestellen', korbKey: k };
  if (h === HERKUNFT.BESTELLEN) return { weg: 'bestellen', korbKey: '' };   // noch nicht an den Korb uebergeben
  if (h === HERKUNFT.LAGER) return { weg: 'vorhanden', beiUns: !!t(pos.Lager_Buchung) };
  if (h === HERKUNFT.VORHANDEN) {
    const v = t(pos.Verweis);
    // Verweis auf eine andere Auftragsposition (AU-…-NN): deren Ware zaehlt (eine Ebene, KS4 Verschieben)
    const ref = /^AU-\d{4}-\d{4}-\d+$/.test(v) ? posJe.get(v) : null;
    if (ref && ref !== pos) {
      const r = wegUndKorb({ ...ref, Verweis: /^AU-/.test(t(ref.Verweis)) ? '' : ref.Verweis }, posJe);
      return r.weg === 'frei' ? { weg: 'vorhanden', beiUns: true } : r;
    }
    return { weg: 'vorhanden', beiUns: true };   // Lager-Ort, "ohne Verweis", fremde Ware: schon bei uns
  }
  return { weg: 'frei' };
}

/**
 * Stand EINES Eintrags (MC-Form, mit internen Angaben in `intern`).
 * @param {object} e  Eintrag (Spaltennamen)
 * @param {object} ctx { posJe: Map Position_ID->Position, korbJe, rsJe, lfbJe, trikotJe: Map Zeilen-ID -> {charge, bestelltAm, geliefertAm, status}, terminDatum }
 * @returns {{ schritt, text, datum, spaet, kw, weg, schritte: {schritt, text, erreicht}[], intern }}
 */
export function standFuer(e, ctx = {}) {
  const st = t(e.Status) || 'eingegangen';
  const aus = (weg, schritt, { datum = '', text, info = null, intern = {} } = {}) => {
    const liste = WEGE[weg] ?? WEGE.frei;
    const i = liste.indexOf(schritt);
    const spaet = !!(info?.erwartet && TAG.test(t(ctx.terminDatum)) && info.erwartet > t(ctx.terminDatum));
    return {
      schritt, text: text ?? SCHRITT_TEXT[schritt], datum, spaet, kw: info?.kw ?? null, weg,
      schritte: liste.map((s, j) => ({ schritt: s, text: s === 'unterwegs' ? (j === i && info ? info.text : 'lieferbar / Rückstand') : SCHRITT_TEXT[s], erreicht: i >= 0 && j <= i })),
      intern: { ...intern, ...(info ? { quelle: info.quelle } : {}) },
    };
  };
  const art = t(e.Art);
  const wegArt = art === 'trikot' ? 'trikot' : 'bestellen';
  if (st === 'storniert') return { ...aus(wegArt, t(e.Ablehn_Grund) ? 'abgelehnt' : 'storniert'), schritte: [] };
  if (st === 'eingegangen') return aus(wegArt, 'eingegangen', { datum: tag(e.Zeit) });
  if (st === 'geprüft') return aus(wegArt, 'geprueft');
  // ab hier übernommen
  if (art === 'trikot') {
    if (tag(e.Geliefert_Am)) return aus('trikot', 'geliefert', { datum: tag(e.Geliefert_Am) });
    const z = ctx.trikotJe?.get(t(e.Position_ID));
    if (!z) return aus('trikot', 'uebernommen');
    const s = t(z.status).toLowerCase();
    if (s === 'ok' || (tagAus(z.geliefertAm) && s !== 'ersetzt')) return aus('trikot', 'beiUns', { datum: tagAus(z.geliefertAm), intern: { trikot: s || 'da' } });
    if (t(z.charge)) return aus('trikot', 'produzent', { datum: tagAus(z.bestelltAm), intern: { trikot: s || 'bestellt' } });
    return aus('trikot', 'uebernommen');
  }
  const pos = ctx.posJe?.get(t(e.Position_ID));
  if (!pos) return aus('frei', 'uebernommen', { intern: { position: 'fehlt' } });
  const w = wegUndKorb(pos, ctx.posJe ?? new Map());
  if (tag(pos.Versendet)) return aus(w.weg, 'geliefert', { datum: tag(pos.Versendet) });
  // KS4-1: "fertig" NUR aus dem Haken Fertig der Auftragsposition (setzt nur der Mensch)
  if (t(pos.Fertig) === 'ja') return aus(w.weg, 'fertig', { datum: tag(pos.Fertig_Am) });
  if (w.weg === 'vorhanden') return aus('vorhanden', w.beiUns ? 'beiUns' : 'uebernommen');
  if (w.weg === 'frei') return aus('frei', 'uebernommen');
  const korb = w.korbKey ? ctx.korbJe?.get(w.korbKey) : null;
  const ks = t(korb?.Status);
  const intern = { korb: korb ? (ks === 'abgewählt' ? 'herausgenommen' : ks) : (w.korbKey ? 'fehlt' : 'nicht übergeben') };
  if (['geliefert', 'Lager'].includes(ks)) return aus('bestellen', 'beiUns', { datum: tag(korb.Status_Datum), intern });
  if (KORB_BESTELLT.includes(ks)) {
    const info = lieferInfo({ korb, rs: ctx.rsJe?.get(w.korbKey), lfb: ctx.lfbJe?.get(t(pos.LShop_ArticleNr)) });
    return info ? aus('bestellen', 'unterwegs', { text: info.text, info, intern }) : aus('bestellen', 'bestellt', { datum: tag(korb.Status_Datum), intern });
  }
  return aus('bestellen', 'uebernommen', { intern });
}

/** Nur das, was die Leute vor Ort sehen: Schritt, Text, Datum, Hinweis "nach dem Termin". Keine Quelle, keine Nummern. */
export function standFuerSeite(s) {
  if (!s) return null;
  return {
    schritt: s.schritt, text: s.text, datum: s.datum, ...(s.spaet && s.kw ? { hinweis: SPAET_TEXT(s.kw) } : {}),
    schritte: s.schritte.map(x => ({ text: x.text, erreicht: x.erreicht })),
  };
}

/** Summe je Termin (nur Zahlen): gesamt = nicht stornierte, beiUns = ab "bei uns", fertig = ab "fertig" (KS4-1, vorher "gedruckt"). */
export function standSumme(staende) {
  const l = (staende ?? []).filter(s => s && !['abgelehnt', 'storniert'].includes(s.schritt));
  const ab = (s, schritt) => { const liste = WEGE[s.weg] ?? []; return liste.includes(schritt) ? liste.indexOf(s.schritt) >= liste.indexOf(schritt)
    : schritt === 'beiUns' && ['fertig', 'geliefert'].includes(s.schritt); };
  return { gesamt: l.length, beiUns: l.filter(s => ab(s, 'beiUns')).length, fertig: l.filter(s => ab(s, 'fertig')).length };
}
