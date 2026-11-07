// PPS1: Partner-Links auf Hash umstellen, OHNE dass sich ein Link aendert (Business-Reiter `Partner` und `FP_Partner`).
//
//   node backend/scripts/setup-partner-token-hash.js                     Trockenlauf (Standard): nur Anzahlen
//   node backend/scripts/setup-partner-token-hash.js --write             Schritt 1: Spalte Token_Hash hinten anlegen (falls
//                                                                        noetig) und je Klartext-Token den SHA-256 eintragen
//   node backend/scripts/setup-partner-token-hash.js --leeren            Trockenlauf Schritt 2
//   node backend/scripts/setup-partner-token-hash.js --leeren --write    Schritt 2: Klartext `Token` leeren - NUR wo der Hash
//                                                                        schon im Sheet steht und passt. Erst nach Push UND Test
//                                                                        an einem echten Link durch den Inhaber.
//   node backend/scripts/setup-partner-token-hash.js --zurueck <datei> [--write]
//                                                                        Rueckweg: Klartext aus der Sicherung wieder in leere
//                                                                        `Token`-Zellen derselben Partner-ID (Hash bleibt, er
//                                                                        gehoert zum selben Token)
//
// Vor jedem Schreiben: Sicherung (Partner-ID + Token + Token_Hash beider Reiter) nach Documents/mc-sicherungen/ (lokal,
// enthaelt Klartext - nie ins Repo, nie ins Postfach). Schreiben RAW, nur die betroffenen Zellen, danach zurueckgelesen.
// Konflikt (Hash passt nicht zum Klartext) = nichts an dieser Zeile, Exit-Code 1. Ausgabe nur Anzahlen, nie Tokens/Hashes/IDs.

import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { homedir } from 'os';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { SPALTE_TOKEN, SPALTE_HASH, umstellungsPlan } from '../utils/partner-token.js';

const SHEET = process.env.BUSINESS_SHEET_ID;
const WRITE = process.argv.includes('--write');
const LEEREN = process.argv.includes('--leeren');
const iZurueck = process.argv.indexOf('--zurueck');
const ZURUECK = iZurueck !== -1 ? process.argv[iZurueck + 1] : null;
const TABS = ['Partner', 'FP_Partner'];
const SICHERUNG_ORDNER = process.env.MC_SICHERUNGEN || join(homedir(), 'Documents', 'mc-sicherungen');

async function lies(sheets, tab, meta) {
  const info = meta.sheets.find(x => x.properties.title === tab)?.properties;
  if (!info) throw new Error(`Reiter ${tab} fehlt.`);
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET, range: `'${tab}'` });
  const [kopf = [], ...zeilen] = data.values ?? [];
  if (kopf.indexOf('Partner-ID') === -1) throw new Error(`Spalte Partner-ID fehlt in ${tab}.`);
  return { tab, info, kopf, zeilen };
}

function sichere(staende, anlass) {
  mkdirSync(SICHERUNG_ORDNER, { recursive: true });
  const zeit = new Date().toISOString().replace(/[:.]/g, '-');
  const datei = join(SICHERUNG_ORDNER, `partner-token-vor-PPS1-${anlass}-${zeit}.json`);
  const inhalt = staende.map(({ tab, kopf, zeilen }) => {
    const iId = kopf.indexOf('Partner-ID'), iT = kopf.indexOf(SPALTE_TOKEN), iH = kopf.indexOf(SPALTE_HASH);
    return { tab, zeilen: zeilen.map((r, i) => ({ zeile: i + 2, partnerId: r[iId] ?? '', token: iT !== -1 ? (r[iT] ?? '') : '', tokenHash: iH !== -1 ? (r[iH] ?? '') : '' })) };
  });
  writeFileSync(datei, JSON.stringify({ erstellt: new Date().toISOString(), anlass, reiter: inhalt }, null, 2), 'utf8');
  console.log(`Sicherung geschrieben: ${datei}`);
}

async function schreibe(sheets, zellen) {
  if (!zellen.length) return true;
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET, requestBody: { valueInputOption: 'RAW', data: zellen.map(z => ({ range: z.range, values: [[z.wert]] })) } });
  const { data } = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET, ranges: zellen.map(z => z.range) });
  return zellen.every((z, i) => String(data.valueRanges?.[i]?.values?.[0]?.[0] ?? '') === z.wert);
}

