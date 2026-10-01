// Zeitlimits der Maske liegen ueber dem Backend-Limit fuer Lesen beim Shop
// (ZEITLIMIT_LESEN_MS, 15 s): sonst bricht der Browser ab, bevor der echte
// Grund (504 shop_timeout) ankommt. Ausnahme: GET /health (offen, fragt den
// Shop nicht, nur Cloud Run).

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ZEITLIMIT_LESEN_MS } from '../lib/hosterPruefseite.js';

const HTML = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const konstante = name => Number(new RegExp(`const ${name} = (\\d+);`).exec(HTML)?.[1]);

test('LESE_TIMEOUT_MS und VK_TIMEOUT_MS = 20 s, ueber dem Backend-Limit', () => {
  expect(konstante('LESE_TIMEOUT_MS')).toBe(20000);
  expect(konstante('VK_TIMEOUT_MS')).toBe(20000);
  expect(konstante('LESE_TIMEOUT_MS')).toBeGreaterThan(ZEITLIMIT_LESEN_MS);
});

test('kein festes Limit unter 15 s ausser GET /health', () => {
  const zuKnapp = HTML.split('\n')
    .map((z, i) => ({ z, nr: i + 1, ms: Number(/AbortSignal\.timeout\((\d+)\)/.exec(z)?.[1]) }))
    .filter(x => x.ms && x.ms <= ZEITLIMIT_LESEN_MS && !x.z.includes('/health`'));
  expect(zuKnapp.map(x => `${x.nr}: ${x.ms}`)).toEqual([]);
});
