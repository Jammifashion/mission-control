// Auftraege (AM-2), reine Logik ohne Netz. Reiter `Auftraege` und `Auftrag_Positionen` im SSOT, nur mit Kunden_Nr -
// keine Personendaten (Namen kommen nur in der Oberflaeche aus dem Kunden-Sheet dazu). Keine Preise.
// Lesen/Schreiben in lib/auftraege.js.

import { berlinDatum } from './berlin-tag.js';
import { euroZahl, ustAus, rabattAus, rabattZelle, UST_STANDARD, AUFPREIS_AB_STANDARD, ZUSTAENDIG } from './auftrag-preise.js';

export const TAB_AUFTRAEGE = 'Auftraege';
export const TAB_POSITIONEN = 'Auftrag_Positionen';

// Spalten wie Bericht AM-0 2.1; hinten additiv (AM-2): Storniert_Am, Vorgang (Doppelklick-Schutz beim Anlegen).
export const AUFTRAG_SPALTEN = [
  'Auftrag_Nr', 'Kunden_Nr', 'Kurztitel', 'Kanal', 'Status', 'Termin',
  'Anfrage_Am', 'Angebot_Am', 'Bestellt_Am', 'Produktion_Am', 'Fertig_Am', 'Uebergeben_Am', 'Bezahlt_Am',
  'Notiz', 'Anfrage_ID', 'Lexoffice_Angebot', 'Lexoffice_Rechnung', 'Angelegt', 'Stand', 'Storniert_Am', 'Vorgang',
];
// Hinten additiv (AM-2): Entfernt = Datum, an dem die Position aus dem Auftrag genommen wurde (Zeilen werden nie geloescht).
export const POSITION_SPALTEN = [
  'Position_ID', 'Auftrag_Nr', 'Art', 'LShop_ArticleNr', 'Freitext', 'Menge', 'Motiv', 'Druck', 'Notiz',
  'Korb_Schluessel', 'Lager_Ziel', 'Fertig', 'Fertig_Am', 'Versendet', 'Stand', 'Entfernt',
];
// AM-2-2: optional ganz hinten - fehlen sie, gilt Herkunft "bestellen" (wie vor AM-2-2). Setup ergaenzt sie.
// AM-5: Preisfelder je Position (netto, Euro als Zahl), hinten optional. Fehlen sie, werden keine Preise geschrieben (409).
export const PREIS_SPALTEN = ['Preis_Netto', 'Aufpreis_Netto', 'Aufpreis_Ab', 'USt_Satz', 'EK_Hand'];
export const POSITION_OPTIONAL = ['Herkunft', 'Lager_Ort', 'Lager_Buchung', ...PREIS_SPALTEN];
// AM-3: optional ganz hinten in Auftraege - Datum des Schritts "Design" (leer = Schritt nicht genutzt / uebersprungen).
// AMQ1: Preis_Eingabe ("brutto" oder leer = netto; nur die Eingabe an der Position, gespeichert wird immer netto) und
// Design_Link (https-Adresse, z. B. Canva) - optional ganz hinten, Setup ergaenzt sie.
export const AUFTRAG_OPTIONAL = ['Design_Am', 'Rabatt', 'Angebot_Netto', 'Angebot_Brutto', 'Angebot_Stand', 'Zustaendig', 'Preis_Eingabe', 'Design_Link'];
export const PREIS_EINGABE = ['netto', 'brutto'];
export const DESIGN_LINK_MAX = 500;
// AMQ1 (Inhaber 06.11.): Positionen sind keine Pflicht, solange man noch nicht bestellt - Pflicht erst beim Wechsel auf
// "bestellt" (dann wird Ware bestellt/bereitgestellt). In Angebot/Design zeigt die Oberflaeche nur einen Hinweis.
export const POSITIONEN_PFLICHT_AB = 'bestellt';
export const ANGEBOT_SPALTEN = ['Angebot_Netto', 'Angebot_Brutto', 'Angebot_Stand'];
// AM-3: Korb-Referenz und Lager-Bezug eines Auftrags = die Auftragsnummer (nie Kunde, Spitzname oder Kurztitel).
export const AU_NR_MUSTER = /^AU-\d{4}-\d{4}$/;
// Herkunft je Position: bestellen (Standard, geht mit AM-3 in den L-Shop-Korb) | lager (eigenes Lager, ausgebucht erst mit AM-3)
// | vorhanden (liegt schon bereit, nichts bestellt, nichts gebucht). Freie Positionen: leer oder vorhanden.
export const HERKUNFT = { BESTELLEN: 'bestellen', LAGER: 'lager', VORHANDEN: 'vorhanden' };
export const HERKUNFT_LSHOP = ['bestellen', 'lager', 'vorhanden'];
export const HERKUNFT_FREI = ['', 'vorhanden'];
export const AUFTRAG_TEXT = ['Auftrag_Nr', 'Kunden_Nr', 'Termin', 'Anfrage_Am', 'Angebot_Am', 'Bestellt_Am', 'Produktion_Am', 'Fertig_Am',
  'Uebergeben_Am', 'Bezahlt_Am', 'Storniert_Am'];
