// Haengt die Spalten der AB-Auswertung (BO4i) hinten an: LShop_EDI_Dateien AB_Nr | AB_VA | AB_Datum | AB_Eingang |
// AB_Hinweis und Warenkorb_LShop Liefertermin | AB_Hinweis. Nur Kopfzellen, keine Daten.
//
//   node backend/scripts/setup-lshop-ab-spalten.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-lshop-ab-spalten.js --write   haengt an und liest zurueck
//
// Idempotent; vorhandene Spalten werden nie angefasst. Logik: lib/lshopAb.js (richteAbSpaltenEin).

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { richteAbSpaltenEin } from '../lib/lshopAb.js';

const WRITE = process.argv.includes('--write');

richteAbSpaltenEin({ write: WRITE })
  .then(log => {
    for (const z of log) console.log(z);
    if (!WRITE) console.log('Trockenlauf - nichts angelegt. Mit --write anhaengen.');
  })
  .catch(err => { console.error('✗', err.message); process.exit(1); });
