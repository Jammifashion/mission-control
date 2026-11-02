// BO5-6: Retouren (Bestellung Pflicht, Positionen aus dem Shop nur gelesen, nie mehr zurueck als bestellt, Trikot ohne
// Rueckennamen) und Storno nach "aus Lager nehmen" (Abgleich schreibt nur den Hinweis, "zurueck ins Lager" in einem
// Schritt). Nur erfundene Daten.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KORB_SPALTEN, TAB_KORB, STATUS, HINWEIS, brauchtHinweisPruefung, hinweisFuerZeile } from '../utils/korb-logic.js';
import { TAB_BUCHUNGEN, TAB_ARTIKEL, TAB_ORTE, BUCHUNG_SPALTEN, ARTIKEL_SPALTEN, ORTE_SPALTEN, warenartVon, planBuchung,
  retoureBestellung, retourenMengen } from '../utils/lager.js';
import { stornoZurueckPlan, STORNO_GRUND } from '../utils/lager-korb.js';
import { bucheLager, leseRetourePositionen, lagerCacheLeeren, _stammCacheLeeren } from '../lib/lager.js';
import { ausLagerNehmen, stornoZurueckInsLager } from '../lib/lagerKorb.js';
import { leseKorb, runKorbAbgleich, _korbCacheLeeren } from '../lib/lshopKorb.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { machSheets, grundTabs, machWc, pos, bestellung, NR } from './hilfen/korb-sheet.js';

const JETZT = new Date('2026-11-03T09:00:00Z');
const V = n => `vorgang-retoure-${String(n).padStart(4, '0')}`;
const b = (id, schluessel, menge, ort, extra = {}) => ({ id, datum: '2026-11-01T08:00:00Z', art: 'vorrat', warenart: warenartVon(schluessel),
  schluessel, menge, ort, grund: '', bezug: '', quelle: 'knopf', notiz: '', stornoVon: '', vorgang: `v-${id}-xxxxxx`, ...extra });

