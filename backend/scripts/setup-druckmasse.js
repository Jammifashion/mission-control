// DK1: Reiter `Druckmasse` (SSOT) und Config-Zeilen dtf.* (Business) anlegen.
//
//   node backend/scripts/setup-druckmasse.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-druckmasse.js --write   legt Fehlendes an
//
// Idempotent: vorhandener Reiter/Config-Schluessel bleibt unangetastet. Config: dtf.breite_cm = 57 und
// dtf.verschnitt_prozent = 15 vorbelegt, Bogenlaenge und alle Preise LEER (traegt der Inhaber ein - nie ins Repo/Postfach).
// Die Spalten Druckmasse_Hand (Auftrag_Positionen) und DTF_Express (Auftraege) legt scripts/setup-auftraege-reiter.js an.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });
import { richteDruckmasseEin } from '../lib/druckmasse.js';

const WRITE = process.argv.includes('--write');

try {
  const { plan, geschrieben } = await richteDruckmasseEin({ write: WRITE });
  if (!plan.length) console.log('Alles schon eingerichtet - nichts zu tun.');
  for (const p of plan) console.log(`${geschrieben ? '✓' : '-'} ${p}`);
  if (plan.length && !geschrieben) console.log('\nTrockenlauf - nichts geschrieben. Mit --write anlegen.');
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