export const POSITION_TEXT = ['Position_ID', 'Auftrag_Nr', 'LShop_ArticleNr', 'Fertig_Am', 'Entfernt'];

export const KANAELE = ['Mail', 'WhatsApp', 'Telefon', 'persönlich', 'Jey'];
// Schritte in Reihenfolge, je Schritt sein Datumsfeld. "storniert" steht ausserhalb (Storniert_Am).
export const SCHRITTE = [
  { status: 'Anfrage', feld: 'Anfrage_Am' }, { status: 'Angebot', feld: 'Angebot_Am' }, { status: 'Design', feld: 'Design_Am' },
  { status: 'bestellt', feld: 'Bestellt_Am' },
  { status: 'in Produktion', feld: 'Produktion_Am' }, { status: 'fertig', feld: 'Fertig_Am' }, { status: 'übergeben', feld: 'Uebergeben_Am' },
  { status: 'bezahlt', feld: 'Bezahlt_Am' },
];
export const STORNIERT = 'storniert';
export const START_STATUS = ['Anfrage', 'Angebot'];
// Bis einschliesslich Angebot sind Kopf und Positionen frei; ab bestellt nur Notiz/Termin (Korb-Logik folgt mit AM-3).
export const FREI_BIS = 2;   // AM-3: bis einschliesslich Design
export const ART = { LSHOP: 'lshop', FREI: 'frei' };
export const MENGE_MAX = 9999;
export const POSITIONEN_MAX = 200;
export const MAX = { Kurztitel: 80, Notiz: 1000, Motiv: 120, Druck: 120, PosNotiz: 300, Freitext: 120 };
/** AMQ1: Design-Link nur https://, ohne Leerzeichen, hoechstens DESIGN_LINK_MAX Zeichen. '' = keiner. */
export function designLinkAus(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { throw fehler('Design-Link: bitte eine vollständige Adresse mit https:// eingeben.'); }
  if (u.protocol !== 'https:' || /\s/.test(s)) throw fehler('Design-Link: nur https://-Adressen.');
  if (s.length > DESIGN_LINK_MAX) throw fehler(`Design-Link ist länger als ${DESIGN_LINK_MAX} Zeichen.`);
  return s;
}

const t = v => String(v ?? '').trim();

export function fehler(text, status = 422, code) {
  const e = new Error(text);
  e.status = status;
  if (code) e.code = code;
  return e;
}

// ── Lesen ────────────────────────────────────────────────────────────────────

/** Reiter-Werte -> { idx, zeilen: [{ ...Spalten, _zeile }], fehlt }. Nur ueber den Spaltennamen. */
export function zeilenAus(werte, spalten, schluessel, optional = []) {
  const kopf = (werte?.[0] ?? []).map(t);
  const idx = Object.fromEntries(kopf.map((k, i) => [k, i]).filter(([k]) => k));
  const fehlt = spalten.filter(s => idx[s] === undefined);
  const zeilen = [];
  (werte ?? []).slice(1).forEach((r, i) => {
    const o = Object.fromEntries([...spalten, ...optional].map(s => [s, idx[s] === undefined ? '' : t(r?.[idx[s]])]));
    if (o[schluessel]) zeilen.push({ ...o, _zeile: i + 2 });
  });
  return { idx, zeilen, fehlt };
}

// AM-5: Betrags-Spalten gehen als Zahl ins Sheet (RAW), auch wenn sie als Text gelesen wurden (z. B. beim Teilen einer Position).
const ZAHL_SPALTEN = new Set(['Preis_Netto', 'Aufpreis_Netto', 'EK_Hand', 'USt_Satz', 'Angebot_Netto', 'Angebot_Brutto', 'Rabatt']);
export const zellWert = (s, v) => (typeof v === 'number' ? v : ZAHL_SPALTEN.has(s) && /^\d+(\.\d+)?$/.test(t(v)) ? Number(t(v)) : t(v));
/** Objekt -> Sheet-Zeile in Spaltenfolge des Reiters (Breite = Kopfzeile). Pflicht- und optionale Spalten, soweit da. */
export function alsZeile(idx, obj, spalten, breite) {
  const n = breite ?? Math.max(...Object.values(idx)) + 1;
  const z = Array.from({ length: n }, () => '');
  const opt = spalten === POSITION_SPALTEN ? POSITION_OPTIONAL : spalten === AUFTRAG_SPALTEN ? AUFTRAG_OPTIONAL : [];
  for (const s of [...spalten, ...opt]) if (idx[s] !== undefined) z[idx[s]] = zellWert(s, obj[s]);
  return z;
}