describe('Retoure: Logik', () => {
  test.each([
    ['JFN:21593', { shop: 'jfn', nr: '21593', kennung: 'JFN:21593' }],
    ['HONK:21593', { shop: 'honk', nr: '21593', kennung: 'HONK:21593' }],
    [' JFN:7 ', { shop: 'jfn', nr: '7', kennung: 'JFN:7' }],
  ])('Bestellung %s', (s, soll) => expect(retoureBestellung(s)).toEqual(soll));
  test.each(['', '21593', 'JFN:', 'jfn:21593', 'JFN:21593:5512', 'SHOP:1', 'JFN:abc'])('keine Bestellung: %j', s => expect(retoureBestellung(s)).toBeNull());

  test('schon zurueckgebucht je Position und je Bestellung, Gegenbuchungen abgezogen', () => {
    const bs = [
      b('LB-2026-00001', 'WC:501', 1, 'Wrist', { art: 'retoure', bezug: 'JFN:21593:5512' }),
      b('LB-2026-00002', 'WC:501', 1, 'Wrist', { art: 'retoure', bezug: 'JFN:21593:5512' }),
      b('LB-2026-00003', 'WC:501', -1, 'Wrist', { art: 'korrektur', stornoVon: 'LB-2026-00002' }),
      b('LB-2026-00004', 'TR:900:M', 1, 'Wrist', { art: 'retoure', bezug: 'JFN:21593:5513' }),
      b('LB-2026-00005', 'WC:501', 1, 'Wrist', { art: 'retoure', bezug: 'HONK:21593:5512' }),
    ];
    const m = retourenMengen(bs);
    expect(m.get('JFN:21593:5512')).toBe(1);
    expect(m.get('JFN:21593:5513')).toBe(1);
    expect(m.get('JFN:21593')).toBe(2);
    expect(m.get('HONK:21593')).toBe(1);   // beide Shops getrennt, gleiche Nummer stoert nicht
  });

  const ein = (posten, o = {}) => ({ aktion: 'einbuchen', art: 'retoure', ort: 'Wrist', bezug: 'JFN:21593', vorgang: V(1), posten, ...o });
  const plan = (e, buchungen = [], grenzen = new Map([['JFN:21593:5512', 2], ['JFN:21593:5513', 1]])) =>
    planBuchung(e, { buchungen, orte: ['Wrist'], gueltig: () => true, bezugPruefen: () => true, retoureGrenzen: grenzen, jetzt: JETZT });

  test('Teilretoure: Art retoure, Bezug je Position, Zugang', () => {
    const p = plan(ein([{ schluessel: 'WC:501', menge: 1, bezug: 'JFN:21593:5512' }]));
    expect(p.probleme).toEqual([]);
    expect(p.zeilen).toEqual([expect.objectContaining({ Art: 'retoure', Schluessel: 'WC:501', Menge: 1, Ort: 'Wrist', Bezug: 'JFN:21593:5512' })]);
  });
  test('ohne Bestellung -> nicht gebucht', () => {
    const p = planBuchung(ein([{ schluessel: 'WC:501', menge: 1 }], { bezug: '' }), { buchungen: [], orte: ['Wrist'], gueltig: () => true,
      bezugPruefen: (art, bz) => (art === 'retoure' ? Boolean(retoureBestellung(bz)) || 'Bitte die Shop-Bestellung angeben' : true), jetzt: JETZT });
    expect(p.probleme[0].text).toMatch(/Shop-Bestellung/);
  });
  test('nie mehr zurueck als bestellt: je Position mit "schon n zurückgebucht"', () => {
    const vorher = [b('LB-2026-00001', 'WC:501', 1, 'Wrist', { art: 'retoure', bezug: 'JFN:21593:5512' })];
    const p = plan(ein([{ schluessel: 'WC:501', menge: 2, bezug: 'JFN:21593:5512' }], { vorgang: V(2) }), vorher);
    expect(p.probleme.map(x => x.text)).toEqual([expect.stringMatching(/bestellt 2, schon 1 zurückgebucht - 2 geht nicht/)]);
    expect(plan(ein([{ schluessel: 'WC:501', menge: 1, bezug: 'JFN:21593:5512' }], { vorgang: V(3) }), vorher).probleme).toEqual([]);
  });
  test('ohne Positionsbezug zaehlt die Bestellung als Ganzes; Bezug einer anderen Bestellung wird abgelehnt', () => {
    const p = plan(ein([{ schluessel: 'WC:501', menge: 4 }]));
    expect(p.probleme.map(x => x.text).join(' ')).toMatch(/3 Teile bestellt, schon 0 zurückgebucht - 4 geht nicht/);
    expect(plan(ein([{ schluessel: 'WC:501', menge: 1, bezug: 'JFN:99999:1' }])).probleme.length).toBeGreaterThan(0);
  });
});

// ── Schreibweg gegen das In-Memory-Sheet ─────────────────────────────────────
function lagerTabs({ korb = [], buchungen = [] } = {}) {
  const tabs = grundTabs();
  tabs[TAB_KORB] = [KORB_SPALTEN, ...korb.map(o => KORB_SPALTEN.map(n => o[n] ?? ''))];
  tabs[TAB_BUCHUNGEN] = [BUCHUNG_SPALTEN, ...buchungen.map(o => BUCHUNG_SPALTEN.map(n => o[n] ?? ''))];
  tabs[TAB_ORTE] = [ORTE_SPALTEN, ['Wrist', 'aktiv', ''], ['Regal A', 'aktiv', '']];
  tabs[TAB_ARTIKEL] = [ARTIKEL_SPALTEN];
  tabs.Trikots = [['Produktname', 'Groesse'], ['Trikot Heim', 'M']];
  tabs.Erfassungsmaske.push(['0009', '900', 'Trikot Heim', 'TR-H']);
  return tabs;
}
const RUECKEN = 'Maxi Muster - 10';   // erfundener Rueckenname, darf nirgends ankommen
const shopBestellung = (id, status = 'completed') => ({ id, status, line_items: [
  { id: 5512, product_id: 100, variation_id: 501, quantity: 2, name: 'Ugly Sweater - Deep Black, 2XL', meta_data: [{ key: 'pa_groesse', display_key: 'Größe', display_value: '2XL' }] },
  { id: 5513, product_id: 900, variation_id: 901, quantity: 1, name: `Trikot Heim - M, ${RUECKEN}`, parent_name: 'Trikot Heim',
    meta_data: [{ key: 'pa_groesse', display_key: 'Größe', display_value: 'M' }, { key: 'name-nummer', display_key: 'Name - Nummer', display_value: RUECKEN }] },
  { id: 5514, product_id: 200, variation_id: 0, quantity: 1, name: 'Tasse', meta_data: [] },
] });
// WC-Attrappe: nur get('orders/<id>') - es gibt keinen Schreibweg.
function wcMit(orders) {
  const aufrufe = [];
  const client = shop => ({ get: jest.fn(async pfad => {
    aufrufe.push(`${shop}:${pfad}`);
    const o = orders[shop]?.[pfad.replace('orders/', '')];
    if (!o) { const e = new Error('nicht da'); e.response = { status: 404 }; throw e; }
    return { data: o };
  }) });
  return { wcFuer: client, aufrufe };
}
const zugang = (id, schluessel, menge, ort, o = {}) => ({ Buchung_ID: id, Datum: '2026-11-01T08:00:00Z', Art: 'vorrat', Warenart: warenartVon(schluessel),
  Schluessel: schluessel, Menge: menge, Ort: ort, Quelle: 'knopf', Vorgang: `v-${id}-xxxxxx`, ...o });

