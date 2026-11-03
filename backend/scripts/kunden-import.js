// Kunden aus Lexware Office uebernehmen (AM-1). Lexware wird NUR GELESEN (GET /v1/contacts, nur Kunden).
//
//   node backend/scripts/kunden-import.js           Trockenlauf (Standard): nur Zahlen, schreibt nichts
//   node backend/scripts/kunden-import.js --write   schreibt neue Kunden (K-NNNNN) und geaenderte Lexoffice-Felder
//   --nur-firmen                                   nur Firmen + schon uebernommene Personen (AM-1-1); weitere Personen nie pauschal
//
// Wiederholbar: Abgleich ueber Lexoffice_ID (Rueckfall Lexoffice_Nr); ein zweiter Lauf legt nichts doppelt an
// und meldet nur Aenderungen. Spitzname, Notiz, Status bleiben immer. Ausgabe nur Zahlen - nie Namen.
// Schluessel: LEXWARE_API_KEY aus der .env im Hauptordner (nie ausgeben).

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { importiereKunden } from '../lib/kunden.js';

const WRITE = process.argv.includes('--write');
const NUR_FIRMEN = process.argv.includes('--nur-firmen');

async function main() {
  const r = await importiereKunden({ dryRun: !WRITE, nurFirmen: NUR_FIRMEN });
  const k = r.kontakte, p = r.plan;
  console.log(`Lexware: ${r.seiten} Seite(n), ${k.gesamt} Kunden-Kontakte`);
  console.log(`  Firmen ${k.firmen} · Personen ${k.personen} · archiviert ${k.archiviert} · ohne Kundennummer ${k.ohneKundennummer}`);
  console.log(`  Firmen mit Ansprechpartner ${k.mitAnsprechpartner} · ohne ${k.firmenOhneAnsprechpartner}`);
  console.log(`  mit Mail ${k.mitMail} · ohne ${k.ohneMail} · mit Adresse ${k.mitAdresse} · ohne ${k.ohneAdresse}`);
  console.log(`  moegliche Dubletten (gleicher Name): ${k.dublettenGruppen} Gruppe(n), ${k.dublettenKontakte} Kontakte`);
  console.log(`Reiter Kunden vorher: ${r.kundenVorher} Zeile(n)`);
  console.log(`Plan: neu ${p.neu} · geaendert ${p.geaendert} (${p.felderGeaendert} Felder) · unveraendert ${p.unveraendert}`
    + ` · archiviert uebersprungen ${p.archiviertUebersprungen} · gesperrt uebersprungen ${p.gesperrtUebersprungen}`
    + ` · mehrdeutig ${p.mehrdeutig} · ohne ID ${p.ohneId}${NUR_FIRMEN ? ` · Personen uebersprungen ${p.personenUebersprungen} · einzeln uebernommene Personen abgeglichen ${p.personenAbgeglichen}` : ''}`);
  if (r.dryRun) { console.log('Trockenlauf - nichts geschrieben. Mit --write schreiben (nach Freigabe).'); return; }
  console.log(`✓ geschrieben: neu ${r.geschrieben.neu} · geaendert ${r.geschrieben.geaendert}${r.geschrieben.ersteNeueZeile ? ` (neue ab Zeile ${r.geschrieben.ersteNeueZeile})` : ''}, zurueckgelesen.`);
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
