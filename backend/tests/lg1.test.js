// LG1: Lager bearbeiten (ein Knopf), Fertigware ueber den JFN-Shop (Name/SKU/Produkt-ID, einfache Artikel WC:<Produkt-ID>),
// Reiterwechsel leert Felder, "Fertig im Lager" in der Bestellkarte mit EINEM Schreibaufruf ueber Lager + L-Shop-Korb + DTF-Korb
// (Teilmenge ueber Aus_Lager). Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import {
  fertigSchluessel, fertigSuche, variantenAusShop, fertigInfoAus, fertigAusLagerPlan, fertigZurueckPlan, fertigFuerKarte,
  fertigAbgaengeJePosition, ausLagerSpaltePlan, GRUND_FERTIG, mengeGesamt,
} from '../utils/lager-fertig.js';
import { GRUND_FERTIG as GRUND_KORB, GRUENDE as KORB_GRUENDE, statusPlan as korbStatusPlan, hinweisFuer as hinweisFuerZeile, KORB_SPALTEN, TAB_KORB } from '../utils/korb-logic.js';
import { GRUND_FERTIG as GRUND_DTF, GRUENDE as DTF_GRUENDE, statusPlan as dtfStatusPlan, hinweisFuer, dtfAbgleichPlan, dtfKartenPlan,
  KORB_SPALTEN as DTF_SPALTEN, TAB_DTF_KORB } from '../utils/dtf-korb.js';
import { planGegenbuchung, buchungsVerlauf, QUELLE, TAB_BUCHUNGEN, TAB_ARTIKEL, TAB_ORTE, BUCHUNG_SPALTEN, ARTIKEL_SPALTEN, ORTE_SPALTEN, warenartVon } from '../utils/lager.js';
import { shopPositionStand } from '../utils/mika.js';
import { istGroessenAchse } from '../lib/groessen.js';
import { fertigAusLager, fertigZurueck, lagerCacheLeeren, _stammCacheLeeren, sucheFertig, fertigVarianten, bucheLager } from '../lib/lager.js';
import { _fertigCacheLeeren } from '../lib/lagerFertig.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { machSheets, grundTabs } from './hilfen/korb-sheet.js';

const JETZT = new Date('2026-11-28T09:00:00Z');
const V = n => `vorgang-lg1-${String(n).padStart(4, '0')}`;
const b = (id, schluessel, menge, ort, extra = {}) => ({ id, datum: '2026-11-27T08:00:00Z', art: 'vorrat', warenart: warenartVon(schluessel),
  schluessel, menge, ort, grund: '', bezug: '', quelle: 'knopf', notiz: '', stornoVon: '', vorgang: `v-${id}-xxxxxx`, ...extra });
const li = (o = {}) => ({ id: 5512, product_id: 700, variation_id: 501, quantity: 2, ...o });

