// Frontend: Schleifen ueber mehrere WC-Aufrufe (Varianten loeschen, Varianten-
// Preise/-Bilder aendern) brechen bei einem Laufstopp ab - 503
// "hoster_pruefseite" oder 504 "shop_timeout" -, statt mit der naechsten
// Variante weiterzumachen.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HTML = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');

// Schleifenkoerper ab dem for-Kopf bis zur schliessenden Klammer auf gleicher Einrueckung.
function schleife(kopf) {
  const i = HTML.indexOf(kopf);
  expect(i).toBeGreaterThan(-1);
  const einr = HTML.slice(HTML.lastIndexOf('\n', i) + 1, i);
  const ende = HTML.indexOf(`\n${einr}}`, i);
  return HTML.slice(i, ende);
}

test('Helfer laufStopp erkennt 503 hoster_pruefseite und 504 shop_timeout', () => {
  const i = HTML.indexOf('async function laufStopp(res)');
  expect(i).toBeGreaterThan(-1);
  const koerper = HTML.slice(i, HTML.indexOf('\n      }', i));
  expect(koerper).toMatch(/res\.status !== 503 && res\.status !== 504/);
  expect(koerper).toContain("json?.code === 'hoster_pruefseite'");
  expect(koerper).toContain("json?.code === 'shop_timeout'");
});

test.each([
  ['Varianten loeschen', 'for (const id of ids) {'],
  ['Varianten-Preise/-Bilder', 'for (const v of changedVars) {'],
])('%s: Abbruch beim Laufstopp', (_name, kopf) => {
  expect(schleife(kopf)).toMatch(/const stopp = await laufStopp\(\w+\);\s*if \(stopp\) \{ \w+ = stopp; break; \}/);
});
