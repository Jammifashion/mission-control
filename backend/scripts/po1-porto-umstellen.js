// PO1: offene FP_Verkäufe-Zeilen ab Bestelldatum 01.07.2026 auf "Porto je Bestellung" umstellen.
//
// Verwendung (im Hauptordner):
//   node backend/scripts/po1-porto-umstellen.js [--partner FP-001]   Trockenlauf (Standard): nur Zähler
//   node backend/scripts/po1-porto-umstellen.js --betraege           zusätzlich Porto-Saldo alt/neu (nur hier im Terminal)
//   node backend/scripts/po1-porto-umstellen.js --write              Sicherung, dann schreiben (NUR nach Freigabe Inhaber)
// Shop nur lesen (GET, include je 100, 1 Abruf / 2 s). Sicherung vor dem Schreiben:
// Documents/mc-sicherungen/FP_Verkaeufe_vor_PO1_<Zeit>.json. Ausgabe ohne Kundendaten; Beträge NIE ins Postfach.
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { homedir } from 'os';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient } from '../lib/shopConfig.js';
import { portoUmstellen } from '../lib/fpPortoUmstellung.js';

const args = process.argv.slice(2);
const wert = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const WRITE = args.includes('--write'), BETRAEGE = args.includes('--betraege');
const PARTNER = wert('--partner') ?? 'FP-001';
let letzte = 0;
const drossel = async () => { const w = letzte + 2000 - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); letzte = Date.now(); };

try {
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const r = await portoUmstellen({ sheets, sheetId: process.env.BUSINESS_SHEET_ID, partnerId: PARTNER, wc: getWcClient('jfn'), drossel, write: WRITE,
    sicherungOrdner: join(homedir(), 'Documents', 'mc-sicherungen') });
  console.log(`${PARTNER}: ${r.zeilen} Zeilen in ${r.bestellungen} Bestellungen umzustellen · Porto-Saldo je Bestellung neu gegenüber alt: mehr ${r.mehr}, weniger ${r.weniger}, gleich ${r.gleich}`);
  if (r.fehlt.length) console.log(`Ohne Porto aus dem Shop (nicht umgestellt): ${r.fehlt.length} Bestellung(en)`);
  if (r.ohneVersandart.length) console.log(`Ohne Versandart in FP_Artikel (nicht umgestellt): Produkt-IDs ${r.ohneVersandart.join(', ')}`);
  if (BETRAEGE) console.log(`Porto-Saldo netto (nur Terminal): alt ${r.summeAlt} · neu ${r.summeNeu} · Differenz ${Math.round((r.summeNeu - r.summeAlt) * 100) / 100}`);
  if (!WRITE) console.log('Trockenlauf – nichts geschrieben. Schreiben mit --write (nur nach Freigabe).');
  else console.log(`Geschrieben: ${r.geschrieben} Zeile(n). Sicherung: ${r.sicherung ?? '–'}${r.abweichung ? ` · ABWEICHUNG Zeilen ${r.abweichung.join(', ')}` : ''}`);
} catch (err) { console.error('STOPP:', err.message ?? err); process.exit(1); }