// ── Nummern ──────────────────────────────────────────────────────────────────

/** AU-JJJJ-NNNN: hoechste Nummer des Jahres + 1, nie wiederverwendet. */
export function naechsteAuftragNr(auftraege, jahr) {
  const max = (auftraege ?? []).reduce((m, a) => {
    const x = new RegExp(`^AU-${jahr}-(\\d+)$`).exec(t(a.Auftrag_Nr));
    return x ? Math.max(m, Number(x[1])) : m;
  }, 0);
  return `AU-${jahr}-${String(max + 1).padStart(4, '0')}`;
}
/** AU-JJJJ-NNNN-NN: hoechste Positionsnummer des Auftrags + 1 (+ versatz), auch entfernte zaehlen. */
export function naechstePositionId(positionen, auftragNr, versatz = 0) {
  const max = (positionen ?? []).filter(p => p.Auftrag_Nr === auftragNr).reduce((m, p) => {
    const x = /-(\d+)$/.exec(t(p.Position_ID).slice(auftragNr.length));
    return x ? Math.max(m, Number(x[1])) : m;
  }, 0);
  return `${auftragNr}-${String(max + 1 + versatz).padStart(2, '0')}`;
}

// ── Status ───────────────────────────────────────────────────────────────────

export const schrittIndex = status => SCHRITTE.findIndex(s => s.status === status);
const heute = jetzt => berlinDatum(new Date(jetzt));

/** Darf der Auftrag frei bearbeitet werden (Kopf + Positionen)? */
export const istFrei = a => a.Status !== STORNIERT && schrittIndex(a.Status) >= 0 && schrittIndex(a.Status) <= FREI_BIS;

/**
 * Statuswechsel. aktion: weiter | zurueck | bezahlt | bezahlt_zurueck | stornieren | storno_zurueck.
 * Liefert die geaenderten Felder (Status + Datumsfelder). Nicht erlaubt -> 422.
 * - weiter: naechster Schritt, Datum = heute (Berlin). bezahlt bleibt gesetzt, wenn schon da (Vorkasse).
 *   AM-3: ueberspringen = true springt von "Angebot" direkt auf "bestellt" (Design nicht genutzt, bleibt leer).
 * - zurueck: einen Schritt zurueck, Datum des bisherigen Schritts geleert (bezahlt: Bezahlt_Am geleert); ein
 *   uebersprungenes "Design" (ohne Datum) wird dabei uebergangen.
 * - bezahlt: Bezahlt_Am = heute, jederzeit (Vorkasse); steht der Auftrag auf "übergeben", wird er "bezahlt".
 * - bezahlt_zurueck: Bezahlt_Am leer; Status "bezahlt" -> "übergeben".
 * - stornieren: Status storniert + Storniert_Am (nicht bei bezahlt); storno_zurueck: letzter Schritt mit Datum.
 */
export function statusWechsel(a, aktion, jetzt, { ueberspringen = false } = {}) {
  const i = schrittIndex(a.Status);
  const tag = heute(jetzt);
  if (a.Status === STORNIERT && aktion !== 'storno_zurueck') throw fehler(`${a.Auftrag_Nr} ist storniert.`, 422, 'storniert');
  switch (aktion) {
    case 'weiter': {
      if (i < 0 || i >= SCHRITTE.length - 1) throw fehler('Kein weiterer Schritt.', 422);
      if (ueberspringen && a.Status !== 'Angebot') throw fehler('Überspringen geht nur von „Angebot“ zu „bestellt“.', 422);
      const n = SCHRITTE[i + (ueberspringen ? 2 : 1)];
      return { Status: n.status, [n.feld]: t(a[n.feld]) || tag };
    }
    case 'zurueck': {
      if (i <= 0) throw fehler('Kein Schritt zurück möglich.', 422);
      let j = i - 1;
      if (SCHRITTE[j].status === 'Design' && !t(a.Design_Am)) j -= 1;   // uebersprungenes Design uebergehen
      return { Status: SCHRITTE[j].status, [SCHRITTE[i].feld]: '' };
    }
    case 'bezahlt': {
      if (t(a.Bezahlt_Am)) throw fehler('Schon als bezahlt markiert.', 422);
      return { Bezahlt_Am: tag, ...(a.Status === 'übergeben' ? { Status: 'bezahlt' } : {}) };
    }
    case 'bezahlt_zurueck': {
      if (!t(a.Bezahlt_Am)) throw fehler('Nicht als bezahlt markiert.', 422);
      return { Bezahlt_Am: '', ...(a.Status === 'bezahlt' ? { Status: 'übergeben' } : {}) };
    }
    case 'stornieren': {
      if (a.Status === 'bezahlt') throw fehler('Ein bezahlter Auftrag wird nicht storniert.', 422);
      return { Status: STORNIERT, Storniert_Am: tag };
    }
    case 'storno_zurueck': {
      if (a.Status !== STORNIERT) throw fehler('Auftrag ist nicht storniert.', 422);
      // Letzter Schritt mit Datum (ohne bezahlt, das ist unabhaengig); sonst Anfrage.
      const letzter = [...SCHRITTE].slice(0, -1).reverse().find(s => t(a[s.feld]))?.status ?? 'Anfrage';
      return { Status: letzter, Storniert_Am: '' };
    }
    default: throw fehler('Unbekannte Aktion.', 422);
  }
}

