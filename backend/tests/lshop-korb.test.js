// BO2: L-Shop-Warenkorb als stehender Bestand (utils/korb-logic.js, lib/lshopKorb.js).
// Idempotenz, Storno nur als Hinweis, HONK-Kollision, Trikot/einfach ausgeschlossen,
// Schreiben ueber Zielzeilen ohne values.append.

import { jest } from '@jest/globals';
import {
  KORB_SPALTEN, KLASSE, HINWEIS, STATUS, TAB_KORB,
  baueKontext, stufeEin, abgleichPlan, hinweisFuer, buendele, ersteFreieZeile, korbZeilen,
} from '../utils/korb-logic.js';
import { runKorbAbgleich, leseKorb, _korbCacheLeeren } from '../lib/lshopKorb.js';
import { _resetLShopCache } from '../lib/lshop.js';

import { machSheets, grundTabs, machWc, pos, bestellung, NR, NR2 } from './hilfen/korb-sheet.js';

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot';
  process.env.BUSINESS_SHEET_ID = 'ssot';   // Trikot_Artikel liegt im selben Test-Sheet
  _korbCacheLeeren();
  _resetLShopCache();
});

// ── Einstufung ───────────────────────────────────────────────────────────────
describe('stufeEin', () => {
  const ktx = () => {
    const t = grundTabs();
    return baueKontext({
      varMap: { 501: { ssotId: '0001' }, 601: { ssotId: '0002' } },
      varianten: t.Varianten,
      produktIdJeSsot: { '0001': '100', '0002': '200' },
      lshop: [{ articleNr: NR, status: 'aktiv', discontinued: '0' }],
      extern: [{ CatalogNr: 'EXT1', Artikel_WC_IDs: '700' }],
      trikotIds: ['900'],
    });
  };
  const p = { type: 'variable', lieferzeit: '' };
  test.each([
    ['bestellbar', pos(1, 100, 501), p, KLASSE.BESTELLBAR],
    ['Trikot ueber Trikot_Artikel', pos(1, 900, 501), p, KLASSE.TRIKOT],
    ['Trikot ueber _lieferzeit 666', pos(1, 100, 501), { ...p, lieferzeit: '666' }, KLASSE.TRIKOT],
    ['Fremdware', pos(1, 700, 0), p, KLASSE.EXTERN],
    ['einfacher Artikel', pos(1, 100, 0), p, KLASSE.EINFACH],
    ['Produkt fehlt', pos(1, 100, 501), undefined, KLASSE.PRODUKT_FEHLT],
    ['Variation nicht in Varianten', pos(1, 100, 999), p, KLASSE.OHNE_VARIANTE],
    ['HONK-Kollision: gleiche Variations-ID, anderes Produkt', pos(1, 333, 501), p, KLASSE.FREMDES_PRODUKT],
    ['Nummer leer', pos(1, 200, 601), p, KLASSE.NR_LEER],
  ])('%s', (_n, li, prod, klasse) => {
    expect(stufeEin(li, prod, ktx()).klasse).toBe(klasse);
  });

  test('ausgelaufen und Discontinued 3/6 nicht bestellbar', () => {
    for (const m of [{ status: 'ausgelaufen', discontinued: '0' }, { status: 'aktiv', discontinued: '3' }, { status: 'aktiv', discontinued: '6' }]) {
      const k = ktx();
      k.modelle.set(NR, { articleNr: NR, ...m });
      expect(stufeEin(pos(1, 100, 501), p, k).klasse).toBe(KLASSE.AUSGELAUFEN);
    }
  });
});

describe('hinweisFuer', () => {
  const z = { Position: '7', Menge: '1' };
  test.each([
    ['processing', ''],
    ['on-hold', HINWEIS.UNBEZAHLT],
    ['cancelled', HINWEIS.STORNIERT],
    ['refunded', HINWEIS.ERSTATTET],
    ['completed', HINWEIS.ABGESCHLOSSEN],
  ])('%s -> "%s"', (status, h) => {
    expect(hinweisFuer(z, bestellung(5, status, [pos(7, 1, 1)]))).toBe(h);
  });
  test('Menge geaendert, Position weg, Bestellung weg', () => {
    expect(hinweisFuer(z, bestellung(5, 'processing', [pos(7, 1, 1, 2)]))).toBe(HINWEIS.MENGE);
    expect(hinweisFuer(z, bestellung(5, 'processing', []))).toBe(HINWEIS.POSITION_WEG);
    expect(hinweisFuer(z, null)).toBe(HINWEIS.NICHT_IM_SHOP);
  });
});

