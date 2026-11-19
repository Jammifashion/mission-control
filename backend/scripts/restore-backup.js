// Backup-Rueckweg ueben (FIX3). Liest eine Backup-Datei von backup-daily.js (…_Backup-JJJJ-MM-TT.json.gz, aus der
// geteilten Ablage heruntergeladen) und spielt sie in ein NEUES, LEERES Test-Sheet - nie in ein Original.
// Logik in utils/backup-restore.js.
//
// Verwendung:
//   node backend/scripts/restore-backup.js --datei <pfad.json.gz> [--ziel <Test-Sheet-ID>] [--modus raw|user] [--write]
//
// Ohne --write: TROCKENLAUF - zeigt je Reiter Zeilen, Zellen und die Fallen (Zahlen als Text, fuehrende Nullen,
// Datum) mit Beispiel-Adressen, schreibt nichts. Mit --ziel prueft er auch, ob das Ziel leer und kein Original ist.
// --write: legt die Reiter im Ziel an, schreibt die Werte (--modus raw = Text wie im Backup, Standard;
// user = wie getippt, Sheet rechnet Zahlen/Datum um), liest zurueck und meldet die Abweichungen je Falle.
// Ausgabe ohne Zellinhalte (nur Adressen und Zahlen) - Backups enthalten Kunden- und Partnerdaten.
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { analyse, vergleiche, zielPruefen } from '../utils/backup-restore.js';

const args = process.argv.slice(2);
const wert = n => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
const datei = wert('--datei');
const ziel = wert('--ziel');
const modus = (wert('--modus') ?? 'raw').toLowerCase();
const write = args.includes('--write');

const fallenText = f => `Zahl-als-Text ${f.zahl_text} · führende Null ${f.fuehrende_null} · Datum ${f.datum}`;

async function run() {
  if (!datei) { console.error('Bitte --datei <pfad.json.gz> angeben.'); process.exit(1); }
  if (!['raw', 'user'].includes(modus)) { console.error('--modus raw oder user.'); process.exit(1); }
  const roh = readFileSync(datei);
  const payload = JSON.parse((datei.endsWith('.gz') ? gunzipSync(roh) : roh).toString('utf8'));
  const ueberblick = analyse(payload);
  console.log(`== Backup-Rückweg · ${write ? 'SCHREIBEN' : 'Trockenlauf'} · Modus ${modus}`);
  console.log(`Datei: exportiert ${payload.exportedAt ?? '?'} · ${ueberblick.length} Reiter`);
  for (const r of ueberblick) {
    console.log(`  ${r.titel}: ${r.zeilen} Zeilen, ${r.zellen} Zellen · ${fallenText(r.fallen)}`
      + (Object.values(r.beispiele).some(b => b.length) ? ` · z. B. ${Object.entries(r.beispiele).filter(([, b]) => b.length).map(([k, b]) => `${k}: ${b.join(' ')}`).join('; ')}` : ''));
  }

  if (!ziel) {
    console.log('-> Trockenlauf ohne Ziel. Für die Übung: neues leeres Google Sheet anlegen, für das Dienstkonto freigeben, mit --ziel <ID> erneut.');
    return;
  }
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: ziel, fields: 'sheets.properties(title,sheetId)' });
  const vorhanden = (meta.sheets ?? []).map(s => s.properties);
  const inhalt = [];
  for (const p of vorhanden) {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: ziel, range: `'${p.title}'` });
    inhalt.push({ titel: p.title, zellen: (data.values ?? []).flat().filter(v => String(v ?? '') !== '').length });
  }
  const originale = [process.env.GOOGLE_SHEET_ID, process.env.BUSINESS_SHEET_ID, process.env.KUNDEN_SHEET_ID];
  const nein = zielPruefen({ zielId: ziel, originale, reiter: inhalt });
  if (nein) { console.error(`STOPP: ${nein}`); process.exit(1); }
  console.log('Ziel geprüft: leer, kein Original.');
  if (!write) { console.log('-> Trockenlauf, nichts geschrieben. Mit --write ausführen.'); return; }

  // Reiter anlegen (Namen wie im Backup), Werte schreiben, zuruecklesen, vergleichen.
  const fehlend = Object.keys(payload.tabs ?? {}).filter(titel => !vorhanden.some(v => v.title === titel));
  if (fehlend.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: ziel, requestBody: { requests: fehlend.map(title => ({ addSheet: { properties: { title,
      gridProperties: { rowCount: Math.max(100, (payload.tabs[title] ?? []).length + 10), columnCount: Math.max(26, ...(payload.tabs[title] ?? []).map(r => r.length)) } } } })) } });
  }
  let summe = { zahl_text: 0, fuehrende_null: 0, datum: 0, sonst: 0 };
  for (const [titel, zeilen] of Object.entries(payload.tabs ?? {})) {
    if (!(zeilen ?? []).length) { console.log(`  ${titel}: leer`); continue; }
    await sheets.spreadsheets.values.update({ spreadsheetId: ziel, range: `'${titel}'!A1`, valueInputOption: modus === 'raw' ? 'RAW' : 'USER_ENTERED', requestBody: { values: zeilen } });
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: ziel, range: `'${titel}'`, valueRenderOption: 'FORMATTED_VALUE' });
    const v = vergleiche(zeilen, data.values ?? []);
    for (const k of Object.keys(summe)) summe[k] += v.abweichungen[k];
    const n = Object.values(v.abweichungen).reduce((a, b) => a + b, 0);
    console.log(`  ${titel}: ${v.gleich} gleich, ${n} abweichend${n ? ` (${fallenText(v.abweichungen)} · sonst ${v.abweichungen.sonst}; z. B. ${v.beispiele.slice(0, 5).join(' ')})` : ''}`);
    await new Promise(r => setTimeout(r, 1200));   // Schreib-Kontingent
  }
  console.log(`-> Abweichungen gesamt: ${fallenText(summe)} · sonst ${summe.sonst}.`);
}

run().catch(e => { console.error(`FEHLER: ${String(e?.message ?? 'unbekannt').slice(0, 300)}`); process.exit(1); });
