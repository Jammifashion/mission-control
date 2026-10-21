// BO3: L-Shop-Warenkorb bearbeitbar - herausnehmen / zurueck auf offen, eigene Positionen.
// Status nur ueber Schluessel + bisherigen Status (sonst 409, nichts geschrieben),
// nie values.append, Abgleich laesst "abgewählt" und Herkunft "eigen" in Ruhe.

import {
  KORB_SPALTEN, STATUS, HINWEIS, TAB_KORB, GRUENDE,
  korbZeilen, statusPlan, grundVorschlag, naechsteEigenNummer, bestellbareVarianten, buendele, korbZaehler, lshopText,
} from '../utils/korb-logic.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  runKorbAbgleich, setzeStatus, legeEigenePositionAn, sucheArtikel, artikelVarianten, leseKorb, _korbCacheLeeren, BESCHAEFTIGT,
} from '../lib/lshopKorb.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { machSheets, grundTabs, machWc, pos, bestellung, NR, NR2, NR_AUS } from './hilfen/korb-sheet.js';

const sp = name => KORB_SPALTEN.indexOf(name);
const jetzt = () => new Date('2026-10-22T09:00:00Z');

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot';
  process.env.BUSINESS_SHEET_ID = 'ssot';
  _korbCacheLeeren();
  _resetLShopCache();
});

// Korb mit 3 Shop-Positionen aus dem echten Abgleich
async function gefuellt() {
  const tabs = grundTabs();
  const m = machSheets(tabs);
  const offene = [
    bestellung(21593, 'processing', [pos(5512, 100, 501), pos(5513, 100, 502)]),
    bestellung(21600, 'processing', [pos(5600, 100, 502, 2)]),
  ];
  await runKorbAbgleich({ sheets: m.sheets, wcFuer: () => machWc(offene), jetzt });
  m.aufrufe.update.length = 0;
  m.aufrufe.batchUpdate.length = 0;
  return { tabs, ...m, offene };
}
const zeileVon = (tabs, schluessel) => tabs[TAB_KORB].find(z => z[0] === schluessel);

