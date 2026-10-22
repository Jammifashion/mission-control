// Richtet die EDI-Bestelldatei ein (BO4a): SSOT-Reiter "LShop_EDI_Dateien" (Protokoll + Zaehler
// der order_id, mit der Zeile JFN-2026-0001 der Testdatei) und im Business-Sheet, Reiter Config,
// die Zeile "lshop.customer_id" mit LEEREM Wert (den traegt der Inhaber selbst ein).
//
//   node backend/scripts/setup-lshop-edi-reiter.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-lshop-edi-reiter.js --write   legt an und liest zurueck
//
// Idempotent: Vorhandenes wird nie ueberschrieben, ein gesetzter customer_id-Wert nie angefasst
// und nie ausgegeben. Die Logik liegt in lib/lshopEdi.js (richteEdiEin).

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { richteEdiEin } from '../lib/lshopEdi.js';

const WRITE = process.argv.includes('--write');

richteEdiEin({ write: WRITE })
  .then(r => {
    for (const z of r.log) console.log(z);
    if (!WRITE) console.log('Trockenlauf - nichts angelegt. Mit --write anlegen.');
  })
  .catch(err => { console.error('✗', err.message); process.exit(1); });
