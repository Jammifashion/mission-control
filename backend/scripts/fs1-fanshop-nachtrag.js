// FS1 (einmalig, Inhaber 22.11.2026): Fanshop-Bestueckung FP-001 (interne Bestellungen 30.09.-22.11.) als Nachtrag in BS-001.
//
// Verwendung:
//   node backend/scripts/fs1-fanshop-nachtrag.js              Trockenlauf: Tabelle je Quellzeile (Markdown), schreibt nichts
//   node backend/scripts/fs1-fanshop-nachtrag.js --write      Sicherung -> Termine + Eintraege -> Ruecklesen/Pruefsumme -> Quellzeilen markieren
//   node backend/scripts/fs1-fanshop-nachtrag.js --preise [--write]   NACH "Prüfen/Übernehmen" in MC: Einzelpreis (brutto aus der
//                                                Quellzeile) als Preis_Netto an leere Auftragspositionen, Preis_Eingabe "brutto"
//   Optionen: --status <Wert> (Standard "Bestellseite"), --kuerzel <Kürzel> (Standard "Nachtrag")
//
// Ausgabe ohne Namen und ohne Preise: Preise nur als "aus Zeile", Summen nur als Pruefsumme ja/nein je Spieltag.
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });
import { plane, schreibeEintraege, markiereQuelle, leseQuelle, setzePreise } from '../lib/fs1Nachtrag.js';
import { pruefsummen, deAusIso } from '../utils/fs1-nachtrag.js';
import { liesZugaengeTermine, liesEintraege } from '../lib/bestellseite.js';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const wert = (n, std) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : std; };
const STATUS = wert('--status', 'Bestellseite');
const KUERZEL = wert('--kuerzel', 'Nachtrag');
const ZUGANG = 'BS-001', PARTNER = 'FP-001', VON = '2026-09-30', BIS = '2026-11-22', SCHON_AB = '2026-11-18';
const VERBOTEN = ['offen', 'abgerechnet', 'Neu', ''];
const BESTAETIGT = new Set([46, 48]);   // Freigabe Inhaber 22.11.: Vorschlag Fuchsia bzw. Strawberry Haze uebernehmen

const tag = d => (d ? deAusIso(d).slice(0, 6) : '–');

function tabelle(plan) {
  const z = [];
  z.push('| Zeile | Datum | Spieltag | Zuordnung | Menge | Einzelpreis | Name | Ziel | Hinweis |');
  z.push('|---|---|---|---|---|---|---|---|---|');
  for (const x of [...plan.eintragen].sort((a, b) => a.zeile - b.zeile)) {
    let zu;
    if (x.art === 'artikel') zu = `${x.zuordnung.auswahl.bezeichnung}${x.zuordnung.auswahl.groesse ? ` · ${x.zuordnung.auswahl.groesse}` : ''}`;
    else if (x.art === 'zusammengefasst') zu = `→ Zeile ${x.zusammen}`;
    else zu = `🟠 frei: „${x.freitext}“${x.zuordnung?.grund ? ` (${x.zuordnung.grund}${x.zuordnung.vorschlag ? `; Vorschlag ${x.zuordnung.vorschlag}` : ''})` : ''}`;
    z.push(`| ${x.zeile} | ${tag(x.datum)} | ${tag(x.spieltag)}${x.abgeleitet ? ' (abgel.)' : ''} | ${zu} | ${x.menge} | ${x.art === 'zusammengefasst' ? '–' : (x.mitHandling ? 'aus Zeilen (Trikot + Handling)' : 'aus Zeile')} | ${x.namen.length ? 'ja' : (x.nameUnklar ? 'nein (unklar, nicht übernommen)' : 'nein')} | Nachtrag ${tag(x.spieltag)} | ${[x.zuordnung?.grund && x.art === 'artikel' ? x.zuordnung.grund : '', ...x.hinweise].filter(Boolean).join('; ')} |`);
  }
  return z.join('\n');
}

async function preise() {
  const r = await setzePreise({ statusWert: STATUS, write: WRITE });
  console.log(`Preise: ${r.setzen.length} Position(en) zu setzen, ${r.schon.length} haben schon einen Preis, ${r.offen.length} Einträge noch nicht übernommen.`);
  for (const s of r.setzen) console.log(`- ${s.positionId} (${s.auftragNr})`);
  for (const h of r.hinweise) console.log(`! ${h}`);
  if (r.auftraege.length) console.log(`Aufträge (Preis_Eingabe brutto, Stand neu): ${r.auftraege.map(x => x.auftragNr).join(', ')}`);
  console.log(r.geschrieben ? 'Geschrieben + zurückgelesen.' : (WRITE ? 'Nichts zu schreiben.' : 'TROCKENLAUF – nichts geschrieben.'));
}

