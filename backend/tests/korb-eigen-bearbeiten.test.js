// BO6-1: eigene Positionen im L-Shop-Warenkorb nachtraeglich bearbeiten. Backend (utils/korb-logic.js
// eigenBearbeitenPlan, lib/lshopKorb.js bearbeiteEigenePosition) mit der Korb-Attrappe, Frontend-Block
// "Eigen-Bearbeiten" aus index.html. Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KORB_SPALTEN, TAB_KORB, korbZeilen, buendele, eigenBearbeitenPlan, aenderungText, korbSpaltePlan, SPALTE_AENDERUNG } from '../utils/korb-logic.js';
import { bearbeiteEigenePosition, _korbCacheLeeren, BESCHAEFTIGT } from '../lib/lshopKorb.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { lagerCacheLeeren, _stammCacheLeeren } from '../lib/lager.js';
import { TAB_BUCHUNGEN, TAB_ARTIKEL, TAB_ORTE, BUCHUNG_SPALTEN, ARTIKEL_SPALTEN, ORTE_SPALTEN } from '../utils/lager.js';
import { machSheets, grundTabs, NR } from './hilfen/korb-sheet.js';

const JETZT = '2026-11-02T10:00:00.000Z';
const jetzt = () => new Date(JETZT);
const S1 = '2026-10-30T09:00:00.000Z';
const Q_WS = '2000000002', Q_WM = '2000000001', Q_WXL = '2000000006', Q_BS = '2000000007', Q_DISC = '2000000003';
const KOPF = [...KORB_SPALTEN, 'Lager_Ziel', SPALTE_AENDERUNG];

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot';
  process.env.BUSINESS_SHEET_ID = 'ssot';
  _korbCacheLeeren(); _resetLShopCache(); lagerCacheLeeren(); _stammCacheLeeren();
});

function zeile(o) {
  const z = { Shop: 'JFN', Herkunft: 'eigen', 'SSOT-ID': '', Status: 'offen', Grund: '', Hinweis: '', Status_Datum: S1, Bestell_ID: '',
    Notiz: '', Angelegt: S1, Quelle_Lauf: 'Knopf', Stand: S1, Lager_Ziel: '', [SPALTE_AENDERUNG]: '', Referenz: 'Lager', Menge: '2', ...o };
  return KOPF.map(n => z[n] ?? '');
}
function tabs({ kopf = KOPF } = {}) {
  const t = grundTabs();
  const [lk, ...lr] = t.LShop_Modelle;
  t.LShop_Modelle = [[...lk, 'Brand', 'CatNrManufacturer', 'Description'], ...lr.map(r => [...r, 'James & Nicholson', 'JN030', '']),
    [Q_WM, 'BCWW02Q', 'White', '', 'M', '', '', '0', 'aktiv', 'B&C', 'TW02Q', 'Queen Women T-Shirt'],
    [Q_WS, 'BCWW02Q', 'White', '', 'S', '', '', '0', 'aktiv', 'B&C', 'TW02Q', 'Queen Women T-Shirt'],
    [Q_WXL, 'BCWW02Q', 'White', '', 'XL', '', '', '0', 'aktiv', 'B&C', 'TW02Q', 'Queen Women T-Shirt'],
    [Q_BS, 'BCWW02Q', 'Black', '', 'S', '', '', '0', 'aktiv', 'B&C', 'TW02Q', 'Queen Women T-Shirt'],
    [Q_DISC, 'BCWW02Q', 'Black', '', 'M', '', '', '6', 'aktiv', 'B&C', 'TW02Q', 'Queen Women T-Shirt']];
  const zeilen = [
    zeile({ Schluessel: 'EIGEN:2026-0001', LShop_ArticleNr: Q_WM }),
    zeile({ Schluessel: 'EIGEN:2026-0002', LShop_ArticleNr: Q_WS, Status: 'abgewählt', Grund: 'Sonstiges' }),
    zeile({ Schluessel: 'EIGEN:2026-0003', LShop_ArticleNr: Q_WS, Status: 'bestellt', Bestell_ID: 'JFN-2026-0007' }),
    zeile({ Schluessel: 'EIGEN:2026-0004', LShop_ArticleNr: Q_WS, Status: 'geliefert' }),
    zeile({ Schluessel: 'EIGEN:2026-0005', LShop_ArticleNr: Q_WS, Status: 'Lager' }),
    zeile({ Schluessel: 'JFN:21593:5512', Herkunft: 'shop', Bestellnummer: '21593', Position: '5512', Referenz: '', LShop_ArticleNr: NR, Menge: '1' }),
  ];
  t[TAB_KORB] = [kopf, ...zeilen.map(r => r.slice(0, kopf.length))];
  t[TAB_BUCHUNGEN] = [BUCHUNG_SPALTEN];
  t[TAB_ORTE] = [ORTE_SPALTEN, ['Wrist', 'aktiv', ''], ['Itzehoe', 'aktiv', '']];
  t[TAB_ARTIKEL] = [ARTIKEL_SPALTEN];
  return t;
}
function aufbau(o) {
  const t = tabs(o);
  return { tabs: t, ...machSheets(t) };
}
const finde = (t, s) => korbZeilen(t[TAB_KORB]).zeilen.find(z => z.Schluessel === s);
const eingabe = (o = {}) => ({ schluessel: 'EIGEN:2026-0001', status: 'offen', stand: S1, articleNr: Q_WM, menge: 2, referenz: 'Lager', notiz: '', ...o });

