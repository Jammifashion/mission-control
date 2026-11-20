// SA4: Drucknamen (Auftrag_Positionen.Druckname) 12 Monate nach Abschluss des Auftrags (bezahlt bzw. storniert) leeren.
//
//   node backend/scripts/druckname-loeschen.js           Trockenlauf (Standard): zaehlt nur, schreibt nichts
//   node backend/scripts/druckname-loeschen.js --write   leert die Zellen (EIN batchUpdate, zurueckgelesen)
//
// Ausgabe nur Zahlen und Auftrag-Nummern - nie die Namen. Der regelmaessige Lauf kommt gemeinsam mit den Rueckennamen
// (FIX4 D2) und ruft dieselbe Funktion (leereDrucknamen in lib/auftraege.js).

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { leereDrucknamen } from '../lib/auftraege.js';
import { DRUCKNAME_MONATE } from '../utils/druckname-loeschen.js';

const WRITE = process.argv.includes('--write');

async function main() {
  const r = await leereDrucknamen({ write: WRITE });
  if (!r.spalte) { console.log('Spalte Druckname fehlt in Auftrag_Positionen - nichts zu leeren.'); return; }
  console.log(`${WRITE ? 'SCHREIBEN' : 'TROCKENLAUF'}: ${r.leeren} Druckname-Zelle(n) älter als ${DRUCKNAME_MONATE} Monate nach Abschluss`
    + `${r.auftraege.length ? ` in ${r.auftraege.join(', ')}` : ''}.`);
  console.log(`Bleiben: ${r.zaehler.offen} in offenen Aufträgen, ${r.zaehler.abgeschlossenJung} abgeschlossen < ${DRUCKNAME_MONATE} Monate,`
    + ` ${r.zaehler.ohneDatum} abgeschlossen ohne Datum.`);
  if (WRITE) console.log(r.geschrieben ? 'Geleert und zurückgelesen.' : 'Nichts zu schreiben.');
}

main().catch(err => { console.error(`✗ ${err.message}`); process.exit(1); });
