// Teilerstattungen nachtragen (NB1 Teil A): Erstattungen aelterer Bestellungen, die der taegliche Sync nicht mehr
// sieht. Logik in lib/nachtragErstattungen.js, Rechnung wie der Sync (utils/teilerstattung.js).
//
// Verwendung:
//   node backend/scripts/nachtragen-erstattungen.js --jfn | --honk [--bestellung 123,456] [--betraege] [--write]
//
// Standard ist ein TROCKENLAUF: zeigt je Bestellung die Gegenbuchungen (Partner, Marke, Stueck), schreibt nichts.
// --betraege zeigt die Betraege zusaetzlich (nur im Terminal, nie ins Postfach).
// --write sichert vorher den ganzen Reiter nach Documents/mc-sicherungen/<Reiter>_vor_Erstattung_<Zeit>.json,
// schreibt ohne append in gepruefte Zielzeilen (zurueckgelesen) und misst nach (erneuter Lauf = 0).
// Nicht waehrend des taeglichen Syncs (03:00 UTC). Die Zeilen stehen auf "offen" mit dem Erstattungsdatum - liegt
// es vor einer schon erstellten Abrechnung, kommen sie als Nachzuegler in die naechste.
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { homedir } from 'os';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { nachtragErstattungen } from '../lib/nachtragErstattungen.js';

const args = process.argv.slice(2);
const shop = args.includes('--honk') ? 'honk' : args.includes('--jfn') ? 'jfn' : null;
const write = args.includes('--write');
const betraege = args.includes('--betraege');
const bi = args.indexOf('--bestellung');
const nur = bi !== -1 && args[bi + 1] ? new Set(args[bi + 1].split(',').map(s => s.trim()).filter(Boolean)) : null;

async function run() {
  if (!shop) { console.error('Bitte --jfn oder --honk angeben.'); process.exit(1); }
  const spreadsheetId = process.env.BUSINESS_SHEET_ID;
  if (!spreadsheetId) { console.error('BUSINESS_SHEET_ID fehlt.'); process.exit(1); }
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  console.log(`== Teilerstattungen nachtragen · ${shop.toUpperCase()} · ${write ? 'SCHREIBEN' : 'Trockenlauf'}${nur ? ` · nur ${[...nur].join(', ')}` : ''}`);
  const r = await nachtragErstattungen({ sheets, spreadsheetId, shop, nur, write, sicherungOrdner: join(homedir(), 'Documents', 'mc-sicherungen') });
  console.log(`Reiter ${r.tab} · geprüfte Bestellungen: ${r.geprueft}`);
  for (const b of r.bestellungen) {
    console.log(`  Bestellung ${b.bestellung} (${b.status}): ${b.zeilen} Gegenbuchung(en)${b.marken.length ? ' · ' + b.marken.join('; ') : ''}`);
  }
  for (const h of r.hinweise) console.log(`  Hinweis Bestellung ${h.orderId} ${h.partnerId ?? ''}: ${h.grund}${h.refundId ? ` (Erstattung ${h.refundId})` : ''}`);
  if (betraege) {
    const k = c => r.kopf.indexOf(c);
    for (const z of r.rows) {
      console.log(`    ${z[k('Order-ID')]} ${z[k('Partner-ID')]} ${z[k('Storno-Status')]}: Lizenz ${z[k('Lizenzgebühr')]} · Porto ${z[k('Porto-Saldo')]} · Brutto ${z[k('Anteil-Brutto')]}`);
    }
  }
  console.log(`-> ${r.zeilen} Zeile(n)` + (write
    ? ` geschrieben: ${r.geschrieben}. Sicherung: ${r.sicherung ?? '–'}. Nachmessung: ${r.nachmessung ?? '–'} offen.`
    : ' würden entstehen (Trockenlauf, nichts geschrieben).'));
}

run().catch(e => { console.error(`FEHLER: ${String(e?.message ?? 'unbekannt').slice(0, 300)}`); process.exit(1); });
