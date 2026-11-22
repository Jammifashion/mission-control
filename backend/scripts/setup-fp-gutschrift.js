// GS1: Spalten fuer die Gutschrift an Festpreis-Partner.
//   FP_Abrechnungen: Kopf `Positionen` in Spalte I (falls leer - die Spalte trug schon immer das JSON, nur ohne Kopf), dahinter
//                    `Gutschrift_Lexware_ID`, `Gutschrift_Am`, `Gutschrift_Status`.
//   FP_Partner:      hinten `Kunden_Nr` (Verknuepfung Partner -> MC-Kunde -> Lexoffice-Kontakt; auch fuer PD3).
// Optional einen Partner verknuepfen: --partner FP-001 --kunde K-00063 [--lexnr 10350] (nur wenn die Zelle leer ist oder schon gleich;
// --lexnr prueft vorher, dass der Kunde diese Lexoffice-Nummer traegt).
//
//   node backend/scripts/setup-fp-gutschrift.js                                   Trockenlauf (Standard)
//   node backend/scripts/setup-fp-gutschrift.js --partner FP-001 --kunde K-00063 --lexnr 10350 --write
//
// Idempotent. Aendert sonst nichts, ueberschreibt nie eine gefuellte Zelle. Ausgabe nur Reiter, Spalten, IDs - nie Namen.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { sichereSpaltenRaster, spalteBuchstabe } from '../lib/sheet-zeilen.js';
import { leseKunden } from '../lib/kunden.js';
import { GUTSCHRIFT_SPALTEN, SPALTE_POSITIONEN, SPALTE_KUNDE } from '../utils/gutschrift.js';

const SHEET = process.env.BUSINESS_SHEET_ID;
const WRITE = process.argv.includes('--write');
const arg = name => { const i = process.argv.indexOf(name); return i === -1 ? '' : String(process.argv[i + 1] ?? '').trim(); };
const PARTNER = arg('--partner'), KUNDE = arg('--kunde'), LEXNR = arg('--lexnr');
const t = v => String(v ?? '').trim();

