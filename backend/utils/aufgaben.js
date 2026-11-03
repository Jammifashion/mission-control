// Aufgaben (AG) und To-dos (AM-4), reine Logik ohne Netz. Eigene Reiter im SSOT (Bericht AM-4 Punkt 0): `Aufgaben` getrennt von
// `Auftraege` - so liest keine Kundenauftrags-Logik (Korb, Lager, autoBestellt, Zahlen) je eine Aufgabe. `Auftrag_Todos` haengt
// per Bezug (AU-/AG-Nr.) an beidem. Nur Nummern, nie Personendaten; Freitexte (Kurztitel, To-do, "wartet auf") mit Hinweis
// "keine Personennamen" in der Oberflaeche. Lesen/Schreiben in lib/auftraege.js (gleiche Sperre, ein Schreibaufruf).

import { berlinDatum } from './berlin-tag.js';
import { fehler, AU_NR_MUSTER } from './auftraege.js';

export const TAB_AUFGABEN = 'Aufgaben';
export const TAB_TODOS = 'Auftrag_Todos';

export const AUFGABE_SPALTEN = [
  'Aufgabe_Nr', 'Kurztitel', 'Notiz', 'Faellig', 'Status', 'Fuer_Art', 'Fuer', 'Gehoert_Zu', 'Wartet_Auf',
  'Offen_Am', 'In_Arbeit_Am', 'Wartet_Am', 'Erledigt_Am', 'Verworfen_Am', 'Angelegt', 'Stand', 'Vorgang',
];
export const AUFGABE_TEXT = ['Aufgabe_Nr', 'Faellig', 'Fuer', 'Gehoert_Zu', 'Offen_Am', 'In_Arbeit_Am', 'Wartet_Am', 'Erledigt_Am', 'Verworfen_Am'];
// Archiviert = Datum ("entfernen" archiviert, nie loeschen); Vorgang = Doppelklick-Schutz beim Anlegen.
export const TODO_SPALTEN = ['Todo_ID', 'Bezug', 'Text', 'Faellig', 'Erledigt', 'Erledigt_Am', 'Reihenfolge', 'Angelegt', 'Stand', 'Archiviert', 'Vorgang'];
export const TODO_TEXT = ['Todo_ID', 'Bezug', 'Faellig', 'Erledigt_Am', 'Archiviert'];

// Eigener Nummernkreis. Eine AG-Nummer ist nie Korb-Referenz (Korb und EDI weisen "AG-" ab).
export const AG_NR_MUSTER = /^AG-\d{4}-\d{4}$/;
export const AG_PRAEFIX = /^\s*AG-/i;
export const istBezug = nr => AU_NR_MUSTER.test(nr) || AG_NR_MUSTER.test(nr);

export const AG_SCHRITTE = [
  { status: 'offen', feld: 'Offen_Am' }, { status: 'in Arbeit', feld: 'In_Arbeit_Am' },
  { status: 'wartet', feld: 'Wartet_Am' }, { status: 'erledigt', feld: 'Erledigt_Am' },
];
export const VERWORFEN = 'verworfen';
export const FUER_ARTEN = ['kunde', 'partner', 'artikel', 'intern'];
const FUER_MUSTER = { kunde: /^K-\d{5}$/, partner: /^P-\d{3,}$/, artikel: /^\d{1,10}$/ };
export const AG_MAX = { Kurztitel: 80, Notiz: 1000, Wartet_Auf: 120, Todo: 200 };
export const TODOS_MAX_JE_BEZUG = 100;

const t = v => String(v ?? '').trim();
const heute = jetzt => berlinDatum(new Date(jetzt));
const lang = (f, w, max) => { if (w.length > max) throw fehler(`${f} ist länger als ${max} Zeichen.`); return w; };
const datum = (f, v) => { const w = t(v); if (w && !/^\d{4}-\d{2}-\d{2}$/.test(w)) throw fehler(`${f} als Datum (JJJJ-MM-TT).`); return w; };

// ── Aufgaben ─────────────────────────────────────────────────────────────────