// ── Teil A ───────────────────────────────────────────────────────────────────
describe('setzeStatus', () => {
  test('einzeln herausnehmen: nur Status/Grund/Notiz/Status_Datum/Stand, kein append', async () => {
    const { tabs, sheets, aufrufe } = await gefuellt();
    const vorher = [...zeileVon(tabs, 'JFN:21593:5512')];
    const r = await setzeStatus({ sheets, jetzt, auswahl: [{ schluessel: 'JFN:21593:5512', status: 'offen' }], ziel: 'abgewählt', grund: 'schon bestellt', notiz: 'L-Shop 14.10.' });
    expect(r).toMatchObject({ ok: true, geaendert: 1 });
    const z = zeileVon(tabs, 'JFN:21593:5512');
    expect([z[sp('Status')], z[sp('Grund')], z[sp('Notiz')], z[sp('Status_Datum')], z[sp('Stand')]])
      .toEqual(['abgewählt', 'schon bestellt', 'L-Shop 14.10.', '2026-10-22T09:00:00.000Z', '2026-10-22T09:00:00.000Z']);
    const erlaubt = new Set(['Status', 'Grund', 'Notiz', 'Status_Datum', 'Stand'].map(sp));
    z.forEach((w, j) => { if (!erlaubt.has(j)) expect(w).toBe(vorher[j]); });
    expect(aufrufe.append).toBe(0);
    expect(aufrufe.update).toHaveLength(0);
    expect(aufrufe.batchUpdate).toHaveLength(5);
  });

  test('mehrere auf einmal, dann zurueck auf offen (Grund leer, Notiz bleibt)', async () => {
    const { tabs, sheets } = await gefuellt();
    const alle = ['JFN:21593:5512', 'JFN:21593:5513', 'JFN:21600:5600'];
    await setzeStatus({ sheets, jetzt, auswahl: alle.map(s => ({ schluessel: s, status: 'offen' })), ziel: 'abgewählt', grund: 'Ware da / Lager', notiz: 'x' });
    expect(alle.map(s => zeileVon(tabs, s)[sp('Status')])).toEqual(['abgewählt', 'abgewählt', 'abgewählt']);
    await setzeStatus({ sheets, jetzt, auswahl: [{ schluessel: alle[1], status: 'abgewählt' }], ziel: 'offen' });
    const z = zeileVon(tabs, alle[1]);
    expect([z[sp('Status')], z[sp('Grund')], z[sp('Notiz')]]).toEqual(['offen', '', 'x']);
  });

  test('Konflikt: Zeile hat sich geaendert -> 409, NICHTS geschrieben (auch nicht die anderen)', async () => {
    const { tabs, sheets, aufrufe } = await gefuellt();
    zeileVon(tabs, 'JFN:21600:5600')[sp('Status')] = 'abgewählt';   // anderer Browser war schneller
    await expect(setzeStatus({ sheets, jetzt, ziel: 'abgewählt', grund: 'Sonstiges', auswahl: [
      { schluessel: 'JFN:21593:5512', status: 'offen' }, { schluessel: 'JFN:21600:5600', status: 'offen' },
    ] })).rejects.toMatchObject({ status: 409 });
    expect(aufrufe.batchUpdate).toHaveLength(0);
    expect(zeileVon(tabs, 'JFN:21593:5512')[sp('Status')]).toBe('offen');
  });

  test('unbekannter Schluessel -> 409; ohne/falscher Grund, bestellt als Ziel -> 422', async () => {
    const { sheets } = await gefuellt();
    const a = [{ schluessel: 'JFN:21593:5512', status: 'offen' }];
    await expect(setzeStatus({ sheets, jetzt, auswahl: [{ schluessel: 'JFN:1:1', status: 'offen' }], ziel: 'abgewählt', grund: 'Sonstiges' })).rejects.toMatchObject({ status: 409 });
    await expect(setzeStatus({ sheets, jetzt, auswahl: a, ziel: 'abgewählt' })).rejects.toMatchObject({ status: 422 });
    await expect(setzeStatus({ sheets, jetzt, auswahl: a, ziel: 'abgewählt', grund: 'weil' })).rejects.toMatchObject({ status: 422 });
    await expect(setzeStatus({ sheets, jetzt, auswahl: a, ziel: 'bestellt' })).rejects.toMatchObject({ status: 422 });
    await expect(setzeStatus({ sheets, jetzt, auswahl: a, ziel: 'offen' })).rejects.toMatchObject({ status: 422 });   // ist schon offen
  });

  test('bestellt/geliefert sind in BO3 nicht bearbeitbar', () => {
    const zeilen = [{ Schluessel: 'JFN:1:1', Status: STATUS.BESTELLT, _zeile: 2 }];
    expect(() => statusPlan({ zeilen, auswahl: [{ schluessel: 'JFN:1:1', status: 'bestellt' }], ziel: 'offen', jetzt: 'x' })).toThrow(/von dort/);
    const b = buendele([{ ...zeilen[0], LShop_ArticleNr: NR, Menge: '1' }]);
    expect(b[0].positionen[0].bearbeitbar).toBe(false);
  });

  test('Zusammenstoss mit dem Abgleich (gleiche Instanz) -> 409 "gleich nochmal"', async () => {
    const { sheets, offene } = await gefuellt();
    let freigeben;
    const haengend = { get: (...a) => new Promise(r => { freigeben = () => r(machWc(offene).get(...a)); }) };
    const lauf = runKorbAbgleich({ sheets, wcFuer: () => haengend, jetzt });
    await new Promise(r => setTimeout(r, 5));
    await expect(setzeStatus({ sheets, jetzt, auswahl: [{ schluessel: 'JFN:21593:5512', status: 'offen' }], ziel: 'abgewählt', grund: 'Sonstiges' }))
      .rejects.toMatchObject({ status: 409, message: BESCHAEFTIGT });
    freigeben();
    await new Promise(r => setTimeout(r, 5));
    freigeben(); await new Promise(r => setTimeout(r, 5)); freigeben();
    await lauf;
  });
});

