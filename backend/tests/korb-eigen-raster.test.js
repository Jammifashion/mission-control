// BO6: eigene Positionen im L-Shop-Warenkorb - mehrere Groessen in einem Schritt (Groessenraster).
// Backend (utils/korb-logic.js eigeneZeilen, lib/lshopKorb.js legeEigenePositionenAn) mit der Korb-Attrappe,
// Frontend-Block "Eigene-Raster" aus index.html. Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KORB_SPALTEN, TAB_KORB, korbZeilen, eigeneZeilen, EIGEN_MEHRERE_MAX } from '../utils/korb-logic.js';
import { runKorbAbgleich, legeEigenePositionenAn, _korbCacheLeeren, BESCHAEFTIGT } from '../lib/lshopKorb.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { machSheets, grundTabs, machWc, pos, bestellung, NR, NR2, NR_AUS } from './hilfen/korb-sheet.js';

const jetzt = () => new Date('2026-10-30T09:00:00Z');
const Q_WS = '2000000002', Q_WM = '2000000001', Q_DISC = '2000000003', Q_W128 = '2000000004', Q_W152 = '2000000005', Q_WXL = '2000000006';
beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot';
  process.env.BUSINESS_SHEET_ID = 'ssot';
  _korbCacheLeeren();
  _resetLShopCache();
});
function mitModell(tabs) {
  const [kopf, ...rest] = tabs.LShop_Modelle;
  tabs.LShop_Modelle = [[...kopf, 'Brand', 'CatNrManufacturer', 'Description'],
    ...rest.map(r => [...r, 'James & Nicholson', 'JN030', '']),
    [Q_WM, 'BCWW02Q', 'White', '', 'M', '', '', '0', 'aktiv', 'B&C', 'TW02Q', 'Queen Women T-Shirt'],
    [Q_WS, 'BCWW02Q', 'White', '', 'S', '', '', '0', 'aktiv', 'B&C', 'TW02Q', 'Queen Women T-Shirt'],
    [Q_WXL, 'BCWW02Q', 'White', '', 'XL', '', '', '0', 'aktiv', 'B&C', 'TW02Q', 'Queen Women T-Shirt'],
    [Q_W152, 'BCWW02Q', 'White', '', '152', '', '', '0', 'aktiv', 'B&C', 'TW02Q', 'Queen Women T-Shirt'],
    [Q_W128, 'BCWW02Q', 'White', '', '128', '', '', '0', 'aktiv', 'B&C', 'TW02Q', 'Queen Women T-Shirt'],
    [Q_DISC, 'BCWW02Q', 'Black', '', 'M', '', '', '6', 'aktiv', 'B&C', 'TW02Q', 'Queen Women T-Shirt']];
  return tabs;
}
async function gefuellt() {
  const tabs = grundTabs();
  const m = machSheets(tabs);
  await runKorbAbgleich({ sheets: m.sheets, wcFuer: () => machWc([bestellung(21593, 'processing', [pos(5512, 100, 501)])]), jetzt });
  mitModell(tabs); _resetLShopCache();
  m.aufrufe.update.length = 0; m.aufrufe.batchUpdate.length = 0;
  return { tabs, ...m };
}
const eingabe = (positionen, o = {}) => ({ positionen, referenz: 'Verein X Auftrag 12', notiz: 'Saison', ...o });

describe('eigeneZeilen (Logik)', () => {
  const varianten = [{ articleNr: Q_WS }, { articleNr: Q_WM }];
  test('je Groesse mit Menge > 0 eine Zeile, gleiche Referenz, fortlaufende Nummern; 0/leer ignoriert', () => {
    const z = eigeneZeilen({ eingabe: eingabe([{ articleNr: Q_WS, menge: 2 }, { articleNr: Q_WM, menge: 0 }, { articleNr: Q_WM, menge: '' }, { articleNr: Q_WM, menge: 5 }]),
      varianten, ersterSchluessel: 'EIGEN:2026-0009', jetzt: 'x' });
    expect(z.map(r => [r.Schluessel, r.LShop_ArticleNr, r.Menge, r.Referenz, r.Notiz])).toEqual([
      ['EIGEN:2026-0009', Q_WS, '2', 'Verein X Auftrag 12', 'Saison'], ['EIGEN:2026-0010', Q_WM, '5', 'Verein X Auftrag 12', 'Saison']]);
  });
  test('alles oder nichts: eine ungueltige Groesse -> 422 fuer alle', () => {
    const f = (p, o) => () => eigeneZeilen({ eingabe: eingabe(p, o), varianten, ersterSchluessel: 'EIGEN:2026-0001', jetzt: 'x' });
    expect(f([{ articleNr: Q_WS, menge: 2 }, { articleNr: '9999999999', menge: 1 }])).toThrow(/nicht wählbar/);
    expect(f([{ articleNr: Q_WS, menge: 0 }])).toThrow(/Keine Menge/);
    expect(f([])).toThrow(/Keine Menge/);
    expect(f([{ articleNr: Q_WS, menge: 1 }, { articleNr: Q_WS, menge: 2 }])).toThrow(/doppelt/);
    expect(f([{ articleNr: Q_WS, menge: 1.5 }])).toThrow(/ganze Zahl/);
    expect(f([{ articleNr: Q_WS, menge: 1 }], { referenz: ' ' })).toThrow(/Referenz fehlt/);
    expect(f(Array.from({ length: EIGEN_MEHRERE_MAX + 1 }, (_, i) => ({ articleNr: String(1e9 + i), menge: 1 })))).toThrow(/Höchstens/);
  });
});

