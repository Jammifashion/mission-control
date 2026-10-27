// Richtet den Beleg-Abruf ein (BO4b-1, BO4b-2): SSOT-Reiter "LShop_Belege" (Protokoll: was vom
// L-Shop-FTP schon verarbeitet ist, Alarme, Fehllaeufe; seit BO4b-2 mit Spalte Drive_ID hinten),
// SSOT-Reiter "LShop_Sendungen" (eine Zeile je Paket) und in der geteilten Ablage die Archiv-Ordner
// "L-Shop Belege/<Art>/<Jahr>"; seit BO4b-5 auch "LShop_Kartons" (Protokoll der gescannten Kartons, lib/karton.js)
// und der Archiv-Ordner "Karton". Nur Kopfzeilen und Ordner, keine Daten.
//
//   node backend/scripts/setup-lshop-belege-reiter.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-lshop-belege-reiter.js --write   legt an und liest zurueck
//
// Idempotent: Ein vorhandener Reiter wird nie ueberschrieben. Die Logik liegt in lib/lshopBelege.js
// (richteBelegeEin).

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { richteBelegeEin } from '../lib/lshopBelege.js';
import { richteKartonsEin } from '../lib/karton.js';

const WRITE = process.argv.includes('--write');

richteBelegeEin({ write: WRITE })
  .then(async r => {
    for (const z of [...r.log, ...await richteKartonsEin({ write: WRITE })]) console.log(z);
    if (!WRITE) console.log('Trockenlauf - nichts angelegt. Mit --write anlegen.');
  })
  .catch(err => { console.error('✗', err.message); process.exit(1); });
