// RE1 Vorarbeit (einmalig, Inhaber 22.11.2026): Preise fuer die Fanshop-Auftraege 22.11. (AU-2026-0010) und 27.11. (AU-2026-0011)
// aus den alten internen Bestellungen von FP-001 (Status "Bestellseite", Verweis "steht in BS-001 · …") setzen und bereinigen.
//
//   node backend/scripts/re1-preise-22-11.js            Trockenlauf: Zuordnung je Position, schreibt nichts
//   node backend/scripts/re1-preise-22-11.js --write    Sicherung -> Preise / neue Positionen / Entfernt -> zurueckgelesen
//
// Zuordnung FEST (vom Inhaber im Trockenlauf geprueft), nie geraten:
//   PREISE   Position_ID -> Quellzeile (Einzelpreis brutto der Zeile; Trikot = 34,50 inkl. Handling)
//   NEU      fehlende Positionen aus Quellzeilen als freie Position (Herkunft "vorhanden", Ware ist geliefert)
//   ENTFERNT doppelte Positionen (Spalte Entfernt, Zeile bleibt - nie loeschen)
// Jede Quellzeile wird beim Schreiben gegen Text + Einzelpreis + Menge geprueft; jede Position gegen Auftrag + leeren Preis.
// Nur Preis_Netto (aus Brutto, 4 Stellen), Preis_Eingabe "brutto" am Auftrag, Stand. Ausgabe ohne Preise und Namen.
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });
import { mitAuftragSperre, liesAuftraege, schreibeAuftragsZellen, auftragZellenAus } from '../lib/auftraege.js';
import { sheetsClient, sheetId } from '../lib/bestellseite.js';
import { leseQuelle } from '../lib/fs1Nachtrag.js';
import { TAB_AUFTRAEGE, TAB_POSITIONEN, POSITION_SPALTEN, POSITION_OPTIONAL, alsZeile } from '../utils/auftraege.js';
import { nettoAusBrutto } from '../utils/auftrag-preise.js';
import { cent } from '../utils/fs1-nachtrag.js';
import { berlinDatum } from '../utils/berlin-tag.js';

const WRITE = process.argv.includes('--write');
// Preis von Hand (Inhaber im Terminal, nie im Repo): --hand AU-2026-0010-12=2,25 (brutto je Stueck)
const HAND = process.argv.flatMap((a, i, l) => (a === '--hand' && l[i + 1] ? [l[i + 1]] : [])).map(x => {
  const m = /^(AU-\d{4}-\d{4}-\d{2})=(\d+(?:[.,]\d{1,2})?)$/.exec(x);
  if (!m) throw new Error('--hand erwartet AU-JJJJ-NNNN-NN=Preis');
  return { pos: m[1], brutto: m[2] };
});
const t = v => String(v ?? '').trim();

const PREISE = [
  { pos: 'AU-2026-0010-03', zeile: 114 },   // Puckkind 22.11.
  { pos: 'AU-2026-0010-04', zeile: 122 },   // Wintermuetze Black (CB445 schwarz)
  { pos: 'AU-2026-0010-05', zeile: 121 },   // Wintermuetze Bottle Green (CB445 gruen)
  { pos: 'AU-2026-0010-06', zeile: 113 },   // Fluffy Hoodie Herren Beryl Blue 2XL
  { pos: 'AU-2026-0010-07', zeile: 112 },   // Fluffy Zip Hoodie Pink 2XL (alt: "Fluffy Jacke 2XL PINK")
  { pos: 'AU-2026-0010-08', zeile: 106 },   // Hamburg-Jacke XL (alt: "Croco Jacke bunt XL") - unsicher
  { pos: 'AU-2026-0010-09', zeile: 104 },   // Fluffy Jacke Pink M
  { pos: 'AU-2026-0010-10', zeile: 110 },   // Match Day Cap Black/Red
  { pos: 'AU-2026-0010-11', zeile: 111 },   // Match Day Cap Black/Kelly Green
  { pos: 'AU-2026-0011-01', zeile: 123 },   // Puckkind 27.11.
];
const NEU = [
  { auftrag: 'AU-2026-0010', zeile: 125, freitext: 'Trikots (inkl. Handling)' },
  { auftrag: 'AU-2026-0010', zeile: 127, freitext: 'Porto' },
];
const ENTFERNT = ['AU-2026-0010-01', 'AU-2026-0010-02'];   // Doppel von -07 / -06 (ohne Bestellseiten-Eintrag)
const AUFTRAEGE = ['AU-2026-0010', 'AU-2026-0011'];

