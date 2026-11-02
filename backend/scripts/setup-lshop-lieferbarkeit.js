// Richtet die Lieferbarkeit L-Shop ein (BO7-1): SSOT-Reiter "LShop_Lieferbarkeit" (nur Kopfzeile, ArticleNr als
// Text) und in der geteilten Ablage den Ordner "L-Shop Auslauf" (dort legt der Inhaber freitags die Auslaufliste ab).
//
//   node backend/scripts/setup-lshop-lieferbarkeit.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-lshop-lieferbarkeit.js --write   legt an und liest zurueck
//
// Idempotent: Vorhandenes wird nie ueberschrieben. Logik in lib/lshopLieferbarkeit.js (richteLieferbarkeitEin).

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { richteLieferbarkeitEin } from '../lib/lshopLieferbarkeit.js';

const WRITE = process.argv.includes('--write');

richteLieferbarkeitEin({ write: WRITE })
  .then(log => {
    for (const z of log) console.log(z);
    if (!WRITE) console.log('Trockenlauf - nichts angelegt. Mit --write anlegen.');
  })
  .catch(err => { console.error('✗', err.message); process.exit(1); });
