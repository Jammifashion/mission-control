// Echte shopConfig.js ohne Mocks: Marke wird je Shop ueber den Slug
// konfiguriert, nie ueber eine Term-ID.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getShopConfig } from '../lib/shopConfig.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('shopConfig: Markenslug je Shop', () => {
  test('jfn: jammifashion', () => {
    expect(getShopConfig('jfn').markenSlug).toBe('jammifashion');
  });

  test('honk: keine Marke', () => {
    expect(getShopConfig('honk').markenSlug).toBeNull();
  });

  test('unbekannter Shop faellt wie bisher auf jfn zurueck', () => {
    expect(getShopConfig('gibts-nicht').markenSlug).toBe('jammifashion');
  });

  test('keine hart kodierte Term-ID 698 im Marken-Code', () => {
    for (const datei of ['../lib/shopConfig.js', '../lib/shopMarke.js', '../routes/woocommerce.js']) {
      expect(readFileSync(resolve(here, datei), 'utf8')).not.toMatch(/\b698\b/);
    }
  });
});