export const agSchritt = status => AG_SCHRITTE.findIndex(s => s.status === status);
export const aufgabeOffen = a => !['erledigt', VERWORFEN].includes(a.Status);

/** AG-JJJJ-NNNN: hoechste Nummer des Jahres + 1, nie wiederverwendet (eigener Zaehler, unabhaengig von AU). */
export function naechsteAufgabeNr(aufgaben, jahr) {
  const max = (aufgaben ?? []).reduce((m, a) => {
    const x = new RegExp(`^AG-${jahr}-(\\d+)$`).exec(t(a.Aufgabe_Nr));
    return x ? Math.max(m, Number(x[1])) : m;
  }, 0);
  return `AG-${jahr}-${String(max + 1).padStart(4, '0')}`;
}

/**
 * Felder einer Aufgabe pruefen. "fuer": eins davon oder leer - kunde (K-NNNNN) · partner (P-NNN) · artikel (Produkt-ID) · intern.
 * Gehoert_Zu: ein vorhandener Auftrag (AU-…) oder leer. Fehlertexte ohne Werte (keine Freitexte im Log).
 */
export function pruefeAufgabe(e, { auftragNummern } = {}) {
  const aus = {};
  if (e?.Kurztitel !== undefined) aus.Kurztitel = lang('Kurztitel', t(e.Kurztitel).replace(/\s+/g, ' '), AG_MAX.Kurztitel);
  if (e?.Notiz !== undefined) aus.Notiz = lang('Notiz', t(e.Notiz), AG_MAX.Notiz);
  if (e?.Faellig !== undefined) aus.Faellig = datum('Fälligkeit', e.Faellig);
  if (e?.Fuer_Art !== undefined || e?.Fuer !== undefined) {
    const art = t(e.Fuer_Art);
    const fuer = t(e.Fuer);
    if (art && !FUER_ARTEN.includes(art)) throw fehler(`„für“ muss ${FUER_ARTEN.join(', ')} oder leer sein.`);
    if (FUER_MUSTER[art] && !FUER_MUSTER[art].test(fuer)) throw fehler(`„für“: ${art === 'kunde' ? 'Kunden-Nr. K-NNNNN' : art === 'partner' ? 'Partner P-NNN' : 'Produkt-ID'} fehlt oder passt nicht.`);
    aus.Fuer_Art = art;
    aus.Fuer = FUER_MUSTER[art] ? fuer : '';
  }
  if (e?.Gehoert_Zu !== undefined) {
    const g = t(e.Gehoert_Zu);
    if (g && !AU_NR_MUSTER.test(g)) throw fehler('„Gehört zu“ muss eine Auftragsnummer AU-JJJJ-NNNN sein.');
    if (g && auftragNummern && !auftragNummern.has(g)) throw fehler(`Auftrag ${g} gibt es nicht.`, 422, 'gehoert_zu');
    aus.Gehoert_Zu = g;
  }
  if (e?.Wartet_Auf !== undefined) aus.Wartet_Auf = lang('„wartet auf“', t(e.Wartet_Auf).replace(/\s+/g, ' '), AG_MAX.Wartet_Auf);
  return aus;
}

/** Neue Aufgabe: Status offen, Offen_Am = heute. */
export function aufgabeAnlagePlan({ aufgaben, eingabe, auftragNummern, jetzt }) {
  const f = pruefeAufgabe({ Fuer_Art: '', Fuer: '', ...eingabe, Wartet_Auf: undefined }, { auftragNummern });
  if (!f.Kurztitel) throw fehler('Kurztitel fehlt.');
  const tag = heute(jetzt);
  return {
    ...Object.fromEntries(AUFGABE_SPALTEN.map(s => [s, ''])), ...f,
    Aufgabe_Nr: naechsteAufgabeNr(aufgaben, tag.slice(0, 4)), Status: 'offen', Offen_Am: tag,
    Angelegt: t(jetzt), Stand: t(jetzt), Vorgang: t(eingabe?.vorgang),
  };
}