describe('Schluessel und Suche', () => {
  test('WC:<Variation>, ohne Variation WC:<Produkt-ID> (einfacher Artikel), sonst leer', () => {
    expect(fertigSchluessel(li())).toBe('WC:501');
    expect(fertigSchluessel(li({ variation_id: 0, product_id: 14717 }))).toBe('WC:14717');
    expect(fertigSchluessel(li({ variation_id: '0', product_id: '0' }))).toBe('');
  });
  const liste = [
    { id: 14717, name: 'Testverein Fan-Schal 2026/2027', sku: 'TV-Fanschal-2627', type: 'simple', status: 'publish' },
    { id: 20908, name: 'Testverein Fluffy Schal', sku: 'CB496R/TV-Fluffy', type: 'variable', status: 'publish' },
    { id: 900, name: 'Testverein Trikot Heim', sku: 'TV-Trikot', type: 'variable', status: 'publish' },
    { id: 30000, name: 'Gruppe', sku: '', type: 'grouped', status: 'publish' },
  ];
  test('Name, SKU-Teil (die Shop-Suche kann das nicht), Produkt-ID; jedes Wort; ae = ä; Trikots und andere Typen raus', () => {
    const s = q => fertigSuche(liste, q, { ausschluss: new Set(['900']) }).artikel.map(a => a.id);
    expect(s('schal')).toEqual(['14717', '20908']);
    expect(s('fanschal')).toEqual(['14717']);              // SKU-Teil
    expect(s('CB496R')).toEqual(['20908']);
    expect(s('14717')).toEqual(['14717']);
    expect(s('schal fluffy')).toEqual(['20908']);
    expect(s('trikot')).toEqual([]);                        // Trikot: eigener Schluessel TR:
    expect(s('gruppe')).toEqual([]);
    expect(s('x')).toEqual([]);                             // < 2 Zeichen
    expect(fertigSuche(liste, 'tv-fanschal-2627').artikel[0]).toMatchObject({ id: '14717', artikelnummer: 'TV-Fanschal-2627', typ: 'simple' });
  });
  test('Zusatz-Suchtexte (Kurzbezeichnung, Variantenwerte aus der Maske)', () => {
    expect(fertigSuche(liste, 'blush', { zusatz: new Map([['20908', 'Blush Black']]) }).artikel.map(a => a.id)).toEqual(['20908']);
  });
  test('Varianten: einfacher Artikel = eine Zeile WC:<Produkt-ID>; variabel = je Variation mit Farbe/Groesse', () => {
    expect(variantenAusShop({ id: 14717, name: 'Schal', type: 'simple', sku: 'S', status: 'publish' }, [], istGroessenAchse).varianten)
      .toEqual([{ schluessel: 'WC:14717', farbe: '', groesse: '', sku: 'S', aktiv: true }]);
    const v = variantenAusShop({ id: 20908, name: 'Fluffy', type: 'variable' }, [
      { id: 20909, sku: 'a', status: 'publish', attributes: [{ name: 'Farbe', option: 'Blush' }] },
      { id: 20910, sku: 'b', status: 'private', attributes: [{ name: 'Farbe', option: 'Black' }, { name: 'Größe', option: 'M' }] },
    ], istGroessenAchse);
    expect(v.varianten.map(x => [x.schluessel, x.farbe, x.groesse, x.aktiv])).toEqual([['WC:20909', 'Blush', '', true], ['WC:20910', 'Black', 'M', false]]);
  });
  test('Shop-Info: Variation/einfach gueltig; variabler Eltern-Artikel, Trikot, unbekannt nicht', () => {
    const tr = new Set(['900']);
    expect(fertigInfoAus({ id: 14717, type: 'simple', name: 'Schal' }, { istGroesse: istGroessenAchse, trikotIds: tr })).toMatchObject({ gueltig: true, name: 'Schal' });
    expect(fertigInfoAus({ id: 20909, type: 'variation', parent_id: 20908, name: 'Fluffy', attributes: [{ name: 'Farbe', option: 'Blush' }] }, { istGroesse: istGroessenAchse }))
      .toMatchObject({ gueltig: true, farbe: 'Blush', produktId: '20908' });
    expect(fertigInfoAus({ id: 20908, type: 'variable' }, { istGroesse: istGroessenAchse }).gueltig).toBe(false);
    expect(fertigInfoAus({ id: 901, type: 'variation', parent_id: 900 }, { istGroesse: istGroessenAchse, trikotIds: tr })).toMatchObject({ gueltig: false, grund: expect.stringMatching(/Trikot/) });
    expect(fertigInfoAus(null, { istGroesse: istGroessenAchse }).gueltig).toBe(false);
  });
});

