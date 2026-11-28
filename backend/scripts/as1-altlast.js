// AS1 Altlast: offene L-Shop-/DTF-Korb-Zeilen stornierter Auftraege und entfernter Positionen abwaehlen.
// Trockenlauf Standard (nur Nummern), --write schreibt (erst nach Freigabe des Inhabers).
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
const { stornoAltlast } = await import('../lib/auftraege.js');

const write = process.argv.includes('--write');
try {
  const r = await stornoAltlast({ write });
  for (const x of r.liste) console.log(`${x.art === 'storniert' ? 'Auftrag storniert' : 'Position entfernt'} ${x.nr}: L-Shop ${x.korb.length} [${x.korb.join(', ')}] · DTF ${x.dtf.length} [${x.dtf.join(', ')}]`);
  console.log(write ? `✓ ${r.zeilen} Zeilen abgewählt.` : `Trockenlauf – ${r.zeilen} Zeilen würden abgewählt. Mit --write schreiben.`);
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
