// Auftrag VB2 (Inhaber 08.11.2026): SC-Team-Artikel - je Farbe und Groesse eine Variation
// "mit Namen = Ja" und eine "mit Namen = Nein" (bisher stand "mit Namen" auf "Beliebig").
//
// Je bestehender Variation (Farbe + Groesse, "mit Namen" leer):
//  - die bestehende bekommt "mit Namen = Nein" (SKU, Preis, Google-Daten bleiben),
//  - eine neue "mit Namen = Ja": SKU = alte SKU + "-ja", gleicher Preis (heute galt EIN Preis fuer
//    beide Antworten), gleiche Versandklasse/Steuer, Lieferzeit "-1" (wie Eltern), _wc_gla_color = Farbe.
// Nur wenn der Elternartikel "mit Namen" global, variierend, Optionen genau Ja/Nein hat und keine
// Variation schon einen Wert dafuer hat. Geloescht wird nichts.
// Trockenlauf Standard; --write: Sicherung, je Artikel EIN Batch (update + create), Takt 2 s, zuruecklesen.
//   node scripts/sc-team-mit-namen.js [--ids 13484,…] [--write]

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';
import os from 'os';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });

export const ARTIKEL = [13735, 13589, 13687, 13616, 13646, 13631, 13595, 13484];
const norm = s => String(s ?? '').trim().toLowerCase();

/** Plan je Artikel (reine Logik). */
export function planeMitNamen(produkt, variationen) {
  const probleme = [];
  const mn = (produkt.attributes ?? []).find(a => norm(a.name) === 'mit namen');
  if (!mn || !mn.id || !mn.variation) probleme.push('"mit Namen" fehlt, ist lokal oder nicht variierend');
  const ja = mn?.options.find(o => norm(o) === 'ja'), nein = mn?.options.find(o => norm(o) === 'nein');
  if (!ja || !nein || mn.options.length !== 2) probleme.push('Optionen von "mit Namen" sind nicht genau Ja/Nein');
  const farbe = (produkt.attributes ?? []).find(a => norm(a.name) === 'farbe');
  const sichtbar = variationen.filter(v => v.status !== 'private');
  const skus = new Set(variationen.map(v => norm(v.sku)));
  const update = [], create = [];
  let order = Math.max(0, ...variationen.map(v => v.menu_order ?? 0));
  for (const v of sichtbar) {
    if (v.attributes.some(a => norm(a.name) === 'mit namen' && norm(a.option))) { probleme.push(`Variation ${v.id} hat schon einen Wert für "mit Namen"`); continue; }
    const basis = v.attributes.filter(a => norm(a.name) !== 'mit namen').map(a => ({ id: a.id, option: a.option }));
    if (basis.length !== (produkt.attributes ?? []).filter(a => a.variation).length - 1) { probleme.push(`Variation ${v.id}: Farbe/Größe unvollständig`); continue; }
    const neuSku = `${v.sku}-ja`;
    if (skus.has(norm(neuSku))) { probleme.push(`SKU ${neuSku} gibt es schon`); continue; }
    const farbWert = farbe ? v.attributes.find(a => a.id === farbe.id || norm(a.name) === 'farbe')?.option : null;
    update.push({ id: v.id, attributes: [...basis, { id: mn.id, option: nein }] });
    create.push({
      sku: neuSku, status: 'publish', menu_order: ++order,
      regular_price: v.regular_price, tax_class: v.tax_class, tax_status: v.tax_status, shipping_class: v.shipping_class,
      attributes: [...basis, { id: mn.id, option: ja }],
      meta_data: [{ key: '_lieferzeit', value: '-1' }, ...(farbWert ? [{ key: '_wc_gla_color', value: farbWert }] : [])],
    });
  }
  return { update, create, probleme };
}

const pause = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const { getWcClient } = await import('../lib/shopConfig.js');
  const { leseAlleVariationen } = await import('../lib/wc-variation-ids.js');
  const args = process.argv.slice(2);
  const i = args.indexOf('--ids');
  const ids = i >= 0 ? args[i + 1].split(',').map(Number) : ARTIKEL;
  const schreiben = args.includes('--write');
  const wc = getWcClient('jfn');
  const plaene = [], sicherung = [];
  for (const id of ids) {
    await pause(2000);
    const { data: produkt } = await wc.get(`products/${id}`, { context: 'edit' });
    await pause(2000);
    const variationen = await leseAlleVariationen(wc, id);
    sicherung.push({ produkt, variationen });
    const p = planeMitNamen(produkt, variationen);
    plaene.push({ id, sku: produkt.sku, p });
    console.log(`\n## ${id} ${produkt.sku}: ${p.update.length} → Nein, ${p.create.length} neu mit Ja${p.probleme.length ? ' · ⚠ ' + p.probleme.join(' · ') : ''}`);
    for (const c of p.create) console.log(`   neu ${c.sku}  ${c.attributes.map(a => a.option).join(' / ')}`);
  }
  const probleme = plaene.flatMap(x => x.p.probleme);
  console.log(`\nSumme: ${plaene.length} Artikel · ${plaene.reduce((n, x) => n + x.p.update.length, 0)} bestehende → Nein · `
    + `${plaene.reduce((n, x) => n + x.p.create.length, 0)} neue mit Ja · Probleme ${probleme.length}`);
  if (!schreiben) { console.log('Trockenlauf – nichts geschrieben.'); return; }
  if (probleme.length) { console.log('STOPP: Probleme – nichts geschrieben.'); process.exitCode = 1; return; }
  const ordner = resolve(os.homedir(), 'Documents/mc-sicherungen');
  fs.mkdirSync(ordner, { recursive: true });
  const datei = resolve(ordner, `vb2-sc-team-vor-mit-namen-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(datei, JSON.stringify(sicherung, null, 1));
  console.log(`Sicherung: ${datei}`);
  for (const { id, sku, p } of plaene) {
    await pause(2000);
    const { data: b } = await wc.post(`products/${id}/variations/batch`, { update: p.update, create: p.create });
    const fehler = [...(b?.update ?? []), ...(b?.create ?? [])].filter(x => x?.error || !x?.id);
    await pause(2000);
    const v2 = (await leseAlleVariationen(wc, id)).filter(v => v.status !== 'private');
    const vollst = v2.every(v => v.attributes.length === 3 && v.attributes.every(a => norm(a.option)));
    const kombis = new Set(v2.map(v => v.attributes.map(a => norm(a.option)).join('|')));
    console.log(`${id} ${sku}: Fehler ${fehler.length} · Variationen ${v2.length} · alle mit 3 Werten ${vollst} · Kombinationen eindeutig ${kombis.size === v2.length}`);
    if (fehler.length || !vollst || kombis.size !== v2.length) { console.log('STOPP nach diesem Artikel.'); process.exitCode = 1; return; }
  }
  console.log('Fertig. Bitte Kundenseite nach Cache pruefen.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
