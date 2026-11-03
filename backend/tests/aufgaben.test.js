// AM-4: Aufgaben (AG) und To-dos - Logik (utils/aufgaben.js) und Schreibwege (lib/auftraege.js). Nur erfundene Daten.

import { jest } from '@jest/globals';
import { machSheets } from './hilfen/korb-sheet.js';
import { TAB_AUFTRAEGE, TAB_POSITIONEN, AUFTRAG_SPALTEN, POSITION_SPALTEN } from '../utils/auftraege.js';
import {
  TAB_AUFGABEN, TAB_TODOS, AUFGABE_SPALTEN, TODO_SPALTEN, naechsteAufgabeNr, aufgabeStatusWechsel, aufgabeAnlagePlan, pruefeAufgabe,
  todoAnlagePlan, todoAendernPlan, todoVerschiebenPlan, todoArchivPlan, naechsteTodoId, offeneTodos, faelligStufe, aufgabenZahlen,
} from '../utils/aufgaben.js';
import {
  legeAufgabeAn, bearbeiteAufgabe, wechsleAufgabeStatus, legeTodoAn, aendereTodo, verschiebeTodo, archiviereTodo,
  leseAuftraege, legeAuftragAn, _auftraegeCacheLeeren,
} from '../lib/auftraege.js';
import { bereitstellenVorschau } from '../lib/auftragBereitstellen.js';
import { kannBereitstellen } from '../utils/auftrag-bereitstellen.js';
import { eigeneZeile, eigenBearbeitenPlan } from '../utils/korb-logic.js';
import { ediPruefung } from '../utils/edi-bestellung.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { _lieferbarkeitCacheLeeren } from '../lib/lieferbarkeitLesen.js';

const JETZT = '2026-11-04T10:00:00.000Z';   // Mittwoch, 11 Uhr Berlin
const jetzt = () => new Date(JETZT);
const kundeOk = async () => {};
const V = n => `vorgang-ag-${String(n).padStart(4, '0')}`;
const zeile = (spalten, o) => spalten.map(s => o[s] ?? '');

function tabs({ auftraege = [], aufgaben = [], todos = [], ohne = [] } = {}) {
  const t = {
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Brand', 'CatNrManufacturer', 'Discontinued', 'Status', 'Description']],
    [TAB_AUFTRAEGE]: [AUFTRAG_SPALTEN, ...auftraege.map(o => zeile(AUFTRAG_SPALTEN, o))],
    [TAB_POSITIONEN]: [POSITION_SPALTEN],
    [TAB_AUFGABEN]: [AUFGABE_SPALTEN, ...aufgaben.map(o => zeile(AUFGABE_SPALTEN, o))],
    [TAB_TODOS]: [TODO_SPALTEN, ...todos.map(o => zeile(TODO_SPALTEN, o))],
  };
  for (const o of ohne) delete t[o];
  return t;
}
const AU1 = { Auftrag_Nr: 'AU-2026-0001', Kunden_Nr: 'K-00001', Kurztitel: 'Polos', Status: 'Angebot', Anfrage_Am: '2026-11-01', Angebot_Am: '2026-11-02', Stand: 's-au1' };
const AU_STORNO = { Auftrag_Nr: 'AU-2026-0002', Kunden_Nr: 'K-00001', Kurztitel: 'Alt', Status: 'storniert', Storniert_Am: '2026-11-02', Stand: 's-au2' };
const AG1 = { Aufgabe_Nr: 'AG-2026-0001', Kurztitel: 'Motive Partner', Status: 'offen', Offen_Am: '2026-11-01', Stand: 's-ag1' };

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot-test';
  _auftraegeCacheLeeren(); _resetLShopCache(); _lieferbarkeitCacheLeeren();
});

