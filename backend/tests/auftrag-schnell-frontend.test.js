// SA1: Oberflaeche der Schnellannahme (Block "Schnellannahme: Anfang/Ende" in index.html).
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── Schnellannahme: Anfang'), html.indexOf('// ── Schnellannahme: Ende'));

test('Block vorhanden, Feld oben in Aufträge mit Datenschutz-Hinweis', () => {
  expect(block.length).toBeGreaterThan(1000);
  const ansicht = html.slice(html.indexOf('id="au-ansicht"'), html.indexOf('id="au-liste"'));
  expect(ansicht).toContain('id="au-schnell-text"');
  expect(ansicht).toContain('Der Text geht zur Strukturierung an Claude (Anthropic) und wird nicht gespeichert.');
  expect(html).toContain('id="au-schnell-box"');
});
test('Text und Vorschlag nie im Browser-Speicher, in der Adresse oder im Log', () => {
  expect(block).not.toMatch(/localStorage|sessionStorage|indexedDB|history\.|location\.|console\./);
  expect(block).not.toMatch(/showToast\([^)]*text\b/);
});
test('kein title, jeder Knopf mit data-hilfe, Farben nur ueber Variablen', () => {
  const feld = html.slice(html.indexOf('<div class="au-schnell" id="au-schnell">'), html.indexOf('id="au-schnell-meldung"'));
  expect(feld + block).not.toMatch(/\stitle=/);
  for (const b of (feld + block).match(/<button[^>]*>/g)) expect(b).toMatch(/data-hilfe=/);
  const css = html.slice(html.indexOf('/* SA1: Schnellannahme'), html.indexOf('/* AM-6-1: letzte Auftraege im Dialog'));
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
});
test('Speichern nur ueber den normalen Weg; Vorschlag beim Schliessen verworfen', () => {
  expect(block).not.toMatch(/auPost\('neu'/);
  expect(html).toMatch(/function auDialogSchliessen\(\) \{[^}]*auDlg\.schnell = null/);
});
