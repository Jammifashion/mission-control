// Frontend: Schleifen ueber mehrere WC-Aufrufe (Varianten loeschen, Varianten-
// Preise/-Bilder aendern) brechen bei 503 "hoster_pruefseite" ab, statt mit
// der naechsten Variante weiterzumachen.

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

test('Helfer istHosterPruefseite prueft 503 + Code', () => {
  expect(HTML).toMatch(/async function istHosterPruefseite\(res\)[\s\S]{0,200}res\.status !== 503[\s\S]{0,200}code === 'hoster_pruefseite'/);
});

test.each([
  ['Varianten loeschen', 'for (const id of ids) {'],
  ['Varianten-Preise/-Bilder', 'for (const v of changedVars) {'],
])('%s: Abbruch bei der Pruefseite', (_name, kopf) => {
  expect(schleife(kopf)).toMatch(/if \(await istHosterPruefseite\(\w+\)\) \{ \w+ = true; break; \}/);
});