describe('grundVorschlag und Zaehler', () => {
  test.each([
    [HINWEIS.STORNIERT, 'Bestellung storniert'],
    [HINWEIS.ERSTATTET, 'Bestellung storniert'],
    [HINWEIS.NICHT_IM_SHOP, 'Bestellung storniert'],
    [HINWEIS.POSITION_WEG, 'Bestellung storniert'],
    [HINWEIS.ABGESCHLOSSEN, 'schon bestellt'],
    [HINWEIS.UNBEZAHLT, ''],
    ['', ''],
  ])('%s -> %s', (h, g) => { expect(grundVorschlag(h)).toBe(g); });

  test('Zaehler offen / herausgenommen / mit Hinweis', () => {
    expect(korbZaehler([
      { Status: 'offen', Hinweis: '' }, { Status: 'offen', Hinweis: HINWEIS.UNBEZAHLT },
      { Status: 'abgewählt', Hinweis: HINWEIS.STORNIERT }, { Status: 'bestellt', Hinweis: '' },
    ])).toEqual({ offen: 2, herausgenommen: 1, mitHinweis: 1 });
    expect(GRUENDE).toEqual(['Ware da / Lager', 'schon bestellt', 'Bestellung storniert', 'Sonstiges']);
  });
});

// ── Teil B ───────────────────────────────────────────────────────────────────
describe('eigene Positionen', () => {
  const eingabe = (o = {}) => ({ ssotId: '0001', wcVariationId: '501', menge: 3, referenz: 'Lager', notiz: '', ...o });

  test('Nummer fortlaufend je Jahr, aus dem Reiter', () => {
    const z = s => ({ Schluessel: s });
    expect(naechsteEigenNummer([], 2026)).toBe('EIGEN:2026-0001');
    expect(naechsteEigenNummer([z('EIGEN:2026-0001'), z('EIGEN:2026-0007'), z('EIGEN:2025-0099'), z('JFN:1:2')], 2026)).toBe('EIGEN:2026-0008');
  });

  test('Anlage: Zeile hinter der letzten, ohne append, Herkunft eigen, Shop JFN', async () => {
    const { tabs, sheets, aufrufe } = await gefuellt();
    const r = await legeEigenePositionAn({ sheets, jetzt, eingabe: eingabe() });
    expect(r).toMatchObject({ ok: true, schluessel: 'EIGEN:2026-0001', zeile: 5, articleNr: NR, menge: '3' });
    expect(aufrufe.append).toBe(0);
    expect(aufrufe.update).toEqual([`'${TAB_KORB}'!A5:R5`]);
    const { zeilen } = korbZeilen(tabs[TAB_KORB]);
    expect(zeilen.at(-1)).toMatchObject({ Schluessel: 'EIGEN:2026-0001', Shop: 'JFN', Herkunft: 'eigen', Bestellnummer: '', Position: '',
      Referenz: 'Lager', 'SSOT-ID': '0001', LShop_ArticleNr: NR, Menge: '3', Status: 'offen', Quelle_Lauf: 'Knopf' });
    const r2 = await legeEigenePositionAn({ sheets, jetzt, eingabe: eingabe({ wcVariationId: '502', referenz: 'Muster' }) });
    expect(r2.schluessel).toBe('EIGEN:2026-0002');
    expect(new Set(korbZeilen(tabs[TAB_KORB]).zeilen.map(z => z.Schluessel)).size).toBe(5);
  });

  test.each([
    ['ohne Referenz', { referenz: '  ' }],
    ['Menge 0', { menge: 0 }],
    ['Menge 1.5', { menge: 1.5 }],
    ['ausgelaufene Variante', { wcVariationId: '503' }],
    ['inaktive Variante', { wcVariationId: '504' }],
    ['Variante ohne ArticleNr', { ssotId: '0002', wcVariationId: '601' }],
    ['nicht synchronisierter Artikel', { ssotId: '0003', wcVariationId: '' }],
    ['unbekannter Artikel', { ssotId: '9999' }],
    ['Variante eines anderen Artikels', { ssotId: '0002', wcVariationId: '501' }],
  ])('abgelehnt: %s -> 422, nichts geschrieben', async (_n, o) => {
    const { sheets, aufrufe } = await gefuellt();
    await expect(legeEigenePositionAn({ sheets, jetzt, eingabe: eingabe(o) })).rejects.toMatchObject({ status: 422 });
    expect(aufrufe.update).toHaveLength(0);
  });

  test('Auswahl: nur synchronisierte Artikel, nur bestellbare Varianten', async () => {
    const { sheets } = machSheets(grundTabs());
    const s = await sucheArtikel({ sheets, q: 'ugly' });
    expect(s.artikel.map(a => [a.ssotId, a.bestellbar])).toEqual([['0001', 2]]);   // 0003 ohne Produkt-ID fehlt
    expect((await sucheArtikel({ sheets, q: 'T1/' })).artikel.map(a => [a.ssotId, a.bestellbar])).toEqual([['0002', 0]]);
    expect((await sucheArtikel({ sheets, q: 'u' })).artikel).toEqual([]);           // unter 2 Zeichen
    const v = await artikelVarianten({ sheets, ssotId: '0001' });
    expect(v.varianten).toEqual([
      { wcVariationId: '501', farbe: 'Deep Black', rest: '2XL', articleNr: NR },
      { wcVariationId: '502', farbe: 'Deep Black', rest: 'XL', articleNr: NR2 },
    ]);
    await expect(artikelVarianten({ sheets, ssotId: '0003' })).rejects.toMatchObject({ status: 404 });
  });

  test('bestellbareVarianten: Discontinued 3/6 gesperrt', () => {
    const v = [{ Aktiv: 'TRUE', WC_Variation_ID: '1', LShop_ArticleNr: NR, E1: 'Farbe', V1: 'Rot' }];
    expect(bestellbareVarianten(v, new Map([[NR, { status: 'aktiv', discontinued: '6' }]]))).toEqual([]);
    expect(bestellbareVarianten(v, new Map([[NR_AUS, {}]]))).toEqual([]);
    expect(bestellbareVarianten(v, new Map([[NR, { status: 'aktiv', discontinued: '0' }]]))).toHaveLength(1);
  });

  test('eigene Positionen erscheinen im Buendel neben Shop-Positionen', async () => {
    const { sheets } = await gefuellt();
    await legeEigenePositionAn({ sheets, jetzt, eingabe: eingabe({ menge: 2 }) });
    const k = await leseKorb({ shop: 'jfn', sheets });
    const b = k.buendel.find(x => x.articleNr === NR);
    expect(b.positionen.map(p => [p.herkunft, p.menge])).toEqual([['shop', 1], ['eigen', 2]]);
    expect(b.zuBestellen).toBe(3);
    expect(k.summen).toMatchObject({ offen: 4, herausgenommen: 0 });
  });
});