// ── Eingaben ─────────────────────────────────────────────────────────────────

const lang = (f, w, max) => { if (w.length > max) throw fehler(`${f} ist länger als ${max} Zeichen.`); return w; };

/** Kopf pruefen (Kurztitel Pflicht, Kanal aus KANAELE, Termin JJJJ-MM-TT oder leer). Fehlertexte ohne Werte. */
export function pruefeKopf(e, { nurNotizTermin = false } = {}) {
  const aus = {};
  if (e?.Termin !== undefined) {
    const v = t(e.Termin);
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw fehler('Termin als Datum (JJJJ-MM-TT).');
    aus.Termin = v;
  }
  if (e?.Notiz !== undefined) aus.Notiz = lang('Notiz', t(e.Notiz), MAX.Notiz);
  if (e?.Rabatt !== undefined) aus.Rabatt = rabattZelle(rabattAus(e.Rabatt));   // AM-5: auch ab "bestellt" (Preise nachtragen)
  // AMQ1: auch ab "bestellt" (Preise nachtragen, Design-Link nachreichen). Preis_Eingabe "netto" = leer im Sheet.
  if (e?.Preis_Eingabe !== undefined) {
    const v = t(e.Preis_Eingabe) || 'netto';
    if (!PREIS_EINGABE.includes(v)) throw fehler('Preis-Eingabe netto oder brutto.');
    aus.Preis_Eingabe = v === 'brutto' ? 'brutto' : '';
  }
  if (e?.Design_Link !== undefined) aus.Design_Link = designLinkAus(e.Design_Link);
  if (nurNotizTermin) return aus;
  if (e?.Kurztitel !== undefined) aus.Kurztitel = lang('Kurztitel', t(e.Kurztitel).replace(/\s+/g, ' '), MAX.Kurztitel);
  if (e?.Kanal !== undefined) {
    if (t(e.Kanal) && !KANAELE.includes(t(e.Kanal))) throw fehler(`Kanal muss ${KANAELE.join(', ')} sein.`);
    aus.Kanal = t(e.Kanal);
  }
  if (e?.Kunden_Nr !== undefined) aus.Kunden_Nr = t(e.Kunden_Nr);
  return aus;
}

/**
 * Positionen pruefen. eingabe: [{ positionId?, art: lshop|frei, articleNr | freitext, menge, motiv, druck, notiz }].
 * waehlbar: Set der ArticleNr, die neu gewaehlt werden duerfen (ohne ausgelaufen/3/6); bisherige Nummern bleiben erlaubt.
 */
