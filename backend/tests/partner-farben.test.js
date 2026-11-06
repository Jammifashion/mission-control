// FK3/FK4: Partnerportale (frontend/partner.html, frontend/partner-festpreis.html) - Farbrollen wie MC ueber die gemeinsame
// frontend/farben.css, heller Modus, Umschalter oben. Nur erfundene Werte.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const hier = dirname(fileURLToPath(import.meta.url));
const lies = n => readFileSync(resolve(hier, '../../frontend', n), 'utf8');
const farben = lies('farben.css');
const parseVars = txt => Object.fromEntries([...txt.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].replace(/\/\*.*?\*\//g, '').trim()]));
const DUNKEL = parseVars(farben.match(/:root\s*\{[^}]*\}/)[0]);
const HELL = { ...DUNKEL, ...parseVars(farben.match(/:root\[data-theme="light"\]\s*\{[^}]*\}/)[0]) };

const hex = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const farbe = (n, vars) => { const w = vars[n]; const v = w.match(/^var\((--[a-z0-9-]+)\)$/); if (v) return farbe(v[1], vars); if (w === 'transparent') return farbe('--bg', vars); return hex(w); };
const lum = c => { const f = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const kontrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const grund = (b, vars) => { if (!b.startsWith('mix:')) return farbe(b, vars); const [, v, p, g] = b.split(':'); const c = farbe(v, vars); const u = farbe(g, vars); return c.map((x, i) => x * p / 100 + u[i] * (1 - p / 100)); };

// Portal-eigene Paare (Badges 15-20 %, Fehler-Box 10 %, Erfolgsmeldung 12 %); die MC-Paare prueft farbrollen.test.js
const PAARE = [
  ['--text', '--surface'], ['--muted', '--surface'], ['--accent-text', '--accent'], ['--danger', 'mix:--danger:10:--surface'],
  ['--warning', 'mix:--warning:15:--surface'], ['--success', 'mix:--success:15:--surface'], ['--info', 'mix:--info:15:--surface'],
  ['--text', 'mix:--muted:20:--surface'], ['--success', 'mix:--success:12:--surface'], ['--text', '--surface-2'],
];
test.each(PAARE)('Kontrast %s auf %s >= 4,5 in beiden Modi', (f, b) => {
  for (const [modus, vars] of [['dunkel', DUNKEL], ['hell', HELL]]) {
    const k = kontrast(farbe(f, vars), grund(b, vars));
    expect([modus, k >= 4.5 ? 'ok' : k.toFixed(2)]).toEqual([modus, 'ok']);
  }
});

describe.each(['partner.html', 'partner-festpreis.html'])('%s', datei => {
  const html = lies(datei);
  const von = html.indexOf('// ── Theme: Anfang');
  const block = html.slice(von, html.indexOf('// ── Theme: Ende ──'));

  test('keine festen Farbwerte, keine eigenen Farbbloecke, farben.css eingebunden; theme-color ohne Wert', () => {
    const rest = html.replace(/&#\d+;/g, '');
    const treffer = [...rest.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map(m => m[0]).filter(t => !t.startsWith('#') || [4, 5, 7, 9].includes(t.length));
    expect(treffer).toEqual([]);
    expect(rest.match(/(?:color|background)\s*:\s*['"]?(?:white|black|red|orange|green|gold|yellow|blue|gr[ae]y)\b/gi)).toBeNull();
    expect(rest).not.toMatch(/var\(--[a-z0-9-]+,/);
    expect(html.match(/^\s*--[a-z0-9-]+\s*:/gm)).toBeNull();
    expect(html).toContain('<link rel="stylesheet" href="farben.css">');
    expect(html).toContain('<meta name="theme-color" content="">');
  });
  test('jede benutzte Variable steht in farben.css', () => {
    const benutzt = new Set([...html.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]));
    expect([...benutzt].filter(v => !(v in DUNKEL))).toEqual([]);
  });
  test('Gold nur fuer Hauptaktion (.btn); Logo --text; Storno --danger; kein Knopf mit --success-Flaeche', () => {
    const regeln = [...html.matchAll(/([^{}\n]+)\{[^}]*var\(--accent\)[^}]*\}/g)].map(m => m[1].trim());
    expect(regeln).toEqual(['.btn']);
    expect(html).toMatch(/header \.logo \{[^}]*color: var\(--text\)/);
    expect(html).toContain('.pl-rot { color: var(--danger);');   // PP3: Storno ueber Klasse statt Inline-Farbe
    expect(html).toContain('<span class="pl-rot pl-klein">↩ Storno</span>');
    expect(html).not.toMatch(/\.(?:btn|btn-outline)[^{]*\{[^}]*background:\s*var\(--success/);
    expect(html).toMatch(/\.badge-offen\s*\{[^}]*color: var\(--warning\)/);
  });
  test('Theme-Block im <head> vor farben.css und <style>, Schluessel partner_theme, wortgleich in beiden Portalen', () => {
    expect(von).toBeGreaterThan(0);
    expect(von).toBeLessThan(html.indexOf('<link rel="stylesheet" href="farben.css">'));
    expect(block).toContain("'partner_theme'");
    expect(block).not.toContain('mc_theme');
    const anderes = lies(datei === 'partner.html' ? 'partner-festpreis.html' : 'partner.html');
    expect(block).toBe(anderes.slice(anderes.indexOf('// ── Theme: Anfang'), anderes.indexOf('// ── Theme: Ende ──')));
  });
  test('Lesen/Schreiben mit gueltigem, fehlendem und werfendem Speicher; MC-Wahl gilt nicht', () => {
    const T = new Function(`${block}\nreturn { ptThemeLies, ptThemeSchreib, ptThemeModus };`)();
    const s = (start = {}) => { const d = { ...start }; return { d, getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; } }; };
    const kaputt = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(T.ptThemeLies(s({ partner_theme: 'light' }))).toBe('light');
    expect(T.ptThemeLies(s({ mc_theme: 'light' }))).toBe('system');
    expect(T.ptThemeLies(null)).toBe('system');
    expect(T.ptThemeLies(kaputt)).toBe('system');
    const sp = s();
    expect(T.ptThemeSchreib(sp, 'dark')).toBe(true);
    expect(sp.d.partner_theme).toBe('dark');
    expect(T.ptThemeSchreib(kaputt, 'dark')).toBe(false);
    expect(T.ptThemeModus('system', q => ({ matches: q === '(prefers-color-scheme: light)' }))).toBe('light');
    expect(T.ptThemeModus('system', null)).toBe('dark');
  });
  test('jedes Skript der Seite ist gueltiges JavaScript (FK4: fehlende Klammer fiel nur in der Vorschau auf)', () => {
    const skripte = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    expect(skripte.length).toBeGreaterThanOrEqual(2);
    for (const [i, code] of skripte.entries()) expect([i, (() => { try { new Function(code); return 'ok'; } catch (e) { return e.message; } })()]).toEqual([i, 'ok']);
  });
  test('Umschalter oben im Kopf: Auto | ☀ | ☾, Screenreader-Namen, Hinweis ohne title, verdrahtet', () => {
    const kopf = html.slice(html.indexOf('<header>'), html.indexOf('</header>'));
    expect([...kopf.matchAll(/data-theme-knopf="([a-z]+)"[^>]*aria-label="([^"]+)"/g)].map(m => [m[1], m[2]])).toEqual([['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']]);
    expect(kopf).toContain('data-tipp="Farbdarstellung: System, Hell oder Dunkel"');
    expect(kopf).not.toMatch(/title=/);
    expect(html).toMatch(/\.theme-schalter:hover::after, \.theme-schalter:focus-within::after/);
    expect(html).toContain('window.ptTheme.setze(b.dataset.themeKnopf);');
  });
});