describe('lib: Retoure', () => {
  beforeEach(() => {
    process.env.GOOGLE_SHEET_ID = 'ssot'; process.env.BUSINESS_SHEET_ID = 'biz';
    _resetLShopCache(); _korbCacheLeeren(); lagerCacheLeeren(); _stammCacheLeeren();
  });

  test('Positionen-Vorschlag: Fertigware WC:, Trikot TR: ohne Rueckenname, Sonstiges ohne Vorschlag', async () => {
    const { sheets } = machSheets(lagerTabs());
    const { wcFuer, aufrufe } = wcMit({ jfn: { 21593: shopBestellung(21593) } });
    const r = await leseRetourePositionen({ bestellung: 'JFN:21593', sheets, wcFuer });
    expect(aufrufe).toEqual(['jfn:orders/21593']);
    expect(r.positionen.map(p => [p.bezug, p.menge, p.schluessel, p.schon])).toEqual([
      ['JFN:21593:5512', 2, 'WC:501', 0], ['JFN:21593:5513', 1, 'TR:900:M', 0], ['JFN:21593:5514', 1, '', 0]]);
    expect(r.positionen[1].name).toBe('Trikot Heim');
    expect(JSON.stringify(r)).not.toMatch(/Maxi|Muster/);
  });
  test('HONK: gleiche Positionen, aber kein WC-Vorschlag (Varianten im Sheet sind JFN-IDs); unbekannte Bestellung 404', async () => {
    const { sheets } = machSheets(lagerTabs());
    const { wcFuer, aufrufe } = wcMit({ honk: { 777: shopBestellung(777) } });
    const r = await leseRetourePositionen({ bestellung: 'HONK:777', sheets, wcFuer });
    expect(aufrufe).toEqual(['honk:orders/777']);
    expect(r.positionen.map(p => p.schluessel)).toEqual(['', 'TR:900:M', '']);
    await expect(leseRetourePositionen({ bestellung: 'JFN:1', sheets, wcFuer })).rejects.toMatchObject({ status: 404 });
    await expect(leseRetourePositionen({ bestellung: '21593', sheets, wcFuer })).rejects.toMatchObject({ status: 422 });
  });

  test('Teilretoure buchen, zweite Teilretoure, dann mehr als bestellt -> 422 ohne Schreiben; Doppelklick schreibt nichts', async () => {
    const tabs = lagerTabs();
    const { sheets, aufrufe } = machSheets(tabs);
    const { wcFuer } = wcMit({ jfn: { 21593: shopBestellung(21593) } });
    const ein = (n, posten) => ({ aktion: 'einbuchen', art: 'retoure', ort: 'Wrist', bezug: 'JFN:21593', vorgang: V(n), posten });
    const r1 = await bucheLager({ eingabe: ein(10, [{ schluessel: 'WC:501', menge: 1, bezug: 'JFN:21593:5512' }, { schluessel: 'TR:900:M', menge: 1, bezug: 'JFN:21593:5513' }]),
      sheets, wcFuer, jetzt: () => JETZT });
    expect(r1).toMatchObject({ ok: true, zeilen: 2, stueck: 2 });
    expect(aufrufe.append).toBe(0);
    const iA = BUCHUNG_SPALTEN.indexOf('Art'), iB = BUCHUNG_SPALTEN.indexOf('Bezug');
    expect(tabs[TAB_BUCHUNGEN].slice(1).map(z => [z[iA], z[iB]])).toEqual([['retoure', 'JFN:21593:5512'], ['retoure', 'JFN:21593:5513']]);
    expect(JSON.stringify(tabs[TAB_BUCHUNGEN])).not.toMatch(/Maxi|Muster/);
    const zwei = await bucheLager({ eingabe: ein(10, [{ schluessel: 'WC:501', menge: 1, bezug: 'JFN:21593:5512' }]), sheets, wcFuer, jetzt: () => JETZT });
    expect(zwei).toMatchObject({ ok: true, schonGebucht: true });
    lagerCacheLeeren();
    await bucheLager({ eingabe: ein(11, [{ schluessel: 'WC:501', menge: 1, bezug: 'JFN:21593:5512' }]), sheets, wcFuer, jetzt: () => JETZT });
    lagerCacheLeeren();
    const vorher = tabs[TAB_BUCHUNGEN].length;
    await expect(bucheLager({ eingabe: ein(12, [{ schluessel: 'WC:501', menge: 1, bezug: 'JFN:21593:5512' }]), sheets, wcFuer, jetzt: () => JETZT }))
      .rejects.toMatchObject({ status: 422, message: expect.stringMatching(/schon 2 zurückgebucht/) });
    expect(tabs[TAB_BUCHUNGEN].length).toBe(vorher);
    lagerCacheLeeren();
    const r = await leseRetourePositionen({ bestellung: 'JFN:21593', sheets, wcFuer });
    expect(r.positionen.map(p => p.schon)).toEqual([2, 1, 0]);
    expect(r.schonGesamt).toBe(3);
  });
});