describe('aus Lager nehmen (Plan)', () => {
  const lager = [b('LB-2026-00001', 'WC:501', 3, 'Wrist'), b('LB-2026-00002', 'WC:501', 1, 'Itzehoe')];
  const korb = (o = {}) => ({ _zeile: 5, Schluessel: 'JFN:21593:5512', Status: 'offen', Menge: '2', Hinweis: '', Aus_Lager: '', ...o });
  const dtf = (o = {}) => ({ _zeile: 7, Schluessel: 'JFN:21593:5512:Brust', Status: 'offen', Menge: 2, Stand: 's1', Grund: '', Aus_Lager: '', ...o });
  const e = (o = {}) => ({ nummer: '21593', position: '5512', schluessel: 'WC:501', verteilung: [{ ort: 'Wrist', menge: 2 }],
    korb: { schluessel: 'JFN:21593:5512', status: 'offen' }, dtf: [{ schluessel: 'JFN:21593:5512:Brust', stand: 's1' }], vorgang: V(1), ...o });
  const k = (o = {}) => ({ li: li(), korbZeilen: [korb()], korbHatAusLager: true, dtfZeilen: [dtf()], dtfHatAusLager: true, buchungen: lager,
    orte: ['Wrist', 'Itzehoe'], jetzt: JETZT, ...o });

  test('ganze Menge: Abgang (Quelle fertig, Bezug Position), L-Shop- und DTF-Zeile abgewaehlt mit Grund "Fertigware aus Lager"', () => {
    const p = fertigAusLagerPlan(e(), k());
    expect(p.lagerZeilen).toEqual([expect.objectContaining({ Art: 'abgang_shop', Warenart: 'fertig', Schluessel: 'WC:501', Menge: -2, Ort: 'Wrist',
      Bezug: 'JFN:21593:5512', Quelle: 'fertig', Grund: GRUND_FERTIG, Vorgang: V(1) })]);
    expect(p.korb).toEqual([{ zeile: 5, schluessel: 'JFN:21593:5512', werte: expect.objectContaining({ Status: 'abgewählt', Grund: GRUND_FERTIG }) }]);
    expect(p.dtf).toEqual([{ zeile: 7, schluessel: 'JFN:21593:5512:Brust', werte: expect.objectContaining({ Status: 'abgewählt', Grund: GRUND_FERTIG }) }]);
    expect(p.korb[0].werte.Menge).toBeUndefined();   // Menge bleibt
  });
  test('Teilmenge (bestellt 2, Lager 1): Zeilen bleiben offen, Menge = Rest, Aus_Lager = 1', () => {
    const p = fertigAusLagerPlan(e({ verteilung: [{ ort: 'Itzehoe', menge: 1 }] }), k());
    expect(p.korb[0].werte).toMatchObject({ Menge: '1', Aus_Lager: '1' });
    expect(p.korb[0].werte.Status).toBeUndefined();
    expect(p.dtf[0].werte).toMatchObject({ Menge: '1', Aus_Lager: '1' });
    expect(mengeGesamt({ Menge: '1', Aus_Lager: '1' })).toBe(2);
  });
  test('Teilmenge ohne Spalte Aus_Lager -> 409 einrichtung; ganze Menge geht auch ohne Spalte', () => {
    expect(() => fertigAusLagerPlan(e({ verteilung: [{ ort: 'Wrist', menge: 1 }] }), k({ korbHatAusLager: false }))).toThrow(expect.objectContaining({ status: 409, code: 'einrichtung' }));
    expect(fertigAusLagerPlan(e(), k({ korbHatAusLager: false, dtfHatAusLager: false })).korb).toHaveLength(1);
  });
  test('Rohling schon bestellt / DTF bestellt: bleibt so (Hinweis); ohne Korb-Zeilen (Fremdware, Schal) nur der Abgang', () => {
    const p = fertigAusLagerPlan(e({ korb: { schluessel: 'JFN:21593:5512', status: 'bestellt' } }), k({ korbZeilen: [korb({ Status: 'bestellt' })], dtfZeilen: [dtf({ Status: 'bestellt' })] }));
    expect(p.korb).toEqual([]);
    expect(p.dtf).toEqual([]);
    expect(p.hinweise.join(' ')).toMatch(/L-Shop-Korb: „bestellt“ – bleibt so.*DTF-Korb: „bestellt“/);
    const schal = fertigAusLagerPlan(e({ korb: null, dtf: [] }), k({ korbZeilen: [], dtfZeilen: [] }));
    expect(schal).toMatchObject({ korb: [], dtf: [], hinweise: [] });
    expect(schal.lagerZeilen).toHaveLength(1);
  });
  test.each([
    [{ verteilung: [{ ort: 'Itzehoe', menge: 2 }] }, {}, 422, /nur 1 da/],                         // nie negativ
    [{ verteilung: [{ ort: 'Wrist', menge: 3 }] }, {}, 422, /braucht noch 2/],                     // nie mehr als bestellt
    [{ schluessel: 'WC:999' }, {}, 409, /passt nicht mehr/],
    [{ korb: null }, {}, 409, /L-Shop-Korb hat sich/],                                             // Korb-Zeile neu dazugekommen
    [{ dtf: [] }, {}, 409, /DTF-Korb hat sich/],
    [{}, { dtfZeilen: [dtf({ Stand: 's2' })] }, 409, /DTF-Korb hat sich/],
    [{}, { korbZeilen: [korb({ Hinweis: 'Bestellung storniert' })] }, 422, /storniert/],
    [{}, { trikot: true }, 422, /Trikot/],
    [{}, { li: null }, 409, /gibt es/],
    [{ vorgang: 'x' }, {}, 422, /Kennung/],
    [{}, { korbZeilen: [korb({ Aus_Lager: '1' })] }, 409, /schon 1 aus dem Lager/],
  ])('abgelehnt %#', (eo, ko, status, re) => {
    expect(() => fertigAusLagerPlan(e(eo), k(ko))).toThrow(expect.objectContaining({ status, message: expect.stringMatching(re) }));
  });
  test('zweimal nehmen geht nicht; gleiche Vorgangs-Kennung = schon gebucht; von Hand ausgebucht zaehlt mit', () => {
    const schon = [...lager, b('LB-2026-00003', 'WC:501', -1, 'Wrist', { art: 'abgang_shop', quelle: 'fertig', bezug: 'JFN:21593:5512', vorgang: V(1) })];
    expect(fertigAusLagerPlan(e(), k({ buchungen: schon })).schonGebucht).toHaveLength(1);
    expect(() => fertigAusLagerPlan(e({ vorgang: V(2) }), k({ buchungen: schon }))).toThrow(/erst „zurück“/);
    const hand = [...lager, b('LB-2026-00003', 'WC:501', -1, 'Wrist', { art: 'abgang_shop', quelle: 'knopf', bezug: 'JFN:21593:5512' })];
    expect(() => fertigAusLagerPlan(e(), k({ buchungen: hand }))).toThrow(/braucht noch 1/);
  });
});

