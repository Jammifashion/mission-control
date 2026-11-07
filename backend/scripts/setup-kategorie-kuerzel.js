// MK1: optionale Spalte `Kuerzel` hinten im SSOT-Reiter `Struktur_Kategorien` - dort legt der Inhaber das Kuerzel je Kategorie fest
// ("CH-"; "-" = bewusst keins, wird auch nicht an Unterkategorien vererbt). Die Maske liest sie ueber lib/vorschlaege.js.
//
//   node backend/scripts/setup-kategorie-kuerzel.js                       Trockenlauf: Spalte + Vorschlagsliste Kategorie -> Kuerzel
//   node backend/scripts/setup-kategorie-kuerzel.js --write               haengt nur die Kopfzelle `Kuerzel` an
//   node backend/scripts/setup-kategorie-kuerzel.js --write --vorbelegen  zusaetzlich die Vorschlaege mit "schreiben: ja" in LEERE Zellen
//   ... --keins=39,67,604                                              "-" (bewusst keins) in diese LEEREN Zellen; geht vor --vorbelegen
//
// Vorbelegt wird nur, was eindeutig ist: Kuerzel aus dem Bestand der Kategorie SELBST mit genau einem Praefix. Gemischte Kategorien,
// Kuerzel nur ueber Eltern-/Hauptkategorie und schon festgelegte bleiben leer bzw. unveraendert (nie ueberschrieben).
// EIN values.batchUpdate RAW, zurueckgelesen. Ausgabe nur Kategorienummern, Pfade und Kuerzel.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { praefixFuerKategorien, festgelegtesKuerzel, SPALTE_KUERZEL } from '../lib/vorschlaege.js';

const TAB = 'Struktur_Kategorien';
const t = v => String(v ?? '').trim();
const spalte = i => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

/**
 * Vorschlagsliste je Kategorie (reine Logik, Test vorschlaege-maske.test.js).
 * @returns {{ nr, pfad, vorschlag, schreiben: boolean, grund: 'bestand'|'festgelegt'|'gemischt'|'eltern'|'hauptkategorie'|'keins'|'ohne' }[]}
 */
export function vorschlagsListe(erfassung, kategorien) {
  return (kategorien ?? []).map(k => {
    const f = festgelegtesKuerzel(k);
    if (f) return { nr: k.nr, pfad: k.pfad, vorschlag: f.praefix ?? '-', schreiben: false, grund: 'festgelegt' };
    const p = praefixFuerKategorien(erfassung, kategorien, [k]);
    if (!p) return { nr: k.nr, pfad: k.pfad, vorschlag: '', schreiben: false, grund: 'ohne' };
    if (p.ebene !== 'kategorie') return { nr: k.nr, pfad: k.pfad, vorschlag: p.praefix, schreiben: false, grund: p.ebene };
    if (p.gemischt) return { nr: k.nr, pfad: k.pfad, vorschlag: p.praefix, schreiben: false, grund: 'gemischt' };
    return { nr: k.nr, pfad: k.pfad, vorschlag: p.praefix, schreiben: true, grund: 'bestand' };
  });
}

