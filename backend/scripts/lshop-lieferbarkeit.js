// Lieferbarkeit L-Shop von Hand ausfuehren (BO7-1) - derselbe Lauf wie Scheduler und Knopf.
//
//   NODE_ENV=production node backend/scripts/lshop-lieferbarkeit.js           Trockenlauf (Standard): schreibt und meldet nichts
//   NODE_ENV=production node backend/scripts/lshop-lieferbarkeit.js --write   schreibt den Reiter, Chat bei Wechsel
//
// NODE_ENV=production nur, damit die FTP-Secrets aus dem Secret Manager kommen (lokal fehlen sie in der .env).
// Ausgabe: nur Zaehler, nie Inhalte der Bestandsdatei.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { runLieferbarkeit } from '../lib/lshopLieferbarkeit.js';

const WRITE = process.argv.includes('--write');

runLieferbarkeit({ dryRun: !WRITE, quelle: 'skript' })
  .then(r => console.log(JSON.stringify(r, null, 1)))
  .catch(err => { console.error('✗', err.status ?? '', err.message); process.exit(1); });