async function main() {
  if (!SHEET) throw new Error('BUSINESS_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: SHEET, fields: 'sheets.properties(title,sheetId,gridProperties)' });
  const staende = [];
  for (const tab of TABS) staende.push(await lies(sheets, tab, meta));

  const zellen = [];
  const spaltenNeu = [];
  let konflikte = 0;

  if (ZURUECK) {
    const sich = JSON.parse(readFileSync(ZURUECK, 'utf8'));
    for (const s of staende) {
      const iId = s.kopf.indexOf('Partner-ID'), iT = s.kopf.indexOf(SPALTE_TOKEN);
      if (iT === -1) { console.log(`✗ ${s.tab}: Spalte ${SPALTE_TOKEN} fehlt - Rueckweg nicht moeglich.`); process.exitCode = 1; continue; }
      const alt = (sich.reiter.find(x => x.tab === s.tab)?.zeilen ?? []).filter(z => String(z.token ?? '').trim());
      let wieder = 0, belegt = 0, fehlt = 0;
      for (const z of alt) {
        const idx = s.zeilen.findIndex(r => String(r[iId] ?? '').trim() === String(z.partnerId).trim());
        if (idx === -1) { fehlt++; continue; }
        if (String(s.zeilen[idx][iT] ?? '').trim()) { belegt++; continue; }
        zellen.push({ range: `'${s.tab}'!${colLetter(iT)}${idx + 2}`, wert: String(z.token).trim() });
        wieder++;
      }
      console.log(`${s.tab}: Rueckweg ${wieder} Klartext-Zelle(n) zurueck · ${belegt} schon belegt (unveraendert) · ${fehlt} Partner nicht mehr da`);
    }
  } else {
    for (const s of staende) {
      let iH = s.kopf.indexOf(SPALTE_HASH);
      const plan = umstellungsPlan(s.kopf, s.zeilen, { leeren: LEEREN });
      const mitToken = plan.neu.length + plan.schon.length + plan.konflikt.length;
      console.log(`${s.tab}: ${s.zeilen.length} Zeile(n) · ${mitToken} mit Klartext-Token · ${plan.nurHash} nur Hash · ${plan.ohneToken} ohne Zugang`
        + ` · Spalte ${SPALTE_HASH} ${iH === -1 ? `fehlt (wuerde Spalte ${s.kopf.length + 1})` : `da (Spalte ${iH + 1})`}`
        + ` · Kopfzeile ${s.kopf.length} Spalten, Raster ${s.info.gridProperties?.columnCount ?? '?'}`);
      console.log(`  Schritt 1: ${plan.neu.length} Hash neu · ${plan.schon.length} Hash schon passend · ${plan.konflikt.length} Konflikt`);
      if (LEEREN) console.log(`  Schritt 2: ${plan.leeren.length} Klartext-Zelle(n) wuerden geleert (nur Zeilen mit passendem Hash im Sheet)`
        + (plan.neu.length ? ` · ${plan.neu.length} ohne Hash bleiben stehen (erst Schritt 1)` : ''));
      konflikte += plan.konflikt.length;
      if (LEEREN) {
        const iT = s.kopf.indexOf(SPALTE_TOKEN);
        for (const { index } of plan.leeren) zellen.push({ range: `'${s.tab}'!${colLetter(iT)}${index + 2}`, wert: '' });
      } else {
        if (iH === -1) { iH = s.kopf.length; spaltenNeu.push({ s, iH }); zellen.push({ range: `'${s.tab}'!${colLetter(iH)}1`, wert: SPALTE_HASH }); }
        for (const { index, hash } of plan.neu) zellen.push({ range: `'${s.tab}'!${colLetter(iH)}${index + 2}`, wert: hash });
      }
    }
  }
  if (konflikte) { console.log(`✗ ${konflikte} Konflikt(e): Hash passt nicht zum Klartext - diese Zeilen bleiben unveraendert. Bitte pruefen.`); process.exitCode = 1; }
  console.log(`Zu schreiben: ${zellen.length} Zelle(n).`);
  if (!zellen.length) { console.log('Nichts zu tun.'); return; }
  if (!WRITE) { console.log('Trockenlauf - nichts geschrieben. Mit --write schreiben.'); return; }

  sichere(staende, ZURUECK ? 'zurueck' : LEEREN ? 'leeren' : 'hash');
  const erweitern = spaltenNeu
    .filter(({ s, iH }) => iH + 1 > (s.info.gridProperties?.columnCount ?? 0))
    .map(({ s, iH }) => ({ appendDimension: { sheetId: s.info.sheetId, dimension: 'COLUMNS', length: iH + 1 - s.info.gridProperties.columnCount } }));
  if (erweitern.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET, requestBody: { requests: erweitern } });
  const ok = await schreibe(sheets, zellen);
  console.log(ok ? `✓ ${zellen.length} Zelle(n) geschrieben und zurueckgelesen.` : '✗ Zuruecklesen weicht ab - bitte pruefen (Sicherung liegt vor).');
  if (!ok) process.exitCode = 1;
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
