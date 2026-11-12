// FK1: Farbrollen - jeder Farbwert steht nur in :root, sonst nur var(--…). Eine Farbe = eine Rolle.
// FK4: die Bloecke stehen in frontend/farben.css (einzige Quelle fuer MC und beide Partnerportale).

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const farbenCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/farben.css'), 'utf8');   // FK4
const rootMatch = farbenCss.match(/:root\s*\{[^}]*\}/);
const root = rootMatch[0];
const hellMatch = farbenCss.match(/:root\[data-theme="light"\]\s*\{[^}]*\}/);   // FK2: heller Modus, ebenfalls nur Farbwerte
const hellBlock = hellMatch ? hellMatch[0] : '';
// FK7: einzige Ausnahme in index.html ist der Layout-Block (nur Breiten, Inhaber 12.11.) - der Test FK7 prueft, dass dort keine Farbe steht
const layoutBlock = html.match(/\/\* ── Layout: Anfang[\s\S]*?Layout: Ende ── \*\//)?.[0] || '';
const ohneRoot = html.replace(layoutBlock, '');   // FK4: index.html hat keine eigenen Farbbloecke mehr, alles steht in farben.css
const regel = sel => { const m = html.indexOf(`
      ${sel}`); const i = m < 0 ? html.indexOf(sel) : m + 7; return i < 0 ? '' : html.slice(i, html.indexOf('}', i) + 1); };

/**
 * Ausnahmen (begruendet):
 *  - <meta name="theme-color">: Farbe der Browser-Leiste, ein HTML-Attribut ohne CSS - var() wirkt dort nicht.
 *  - HTML-Zeichenreferenzen wie &#128279; / &#8226; sind Zeichen, keine Farben.
 */
const ohneAusnahmen = ohneRoot
  .replace(/<meta name="theme-color" content="#[0-9a-f]{6}" \/>/i, '')
  .replace(/&#\d+;/g, '');

describe('FK1: Farbwerte nur in :root', () => {
  test(':root vorhanden und enthaelt die Rollen', () => {
    for (const v of ['--bg', '--surface', '--surface-2', '--border', '--text', '--muted', '--disabled', '--accent', '--accent-text', '--info',
      '--warning', '--danger', '--danger-bg', '--success', '--success-bg', '--status-design', '--au', '--ag', '--shop-jfn', '--shop-honk',
      '--nav-kachel', '--nav2-aktiv']) {
      expect([v, new RegExp(`${v}:\\s*[^;]+;`).test(root)]).toEqual([v, true]);
    }
  });
  test('Werte laut Auftrag', () => {
    const wert = v => root.match(new RegExp(`${v}:\\s*([^;\\s]+)`))[1].toLowerCase();
    expect(wert('--accent')).toBe('#fcb201');   // Markengold, Inhaber 06.11. (FK5, vorher #e8c44a)
    expect(wert('--accent-text')).toBe('#111');
    expect(wert('--info')).toBe('#4a9eff');
    expect(wert('--warning')).toBe('#f0a030');
    expect(wert('--danger')).toBe('#e86464');   // FK2: von #e05252 nachgeschaerft (Kontrast AA auf Chip und --danger-bg)
    expect(wert('--success')).toBe('#52c97a');
    expect(wert('--status-design')).toBe('#a184ec');
    expect(wert('--au')).toBe('#2bb3a3');
    expect(wert('--ag')).toBe('#9a8fb8');
    expect(wert('--shop-jfn')).toBe('#c9a04a');
    expect(wert('--shop-honk')).toBe('#e66aa8');   // FK2: von #e05fa0 nachgeschaerft (Kontrast AA)
  });
  test('ausserhalb :root kein Hex-, rgb()- oder hsl()-Farbwert (CSS, Inline, JS)', () => {
    const treffer = [...ohneAusnahmen.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)]
      .map(m => m[0]).filter(t => !t.startsWith('#') || [4, 5, 7, 9].includes(t.length));
    expect(treffer).toEqual([]);
  });
  test('keine benannten Farben (white, red, orange …) in Farb-Eigenschaften', () => {
    expect(ohneAusnahmen.match(/(?:color|background|fill|stroke)\s*:\s*['"]?(?:white|black|red|orange|green|gold|yellow|blue|gr[ae]y|purple|pink)\b/gi)).toBeNull();
    expect(ohneAusnahmen).not.toMatch(/var\(--[a-z0-9-]+,\s*(?:white|black|red|orange|#)/i);   // keine Ersatzfarben mehr
  });
  test('Variablen werden nur in :root definiert, und jede benutzte ist definiert', () => {
    expect(ohneRoot.match(/^\s*--[a-z0-9-]+\s*:/gm)).toBeNull();
    const definiert = new Set([...(root + hellBlock + layoutBlock).matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
    const benutzt = new Set([...html.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]));
    expect([...benutzt].filter(v => !definiert.has(v))).toEqual([]);
  });
});

describe('FK1: Rollen', () => {
  test('Gold (--accent) nur fuer Hauptaktion, aktiven Reiter und die Rolle --focus', () => {
    const regeln = [...html.matchAll(/([^{}\n]+)\{[^}]*var\(--accent\)[^}]*\}/g)].map(m => m[1].trim()).filter(r => r !== ':root');
    const erlaubt = /\.active|korb-aktion-haupt|anf-new-btn|btn-secondary|aw-save-btn|variant-upload-btn|^\.btn\b|mc-login-toast|nav button\.active/;
    expect(regeln.filter(r => !erlaubt.test(r))).toEqual([]);
  });
  test('--warning: Goalie-Hinweis, Wartestellung, RS1 sofort/KW, Anfragen-KPI neu, Ware offen, Termin bald', () => {
    expect(regel('.tr-gk-frage {')).toContain('var(--warning)');
    expect(regel('.tr-gk-zaehler, .tr-gk-warnung {')).toContain('var(--warning)');
    expect(regel('.badge-on-hold')).toContain('var(--warning)');
    expect(regel('.rs-sofort, .rs-kw {')).toContain('var(--warning)');
    expect(regel('.anf-kpi-neu .anf-kpi-value')).toContain('var(--warning)');
    expect(regel('.ku-chip.au-ware-offen {')).toContain('var(--warning)');
    expect(regel('.au-bald {')).toContain('var(--warning)');
    for (const s of ['.tr-gk-frage {', '.badge-on-hold', '.rs-sofort, .rs-kw {']) expect(regel(s)).not.toContain('danger');
  });
  test('--danger nur fuer Fehler/ueberfaellig/Storno/RS1 in Klaerung', () => {
    expect(regel('.rs-klaerung, .rs-unbekannt {')).toContain('var(--danger)');
    expect(regel('.rs-veraltet {')).toContain('var(--danger)');
    expect(regel('.td-ueberfaellig .td-faellig {')).toContain('var(--danger)');
    expect(regel('.badge-cancelled')).toContain('var(--danger)');
    expect(regel('.ku-gefahr {')).toContain('var(--danger)');
  });
  test('--info: Links, aktuell/heute; Shop-Kennzeichen eigene Farben; Abholung --au', () => {
    expect(regel('.korb-link {')).toContain('var(--info)');
    expect(regel('.au-schritt.au-aktuell {')).toContain('var(--info)');
    expect(regel('.td-heute .td-faellig {')).toContain('var(--info)');
    expect(regel('#shop-badge {')).toContain('var(--shop-jfn)');
    expect(regel('#shop-badge.shop-honk {')).toContain('var(--shop-honk)');
    expect(regel('.ps-versand-abholung {')).toContain('var(--au)');
  });
  test('Navigationsfarben nur fuer die Handy-Navigation (nav, Unterreiter am Handy)', () => {
    const regeln = [...html.matchAll(/([^{}\n]+)\{[^}]*var\(--nav(?:-kachel|2)[^}]*\}/g)].map(m => m[1].trim());
    expect(regeln.length).toBeGreaterThan(0);
    for (const r of regeln) expect([r, /nav|sub-tab|mode-btn|bereich-leiste/.test(r)]).toEqual([r, true]);
  });
  test('Auftragsstatus gedaempft: Anfrage grau, Angebot info, Design, bestellt/Produktion petrol, fertig gruen, storniert rot', () => {
    expect(regel('.ku-chip.au-st-anfrage {')).toContain('var(--muted)');
    expect(regel('.ku-chip.au-st-angebot {')).toContain('var(--info)');
    expect(regel('.ku-chip.au-st-design {')).toContain('var(--status-design)');
    expect(regel('.ku-chip.au-st-bestellt, .ku-chip.au-st-produktion {')).toContain('var(--au)');
    expect(regel('.ku-chip.au-st-fertig {')).toContain('var(--success)');
    expect(regel('.ku-chip.au-st-uebergeben {')).toContain('var(--success)');
    expect(regel('.ku-chip.au-st-storniert {')).toContain('var(--danger)');
  });
});

describe('FK1: Kennzeichen Auftrag/Aufgabe', () => {
  const ku = html.slice(html.indexOf('// ── Kunden-Liste: Anfang'), html.indexOf('// ── Kunden-Liste: Ende ──'));
  const block = html.slice(html.indexOf('// ── Auftraege-Anzeige: Anfang'), html.indexOf('// ── Auftraege-Anzeige: Ende ──'));
  const F = new Function(`${ku}\n${block}\nreturn { kzHtml, auStatusKlasse };`)();
  test('AU in --au, AG in --ag, maskiert, Mouse-over nur ausserhalb von Knoepfen', () => {
    expect(regel('.kz-au {')).toContain('var(--au)');
    expect(regel('.kz-ag {')).toContain('var(--ag)');
    expect(F.kzHtml('AU-2026-0001')).toBe('<span class="kz kz-au" data-hilfe="au-nr" tabindex="0">AU-2026-0001</span>');
    expect(F.kzHtml('AG-2026-0002', false)).toBe('<span class="kz kz-ag">AG-2026-0002</span>');
    expect(F.kzHtml('K-00001<b>')).toBe('K-00001&lt;b&gt;');
  });
  test('Status -> Klasse', () => {
    expect(F.auStatusKlasse('in Produktion')).toBe(' au-st-produktion');
    expect(F.auStatusKlasse('bezahlt')).toBe(' au-st-uebergeben');
    expect(F.auStatusKlasse('unbekannt')).toBe('');
  });
  test('Nummer erscheint als Kennzeichen in Liste, Ansicht, To-do-Uebersicht und Treffern', () => {
    expect(html).toContain('<span class="ku-nr">${kzHtml(a.Auftrag_Nr)}</span>');
    expect(html).toContain('<span class="ku-nr">${kzHtml(g.Aufgabe_Nr)}</span>');
    expect(html).toContain("auEl('au-d-titel').innerHTML = `${kzHtml(a.Auftrag_Nr)} · ${kuEsc(a.Kurztitel)}`;");
    expect(html).toContain("auEl('ag-d-titel').innerHTML = `${kzHtml(g.Aufgabe_Nr)} · ${kuEsc(g.Kurztitel)}`;");
    expect(html).toContain('${kzHtml(bezug.nr, false)}');
    expect((html.match(/vorHtml: kzHtml\(a\.Auftrag_Nr, false\)/g) ?? []).length).toBe(2);
  });
});

// ── FK2: heller Modus, Knoepfe, Kontrast ──
const parseVars = txt => Object.fromEntries([...txt.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].replace(/\/\*.*?\*\//g, '').trim()]));
const DUNKEL = parseVars(root);
const HELL = { ...DUNKEL, ...parseVars(hellBlock) };
const hex = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const farbe = (n, vars) => { const w = vars[n]; const v = w.match(/^var\((--[a-z0-9-]+)\)$/); if (v) return farbe(v[1], vars); if (w === 'transparent') return farbe('--bg', vars); return hex(w); };
const lum = c => { const f = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const kontrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const grund = (b, vars) => { if (!b.startsWith('mix:')) return farbe(b, vars); const [, v, p, g] = b.split(':'); const c = farbe(v, vars); const u = farbe(g, vars); return c.map((x, i) => x * p / 100 + u[i] * (1 - p / 100)); };
const PAARE = [
  ['--text', '--bg'], ['--text', '--surface'], ['--muted', '--surface'], ['--muted', '--bg'], ['--text', '--surface-2'],
  // FK5: --accent auf --bg = Markengold als Umrissknopf/aktiver Reiter auf der Seite (auf der Karte: --surface)
  ['--accent', '--surface'], ['--accent', '--bg'], ['--accent-text', '--accent'], ['--info', '--surface'], ['--info', 'mix:--info:12:--surface'], ['--bg', '--info'],
  ['--warning', '--surface'], ['--warning', '--warning-bg'], ['--warning', 'mix:--warning:16:--surface'],
  ['--danger', '--surface'], ['--danger', '--danger-bg'], ['--danger', 'mix:--danger:12:--surface'], ['--bg', '--danger'],
  ['--success', '--surface'], ['--success', '--success-bg'], ['--bg', '--success'],
  ['--bg', '--warning'],   // TR10: bestätigtes GK-Kästchen (Schrift --bg auf --warning)
  ['--status-design', 'mix:--status-design:12:--surface'], ['--au', 'mix:--au:22:--surface'], ['--ag', '--surface'],
  // DB1: Dashboard-Kacheln (Zahl in Rollenfarbe auf der Karte, Grau bei 0) und Shop-Punkte in den Listen
  ['--au', '--surface'], ['--shop-jfn', '--surface'], ['--shop-honk', '--surface'], ['--text', '--surface-2'],
  ['--shop-jfn', 'mix:--shop-jfn:15:--surface'], ['--shop-honk', 'mix:--shop-honk:15:--surface'],
  ['--nav-kachel-text', '--nav-kachel'], ['--on-color', '--nav-kachel-aktiv'], ['--nav2-text', '--nav2-kachel'], ['--on-color', '--nav2-aktiv'],
];

describe('FK2: heller Modus', () => {
  test('Hell-Block vorhanden, nur Variablen, die es dunkel auch gibt; color-scheme je Modus', () => {
    expect(hellBlock).not.toBe('');
    for (const v of Object.keys(parseVars(hellBlock))) expect([v, v in DUNKEL]).toEqual([v, true]);
    expect(root).toMatch(/color-scheme:\s*dark/);
    expect(hellBlock).toMatch(/color-scheme:\s*light/);
    for (const v of ['--bg', '--surface', '--text', '--muted', '--accent', '--accent-text', '--info', '--warning', '--danger', '--success', '--au', '--ag',
      '--shop-jfn', '--shop-honk', '--nav-kachel', '--nav-kachel-text', '--nav2-kachel', '--nav2-text', '--focus']) expect([v, v in parseVars(hellBlock)]).toEqual([v, true]);
  });
  test('Grund hellgrau, Karten weiss; --focus hell eigenstaendig (Info), dunkel = Akzent', () => {
    expect(HELL['--bg']).toBe('#ecebe7');   // FK6: von #f5f5f3 (Karten deutlicher)
    expect(HELL['--surface']).toBe('#ffffff');
    expect(HELL['--accent']).toBe('#8a5f00');   // Markengold, Inhaber 06.11. (FK5, vorher #8f6b00)
    expect(HELL['--focus']).toBe('var(--info)');
    expect(DUNKEL['--focus']).toBe('var(--accent)');
  });
  test.each(PAARE)('Kontrast %s auf %s >= 4,5 in beiden Modi (WCAG AA)', (f, b) => {
    for (const [modus, vars] of [['dunkel', DUNKEL], ['hell', HELL]]) {
      const k = kontrast(farbe(f, vars), grund(b, vars));
      expect([modus, k >= 4.5 ? 'ok' : k.toFixed(2)]).toEqual([modus, 'ok']);
    }
  });
  test('FK6: Rand >= 1,5:1 zu Grund und Karte (beide Modi)', () => {
    for (const [modus, vars] of [['dunkel', DUNKEL], ['hell', HELL]]) {
      for (const g of ['--bg', '--surface']) {
        const k = kontrast(farbe('--border', vars), farbe(g, vars));
        expect([modus, g, k >= 1.5 ? 'ok' : k.toFixed(2)]).toEqual([modus, g, 'ok']);
      }
    }
  });
  test('FK7: Kartenbreite zentral (800 px, Trikots 1000 px), breite Tabellen ausgenommen', () => {
    const block = layoutBlock;
    expect(block).not.toBe('');
    // im Layout-Block stehen nur die zwei Breiten-Variablen, keine Farbe
    expect([...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1])).toEqual(['--karten-max-breite', '--listen-max-breite']);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|color/);
    expect(block).toContain('--karten-max-breite: 800px;');
    expect(block).toContain('--listen-max-breite: 1000px;');
    expect(block).toContain('.panel .card:not(.inhalt-breit, .inhalt-liste, .card .card) { max-width: var(--karten-max-breite); }');
    expect(block).toContain('.panel .card.inhalt-liste { max-width: var(--listen-max-breite); }');
    // Breiten nur im Layout-Block, nie in farben.css; die alte Einzelklasse ist weg
    expect(farbenCss).not.toMatch(/max-breite/);
    expect(html).not.toMatch(/inhalt-schmal/);
    expect(html.replace(block, '')).not.toMatch(/--(karten|listen)-max-breite:/);
    // Aufträge-Bereich (Kunden, Liste, To-dos, Bestellseiten) folgt der allgemeinen Regel
    for (const id of ['ku-ansicht', 'au-ansicht', 'td-ansicht', 'bsm-ansicht']) expect(html).toContain(`class="card" id="${id}"`);
    // Trikots: genau die zwei Karten im Reiter
    const trikots = html.match(/<div id="tab-trikots"[\s\S]*?<div id="tab-eingaenge"/)[0];
    expect((trikots.match(/class="card inhalt-liste"/g) || []).length).toBe(2);
    expect((html.match(/class="card inhalt-liste"/g) || []).length).toBe(2);
    // Ausnahmeliste (Bericht FK7): neue breite Tabelle = Klasse inhalt-breit und Zahl hier anpassen
    expect((html.match(/class="card inhalt-breit"/g) || []).length).toBe(26);
    expect(html).toContain('class="card inhalt-breit" id="existing-variants-block"');
  });
  test('kein Knopf mit --success als Hintergrund (Aktion = --accent, Erfolg nur Zustand)', () => {
    const knopfKlassen = [...new Set([...html.matchAll(/<button[^>]*class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)))].filter(k => /^[a-z][a-z0-9-]*$/.test(k));
    const css = html.match(/<style>([\s\S]*?)<\/style>/g).join('\n');
    const gruen = knopfKlassen.filter(k => new RegExp(`\\.${k}(?![a-z0-9-])[^{]*\\{[^}]*background(?:-color)?:\\s*(?:var\\(--success|color-mix\\(in srgb, var\\(--success)`).test(css));
    expect(gruen).toEqual([]);
    for (const k of ['btn-dtf-bestellen', 'btn-lshop-bestellen', 'btn-complete-order', 'btn-success']) {
      expect([k, new RegExp(`\\.${k} \\{[^}]*background: var\\(--accent\\); color: var\\(--accent-text\\)`).test(css)]).toEqual([k, true]);
    }
    expect(html).not.toMatch(/<button[^>]*style="[^"]*background:\s*var\(--success/);
  });
});

describe('FK4: farben.css zentral', () => {
  const fe = n => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend', n), 'utf8');
  const LINK = '<link rel="stylesheet" href="farben.css">';
  test('farben.css enthaelt nur die zwei Bloecke (plus Kommentare)', () => {
    const rest = farbenCss.replace(root, '').replace(hellBlock, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    expect(rest).toBe('');
  });
  test.each(['index.html', 'partner.html', 'partner-festpreis.html'])('%s: bindet farben.css im <head> nach dem Theme-Skript und vor <style> ein, eigene Farbbloecke gibt es nicht', datei => {
    const s = fe(datei);
    const l = s.indexOf(LINK);
    expect(l).toBeGreaterThan(0);
    expect(l).toBeLessThan(s.indexOf('<style>'));
    expect(l).toBeGreaterThan(s.indexOf('Theme: Ende'));
    expect(l).toBeLessThan(s.indexOf('</head>'));
    expect(s.replace(layoutBlock, '').match(/:root\s*\{|:root\[data-theme/g)).toBeNull();   // FK7: Layout-Block (nur Breiten) erlaubt
  });
  test('Service Worker laedt farben.css mit der MC-Shell vor (offline)', () => {
    const pre = fe('sw.js').match(/const PRECACHE = \[([\s\S]*?)\];/)[1];
    expect(pre).toContain("'./farben.css'");
  });
});
