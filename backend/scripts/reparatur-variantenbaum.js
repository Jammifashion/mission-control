// Auftrag VB2: kaputte Variantenbaeume reparieren (Verallgemeinerung von reparatur-vb1.js).
// Logik: utils/variantenbaum-reparatur.js (planeReparatur). Geloescht wird nie, privat gestellt auch nicht.
//
// Trockenlauf Standard (nur lesen): je Artikel Eltern Ist -> Soll, je Variation Ist -> Soll mit Quelle
// (heute | Reiter Varianten | SKU), "unklar" und fehlende Terme = nicht automatisch (nur Liste).
// --write: nur Artikel, die vollstaendig automatisch gehen; Sicherung nach Documents/mc-sicherungen,
// Produkt-PUT + Variations-Batch (<= 50) im 2-s-Takt, zuruecklesen, bei Abweichung Stopp.
//   node scripts/reparatur-variantenbaum.js --ids 15772[,…] [--shop jfn|honk] [--vorblenden] [--write]
// --vorblenden: Artikel mit genau einer Farbe ohne Vorblendung bekommen diese Farbe vorgeblendet.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';
import os from 'os';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });

const { getWcClient } = await import('../lib/shopConfig.js');
const { leseAlleVariationen } = await import('../lib/wc-variation-ids.js');
const { planeReparatur } = await import('../utils/variantenbaum-reparatur.js');

const pause = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s ?? '').trim().toLowerCase();

async function leseGlobale(wc) {
  const { data: attrs } = await wc.get('products/attributes');
  const m = new Map();
  for (const a of attrs) {
    const terme = new Map();
    for (let pg = 1; ; pg++) {
      await pause(2000);
      const { data } = await wc.get(`products/attributes/${a.id}/terms`, { per_page: 100, page: pg, _fields: 'name' });
      if (!Array.isArray(data)) throw new Error('keine Liste (Pruefseite?)');
      for (const t of data) terme.set(norm(t.name), t.name);
      if (data.length < 100) break;
    }
    m.set(norm(a.name), { id: a.id, name: a.name, terme });
  }
  return m;
}

async function leseReiter() {
  try {
    const { google } = await import('googleapis');
    const { getGoogleAuth } = await import('../lib/googleAuth.js');
    const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Varianten!A1:Z' });
    const [kopf, ...zeilen] = data.values ?? [];
    const i = n => kopf.indexOf(n);
    const m = new Map();
    for (const z of zeilen) {
      const id = String(z[i('WC_Variation_ID')] ?? '').trim();
      if (!id) continue;
      const w = {};
      for (const k of [1, 2, 3]) { const e = z[i(`E${k}`)], v = z[i(`V${k}`)]; if (e && v) w[e] = v; }
      m.set(id, w);
    }
    return { reiter: m, hinweis: null };
  } catch (e) { return { reiter: new Map(), hinweis: `Reiter Varianten nicht lesbar (${e.message}) – nur heute/SKU.` }; }
}

