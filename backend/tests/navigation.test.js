// NAV4: Navigation in 7 Bereichen (BO5-1: Lager). Die Tabelle BEREICHE in index.html (Block
// "Navigation-Tabelle") muss jede vorhandene Ansicht erreichbar machen, und die
// Adresse #bereich/unterpunkt muss sauber aufgeloest werden.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html  = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── Navigation-Tabelle: Anfang ──'), html.indexOf('// ── Navigation-Tabelle: Ende ──'));
const nav   = new Function(`${block}\n return { BEREICHE, findeAnsicht, ansichtAusHash, hashFuer, shopWirkt };`)();
const { BEREICHE, ansichtAusHash, hashFuer, shopWirkt } = nav;
// BO4d: Zeilen mit "umleitung" sind alte Adressen ohne eigene Ansicht (eigener Test unten).
const alleZeilen = Object.entries(BEREICHE).flatMap(([b, def]) => def.punkte.map(p => ({ b, ...p })));
const punkte = alleZeilen.filter(p => !p.umleitung);
const umleitungen = alleZeilen.filter(p => p.umleitung);

describe('Tabelle BEREICHE deckt alle vorhandenen Ansichten ab', () => {
  test('Hauptleiste = Bereiche der Tabelle, in derselben Reihenfolge', () => {
    const knoepfe = [...html.matchAll(/<button[^>]*data-bereich="([a-z]+)"/g)].map(m => m[1]);
    expect(knoepfe).toEqual(Object.keys(BEREICHE));
    expect(knoepfe).toEqual(['dashboard', 'bestellen', 'artikel', 'partner', 'kunden', 'lager', 'system']);   // BO5-1: Lager
  });

  test('jedes Panel ist erreichbar, jedes Ziel-Panel existiert', () => {
    const panels = [...html.matchAll(/<section id="panel-([a-z-]+)" class="panel/g)].map(m => m[1]);
    const ziele  = new Set(punkte.map(p => p.panel));
    expect([...ziele].sort()).toEqual([...panels].sort());
  });

  test('jeder Unterreiter im Auftragsmonitor und jeder Artikel-Modus genau einmal', () => {
    // tab-lshop: ausgeblendeter Vorgaenger des Warenkorbs, seit BO4d nicht mehr erreichbar (#bestellen/lshop leitet um).
    const subtabs = [...html.matchAll(/<button class="sub-tab[^"]*" data-subtab="([a-z-]+)"/g)].map(m => m[1]).filter(t => t !== 'tab-lshop');
    const modi    = [...html.matchAll(/id="(mode-btn-[a-z]+)"/g)].map(m => m[1]);
    const knoepfe = punkte.filter(p => p.knopf).map(p => p.knopf);
    for (const t of subtabs) expect(knoepfe.filter(k => k.includes(`data-subtab="${t}"`))).toHaveLength(1);
    for (const m of modi)    expect(knoepfe.filter(k => k === `#${m}`)).toHaveLength(1);
    expect(knoepfe).toHaveLength(subtabs.length + modi.length);
  });

  test('Unterpunkt-IDs sind je Bereich eindeutig', () => {
    for (const def of Object.values(BEREICHE)) {
      const ids = def.punkte.map(p => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test('Bereiche mit eigener Leiste haben fuer jeden Unterpunkt eine Beschriftung', () => {
    for (const def of Object.values(BEREICHE).filter(d => d.leiste)) {
      for (const p of def.punkte) expect(p.label).toBeTruthy();
    }
  });
});

describe('Adresse #bereich/unterpunkt', () => {
  test('Hin und zurueck fuer jeden Unterpunkt', () => {
    for (const p of punkte) {
      const a = ansichtAusHash(hashFuer(p.b, p.id));
      expect([a.bereich, a.punkt]).toEqual([p.b, p.id]);
    }
  });

  test('alte Adresse #bestellen/lshop leitet auf L-Shop-Bestellungen um (BO4d); Umleitungen zeigen auf echte Ansichten', () => {
    expect(ansichtAusHash('#bestellen/lshop')).toMatchObject({ bereich: 'bestellen', punkt: 'lshop-bestellungen' });
    expect(umleitungen.map(u => `${u.b}/${u.id}->${u.umleitung}`)).toEqual(['bestellen/lshop->lshop-bestellungen']);
    for (const u of umleitungen) {
      expect(u.panel).toBeUndefined();
      expect(u.knopf).toBeUndefined();
      expect(punkte.some(p => p.b === u.b && p.id === u.umleitung)).toBe(true);
    }
    expect(html).not.toMatch(/knopf: '#panel-orders \.sub-tab\[data-subtab="tab-lshop"\]'/);
    expect(html).toMatch(/<button class="sub-tab" data-subtab="tab-lshop-uebersicht">[^<]*<\/button>\s*<button class="sub-tab" data-subtab="tab-lshop-bestellungen">/);
  });

  test('nur Bereich -> Bereich ohne Unterpunkt', () => {
    expect(ansichtAusHash('#partner')).toMatchObject({ bereich: 'partner', punkt: null });
  });

  test('leer, unbekannt oder kaputt -> Dashboard bzw. ohne Unterpunkt, ohne Fehler', () => {
    expect(ansichtAusHash('').bereich).toBe('dashboard');
    expect(ansichtAusHash('#gibtsnicht/x').bereich).toBe('dashboard');
    expect(ansichtAusHash('#artikel/quatsch')).toMatchObject({ bereich: 'artikel', punkt: null });
    expect(ansichtAusHash('#%E0%A4%A/x').bereich).toBe('dashboard');
    expect(ansichtAusHash('#constructor').bereich).toBe('dashboard');
  });
});

describe('Shop-Badge wirkt nur, wo der Shop zaehlt', () => {
  test.each([
    ['dashboard', 'start', true], ['bestellen', 'dtf', true], ['artikel', 'neu', true],
    ['partner', 'lizenz', true], ['partner', 'festpreis', false],
    ['kunden', 'anfragen', false], ['kunden', 'wissen', false], ['system', 'einstellungen', false],
  ])('%s/%s -> %s', (b, p, erwartet) => expect(shopWirkt(b, p)).toBe(erwartet));
});

describe('Querverweise laufen ueber oeffneAnsicht', () => {
  test('kein Knopf mit data-panel mehr, keine Klicks auf alte Nav-Knoepfe', () => {
    expect(html).not.toMatch(/data-panel/);
  });
  test('Kachel "Offen" und Login-Toast oeffnen Bereich Bestellen', () => {
    expect(html).toContain("oeffneAnsicht('bestellen', 'bestellungen')");
    expect(html).toContain("oeffneAnsicht('bestellen', 'anfragen')");
  });
  test('Festpreis laedt beim ersten Oeffnen ueber das Ereignis mc:ansicht', () => {
    expect(html).toMatch(/addEventListener\('mc:ansicht'[\s\S]{0,120}festpreis[\s\S]{0,60}loadFpPartner\(\)/);
  });
});
