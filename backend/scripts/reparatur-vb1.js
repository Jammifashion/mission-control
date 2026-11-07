// Auftrag VB1 (08.11.2026): Variantenbaum der BY052-Artikel reparieren.
//
// Schaden: "Artikel ändern" hat die globalen Attribute Farbe (pa_farbe, id 3) und Größe
// (pa_groesse, id 2) durch lokale ersetzt; die Variationen stehen seitdem auf "Beliebig".
// Soll: Elternartikel wieder GLOBAL, Optionen = die Werte der sichtbaren Variationen
// (ohne 4XL/5XL), jede Variation mit ihren Werten aus der eigenen SKU
// (<Artikelnummer>-<farbe>-<groesse>, so von der Anlage vergeben). Variationen, deren Groesse
// nicht mehr gefuehrt wird (4XL/5XL), werden PRIVAT - nie geloescht.
//
// Trockenlauf Standard (nur lesen, Liste Ist -> Soll). `--write`: Sicherung nach
// Documents/mc-sicherungen, dann je Artikel Produkt-PUT + EIN Variations-Batch, Takt 2 s,
// zuruecklesen. `--nur <id,id>` begrenzt auf einzelne Artikel.
//   node scripts/reparatur-vb1.js
//   node scripts/reparatur-vb1.js --write

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';
import os from 'os';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });

const { getWcClient } = await import('../lib/shopConfig.js');
const { leseAlleVariationen } = await import('../lib/wc-variation-ids.js');

export const ARTIKEL = [15997, 15987, 15805, 15795, 15783];   // 15772 (SP-Karma) ist heil
export const FARBE = { id: 3, name: 'Farbe' };
export const GROESSE = { id: 2, name: 'Größe' };
export const ENTFALLEN = ['4XL', '5XL'];
const GR_REIHE = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];

/** Farbe + Groesse aus der Variations-SKU. null = nicht eindeutig. */
export function ausSku(sku, artikelSku, farbOptionen) {
  const s = String(sku ?? '');
  if (!s.toLowerCase().startsWith(String(artikelSku).toLowerCase() + '-')) return null;
  const rest = s.slice(artikelSku.length + 1).split('-');
  if (rest.length !== 2) return null;
  const farbe = farbOptionen.find(f => f.toLowerCase() === rest[0].toLowerCase());
  const groesse = GR_REIHE.find(g => g.toLowerCase() === rest[1].toLowerCase());
  return farbe && groesse ? { farbe, groesse } : null;
}

/** Plan je Artikel (reine Logik). */
export function planeArtikel(produkt, variationen) {
  const farbAttr = (produkt.attributes ?? []).find(a => a.name === 'Farbe');
  const farben = farbAttr?.options ?? [];
  const zeilen = [];
  const probleme = [];
  for (const v of variationen) {
    const soll = ausSku(v.sku, produkt.sku, farben);
    const ist = (v.attributes ?? []).map(a => `${a.name}=${a.option}`).join(', ') || '(leer = Beliebig)';
    if (!soll) { probleme.push(`Variation ${v.id}: SKU "${v.sku}" nicht lesbar`); continue; }
    const privat = ENTFALLEN.includes(soll.groesse);
    zeilen.push({ id: v.id, ist, statusIst: v.status, soll, privat });
  }
  const sichtbar = zeilen.filter(z => !z.privat);
  const groessen = GR_REIHE.filter(g => sichtbar.some(z => z.soll.groesse === g));
  const farbenSoll = farben.filter(f => sichtbar.some(z => z.soll.farbe === f));
  // Jede Kombination genau einmal
  const k = sichtbar.map(z => `${z.soll.farbe}|${z.soll.groesse}`);
  if (new Set(k).size !== k.length) probleme.push('doppelte Kombination');
  return {
    zeilen, probleme,
    eltern: {
      attributes: [
        { id: FARBE.id, options: farbenSoll, variation: true, visible: true, position: 0 },
        { id: GROESSE.id, options: groessen, variation: true, visible: true, position: 1 },
      ],
      default_attributes: farbenSoll.length === 1 ? [{ id: FARBE.id, option: farbenSoll[0] }] : [],
    },
    batch: zeilen.map(z => ({ id: z.id,
      attributes: [{ id: FARBE.id, option: z.soll.farbe }, { id: GROESSE.id, option: z.soll.groesse }],
      ...(z.privat && z.statusIst !== 'private' ? { status: 'private' } : {}) })),
  };
}