function plan({ a, p, quelle }) {
  const qJe = new Map(quelle.filter(z => z.partnerId === 'FP-001').map(z => [z.zeile, z]));
  const probleme = [], setzen = [], neu = [], weg = [];
  const quellZeile = nr => {
    const z = qJe.get(nr);
    if (!z || z.status !== 'Bestellseite' || !/^steht in BS-001/.test(z.verweis)) { probleme.push(`Quellzeile ${nr}: fehlt oder nicht „steht in BS-001“`); return null; }
    return z;
  };
  for (const x of PREISE) {
    const pos = p.zeilen.find(y => y.Position_ID === x.pos);
    const z = quellZeile(x.zeile);
    if (!pos || t(pos.Entfernt)) { probleme.push(`${x.pos}: fehlt oder entfernt`); continue; }
    if (!z) continue;
    if (Number(pos.Menge) !== Number(z.menge)) probleme.push(`${x.pos}: Menge ${pos.Menge} ≠ Zeile ${x.zeile} (${z.menge})`);
    if (t(pos.Preis_Netto) !== '') { probleme.push(`${x.pos}: hat schon einen Preis`); continue; }
    setzen.push({ ...x, zeileSheet: pos._zeile, netto: nettoAusBrutto(cent(z.einzelpreis) / 100), quelle: z });
  }
  for (const h of HAND) {
    const pos = p.zeilen.find(y => y.Position_ID === h.pos);
    if (!pos || t(pos.Entfernt)) { probleme.push(`${h.pos}: fehlt oder entfernt`); continue; }
    if (t(pos.Preis_Netto) !== '') { probleme.push(`${h.pos}: hat schon einen Preis`); continue; }
    setzen.push({ pos: h.pos, zeile: `Hand-${h.pos}`, zeileSheet: pos._zeile, netto: nettoAusBrutto(cent(h.brutto) / 100), quelle: { text: 'Hand', einzelpreis: h.brutto, menge: String(pos.Menge) } });
  }
  for (const x of NEU) {
    const z = quellZeile(x.zeile);
    if (!z) continue;
    if (p.zeilen.some(y => y.Auftrag_Nr === x.auftrag && t(y.Freitext) === x.freitext && !t(y.Entfernt))) { probleme.push(`${x.auftrag}: „${x.freitext}“ gibt es schon`); continue; }
    neu.push({ ...x, menge: Number(z.menge), netto: nettoAusBrutto(cent(z.einzelpreis) / 100), quelle: z });
  }
  for (const id of ENTFERNT) {
    const pos = p.zeilen.find(y => y.Position_ID === id);
    if (!pos) { probleme.push(`${id}: fehlt`); continue; }
    if (t(pos.Entfernt)) continue;
    weg.push({ id, zeileSheet: pos._zeile });
  }
  const auftraege = AUFTRAEGE.map(nr => a.zeilen.find(y => y.Auftrag_Nr === nr)).filter(Boolean);
  if (auftraege.length !== AUFTRAEGE.length) probleme.push('Auftrag fehlt');
  return { setzen, neu, weg, auftraege, probleme };
}

