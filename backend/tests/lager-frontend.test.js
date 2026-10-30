// BO5-1: Frontend-Block "Lager-Anzeige" aus index.html (reine Logik) und Verdrahtung des Bereichs Lager.
// Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const gr = html.slice(html.indexOf('// ── Groessen: Anfang'), html.indexOf('// ── Groessen: Ende ──'));
const block = html.slice(html.indexOf('// ── Lager-Anzeige: Anfang'), html.indexOf('// ── Lager-Anzeige: Ende ──'));
const F = new Function(`${gr}\n${block}\nreturn { lagerText, lagerFiltern, lagerVerlaufFiltern, lagerGruppen, lagerRasterReihe, lagerAuswahl, lagerSummeText, lagerAnfrage, lagerDaAmOrt, lagerDatum };`)();

const p = (schluessel, ort, menge, extra = {}) => ({ schluessel, ort, menge, warenart: 'rohling', modell: 'E3000', name: 'Shirt', farbe: 'Black', groesse: 'M', ...extra });

describe('Lager-Anzeige', () => {
  test('Block gefunden', () => expect(block.length).toBeGreaterThan(500));

  const posten = [
    p('LS:1', 'Regal A', 3, { groesse: 'XL' }), p('LS:2', 'Regal A', 2, { groesse: 'S' }), p('LS:3', 'Werkstatt', 0, { groesse: '128' }),
    p('LS:2', 'Werkstatt', 1, { groesse: 'S' }), p('WC:9', 'Regal A', 4, { warenart: 'fertig', modell: 'Oldschool', name: '', farbe: 'Navy', groesse: 'L' }),
    p('FREI:LA-0001', 'Werkstatt', 1, { warenart: 'frei', modell: 'Stoffbeutel', name: '', farbe: '', groesse: '' }),
  ];

  test('Bestand 0 standardmaessig weg, auf Wunsch da', () => {
    expect(F.lagerFiltern(posten).map(x => x.schluessel)).not.toContain('LS:3');
    expect(F.lagerFiltern(posten, { null: true }).map(x => x.schluessel)).toContain('LS:3');
  });
  test('Filter Warenart, Ort, Suche', () => {
    expect(F.lagerFiltern(posten, { warenart: 'fertig' }).map(x => x.schluessel)).toEqual(['WC:9']);
    expect(F.lagerFiltern(posten, { ort: 'Werkstatt' }).map(x => x.schluessel)).toEqual(['LS:2', 'FREI:LA-0001']);
    expect(F.lagerFiltern(posten, { suche: 'navy' }).map(x => x.schluessel)).toEqual(['WC:9']);
    expect(F.lagerFiltern(posten, { suche: 'beutel' }).map(x => x.schluessel)).toEqual(['FREI:LA-0001']);
  });
  test('Gruppen je Modell + Farbe mit Summe, Groessen sortiert (Kinder vorn), dann Ort; Warenart-Reihenfolge', () => {
    const g = F.lagerGruppen(F.lagerFiltern(posten, { null: true }));
    expect(g.map(x => [x.warenart, x.modell, x.farbe, x.summe])).toEqual([
      ['rohling', 'E3000', 'Black', 6], ['fertig', 'Oldschool', 'Navy', 4], ['frei', 'Stoffbeutel', '', 1],
    ]);
    expect(g[0].zeilen.map(z => `${z.groesse}@${z.ort}`)).toEqual(['128@Werkstatt', 'S@Regal A', 'S@Werkstatt', 'XL@Regal A']);
  });
  test('Raster-Reihe: Kindergroessen vorn, dann S..XL', () => {
    const r = F.lagerRasterReihe([{ groesse: 'XL' }, { groesse: 'S' }, { groesse: '152' }, { groesse: 'M' }, { groesse: '128' }]);
    expect(r.map(x => x.groesse)).toEqual(['128', '152', 'S', 'M', 'XL']);
  });
  test('Auswahl: leer und 0 zaehlen nicht, Unsinn ist ein Fehler; bei der Korrektur zaehlt 0', () => {
    const raster = [{ schluessel: 'LS:1', label: 'S' }, { schluessel: 'LS:2', label: 'M' }, { schluessel: 'LS:3', label: 'L' }];
    expect(F.lagerAuswahl(raster, { 'LS:1': '2', 'LS:2': '0', 'LS:3': '' })).toEqual({ posten: [{ schluessel: 'LS:1', label: 'S', menge: 2 }], fehler: [], stueck: 2 });
    expect(F.lagerAuswahl(raster, { 'LS:2': '0' }, { zaehlung: true }).posten).toEqual([{ schluessel: 'LS:2', label: 'M', menge: 0 }]);
    expect(F.lagerAuswahl(raster, { 'LS:1': '1.5', 'LS:2': '-1', 'LS:3': '10000' }).fehler).toEqual(['S', 'M', 'L']);
    expect(F.lagerSummeText(F.lagerAuswahl(raster, { 'LS:1': '2', 'LS:3': '1' }))).toBe('2 Zeilen, 3 Stück: S × 2 · L × 1');
  });
  test('Anfrage: Startbestand-Haken macht aus Einbuchen die Aktion start ohne Art', () => {
    const a = F.lagerAuswahl([{ schluessel: 'LS:1', label: 'S' }], { 'LS:1': '4' });
    const z = { modus: 'einbuchen', start: true, art: 'vorrat', ort: 'Regal A', zielOrt: 'Werkstatt', grund: ' ', notiz: 'Kiste 1', vorgang: 'v-12345678' };
    expect(F.lagerAnfrage(z, a)).toEqual({ aktion: 'start', art: '', ort: 'Regal A', zielOrt: '', grund: '', notiz: 'Kiste 1', vorgang: 'v-12345678', posten: [{ schluessel: 'LS:1', menge: 4 }] });
    expect(F.lagerAnfrage({ ...z, start: false }, a)).toMatchObject({ aktion: 'einbuchen', art: 'vorrat' });
    expect(F.lagerAnfrage({ ...z, modus: 'umlagern' }, a)).toMatchObject({ aktion: 'umlagern', art: '', zielOrt: 'Werkstatt' });
  });
  test('da am Ort und Datum (Berlin)', () => {
    expect(F.lagerDaAmOrt(posten, 'Werkstatt').get('LS:2')).toBe(1);
    expect(F.lagerDatum('2026-11-02T10:05:00Z')).toBe('02.11.26, 11:05');
    expect(F.lagerDatum('x')).toBe('');
  });
});