describe('bearbeiteEigenePosition (Korb-Attrappe)', () => {
  test('Menge und Groesse: genau diese Zeile, nur geaenderte Zellen, kein append, Spur + Stand/Status_Datum neu', async () => {
    const { tabs: t, sheets, aufrufe } = aufbau();
    const vorher = t[TAB_KORB].map(z => [...z]);
    const r = await bearbeiteEigenePosition({ sheets, jetzt, eingabe: eingabe({ articleNr: Q_WXL, menge: 3 }) });
    expect(r).toMatchObject({ ok: true, schluessel: 'EIGEN:2026-0001', aenderung: 'geändert 02.11.: Menge 2 → 3, M → XL', articleNr: Q_WXL, menge: '3' });
    expect(aufrufe.append).toBe(0);
    expect(aufrufe.update).toHaveLength(0);
    expect(aufrufe.batchUpdate.every(r => /!\D+2$/.test(r))).toBe(true);   // nur Zeile 2
    const z = finde(t, 'EIGEN:2026-0001');
    expect(z).toMatchObject({ LShop_ArticleNr: Q_WXL, Menge: '3', Stand: JETZT, Status_Datum: JETZT, Status: 'offen',
      Herkunft: 'eigen', Angelegt: S1, Referenz: 'Lager', [SPALTE_AENDERUNG]: 'geändert 02.11.: Menge 2 → 3, M → XL' });
    vorher.forEach((zz, i) => { if (i !== 1) expect(t[TAB_KORB][i]).toEqual(zz); });
  });
  test('Farbe, Referenz, Notiz, Lager_Ziel; zweite Aenderung haengt an die Spur an', async () => {
    const { tabs: t, sheets } = aufbau();
    await bearbeiteEigenePosition({ sheets, jetzt, eingabe: eingabe({ articleNr: Q_BS }) });
    expect(finde(t, 'EIGEN:2026-0001')[SPALTE_AENDERUNG]).toBe('geändert 02.11.: White M → Black S');
    const r = await bearbeiteEigenePosition({ sheets, jetzt: () => new Date('2026-11-03T08:00:00Z'),
      eingabe: eingabe({ stand: JETZT, articleNr: Q_BS, referenz: 'Muster', notiz: 'neu', lagerZiel: 'Wrist' }) });
    expect(r.aenderung).toBe('geändert 03.11.: Referenz „Lager“ → „Muster“, Notiz geändert, Lager – → Wrist');
    expect(finde(t, 'EIGEN:2026-0001')).toMatchObject({ Referenz: 'Muster', Notiz: 'neu', Lager_Ziel: 'Wrist',
      [SPALTE_AENDERUNG]: `geändert 02.11.: White M → Black S | ${r.aenderung}` });
  });
  test('herausgenommene Position ist bearbeitbar, Status und Grund bleiben', async () => {
    const { tabs: t, sheets } = aufbau();
    await bearbeiteEigenePosition({ sheets, jetzt, eingabe: eingabe({ schluessel: 'EIGEN:2026-0002', status: 'abgewählt', articleNr: Q_WS, menge: 5 }) });
    expect(finde(t, 'EIGEN:2026-0002')).toMatchObject({ Menge: '5', Status: 'abgewählt', Grund: 'Sonstiges' });
  });
  test('Shop-Position, bestellt, geliefert, Lager -> 422, nichts geschrieben', async () => {
    const faelle = [['JFN:21593:5512', 'offen', NR, /Shop-Positionen/], ['EIGEN:2026-0003', 'bestellt', Q_WS, /bestellt/],
      ['EIGEN:2026-0004', 'geliefert', Q_WS, /geliefert/], ['EIGEN:2026-0005', 'Lager', Q_WS, /Lager/]];
    for (const [schluessel, status, articleNr, grund] of faelle) {
      const { sheets, aufrufe } = aufbau();
      await expect(bearbeiteEigenePosition({ sheets, jetzt, eingabe: eingabe({ schluessel, status, articleNr, menge: 4 }) }))
        .rejects.toMatchObject({ status: 422, message: expect.stringMatching(grund) });
      expect(aufrufe.batchUpdate).toHaveLength(0);
    }
  });
  test('ungueltige Nummer (Discontinued 6, ausgelaufen, anderes Modell, unbekannt) und Unsinn -> 422, nichts geschrieben', async () => {
    for (const e of [{ articleNr: Q_DISC }, { articleNr: NR }, { articleNr: '9999999999' }, { articleNr: '123' },
      { menge: 0 }, { menge: 1000 }, { menge: 1.5 }, { referenz: ' ' }, { notiz: 'x'.repeat(201) }, { lagerZiel: 'Mond' }]) {
      const { sheets, aufrufe } = aufbau();
      await expect(bearbeiteEigenePosition({ sheets, jetzt, eingabe: eingabe({ menge: 3, ...e }) })).rejects.toMatchObject({ status: 422 });
      expect(aufrufe.batchUpdate).toHaveLength(0);
    }
  });
  test('Zeile seit dem Laden geaendert (Stand/Status anders) -> 409, nichts geschrieben', async () => {
    for (const e of [{ stand: '2026-10-01T00:00:00.000Z' }, { status: 'abgewählt' }]) {
      const { sheets, aufrufe } = aufbau();
      await expect(bearbeiteEigenePosition({ sheets, jetzt, eingabe: eingabe({ menge: 3, ...e }) })).rejects.toMatchObject({ status: 409 });
      expect(aufrufe.batchUpdate).toHaveLength(0);
    }
  });
  test('Zeile aendert sich zwischen Lesen und Schreiben (andere Instanz) -> 409 aus ersetzeZeile, nichts geschrieben', async () => {
    const { tabs: t, sheets, aufrufe } = aufbau();
    const get = sheets.spreadsheets.values.get;
    sheets.spreadsheets.values.get = async a => {
      if (/!A2:/.test(a.range)) t[TAB_KORB][1][KOPF.indexOf('Notiz')] = 'von woanders';
      return get(a);
    };
    await expect(bearbeiteEigenePosition({ sheets, jetzt, eingabe: eingabe({ menge: 3 }) })).rejects.toMatchObject({ status: 409 });
    expect(aufrufe.batchUpdate).toHaveLength(0);
  });
  test('Doppelklick: gleichzeitig -> zweiter 409 (Sperre); nochmal mit altem Stand -> unveraendert, nichts doppelt', async () => {
    const { tabs: t, sheets, aufrufe } = aufbau();
    const e = eingabe({ menge: 3 });
    const [a, b] = await Promise.allSettled([bearbeiteEigenePosition({ sheets, jetzt, eingabe: e }), bearbeiteEigenePosition({ sheets, jetzt, eingabe: e })]);
    expect(a.status).toBe('fulfilled');
    expect(b.reason).toMatchObject({ status: 409, message: BESCHAEFTIGT });
    const n = aufrufe.batchUpdate.length;
    expect(await bearbeiteEigenePosition({ sheets, jetzt, eingabe: e })).toMatchObject({ ok: true, unveraendert: true });
    expect(aufrufe.batchUpdate).toHaveLength(n);
    expect(finde(t, 'EIGEN:2026-0001')[SPALTE_AENDERUNG]).toBe('geändert 02.11.: Menge 2 → 3');
  });
  test('ohne Spalte Aenderung -> 409 einrichtung, nichts geschrieben; nichts geaendert geht trotzdem (unveraendert)', async () => {
    const { sheets, aufrufe } = aufbau({ kopf: [...KORB_SPALTEN, 'Lager_Ziel'] });
    await expect(bearbeiteEigenePosition({ sheets, jetzt, eingabe: eingabe({ menge: 3 }) })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    expect(await bearbeiteEigenePosition({ sheets, jetzt, eingabe: eingabe() })).toMatchObject({ unveraendert: true });
    expect(aufrufe.batchUpdate).toHaveLength(0);
  });
  test('Buendel danach: geaenderte ArticleNr wandert ins richtige Buendel, Summen stimmen', async () => {
    const { tabs: t, sheets } = aufbau();
    await bearbeiteEigenePosition({ sheets, jetzt, eingabe: eingabe({ articleNr: Q_WXL, menge: 3 }) });
    const b = buendele(korbZeilen(t[TAB_KORB]).zeilen.filter(z => ['offen', 'abgewählt'].includes(z.Status)));
    expect(b.find(x => x.articleNr === Q_WM)).toBeUndefined();
    const xl = b.find(x => x.articleNr === Q_WXL);
    expect(xl).toMatchObject({ zuBestellen: 3 });
    expect(xl.positionen[0]).toMatchObject({ schluessel: 'EIGEN:2026-0001', menge: 3, stand: JETZT, aenderung: 'geändert 02.11.: Menge 2 → 3, M → XL' });
  });
});

describe('Logik', () => {
  test('aenderungText: unbekannte Variante -> Nummern, nichts geaendert -> leer', () => {
    const alt = { Menge: '1', LShop_ArticleNr: Q_WM, Referenz: 'a', Notiz: '', Lager_Ziel: 'Wrist' };
    expect(aenderungText({ alt, neu: { ...alt, LShop_ArticleNr: Q_WS, Lager_Ziel: '' }, jetzt: JETZT }))
      .toBe(`geändert 02.11.: ${Q_WM} → ${Q_WS}, Lager Wrist → –`);
    expect(aenderungText({ alt, neu: alt, jetzt: JETZT })).toBe('');
  });
  test('bisherige Nummer bleibt erlaubt, auch wenn sie nicht mehr waehlbar ist (nur Menge aendern)', () => {
    const { zeilen, idx } = korbZeilen(tabs()[TAB_KORB]);
    const p = eigenBearbeitenPlan({ zeilen, idx, eingabe: eingabe({ menge: 4 }), varianten: [], jetzt: JETZT });
    expect(p.nachher).toMatchObject({ LShop_ArticleNr: Q_WM, Menge: '4' });
  });
  test('korbSpaltePlan: haengt hinter die letzte Kopfspalte, erkennt vorhandene', () => {
    expect(korbSpaltePlan([KORB_SPALTEN], SPALTE_AENDERUNG)).toMatchObject({ da: false, spalte: KORB_SPALTEN.length, belegt: 0 });
    expect(korbSpaltePlan([KOPF], SPALTE_AENDERUNG)).toMatchObject({ da: true, spalte: KOPF.length - 1 });
  });
});

// ── Frontend-Block ──
const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const ausschnitt = (a, e) => html.slice(html.indexOf(a), html.indexOf(e));
const F = new Function(`${ausschnitt('// ── Groessen: Anfang', '// ── Groessen: Ende ──')}
${ausschnitt('// ── Eigene-Raster: Anfang', '// ── Eigene-Raster: Ende ──')}
${ausschnitt('// ── Eigen-Bearbeiten: Anfang', '// ── Eigen-Bearbeiten: Ende ──')}
return { ebKnopfHtml, ebGroessen, ebAnfrage, ebVorschau };`)();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

describe('Frontend-Block Eigen-Bearbeiten', () => {
  test('Knopf: eigene offen/herausgenommen aktiv, bestellt/geliefert/Lager gesperrt mit Grund, Shop ohne Knopf', () => {
    expect(F.ebKnopfHtml({ herkunft: 'eigen', status: 'offen', schluessel: 'EIGEN:2026-0001' }, esc)).toMatch(/data-eigen-bearbeiten="EIGEN:2026-0001" data-hilfe="eb-bearbeiten"/);
    expect(F.ebKnopfHtml({ herkunft: 'eigen', status: 'abgewählt', schluessel: 'E' }, esc)).toMatch(/data-eigen-bearbeiten/);
    expect(F.ebKnopfHtml({ herkunft: 'eigen', status: 'Lager', schluessel: 'E' }, esc)).toMatch(/aria-disabled="true" data-hilfe="eb-gesperrt-lager"/);
    // bestellt/geliefert: in L-Shop-Bestellungen (lbPositionHtml), ebenfalls gesperrt mit Grund
    const lb = ausschnitt('function lbPositionHtml', 'let lbMitAb');
    for (const key of ['eb-gesperrt-bestellt', 'eb-gesperrt-geliefert', 'eb-gesperrt-lager']) {
      if (key !== 'eb-gesperrt-lager') expect(lb).toMatch(new RegExp(`aria-disabled="true" data-hilfe="${key}"`));
      expect(html).toMatch(new RegExp(`'${key}':\\s+\\{ name:`));
    }
    expect(F.ebKnopfHtml({ herkunft: 'shop', status: 'offen', schluessel: 'J' }, esc)).toBe('');
    expect(F.ebKnopfHtml({ herkunft: 'eigen', status: 'offen' }, esc)).not.toMatch(/title=/);
  });
  test('Groessen: Reihenfolge wie im Raster, bisherige (ausgelaufene) Nummer bleibt waehlbar', () => {
    const v = [{ farbe: 'White', groesse: 'XL', articleNr: Q_WXL }, { farbe: 'White', groesse: 'S', articleNr: Q_WS }];
    expect(F.ebGroessen(v, 'White', { farbe: 'White', groesse: 'M', articleNr: Q_WM }).map(g => [g.groesse, !!g.bisher]))
      .toEqual([['M', true], ['S', false], ['XL', false]]);
    expect(F.ebGroessen(v, 'White', { farbe: 'White', groesse: 'S', articleNr: Q_WS }).map(g => g.groesse)).toEqual(['S', 'XL']);
  });
  test('Vorschau und Anfrage', () => {
    const p = { schluessel: 'E', status: 'offen', stand: S1, menge: 2, articleNr: Q_WM, referenz: 'Lager', notiz: '', lagerZiel: '' };
    const f = { articleNr: Q_WXL, menge: '3', referenz: 'Lager', notiz: '', lagerZiel: 'Wrist' };
    expect(F.ebVorschau(p, f, { [Q_WM]: 'White M', [Q_WXL]: 'White XL' }).text).toBe('Ändert: Menge 2 → 3, White M → White XL, Lager – → Wrist');
    expect(F.ebVorschau(p, { ...f, articleNr: Q_WM, menge: '2', lagerZiel: '' }).text).toBe('Noch nichts geändert.');
    expect(F.ebVorschau(p, { ...f, menge: '0', referenz: '' }).fehler).toEqual(['Menge 1–999', 'Referenz fehlt']);
    expect(F.ebAnfrage(p, f)).toEqual({ schluessel: 'E', status: 'offen', stand: S1, articleNr: Q_WXL, menge: 3, referenz: 'Lager', notiz: '', lagerZiel: 'Wrist' });
  });
  test('Dialog: jedes Feld und jeder Knopf hat einen Mouse-over, kein title', () => {
    const dlg = ausschnitt('<div id="eb-dialog"', '<!-- BO3b');
    for (const id of ['eb-abbrechen', 'eb-farbe', 'eb-groesse', 'eb-menge', 'eb-referenz', 'eb-notiz', 'eb-speichern']) expect(dlg).toMatch(new RegExp(`id="${id}"[^>]*data-hilfe="`));
    expect(dlg).toMatch(/data-hilfe="eb-lager"/);
    expect(dlg).not.toMatch(/title=/);
  });
});
