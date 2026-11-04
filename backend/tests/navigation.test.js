// NAV4: Navigation in 8 Bereichen (BO5-1: Lager, AM-1: Auftraege). Die Tabelle BEREICHE in index.html (Block
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
    expect(knoepfe).toEqual(['dashboard', 'auftraege', 'bestellen', 'artikel', 'partner', 'kunden', 'lager', 'system']);   // BO5-1: Lager; AM-1-1: Auftraege direkt hinter Dashboard
  });

  test('Handy: Hauptnavigation als Kacheln 4 × 2 (Inhaber 03.11.), 8 Bereiche passen ohne Scrollen', () => {
    const block = html.match(/@media \(max-width: 600px\) \{\s*nav \{([^}]*)\}/)?.[1] ?? '';
    expect(block).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
    expect(block).toContain('overflow: visible');
    expect(Object.keys(BEREICHE)).toHaveLength(8);
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
    expect(html).toMatch(/<button class="sub-tab" data-subtab="tab-lshop-uebersicht"[^>]*>[^<]*<\/button>\s*<button class="sub-tab" data-subtab="tab-lshop-bestellungen"[^>]*>/);
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

describe('NAV5: 2. Ebene am Handy als Kacheln (Violett), Desktop unveraendert', () => {
  const css = html.slice(html.indexOf('/* NAV5 (Inhaber 04.11.)'), html.indexOf('/* Shop-Badge in Bereichen'));
  test('nur bis 600 px: Raster statt Scrollleiste, Umbruch statt Abschneiden, eigene Farbe', () => {
    expect(css).toMatch(/@media \(max-width: 600px\)/);
    expect(css).toMatch(/:root \.sub-tabs, :root \.mode-toggle \{[^}]*display: grid;[^}]*auto-fill[^}]*overflow: visible;/);
    expect(css).toMatch(/white-space: normal;/);
    expect(css).toMatch(/var\(--nav2-aktiv\)/);
    expect(css).not.toMatch(/--nav-kachel/);   // nicht das Blau der Hauptkacheln
    expect(html).toMatch(/--nav2-rand: #[0-9a-f]{6}; --nav2-text: #[0-9a-f]{6}; --nav2-aktiv: #[0-9a-f]{6}; --nav2-aktiv-rand: #[0-9a-f]{6};/);
    // Desktop-Regel bleibt (eine Zeile, scrollt fuer sich)
    expect(html).toContain('.sub-tabs { display: flex; gap: 0; margin-bottom: 1.25rem; border-bottom: 1px solid var(--border); overflow-x: auto;');
  });
  test('Shop-Zusatz in .sub-shop (am Handy aus), Name ohne Zusatz', () => {
    expect(css).toMatch(/\.sub-shop \{ display: none; \}/);
    expect(html).toContain("el.innerHTML = `${text}<span class=\"sub-shop\"> (${kurz})</span>`");
    for (const n of ['Bestellungen', 'DTF Bestellungen', 'L-Shop-Warenkorb', 'Bestellübersicht', 'L-Shop-Bestellungen']) expect(html).toContain(`sub('`);
    expect(html).toContain('>Trikots<span class="sub-shop"> (JFN)</span></button>');
    expect(html).not.toMatch(/sub\('tab-[a-z-]+',\s*`[^`]*\(\$\{kurz\}\)`\)/);
  });
  test('jeder Unterpunkt einer Bereichsleiste wird als Kachel (Knopf .sub-tab) gezeichnet', () => {
    expect(html).toContain('`<button class="sub-tab${p.id === punkt ? \' active\' : \'\'}" data-punkt="${p.id}" data-hilfe="nav-ansicht">${p.label}</button>`');
    for (const [b, def] of Object.entries(BEREICHE).filter(([, d]) => d.leiste)) expect([b, def.punkte.length]).toEqual([b, expect.any(Number)]);
  });
});
