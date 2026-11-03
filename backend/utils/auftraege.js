// Auftraege (AM-2), reine Logik ohne Netz. Reiter `Auftraege` und `Auftrag_Positionen` im SSOT, nur mit Kunden_Nr -
// keine Personendaten (Namen kommen nur in der Oberflaeche aus dem Kunden-Sheet dazu). Keine Preise.
// Lesen/Schreiben in lib/auftraege.js.

import { berlinDatum } from './berlin-tag.js';

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
export const AUFTRAG_TEXT = ['Auftrag_Nr', 'Kunden_Nr', 'Termin', 'Anfrage_Am', 'Angebot_Am', 'Bestellt_Am', 'Produktion_Am', 'Fertig_Am',
  'Uebergeben_Am', 'Bezahlt_Am', 'Storniert_Am'];
export const POSITION_TEXT = ['Position_ID', 'Auftrag_Nr', 'LShop_ArticleNr', 'Fertig_Am', 'Entfernt'];

export const KANAELE = ['Mail', 'WhatsApp', 'Telefon', 'persönlich', 'Jey'];
// Schritte in Reihenfolge, je Schritt sein Datumsfeld. "storniert" steht ausserhalb (Storniert_Am).
export const SCHRITTE = [
  { status: 'Anfrage', feld: 'Anfrage_Am' }, { status: 'Angebot', feld: 'Angebot_Am' }, { status: 'bestellt', feld: 'Bestellt_Am' },
  { status: 'in Produktion', feld: 'Produktion_Am' }, { status: 'fertig', feld: 'Fertig_Am' }, { status: 'übergeben', feld: 'Uebergeben_Am' },
  { status: 'bezahlt', feld: 'Bezahlt_Am' },
];
export const STORNIERT = 'storniert';
export const START_STATUS = ['Anfrage', 'Angebot'];
// Bis einschliesslich Angebot sind Kopf und Positionen frei; ab bestellt nur Notiz/Termin (Korb-Logik folgt mit AM-3).
export const FREI_BIS = 1;
export const ART = { LSHOP: 'lshop', FREI: 'frei' };
export const MENGE_MAX = 9999;
export const POSITIONEN_MAX = 200;
export const MAX = { Kurztitel: 80, Notiz: 1000, Motiv: 120, Druck: 120, PosNotiz: 300, Freitext: 120 };

const t = v => String(v ?? '').trim();

export function fehler(text, status = 422, code) {
  const e = new Error(text);
  e.status = status;
  if (code) e.code = code;
  return e;
}

// ── Lesen ────────────────────────────────────────────────────────────────────

/** Reiter-Werte -> { idx, zeilen: [{ ...Spalten, _zeile }], fehlt }. Nur ueber den Spaltennamen. */
export function zeilenAus(werte, spalten, schluessel) {
  const kopf = (werte?.[0] ?? []).map(t);
  const idx = Object.fromEntries(kopf.map((k, i) => [k, i]).filter(([k]) => k));
  const fehlt = spalten.filter(s => idx[s] === undefined);
  const zeilen = [];
  (werte ?? []).slice(1).forEach((r, i) => {
    const o = Object.fromEntries(spalten.map(s => [s, idx[s] === undefined ? '' : t(r?.[idx[s]])]));
    if (o[schluessel]) zeilen.push({ ...o, _zeile: i + 2 });
  });
  return { idx, zeilen, fehlt };
}

