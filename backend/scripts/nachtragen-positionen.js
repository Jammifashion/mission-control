// Fehlende Verkaufszeilen nachtragen: Bestellungen, in denen dieselbe Position mehrfach vorkam und der alte
// Sync nur eine Zeile schrieb. Logik in lib/nachtragPositionen.js.
//
// Verwendung:
//   node backend/scripts/nachtragen-positionen.js --lizenz | --fp [--bestellung 123,456] [--write]
//
// Standard ist ein TROCKENLAUF: zeigt je Bestellung, wie viele Zeilen entstuenden (ohne Betraege), schreibt nichts.
// --write sichert vorher den ganzen Reiter nach Documents/mc-sicherungen/<Reiter>_vor_Nachtrag_<Zeit>.json und
// schreibt dann ohne append in gepruefte Zielzeilen (zurueckgelesen). Nicht waehrend des taeglichen Syncs (03:00 UTC).
// Die neuen Zeilen stehen auf "offen" mit dem Bestelldatum - liegt es vor einer schon erstellten Abrechnung,
// kommen sie als Nachzuegler in die naechste.
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { homedir } from 'os';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { nachtragenPositionen } from '../lib/nachtragPositionen.js';

const args = process.argv.slice(2);
const art = args.includes('--fp') ? 'fp' : args.includes('--lizenz') ? 'lizenz' : null;
const write = args.includes('--write');
const bi = args.indexOf('--bestellung');
const nur = bi !== -1 && args[bi + 1] ? new Set(args[bi + 1].split(',').map(s => s.trim()).filter(Boolean)) : null;

async function run() {
  if (!art) { console.error('Bitte --lizenz oder --fp angeben.'); process.exit(1); }
  const spreadsheetId = process.env.BUSINESS_SHEET_ID;
  if (!spreadsheetId) { console.error('BUSINESS_SHEET_ID fehlt.'); process.exit(1); }
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  console.log(`== Nachtragen gleicher Positionen · ${art === 'fp' ? 'Festpreis' : 'Lizenz (JFN)'} · ${write ? 'SCHREIBEN' : 'Trockenlauf'}${nur ? ` · nur ${[...nur].join(', ')}` : ''}`);
  const r = await nachtragenPositionen({ sheets, spreadsheetId, art, nur, write, sicherungOrdner: join(homedir(), 'Documents', 'mc-sicherungen') });
  console.log(`Geprüfte Bestellungen: ${r.geprueft}`);
  for (const b of r.bestellungen) console.log(`  Bestellung ${b.bestellung}: ${b.zeilen} Zeile(n) fehlen · ${b.partner.join(', ')}`);
  console.log(`-> ${r.zeilen} Zeile(n)${r.gesperrt ? `, davon ${r.gesperrt} gesperrt (Artikel-Eintrag unvollständig)` : ''}`
    + (write ? ` geschrieben: ${r.geschrieben}. Sicherung: ${r.sicherung ?? '–'}` : ' würden entstehen (Trockenlauf, nichts geschrieben).'));
}

run().catch(e => { console.error(`FEHLER: ${String(e?.message ?? 'unbekannt').slice(0, 300)}`); process.exit(1); });