// ── UX: L-Shop-Zeile und Filter ───────────────────────────────────────────────
describe('L-Shop-Zeile je Buendel und Position', () => {
  test('mit Kurzbezeichnung, ohne Kurzbezeichnung, ohne Modellzeile', () => {
    expect(lshopText('1000386845', { catalogNr: 'MRS5004', bezeichnung: 'Sport Socks', color1: 'White', color2: 'Green', size: '37/41' }))
      .toBe('1000386845 · MRS5004 · Sport Socks · White/Green · 37/41');
    expect(lshopText(NR, { catalogNr: 'JH030F', color1: 'Deep Black', size: 'XXL' })).toBe(`${NR} · JH030F · Deep Black · XXL`);
    expect(lshopText(NR, undefined)).toBe(NR);
  });

  test('leseKorb: Bezeichnung aus LShop_Modelle.Description, wenn die Spalte da ist; jede Position traegt die Zeile', async () => {
    const { tabs, sheets } = await gefuellt();
    let b = (await leseKorb({ shop: 'jfn', sheets })).buendel.find(x => x.articleNr === NR);
    expect(b.lshopText).toBe(`${NR} · JH030F · Deep Black · XXL`);
    expect(b.positionen.every(p => p.lshopText === b.lshopText)).toBe(true);

    tabs.LShop_Modelle = tabs.LShop_Modelle.map((z, i) => [...z, i === 0 ? 'Description' : 'Ugly Sweater Basic']);
    _resetLShopCache();
    b = (await leseKorb({ shop: 'jfn', sheets })).buendel.find(x => x.articleNr === NR);
    expect(b.lshopText).toBe(`${NR} · JH030F · Ugly Sweater Basic · Deep Black · XXL`);
  });
});