describe('Aufgaben: Nummern, Felder, Status', () => {
  test('AG-Zaehler getrennt vom AU-Zaehler, je Jahr', () => {
    expect(naechsteAufgabeNr([{ Aufgabe_Nr: 'AG-2026-0004' }, { Aufgabe_Nr: 'AG-2025-0099' }, { Aufgabe_Nr: 'AU-2026-0050' }], '2026')).toBe('AG-2026-0005');
    expect(naechsteAufgabeNr([], '2027')).toBe('AG-2027-0001');
  });
  test('"fuer": kunde/partner/artikel mit passender Nummer, intern ohne; Gehoert_Zu nur vorhandene AU', () => {
    expect(pruefeAufgabe({ Fuer_Art: 'kunde', Fuer: 'K-00001' })).toEqual({ Fuer_Art: 'kunde', Fuer: 'K-00001' });
    expect(pruefeAufgabe({ Fuer_Art: 'intern', Fuer: 'egal' })).toEqual({ Fuer_Art: 'intern', Fuer: '' });
    expect(pruefeAufgabe({ Fuer_Art: 'artikel', Fuer: '12345' }).Fuer).toBe('12345');
    expect(() => pruefeAufgabe({ Fuer_Art: 'partner', Fuer: 'K-00001' })).toThrow(/Partner/);
    expect(() => pruefeAufgabe({ Fuer_Art: 'irgendwas', Fuer: '' })).toThrow(/für/);
    expect(() => pruefeAufgabe({ Gehoert_Zu: 'AG-2026-0001' })).toThrow(/AU-JJJJ/);
    expect(() => pruefeAufgabe({ Gehoert_Zu: 'AU-2026-0009' }, { auftragNummern: new Set(['AU-2026-0001']) })).toThrow(/gibt es nicht/);
    expect(() => pruefeAufgabe({ Faellig: '04.11.2026' })).toThrow(/JJJJ-MM-TT/);
  });
  test('Anlage: Status offen, Offen_Am heute; Kurztitel Pflicht', () => {
    const a = aufgabeAnlagePlan({ aufgaben: [AG1], eingabe: { Kurztitel: '  Anruf   Sticker ', vorgang: V(1) }, jetzt: JETZT });
    expect(a).toMatchObject({ Aufgabe_Nr: 'AG-2026-0002', Kurztitel: 'Anruf Sticker', Status: 'offen', Offen_Am: '2026-11-04', Fuer_Art: '' });
    expect(() => aufgabeAnlagePlan({ aufgaben: [], eingabe: { Kurztitel: ' ' }, jetzt: JETZT })).toThrow(/Kurztitel/);
  });
  const ag = (Status, extra = {}) => ({ Aufgabe_Nr: 'AG-2026-0001', Status, Offen_Am: '2026-11-01', ...extra });
  test('Ablauf offen -> in Arbeit -> wartet (Text Pflicht) -> erledigt, Datum je Schritt', () => {
    expect(aufgabeStatusWechsel(ag('offen'), 'weiter', JETZT)).toEqual({ Status: 'in Arbeit', In_Arbeit_Am: '2026-11-04' });
    expect(() => aufgabeStatusWechsel(ag('in Arbeit'), 'weiter', JETZT)).toThrow(/wartet auf/);
    expect(aufgabeStatusWechsel(ag('in Arbeit'), 'weiter', JETZT, { wartetAuf: ' Rückmeldung  Sticker ' }))
      .toEqual({ Status: 'wartet', Wartet_Am: '2026-11-04', Wartet_Auf: 'Rückmeldung Sticker' });
    expect(aufgabeStatusWechsel(ag('wartet'), 'weiter', JETZT)).toEqual({ Status: 'erledigt', Erledigt_Am: '2026-11-04' });
    expect(aufgabeStatusWechsel(ag('offen'), 'erledigt', JETZT)).toEqual({ Status: 'erledigt', Erledigt_Am: '2026-11-04' });
    expect(() => aufgabeStatusWechsel(ag('erledigt'), 'weiter', JETZT)).toThrow(/Kein weiterer/);
  });
  test('Rueckweg einen Schritt (uebersprungene ohne Datum uebergehen), wartet leert "wartet auf"; verwerfen und zurueck', () => {
    expect(aufgabeStatusWechsel(ag('wartet', { In_Arbeit_Am: '2026-11-02', Wartet_Am: '2026-11-03', Wartet_Auf: 'x' }), 'zurueck', JETZT))
      .toEqual({ Status: 'in Arbeit', Wartet_Am: '', Wartet_Auf: '' });
    expect(aufgabeStatusWechsel(ag('erledigt', { Erledigt_Am: '2026-11-03' }), 'zurueck', JETZT)).toEqual({ Status: 'offen', Erledigt_Am: '' });
    expect(() => aufgabeStatusWechsel(ag('offen'), 'zurueck', JETZT)).toThrow(/Kein Schritt zurück/);
    expect(aufgabeStatusWechsel(ag('in Arbeit', { In_Arbeit_Am: '2026-11-02' }), 'verwerfen', JETZT)).toEqual({ Status: 'verworfen', Verworfen_Am: '2026-11-04' });
    expect(() => aufgabeStatusWechsel(ag('erledigt'), 'verwerfen', JETZT)).toThrow(/erledigte/);
    expect(aufgabeStatusWechsel(ag('verworfen', { In_Arbeit_Am: '2026-11-02' }), 'verwerfen_zurueck', JETZT)).toEqual({ Status: 'in Arbeit', Verworfen_Am: '' });
    expect(() => aufgabeStatusWechsel(ag('verworfen'), 'weiter', JETZT)).toThrow(/verworfen/);
  });
});

