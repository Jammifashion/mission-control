// AU-UX3: Hinweis bei Menge in einer L-Shop-Problemgroesse; "Rohlinge bereitstellen" heisst sichtbar "Textil beschaffen".
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── Lieferbarkeit-Anzeige: Anfang'), html.indexOf('// ── Lieferbarkeit-Anzeige: Ende ──'));
const F = new Function(`${block}\nreturn { lfbMengenWarnung };`)();

describe('Lieferbarkeit im Auftrags-Raster', () => {
  const raster = [
    { groesse: 'M', articleNr: '1000000001', lieferbar: { stufe: 'lieferbar', stock: 50 } },
    { groesse: 'L', articleNr: '1000000002', lieferbar: { stufe: 'null', stock: 0, nullSeit: '2026-11-02' } },
    { groesse: 'XL', articleNr: '1000000003', lieferbar: { stufe: 'nicht_gefuehrt' } },
    { groesse: '2XL', articleNr: '1000000004' },
  ];
  test('nur Groessen mit Problem UND Menge > 0, nie sperrend', () => {
    expect(F.lfbMengenWarnung(raster, { 1000000001: '5' })).toBe('');
    expect(F.lfbMengenWarnung(raster, { 1000000002: '0', 1000000004: '3' })).toBe('');
    const w = F.lfbMengenWarnung(raster, { 1000000002: '2', 1000000003: '1' });
    expect(w).toMatch(/^Achtung: L \(.+\) · XL \(.+\) – bestellbar/);
  });
  test('Feld orange (au-warn), Mouse-over, im Raster eingehaengt', () => {
    expect(html).toContain('<div id="au-raster-warn" class="korb-zaehler au-warn" data-hilfe="au-raster-warn"');
    expect(html).toContain("const w = lfbMengenWarnung(auDlg.raster, mengen);");
    expect(html).toMatch(/'au-raster-warn':\s+\{ name:/);
  });
});

describe('Textil beschaffen', () => {
  test('sichtbare Texte umbenannt, interne Namen bleiben', () => {
    expect(html).toContain('data-hilfe="au-bereitstellen">Textil beschaffen …</button>');
    expect(html).toContain('<strong id="ab-titel">Textil beschaffen</strong>');
    expect(html).toContain('id="ab-ok" data-hilfe="ab-ok">Beschaffen</button>');
    expect(html).toContain("'au-bereitstellen':     { name: 'Textil beschaffen …', text: 'Bestellt fehlende Ware bei L-Shop, nimmt Vorhandenes aus dem Lager – vorher Übersicht.' }");
    // keine sichtbare Fundstelle mehr (Kommentare ausgenommen)
    const sichtbar = html.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*|<!--)/.test(l)).map(l => l.replace(/\/\/ .*$/, '').replace(/<!--.*?-->/g, ''));
    expect(sichtbar.filter(l => /Rohlinge bereitstellen|bereitgestellt\./.test(l))).toEqual([]);
    expect(html).toContain("auPost('bereitstellen', {");   // Route bleibt
  });
});