describe('zurück (Plan)', () => {
  const ab = [b('LB-2026-00001', 'WC:501', 3, 'Wrist'), b('LB-2026-00002', 'WC:501', -2, 'Wrist', { art: 'abgang_shop', quelle: 'fertig', bezug: 'JFN:21593:5512' })];
  test('Gegenbuchung je offener Fertig-Buchung; abgewaehlte Zeilen offen, Teilmenge Menge + Aus_Lager', () => {
    const p = fertigZurueckPlan({ nummer: '21593', position: '5512', vorgang: V(5) }, { buchungen: ab, jetzt: JETZT,
      korbZeilen: [{ _zeile: 5, Schluessel: 'JFN:21593:5512', Status: 'abgewählt', Grund: GRUND_FERTIG, Menge: '2' }],
      dtfZeilen: [{ _zeile: 7, Schluessel: 'JFN:21593:5512:Brust', Status: 'offen', Menge: '1', Aus_Lager: '1' }] });
    expect(p.lagerZeilen).toEqual([expect.objectContaining({ Art: 'korrektur', Menge: 2, Storno_von: 'LB-2026-00002', Quelle: 'fertig', Schluessel: 'WC:501' })]);
    expect(p.korb[0].werte).toMatchObject({ Status: 'offen', Grund: '' });
    expect(p.dtf[0].werte).toMatchObject({ Menge: '2', Aus_Lager: '' });
  });
  test('Rest schon bestellt: Zeile bleibt, Hinweis; ohne offene Buchung 409', () => {
    const p = fertigZurueckPlan({ nummer: '21593', position: '5512', vorgang: V(6) }, { buchungen: ab, jetzt: JETZT,
      korbZeilen: [{ _zeile: 5, Schluessel: 'JFN:21593:5512', Status: 'bestellt', Menge: '1', Aus_Lager: '1' }] });
    expect(p.korb).toEqual([]);
    expect(p.hinweise[0]).toMatch(/von Hand nachbestellen/);
    expect(() => fertigZurueckPlan({ nummer: '21593', position: '9', vorgang: V(7) }, { buchungen: ab })).toThrow(expect.objectContaining({ status: 409 }));
  });
  test('Fertig-Buchungen nur ueber "zurück" (nie im Lager-Verlauf von Hand gegenbuchbar)', () => {
    const r = planGegenbuchung({ buchungId: 'LB-2026-00002', vorgang: V(8) }, { buchungen: ab, jetzt: JETZT });
    expect(r.probleme[0].text).toMatch(/Bestellungen \(JFN\)/);
    expect(QUELLE.FERTIG).toBe('fertig');
    expect(buchungsVerlauf(ab, () => ({})).find(x => x.id === 'LB-2026-00002').gegenbuchbar).toBe(false);
    expect(fertigAbgaengeJePosition(ab).get('JFN:21593:5512')).toEqual([{ id: 'LB-2026-00002', ort: 'Wrist', menge: 2, schluessel: 'WC:501' }]);
  });
});

