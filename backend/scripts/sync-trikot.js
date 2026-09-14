// Lokales Werkzeug für den Trikot-Sync. Die Implementierung liegt in
// backend/lib/trikotSync.js – derselbe Code läuft hinter POST /api/trikot/sync.
//
// Aufruf:
//   node backend/scripts/sync-trikot.js                     # ab jüngstem Bestelldatum im Reiter
//   node backend/scripts/sync-trikot.js --after=2026-09-01  # erster Lauf / expliziter Start
//   node backend/scripts/sync-trikot.js --dry-run           # nichts schreiben, nur zählen

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { runTrikotSync } from '../lib/trikotSync.js';

function parseArgs(argv) {
  const args = { after: undefined, dryRun: false };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--after=')) args.after = a.slice('--after='.length);
    else throw new Error(`Unbekanntes Argument: ${a}`);
  }
  return args;
}

async function main() {
  const r = await runTrikotSync(parseArgs(process.argv.slice(2)));

  console.log(`Bestellungen ab ${r.ab}${r.dryRun ? ' – DRY RUN' : ''}`);
  if (r.dryRun) {
    for (const o of r.zeilen) {
      console.log(`  + ${o['Zeilen-ID']}  ${o['Groesse'] || '-'}  ${o['Name'] || '-'}/${o['Nummer'] || '-'}  x${o['Stueck']}  [${o['Quelle']}]`);
    }
  }
  console.log('─'.repeat(50));
  console.log(`Gelesene Bestellungen:   ${r.gelesen}`);
  console.log(`Neue Zeilen:             ${r.neu}${r.dryRun ? ' (nicht geschrieben)' : ''}`);
  console.log(`Übersprungene Dubletten: ${r.dubletten}`);
  console.log(`Quellen:                 addon ${r.quellen.addon}, variante ${r.quellen.variante}, notiz ${r.quellen.notiz}`);
}

main().catch(err => {
  console.error('✗ Trikot-Sync fehlgeschlagen:', err.message ?? err);
  process.exit(1);
});
