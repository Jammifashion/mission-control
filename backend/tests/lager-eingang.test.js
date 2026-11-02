// BO5-4: Ueberschuss beim Wareneingang ins Lager - Karton (Rest/nicht im Korb, Mengen aus Ord.), "mehr gekommen",
// falsches Trikot, "bei Ankunft ins Lager" (Lager_Ziel). Nur erfundene Werte; die Kundennummer aus dem Karton-Link
// taucht nie in Buchung, Antwort oder Log auf.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KORB_SPALTEN, TAB_KORB, korbZeilen, korbSpalten } from '../utils/korb-logic.js';
import { SENDUNGEN_TAB, SENDUNGEN_SPALTEN } from '../utils/lshop-belege.js';
import { KARTONS_TAB, KARTONS_SPALTEN, leseKartonPdf, kartonAbgleich } from '../utils/karton.js';
import { referenzFuer } from '../utils/edi-bestellung.js';
import { TAB_BUCHUNGEN, TAB_ARTIKEL, TAB_ORTE, BUCHUNG_SPALTEN, ARTIKEL_SPALTEN, ORTE_SPALTEN, warenartVon } from '../utils/lager.js';
import { lagerRestFuer, kartonUeberschussPlan, eingangLagerPlan, zurueckSperre, trikotLagerPlan, lagerZielPlan, kartonBezug, lagerZielSpaltePlan, standardOrt } from '../utils/lager-eingang.js';
import { kartonPruefen, kartonAngekommen } from '../lib/karton.js';
import { wareneingangBuchen, wareneingangZurueck } from '../lib/wareneingang.js';
import { kartonUeberschuss, setzeLagerZiel, trikotInsLager } from '../lib/lagerEingang.js';
import { legeEigenePositionenAn, runKorbAbgleich, _korbCacheLeeren } from '../lib/lshopKorb.js';
import { lagerCacheLeeren, _stammCacheLeeren } from '../lib/lager.js';
import { _customerIdCacheLeeren } from '../lib/lshopEdi.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { machSheets, machWc, bestellung, pos, NR, NR2 } from './hilfen/korb-sheet.js';

const KUNDE = '99999901';           // erfunden
const KARTON = '424242';            // erfunden
const HEX = 'CD'.repeat(32);
const LINK = `https://textilelogistics.eu/pdf/0A/1B/${KUNDE}_${KARTON}_${HEX}.pdf`;
const ID = 'JFN-2026-0007';
const NR3 = '1000555555';
const JETZT = new Date('2026-11-04T10:00:00Z');
const V = n => `vorgang-we-${String(n).padStart(4, '0')}`;