// ── Lauf gegen das In-Memory-Sheet ───────────────────────────────────────────
describe('runKorbAbgleich', () => {
  const offene = () => [
    bestellung(21593, 'processing', [pos(5512, 100, 501), pos(5513, 100, 0), pos(5514, 900, 501)]),
    bestellung(21600, 'on-hold', [pos(5600, 100, 502, 2)]),
  ];
  const jetzt = () => new Date('2026-10-21T08:00:00Z');

  test('legt nur bestellfaehige Positionen an, ohne append, Zielzeile nach der letzten', async () => {
    const tabs = grundTabs();
    const { sheets, aufrufe } = machSheets(tabs);
    const wc = machWc(offene());
    const r = await runKorbAbgleich({ sheets, wcFuer: () => wc, jetzt, quelle: 'knopf' });
    expect(r.shops.JFN).toMatchObject({ neu: 2, schonDa: 0, nichtBestellfaehig: { [KLASSE.EINFACH]: 1, [KLASSE.TRIKOT]: 1 } });
    expect(aufrufe.append).toBe(0);
    expect(aufrufe.update).toEqual([`'${TAB_KORB}'!A2:R3`]);
    const { zeilen } = korbZeilen(tabs[TAB_KORB]);
    expect(zeilen.map(z => z.Schluessel)).toEqual(['JFN:21593:5512', 'JFN:21600:5600']);
    expect(zeilen[0]).toMatchObject({ Shop: 'JFN', Herkunft: 'shop', Status: STATUS.OFFEN, LShop_ArticleNr: NR, Menge: '1', Hinweis: '', Quelle_Lauf: 'Knopf', Angelegt: '2026-10-21T08:00:00.000Z' });
    expect(zeilen[1]).toMatchObject({ Menge: '2', Hinweis: HINWEIS.UNBEZAHLT });
  });

  test('Idempotenz: zweiter Lauf legt nichts doppelt an', async () => {
    const tabs = grundTabs();
    const { sheets, aufrufe } = machSheets(tabs);
    const wc = machWc(offene());
    await runKorbAbgleich({ sheets, wcFuer: () => wc, jetzt });
    const r2 = await runKorbAbgleich({ sheets, wcFuer: () => wc, jetzt });
    expect(r2.shops.JFN).toMatchObject({ neu: 0, schonDa: 2, hinweiseGesetzt: 0 });
    expect(aufrufe.update).toHaveLength(1);
    expect(korbZeilen(tabs[TAB_KORB]).zeilen).toHaveLength(2);
  });

  test('Storno setzt nur den Hinweis, Status und uebrige Zellen bleiben', async () => {
    const tabs = grundTabs();
    const { sheets, aufrufe } = machSheets(tabs);
    await runKorbAbgleich({ sheets, wcFuer: () => machWc(offene()), jetzt });
    tabs[TAB_KORB][1][KORB_SPALTEN.indexOf('Status')] = STATUS.BESTELLT;   // Inhaber hat bestellt
    const vorher = tabs[TAB_KORB].map(z => [...z]);
    const storniert = bestellung(21593, 'cancelled', offene()[0].line_items);
    const bezahlt   = bestellung(21600, 'processing', offene()[1].line_items);
    const r = await runKorbAbgleich({ sheets, wcFuer: () => machWc([bezahlt], { alle: [storniert] }), jetzt });
    expect(r.shops.JFN.hinweiseGesetzt).toBe(2);
    const h = KORB_SPALTEN.indexOf('Hinweis');
    expect(tabs[TAB_KORB][1][h]).toBe(HINWEIS.STORNIERT);
    expect(tabs[TAB_KORB][2][h]).toBe('');                // bezahlt -> Hinweis weg
    expect(aufrufe.batchUpdate.every(r => r.includes(`!L`))).toBe(true);
    // ausser der Hinweis-Spalte unveraendert
    tabs[TAB_KORB].forEach((z, i) => z.forEach((w, j) => { if (j !== h) expect(w).toBe(vorher[i][j]); }));
    expect(tabs[TAB_KORB][1][KORB_SPALTEN.indexOf('Status')]).toBe(STATUS.BESTELLT);
  });

  test('abgewaehlte Zeilen werden nicht mehr geprueft', async () => {
    const tabs = grundTabs();
    const { sheets } = machSheets(tabs);
    await runKorbAbgleich({ sheets, wcFuer: () => machWc(offene()), jetzt });
    tabs[TAB_KORB][1][KORB_SPALTEN.indexOf('Status')] = STATUS.ABGEWAEHLT;
    const wc = machWc([offene()[1]], { alle: [bestellung(21593, 'cancelled', [])] });
    const r = await runKorbAbgleich({ sheets, wcFuer: () => wc, jetzt });
    expect(r.shops.JFN.hinweiseGesetzt).toBe(0);
    expect(wc.get.mock.calls.some(([, q]) => q.include && q.status === 'any')).toBe(false);
  });

  test('Trockenlauf schreibt nichts, auch ohne Reiter', async () => {
    const tabs = grundTabs({ mitKorb: false });
    const { sheets, aufrufe } = machSheets(tabs);
    const r = await runKorbAbgleich({ sheets, wcFuer: () => machWc(offene()), jetzt, dryRun: true });
    expect(r).toMatchObject({ dryRun: true, reiterFehlt: true });
    expect(r.neu.map(n => n.schluessel)).toEqual(['JFN:21593:5512', 'JFN:21600:5600']);
    expect(aufrufe.update).toHaveLength(0);
    expect(aufrufe.batchUpdate).toHaveLength(0);
  });

  test('ohne Reiter und ohne Trockenlauf: 409, nichts geschrieben', async () => {
    const { sheets, aufrufe } = machSheets(grundTabs({ mitKorb: false }));
    await expect(runKorbAbgleich({ sheets, wcFuer: () => machWc(offene()), jetzt })).rejects.toMatchObject({ status: 409 });
    expect(aufrufe.update).toHaveLength(0);
  });

  test('Zielzeile nicht leer (Rest unterhalb einer Luecke) -> 409, nichts geschrieben', async () => {
    const tabs = grundTabs();
    const { sheets, aufrufe } = machSheets(tabs);
    // Luecke: ersteFreieZeile liegt hinter der letzten belegten Zeile; eine Zeile im
    // Zielbereich, die erst zwischen Lesen und Pruefen entsteht, simulieren wir per Hook.
    const orig = sheets.spreadsheets.values.get;
    let n = 0;
    sheets.spreadsheets.values.get = async (a) => {
      if (/!A1:R4$/.test(a.range) && n++ === 0) tabs[TAB_KORB][2] = ['fremd'];
      return orig(a);
    };
    await expect(runKorbAbgleich({ sheets, wcFuer: () => machWc(offene()), jetzt })).rejects.toMatchObject({ status: 409 });
    expect(aufrufe.update).toHaveLength(0);
  });

  test('Raster zu klein -> Zeilen anfuegen (appendDimension), dann schreiben', async () => {
    const tabs = grundTabs();
    const { sheets, aufrufe } = machSheets(tabs, { [TAB_KORB]: 1 });
    await runKorbAbgleich({ sheets, wcFuer: () => machWc(offene()), jetzt });
    expect(aufrufe.struktur[0][0].appendDimension).toMatchObject({ dimension: 'ROWS', length: 3 });
  });

  test('liest nur JFN und nur processing + on-hold, ohne Kundenfelder', async () => {
    const { sheets } = machSheets(grundTabs());
    const wcJe = { jfn: machWc(offene()), honk: machWc(offene()) };
    await runKorbAbgleich({ sheets, wcFuer: s => wcJe[s], jetzt });
    expect(wcJe.honk.get).not.toHaveBeenCalled();
    const status = wcJe.jfn.get.mock.calls.filter(([p, q]) => p === 'orders' && !q.include).map(([, q]) => q.status);
    expect(status).toEqual(['processing', 'on-hold']);
    for (const [, q] of wcJe.jfn.get.mock.calls) expect(q._fields).not.toMatch(/billing|shipping/);
  });

  test('Pruefseite (HTML statt Liste) -> Fehler nach genau einem Abruf', async () => {
    const { sheets } = machSheets(grundTabs());
    const get = jest.fn(async () => ({ data: '<html>One moment, please...</html>' }));
    await expect(runKorbAbgleich({ sheets, wcFuer: () => ({ get }), jetzt })).rejects.toMatchObject({ code: 'hoster_pruefseite' });
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('ersteFreieZeile', () => {
  test('nur Kopf -> 2; Leerzeilen am Ende zaehlen nicht', () => {
    expect(ersteFreieZeile([['a']])).toBe(2);
    expect(ersteFreieZeile([['a'], ['x'], [], ['']])).toBe(3);
    expect(ersteFreieZeile([])).toBe(2);
  });
});

// ── Anzeige ──────────────────────────────────────────────────────────────────
describe('buendele / leseKorb', () => {
  test('Buendel nach ArticleNr, gesperrte Hinweise und Nicht-offen zaehlen nicht mit', () => {
    const z = (pos, nr, menge, status, hinweis = '') => ({ Schluessel: `JFN:1:${pos}`, Shop: 'JFN', Herkunft: 'shop', Bestellnummer: '1', Position: pos, LShop_ArticleNr: nr, Menge: String(menge), Status: status, Hinweis: hinweis, 'SSOT-ID': '0001' });
    const b = buendele([
      z('1', NR, 2, STATUS.OFFEN),
      z('2', NR, 1, STATUS.OFFEN, HINWEIS.UNBEZAHLT),
      z('3', NR, 5, STATUS.OFFEN, HINWEIS.STORNIERT),
      z('4', NR, 4, STATUS.BESTELLT),
      z('5', NR2, 1, STATUS.OFFEN),
    ], new Map([[NR, { catalogNr: 'JH030F', color1: 'Deep Black', size: 'XXL' }]]), { '0001': 'Ugly Sweater' });
    expect(b.map(x => [x.articleNr, x.zuBestellen, x.unbezahlt])).toEqual([[NR, 3, 1], [NR2, 1, 0]]);
    expect(b[0]).toMatchObject({ catalogNr: 'JH030F', farbe: 'Deep Black', groesse: 'XXL' });
    expect(b[0].positionen).toHaveLength(4);
    expect(b[0].positionen[0]).not.toHaveProperty('kunde');
  });

  test('leseKorb filtert nach Shop, ohne Reiter -> reiterFehlt', async () => {
    const tabs = grundTabs();
    const { sheets } = machSheets(tabs);
    await runKorbAbgleich({ sheets, wcFuer: () => machWc([bestellung(5, 'processing', [pos(9, 100, 501)])]), jetzt: () => new Date() });
    expect((await leseKorb({ shop: 'jfn', sheets })).summen).toEqual({ positionen: 1, zuBestellen: 1, artikelnummern: 1, offen: 1, herausgenommen: 0, mitHinweis: 0 });
    expect((await leseKorb({ shop: 'honk', sheets })).summen.positionen).toBe(0);
    expect((await leseKorb({ shop: 'jfn', sheets: machSheets(grundTabs({ mitKorb: false })).sheets })).reiterFehlt).toBe(true);
  });
});

describe('abgleichPlan', () => {
  test('doppelte Position in derselben Antwort -> einmal', () => {
    const t = grundTabs();
    const ktx = baueKontext({ varMap: { 501: { ssotId: '0001' } }, varianten: t.Varianten, produktIdJeSsot: { '0001': '100' }, lshop: [{ articleNr: NR }] });
    const o = bestellung(1, 'processing', [pos(7, 100, 501)]);
    const plan = abgleichPlan({ shop: 'jfn', vorhanden: [], offene: [o, o], produkte: new Map([['100', { type: 'variable' }]]), ktx, jetzt: 'x', quelleLauf: 'L' });
    expect(plan.neu).toHaveLength(1);
    expect(plan.zaehler.schonDa).toBe(1);
  });
});
