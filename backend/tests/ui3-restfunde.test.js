// UI3: Restfunde aus der Sichtpruefung (AH1) - Karten am Handy, eine Zeile je Groesse, Namen statt Nummern.
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { sortimentText } from '../utils/bestellseite.js';

const html = fs.readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');

describe('Sortiment als Kategorienamen', () => {
  const kat = [{ nr: '310', pfad: 'Vereine > Fanclub Probe' }, { nr: '315', pfad: 'Vereine > Fanclub Probe > Trikots' }];
  test('Name = letzter Teil des Pfads, Reihenfolge wie im Sortiment', () => {
    expect(sortimentText('310,315', kat)).toBe('Fanclub Probe, Trikots');
    expect(sortimentText(' 315 , 310 ', kat)).toBe('Trikots, Fanclub Probe');
  });
  test('unbekannte Nummer bleibt als Nummer stehen, leer bleibt leer', () => {
    expect(sortimentText('310,999', kat)).toBe('Fanclub Probe, Nr. 999');
    expect(sortimentText('', kat)).toBe('');
    expect(sortimentText('310')).toBe('Nr. 310');
  });
  test('die Liste zeigt den Namen, die Nummer nur als Rueckfall', () => {
    expect(html).toContain('`Dauer · Sortiment ${z.sortimentText || z.Sortiment}`');
  });
});

describe('Oberflaeche', () => {
  test('Anfragen & Eigenauftraege und Jey-Wissen: Tabellen werden am Handy Karten, jede Zelle mit Beschriftung', () => {
    expect((html.match(/class="orders-table hk-karten"/g) ?? []).length).toBe(2);
    expect(html).toContain('class="aw-table hk-karten"');
    for (const l of ['Anfrage-ID', 'Datum', 'Kunde', 'Produkt', 'Menge', 'Status', 'Partner', 'Bezeichnung', 'Fulfillment', 'Kanal', 'Wert', 'Notiz']) expect(html).toContain(`data-label="${l}"`);
    expect(html).toMatch(/@media \(max-width: 600px\) \{\s*table\.hk-karten/);
  });
  test('Auftragsansicht: je Position eine Zeile (Haken … entfernen)', () => {
    expect(html).toContain('<div class="au-pos-zeile"><div class="au-pos">');
    expect(html).toMatch(/\.au-pos-zeilen \{ display: flex; flex-direction: column; \}/);
  });
  test('Haken ohne Text stehen in einem Label (Tippflaeche), nie in einem div', () => {
    expect(html).not.toContain('<div class="card-cb-wrap">');
    expect((html.match(/<label class="card-cb-wrap">/g) ?? []).length).toBe(2);   // GT1: alter L-Shop-Weg entfernt
  });
  test('Lieferzeit in der Problemliste: Name, die Nummer nur wenn der Name fehlt', () => {
    expect(html).toContain('a.lieferzeit.name || `Nr. ${a.lieferzeit.id} (nicht in der Lieferzeiten-Liste)`');
  });
  test('keine Auftragskuerzel in Texten fuer Nicole', () => {
    expect(html).not.toMatch(/vor LK1 erstellt/);
  });
});