async function main() {
  const WRITE = process.argv.includes('--write'), VOR = process.argv.includes('--vorbelegen');
  const KEINS = new Set((process.argv.find(a => a.startsWith('--keins=')) ?? '').slice(8).split(',').map(t).filter(Boolean));
  const SHEET = process.env.GOOGLE_SHEET_ID;
  if (!SHEET) throw new Error('GOOGLE_SHEET_ID fehlt.');
  const { google } = await import('googleapis');
  const { getGoogleAuth } = await import('../lib/googleAuth.js');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: SHEET, fields: 'sheets.properties(title,sheetId,gridProperties)' });
  const info = meta.sheets.find(x => x.properties.title === TAB)?.properties;
  if (!info) throw new Error(`Reiter ${TAB} fehlt.`);
  const { data } = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET, ranges: [`'${TAB}'`, "'Erfassungsmaske'"] });
  const [[kopf = [], ...zeilen], [ek = [], ...ez]] = data.valueRanges.map(v => v.values ?? [[]]);
  const i = n => kopf.map(t).indexOf(n);
  const [iNr, iPfad, iName] = [i('Kategorienummer'), i('Kategorien'), i('Kategoriename')];
  if (iNr < 0 || iPfad < 0 || iName < 0) throw new Error('Spalten Kategorienummer/Kategorien/Kategoriename fehlen.');
  let iK = i(SPALTE_KUERZEL);
  const neu = iK < 0;
  if (neu) iK = kopf.length;
  const kategorien = zeilen.map((r, z) => ({ nr: t(r[iNr]), pfad: t(r[iPfad]), name: t(r[iName]), kuerzel: neu ? '' : t(r[iK]), _zeile: z + 2 })).filter(k => k.name);
  const eKurz = ek.map(t).indexOf('Artikelkurzbezeichnung'), eKat = ek.map(t).indexOf('Kategorien');
  const erfassung = ez.map(r => ({ kurz: t(r[eKurz]), kategorien: t(r[eKat]) }));
  const liste = vorschlagsListe(erfassung, kategorien);

  console.log(neu ? `Ergaenzen: "${TAB}" hinten ${SPALTE_KUERZEL} (Spalte ${iK + 1})` : `✓ Spalte ${SPALTE_KUERZEL} gibt es schon (Spalte ${iK + 1}).`);
  const z = n => liste.filter(x => x.grund === n).length;
  console.log(`Kategorien ${liste.length}: vorbelegbar ${liste.filter(x => x.schreiben).length} · festgelegt ${z('festgelegt')} · gemischt ${z('gemischt')} · nur ueber Eltern ${z('eltern')} · nur ueber Hauptkategorie ${z('hauptkategorie')} · ohne ${z('ohne')}`);
  for (const x of liste) console.log(`  ${x.schreiben ? '+' : ' '} ${x.nr.padEnd(4)} ${x.pfad} -> ${x.vorschlag || '–'} (${x.grund})`);

  const zellen = [];
  if (neu) zellen.push({ range: `'${TAB}'!${spalte(iK)}1`, wert: SPALTE_KUERZEL });
  for (const nr of KEINS) {
    const k = kategorien.find(y => y.nr === nr);
    if (!k) { console.log(`✗ Kategorie ${nr} gibt es nicht - uebersprungen.`); continue; }
    if (!t(k.kuerzel)) zellen.push({ range: `'${TAB}'!${spalte(iK)}${k._zeile}`, wert: '-' });
  }
  if (VOR) for (const x of liste.filter(y => y.schreiben && !KEINS.has(y.nr))) {
    const k = kategorien.find(y => y.nr === x.nr);
    if (!t(k.kuerzel)) zellen.push({ range: `'${TAB}'!${spalte(iK)}${k._zeile}`, wert: x.vorschlag });
  }
  if (!zellen.length) { console.log('Nichts zu schreiben.'); return; }
  if (!WRITE) { console.log(`Trockenlauf - nichts geschrieben (${zellen.length} Zelle(n) waeren es). Mit --write [--vorbelegen].`); return; }
  if (neu && iK + 1 > (info.gridProperties?.columnCount ?? 0)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET, requestBody: { requests: [
      { appendDimension: { sheetId: info.sheetId, dimension: 'COLUMNS', length: iK + 1 - info.gridProperties.columnCount } },
    ] } });
  }
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET, requestBody: { valueInputOption: 'RAW', data: zellen.map(c => ({ range: c.range, values: [[c.wert]] })) } });
  const { data: zur } = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET, ranges: zellen.map(c => c.range) });
  const ok = zellen.every((c, j) => String(zur.valueRanges?.[j]?.values?.[0]?.[0] ?? '') === c.wert);
  console.log(ok ? `✓ ${zellen.length} Zelle(n) geschrieben und zurueckgelesen.` : '✗ Zuruecklesen weicht ab - bitte pruefen.');
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(err => { console.error('✗', err.message); process.exit(1); });