async function main() {
  if (!SHEET) throw new Error('BUSINESS_SHEET_ID fehlt.');
  if ((PARTNER || KUNDE) && !(/^FP-\d{3,}$/.test(PARTNER) && /^K-\d{5}$/.test(KUNDE))) throw new Error('--partner FP-NNN und --kunde K-NNNNN gehoeren zusammen.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const schreiben = [];   // { tab, range, wert, breite }

  // FP_Abrechnungen
  const { data: a } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET, range: "'FP_Abrechnungen'!1:1" });
  const aKopf = (a.values?.[0] ?? []).map(t);
  if (aKopf[0] !== 'Abrechnungs-ID') throw new Error('FP_Abrechnungen: Spalte A ist nicht Abrechnungs-ID - nichts geschrieben.');
  if (!aKopf[8]) { schreiben.push({ tab: 'FP_Abrechnungen', range: "'FP_Abrechnungen'!I1", wert: SPALTE_POSITIONEN, breite: 9 }); console.log('Ergaenzen: FP_Abrechnungen I1 = Positionen (Kopf fehlte)'); }
  else if (aKopf[8] !== SPALTE_POSITIONEN) throw new Error(`FP_Abrechnungen: I1 ist „${aKopf[8]}“, erwartet ${SPALTE_POSITIONEN} - nichts geschrieben.`);
  let naechste = Math.max(aKopf.length, 9);
  for (const s of GUTSCHRIFT_SPALTEN) {
    if (aKopf.includes(s)) { console.log(`✓ FP_Abrechnungen: ${s} gibt es schon.`); continue; }
    schreiben.push({ tab: 'FP_Abrechnungen', range: `'FP_Abrechnungen'!${spalteBuchstabe(naechste)}1`, wert: s, breite: naechste + 1 });
    console.log(`Ergaenzen: FP_Abrechnungen ${spalteBuchstabe(naechste)}1 = ${s}`);
    naechste++;
  }

  // FP_Partner
  const { data: p } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET, range: "'FP_Partner'" });
  const [pKopfRoh = [], ...pZeilen] = p.values ?? [];
  const pKopf = pKopfRoh.map(t);
  if (!pKopf.includes('Partner-ID')) throw new Error('FP_Partner: Spalte Partner-ID fehlt - nichts geschrieben.');
  let iK = pKopf.indexOf(SPALTE_KUNDE);
  if (iK === -1) {
    iK = pKopf.length;
    schreiben.push({ tab: 'FP_Partner', range: `'FP_Partner'!${spalteBuchstabe(iK)}1`, wert: SPALTE_KUNDE, breite: iK + 1 });
    console.log(`Ergaenzen: FP_Partner ${spalteBuchstabe(iK)}1 = ${SPALTE_KUNDE}`);
  } else console.log(`✓ FP_Partner: ${SPALTE_KUNDE} gibt es schon (Spalte ${spalteBuchstabe(iK)}).`);

  if (PARTNER) {
    const iP = pKopf.indexOf('Partner-ID');
    const zi = pZeilen.findIndex(r => t(r[iP]) === PARTNER);
    if (zi === -1) throw new Error(`${PARTNER} gibt es in FP_Partner nicht - nichts geschrieben.`);
    const { kunden } = await leseKunden();
    const k = kunden.find(x => x.Kunden_Nr === KUNDE);
    if (!k) throw new Error(`${KUNDE} gibt es im Kunden-Sheet nicht - nichts geschrieben.`);
    if (!t(k.Lexoffice_ID)) throw new Error(`${KUNDE} ist nicht mit Lexoffice verknuepft - nichts geschrieben.`);
    if (LEXNR && t(k.Lexoffice_Nr) !== LEXNR) throw new Error(`${KUNDE} traegt nicht die Lexoffice-Nr. ${LEXNR} - nichts geschrieben.`);
    console.log(`✓ ${KUNDE}: Lexoffice-ID vorhanden${LEXNR ? `, Lexoffice-Nr. ${LEXNR} passt` : ''}.`);
    const alt = t(pZeilen[zi][iK]);
    if (alt === KUNDE) console.log(`✓ ${PARTNER}: ${SPALTE_KUNDE} steht schon auf ${KUNDE}.`);
    else if (alt) throw new Error(`${PARTNER}: ${SPALTE_KUNDE} ist schon ${alt} - wird nie ueberschrieben, nichts geschrieben.`);
    else {
      schreiben.push({ tab: 'FP_Partner', range: `'FP_Partner'!${spalteBuchstabe(iK)}${zi + 2}`, wert: KUNDE, breite: iK + 1 });
      console.log(`Ergaenzen: ${PARTNER} ${SPALTE_KUNDE} = ${KUNDE} (Zeile ${zi + 2})`);
    }
  }

  if (!schreiben.length) { console.log('Nichts zu tun.'); return; }
  if (!WRITE) { console.log('Trockenlauf - nichts geschrieben. Mit --write schreiben.'); return; }
  for (const tab of ['FP_Abrechnungen', 'FP_Partner']) {
    const b = Math.max(0, ...schreiben.filter(s => s.tab === tab).map(s => s.breite));
    if (b) await sichereSpaltenRaster(sheets, SHEET, tab, b);
  }
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET, requestBody: { valueInputOption: 'RAW',
    data: schreiben.map(s => ({ range: s.range, values: [[s.wert]] })) } });
  const { data: zurueck } = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET, ranges: schreiben.map(s => s.range) });
  const ok = schreiben.every((s, i) => t(zurueck.valueRanges?.[i]?.values?.[0]?.[0]) === s.wert);
  console.log(ok ? `✓ ${schreiben.length} Zelle(n) geschrieben und zurueckgelesen.` : '✗ Zuruecklesen weicht ab - bitte pruefen.');
  if (!ok) process.exitCode = 1;
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
