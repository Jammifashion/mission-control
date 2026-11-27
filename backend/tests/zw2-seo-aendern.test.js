// ZW2 Teil B: "SEO-Daten ändern" findet auch Entwuerfe/private und oeffnet fuer Texte den SEO-Reiter. Nur erfundene Daten.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const { sucheArtikel } = await import('../lib/seo-artikel.js');

const ARTIKEL = [
  { id: 1, name: 'Pulli A', sku: 'A', status: 'publish' },
  { id: 2, name: 'Pulli B', sku: 'B', status: 'draft' },
  { id: 3, name: 'Pulli C', sku: 'C', status: 'private' },
  { id: 4, name: 'Pulli D', sku: 'D', status: 'trash' },
];
const wcAttrappe = () => ({
  get: jest.fn(async (pfad, params) => ({
    data: ARTIKEL.filter(a => params.status === 'any' ? a.status !== 'trash' : a.status === params.status),
    headers: {},
  })),
});

describe('sucheArtikel mit Status', () => {
  test('ohne Angabe wie bisher nur veroeffentlichte (andere Aufrufer)', async () => {
    const wc = wcAttrappe();
    expect((await sucheArtikel(wc, 'Pulli')).map(a => a.id)).toEqual([1]);
    expect(wc.get.mock.calls.every(([, p]) => p.status === 'publish')).toBe(true);
  });
  test('any = veroeffentlicht, Entwurf, privat (nie Papierkorb); einzelner Status filtert', async () => {
    expect((await sucheArtikel(wcAttrappe(), 'Pulli', { status: 'any' })).map(a => a.id).sort()).toEqual([1, 2, 3]);
    expect((await sucheArtikel(wcAttrappe(), 'Pulli', { status: 'draft' })).map(a => [a.id, a.status])).toEqual([[2, 'draft']]);
    expect((await sucheArtikel(wcAttrappe(), 'Pulli', { status: 'trash' })).map(a => a.id)).toEqual([1]);   // unbekannt -> publish
  });
});

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = (a, e) => html.slice(html.indexOf(a), html.indexOf(e));
describe('Oberflaeche', () => {
  test('Status-Wahl (Standard alle) und Knopf "Texte bearbeiten" mit Mouse-over', () => {
    expect(html).toMatch(/<select id="se-status-wahl"[^>]*data-hilfe="se-status-wahl"[^>]*>\s*<option value="any">alle<\/option>/);
    expect(html).toMatch(/id="se-texte"[^>]*data-hilfe="se-texte"/);
    for (const k of ['se-status-wahl', 'se-texte']) expect(html).toMatch(new RegExp(`'${k}':\\s*\\{ name:`));
  });
  test('Knopf oeffnet den SEO-Reiter mit Zwilling, nur JFN; Sheet nur mit Zeile', () => {
    const b = block("document.getElementById('se-texte').addEventListener", '// Derselbe Baustein wie der SEO-Reiter');
    expect(b).toContain("if (!seStand || currentShop() !== 'jfn') return;");
    expect(b).toContain('honkId: x.honkId');
    expect(b).toMatch(/await setSeoMode\(\);\s*await seoArtikelOeffnen\(item\);/);
    expect(html).toContain('return loadSeoPendingList();');
    expect(html).toContain('if (seoCurrentItem.row) await apiFetch(`${API_BASE()}/api/sheets/erfassung/patch-fields`');
  });
});