// ── Storno nach "aus Lager nehmen" ────────────────────────────────────────────
const kz = o => ({ Schluessel: 'JFN:21593:5512', Shop: 'JFN', Herkunft: 'shop', Bestellnummer: '21593', Position: '5512', 'SSOT-ID': '0001',
  LShop_ArticleNr: NR, Menge: '2', Status: 'offen', Angelegt: '2026-11-01T08:00:00Z', ...o });

describe('Storno-Hinweis fuer Lager-Positionen', () => {
  test('geprueft werden Lager-Zeilen aus dem Shop der letzten 60 Tage, nicht eigene, nicht aeltere', () => {
    expect(brauchtHinweisPruefung(kz({ Status: STATUS.LAGER, Status_Datum: '2026-10-01T08:00:00Z' }), JETZT)).toBe(true);
    expect(brauchtHinweisPruefung(kz({ Status: STATUS.LAGER, Status_Datum: '2026-08-01T08:00:00Z' }), JETZT)).toBe(false);
    expect(brauchtHinweisPruefung(kz({ Status: STATUS.LAGER, Herkunft: 'eigen' }), JETZT)).toBe(false);
    expect(brauchtHinweisPruefung(kz({ Status: STATUS.GELIEFERT }), JETZT)).toBe(false);
  });
  test('an Lager-Zeilen nur Storno/Erstattung/Bestellung weg/Menge - "abgeschlossen" und "unbezahlt" sind dort normal', () => {
    const z = kz({ Status: STATUS.LAGER });
    expect(hinweisFuerZeile(z, bestellung(21593, 'cancelled', [pos(5512, 100, 501, 2)]))).toBe(HINWEIS.STORNIERT);
    expect(hinweisFuerZeile(z, bestellung(21593, 'refunded', [pos(5512, 100, 501, 2)]))).toBe(HINWEIS.ERSTATTET);
    expect(hinweisFuerZeile(z, bestellung(21593, 'completed', [pos(5512, 100, 501, 2)]))).toBe('');
    expect(hinweisFuerZeile(z, bestellung(21593, 'on-hold', [pos(5512, 100, 501, 2)]))).toBe('');
    expect(hinweisFuerZeile(z, bestellung(21593, 'processing', [pos(5512, 100, 501, 1)]))).toBe(HINWEIS.MENGE);
    expect(hinweisFuerZeile(kz(), bestellung(21593, 'completed', [pos(5512, 100, 501, 2)]))).toBe(HINWEIS.ABGESCHLOSSEN);
  });
  test('Plan: ohne Hinweis abgelehnt (dafuer ist "zurück in den Korb" da); mit Hinweis Status abgewählt + Grund', () => {
    const buchungen = [b('LB-2026-00001', `LS:${NR}`, 3, 'Wrist'),
      b('LB-2026-00002', `LS:${NR}`, -2, 'Wrist', { art: 'abgang_shop', quelle: 'korb', bezug: 'JFN:21593:5512' })];
    const k = zeilen => ({ korbZeilen: zeilen, buchungen, orte: ['Wrist'], jetzt: JETZT });
    expect(() => stornoZurueckPlan({ schluessel: 'JFN:21593:5512', vorgang: V(20) }, k([{ ...kz({ Status: 'Lager' }), _zeile: 2 }])))
      .toThrow(expect.objectContaining({ status: 422 }));
    const p = stornoZurueckPlan({ schluessel: 'JFN:21593:5512', vorgang: V(21) }, k([{ ...kz({ Status: 'Lager', Hinweis: HINWEIS.STORNIERT }), _zeile: 2 }]));
    expect(p.korb.werte).toMatchObject({ Status: 'abgewählt', Grund: STORNO_GRUND });
    expect(STORNO_GRUND).toBe('Bestellung storniert');
    expect(p.lagerZeilen.map(z => [z.Art, z.Ort, z.Menge, z.Storno_von])).toEqual([['korrektur', 'Wrist', 2, 'LB-2026-00002']]);
  });
});