describe('Koerbe: Grund, Abgleich, Sperre von Hand', () => {
  test('ein Grund, gleiche Zeichenkette in beiden Koerben, nicht von Hand waehlbar', () => {
    expect(GRUND_FERTIG).toBe('Fertigware aus Lager');
    expect(GRUND_KORB).toBe(GRUND_FERTIG);
    expect(GRUND_DTF).toBe(GRUND_FERTIG);
    expect(KORB_GRUENDE).not.toContain(GRUND_FERTIG);
    expect(DTF_GRUENDE).not.toContain(GRUND_FERTIG);
  });
  test('L-Shop-Abgleich vergleicht die Shop-Menge mit Menge + Aus_Lager (kein falscher "Menge geändert")', () => {
    const o = { status: 'processing', line_items: [{ id: 5512, quantity: 2 }] };
    expect(hinweisFuerZeile({ Position: '5512', Menge: '1', Aus_Lager: '1' }, o)).not.toMatch(/Menge/);
    expect(hinweisFuerZeile({ Position: '5512', Menge: '1' }, o)).toMatch(/Menge/);
  });
  test('L-Shop-Korb und DTF-Korb: Zeile mit Grund Fertigware nicht von Hand zurueckholen', () => {
    expect(() => korbStatusPlan({ zeilen: [{ _zeile: 2, Schluessel: 'A', Status: 'abgewählt', Grund: GRUND_FERTIG }], auswahl: [{ schluessel: 'A', status: 'abgewählt' }],
      ziel: 'offen', jetzt: JETZT.toISOString() })).toThrow(/zurück/);
    expect(() => dtfStatusPlan({ Status: 'abgewählt', Grund: GRUND_FERTIG, Stand: 's' }, { ziel: 'offen', stand: 's' })).toThrow(/zurück/);
    const zeilen = [{ Schluessel: 'JFN:1:2:Brust', Status: 'abgewählt', Grund: GRUND_FERTIG, Stand: 's' }];
    expect(() => dtfKartenPlan(zeilen, { ziel: 'bestellen', gesehen: [{ schluessel: 'JFN:1:2:Brust', stand: 's' }] })).toThrow(/Fertigware/);
  });
  test('DTF-Abgleich: Hinweis mit Menge + Aus_Lager; neue Druckposition uebernimmt den Lager-Stand der Position', () => {
    const quellen = new Map([['JFN:1', { zustand: 'offen', positionen: new Map([['2', { menge: 2, dtf: true }]]) }]]);
    expect(hinweisFuer({ Quelle: 'JFN', Nummer: '1', Position: '2', Menge: '1', Aus_Lager: '1' }, quellen)).toBe('');
    const k = { quelle: 'JFN', nummer: '1', position: '2', datum: '2026-11-27', menge: 2, druckpositionen: ['Ruecken'] };
    const ganz = dtfAbgleichPlan({ vorhanden: [{ Schluessel: 'JFN:1:2:Brust', Quelle: 'JFN', Nummer: '1', Position: '2', Druckposition: 'Brust', Status: 'abgewählt', Grund: GRUND_FERTIG }], kandidaten: [k], quellen });
    expect(ganz.neu[0]).toMatchObject({ Druckposition: 'Ruecken', Status: 'abgewählt', Grund: GRUND_FERTIG });
    const teil = dtfAbgleichPlan({ vorhanden: [{ Schluessel: 'JFN:1:2:Brust', Quelle: 'JFN', Nummer: '1', Position: '2', Druckposition: 'Brust', Status: 'offen', Menge: '1', Aus_Lager: '1' }], kandidaten: [k], quellen });
    expect(teil.neu[0]).toMatchObject({ Status: 'offen', Menge: 1, Aus_Lager: '1' });
  });
  test('Setup: Kopfzelle hinter der letzten belegten, vorhanden = nichts', () => {
    expect(ausLagerSpaltePlan([['Schluessel', 'Menge'], ['a', '1']])).toEqual({ da: false, spalte: 2, belegt: 0, kopfBreite: 2 });
    expect(ausLagerSpaltePlan([['Schluessel', 'Aus_Lager']]).da).toBe(true);
  });
});

