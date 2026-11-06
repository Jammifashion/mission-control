// FK2: Umschalter System | Hell | Dunkel - Block "Theme" im <head> (reine Logik), Einstellung, Hilfe. Nur erfundene Werte.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von = html.indexOf('// ── Theme: Anfang');
const block = html.slice(von, html.indexOf('// ── Theme: Ende ──'));
const T = new Function(`${block}\nreturn { MC_THEME_WAHLEN, mcThemeLies, mcThemeSchreib, mcThemeModus, mcThemeAnwenden, mcThemeMeta };`)();

const speicher = (start = {}) => {
  const d = { ...start };
  return { d, getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; } };
};
const kaputt = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => { throw new Error('x'); } };
const mm = hell => q => ({ matches: q === '(prefers-color-scheme: light)' ? hell : false });
const doc = () => {
  const attr = {};
  const meta = { content: '#000000', setAttribute(k, v) { this[k] = v; } };
  return { attr, meta, documentElement: { setAttribute: (k, v) => { attr[k] = v; } }, querySelector: s => (s === 'meta[name="theme-color"]' ? meta : null) };
};

describe('FK2 Theme', () => {
  test('Block steht im <head> vor dem ersten <style> (kein Aufblitzen) und ausserhalb des Modul-Skripts', () => {
    expect(von).toBeGreaterThan(0);
    expect(von).toBeLessThan(html.indexOf('<style>'));
    expect(von).toBeLessThan(html.indexOf('</head>'));
    expect(html.lastIndexOf('<script>', von)).toBeGreaterThan(html.lastIndexOf('</script>', von));
  });
  test('Lesen: gueltige Wahl, sonst System; fehlender oder kaputter Speicher -> System', () => {
    expect(T.mcThemeLies(speicher({ mc_theme: 'light' }))).toBe('light');
    expect(T.mcThemeLies(speicher({ mc_theme: 'dark' }))).toBe('dark');
    expect(T.mcThemeLies(speicher({ mc_theme: 'lila' }))).toBe('system');
    expect(T.mcThemeLies(speicher())).toBe('system');
    expect(T.mcThemeLies(null)).toBe('system');
    expect(T.mcThemeLies(kaputt)).toBe('system');
  });
  test('Schreiben: Hell/Dunkel speichern, System entfernt den Eintrag; ohne Speicher kein Fehler', () => {
    const s = speicher();
    expect(T.mcThemeSchreib(s, 'light')).toBe(true);
    expect(s.d.mc_theme).toBe('light');
    expect(T.mcThemeSchreib(s, 'system')).toBe(true);
    expect('mc_theme' in s.d).toBe(false);
    expect(T.mcThemeSchreib(null, 'dark')).toBe(false);
    expect(T.mcThemeSchreib(kaputt, 'dark')).toBe(false);
  });
  test('System folgt prefers-color-scheme, ohne matchMedia dunkel', () => {
    expect(T.mcThemeModus('system', mm(true))).toBe('light');
    expect(T.mcThemeModus('system', mm(false))).toBe('dark');
    expect(T.mcThemeModus('system', null)).toBe('dark');
    expect(T.mcThemeModus('dark', mm(true))).toBe('dark');
    expect(T.mcThemeModus('light', mm(false))).toBe('light');
  });
  test('Anwenden setzt data-theme (aufgeloest) und data-theme-wahl', () => {
    const d = doc();
    expect(T.mcThemeAnwenden(d, 'system', mm(true))).toBe('light');
    expect(d.attr).toEqual({ 'data-theme': 'light', 'data-theme-wahl': 'system' });
    T.mcThemeAnwenden(d, 'dark', mm(true));
    expect(d.attr['data-theme']).toBe('dark');
  });
  test('theme-color = aktuelles --bg (kein fester Wert im Code)', () => {
    const d = doc();
    T.mcThemeMeta(d, { getComputedStyle: () => ({ getPropertyValue: k => (k === '--bg' ? ' #abcdef ' : '') }) });
    expect(d.meta.content).toBe('#abcdef');
    const d2 = doc();
    T.mcThemeMeta(d2, null);
    expect(d2.meta.content).toBe('#000000');
  });
  test('Einstellung: Auswahl System | Hell | Dunkel mit Mouse-over und eigenem ⓘ, verdrahtet ueber window.mcTheme', () => {
    const sel = html.slice(html.indexOf('<select id="theme-wahl"'), html.indexOf('</select>', html.indexOf('<select id="theme-wahl"')));
    expect(sel).toContain('data-hilfe="theme-wahl"');
    expect([...sel.matchAll(/<option value="([a-z]+)">([^<]+)</g)].map(m => [m[1], m[2]])).toEqual([['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']]);
    expect(html).toContain('data-hilfe-gruppe="darstellung" aria-controls="hilfe-darstellung"');
    expect(html).toContain("'darstellung': ['theme-wahl'],");
    expect(html).toContain("themeSel.addEventListener('change', () => { window.mcTheme.setze(themeSel.value); });");
    expect(html.indexOf('id="theme-wahl"')).toBeLessThan(html.indexOf('id="api-key-form"'));   // oben in den Einstellungen
  });
});