describe('lib: Abgleich + zurueck ins Lager', () => {
  beforeEach(() => {
    process.env.GOOGLE_SHEET_ID = 'ssot'; process.env.BUSINESS_SHEET_ID = 'ssot';
    _resetLShopCache(); _korbCacheLeeren(); lagerCacheLeeren(); _stammCacheLeeren();
  });
  const iS = KORB_SPALTEN.indexOf('Status'), iH = KORB_SPALTEN.indexOf('Hinweis'), iG = KORB_SPALTEN.indexOf('Grund');

  async function stornierteLagerPosition() {
    const tabs = lagerTabs({ korb: [kz()], buchungen: [zugang('LB-2026-00001', `LS:${NR}`, 3, 'Wrist')] });
    const ms = machSheets(tabs);
    await ausLagerNehmen({ eingabe: { schluessel: 'JFN:21593:5512', status: 'offen', verteilung: [{ ort: 'Wrist', menge: 2 }], vorgang: V(30) }, sheets: ms.sheets, jetzt: () => JETZT });
    const vorher = ms.aufrufe.batchUpdate.length;
    await runKorbAbgleich({ sheets: ms.sheets, jetzt: () => JETZT,
      wcFuer: () => machWc([], { alle: [bestellung(21593, 'cancelled', [pos(5512, 100, 501, 2)])] }) });
    return { tabs, ...ms, abgleichSchreibt: ms.aufrufe.batchUpdate.slice(vorher) };
  }

  test('Abgleich schreibt an die Lager-Zeile nur den Hinweis - Status und Lager bleiben', async () => {
    const { tabs, abgleichSchreibt, sheets } = await stornierteLagerPosition();
    expect(tabs[TAB_KORB][1][iS]).toBe('Lager');
    expect(tabs[TAB_KORB][1][iH]).toBe(HINWEIS.STORNIERT);
    expect(abgleichSchreibt.every(r => r.startsWith(`'${TAB_KORB}'`))).toBe(true);
    expect(tabs[TAB_BUCHUNGEN].length).toBe(3);   // Zugang + Korb-Abgang, nichts dazu
    lagerCacheLeeren(); _korbCacheLeeren();
    const d = await leseKorb({ shop: 'jfn', sheets });
    expect(d.buendel[0].positionen[0]).toMatchObject({ status: 'Lager', hinweis: HINWEIS.STORNIERT });
  });

  test('"zurück ins Lager": EIN batchUpdate ueber beide Reiter, abgewählt + Grund, Bestand wieder da; Doppelklick nichts', async () => {
    const { tabs, sheets, aufrufe } = await stornierteLagerPosition();
    const vorher = aufrufe.batchUpdate.length;
    const r = await stornoZurueckInsLager({ eingabe: { schluessel: 'JFN:21593:5512', vorgang: V(31) }, sheets, jetzt: () => JETZT });
    expect(r).toMatchObject({ ok: true, buchungen: ['LB-2026-00003'] });
    const neu = aufrufe.batchUpdate.slice(vorher);
    expect(neu.some(x => x.startsWith(`'${TAB_KORB}'`))).toBe(true);
    expect(neu).toContain(`'${TAB_BUCHUNGEN}'!A4:N4`);
    expect(aufrufe.append).toBe(0);
    expect([tabs[TAB_KORB][1][iS], tabs[TAB_KORB][1][iG]]).toEqual(['abgewählt', 'Bestellung storniert']);
    const iM = BUCHUNG_SPALTEN.indexOf('Menge'), iSv = BUCHUNG_SPALTEN.indexOf('Storno_von');
    expect([tabs[TAB_BUCHUNGEN][3][iM], tabs[TAB_BUCHUNGEN][3][iSv]]).toEqual([2, 'LB-2026-00002']);
    const n = aufrufe.batchUpdate.length;
    expect(await stornoZurueckInsLager({ eingabe: { schluessel: 'JFN:21593:5512', vorgang: V(31) }, sheets, jetzt: () => JETZT }))
      .toMatchObject({ ok: true, schonGebucht: true });
    expect(aufrufe.batchUpdate.length).toBe(n);
    lagerCacheLeeren(); _korbCacheLeeren();
    const d = await leseKorb({ shop: 'jfn', sheets });
    expect(d.buendel[0].lager.summe).toBe(3);
  });

  test('alles oder nichts: Journal belegt (andere Instanz) -> 409, Korb unveraendert', async () => {
    const { tabs, sheets, aufrufe } = await stornierteLagerPosition();
    const get = sheets.spreadsheets.values.get;
    let n = 0;
    sheets.spreadsheets.values.get = async a => {
      const r = await get(a);
      if (String(a.range) === `'${TAB_BUCHUNGEN}'` && n++ === 0) tabs[TAB_BUCHUNGEN].push(['LB-2026-00009']);
      return r;
    };
    const vorher = aufrufe.batchUpdate.length;
    lagerCacheLeeren();
    await expect(stornoZurueckInsLager({ eingabe: { schluessel: 'JFN:21593:5512', vorgang: V(32) }, sheets, jetzt: () => JETZT }))
      .rejects.toMatchObject({ status: 409 });
    expect(aufrufe.batchUpdate.length).toBe(vorher);
    expect(tabs[TAB_KORB][1][iS]).toBe('Lager');
  });
});