describe('Bereich Lager in der Seite', () => {
  test('Panel, Leiste mit Bestand und Buchungen, Laden ueber mc:ansicht', () => {
    expect(html).toMatch(/<section id="panel-lager" class="panel">/);
    expect(html).toMatch(/lager: \{ label: 'Lager', leiste: true, shop: false, punkte: \[\s*\{ id: 'bestand',[^\n]*panel: 'lager' \},\s*\{ id: 'buchungen',[^\n]*panel: 'lager' \}/);
    expect(html).toMatch(/addEventListener\('mc:ansicht', e => \{\s*if \(e\.detail\?\.panel !== 'lager'\) return;/);
  });
  test('je Aktion ein Knopf, alle mit Hilfetext; Mengenfelder mit Zifferntastatur', () => {
    for (const a of ['einbuchen', 'ausbuchen', 'umlagern', 'zaehlung']) expect(html).toMatch(new RegExp(`data-lager-aktion="${a}" data-hilfe="lager-`));
    expect(html).toMatch(/type="number"[^<]{0,120}inputmode="numeric"[\s\S]{0,200}data-schluessel=/);
  });
  test('Buchen schickt die Vorgangs-Kennung, sperrt den Knopf und erneuert die Kennung erst nach Erfolg', () => {
    const fn = html.slice(html.indexOf('async function lagerBuchen'), html.indexOf('async function lagerOrtAnlegen'));
    expect(fn).toMatch(/if \(lagerDlg\.laeuft\) return;/);
    expect(fn).toMatch(/disabled = true/);
    const erfolg = fn.indexOf("lagerPost('buchen'"), neu = fn.indexOf('lagerDlg.vorgang = lagerVorgang()'), fang = fn.indexOf('catch (e)');
    expect(erfolg).toBeGreaterThan(0);
    expect(neu).toBeGreaterThan(erfolg);
    expect(neu).toBeLessThan(fang);
  });
  test('kein Rueckenname: Trikot-Hinweis sagt es ausdruecklich', () => {
    expect(html).toMatch(/nie den Rückennamen/);
  });
});