describe('Aufgaben haben keine Rohlinge: Korb, EDI, Bereitstellen', () => {
  test('kannBereitstellen ist bei AG nie wahr', () => {
    expect(kannBereitstellen({ Auftrag_Nr: 'AU-2026-0001', Status: 'Angebot' })).toBe(true);
    expect(kannBereitstellen({ Auftrag_Nr: 'AG-2026-0001', Status: 'Angebot' })).toBe(false);
    expect(kannBereitstellen({ Aufgabe_Nr: 'AG-2026-0001', Status: 'offen' })).toBe(false);
  });
  test('Server: Bereitstellen-Vorschau fuer eine AG-Nummer -> 422', async () => {
    const { sheets } = machSheets(tabs({ auftraege: [AU1], aufgaben: [AG1] }));
    await expect(bereitstellenVorschau({ sheets, eingabe: { auftragNr: 'AG-2026-0001' } })).rejects.toMatchObject({ status: 422, code: 'aufgabe' });
  });
  test('Korb: eigene Position mit Referenz AG-… abgewiesen (anlegen), AU-… geht', () => {
    const varianten = [{ articleNr: '9000000110' }];
    const z = r => eigeneZeile({ eingabe: { articleNr: '9000000110', menge: 1, referenz: r }, varianten, schluessel: 'EIGEN:2026-0001', jetzt: JETZT });
    expect(() => z('AG-2026-0001')).toThrow(/AG-/);
    expect(() => z(' ag-2026-0001')).toThrow(/AG-/);
    expect(z('AU-2026-0001').Referenz).toBe('AU-2026-0001');
  });
  test('Korb: bearbeiten auf Referenz AG-… abgewiesen', () => {
    const ein = { Schluessel: 'EIGEN:2026-0001', Herkunft: 'eigen', Status: 'offen', LShop_ArticleNr: '9000000110', Menge: '1', Referenz: 'Muster', Stand: 's1' };
    expect(() => eigenBearbeitenPlan({ zeilen: [ein], idx: {}, eingabe: { schluessel: ein.Schluessel, status: 'offen', stand: 's1', articleNr: '9000000110', menge: 1, referenz: 'AG-2026-0003' },
      varianten: [{ articleNr: '9000000110' }], varianteJeNr: new Map(), jetzt: JETZT })).toThrow(/AG-/);
  });
  test('EDI: Referenz AG-… = rot', () => {
    const z = { Schluessel: 'EIGEN:2026-0009', Shop: 'JFN', Herkunft: 'eigen', Referenz: 'AG-2026-0001', LShop_ArticleNr: '1000000001', Menge: '1', Status: 'offen', Hinweis: '' };
    const modelle = new Map([['1000000001', { articleNr: '1000000001', catalogNr: 'E3000', status: 'aktiv', discontinued: '0' }]]);
    const r = ediPruefung({ auswahl: [{ schluessel: z.Schluessel, status: 'offen' }], zeilen: [z], modelle, customerId: '00000000', commission: 'X', orderId: 'JFN-2026-0002', versandart: 'Standard', jetzt: new Date('2026-10-22T08:00:00Z') });
    expect(r.punkte.find(p => p.regel === 'reference')?.stufe ?? r.punkte.find(p => p.regel === 'reference')).toBeTruthy();
    expect(JSON.stringify(r.punkte.filter(p => p.regel === 'reference'))).toMatch(/Aufgaben-Nummer/);
  });
});