async function run() {
  if (VERBOTEN.includes(STATUS)) throw new Error(`Status-Wert "${STATUS}" nicht erlaubt.`);
  if (args.includes('--preise')) return preise();
  const ctx = await plane({ zugangId: ZUGANG, partnerId: PARTNER, von: VON, bis: BIS, schonAb: SCHON_AB, bestaetigt: BESTAETIGT });
  const { plan } = ctx;
  const ps = pruefsummen(plan.eintragen);
  const vorab = await schreibeEintraege({ ctx, kuerzel: KUERZEL, terminNotiz: 'Nachtrag', dryRun: true });

  console.log(`\n## Einzutragen (${plan.eintragen.length} Quellzeilen, ${vorab.eintraegeNeu.length} neue Einträge, ${vorab.termineNeu.length} neue Termine)\n`);
  console.log(tabelle(plan));
  console.log('\n### Neue Termine\n');
  for (const tn of vorab.termineNeu) console.log(`- ${tn.Termin_ID} · ${deAusIso(tn.Datum)} · Notiz „${tn.Notiz}“ · Bestellschluss ${deAusIso(tn.Bestellschluss)}`);
  console.log('\n### Prüfsumme je Spieltag (Summe neu = Summe alt)\n');
  for (const [d, e] of [...ps].sort()) console.log(`- ${deAusIso(d)}: ${e.alt === e.neu ? 'ja' : 'NEIN'}`);
  const art = plan.eintragen.filter(x => x.art === 'artikel').length, frei = plan.eintragen.filter(x => x.art === 'extra').length;
  console.log(`\nArtikel sicher zugeordnet: ${art} · freie Positionen: ${frei} · zusammengefasst: ${plan.eintragen.filter(x => x.art === 'zusammengefasst').length}`);
  console.log(`\n## Schon in BS-001 – nur aus der Abrechnung nehmen (${plan.schon.length})\n`);
  console.log('| Zeile | Datum | Spieltag | Menge | Name | Hinweis |\n|---|---|---|---|---|---|');
  for (const x of plan.schon) console.log(`| ${x.zeile} | ${tag(x.datum)} | ${tag(x.spieltag)}${x.abgeleitet ? ' (abgel.)' : ''} | ${x.menge} | ${x.namen.length ? 'ja' : 'nein'} | ${x.hinweise.join('; ')} |`);
  console.log(`\n## Abgerechnet – nicht übernommen (${plan.abgerechnet.length})\n`);
  for (const x of plan.abgerechnet) console.log(`- Zeile ${x.zeile} · ${deAusIso(x.datum)} · Menge ${x.menge}`);

  if (!WRITE) { console.log('\nTROCKENLAUF – nichts geschrieben.'); return; }
  if ([...ps.values()].some(e => e.alt !== e.neu)) throw new Error('Prüfsumme weicht ab – nichts geschrieben.');

  // Sicherung
  const ordner = join(homedir(), 'Documents', 'mc-sicherungen');
  mkdirSync(ordner, { recursive: true });
  const { wt } = await liesZugaengeTermine(ctx.sheets, ctx.spreadsheetId);
  const e = await liesEintraege(ctx.sheets, ctx.spreadsheetId);
  const q = await leseQuelle(ctx.sheets, ctx.businessId);
  const datei = join(ordner, `fs1-vorher-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(datei, JSON.stringify({ termine: wt, eintraege: e.werte, intern: q }, null, 1));
  console.log(`\nSicherung: ${datei}`);

  const p = await schreibeEintraege({ ctx, kuerzel: KUERZEL, terminNotiz: 'Nachtrag' });
  console.log(`Geschrieben + zurückgelesen: ${p.termineNeu.length} Termine, ${p.eintraegeNeu.length} Einträge (${p.uebersprungen.length} schon vorhanden).`);

  // Pruefsumme gegen die zurueckgelesenen Eintraege (Menge je Eintrag x Einzelpreis der Quellzeile)
  const e2 = await liesEintraege(ctx.sheets, ctx.spreadsheetId);
  const jeEintrag = new Map(e2.zeilen.map(x => [x.Eintrag_ID, x]));
  const neuJe = new Map();
  for (const z of p.zuordnung) {
    const x = plan.eintragen.find(y => y.zeile === z.zeile);
    const ein = jeEintrag.get(z.eintragId);
    if (!ein || Number(ein.Menge) !== x.menge || t(ein.Vorgang) !== `FS1-${z.zeile}`) throw new Error(`Eintrag zu Zeile ${z.zeile} fehlt/abweichend – Quellzeilen NICHT markiert.`);
    neuJe.set(x.spieltag, (neuJe.get(x.spieltag) ?? 0) + Math.round(x.menge * x.preisCent));
  }
  for (const [d, s] of ps) if ((neuJe.get(d) ?? 0) !== s.alt) throw new Error(`Prüfsumme ${deAusIso(d)} nach dem Schreiben abweichend – Quellzeilen NICHT markiert.`);
  console.log('Prüfsumme nach Rücklesen: je Spieltag ja.');

  // Quellzeilen markieren
  const { tr } = await liesZugaengeTermine(ctx.sheets, ctx.spreadsheetId);
  const terminAm = new Map(tr.zeilen.filter(x => x.Zugang_ID === ZUGANG).map(x => [x.Datum, x.Termin_ID]));
  const quelleJe = new Map(q.zeilen.map(z => [z.zeile, z]));
  const mark = [];
  const erwartet = zeile => ({ text: quelleJe.get(zeile).text, status: quelleJe.get(zeile).status });
  for (const z of p.zuordnung) {
    mark.push({ zeile: z.zeile, erwartet: erwartet(z.zeile), verweis: `${ZUGANG} · ${z.terminId} · ${z.eintragId}` });
    if (z.mitHandling) mark.push({ zeile: z.mitHandling, erwartet: erwartet(z.mitHandling), verweis: `${ZUGANG} · ${z.terminId} · ${z.eintragId} (mit Zeile ${z.zeile})` });
  }
  for (const x of plan.schon) {
    const bt = terminAm.get(x.spieltag);
    mark.push({ zeile: x.zeile, erwartet: erwartet(x.zeile), verweis: `steht in ${ZUGANG}${bt ? ` · ${bt}` : ''}` });
  }
  const m = await markiereQuelle({ ctx, markierungen: mark, statusWert: STATUS });
  console.log(`Quellzeilen markiert + zurückgelesen: ${m.anzahl} (Status „${STATUS}“, Verweis in Spalte „Verweis“).`);
}
const t = v => String(v ?? '').trim();

run().catch(err => { console.error(`STOPP: ${err.message}`); process.exit(1); });