describe('Bestellkarte und Mika', () => {
  const bestandJe = new Map([['WC:501', { summe: 3, orte: [{ ort: 'Wrist', menge: 3 }] }], ['WC:14717', { summe: 10, orte: [{ ort: 'Wrist', menge: 10 }] }]]);
  test('"Fertig im Lager": nur JFN, nie Trikot/fertig/versendet; einfacher Artikel ueber die Produkt-ID; Korb + DTF wie gesehen', () => {
    const f = fertigFuerKarte({ jfn: true, orderId: '21593', li: li(), korbZeile: { Schluessel: 'JFN:21593:5512', Status: 'offen' },
      dtfZeilen: [{ schluessel: 'JFN:21593:5512:Brust', stand: 's1', status: 'offen' }], bestandJe });
    expect(f).toMatchObject({ schluessel: 'WC:501', n: 3, menge: 2, bedarf: 2, genommen: 0, korb: { status: 'offen' }, dtf: [{ schluessel: 'JFN:21593:5512:Brust', stand: 's1' }] });
    expect(fertigFuerKarte({ jfn: true, orderId: '1', li: li({ variation_id: 0, product_id: 14717 }), bestandJe }).n).toBe(10);
    for (const o of [{ jfn: false }, { trikot: true }, { fertig: true }, { versendet: true }]) {
      expect(fertigFuerKarte({ jfn: true, orderId: '1', li: li(), bestandJe, ...o })).toBeNull();
    }
    expect(fertigFuerKarte({ jfn: true, orderId: '1', li: li({ variation_id: 777 }), bestandJe })).toBeNull();
  });
  test('Mika nennt Fertigware', () => {
    expect(shopPositionStand({ fertigLager: { n: 3, genommen: 0 } })).toMatch(/fertig im Lager 3/);
    expect(shopPositionStand({ fertigLager: { n: 0, genommen: 2 } })).toMatch(/Fertigware aus Lager genommen: 2/);
  });
});