describe('To-dos: Logik', () => {
  const d = (o) => ({ Bezug: 'AU-2026-0001', Erledigt: '', Archiviert: '', Stand: 's', ...o });
  test('anlegen: ID je Bezug, ans Ende, Text Pflicht, nur AU/AG, nicht bei storniert', () => {
    const liste = [d({ Todo_ID: 'AU-2026-0001-T01', Reihenfolge: '1' }), d({ Todo_ID: 'AU-2026-0001-T02', Reihenfolge: '2', Archiviert: '2026-11-03' })];
    const n = todoAnlagePlan({ todos: liste, bezug: 'AU-2026-0001', eingabe: { text: ' Motiv  freigeben ', faellig: '2026-11-06' }, jetzt: JETZT });
    expect(n).toMatchObject({ Todo_ID: 'AU-2026-0001-T03', Text: 'Motiv freigeben', Faellig: '2026-11-06', Reihenfolge: '3', Erledigt: '' });
    expect(naechsteTodoId([], 'AG-2026-0001')).toBe('AG-2026-0001-T01');
    expect(() => todoAnlagePlan({ todos: [], bezug: 'AU-2026-0001', eingabe: { text: '' }, jetzt: JETZT })).toThrow(/Text fehlt/);
    expect(() => todoAnlagePlan({ todos: [], bezug: 'K-00001', eingabe: { text: 'x' }, jetzt: JETZT })).toThrow(/Bezug/);
    expect(() => todoAnlagePlan({ todos: [], bezug: 'AU-2026-0002', eingabe: { text: 'x' }, bezugOffen: false, jetzt: JETZT })).toThrow(/storniert/);
  });
  test('abhaken setzt Datum, zurueck leert es; Text nur mit Stand; archiviert = nichts mehr', () => {
    const x = d({ Todo_ID: 'AU-2026-0001-T01', Text: 'a', Stand: 's1' });
    expect(todoAendernPlan({ todo: x, eingabe: { erledigt: true }, jetzt: JETZT }).felder).toEqual({ Erledigt: 'ja', Erledigt_Am: '2026-11-04', Stand: JETZT });
    expect(todoAendernPlan({ todo: { ...x, Erledigt: 'ja' }, eingabe: { erledigt: true }, jetzt: JETZT }).felder).toBeNull();   // Doppelklick
    expect(todoAendernPlan({ todo: { ...x, Erledigt: 'ja' }, eingabe: { erledigt: false }, jetzt: JETZT }).felder).toMatchObject({ Erledigt: '', Erledigt_Am: '' });
    expect(() => todoAendernPlan({ todo: x, eingabe: { text: 'b', stand: 'alt' }, jetzt: JETZT })).toThrow(/inzwischen/);
    expect(todoAendernPlan({ todo: x, eingabe: { text: 'b', faellig: '2026-11-10', stand: 's1' }, jetzt: JETZT }).felder).toMatchObject({ Text: 'b', Faellig: '2026-11-10' });
    expect(todoArchivPlan({ todo: x, jetzt: JETZT }).felder).toEqual({ Archiviert: '2026-11-04', Stand: JETZT });
    expect(() => todoAendernPlan({ todo: { ...x, Archiviert: '2026-11-04' }, eingabe: { erledigt: true }, jetzt: JETZT })).toThrow(/entfernt/);
  });
  test('Reihenfolge: hoch/runter tauscht mit dem Nachbarn, nur aktive desselben Bezugs, gleiche Werte aufgeloest', () => {
    const l = [
      d({ Todo_ID: 'AU-2026-0001-T01', Reihenfolge: '1' }), d({ Todo_ID: 'AU-2026-0001-T02', Reihenfolge: '2', Archiviert: '2026-11-01' }),
      d({ Todo_ID: 'AU-2026-0001-T03', Reihenfolge: '3' }), d({ Todo_ID: 'AU-2026-0001-T04', Reihenfolge: '3' }),
      d({ Todo_ID: 'AG-2026-0001-T01', Bezug: 'AG-2026-0001', Reihenfolge: '1' }),
    ];
    const p = todoVerschiebenPlan({ todos: l, todo: l[2], richtung: 'hoch', jetzt: JETZT });
    expect(p.map(x => [x.todo.Todo_ID, x.felder.Reihenfolge])).toEqual([['AU-2026-0001-T03', '1'], ['AU-2026-0001-T01', '2']]);
    expect(todoVerschiebenPlan({ todos: l, todo: l[0], richtung: 'hoch', jetzt: JETZT })).toEqual([]);
    const r = todoVerschiebenPlan({ todos: l, todo: l[2], richtung: 'runter', jetzt: JETZT });
    expect(r.map(x => [x.todo.Todo_ID, x.felder.Reihenfolge])).toEqual([['AU-2026-0001-T04', '2']]);   // T03 steht danach auf 3 (wie vorher)
    expect(() => todoVerschiebenPlan({ todos: l, todo: l[0], richtung: 'quer', jetzt: JETZT })).toThrow(/Richtung/);
    // erledigte Punkte (eingeklappt) zaehlen beim Verschieben offener Punkte nicht mit
    const m = [d({ Todo_ID: 'AU-2026-0001-T01', Reihenfolge: '1' }), d({ Todo_ID: 'AU-2026-0001-T02', Reihenfolge: '2', Erledigt: 'ja' }), d({ Todo_ID: 'AU-2026-0001-T03', Reihenfolge: '3' })];
    expect(todoVerschiebenPlan({ todos: m, todo: m[2], richtung: 'hoch', jetzt: JETZT }).map(x => [x.todo.Todo_ID, x.felder.Reihenfolge]))
      .toEqual([['AU-2026-0001-T03', '1'], ['AU-2026-0001-T01', '2']]);
  });
  test('Uebersicht: nach Faelligkeit, ohne Datum zuletzt; Stufen ueberfaellig/heute/woche', () => {
    const l = [
      d({ Todo_ID: 'a', Faellig: '' }), d({ Todo_ID: 'b', Faellig: '2026-11-04' }), d({ Todo_ID: 'c', Faellig: '2026-11-01' }),
      d({ Todo_ID: 'e', Faellig: '2026-11-01', Erledigt: 'ja' }), d({ Todo_ID: 'f', Faellig: '2026-11-02', Archiviert: '2026-11-03' }),
      d({ Todo_ID: 'g', Faellig: '2026-11-20' }),
    ];
    expect(offeneTodos(l).map(x => x.Todo_ID)).toEqual(['c', 'b', 'g', 'a']);
    expect(['2026-11-01', '2026-11-04', '2026-11-10', '2026-11-11', '', 'x'].map(f => faelligStufe(f, JETZT)))
      .toEqual(['ueberfaellig', 'heute', 'woche', 'spaeter', '', '']);
    expect(aufgabenZahlen([{ Status: 'offen' }, { Status: 'wartet' }, { Status: 'erledigt' }, { Status: 'verworfen' }], l, JETZT))
      .toEqual({ todosUeberfaellig: 1, aufgabenOffen: 2 });
    expect(aufgabenZahlen([], l, JETZT, () => false).todosUeberfaellig).toBe(0);   // Bezug zu -> zaehlt nicht
  });
});