async function main() {
  const args = process.argv.slice(2);
  const wert = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const shop = wert('--shop') || 'jfn';
  const ids = (wert('--ids') || '').split(',').map(Number).filter(Boolean);
  const schreiben = args.includes('--write');
  if (!ids.length) { console.log('--ids fehlt'); process.exitCode = 1; return; }
  const wc = getWcClient(shop);
  const globale = await leseGlobale(wc);
  const { reiter, hinweis } = shop === 'jfn' ? await leseReiter() : { reiter: new Map(), hinweis: 'HONK: kein Reiter Varianten.' };
  if (hinweis) console.log(hinweis);

  const plaene = [], sicherung = [];
  for (const id of ids) {
    await pause(2000);
    const { data: produkt } = await wc.get(`products/${id}`, { context: 'edit' });
    await pause(2000);
    const variationen = await leseAlleVariationen(wc, id);
    sicherung.push({ produkt, variationen });
    const p = planeReparatur(produkt, variationen, globale, reiter);
    // --vorblenden: genau eine Farbe und keine Vorblendung -> diese Farbe vorblenden (Regel Inhaber 12.10.).
    if (args.includes('--vorblenden') && !p.default_attributes.length) {
      const i = p.ziel.findIndex(z => norm(z.name) === 'farbe');
      if (i >= 0 && p.optionen[i].length === 1) {
        p.default_attributes = [{ ...(p.ziel[i].id ? { id: p.ziel[i].id } : { name: p.ziel[i].name }), option: p.optionen[i][0] }];
        p.elternAendern = true;
      }
    }
    plaene.push({ id, sku: produkt.sku, p });
    const art = a => `${a.id ? 'global' : 'lokal'} ${a.name}=[${a.options}]`;
    console.log(`\n## ${id} ${produkt.sku} (${produkt.status}) · ${p.automatisch ? 'automatisch' : 'NICHT automatisch'}`);
    console.log(`   Eltern Ist:  ${produkt.attributes.filter(a => a.variation).map(art).join(' · ')} · Vorblendung ${JSON.stringify(produkt.default_attributes)}`);
    console.log(`   Eltern Soll: ${p.ziel.map((z, i) => `${z.global ? 'global' : 'lokal'} ${z.name}=[${p.optionen[i]}]`).join(' · ')} · Vorblendung ${JSON.stringify(p.default_attributes)}`);
    for (const z of p.zeilen)
      console.log(`   ${z.id} (${z.status})  Ist: ${z.ist}  ->  Soll: ${p.ziel.map((x, i) => `${x.name}=${z.werte[i]}`).join(', ')}  [${z.quelle}]${z.geaendert ? '' : ' unverändert'}`);
    for (const u of p.unklar) console.log(`   ⚠ unklar ${u.id} (${u.status}) SKU ${u.sku} · Ist ${u.ist}`);
    for (const t of p.fehlendeTerme) console.log(`   ⚠ globaler Term fehlt: ${t}`);
  }
  const auto = plaene.filter(x => x.p.automatisch && (x.p.batch.length || x.p.elternAendern));
  console.log(`\nSumme: ${plaene.length} Artikel · automatisch ${auto.length} · nicht automatisch ${plaene.filter(x => !x.p.automatisch).length} · `
    + `Variationen zu schreiben ${auto.reduce((n, x) => n + x.p.batch.length, 0)} · unklar ${plaene.reduce((n, x) => n + x.p.unklar.length, 0)}`);
  if (!schreiben) { console.log('Trockenlauf – nichts geschrieben.'); return; }

  const ordner = resolve(os.homedir(), 'Documents/mc-sicherungen');
  fs.mkdirSync(ordner, { recursive: true });
  const datei = resolve(ordner, `vb2-variantenbaum-vor-reparatur-${shop}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(datei, JSON.stringify(sicherung, null, 1));
  console.log(`Sicherung: ${datei}`);
  for (const { id, sku, p } of auto) {
    await pause(2000);
    await wc.put(`products/${id}`, { attributes: p.attributes, default_attributes: p.default_attributes });
    for (let i = 0; i < p.batch.length; i += 50) {
      await pause(2000);
      const { data: b } = await wc.post(`products/${id}/variations/batch`, { update: p.batch.slice(i, i + 50) });
      const f = (b?.update ?? []).filter(u => u?.error);
      if (f.length) { console.log(`STOPP ${id}: Batch-Fehler ${f.map(x => x.id).join(',')}`); process.exitCode = 1; return; }
    }
    await pause(2000);
    const { data: p2 } = await wc.get(`products/${id}`, { context: 'edit' });
    await pause(2000);
    const v2 = await leseAlleVariationen(wc, id);
    const varAttr = p2.attributes.filter(a => a.variation);
    const global = p.ziel.every((z, i) => !z.global || varAttr[i]?.id);
    const heil = v2.filter(v => v.status !== 'private').every(v => v.attributes.length === varAttr.length
      && v.attributes.every(a => varAttr.find(x => x.id === a.id && x.name === a.name)?.options.some(o => norm(o) === norm(a.option))));
    console.log(`${id} ${sku}: global ${global} · sichtbare Variationen heil ${heil}`);
    if (!global || !heil) { console.log('STOPP nach diesem Artikel.'); process.exitCode = 1; return; }
  }
  console.log('Fertig. Bitte Kundenseite nach Cache pruefen.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