describe('Frontend: Filter Offen/Herausgenommen/Alle', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  test('--info in :root, Filter-CSS nur ueber var(--info), keine feste Farbe', () => {
    expect(html).toMatch(/:root\s*\{[^}]*--info:\s*#[0-9a-f]{6}/i);
    const css = html.match(/\.korb-filter button[\s\S]*?\}\s*\.korb-filter button\[aria-pressed="true"\][^}]*\}/)[0];
    expect(css).toContain('var(--info)');
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
  test('drei Filterknoepfe, alter Schalter entfernt, Filter wird gemerkt', () => {
    expect([...html.matchAll(/data-filter="(\w+)"/g)].map(m => m[1])).toEqual(['offen', 'raus', 'alle']);
    expect(html).not.toContain('id="korb-alle"');
    expect(html).toMatch(/localStorage\.setItem\(KORB_FILTER_KEY/);
  });
});

// ── Abgleich laesst abgewählt und eigen in Ruhe ───────────────────────────────
describe('Abgleich nach BO3-Aktionen', () => {
  test('abgewählte und eigene Zeilen bleiben unberuehrt, auch bei Storno/Mengenaenderung', async () => {
    const { tabs, sheets, aufrufe, offene } = await gefuellt();
    await setzeStatus({ sheets, jetzt, auswahl: [{ schluessel: 'JFN:21593:5512', status: 'offen' }], ziel: 'abgewählt', grund: 'schon bestellt' });
    await legeEigenePositionAn({ sheets, jetzt, eingabe: eingabe() });
    const vorher = tabs[TAB_KORB].map(z => [...z]);
    aufrufe.update.length = 0; aufrufe.batchUpdate.length = 0;

    // 21593 storniert (abgewählte Zeile + offene 5513), 21600 Menge geaendert
    const storno = bestellung(21593, 'cancelled', offene[0].line_items);
    const menge  = bestellung(21600, 'processing', [pos(5600, 100, 502, 5)]);
    const wc = machWc([menge], { alle: [storno] });
    const r = await runKorbAbgleich({ sheets, wcFuer: () => wc, jetzt });

    expect(r.shops.JFN).toMatchObject({ neu: 0, hinweiseGesetzt: 2 });   // 5513 storniert, 5600 Menge
    const h = sp('Hinweis');
    expect(zeileVon(tabs, 'JFN:21593:5513')[h]).toBe(HINWEIS.STORNIERT);
    expect(zeileVon(tabs, 'JFN:21600:5600')[h]).toBe(HINWEIS.MENGE);
    for (const s of ['JFN:21593:5512', 'EIGEN:2026-0001']) {
      expect(zeileVon(tabs, s)).toEqual(vorher.find(z => z[0] === s));
    }
    expect(aufrufe.update).toHaveLength(0);
    expect(aufrufe.append).toBe(0);
  });

  function eingabe(o = {}) { return { ssotId: '0001', wcVariationId: '501', menge: 1, referenz: 'Lager', ...o }; }
});
