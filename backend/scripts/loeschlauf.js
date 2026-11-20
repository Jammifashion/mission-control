// Datenschutz-Loeschlauf (FIX4): Rueckennamen Bestellseite, Trikots, Kundenanfragen ohne Auftrag, Drucknamen der Auftraege -
// jeweils 12 Monate nach Termin/Lieferung/Anfrage/Abschluss.
//
//   node backend/scripts/loeschlauf.js           Trockenlauf (Standard): nur Anzahlen, schreibt nichts
//   node backend/scripts/loeschlauf.js --write   leert die faelligen Zellen (je Bereich EIN batchUpdate, zurueckgelesen)
//
// Regelmaessig: Workflow loeschlauf-weekly.yml -> POST /api/system/loeschlauf (scharf nur mit Repo-Variable LOESCHLAUF_SCHARF=ja).
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { loeschlauf } from '../lib/loeschlauf.js';

const WRITE = process.argv.includes('--write');

const r = await loeschlauf({ scharf: WRITE }).catch(err => { console.error(`✗ ${err.message}`); process.exit(1); });
console.log(WRITE ? 'SCHREIBEN' : 'TROCKENLAUF (nichts geschrieben)');
for (const [bereich, v] of Object.entries(r.ergebnis)) {
  if (v.fehler) { console.log(`  ${bereich}: Fehler ${v.fehler}`); continue; }
  const z = v.zaehler;
  console.log(`  ${bereich}: ${z.faellig} fällig${WRITE ? `, ${v.geleert} Zelle(n) geleert` : ''}`
    + ` · bleiben: ${z.jung ?? z.abgeschlossenJung ?? 0} jünger als 12 Monate, ${z.ohneDatum ?? 0} ohne Datum`
    + `${z.ausnahme !== undefined ? `, ${z.ausnahme} mit Auftrag/Bestellung` : ''}${z.offen !== undefined ? `, ${z.offen} offen` : ''}`);
}