describe('lib: Suche ueber den Shop, Buchen einfacher Artikel, aus Lager nehmen in EINEM Schreibaufruf', () => {
  const ORDER = { id: 21593, status: 'processing', line_items: [{ id: 5512, product_id: 14717, variation_id: 0, quantity: 2 }] };
  const wcAttrappe = () => {
    const get = jest.fn(async (pfad, q = {}) => {
      if (pfad === 'products') return { data: q.page === 1 ? [{ id: 14717, name: 'Testverein Fan-Schal', sku: 'TV-Fanschal', type: 'simple', status: 'publish' }] : [] };
      if (pfad === 'products/14717') return { data: { id: 14717, name: 'Testverein Fan-Schal', type: 'simple', sku: 'TV-Fanschal', status: 'publish' } };
      if (pfad === 'orders/21593') return { data: ORDER };
      throw Object.assign(new Error('nicht da'), { response: { status: 404 } });
    });
    return { get };
  };
  const tabsMit = ({ korb = [], dtf = [], buchungen = [], ausLager = true } = {}) => {
    const tabs = grundTabs();
    const ks = ausLager ? [...KORB_SPALTEN, 'Aus_Lager'] : KORB_SPALTEN;
    const ds = ausLager ? [...DTF_SPALTEN, 'Aus_Lager'] : DTF_SPALTEN;
    tabs[TAB_KORB] = [ks, ...korb.map(o => ks.map(n => o[n] ?? ''))];
    tabs[TAB_DTF_KORB] = [ds, ...dtf.map(o => ds.map(n => o[n] ?? ''))];
    tabs[TAB_BUCHUNGEN] = [BUCHUNG_SPALTEN, ...buchungen.map(o => BUCHUNG_SPALTEN.map(n => o[n] ?? ''))];
    tabs[TAB_ORTE] = [ORTE_SPALTEN, ['Wrist', 'aktiv', ''], ['Itzehoe', 'aktiv', '']];
    tabs[TAB_ARTIKEL] = [ARTIKEL_SPALTEN];
    tabs.Trikots = [['Produktname', 'Groesse']];
    return tabs;
  };
  const zugang = (id, menge) => ({ Buchung_ID: id, Datum: '2026-11-27T08:00:00Z', Art: 'vorrat', Warenart: 'fertig', Schluessel: 'WC:14717', Menge: menge,
    Ort: 'Wrist', Quelle: 'knopf', Vorgang: `v-${id}-xxxxxx` });
  beforeEach(() => {
    process.env.GOOGLE_SHEET_ID = 'ssot'; process.env.BUSINESS_SHEET_ID = 'ssot';
    _resetLShopCache(); lagerCacheLeeren(); _stammCacheLeeren(); _fertigCacheLeeren();
  });

  test('Suche "fanschal" findet den einfachen Artikel, Auswahl = WC:<Produkt-ID>; Einbuchen geht (im Shop geprueft)', async () => {
    const wc = wcAttrappe();
    const { sheets } = machSheets(tabsMit());
    expect((await sucheFertig({ q: 'fanschal', sheets, wcFuer: () => wc })).artikel.map(a => a.id)).toEqual(['14717']);
    expect((await fertigVarianten({ ssotId: '14717', sheets, wcFuer: () => wc })).varianten.map(v => v.schluessel)).toEqual(['WC:14717']);
    const r = await bucheLager({ eingabe: { aktion: 'einbuchen', art: 'vorrat', ort: 'Wrist', vorgang: V(20), posten: [{ schluessel: 'WC:14717', menge: 10 }] },
      sheets, wcFuer: () => wc, jetzt: () => JETZT });
    expect(r).toMatchObject({ ok: true, stueck: 10 });
  });

  test('aus Lager nehmen: Journal + L-Shop-Korb + DTF-Korb in EINEM batchUpdate, kein append; zurück stellt alles wieder her', async () => {
    const wc = wcAttrappe();
    const tabs = tabsMit({
      korb: [{ Schluessel: 'JFN:21593:5512', Shop: 'JFN', Herkunft: 'shop', Bestellnummer: '21593', Position: '5512', LShop_ArticleNr: '1000326843', Menge: '2', Status: 'offen' }],
      dtf: [{ Schluessel: 'JFN:21593:5512:Brust', Quelle: 'JFN', Nummer: '21593', Position: '5512', Druckposition: 'Brust', Menge: 2, Status: 'offen', Stand: 's1' }],
      buchungen: [zugang('LB-2026-00001', 10)],
    });
    const { sheets, aufrufe } = machSheets(tabs);
    const r = await fertigAusLager({ eingabe: { nummer: '21593', position: '5512', schluessel: 'WC:14717', verteilung: [{ ort: 'Wrist', menge: 1 }],
      korb: { schluessel: 'JFN:21593:5512', status: 'offen' }, dtf: [{ schluessel: 'JFN:21593:5512:Brust', stand: 's1' }], vorgang: V(21) },
      sheets, wcFuer: () => wc, jetzt: () => JETZT });
    expect(r).toMatchObject({ ok: true, stueck: 1, buchungen: ['LB-2026-00002'] });
    expect(aufrufe.append).toBe(0);
    const ks = tabs[TAB_KORB][0], ds = tabs[TAB_DTF_KORB][0];
    expect(tabs[TAB_KORB][1][ks.indexOf('Menge')]).toBe('1');
    expect(tabs[TAB_KORB][1][ks.indexOf('Aus_Lager')]).toBe('1');
    expect(tabs[TAB_DTF_KORB][1][ds.indexOf('Menge')]).toBe('1');
    expect(tabs[TAB_BUCHUNGEN][2].slice(2, 10)).toEqual(['abgang_shop', 'fertig', 'WC:14717', -1, 'Wrist', GRUND_FERTIG, 'JFN:21593:5512', 'fertig']);
    // Doppelklick: nichts doppelt
    const n = aufrufe.batchUpdate.length;
    expect(await fertigAusLager({ eingabe: { nummer: '21593', position: '5512', vorgang: V(21) }, sheets, wcFuer: () => wc })).toMatchObject({ schonGebucht: true });
    expect(aufrufe.batchUpdate.length).toBe(n);
    // zurück
    const z = await fertigZurueck({ eingabe: { nummer: '21593', position: '5512', vorgang: V(22) }, sheets, jetzt: () => JETZT });
    expect(z).toMatchObject({ ok: true, stueck: 1 });
    expect(tabs[TAB_KORB][1][ks.indexOf('Menge')]).toBe('2');
    expect(tabs[TAB_KORB][1][ks.indexOf('Aus_Lager')]).toBe('');
    expect(tabs[TAB_BUCHUNGEN][3][BUCHUNG_SPALTEN.indexOf('Storno_von')]).toBe('LB-2026-00002');
  });
});