/** Bearbeiten: Kopf-Felder; verworfen = nichts. "wartet auf" nur, solange die Aufgabe wartet. */
export function aufgabeBearbeitenPlan({ aufgabe, eingabe, auftragNummern, jetzt }) {
  if (aufgabe.Status === VERWORFEN) throw fehler(`${aufgabe.Aufgabe_Nr} ist verworfen.`, 409, 'verworfen');
  if (eingabe?.Wartet_Auf !== undefined && aufgabe.Status !== 'wartet') throw fehler('„wartet auf“ gibt es nur im Schritt „wartet“.', 422);
  const f = pruefeAufgabe(eingabe, { auftragNummern });
  if (f.Kurztitel === '') throw fehler('Kurztitel fehlt.');
  if (f.Wartet_Auf === '') throw fehler('„wartet auf“ fehlt (keine Personennamen).');
  const aenderung = Object.fromEntries(Object.entries(f).filter(([k, v]) => t(aufgabe[k]) !== v));
  if (Object.keys(aenderung).length) aenderung.Stand = t(jetzt);
  return { aenderung, unveraendert: !Object.keys(aenderung).length };
}

/**
 * Statuswechsel einer Aufgabe. aktion: weiter | erledigt | zurueck | verwerfen | verwerfen_zurueck.
 * - weiter: naechster Schritt (offen -> in Arbeit -> wartet -> erledigt); nach "wartet" Pflicht wartetAuf (Freitext).
 * - erledigt: direkt fertig aus offen/in Arbeit/wartet (nicht jede Aufgabe muss warten).
 * - zurueck: auf den letzten frueheren Schritt mit Datum, Datum des bisherigen geleert; verlaesst sie "wartet",
 *   wird "wartet auf" geleert.
 * - verwerfen: Status verworfen + Verworfen_Am (nicht bei erledigt); verwerfen_zurueck: letzter Schritt mit Datum.
 */
export function aufgabeStatusWechsel(a, aktion, jetzt, { wartetAuf } = {}) {
  const i = agSchritt(a.Status);
  const tag = heute(jetzt);
  if (a.Status === VERWORFEN && aktion !== 'verwerfen_zurueck') throw fehler(`${a.Aufgabe_Nr} ist verworfen.`, 422, 'verworfen');
  const nachWartet = n => {
    if (n.status !== 'wartet') return {};
    const w = lang('„wartet auf“', t(wartetAuf).replace(/\s+/g, ' '), AG_MAX.Wartet_Auf);
    if (!w) throw fehler('„wartet auf“ fehlt – auf wen oder was (keine Personennamen)?', 422, 'wartet_auf');
    return { Wartet_Auf: w };
  };
  switch (aktion) {
    case 'weiter': {
      if (i < 0 || i >= AG_SCHRITTE.length - 1) throw fehler('Kein weiterer Schritt.', 422);
      const n = AG_SCHRITTE[i + 1];
      return { Status: n.status, [n.feld]: tag, ...nachWartet(n) };
    }
    case 'erledigt': {
      if (i < 0 || a.Status === 'erledigt') throw fehler('Schon erledigt.', 422);
      return { Status: 'erledigt', Erledigt_Am: tag };
    }
    case 'zurueck': {
      if (i <= 0) throw fehler('Kein Schritt zurück möglich.', 422);
      let j = i - 1;
      while (j > 0 && !t(a[AG_SCHRITTE[j].feld])) j -= 1;   // uebersprungene Schritte (ohne Datum) uebergehen
      return { Status: AG_SCHRITTE[j].status, [AG_SCHRITTE[i].feld]: '', ...(a.Status === 'wartet' ? { Wartet_Auf: '' } : {}) };
    }
    case 'verwerfen': {
      if (a.Status === 'erledigt') throw fehler('Eine erledigte Aufgabe wird nicht verworfen.', 422);
      return { Status: VERWORFEN, Verworfen_Am: tag };
    }
    case 'verwerfen_zurueck': {
      if (a.Status !== VERWORFEN) throw fehler('Aufgabe ist nicht verworfen.', 422);
      const letzter = [...AG_SCHRITTE].slice(0, -1).reverse().find(s => t(a[s.feld]))?.status ?? 'offen';
      return { Status: letzter, Verworfen_Am: '' };
    }
    default: throw fehler('Unbekannte Aktion.', 422);
  }
}

