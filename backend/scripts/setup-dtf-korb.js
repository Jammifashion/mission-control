// DT1: DTF-Warenkorb einrichten.
//
//   node backend/scripts/setup-dtf-korb.js           Trockenlauf (Standard): zeigt nur, was passieren wuerde
//   node backend/scripts/setup-dtf-korb.js --write   legt Fehlendes an
//
// SSOT: Reiter Warenkorb_DTF, DTF_Dateien, DTF_Bestellprotokoll (Kopfzeilen), Spalte Druckart hinten in Motive (leer = DTF).
// Business-Config: dtf.start_datum = heute (Berlin; ab hier kommen Bestellungen/Auftraege in den Korb), dtf.mindest_laenge_cm und
// dtf.scan_basis_url LEER (traegt der Inhaber ein). DTF-Ablage (Secret/Umgebung DTF_ORDNER_ID): Ordner Motive/ Kunden/ Bestellungen/ -
// MC legt sie selbst an (drive.file sieht nur Selbstangelegtes). Idempotent: Vorhandenes bleibt unangetastet.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });
import { richteDtfKorbEin } from '../lib/dtfKorb.js';
import { ablageRechte } from '../lib/dtfAblage.js';

const WRITE = process.argv.includes('--write');

try {
  try {
    const r = await ablageRechte();
    console.log(`DTF-Ablage „${r.name}“: anlegen ${r.anlegen ? 'ja' : 'NEIN'}, bearbeiten ${r.bearbeiten ? 'ja' : 'nein'}, löschen ${r.loeschen ? 'ja' : 'nein'}`);
  } catch (e) { console.log(`DTF-Ablage: ${e.message}`); }
  const { plan, drive, geschrieben } = await richteDtfKorbEin({ write: WRITE });
  if (!plan.length) console.log('Sheets: alles schon eingerichtet.');
  for (const p of plan) console.log(`${geschrieben ? '✓' : '-'} ${p}`);
  for (const d of drive) console.log(d);
  if (!WRITE) console.log('\nTrockenlauf - nichts geschrieben. Mit --write anlegen.');
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