describe('legeEigenePositionenAn (Korb-Attrappe)', () => {
  test('mehrere Groessen: ein Schreibaufruf in die Zeilen hinter der letzten, kein append, bestehende Zeilen unveraendert', async () => {
    const { tabs, sheets, aufrufe } = await gefuellt();
    const vorher = tabs[TAB_KORB].map(z => [...z]);
    const r = await legeEigenePositionenAn({ sheets, jetzt, eingabe: eingabe([{ articleNr: Q_WS, menge: 2 }, { articleNr: Q_WXL, menge: 0 }, { articleNr: Q_WM, menge: 3 }, { articleNr: Q_W128, menge: 1 }]) });
    expect(r).toMatchObject({ ok: true, positionen: 3, stueck: 6, schluessel: ['EIGEN:2026-0001', 'EIGEN:2026-0002', 'EIGEN:2026-0003'], startZeile: vorher.length + 1 });
    expect(aufrufe.append).toBe(0);
    expect(aufrufe.update).toEqual([`'${TAB_KORB}'!A${vorher.length + 1}:R${vorher.length + 3}`]);
    vorher.forEach((z, i) => expect(tabs[TAB_KORB][i]).toEqual(z));
    const neu = korbZeilen(tabs[TAB_KORB]).zeilen.slice(-3);
    expect(neu.map(z => [z.LShop_ArticleNr, z.Menge, z.Referenz, z.Herkunft, z.Status, z['SSOT-ID']])).toEqual([
      [Q_WS, '2', 'Verein X Auftrag 12', 'eigen', 'offen', ''], [Q_WM, '3', 'Verein X Auftrag 12', 'eigen', 'offen', ''], [Q_W128, '1', 'Verein X Auftrag 12', 'eigen', 'offen', '']]);
  });
  test('Groesse ohne gueltige Variante (Discontinued 6, ausgelaufen, unbekannt) -> 422, nichts geschrieben', async () => {
    for (const nr of [Q_DISC, NR_AUS, '9999999999']) {
      const { sheets, aufrufe } = await gefuellt();
      await expect(legeEigenePositionenAn({ sheets, jetzt, eingabe: eingabe([{ articleNr: Q_WS, menge: 1 }, { articleNr: nr, menge: 1 }]) })).rejects.toMatchObject({ status: 422 });
      expect(aufrufe.update).toHaveLength(0);
    }
  });
  test('Doppelklick: zweiter Aufruf waehrend des ersten -> 409, genau ein Block geschrieben', async () => {
    const { tabs, sheets, aufrufe } = await gefuellt();
    const e = eingabe([{ articleNr: Q_WS, menge: 2 }, { articleNr: Q_WM, menge: 1 }]);
    const [a, b] = await Promise.allSettled([legeEigenePositionenAn({ sheets, jetzt, eingabe: e }), legeEigenePositionenAn({ sheets, jetzt, eingabe: e })]);
    expect(a.status).toBe('fulfilled');
    expect(b.reason).toMatchObject({ status: 409, message: BESCHAEFTIGT });
    expect(aufrufe.update).toHaveLength(1);
    expect(korbZeilen(tabs[TAB_KORB]).zeilen.filter(z => z.Herkunft === 'eigen')).toHaveLength(2);
  });
  test('Modelle gemischt (zwei Modelle in einem Schritt) gehen auch; weitere Farbe = zweiter Aufruf mit neuen Nummern', async () => {
    const { tabs, sheets } = await gefuellt();
    await legeEigenePositionenAn({ sheets, jetzt, eingabe: eingabe([{ articleNr: Q_WS, menge: 1 }]) });
    const r = await legeEigenePositionenAn({ sheets, jetzt, eingabe: eingabe([{ articleNr: NR, menge: 2 }, { articleNr: NR2, menge: 1 }]) });
    expect(r.schluessel).toEqual(['EIGEN:2026-0002', 'EIGEN:2026-0003']);
    expect(new Set(korbZeilen(tabs[TAB_KORB]).zeilen.filter(z => z.Herkunft === 'eigen').map(z => z.Referenz))).toEqual(new Set(['Verein X Auftrag 12']));
  });
});