// ── To-dos ───────────────────────────────────────────────────────────────────

export const todoAktiv = d => !t(d.Archiviert);
const reihe = d => Number(d.Reihenfolge) || 0;

/** <Bezug>-Tnn: hoechste Nummer des Bezugs + 1 (auch archivierte zaehlen). */
export function naechsteTodoId(todos, bezug) {
  const max = (todos ?? []).filter(d => d.Bezug === bezug).reduce((m, d) => {
    const x = /-T(\d+)$/.exec(t(d.Todo_ID));
    return x ? Math.max(m, Number(x[1])) : m;
  }, 0);
  return `${bezug}-T${String(max + 1).padStart(2, '0')}`;
}

const pruefeText = v => {
  const w = lang('To-do', t(v).replace(/\s+/g, ' '), AG_MAX.Todo);
  if (!w) throw fehler('To-do-Text fehlt.');
  return w;
};

/** Neuer Punkt ans Ende der Liste des Bezugs. bezugOffen: false = storniert/verworfen -> 409. */
export function todoAnlagePlan({ todos, bezug, eingabe, bezugOffen = true, jetzt }) {
  if (!istBezug(bezug)) throw fehler('Bezug muss AU-… oder AG-… sein.');
  if (!bezugOffen) throw fehler(`${bezug} ist storniert/verworfen – keine neuen To-dos.`, 409, 'bezug_zu');
  const eigene = (todos ?? []).filter(d => d.Bezug === bezug);
  if (eigene.filter(todoAktiv).length >= TODOS_MAX_JE_BEZUG) throw fehler(`Höchstens ${TODOS_MAX_JE_BEZUG} To-dos je Auftrag/Aufgabe.`);
  return {
    ...Object.fromEntries(TODO_SPALTEN.map(s => [s, ''])),
    Todo_ID: naechsteTodoId(todos, bezug), Bezug: bezug, Text: pruefeText(eingabe?.text), Faellig: datum('Fälligkeit', eingabe?.faellig),
    Reihenfolge: String(eigene.reduce((m, d) => Math.max(m, reihe(d)), 0) + 1), Angelegt: t(jetzt), Stand: t(jetzt), Vorgang: t(eingabe?.vorgang),
  };
}

/**
 * Punkt aendern: erledigt (Haken, ohne Stand - setzt den gewuenschten Zustand), Text/Faelligkeit (mit Stand wie gesehen).
 * Archivierte Punkte: nichts. Liefert { felder | null }.
 */
export function todoAendernPlan({ todo, eingabe, jetzt }) {
  if (!todoAktiv(todo)) throw fehler('Dieses To-do ist entfernt.', 409, 'archiviert');
  const felder = {};
  if (eingabe?.erledigt !== undefined) {
    const soll = eingabe.erledigt ? 'ja' : '';
    if (t(todo.Erledigt) !== soll) Object.assign(felder, { Erledigt: soll, Erledigt_Am: soll ? heute(jetzt) : '' });
  }
  if (eingabe?.text !== undefined || eingabe?.faellig !== undefined) {
    if (t(eingabe?.stand) !== t(todo.Stand)) throw fehler('Das To-do wurde inzwischen geändert – bitte neu laden.', 409, 'konflikt');
    if (eingabe.text !== undefined) { const w = pruefeText(eingabe.text); if (w !== t(todo.Text)) felder.Text = w; }
    if (eingabe.faellig !== undefined) { const w = datum('Fälligkeit', eingabe.faellig); if (w !== t(todo.Faellig)) felder.Faellig = w; }
  }
  if (!Object.keys(felder).length) return { felder: null };
  return { felder: { ...felder, Stand: t(jetzt) } };
}

/** Archivieren ("entfernen"): Archiviert = heute. Schon archiviert -> unveraendert. */
export function todoArchivPlan({ todo, jetzt }) {
  if (!todoAktiv(todo)) return { felder: null };
  return { felder: { Archiviert: heute(jetzt), Stand: t(jetzt) } };
}