// ── PDF-Nachbau (Aufbau wie tests/karton.test.js; jede Datenzeile = 1 Stueck in "Ord.", "Qty." absichtlich falsch) ──
const esc = s => s.replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/ü/g, '\\374');
const bt = (x, y, s, f = 'F1', n = 9) => `BT /${f} ${n} Tf ${x} ${y} Td (${esc(s)}) Tj ET`;
const kopfzeile = y => [bt(40, y, 'Article-No', 'F2'), bt(132, y, 'SKU', 'F2'), bt(228, y, 'Color', 'F2'), bt(365, y, 'Size', 'F2'), bt(481, y, 'Ord.', 'F2'), bt(539, y, 'Qty.', 'F2')];
const daten = (y, art, sku, farbe, gr) => [bt(40, y, art), bt(132, y, sku), bt(228, y, farbe), bt(365, y, gr), bt(493, y, '1'), bt(547, y, '9')];
function bauePdf(s) {
  const objekte = [`<< /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}\nendstream`, '<< /Type /Page /Contents 1 0 R >>', '<< /Type /Pages /Kids [2 0 R] /Count 1 >>'];
  return Buffer.from(`%PDF-1.4\n${objekte.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj`).join('\n')}\n%%EOF`, 'latin1');
}
const PDF = bauePdf([
  bt(36, 806, 'LA00001234 VA00005678'), bt(36, 790, ID),
  bt(36, 720, 'JFN-101-2'), ...kopfzeile(705),
  ...daten(690, 'JH030F', NR2, 'Deep Black', 'XL'), ...daten(678, 'JH030F', NR2, 'Deep Black', 'XL'), ...daten(666, 'JH030F', NR2, 'Deep Black', 'XL'),
  bt(407, 650, 'Subtotal'), bt(493, 650, '3'),
  bt(36, 620, 'Extra'), ...kopfzeile(605), ...daten(590, 'JH001', NR3, 'White', 'M'),
  bt(407, 570, 'Subtotal'), bt(493, 570, '1'),
  bt(36, 540, 'Vorrat'), ...kopfzeile(525), ...daten(510, 'JH030F', NR, 'Deep Black', 'XXL'), ...daten(498, 'JH030F', NR, 'Deep Black', 'XXL'),
  bt(407, 480, 'Subtotal'), bt(493, 480, '2'),
].join('\n'));

const korbZeile = o => KORB_SPALTEN.map(s => ({ Shop: 'JFN', Herkunft: 'shop', Menge: '1', Status: 'bestellt', Bestell_ID: ID, Angelegt: '2026-10-20T08:00:00Z', ...o })[s] ?? '');
const KOPF = [...KORB_SPALTEN, 'Lager_Ziel'];
const mitZiel = (o, ziel = '') => [...korbZeile(o), ziel];
function aufbau({ lagerZielSpalte = true, buchungen = [], orte = ['Wrist', 'Itzehoe'] } = {}) {
  const korb = [
    mitZiel({ Schluessel: 'JFN:101:2', Bestellnummer: '101', Position: '2', LShop_ArticleNr: NR2, Menge: '2' }),
    mitZiel({ Schluessel: 'EIGEN:2026-0001', Herkunft: 'eigen', Referenz: 'Vorrat', LShop_ArticleNr: NR, Menge: '2' }, 'Wrist'),
  ];
  const tabs = {
    [TAB_KORB]: lagerZielSpalte ? [KOPF, ...korb] : [KORB_SPALTEN, ...korb.map(r => r.slice(0, -1))],
    [SENDUNGEN_TAB]: [SENDUNGEN_SPALTEN],
    Config: [['Schlüssel', 'Wert'], ['lshop.customer_id', KUNDE]],
    [KARTONS_TAB]: [KARTONS_SPALTEN],
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Discontinued', 'Status'],
      [NR, 'JH030F', 'Deep Black', '', 'XXL', '', '', '0', 'aktiv'], [NR2, 'JH030F', 'Deep Black', '', 'XL', '', '', '0', 'aktiv'], [NR3, 'JH001', 'White', '', 'M', '', '', '0', 'aktiv']],
    [TAB_BUCHUNGEN]: [BUCHUNG_SPALTEN, ...buchungen.map(o => BUCHUNG_SPALTEN.map(n => o[n] ?? ''))],
    [TAB_ORTE]: [ORTE_SPALTEN, ...orte.map(o => [o, 'aktiv', ''])],
    [TAB_ARTIKEL]: [ARTIKEL_SPALTEN],
    Erfassungsmaske: [['ID', 'Produkt-ID', 'Produktname'], ['0009', '900', 'Trikot Heim']],
    Trikot_Artikel: [['Artikelnummer', 'Produkt-ID', 'Produktname', 'Aktiv'], ['', '900', '', 'TRUE']],
    Trikots: [['Zeilen-ID', 'Produktname', 'Groesse', 'Name', 'Nummer', 'Status'],
      ['5001|7001|1', 'Trikot Heim', 'XL', 'GEHEIMNAME', '7', 'ersetzt'], ['5002|7002|1', 'Trikot Heim', 'M', '', '', 'ok']],
  };
  const m = machSheets(tabs);
  const holen = jest.fn(async () => ({ ok: true, status: 200, headers: { get: () => String(PDF.length) }, arrayBuffer: async () => PDF }));
  return { tabs, ...m, holen, archiv: jest.fn(async () => ({ status: 'neu', id: 'drive-1' })) };
}
const lagerZeilen = tabs => tabs[TAB_BUCHUNGEN].slice(1).map(r => Object.fromEntries(BUCHUNG_SPALTEN.map((n, i) => [n, r[i]])));

let log;
beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot'; process.env.BUSINESS_SHEET_ID = 'ssot';
  _customerIdCacheLeeren(); _resetLShopCache(); _korbCacheLeeren(); lagerCacheLeeren(); _stammCacheLeeren();
  log = [];
  for (const m of ['log', 'warn', 'error']) jest.spyOn(console, m).mockImplementation((...a) => log.push(a.map(String).join(' ')));
});
afterEach(() => jest.restoreAllMocks());
const ohneKundennummer = x => { const s = JSON.stringify(x) + log.join('\n'); expect(s).not.toContain(KUNDE); expect(s).not.toContain(HEX); };

describe('Reine Logik', () => {
  test('Rest aus Ord. (nie Qty): Karton > Korb -> Differenz, nicht im Korb -> alles, Karton <= Korb -> 0', () => {
    expect(lagerRestFuer({ ord: 3, schluessel: 'k', menge: 2 })).toBe(1);
    expect(lagerRestFuer({ ord: 1, schluessel: '', menge: null })).toBe(1);
    expect(lagerRestFuer({ ord: 1, schluessel: 'k', menge: 2 })).toBe(0);
    expect(lagerRestFuer({ ord: 2, schluessel: 'k', menge: 2 })).toBe(0);
  });
  test('PDF: Mengen kommen aus Ord. (3 Zeilen = 3), obwohl Qty 9 sagt', () => {
    const k = leseKartonPdf(PDF);
    expect(k.positionen.find(p => p.sku === NR2).ord).toBe(3);
  });
  test('Bezug der Karton-Zeile ohne Kundennummer', () => {
    expect(kartonBezug(ID, KARTON, 'JFN-101-2', NR2)).toBe(`${ID}:${KARTON}:JFN-101-2:${NR2}`);
  });
  test('Standard-Ort Wrist', () => {
    expect(standardOrt(['Itzehoe', 'Wrist'])).toBe('Wrist');
    expect(standardOrt(['Itzehoe'])).toBe('Itzehoe');
  });
  test('Lager_Ziel nur an eigenen Positionen, nur offen/bestellt, Ort aktiv', () => {
    const z = o => ({ _zeile: 3, Schluessel: 'EIGEN:2026-0001', Herkunft: 'eigen', Status: 'offen', Lager_Ziel: '', ...o });
    expect(lagerZielPlan({ korbZeile: z(), status: 'offen', ziel: 'Wrist', orte: ['Wrist'] })).toMatchObject({ neu: 'Wrist' });
    expect(lagerZielPlan({ korbZeile: z({ Status: 'bestellt', Lager_Ziel: 'Wrist' }), status: 'bestellt', ziel: '', orte: [] })).toMatchObject({ alt: 'Wrist', neu: '' });
    expect(() => lagerZielPlan({ korbZeile: z({ Herkunft: 'shop' }), status: 'offen', ziel: 'Wrist', orte: ['Wrist'] })).toThrow(/Nur eigene Positionen/);
    expect(() => lagerZielPlan({ korbZeile: z({ Status: 'geliefert' }), status: 'geliefert', ziel: 'Wrist', orte: ['Wrist'] })).toThrow(/nur bis zum Wareneingang/);
    expect(() => lagerZielPlan({ korbZeile: z(), status: 'offen', ziel: 'Keller', orte: ['Wrist'] })).toThrow(/Keller/);
  });
  test('Trikot: nur "ersetzt", Notiz nur "beflockt", nie doppelt', () => {
    const zeile = { id: '5001|7001|1', status: 'ersetzt', produktId: '900', groesse: 'XL', beflockt: true };
    const p = trikotLagerPlan({ zeile, ort: 'Wrist', buchungen: [], orte: ['Wrist'], vorgang: V(1), jetzt: JETZT });
    expect(p.zeilen[0]).toMatchObject({ Schluessel: 'TR:900:XL', Art: 'zugang_ueberschuss', Quelle: 'wareneingang', Bezug: '5001|7001|1', Notiz: 'beflockt', Menge: 1, Ort: 'Wrist' });
    const danach = p.zeilen.map(z => ({ id: z.Buchung_ID, schluessel: z.Schluessel, menge: z.Menge, ort: z.Ort, art: z.Art, quelle: z.Quelle, bezug: z.Bezug, stornoVon: '', vorgang: z.Vorgang }));
    expect(() => trikotLagerPlan({ zeile, ort: 'Wrist', buchungen: danach, orte: ['Wrist'], vorgang: V(2) })).toThrow(/schon im Lager/);
    expect(() => trikotLagerPlan({ zeile: { ...zeile, status: 'ok' }, ort: 'Wrist', buchungen: [], orte: ['Wrist'], vorgang: V(3) })).toThrow(/nicht "ersetzt"/);
  });
  test('Setup-Plan Lager_Ziel: hinter der letzten Kopfspalte, idempotent', () => {
    expect(lagerZielSpaltePlan([['A', 'B', ''], ['1', '2']])).toMatchObject({ da: false, spalte: 2, belegt: 0 });
    expect(lagerZielSpaltePlan([['A', 'Lager_Ziel']])).toMatchObject({ da: true });
    expect(lagerZielSpaltePlan([['A'], ['1', 'x']])).toMatchObject({ belegt: 1 });
  });
});

describe('Karton', () => {
  test('pruefen: Rest je Zeile (Karton > Korb, nicht im Korb), Karton = Korb ohne Rest; keine Kundennummer', async () => {
    const a = aufbau();
    const r = await kartonPruefen({ link: LINK, sheets: a.sheets, holen: a.holen });
    const p = sku => r.positionen.find(x => x.sku === sku);
    expect([p(NR2).lagerRest, p(NR3).lagerRest, p(NR).lagerRest]).toEqual([1, 1, 0]);
    expect(p(NR).lagerZiel).toBe('Wrist');
    expect(r).toMatchObject({ lagerBereit: true, orte: ['Wrist', 'Itzehoe'] });
    ohneKundennummer(r);
  });
  test('Rest ins Lager + nicht im Korb: eine Buchung, Art zugang_ueberschuss, Quelle karton, nie doppelt', async () => {
    const a = aufbau();
    const r = await kartonUeberschuss({ link: LINK, auswahl: [{ reference: 'JFN-101-2', sku: NR2 }, { reference: 'Extra', sku: NR3 }], ort: 'Wrist', vorgang: V(10), sheets: a.sheets, holen: a.holen, jetzt: () => JETZT });
    expect(r).toMatchObject({ ok: true, stueck: 2, kartonId: KARTON });
    const z = lagerZeilen(a.tabs);
    expect(z.map(x => [x.Schluessel, x.Menge, x.Art, x.Quelle, x.Ort])).toEqual([[`LS:${NR2}`, 1, 'zugang_ueberschuss', 'karton', 'Wrist'], [`LS:${NR3}`, 1, 'zugang_ueberschuss', 'karton', 'Wrist']]);
    expect(a.aufrufe.append).toBe(0);
    // zweiter Klick mit neuer Kennung: dieselbe Zeile geht nicht noch einmal
    await expect(kartonUeberschuss({ link: LINK, auswahl: [{ reference: 'JFN-101-2', sku: NR2 }], ort: 'Wrist', vorgang: V(11), sheets: a.sheets, holen: a.holen }))
      .rejects.toMatchObject({ status: 422, message: expect.stringMatching(/schon ins Lager/) });
    // Doppelklick (gleiche Kennung) = schon gebucht
    expect(await kartonUeberschuss({ link: LINK, auswahl: [{ reference: 'JFN-101-2', sku: NR2 }], ort: 'Wrist', vorgang: V(10), sheets: a.sheets, holen: a.holen }))
      .toMatchObject({ schonGebucht: true });
    expect(lagerZeilen(a.tabs)).toHaveLength(2);
    ohneKundennummer({ r, z });
  });
  test('kein Ueberschuss (Karton = Korb) -> 422, nichts gebucht; alles oder nichts', async () => {
    const a = aufbau();
    await expect(kartonUeberschuss({ link: LINK, auswahl: [{ reference: 'Extra', sku: NR3 }, { reference: 'Vorrat', sku: NR }], ort: 'Wrist', vorgang: V(12), sheets: a.sheets, holen: a.holen }))
      .rejects.toMatchObject({ status: 422 });
    expect(lagerZeilen(a.tabs)).toEqual([]);
  });
  test('Karton angekommen: eigene Position mit Lager_Ziel wird im selben Schritt eingebucht (abwaehlbar)', async () => {
    const a = aufbau();
    // Karton-Menge der eigenen Position = Korb (2) -> waehlbar
    const r = await kartonAngekommen({ link: LINK, auswahl: [{ schluessel: 'EIGEN:2026-0001', status: 'bestellt' }], sheets: a.sheets, holen: a.holen, archiv: a.archiv, jetzt: () => JETZT, vorgang: V(13) });
    expect(r.lager).toEqual([expect.objectContaining({ art: 'vorrat', schluessel: `LS:${NR}`, menge: 2, ort: 'Wrist', bezug: 'EIGEN:2026-0001' })]);
    expect(lagerZeilen(a.tabs)[0]).toMatchObject({ Quelle: 'karton', Grund: `Wareneingang ${ID}` });
    ohneKundennummer(r);
  });
});

describe('Ware angekommen (von Hand)', () => {
  test('mehr gekommen + bei Ankunft ins Lager: ein batchUpdate fuer Korb und Lager', async () => {
    const a = aufbau();
    const r = await wareneingangBuchen({ orderId: ID, vorgang: V(20), jetzt: () => JETZT, sheets: a.sheets,
      auswahl: [{ schluessel: 'JFN:101:2', status: 'bestellt', mehr: '1' }, { schluessel: 'EIGEN:2026-0001', status: 'bestellt' }] });
    expect(r.lager.map(x => [x.art, x.menge, x.bezug])).toEqual([['zugang_ueberschuss', 1, 'JFN:101:2'], ['vorrat', 2, 'EIGEN:2026-0001']]);
    expect(a.aufrufe.update).toEqual([]);
    expect(a.aufrufe.batchUpdate.some(x => x.startsWith(`'${TAB_BUCHUNGEN}'!A2`))).toBe(true);
    expect(lagerZeilen(a.tabs).every(z => z.Quelle === 'wareneingang')).toBe(true);
    // Rueckweg gesperrt, solange der Zugang offen ist
    await expect(wareneingangZurueck({ orderId: ID, sheets: a.sheets, auswahl: [{ schluessel: 'EIGEN:2026-0001', status: 'geliefert' }] }))
      .rejects.toMatchObject({ status: 409, code: 'lager' });
  });
  test('Haken "davon ins Lager" weg -> kein Zugang; ohne mehr laeuft alles wie vorher', async () => {
    const a = aufbau();
    const r = await wareneingangBuchen({ orderId: ID, vorgang: V(21), sheets: a.sheets, auswahl: [{ schluessel: 'EIGEN:2026-0001', status: 'bestellt', insLager: false }] });
    expect(r.lager).toEqual([]);
    expect(lagerZeilen(a.tabs)).toEqual([]);
  });
  test('alles oder nichts: "mehr gekommen" ungueltig -> 422, auch der Korb bleibt bestellt', async () => {
    const a = aufbau();
    await expect(wareneingangBuchen({ orderId: ID, vorgang: V(22), sheets: a.sheets, auswahl: [{ schluessel: 'JFN:101:2', status: 'bestellt', mehr: '-1' }] }))
      .rejects.toMatchObject({ status: 422 });
    expect(a.aufrufe.batchUpdate).toEqual([]);
    expect(korbZeilen(a.tabs[TAB_KORB]).zeilen.find(z => z.Schluessel === 'JFN:101:2').Status).toBe('bestellt');
  });
  test('kein doppelter Zugang je Korb-Schluessel', () => {
    const korb = [{ _zeile: 2, Schluessel: 'EIGEN:2026-0001', Herkunft: 'eigen', LShop_ArticleNr: NR, Menge: '2', Lager_Ziel: 'Wrist' }];
    const schon = [{ id: 'LB-2026-00001', art: 'vorrat', quelle: 'wareneingang', bezug: 'EIGEN:2026-0001', menge: 2, schluessel: `LS:${NR}`, ort: 'Wrist', stornoVon: '' }];
    expect(() => eingangLagerPlan({ auswahl: [{ schluessel: 'EIGEN:2026-0001' }], korbZeilen: korb, buchungen: schon, orte: ['Wrist'], quelle: 'wareneingang', orderId: ID, vorgang: V(23) }))
      .toThrow(/schon ins Lager/);
    expect(() => zurueckSperre([{ schluessel: 'EIGEN:2026-0001' }], schon)).toThrow(/Gegenbuchung/);
  });
});

describe('Lager_Ziel im Korb', () => {
  test('setzen/entfernen nur bei eigenen Positionen, eine Zelle, zurueckgelesen', async () => {
    const a = aufbau();
    expect(await setzeLagerZiel({ schluessel: 'EIGEN:2026-0001', status: 'bestellt', ziel: 'Itzehoe', sheets: a.sheets })).toMatchObject({ ok: true, ziel: 'Itzehoe' });
    expect(a.aufrufe.update).toEqual([`'${TAB_KORB}'!${String.fromCharCode(65 + KOPF.length - 1)}3`]);
    expect(await setzeLagerZiel({ schluessel: 'EIGEN:2026-0001', status: 'bestellt', ziel: '', sheets: a.sheets })).toMatchObject({ ziel: '' });
    await expect(setzeLagerZiel({ schluessel: 'JFN:101:2', status: 'bestellt', ziel: 'Wrist', sheets: a.sheets })).rejects.toMatchObject({ status: 422 });
  });
  test('ohne Spalte: 409 einrichtung; Korb und Abgleich laufen wie vorher', async () => {
    const a = aufbau({ lagerZielSpalte: false });
    await expect(setzeLagerZiel({ schluessel: 'EIGEN:2026-0001', status: 'bestellt', ziel: 'Wrist', sheets: a.sheets })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    expect(korbSpalten(a.tabs[TAB_KORB][0]).Lager_Ziel).toBeUndefined();
  });
  test('Abgleich vertraegt die neue Spalte (neue Zeile hat Lager_Ziel leer)', async () => {
    const a = aufbau();
    a.tabs.Varianten = [['SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'Preis', 'Aktiv', 'WC_Variation_ID', 'Google_Farbe', 'LShop_ArticleNr'],
      ['0001', '1', 'Farbe', 'Deep Black', 'Größe', 'XL', '', '', '', 'TRUE', '502', '', NR2]];
    a.tabs.Erfassungsmaske = [['ID', 'Produkt-ID', 'Produktname', 'Artikelnummer'], ['0001', '100', 'Sweater', 'JH030F/US']];
    a.tabs.SKU_Extern = [['ArticleNr', 'CatalogNr', 'Artikel_WC_IDs']];
    await runKorbAbgleich({ sheets: a.sheets, wcFuer: () => machWc([bestellung(300, 'processing', [pos(9, 100, 502)])]), jetzt: () => JETZT });
    const zeilen = korbZeilen(a.tabs[TAB_KORB]).zeilen;
    expect(zeilen.find(z => z.Schluessel === 'JFN:300:9')).toMatchObject({ Lager_Ziel: '', Status: 'offen' });
    expect(zeilen.find(z => z.Schluessel === 'EIGEN:2026-0001').Lager_Ziel).toBe('Wrist');
  });
});

describe('Trikot ins Lager', () => {
  test('ersetzt -> TR:900:XL, Notiz "beflockt", nie der Rueckenname; Trikots unveraendert; nie doppelt', async () => {
    const a = aufbau();
    const vorher = JSON.stringify(a.tabs.Trikots);
    const r = await trikotInsLager({ id: '5001|7001|1', zeile: 2, ort: 'Wrist', vorgang: V(30), sheets: a.sheets, jetzt: () => JETZT });
    expect(r).toMatchObject({ ok: true, stueck: 1, ort: 'Wrist' });
    const z = lagerZeilen(a.tabs);
    expect(z[0]).toMatchObject({ Schluessel: 'TR:900:XL', Warenart: 'trikot', Art: 'zugang_ueberschuss', Notiz: 'beflockt', Bezug: '5001|7001|1' });
    expect(JSON.stringify(z)).not.toContain('GEHEIMNAME');
    expect(JSON.stringify(a.tabs.Trikots)).toBe(vorher);
    await expect(trikotInsLager({ id: '5001|7001|1', zeile: 2, ort: 'Wrist', vorgang: V(31), sheets: a.sheets })).rejects.toMatchObject({ status: 409 });
    await expect(trikotInsLager({ id: '5002|7002|1', zeile: 3, ort: 'Wrist', vorgang: V(32), sheets: a.sheets })).rejects.toMatchObject({ status: 409 });
    expect(log.join('\n')).not.toContain('GEHEIMNAME');
  });
});

describe('Eigene Positionen mit "bei Ankunft ins Lager"', () => {
  test('Raster mit lagerZiel: jede Zeile traegt den Ort; unbekannter Ort 422', async () => {
    const a = aufbau();
    a.tabs.LShop_Modelle.push([NR3.slice(0, 9) + '6', 'JH030F', 'Deep Black', '', 'L', '', '', '0', 'aktiv']);
    await legeEigenePositionenAn({ sheets: a.sheets, jetzt: () => JETZT, eingabe: { positionen: [{ articleNr: NR2, menge: 3 }], referenz: 'Vorrat', notiz: '', lagerZiel: 'Wrist' } });
    const neu = korbZeilen(a.tabs[TAB_KORB]).zeilen.at(-1);
    expect(neu).toMatchObject({ Herkunft: 'eigen', LShop_ArticleNr: NR2, Lager_Ziel: 'Wrist' });
    await expect(legeEigenePositionenAn({ sheets: a.sheets, eingabe: { positionen: [{ articleNr: NR2, menge: 1 }], referenz: 'Vorrat', lagerZiel: 'Keller' } }))
      .rejects.toMatchObject({ status: 422 });
  });
});

describe('Frontend BO5-4', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  test('Wrist vorgewaehlt in Ortsauswahl, Karton-Rest und Eigen-Dialog', () => {
    expect(html).toMatch(/sel\.value = orte\.includes\(wert\) \? wert : orte\.includes\('Wrist'\) \? 'Wrist'/);
    expect(html).toMatch(/<option\$\{o === 'Wrist' \? ' selected' : ''\}>/);
    expect(html).toMatch(/sel\.value = orte\.includes\('Wrist'\) \? 'Wrist'/);
  });
  test('Knoepfe/Felder: Rest ins Lager, mehr gekommen, davon ins Lager, falsches Trikot, bei Ankunft ins Lager - alle mit Mouse-over', () => {
    for (const k of ['karton-rest-lager', 'we-mehr', 'bei-ankunft-lager', 'trikot-ins-lager', 'eigen-lager', 'lager-ziel-aendern']) {
      expect(html).toMatch(new RegExp(`data-hilfe="${k}"`));
    }
  });
  test('Karton-Link nie in Anzeige/Toast: nur ksZustand.link wird gesendet', () => {
    expect(html).toMatch(/ksAnfrage\('ueberschuss', \{ link: ksZustand\.link,/);
  });
});
