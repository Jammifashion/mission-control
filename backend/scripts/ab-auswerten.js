// Wertet Auftragsbestaetigungen aus, die schon im Protokoll stehen (Bestand vor BO4i, z. B. JFN-2026-0003/0004).
// Liest die AB-XML NUR LESEND vom L-Shop-FTP (Ordner ORDERCONFIRMATION, lib/lshopFtp.js), wertet sie mit derselben
// Logik wie der Beleg-Abruf aus (lib/lshopAb.js) und setzt die Protokollzeile von "erkannt" auf ausgewertet/Abweichung.
// Kein Chat (Bestand). Ausgabe nur Zaehler und Hinweise - nie Preise, Adressen, Kundennummer.
//
//   node backend/scripts/ab-auswerten.js                         Trockenlauf (Standard), alle AB auf dem FTP
//   node backend/scripts/ab-auswerten.js --order JFN-2026-0004   nur diese Bestellung
//   node backend/scripts/ab-auswerten.js --write                 schreibt (EDI + Korb + Protokoll) und liest zurueck
//
// Die FTP-Zugangsdaten liegen nur im Secret Manager: lokal mit NODE_ENV=production starten (getSecret liest dann
// dort; die Werte werden nie ausgegeben).

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { mitLShopFtp } from '../lib/lshopFtp.js';
import { werteAbAus } from '../lib/lshopAb.js';
import { setzeZellenSicher } from '../lib/lshopBelege.js';
import { ORDNER, ERGEBNIS, BELEGE_TAB, belegeZeilen, dekodiere } from '../utils/lshop-belege.js';
import { leseAb } from '../utils/lshop-ab.js';

const WRITE = process.argv.includes('--write');
const iOrder = process.argv.indexOf('--order');
const NUR = iOrder > 0 ? process.argv[iOrder + 1] : '';

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${BELEGE_TAB}'` });
  const protokoll = belegeZeilen(data.values ?? []).filter(z => z.Ordner === ORDNER.AB);
  const texte = await mitLShopFtp(async ({ liste, lade }) => {
    const out = [];
    for (const e of (await liste(ORDNER.AB)).filter(x => x.istDatei)) out.push({ datei: e.name, text: dekodiere(await lade(ORDNER.AB, e.name)) });
    return out;
  });
  const nun = new Date();
  let fehler = 0;
  for (const { datei, text } of texte) {
    const ab = leseAb(text);
    if (NUR && ab.orderId !== NUR) continue;
    const p = protokoll.find(z => z.Datei === datei);
    const r = await werteAbAus({ ab, sheets, spreadsheetId, nun, dryRun: !WRITE });
    console.log(`${ab.orderId} (${datei}): ${r.kurz} · EDI ${r.statusAlt} -> ${r.statusNeu} · ${r.abgleich.positionen.length} Positionen · ${r.zellen} Zelle(n) ${WRITE ? 'geschrieben' : 'wuerden geschrieben'}`);
    for (const x of r.abgleich.positionen.filter(x => x.hinweis)) console.log(`   ${r.referenzen.get(x.schluessel) || x.schluessel}: ${x.hinweis}`);
    for (const u of r.abgleich.unbekannt) console.log(`   unbekannt: ${u.reference || '(ohne Referenz)'} · ${u.artikel} × ${u.menge}`);
    if (!p) { console.log('   ⚠ keine Protokollzeile - Protokoll bleibt'); continue; }
    if (p.Ergebnis !== ERGEBNIS.ERKANNT) { console.log(`   Protokoll schon "${p.Ergebnis}" - nicht angefasst`); continue; }
    const ergebnis = r.abgleich.abweichungen ? ERGEBNIS.ABWEICHUNG : ERGEBNIS.AUSGEWERTET;
    const plan = [
      { zeile: p.zeile, kennung: datei, spalte: 'Ergebnis', alt: p.Ergebnis, neu: ergebnis },
      { zeile: p.zeile, kennung: datei, spalte: 'Hinweis', alt: p.Hinweis, neu: `${r.kurz} (nachträglich, ab-auswerten.js)` },
      { zeile: p.zeile, kennung: datei, spalte: 'VA', alt: p.VA, neu: r.va },
    ].filter(x => x.alt !== x.neu);
    if (!WRITE) { console.log(`   Protokoll: ${plan.map(x => `${x.spalte} -> "${x.neu}"`).join(', ')} (wuerde)`); continue; }
    const n = await setzeZellenSicher({ sheets, spreadsheetId, tab: BELEGE_TAB, kennSpalte: 'Datei', plan });
    if (n !== plan.length) { fehler++; console.log(`   ✗ Protokoll: nur ${n}/${plan.length} Zellen (Zeile hat sich geaendert?)`); } else console.log(`   ✓ Protokoll ${n} Zelle(n)`);
  }
  if (!WRITE) console.log('Trockenlauf - nichts geschrieben. Mit --write schreiben.');
  if (fehler) process.exit(1);
}
main().catch(err => { console.error('✗', err.message); process.exit(1); });