const pause = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const schreiben = args.includes('--write');
  const nurIdx = args.indexOf('--nur');
  const ids = nurIdx >= 0 ? args[nurIdx + 1].split(',').map(Number) : ARTIKEL;
  const wc = getWcClient('jfn');
  const sicherung = [];
  const plaene = [];
  for (const id of ids) {
    await pause(2000);
    const { data: produkt } = await wc.get(`products/${id}`, { context: 'edit' });
    await pause(2000);
    const variationen = await leseAlleVariationen(wc, id);
    sicherung.push({ produkt, variationen });
    const plan = planeArtikel(produkt, variationen);
    plaene.push({ id, sku: produkt.sku, plan });
    console.log(`\n## ${id} ${produkt.sku} · Eltern Ist: ${produkt.attributes.map(a => `${a.id ? 'global' : 'lokal'} ${a.name}=[${a.options}]`).join(' · ')}`);
    console.log(`   Eltern Soll: global Farbe=[${plan.eltern.attributes[0].options}] · global Größe=[${plan.eltern.attributes[1].options}] · Vorblendung ${JSON.stringify(plan.eltern.default_attributes)}`);
    for (const z of plan.zeilen)
      console.log(`   ${z.id}  Ist: ${z.ist} (${z.statusIst})  ->  Soll: Farbe=${z.soll.farbe}, Größe=${z.soll.groesse}${z.privat ? ' · PRIVAT' : ''}`);
    for (const p of plan.probleme) console.log(`   ⚠ ${p}`);
  }
  const probleme = plaene.flatMap(p => p.plan.probleme);
  console.log(`\nSumme: ${plaene.length} Artikel, ${plaene.reduce((n, p) => n + p.plan.zeilen.filter(z => !z.privat).length, 0)} Variationen zuordnen, `
    + `${plaene.reduce((n, p) => n + p.plan.zeilen.filter(z => z.privat).length, 0)} privat, Probleme ${probleme.length}`);
  if (!schreiben) { console.log('Trockenlauf – nichts geschrieben. Schreiben mit --write (nur nach Freigabe).'); return; }
  if (probleme.length) { console.log('STOPP: Probleme im Plan – nichts geschrieben.'); process.exitCode = 1; return; }

  const ordner = resolve(os.homedir(), 'Documents/mc-sicherungen');
  fs.mkdirSync(ordner, { recursive: true });
  const datei = resolve(ordner, `vb1-variantenbaum-vor-reparatur-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(datei, JSON.stringify(sicherung, null, 1));
  console.log(`Sicherung: ${datei}`);

  for (const { id, sku, plan } of plaene) {
    await pause(2000);
    await wc.put(`products/${id}`, plan.eltern);
    await pause(2000);
    const { data: b } = await wc.post(`products/${id}/variations/batch`, { update: plan.batch });
    const fehler = (b?.update ?? []).filter(u => u?.error);
    await pause(2000);
    const { data: p2 } = await wc.get(`products/${id}`, { context: 'edit' });
    await pause(2000);
    const v2 = await leseAlleVariationen(wc, id);
    const global = p2.attributes.every(a => a.id);
    const heil = v2.filter(v => v.status !== 'private').every(v => v.attributes.length === 2);
    const privat = v2.filter(v => v.status === 'private').length;
    console.log(`${id} ${sku}: Batch-Fehler ${fehler.length} · Attribute global ${global} · sichtbare Variationen heil ${heil} · privat ${privat}`);
    if (fehler.length || !global || !heil) { console.log('STOPP nach diesem Artikel.'); process.exitCode = 1; return; }
  }
  console.log('Fertig. Bitte Kundenseite nach Cache pruefen.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
