// FK3: Partnerportal (frontend/partner.html) - Farbrollen wie MC, heller Modus, Umschalter oben. Nur erfundene Werte.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/partner.html'), 'utf8');
const mc = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const DUNKEL_RE = /:root\s*\{[^}]*\}/;
const HELL_RE = /:root\[data-theme="light"\]\s*\{[^}]*\}/;
const dunkelBlock = html.match(DUNKEL_RE)[0];
const hellBlock = html.match(HELL_RE)?.[0] ?? '';
const parseVars = txt => Object.fromEntries([...txt.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].replace(/\/\*.*?\*\//g, '').trim()]));
const DUNKEL = parseVars(dunkelBlock);
const HELL = { ...DUNKEL, ...parseVars(hellBlock) };

const hex = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const farbe = (n, vars) => { const w = vars[n]; const v = w.match(/^var\((--[a-z0-9-]+)\)$/); if (v) return farbe(v[1], vars); if (w === 'transparent') return farbe('--bg', vars); return hex(w); };
const lum = c => { const f = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const kontrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const grund = (b, vars) => { if (!b.startsWith('mix:')) return farbe(b, vars); const [, v, p, g] = b.split(':'); const c = farbe(v, vars); const u = farbe(g, vars); return c.map((x, i) => x * p / 100 + u[i] * (1 - p / 100)); };

describe('FK3: Farbwerte nur in den zwei :root-Bloecken, gleich wie MC', () => {
  test('ausserhalb der Bloecke kein Hex-, rgb()- oder hsl()-Farbwert, keine benannten Farben, keine Ersatzfarben', () => {
    const rest = html.replace(dunkelBlock, '').replace(hellBlock, '').replace(/&#\d+;/g, '');
    const treffer = [...rest.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map(m => m[0]).filter(t => !t.startsWith('#') || [4, 5, 7, 9].includes(t.length));
    expect(treffer).toEqual([]);
    expect(rest.match(/(?:color|background)\s*:\s*['"]?(?:white|black|red|orange|green|gold|yellow|blue|gr[ae]y)\b/gi)).toBeNull();
    expect(rest).not.toMatch(/var\(--[a-z0-9-]+,/);
    expect(html).toContain('<meta name="theme-color" content="">');   // Wert setzt das Theme-Skript aus --bg
  });
  test('beide Bloecke haben dieselben Variablen und Werte wie MC (frontend/index.html)', () => {
    expect(DUNKEL).toEqual(parseVars(mc.match(DUNKEL_RE)[0]));
    expect(parseVars(hellBlock)).toEqual(parseVars(mc.match(HELL_RE)[0]));
  });
  test('jede benutzte Variable ist definiert, keine Definition ausserhalb der Bloecke', () => {
    const rest = html.replace(dunkelBlock, '').replace(hellBlock, '');
    expect(rest.match(/^\s*--[a-z0-9-]+\s*:/gm)).toBeNull();
    const benutzt = new Set([...html.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]));
    expect([...benutzt].filter(v => !(v in DUNKEL))).toEqual([]);
  });
  test('Gold nur fuer Hauptaktion (.btn); kein Gold/Signal an Logo, Kacheln, Links; kein Knopf mit --success-Flaeche', () => {
    const regeln = [...html.matchAll(/([^{}\n]+)\{[^}]*var\(--accent\)[^}]*\}/g)].map(m => m[1].trim()).filter(r => !r.startsWith(':root'));
    expect(regeln).toEqual(['.btn']);
    expect(html).toMatch(/header \.logo \{[^}]*color: var\(--text\)/);
    expect(html).not.toMatch(/\.(?:btn|btn-outline|pk-kachel|pk-info-knopf)[^{]*\{[^}]*background:\s*var\(--success/);
    expect(html).toMatch(/\.badge-offen\s*\{[^}]*color: var\(--warning\)/);
    expect(html).toMatch(/\.badge-geprueft\s*\{[^}]*color: var\(--info\)/);
    expect(html).toMatch(/\.badge-bezahlt\s*\{[^}]*color: var\(--success\)/);
    expect(html).toContain("const red = 'color:var(--danger);font-weight:600;';");   // Storno = Fehlerrot
  });
  const PAARE = [
    ['--text', '--bg'], ['--text', '--surface'], ['--muted', '--surface'], ['--muted', '--bg'],
    ['--accent-text', '--accent'], ['--danger', '--surface'], ['--danger', 'mix:--danger:10:--surface'], ['--success', '--surface'],
    ['--warning', 'mix:--warning:15:--surface'], ['--success', 'mix:--success:15:--surface'], ['--info', 'mix:--info:15:--surface'],
    ['--success', 'mix:--success:12:--surface'], ['--text', '--surface-2'],
  ];
  test.each(PAARE)('Kontrast %s auf %s >= 4,5 in beiden Modi', (f, b) => {
    for (const [modus, vars] of [['dunkel', DUNKEL], ['hell', HELL]]) {
      const k = kontrast(farbe(f, vars), grund(b, vars));
      expect([modus, k >= 4.5 ? 'ok' : k.toFixed(2)]).toEqual([modus, 'ok']);
    }
  });
});

describe('FK3: Umschalter', () => {
  const von = html.indexOf('// ── Theme: Anfang');
  const block = html.slice(von, html.indexOf('// ── Theme: Ende ──'));
  const T = new Function(`${block}\nreturn { PT_THEME_WAHLEN, ptThemeLies, ptThemeSchreib, ptThemeModus, ptThemeAnwenden, ptThemeMeta };`)();
  const speicher = (start = {}) => { const d = { ...start }; return { d, getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; } }; };
  const kaputt = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
  const mm = hell => q => ({ matches: q === '(prefers-color-scheme: light)' ? hell : false });

  test('Block im <head> vor <style>, eigener Schluessel partner_theme (nicht mc_theme)', () => {
    expect(von).toBeGreaterThan(0);
    expect(von).toBeLessThan(html.indexOf('<style>'));
    expect(block).toContain("'partner_theme'");
    expect(block).not.toContain('mc_theme');
  });
  test('Lesen/Schreiben mit gueltigem, fehlendem und werfendem Speicher', () => {
    expect(T.ptThemeLies(speicher({ partner_theme: 'light' }))).toBe('light');
    expect(T.ptThemeLies(speicher({ mc_theme: 'light' }))).toBe('system');   // MC-Wahl gilt im Portal nicht
    expect(T.ptThemeLies(null)).toBe('system');
    expect(T.ptThemeLies(kaputt)).toBe('system');
    const s = speicher();
    expect(T.ptThemeSchreib(s, 'dark')).toBe(true);
    expect(s.d.partner_theme).toBe('dark');
    expect(T.ptThemeSchreib(s, 'system')).toBe(true);
    expect('partner_theme' in s.d).toBe(false);
    expect(T.ptThemeSchreib(kaputt, 'dark')).toBe(false);
  });
  test('System folgt dem Geraet; Anwenden setzt data-theme', () => {
    expect(T.ptThemeModus('system', mm(true))).toBe('light');
    expect(T.ptThemeModus('system', null)).toBe('dark');
    const attr = {};
    T.ptThemeAnwenden({ documentElement: { setAttribute: (k, v) => { attr[k] = v; } } }, 'light', mm(false));
    expect(attr).toEqual({ 'data-theme': 'light', 'data-theme-wahl': 'light' });
  });
  test('oben im Kopf: System | Hell | Dunkel, Screenreader-Namen, Hinweis ohne title, verdrahtet', () => {
    const kopf = html.slice(html.indexOf('<header>'), html.indexOf('</header>'));
    expect([...kopf.matchAll(/data-theme-knopf="([a-z]+)"[^>]*aria-label="([^"]+)"/g)].map(m => [m[1], m[2]])).toEqual([['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']]);
    expect(kopf).toContain('aria-label="Farbdarstellung"');
    expect(kopf).toContain('data-tipp="Farbdarstellung: System, Hell oder Dunkel"');
    expect(kopf).not.toMatch(/title=/);
    expect(html).toMatch(/\.theme-schalter:hover::after, \.theme-schalter:focus-within::after/);
    expect(html).toContain('window.ptTheme.setze(b.dataset.themeKnopf);');
  });
});