// ── Frontend-Block ──
const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const gr = html.slice(html.indexOf('// ── Groessen: Anfang'), html.indexOf('// ── Groessen: Ende ──'));
const block = html.slice(html.indexOf('// ── Eigene-Raster: Anfang'), html.indexOf('// ── Eigene-Raster: Ende ──'));
const F = new Function(`${gr}\n${block}\nreturn { eigenRasterGroessen, eigenRasterAuswahl, eigenSummeText, eigenAnfrage };`)();

describe('Frontend-Block Eigene-Raster', () => {
  const varianten = [
    { farbe: 'White', groesse: 'XL', articleNr: Q_WXL }, { farbe: 'White', groesse: 'S', articleNr: Q_WS },
    { farbe: 'White', groesse: '152', articleNr: Q_W152 }, { farbe: 'White', groesse: 'M', articleNr: Q_WM, auslauf: 2 },
    { farbe: 'White', groesse: '128', articleNr: Q_W128 }, { farbe: 'Black', groesse: 'L', articleNr: '2000000009' },
    { farbe: 'White', groesse: 'L', articleNr: '' },   // ohne ArticleNr -> nicht waehlbar
  ];
  test('Raster: nur diese Farbe, nur mit ArticleNr, Kindergroessen vorn, dann S -> XL', () => {
    const r = F.eigenRasterGroessen(varianten, 'White');
    expect(r.map(x => x.groesse)).toEqual(['128', '152', 'S', 'M', 'XL']);
    expect(r.find(x => x.groesse === 'M').auslauf).toBe(2);
    expect(F.eigenRasterGroessen(varianten, 'Black').map(x => x.groesse)).toEqual(['L']);
    expect(F.eigenRasterGroessen(varianten, '')).toEqual([]);
  });
  test('Auswahl: leer/0 ignoriert, Unsinn ist Fehler; Summe und Anfrage', () => {
    const raster = F.eigenRasterGroessen(varianten, 'White');
    const a = F.eigenRasterAuswahl(raster, { [Q_W128]: '1', [Q_WS]: '0', [Q_WM]: '3', [Q_WXL]: '' });
    expect(a).toMatchObject({ stueck: 4, fehler: [] });
    expect(F.eigenSummeText(a)).toBe('2 Positionen, 4 Stück: 128 × 1 · M × 3');
    expect(F.eigenAnfrage(a, 'Lager', '')).toEqual({ positionen: [{ articleNr: Q_W128, menge: 1 }, { articleNr: Q_WM, menge: 3 }], referenz: 'Lager', notiz: '' });
    const b = F.eigenRasterAuswahl(raster, { [Q_WS]: '1.5', [Q_WM]: '-1', [Q_WXL]: '1000' });
    expect(b.fehler).toEqual(['S', 'M', 'XL']);
    expect(F.eigenSummeText(b)).toMatch(/Menge ungültig bei S, M, XL/);
    expect(F.eigenSummeText(F.eigenRasterAuswahl(raster, {}))).toBe('Noch keine Menge eingetragen.');
  });
});

describe('Einbindung', () => {
  const teil = html.slice(html.indexOf('// ── Eigene Positionen: L-Shop-Modell'), html.indexOf('// Ein Ablauf fuer beide Knoepfe "Abgleich jetzt"'));
  test('Raster statt Groesse/Menge, zwei Knoepfe, Ziffern-Tastatur, Enter = Hinzufuegen', () => {
    expect(html).not.toMatch(/id="korb-eigen-groesse"|id="korb-eigen-menge"/);
    expect(html).toMatch(/<div id="korb-eigen-raster" class="korb-raster" data-hilfe="eigen-raster"/);
    expect(html).toMatch(/id="korb-eigen-speichern" type="button" data-hilfe="eigen-hinzufuegen">Hinzufügen</);
    expect(html).toMatch(/id="korb-eigen-weiter" type="button" data-hilfe="eigen-weitere-farbe">Hinzufügen und weitere Farbe</);
    expect(teil).toMatch(/inputmode="numeric"/);
    expect(teil).toMatch(/if \(ev\.key !== 'Enter'/);
    expect(teil).toContain('/api/bestellen/lshop-korb/eigen/mehrere');
  });
  test('weitere Farbe: Modell, Referenz, Notiz bleiben - nur Farbe und Raster geleert', () => {
    const w = teil.slice(teil.indexOf('if (weitereFarbe) {'), teil.indexOf('} else {', teil.indexOf('if (weitereFarbe) {')));
    expect(w).toMatch(/eigenEl\('korb-eigen-farbe'\)\.value = '';\n\s*korbEigenRaster\(\);/);
    expect(w).not.toMatch(/korbEigenZuruecksetzen|korb-eigen-referenz|korb-eigen-notiz/);
  });
  test('Doppelklick im Browser: laeuft-Sperre + Knoepfe aus', () => {
    expect(teil).toMatch(/if \(korbEigen\.laeuft \|\| !korbEigen\.artikel\) return;/);
    expect(teil).toMatch(/knoepfe\.forEach\(b => \{ b\.disabled = true; \}\);/);
  });
});