/** Aktive To-dos eines Bezugs in Reihenfolge (Reihenfolge, dann ID). */
export const todosVon = (todos, bezug) => (todos ?? []).filter(d => d.Bezug === bezug && todoAktiv(d))
  .sort((a, b) => reihe(a) - reihe(b) || t(a.Todo_ID).localeCompare(t(b.Todo_ID)));

/**
 * Hoch/runter: tauscht die Reihenfolge mit dem Nachbarn unter den aktiven, gleich erledigten Punkten desselben Bezugs. Gleiche Werte
 * (von Hand im Sheet) werden dabei aufgeloest: die ganze Liste bekommt 1..n, nur geaenderte Zeilen gehen zurueck.
 * Liefert [{ todo, felder }] (leer = schon oben/unten).
 */
export function todoVerschiebenPlan({ todos, todo, richtung, jetzt }) {
  if (!todoAktiv(todo)) throw fehler('Dieses To-do ist entfernt.', 409, 'archiviert');
  // Nur innerhalb der sichtbaren Gruppe (offen bzw. erledigt) - sonst tauscht "hoch" mit einem eingeklappten erledigten Punkt.
  const erl = t(todo.Erledigt) === 'ja';
  const liste = todosVon(todos, todo.Bezug).filter(d => (t(d.Erledigt) === 'ja') === erl);
  const i = liste.findIndex(d => d.Todo_ID === todo.Todo_ID);
  const j = richtung === 'hoch' ? i - 1 : richtung === 'runter' ? i + 1 : NaN;
  if (Number.isNaN(j)) throw fehler('Richtung hoch oder runter.', 422);
  if (j < 0 || j >= liste.length) return [];
  const neu = [...liste];
  [neu[i], neu[j]] = [neu[j], neu[i]];
  return neu.map((d, k) => ({ todo: d, soll: String(k + 1) })).filter(x => t(x.todo.Reihenfolge) !== x.soll)
    .map(x => ({ todo: x.todo, felder: { Reihenfolge: x.soll, Stand: t(jetzt) } }));
}

/** Faelligkeit -> 'ueberfaellig' | 'heute' | 'woche' (bis +6 Tage) | 'spaeter' | '' (ohne Datum). Tage Europe/Berlin. */
export function faelligStufe(faellig, jetzt) {
  const f = t(faellig);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return '';
  const h = heute(jetzt);
  if (f < h) return 'ueberfaellig';
  if (f === h) return 'heute';
  const bis = new Date(Date.UTC(+h.slice(0, 4), +h.slice(5, 7) - 1, +h.slice(8, 10) + 6)).toISOString().slice(0, 10);
  return f <= bis ? 'woche' : 'spaeter';
}

/** Offene (nicht erledigte, nicht archivierte) To-dos nach Faelligkeit, ohne Datum zuletzt; gleiche: Bezug, Reihenfolge. */
export function offeneTodos(todos) {
  return (todos ?? []).filter(d => todoAktiv(d) && t(d.Erledigt) !== 'ja').sort((a, b) => {
    const fa = t(a.Faellig) || '9999', fb = t(b.Faellig) || '9999';
    return fa.localeCompare(fb) || t(a.Bezug).localeCompare(t(b.Bezug)) || reihe(a) - reihe(b);
  });
}

/** Zahlen fuer die Kachel: ueberfaellige offene To-dos (nur von offenen Bezuegen), offene Aufgaben. */
export function aufgabenZahlen(aufgaben, todos, jetzt, bezugOffen = () => true) {
  return {
    todosUeberfaellig: offeneTodos(todos).filter(d => bezugOffen(d.Bezug) && faelligStufe(d.Faellig, jetzt) === 'ueberfaellig').length,
    aufgabenOffen: (aufgaben ?? []).filter(aufgabeOffen).length,
  };
}

/** Antwort fuer den Browser: ohne _zeile/Vorgang. */
export const ohneIntern = ({ _zeile, Vorgang, ...x }) => x;
