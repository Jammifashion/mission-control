// Regel (CLAUDE.md): Jeder WooCommerce- oder WordPress-Zugriff laeuft ueber
// getWcClient (lib/shopConfig.js) oder die gemeinsame Pruefung
// pruefeFetchAntwort (lib/hosterPruefseite.js). Sonst faellt die Erkennung der
// Hoster-Pruefseite fuer diesen Zugriff weg.

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORDNER  = ['lib', 'routes', 'scripts', 'utils', 'middleware'];

const dateien = ORDNER.flatMap(o => readdirSync(join(BACKEND, o), { recursive: true })
  .filter(f => String(f).endsWith('.js'))
  .map(f => join(BACKEND, o, String(f))));
const quelle = f => readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '');   // Kommentarzeilen raus
const rel = f => relative(BACKEND, f).replace(/\\/g, '/');

test('WooCommerceRestApi wird nur in lib/shopConfig.js erzeugt', () => {
  const treffer = dateien.filter(f => /new\s+WooCommerceRestApi|from\s+['"]@woocommerce\/woocommerce-rest-api['"]/.test(quelle(f)));
  expect(treffer.map(rel)).toEqual(['lib/shopConfig.js']);
});

test('fetch auf /wp-json nur zusammen mit pruefeFetchAntwort', () => {
  const ohne = dateien.filter(f => {
    const s = quelle(f);
    return /fetch\([^)]*wp-json/.test(s) && !s.includes('pruefeFetchAntwort(');
  });
  expect(ohne.map(rel)).toEqual([]);
});