export function pruefePositionen(eingabe, { waehlbar, bisher = new Set(), orte = null, leerErlaubt = false } = {}) {
  const liste = Array.isArray(eingabe) ? eingabe : [];
  if (!liste.length && !leerErlaubt) throw fehler('Mindestens eine Position.');
  if (liste.length > POSITIONEN_MAX) throw fehler(`Höchstens ${POSITIONEN_MAX} Positionen.`);
  return liste.map((p, i) => {
    const nr = i + 1;
    const art = t(p?.art);
    const menge = Number(p?.menge);
    if (!Number.isInteger(menge) || menge < 1 || menge > MENGE_MAX) throw fehler(`Position ${nr}: Menge ganze Zahl 1–${MENGE_MAX}.`);
    const neben = {
      Motiv: lang(`Position ${nr}: Motiv`, t(p?.motiv), MAX.Motiv), Druck: lang(`Position ${nr}: Druck`, t(p?.druck), MAX.Druck),
      Notiz: lang(`Position ${nr}: Notiz`, t(p?.notiz), MAX.PosNotiz),
      ...preisFelder(p, art, nr),
    };
    if (art === ART.LSHOP) {
      const a = t(p?.articleNr);
      if (!/^\d{10}$/.test(a)) throw fehler(`Position ${nr}: L-Shop-Nummer muss 10 Ziffern haben.`);
      if (!bisher.has(a) && !waehlbar?.has(a)) throw fehler(`Position ${nr}: L-Shop-Nummer nicht (mehr) bestellbar.`, 422, 'nicht_waehlbar');
      const herkunft = t(p?.herkunft) || HERKUNFT.BESTELLEN;
      if (!HERKUNFT_LSHOP.includes(herkunft)) throw fehler(`Position ${nr}: Herkunft bestellen, lager oder vorhanden.`);
      const ort = herkunft === HERKUNFT.LAGER ? t(p?.lagerOrt) : '';
      if (herkunft === HERKUNFT.LAGER && !ort) throw fehler(`Position ${nr}: Lagerort fehlt.`);
      if (ort && orte && !orte.includes(ort)) throw fehler(`Position ${nr}: Lagerort gibt es nicht (mehr).`);
      return { positionId: t(p?.positionId), Art: ART.LSHOP, LShop_ArticleNr: a, Freitext: '', Menge: String(menge), ...neben, Herkunft: herkunft, Lager_Ort: ort };
    }
    if (art === ART.FREI) {
      const f = lang(`Position ${nr}: Freitext`, t(p?.freitext), MAX.Freitext);
      if (!f) throw fehler(`Position ${nr}: Freitext fehlt.`);
      const herkunft = t(p?.herkunft);
      if (!HERKUNFT_FREI.includes(herkunft)) throw fehler(`Position ${nr}: freie Position nur leer oder vorhanden.`);
      return { positionId: t(p?.positionId), Art: ART.FREI, LShop_ArticleNr: '', Freitext: f, Menge: String(menge), ...neben, Herkunft: herkunft, Lager_Ort: '' };
    }
    throw fehler(`Position ${nr}: Art lshop oder frei.`);
  });
}

/**
 * AM-5: Preisfelder einer Position (netto, Euro). Leer erlaubt (Auftrag noch in Anfrage). Aufpreis nur bei L-Shop
 * ("ab" Vorbelegung 3XL), USt leer = 19 %. Werte als Zahl bzw. '' (so landen sie als Zahl im Sheet).
 */
export function preisFelder(p, art, nr) {
  const z = (v, f) => { try { const e = euroZahl(v, `Position ${nr}: ${f}`); return e === null ? '' : e; } catch (err) { throw fehler(err.message, 422, 'preis'); } };
  let ust;
  try { ust = ustAus(p?.ust); } catch (err) { throw fehler(`Position ${nr}: ${err.message}`, 422, 'preis'); }
  const aufpreis = art === ART.LSHOP ? z(p?.aufpreis, 'Aufpreis') : '';
  return {
    Preis_Netto: z(p?.preis, 'Preis'), Aufpreis_Netto: aufpreis, Aufpreis_Ab: aufpreis === '' ? '' : (t(p?.aufpreisAb) || AUFPREIS_AB_STANDARD),
    USt_Satz: ust === UST_STANDARD ? '' : ust, EK_Hand: z(p?.ekHand, 'EK'),
  };
}
/** Werden Preis-Spalten gebraucht (mind. ein Preisfeld gesetzt)? */
export const brauchtPreisSpalten = positionen => (positionen ?? []).some(p => PREIS_SPALTEN.some(f => t(p?.[f]) !== ''));
/** Zellen gleich? Zahl und Text gleicher Zahl ("12.5" / 12.5) gelten als gleich. */
const gleich = (a, b) => t(a) === t(b) || (t(a) !== '' && t(b) !== '' && Number(t(a)) === Number(t(b)));

// ── Plaene ───────────────────────────────────────────────────────────────────

/** Neuer Auftrag: Kopf + Positionen. Status Anfrage oder Angebot (Anfrage_Am immer, Angebot_Am bei Angebot). */
export function anlagePlan({ auftraege, positionen, eingabe, waehlbar, orte, jetzt }) {
  const kopf = pruefeKopf(eingabe);
  if (!kopf.Kunden_Nr) throw fehler('Kunde fehlt.');
  if (!kopf.Kurztitel) throw fehler('Kurztitel fehlt.');
  const status = t(eingabe?.status) || 'Anfrage';
  if (!START_STATUS.includes(status)) throw fehler('Start-Status Anfrage oder Angebot.');
  const pos = pruefePositionen(eingabe?.positionen, { waehlbar, orte, leerErlaubt: true });   // AMQ1: Pflicht erst ab "bestellt"
  const tag = heute(jetzt);
  const nr = naechsteAuftragNr(auftraege, tag.slice(0, 4));
  const auftrag = {
    ...Object.fromEntries(AUFTRAG_SPALTEN.map(s => [s, ''])), ...kopf, Auftrag_Nr: nr, Status: status,
    Anfrage_Am: tag, Angebot_Am: status === 'Angebot' ? tag : '', Angelegt: t(jetzt), Stand: t(jetzt), Vorgang: t(eingabe?.vorgang),
  };
  const neu = pos.map((p, i) => ({
    ...Object.fromEntries(POSITION_SPALTEN.map(s => [s, ''])), ...p,
    Position_ID: naechstePositionId(positionen, nr, i), Auftrag_Nr: nr, Stand: t(jetzt),
  }));
  return { auftrag, positionen: neu };
}

