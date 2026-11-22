// GT1 Punkt 7: VK-Steuer (Spalte AB) fuer OFFENE FP_Verkaeufe-Zeilen aus den Shop-Positionen nachtragen.
// Neue Rundung gilt ab den naechsten Abrechnungen (Inhaber 22.11.) - abgerechnete Zeilen bleiben unberuehrt.
//
// Verwendung (im Hauptordner):
//   node backend/scripts/nachtragen-vk-steuer.js            Trockenlauf (Standard): nur Zaehler
//   node backend/scripts/nachtragen-vk-steuer.js --write    Sicherung, dann schreiben (NUR nach Freigabe Inhaber)
// Shop nur lesen (GET orders include je 100, 1 Abruf / 2 s, _fields id,line_items). Fehlt die Kopfzelle AB "VK-Steuer", legt --write sie an
// (nur wenn der Kopf genau bis AA reicht, wie der FP-Sync). Schreiben: nur leere AB-Zellen offener Zeilen, vorher frisch gelesen
// (Zeile muss noch offen und AB leer sein), RAW, danach zurueckgelesen. Sicherung der betroffenen Zellen nach Documents/mc-sicherungen.
// Ausgabe nur Zaehler - keine Betraege, keine Kundendaten.
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { homedir } from 'os';
import { mkdirSync, writeFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient } from '../lib/shopConfig.js';
import { seitenListe } from '../lib/hosterPruefseite.js';
import { vkSteuerPlan } from '../utils/vk-steuer-nachtrag.js';

const WRITE = process.argv.includes('--write');
const TAB = 'FP_Verkäufe';
const SHEET = process.env.BUSINESS_SHEET_ID;
const warte = ms => new Promise(r => setTimeout(r, ms));

async function lies(sheets) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET, range: `'${TAB}'!A1:ZZ`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const [kopf = [], ...z] = data.values ?? [];
  z.forEach((r, i) => { r._zeile = i + 2; });
  return { kopf: kopf.map(x => String(x ?? '').trim()), zeilen: z };
}

try {
  if (!SHEET) throw new Error('BUSINESS_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { kopf, zeilen } = await lies(sheets);
  const iSt = kopf.indexOf('Status Abrechnung'), iO = kopf.indexOf('WC-Bestellnummer');
  const ids = [...new Set(zeilen.filter(r => String(r[iSt] ?? '').trim() === 'offen').map(r => String(r[iO] ?? '').trim()).filter(x => /^\d+$/.test(x)))];
  const wc = getWcClient('jfn');   // FP-Partner verkaufen im JFN-Shop (FP-Sync je Shop; HONK hat heute keinen FP-Partner)
  const bestellungen = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await wc.get('orders', { include: ids.slice(i, i + 100).join(','), per_page: 100, status: 'any', _fields: 'id,line_items' });
    for (const o of seitenListe(data, { wc, pfad: 'orders' })) bestellungen.set(String(o.id), o);
    await warte(2000);
  }
  const p = vkSteuerPlan({ kopf, zeilen, bestellungen });
  console.log(`Offene Zeilen: ${p.plan.length} nachzutragen · schon mit Steuer ${p.schonDa} · ohne Positions-ID ${p.ohnePosition} · Position nicht im Shop ${p.ohneShop} · nicht offen (bleiben) ${p.nichtOffen}`);
  if (!WRITE) { console.log('Trockenlauf – nichts geschrieben. Schreiben mit --write (nur nach Freigabe).'); process.exit(0); }
  if (!p.plan.length) { console.log('Nichts zu schreiben.'); process.exit(0); }

  // Kopfzelle AB, falls noetig (wie der FP-Sync)
  let iSteuer = kopf.indexOf('VK-Steuer');
  if (iSteuer === -1) {
    if (kopf.length !== 27) throw new Error(`${TAB}: ${kopf.length} Spalten – VK-Steuer nicht in AB anlegbar, nichts geschrieben.`);
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET, range: `'${TAB}'!AB1`, valueInputOption: 'RAW', requestBody: { values: [['VK-Steuer']] } });
    iSteuer = 27;
  } else if (iSteuer !== 27) throw new Error(`${TAB}: VK-Steuer steht nicht in AB – nichts geschrieben.`);

  // frisch lesen und pruefen: Zeile noch offen, AB leer, gleiche Bestellnummer
  const frisch = await lies(sheets);
  const jeZeile = new Map(frisch.zeilen.map(r => [r._zeile, r]));
  const ok = p.plan.filter(x => { const r = jeZeile.get(x.zeile); return r && String(r[iSt] ?? '').trim() === 'offen' && String(r[iSteuer] ?? '').trim() === '' && String(r[iO] ?? '').trim() === x.bestellung; });
  const ordner = join(homedir(), 'Documents', 'mc-sicherungen'); mkdirSync(ordner, { recursive: true });
  const datei = join(ordner, `FP_Verkaeufe_VK-Steuer_vor_GT1_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(datei, JSON.stringify(ok.map(x => ({ zeile: x.zeile, alt: '' }))));
  const data = ok.map(x => ({ range: `'${TAB}'!AB${x.zeile}`, values: [[x.wert]] }));
  for (let i = 0; i < data.length; i += 500) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET, requestBody: { valueInputOption: 'RAW', data: data.slice(i, i + 500) } });
  const nach = await lies(sheets);
  const jeNach = new Map(nach.zeilen.map(r => [r._zeile, r]));
  const falsch = ok.filter(x => Number(jeNach.get(x.zeile)?.[iSteuer]) !== x.wert);
  console.log(`Geschrieben: ${ok.length} Zelle(n), übersprungen (inzwischen geändert): ${p.plan.length - ok.length}. Sicherung: ${datei}${falsch.length ? ` · ABWEICHUNG Zeilen ${falsch.map(x => x.zeile).join(', ')}` : ' · zurückgelesen ok'}`);
  if (falsch.length) process.exitCode = 1;
} catch (err) { console.error('STOPP:', err.message ?? err); process.exit(1); }