describe('Frontend', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const block = html.slice(html.indexOf('// ── Korb-Lager: Anfang'), html.indexOf('// ── Korb-Lager: Ende ──'));
  const F = new Function(`${block}\nreturn { korbLagerHtml };`)();

  test('Lager-Position mit Hinweis: gelb + Knopf "zurück ins Lager" statt "zurück in den Korb"', () => {
    const p = { schluessel: 'JFN:21593:5512', status: 'Lager', menge: 2, hinweis: 'Bestellung storniert', lagerAbgang: [{ ort: 'Wrist', menge: 2 }] };
    const h = F.korbLagerHtml(p, { articleNr: NR, lager: null });
    expect(h).toMatch(/class="korb-storno" data-hilfe="lager-storno-hinweis">⚠ Bestellung storniert – zurück ins Lager\?/);
    expect(h).toMatch(/data-lager-storno="JFN:21593:5512" data-hilfe="lager-storno-zurueck">zurück ins Lager</);
    expect(h).not.toMatch(/data-lager-zurueck/);
    expect(F.korbLagerHtml({ ...p, hinweis: '' }, { articleNr: NR, lager: null })).toMatch(/data-lager-zurueck=/);
  });
  test('Verlauf: Retoure verlinkt die JFN-Bestellung, HONK nur Text; Retoure-Dialog mit Hilfen', () => {
    expect(html).toMatch(/b\.art === 'retoure' && b\.bezug \? lagerRetoureBezugHtml\(b\)/);
    expect(html).toMatch(/data-lager-bestellung="\$\{korbEsc\(m\[2\]\)\}" data-hilfe="lager-retoure-link"/);
    for (const k of ['lager-retoure-bestellung', 'lager-retoure-laden', 'lager-retoure-link', 'lager-storno-hinweis', 'lager-storno-zurueck']) {
      expect(html).toMatch(new RegExp(`'${k}':\\s+\\{ name:`));
    }
    expect(html).toMatch(/Nicht einbuchen – das ist Ausschuss/);
  });
});