/** Aktive (nicht entfernte) Positionen eines Auftrags. */
export const aktivePositionen = (positionen, nr) => (positionen ?? []).filter(p => p.Auftrag_Nr === nr && !t(p.Entfernt));

/**
 * Bearbeiten. Frei (bis Angebot): Kopf + Positionen (vorhandene ueber positionId aendern, neue anlegen, fehlende als
 * entfernt markieren). Ab bestellt: nur Notiz/Termin; Positionen im Body -> 409 gesperrt. Storniert: nichts.
 * Liefert { aenderungAuftrag: {feld: wert}, aenderungPositionen: [{ zeile, felder }], neuePositionen: [...] }.
 */
export function bearbeitenPlan({ auftrag, positionen, eingabe, waehlbar, orte, jetzt }) {
  if (auftrag.Status === STORNIERT) throw fehler(`${auftrag.Auftrag_Nr} ist storniert.`, 409, 'storniert');
  const frei = istFrei(auftrag);
  const kopf = pruefeKopf(eingabe, { nurNotizTermin: !frei });
  if (frei && kopf.Kurztitel === '') throw fehler('Kurztitel fehlt.');
  if (frei && kopf.Kunden_Nr === '') throw fehler('Kunde fehlt.');
  const aenderungAuftrag = Object.fromEntries(Object.entries(kopf).filter(([k, v]) => !gleich(auftrag[k], v)));
  const aenderungPositionen = [], neuePositionen = [];
  if (!frei && eingabe?.positionen !== undefined) {
    // AM-5: ab "bestellt" nur Preise nachtragen/aendern - jede Position muss bleiben, wie sie ist.
    const alt = aktivePositionen(positionen, auftrag.Auftrag_Nr);
    const bisher = new Set(alt.map(p => p.LShop_ArticleNr).filter(Boolean));
    const gesperrt = () => fehler(`${auftrag.Auftrag_Nr}: ab „bestellt“ sind Positionen gesperrt – nur Preise änderbar.`, 409, 'gesperrt');
    if (!Array.isArray(eingabe.positionen) || eingabe.positionen.length !== alt.length || !alt.length) throw gesperrt();
    const pos = pruefePositionen(eingabe.positionen, { waehlbar: bisher, bisher, orte: null });
    if (pos.some(p => !p.positionId)) throw gesperrt();
    for (const p of pos) {
      const a = alt.find(x => x.Position_ID === p.positionId);
      if (!a) throw fehler(`Position ${p.positionId} gibt es in diesem Auftrag nicht (mehr) – bitte neu laden.`, 409, 'konflikt');
      if (['Art', 'LShop_ArticleNr', 'Freitext', 'Menge'].some(f => !gleich(a[f], p[f]))) throw gesperrt();
      const felder = Object.fromEntries(PREIS_SPALTEN.filter(f => !gleich(a[f], p[f])).map(f => [f, p[f]]));
      if (Object.keys(felder).length) aenderungPositionen.push({ zeile: a._zeile, positionId: a.Position_ID, felder: { ...felder, Stand: t(jetzt) } });
    }
  }
  if (frei && eingabe?.positionen !== undefined) {
    const alt = aktivePositionen(positionen, auftrag.Auftrag_Nr);
    const bisher = new Set(alt.map(p => p.LShop_ArticleNr).filter(Boolean));
    const pos = pruefePositionen(eingabe.positionen, { waehlbar, bisher, orte, leerErlaubt: true });   // AMQ1: frei = vor "bestellt"
    const gesehen = new Set();
    for (const p of pos) {
      if (p.positionId) {
        const a = alt.find(x => x.Position_ID === p.positionId);
        if (!a) throw fehler(`Position ${p.positionId} gibt es in diesem Auftrag nicht (mehr) – bitte neu laden.`, 409, 'konflikt');
        gesehen.add(a.Position_ID);
        const uebergeben = istUebergeben(a);
        // Herkunft: leer im Sheet = bestellen (L-Shop) - nur echte Aenderungen schreiben
        const herkunftAlt = t(a.Herkunft) || (a.Art === ART.LSHOP ? HERKUNFT.BESTELLEN : '');
        const felder = Object.fromEntries(['Art', 'LShop_ArticleNr', 'Freitext', 'Menge', 'Motiv', 'Druck', 'Notiz', 'Lager_Ort', ...PREIS_SPALTEN].filter(f => !gleich(a[f], p[f])).map(f => [f, p[f]]));
        if (herkunftAlt !== p.Herkunft) felder.Herkunft = p.Herkunft;
        // AM-3: an Korb/Lager uebergeben -> nur Motiv/Druck/Notiz aenderbar; sonst erst "Übergabe zurücknehmen"
        if (uebergeben && Object.keys(felder).some(f => !['Motiv', 'Druck', 'Notiz', ...PREIS_SPALTEN].includes(f))) {   // AM-5: Preise bleiben aenderbar
          throw fehler(`Position ${a.Position_ID} ist an Korb/Lager übergeben – erst „Übergabe zurücknehmen“.`, 409, 'uebergeben');
        }
        if (Object.keys(felder).length) aenderungPositionen.push({ zeile: a._zeile, positionId: a.Position_ID, felder: { ...felder, Stand: t(jetzt) } });
      } else neuePositionen.push(p);
    }
    for (const a of alt) {
      if (!gesehen.has(a.Position_ID) && istUebergeben(a)) throw fehler(`Position ${a.Position_ID} ist an Korb/Lager übergeben – erst „Übergabe zurücknehmen“.`, 409, 'uebergeben');
      if (!gesehen.has(a.Position_ID)) aenderungPositionen.push({ zeile: a._zeile, positionId: a.Position_ID, felder: { Entfernt: heute(jetzt), Stand: t(jetzt) } });
    }
  }
  const neu = neuePositionen.map((p, i) => ({
    ...Object.fromEntries(POSITION_SPALTEN.map(s => [s, ''])), ...p,
    Position_ID: naechstePositionId(positionen, auftrag.Auftrag_Nr, i), Auftrag_Nr: auftrag.Auftrag_Nr, Stand: t(jetzt),
  }));
  const geaendert = Object.keys(aenderungAuftrag).length || aenderungPositionen.length || neu.length;
  if (geaendert) aenderungAuftrag.Stand = t(jetzt);
  return { aenderungAuftrag, aenderungPositionen, neuePositionen: neu, unveraendert: !geaendert };
}