async function run() {
  const sheets = await sheetsClient();
  const spreadsheetId = sheetId();
  const quelle = (await leseQuelle(sheets, process.env.BUSINESS_SHEET_ID)).zeilen;
  const { a, p } = await liesAuftraege(sheets, spreadsheetId);
  const pl = plan({ a, p, quelle });
  console.log('| Position | Quellzeile | Menge | Preis | Hinweis |\n|---|---|---|---|---|');
  for (const x of pl.setzen) console.log(`| ${x.pos} | ${x.zeile} | ${x.quelle.menge} | ${String(x.zeile).startsWith('Hand') ? 'von Hand' : 'aus Zeile'} | ${x.pos.endsWith('-08') ? 'unsicher: alt „Croco Jacke bunt XL“' : ''} |`);
  for (const x of pl.neu) console.log(`| neu in ${x.auftrag}: „${x.freitext}“ | ${x.zeile} | ${x.menge} | aus Zeile | freie Position, Herkunft vorhanden |`);
  for (const x of pl.weg) console.log(`| ${x.id} | – | – | – | entfernen (Doppel) |`);
  if (!HAND.some(h => h.pos === 'AU-2026-0010-12')) console.log(`\nOhne Preis bleibt: AU-2026-0010-12 (Puck skyline, keine alte Zeile).`);
  console.log(pl.probleme.length ? `\nPROBLEME:\n- ${pl.probleme.join('\n- ')}` : '\nKeine Probleme.');
  if (!WRITE) { console.log('\nTROCKENLAUF – nichts geschrieben.'); return; }
  if (pl.probleme.length) throw new Error('Probleme – nichts geschrieben.');

  const ordner = join(homedir(), 'Documents', 'mc-sicherungen');
  mkdirSync(ordner, { recursive: true });
  const { wa, wp } = await liesAuftraege(sheets, spreadsheetId);
  const datei = join(ordner, `re1-22-11-vorher-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(datei, JSON.stringify({ auftraege: wa, positionen: wp }, null, 1));
  console.log(`\nSicherung: ${datei}`);

  await mitAuftragSperre(async () => {
    const f = await liesAuftraege(sheets, spreadsheetId);   // frisch
    const q = (await leseQuelle(sheets, process.env.BUSINESS_SHEET_ID)).zeilen;
    const pf = plan({ a: f.a, p: f.p, quelle: q });
    if (pf.probleme.length || pf.setzen.length !== pl.setzen.length || pf.neu.length !== pl.neu.length) throw new Error('Stand geändert – nichts geschrieben.');
    for (const x of [...pf.setzen, ...pf.neu]) {
      const alt = [...pl.setzen, ...pl.neu].find(y => y.zeile === x.zeile).quelle;
      if (alt.text !== x.quelle.text || alt.einzelpreis !== x.quelle.einzelpreis || alt.menge !== x.quelle.menge) throw new Error(`Quellzeile ${x.zeile} geändert – nichts geschrieben.`);
    }
    const iso = new Date().toISOString(), tag = berlinDatum(new Date());
    const zellen = [
      ...pf.setzen.flatMap(x => auftragZellenAus(TAB_POSITIONEN, f.p.idx, x.zeileSheet, { Preis_Netto: x.netto, Stand: iso })),
      ...pf.weg.flatMap(x => auftragZellenAus(TAB_POSITIONEN, f.p.idx, x.zeileSheet, { Entfernt: tag, Stand: iso })),
      ...pf.auftraege.flatMap(x => auftragZellenAus(TAB_AUFTRAEGE, f.a.idx, x._zeile, { Preis_Eingabe: 'brutto', Stand: iso })),
    ];
    const breite = f.wp[0].length;
    const ids = f.p.zeilen.map(y => y.Position_ID);
    const naechste = nr => { const n = Math.max(0, ...ids.filter(i => i.startsWith(`${nr}-`)).map(i => Number(i.slice(nr.length + 1)) || 0)) + 1; const id = `${nr}-${String(n).padStart(2, '0')}`; ids.push(id); return id; };
    const neueZeilen = pf.neu.map(x => alsZeile(f.p.idx, {
      ...Object.fromEntries([...POSITION_SPALTEN, ...POSITION_OPTIONAL].map(s => [s, ''])),
      Position_ID: naechste(x.auftrag), Auftrag_Nr: x.auftrag, Art: 'frei', Freitext: x.freitext, Menge: String(x.menge),
      Herkunft: 'vorhanden', Preis_Netto: x.netto, Stand: iso,
    }, POSITION_SPALTEN, breite));
    await schreibeAuftragsZellen(sheets, spreadsheetId, { zellen, bloecke: [{ tab: TAB_POSITIONEN, alt: f.wp, zeilen: neueZeilen }] });
    console.log(`Geschrieben + zurückgelesen: ${pf.setzen.length} Preise, ${neueZeilen.length} neue Positionen (${neueZeilen.map(z => z[f.p.idx.Position_ID]).join(', ')}), ${pf.weg.length} entfernt, ${pf.auftraege.length} Aufträge auf brutto.`);
  });
}
run().catch(err => { console.error(`STOPP: ${err.message}`); process.exit(1); });
