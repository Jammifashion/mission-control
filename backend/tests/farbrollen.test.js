// FK1: Farbrollen - jeder Farbwert steht nur in :root, sonst nur var(--…). Eine Farbe = eine Rolle.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const rootMatch = html.match(/:root\s*\{[^}]*\}/);
const root = rootMatch[0];
const ohneRoot = html.replace(root, '');
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
    expect(wert('--accent')).toBe('#e8c44a');
    expect(wert('--accent-text')).toBe('#111');
    expect(wert('--info')).toBe('#4a9eff');
    expect(wert('--warning')).toBe('#f0a030');
    expect(wert('--danger')).toBe('#e05252');
    expect(wert('--success')).toBe('#52c97a');
    expect(wert('--status-design')).toBe('#a184ec');
    expect(wert('--au')).toBe('#2bb3a3');
    expect(wert('--ag')).toBe('#9a8fb8');
    expect(wert('--shop-jfn')).toBe('#c9a04a');
    expect(wert('--shop-honk')).toBe('#e05fa0');
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
    const definiert = new Set([...root.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
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