/** Haken "fertig" je Position. Vorschlag "Auftrag auf fertig setzen?", wenn danach alle aktiven fertig sind. */
export function fertigPlan({ auftrag, positionen, positionId, fertig, jetzt }) {
  if (auftrag.Status === STORNIERT) throw fehler(`${auftrag.Auftrag_Nr} ist storniert.`, 409, 'storniert');
  const akt = aktivePositionen(positionen, auftrag.Auftrag_Nr);
  const p = akt.find(x => x.Position_ID === t(positionId));
  if (!p) throw fehler('Position gibt es nicht (mehr) – bitte neu laden.', 409, 'konflikt');
  const soll = fertig ? 'ja' : '';
  const felder = t(p.Fertig) === soll ? null : { Fertig: soll, Fertig_Am: fertig ? heute(jetzt) : '', Stand: t(jetzt) };
  const nachher = akt.map(x => (x.Position_ID === p.Position_ID ? { ...x, Fertig: soll } : x));
  return { position: p, felder, vorschlagFertig: fertigVorschlag(auftrag, nachher) };
}

/** AM-3: Position an Korb (Korb_Schluessel) oder Lager (Lager_Buchung) uebergeben? */
export const istUebergeben = p => !!(t(p.Korb_Schluessel) || t(p.Lager_Buchung));

/** Wird Herkunft lager/vorhanden gebraucht? Dann muessen die optionalen Spalten da sein. */
export const brauchtHerkunftSpalten = positionen => (positionen ?? []).some(p => (p.Herkunft && p.Herkunft !== HERKUNFT.BESTELLEN) || p.Lager_Ort);

/** Alle aktiven Positionen fertig und der Auftrag steht vor "fertig" -> Vorschlag. */
export function fertigVorschlag(auftrag, aktive) {
  const i = schrittIndex(auftrag.Status);
  return aktive.length > 0 && aktive.every(p => t(p.Fertig) === 'ja') && i >= 0 && i < schrittIndex('fertig');
}

// ── Liste, Filter, Zahlen ────────────────────────────────────────────────────

export const istOffen = a => a.Status !== STORNIERT && a.Status !== 'bezahlt';
/** Termin in <= 7 Kalendertagen (Berlin), heute eingeschlossen, auch ueberfaellig; nur offene. */
export function terminBald(a, jetzt, tage = 7) {
  if (!istOffen(a) || !/^\d{4}-\d{2}-\d{2}$/.test(t(a.Termin))) return false;
  const h = heute(jetzt);
  const bis = new Date(Date.UTC(+h.slice(0, 4), +h.slice(5, 7) - 1, +h.slice(8, 10) + tage)).toISOString().slice(0, 10);
  return t(a.Termin) <= bis;
}

