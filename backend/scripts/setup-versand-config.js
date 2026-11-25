// RE3 Teil C: Config-Zeilen versand.brief_brutto / versand.paket_brutto (Business) mit leerem Wert anlegen.
//
//   node backend/scripts/setup-versand-config.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-versand-config.js --write   legt fehlende Zeilen an
//
// Die Betraege traegt der Inhaber im Sheet ein (nie Repo/Postfach). Spalten Vorkasse, Versand_Art, Versand_Betrag, Versand_Text,
// Rechnung_Pruef in Auftraege: scripts/setup-auftraege-reiter.js.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });
import { richteVersandConfigEin } from '../lib/rechnung.js';

const WRITE = process.argv.includes('--write');

try {
  const { plan, geschrieben } = await richteVersandConfigEin({ write: WRITE });
  if (!plan.length) console.log('Alles schon eingerichtet - nichts zu tun.');
  for (const p of plan) console.log(`${geschrieben ? '✓' : '-'} ${p}`);
  if (plan.length && !geschrieben) console.log('\nTrockenlauf - nichts geschrieben. Mit --write anlegen.');
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