describe('Oberflaeche', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  test('Teil A: ein Knopf „Lager bearbeiten …“ als Hauptaktion, Einbuchen vorgewaehlt', () => {
    expect(html).toMatch(/class="korb-aktion korb-aktion-haupt" data-lager-aktion="einbuchen" data-hilfe="lager-bearbeiten">Lager bearbeiten …<\/button>/);
    expect(html).not.toMatch(/>Korrektur \(Inventur\) …</);
  });
  test('Teil B6: Reiterwechsel leert Grund, Notiz, Art, Zaehlung, Bezug, Liste, Mengen - Ort und Artikel bleiben', () => {
    const fn = html.slice(html.indexOf('function lagerReiterLeeren'), html.indexOf('function lagerModus('));
    for (const id of ['lager-grund', 'lager-notiz', 'lager-start', 'lager-art']) expect(fn).toContain(`'${id}'`);
    expect(fn).toMatch(/retoure: null/);
    expect(fn).toMatch(/event: ''/);
    expect(fn).not.toMatch(/lager-ort'|warenart/);
    expect(html).toMatch(/if \(b\.dataset\.lagerModus !== lagerDlg\.modus\) lagerReiterLeeren\(\);/);
  });
  test('Teil B: Suche nach Name, SKU, Produkt-ID; Treffer-ID = Produkt-ID', () => {
    expect(html).toMatch(/Name, SKU oder Produkt-ID/);
    expect(html).toMatch(/id: a\.id \?\? a\.ssotId/);
  });
  test('Teil C: Karte zeigt „Fertig im Lager: n (Ort)“ und die Knoepfe; Rueckfrage vor dem Buchen', () => {
    const start = html.indexOf('function psFertigHtml'), ende = html.indexOf('function psLagerHtml(');
    const F = new Function(`const psEsc = s => String(s ?? '');\n${html.slice(start, ende)}\nreturn { psFertigHtml, psFertigKorbText };`)();
    const a = { wcItemId: '5512', fertigLager: { n: 3, orte: [{ ort: 'Wrist', menge: 3 }], bedarf: 2, genommen: 0, menge: 2 } };
    const h = F.psFertigHtml('21593', a);
    expect(h).toContain('Fertig im Lager: 3 (Wrist)');
    expect(h).toContain('data-ps-fertig="nehmen"');
    const g = F.psFertigHtml('21593', { ...a, fertigLager: { ...a.fertigLager, genommen: 2 } });
    expect(g).toContain('Fertigware aus Lager genommen: 2');
    expect(g).toContain('data-ps-fertig="zurueck"');
    expect(F.psFertigKorbText({ korb: { status: 'offen' }, dtf: [{}], menge: 2 }, 1).join(' ')).toMatch(/nur der Rest/);
    expect(html).toMatch(/showConfirm\('Fertigware aus Lager nehmen'/);
  });
});