/** Nur Zahlen fuer die Dashboard-Kachel. AM-3: wartetAufWare = offene Auftraege, deren 🛒-Ware noch nicht da ist
 *  (ware je Auftrag aus wareStand; ohne Angabe 0). */
export function auftragZahlen(auftraege, jetzt, ware = new Map()) {
  const liste = auftraege ?? [];
  return {
    offen: liste.filter(istOffen).length,
    terminBald: liste.filter(a => terminBald(a, jetzt)).length,
    fertigNichtBezahlt: liste.filter(a => ['fertig', 'übergeben'].includes(a.Status) && !t(a.Bezahlt_Am)).length,
    wartetAufWare: liste.filter(a => istOffen(a) && ['offen', 'bestellt'].includes(ware.get(a.Auftrag_Nr))).length,
  };
}

// ── AM-3: Rueckmeldung aus Korb und Lager ────────────────────────────────────

/** Korb-Stand einer Position fuer die Anzeige: offen | herausgenommen | bestellt | bestätigt | geliefert | Lager | fehlt. */
export function korbStand(z) {
  if (!z) return { status: 'fehlt' };
  const st = t(z.Status);
  const status = st === 'abgewählt' ? 'herausgenommen' : st === 'bestellt' && t(z.AB_Hinweis) ? 'bestätigt' : st;
  return { status, schluessel: t(z.Schluessel), bestellId: t(z.Bestell_ID), liefertermin: t(z.Liefertermin), hinweis: t(z.Hinweis) };
}
const KORB_ERLEDIGT = ['bestellt', 'bestätigt', 'geliefert', 'Lager'];

/**
 * Warenstand je Auftrag (nur 🛒-Positionen = Herkunft bestellen): '' (keine) | offen (mind. eine noch nicht im Korb
 * bestellt) | bestellt (alle bestellt, nicht alle da) | da (alle geliefert bzw. aus dem Lager). Freie Positionen zaehlen nie.
 */
export function wareStand(positionen, korbJe) {
  const best = (positionen ?? []).filter(p => p.Art === ART.LSHOP && (t(p.Herkunft) || HERKUNFT.BESTELLEN) === HERKUNFT.BESTELLEN);
  if (!best.length) return '';
  const st = best.map(p => (t(p.Korb_Schluessel) ? korbStand(korbJe.get(t(p.Korb_Schluessel))).status : 'nicht übergeben'));
  if (st.some(x => !KORB_ERLEDIGT.includes(x))) return 'offen';
  return st.every(x => ['geliefert', 'Lager'].includes(x)) ? 'da' : 'bestellt';
}

/**
 * Automatisches "bestellt" (nur nach vorn): Auftrag steht auf Anfrage/Angebot/Design, hat mind. eine 🛒- oder 📦-Position,
 * alle 🛒 sind im Korb mind. bestellt, alle 📦 sind ausgebucht. ✓ vorhanden und freie Positionen blockieren nicht.
 */
export function autoBestellt(auftrag, positionen, korbJe) {
  if (!['Anfrage', 'Angebot', 'Design'].includes(auftrag.Status)) return false;
  const l = (positionen ?? []).filter(p => p.Art === ART.LSHOP);
  const best = l.filter(p => (t(p.Herkunft) || HERKUNFT.BESTELLEN) === HERKUNFT.BESTELLEN);
  const lag = l.filter(p => t(p.Herkunft) === HERKUNFT.LAGER);
  if (!best.length && !lag.length) return false;
  return best.every(p => t(p.Korb_Schluessel) && KORB_ERLEDIGT.includes(korbStand(korbJe.get(t(p.Korb_Schluessel))).status))
    && lag.every(p => t(p.Lager_Buchung));
}

/** Antwort fuer den Browser: ohne _zeile; Positionen je Auftrag (nur aktive), Stueck gesamt. */
export function auftraegeAntwort(auftraege, positionen, anreichern = p => p) {
  return (auftraege ?? []).map(({ _zeile, Vorgang, ...a }) => {
    // AM-2-2: Herkunft leer = bestellen (L-Shop) bzw. leer (frei)
    const pos = aktivePositionen(positionen, a.Auftrag_Nr).map(({ _zeile: _z, ...p }) => anreichern({ ...p, Herkunft: p.Herkunft || (p.Art === ART.LSHOP ? HERKUNFT.BESTELLEN : '') }));
    return { ...a, positionen: pos, stueck: pos.reduce((s, p) => s + (Number(p.Menge) || 0), 0) };
  });
}