describe('Schreibwege (In-Memory-Sheet)', () => {
  test('Aufgabe anlegen: eigener Zaehler, Doppelklick, kein append; AU-Zaehler unberuehrt', async () => {
    const t = tabs({ auftraege: [AU1], aufgaben: [AG1] });
    const { sheets, aufrufe } = machSheets(t);
    const r = await legeAufgabeAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: { Kurztitel: 'Motive Shop', Fuer_Art: 'kunde', Fuer: 'K-00001', Gehoert_Zu: 'AU-2026-0001', vorgang: V(1) } });
    expect(r).toMatchObject({ ok: true, schon: false, aufgabeNr: 'AG-2026-0002' });
    expect(await legeAufgabeAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: { Kurztitel: 'Motive Shop', vorgang: V(1) } })).toMatchObject({ schon: true, aufgabeNr: 'AG-2026-0002' });
    expect(t[TAB_AUFGABEN]).toHaveLength(3);
    expect(aufrufe.append).toBe(0);
    const au = await legeAuftragAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: { Kunden_Nr: 'K-00001', Kurztitel: 'x', status: 'Anfrage', vorgang: V(2), positionen: [{ art: 'frei', freitext: 'Tassen', menge: 1 }] } });
    expect(au.auftragNr).toBe('AU-2026-0002');
  });
  test('gleichzeitiges Anlegen: zweiter Aufruf waehrend der Sperre -> 409 laeuft_gerade, kein Doppel', async () => {
    const t = tabs({ aufgaben: [AG1] });
    const { sheets } = machSheets(t);
    const a = legeAufgabeAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: { Kurztitel: 'eins', vorgang: V(3) } });
    const b = legeAufgabeAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: { Kurztitel: 'zwei', vorgang: V(4) } });
    const [ra, rb] = await Promise.allSettled([a, b]);
    expect(ra.status).toBe('fulfilled');
    expect(rb.reason).toMatchObject({ status: 409, code: 'laeuft_gerade' });
    const nr = t[TAB_AUFGABEN].slice(1).map(z => z[0]);
    expect(new Set(nr).size).toBe(nr.length);
  });
  test('Status mit Stand, wartet mit Text; Partner muss aktiv sein', async () => {
    const t = tabs({ aufgaben: [AG1] });
    const { sheets } = machSheets(t);
    await expect(wechsleAufgabeStatus({ sheets, jetzt, eingabe: { aufgabeNr: 'AG-2026-0001', stand: 'alt', aktion: 'weiter' } })).rejects.toMatchObject({ status: 409, code: 'konflikt' });
    const r = await wechsleAufgabeStatus({ sheets, jetzt, eingabe: { aufgabeNr: 'AG-2026-0001', stand: 's-ag1', aktion: 'weiter' } });
    expect(r.status).toBe('in Arbeit');
    const st = t[TAB_AUFGABEN][1][AUFGABE_SPALTEN.indexOf('Stand')];
    await expect(wechsleAufgabeStatus({ sheets, jetzt, eingabe: { aufgabeNr: 'AG-2026-0001', stand: st, aktion: 'weiter' } })).rejects.toMatchObject({ code: 'wartet_auf' });
    await wechsleAufgabeStatus({ sheets, jetzt, eingabe: { aufgabeNr: 'AG-2026-0001', stand: st, aktion: 'weiter', wartetAuf: 'Muster vom Sticker' } });
    expect(t[TAB_AUFGABEN][1][AUFGABE_SPALTEN.indexOf('Wartet_Auf')]).toBe('Muster vom Sticker');
    const st2 = t[TAB_AUFGABEN][1][AUFGABE_SPALTEN.indexOf('Stand')];
    expect(await bearbeiteAufgabe({ sheets, jetzt, eingabe: { aufgabeNr: 'AG-2026-0001', stand: st2, Kurztitel: 'Motive Partner' } })).toMatchObject({ unveraendert: true });
  });
  test('To-dos bei AU und AG: anlegen, abhaken, verschieben, archivieren; storniert -> 409', async () => {
    const t = tabs({ auftraege: [AU1, AU_STORNO], aufgaben: [AG1] });
    const { sheets, aufrufe } = machSheets(t);
    const a1 = await legeTodoAn({ sheets, jetzt, eingabe: { bezug: 'AU-2026-0001', text: 'Motiv freigeben', vorgang: V(10) } });
    const a2 = await legeTodoAn({ sheets, jetzt, eingabe: { bezug: 'AU-2026-0001', text: 'Größen klären', faellig: '2026-11-03', vorgang: V(11) } });
    const g1 = await legeTodoAn({ sheets, jetzt, eingabe: { bezug: 'AG-2026-0001', text: 'Sticker anrufen', vorgang: V(12) } });
    expect([a1.todoId, a2.todoId, g1.todoId]).toEqual(['AU-2026-0001-T01', 'AU-2026-0001-T02', 'AG-2026-0001-T01']);
    expect(await legeTodoAn({ sheets, jetzt, eingabe: { bezug: 'AU-2026-0001', text: 'Motiv freigeben', vorgang: V(10) } })).toMatchObject({ schon: true });
    await expect(legeTodoAn({ sheets, jetzt, eingabe: { bezug: 'AU-2026-0002', text: 'x', vorgang: V(13) } })).rejects.toMatchObject({ status: 409 });
    await expect(legeTodoAn({ sheets, jetzt, eingabe: { bezug: 'AU-2026-0099', text: 'x', vorgang: V(14) } })).rejects.toMatchObject({ status: 404 });
    await verschiebeTodo({ sheets, jetzt, eingabe: { todoId: 'AU-2026-0001-T02', richtung: 'hoch' } });
    await aendereTodo({ sheets, jetzt, eingabe: { todoId: 'AU-2026-0001-T01', erledigt: true } });
    await archiviereTodo({ sheets, jetzt, eingabe: { todoId: 'AG-2026-0001-T01' } });
    const col = s => TODO_SPALTEN.indexOf(s);
    const z = id => t[TAB_TODOS].find(r => r[0] === id);
    expect(z('AU-2026-0001-T01')[col('Erledigt')]).toBe('ja');
    expect([z('AU-2026-0001-T01')[col('Reihenfolge')], z('AU-2026-0001-T02')[col('Reihenfolge')]]).toEqual(['2', '1']);
    expect(z('AG-2026-0001-T01')[col('Archiviert')]).toBe('2026-11-04');
    expect(t[TAB_TODOS]).toHaveLength(4);   // nie geloescht
    expect(aufrufe.append).toBe(0);
    _auftraegeCacheLeeren();
    const lese = await leseAuftraege({ sheets, jetzt });
    expect(lese.todos.map(x => x.Todo_ID).sort()).toEqual(['AU-2026-0001-T01', 'AU-2026-0001-T02']);
    expect(lese.zahlen).toMatchObject({ todosUeberfaellig: 1, aufgabenOffen: 1 });
    expect(lese.einrichtung).toEqual({ aufgaben: true, todos: true });
  });
  test('ohne neue Reiter: Auftraege lesen wie bisher, Aufgabe/To-do schreiben -> 409 einrichtung', async () => {
    const t = tabs({ auftraege: [AU1], ohne: [TAB_AUFGABEN, TAB_TODOS] });
    const { sheets } = machSheets(t);
    const r = await leseAuftraege({ sheets, jetzt });
    expect(r.auftraege.map(x => x.Auftrag_Nr)).toEqual(['AU-2026-0001']);
    expect(r).toMatchObject({ aufgaben: [], todos: [], einrichtung: { aufgaben: false, todos: false } });
    await expect(legeAufgabeAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: { Kurztitel: 'x', vorgang: V(20) } })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    await expect(legeTodoAn({ sheets, jetzt, eingabe: { bezug: 'AU-2026-0001', text: 'x', vorgang: V(21) } })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
  });
  test('bestehende Auftraege unveraendert: Antwort und Zahlen wie vorher, Aufgaben zaehlen nicht als Auftrag', async () => {
    const t = tabs({ auftraege: [AU1], aufgaben: [AG1, { ...AG1, Aufgabe_Nr: 'AG-2026-0002', Status: 'erledigt' }] });
    const { sheets } = machSheets(t);
    const r = await leseAuftraege({ sheets, jetzt });
    expect(r.auftraege).toHaveLength(1);
    expect(r.zahlen).toMatchObject({ offen: 1, aufgabenOffen: 1 });
    expect(r.aufgaben.map(x => x.Aufgabe_Nr)).toEqual(['AG-2026-0001', 'AG-2026-0002']);
    expect(r.aufgaben[0]).not.toHaveProperty('Vorgang');
  });
  test('Log nur Nummern - kein Kurztitel, kein To-do-Text', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { default: router } = await import('../routes/auftraege.js');
      const { sheets } = machSheets(tabs({ auftraege: [AU1], aufgaben: [AG1] }));
      await legeAufgabeAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: { Kurztitel: 'Geheimer Titel Erika', vorgang: V(30) } });
      await legeTodoAn({ sheets, jetzt, eingabe: { bezug: 'AG-2026-0002', text: 'Anruf bei Erika', vorgang: V(31) } });
      expect(router).toBeTruthy();
      const alles = [...log.mock.calls, ...warn.mock.calls].flat().join(' ');
      expect(alles).not.toMatch(/Erika|Geheimer/);
    } finally { log.mockRestore(); warn.mockRestore(); }
  });
});