/** Objekt -> Sheet-Zeile in Spaltenfolge des Reiters (Breite = Kopfzeile). */
export function alsZeile(idx, obj, spalten, breite) {
  const n = breite ?? Math.max(...Object.values(idx)) + 1;
  const z = Array.from({ length: n }, () => '');
  for (const s of spalten) if (idx[s] !== undefined) z[idx[s]] = t(obj[s]);
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
 * - zurueck: einen Schritt zurueck, Datum des bisherigen Schritts geleert (bezahlt: Bezahlt_Am geleert).
 * - bezahlt: Bezahlt_Am = heute, jederzeit (Vorkasse); steht der Auftrag auf "übergeben", wird er "bezahlt".
 * - bezahlt_zurueck: Bezahlt_Am leer; Status "bezahlt" -> "übergeben".
 * - stornieren: Status storniert + Storniert_Am (nicht bei bezahlt); storno_zurueck: letzter Schritt mit Datum.
 */
export function statusWechsel(a, aktion, jetzt) {
  const i = schrittIndex(a.Status);
  const tag = heute(jetzt);
  if (a.Status === STORNIERT && aktion !== 'storno_zurueck') throw fehler(`${a.Auftrag_Nr} ist storniert.`, 422, 'storniert');
  switch (aktion) {
    case 'weiter': {
      if (i < 0 || i >= SCHRITTE.length - 1) throw fehler('Kein weiterer Schritt.', 422);
      const n = SCHRITTE[i + 1];
      return { Status: n.status, [n.feld]: t(a[n.feld]) || tag };
    }
    case 'zurueck': {
      if (i <= 0) throw fehler('Kein Schritt zurück möglich.', 422);
      return { Status: SCHRITTE[i - 1].status, [SCHRITTE[i].feld]: '' };
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
export function pruefePositionen(eingabe, { waehlbar, bisher = new Set() } = {}) {
  const liste = Array.isArray(eingabe) ? eingabe : [];
  if (!liste.length) throw fehler('Mindestens eine Position.');
  if (liste.length > POSITIONEN_MAX) throw fehler(`Höchstens ${POSITIONEN_MAX} Positionen.`);
  return liste.map((p, i) => {
    const nr = i + 1;
    const art = t(p?.art);
    const menge = Number(p?.menge);
    if (!Number.isInteger(menge) || menge < 1 || menge > MENGE_MAX) throw fehler(`Position ${nr}: Menge ganze Zahl 1–${MENGE_MAX}.`);
    const neben = {
      Motiv: lang(`Position ${nr}: Motiv`, t(p?.motiv), MAX.Motiv), Druck: lang(`Position ${nr}: Druck`, t(p?.druck), MAX.Druck),
      Notiz: lang(`Position ${nr}: Notiz`, t(p?.notiz), MAX.PosNotiz),
    };
    if (art === ART.LSHOP) {
      const a = t(p?.articleNr);
      if (!/^\d{10}$/.test(a)) throw fehler(`Position ${nr}: L-Shop-Nummer muss 10 Ziffern haben.`);
      if (!bisher.has(a) && !waehlbar?.has(a)) throw fehler(`Position ${nr}: L-Shop-Nummer nicht (mehr) bestellbar.`, 422, 'nicht_waehlbar');
      return { positionId: t(p?.positionId), Art: ART.LSHOP, LShop_ArticleNr: a, Freitext: '', Menge: String(menge), ...neben };
    }
    if (art === ART.FREI) {
      const f = lang(`Position ${nr}: Freitext`, t(p?.freitext), MAX.Freitext);
      if (!f) throw fehler(`Position ${nr}: Freitext fehlt.`);
      return { positionId: t(p?.positionId), Art: ART.FREI, LShop_ArticleNr: '', Freitext: f, Menge: String(menge), ...neben };
    }
    throw fehler(`Position ${nr}: Art lshop oder frei.`);
  });
}

// ── Plaene ───────────────────────────────────────────────────────────────────

/** Neuer Auftrag: Kopf + Positionen. Status Anfrage oder Angebot (Anfrage_Am immer, Angebot_Am bei Angebot). */
export function anlagePlan({ auftraege, positionen, eingabe, waehlbar, jetzt }) {
  const kopf = pruefeKopf(eingabe);
  if (!kopf.Kunden_Nr) throw fehler('Kunde fehlt.');
  if (!kopf.Kurztitel) throw fehler('Kurztitel fehlt.');
  const status = t(eingabe?.status) || 'Anfrage';
  if (!START_STATUS.includes(status)) throw fehler('Start-Status Anfrage oder Angebot.');
  const pos = pruefePositionen(eingabe?.positionen, { waehlbar });
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
export function bearbeitenPlan({ auftrag, positionen, eingabe, waehlbar, jetzt }) {
  if (auftrag.Status === STORNIERT) throw fehler(`${auftrag.Auftrag_Nr} ist storniert.`, 409, 'storniert');
  const frei = istFrei(auftrag);
  if (!frei && eingabe?.positionen !== undefined) throw fehler(`${auftrag.Auftrag_Nr}: ab „bestellt“ sind Positionen gesperrt.`, 409, 'gesperrt');
  const kopf = pruefeKopf(eingabe, { nurNotizTermin: !frei });
  if (frei && kopf.Kurztitel === '') throw fehler('Kurztitel fehlt.');
  if (frei && kopf.Kunden_Nr === '') throw fehler('Kunde fehlt.');
  const aenderungAuftrag = Object.fromEntries(Object.entries(kopf).filter(([k, v]) => t(auftrag[k]) !== v));
  const aenderungPositionen = [], neuePositionen = [];
  if (frei && eingabe?.positionen !== undefined) {
    const alt = aktivePositionen(positionen, auftrag.Auftrag_Nr);
    const bisher = new Set(alt.map(p => p.LShop_ArticleNr).filter(Boolean));
    const pos = pruefePositionen(eingabe.positionen, { waehlbar, bisher });
    const gesehen = new Set();
    for (const p of pos) {
      if (p.positionId) {
        const a = alt.find(x => x.Position_ID === p.positionId);
        if (!a) throw fehler(`Position ${p.positionId} gibt es in diesem Auftrag nicht (mehr) – bitte neu laden.`, 409, 'konflikt');
        gesehen.add(a.Position_ID);
        const felder = Object.fromEntries(['Art', 'LShop_ArticleNr', 'Freitext', 'Menge', 'Motiv', 'Druck', 'Notiz'].filter(f => t(a[f]) !== p[f]).map(f => [f, p[f]]));
        if (Object.keys(felder).length) aenderungPositionen.push({ zeile: a._zeile, positionId: a.Position_ID, felder: { ...felder, Stand: t(jetzt) } });
      } else neuePositionen.push(p);
    }
    for (const a of alt) {
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

/** Nur Zahlen fuer die Dashboard-Kachel. wartetAufWare kommt mit AM-3. */
export function auftragZahlen(auftraege, jetzt) {
  const liste = auftraege ?? [];
  return {
    offen: liste.filter(istOffen).length,
    terminBald: liste.filter(a => terminBald(a, jetzt)).length,
    fertigNichtBezahlt: liste.filter(a => ['fertig', 'übergeben'].includes(a.Status) && !t(a.Bezahlt_Am)).length,
  };
}

/** Antwort fuer den Browser: ohne _zeile; Positionen je Auftrag (nur aktive), Stueck gesamt. */
export function auftraegeAntwort(auftraege, positionen, anreichern = p => p) {
  return (auftraege ?? []).map(({ _zeile, Vorgang, ...a }) => {
    const pos = aktivePositionen(positionen, a.Auftrag_Nr).map(({ _zeile: _z, ...p }) => anreichern(p));
    return { ...a, positionen: pos, stueck: pos.reduce((s, p) => s + (Number(p.Menge) || 0), 0) };
  });
}
