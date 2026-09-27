// WC_Variation_ID im Reiter Varianten fuer den Bestand nachtragen (Befehl VR2, Teil B).
//
// Verwendung:
//   node backend/scripts/fill-wc-variation-ids.js [--ssot JFN-2026-0131] [--csv <pfad>] [--write]
//
// Standard ist ein TROCKENLAUF: liest Varianten, Erfassungsmaske (SSOT-ID ->
// Produkt-ID) und je SSOT-ID die Shop-Variationen (nur GET, 1 Anfrage/Sek.),
// ordnet ueber die Attributkombination zu (lib/wc-variation-ids.js) und zaehlt
// zuordenbar / schon gefuellt / ohne Treffer / mehrdeutig / Konflikt.
// Erst --write schreibt - und dann NUR die leeren Zellen WC_Variation_ID der
// eindeutig zugeordneten Zeilen (vorher neu gelesen und geprueft).
// --csv schreibt die Details je Shop-Variation (keine Preise).
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient } from '../lib/shopConfig.js';
import { planeNachtrag, schreibeNachtrag, nachtragZaehler } from '../lib/wc-variation-ids.js';

const args  = process.argv.slice(2);
const WRITE = args.includes('--write');
const wert  = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const SSOT  = wert('--ssot');
const CSV   = wert('--csv');

let letzte = 0;
async function drossel() {
  const warte = letzte + 1050 - Date.now();
  if (warte > 0) await new Promise(r => setTimeout(r, warte));
  letzte = Date.now();
}

const esc = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function run() {
  const t0 = Date.now();
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { plaene, anfragen } = await planeNachtrag({ sheets, wc: getWcClient('jfn'), nurSsot: SSOT, drossel });
  const zaehler = plaene.map(nachtragZaehler);
  const summe = {};
  for (const z of zaehler) for (const k of ['zeilen', 'zuordenbar', 'schonGefuellt', 'ohneTreffer', 'mehrdeutig', 'konflikt', 'leerVorher', 'leerDanach'])
    summe[k] = (summe[k] ?? 0) + (Number(z[k]) || 0);
  summe.ssotIds = zaehler.length;
  summe.ohneProduktId = zaehler.filter(z => z.fehlt === 'ohne Produkt-ID').length;
  summe.shopNichtLesbar = zaehler.filter(z => z.fehlt.startsWith('Shop nicht lesbar')).length;

  for (const z of zaehler) {
    if (z.fehlt) { console.log(`${z.ssot}: ${z.fehlt}`); continue; }
    if (z.zuordenbar || z.ohneTreffer || z.mehrdeutig || z.konflikt)
      console.log(`${z.ssot} (${z.pid}): zuordenbar ${z.zuordenbar}, schon gefuellt ${z.schonGefuellt}, ohne Treffer ${z.ohneTreffer}, mehrdeutig ${z.mehrdeutig}, Konflikt ${z.konflikt}`);
  }
  console.log(`Summe: ${JSON.stringify(summe)} · WC-Anfragen ${anfragen} · ${Math.round((Date.now() - t0) / 1000)} s`);

  if (CSV) {
    const kopf = ['SSOT-ID', 'Produkt-ID', 'Variation-ID', 'Kombination', 'Ergebnis', 'Sheet-Zeile', 'WC_Variation_ID im Sheet'];
    const zeilen = [];
    for (const p of plaene) {
      if (p.fehlt) { zeilen.push([p.ssot, p.pid, '', '', p.fehlt, '', '']); continue; }
      for (const d of p.r.details) {
        const z = d.index !== undefined ? p.zeilen[d.index] : null;
        zeilen.push([p.ssot, p.pid, d.id, d.kombination ?? '', d.ergebnis, z?.sheetZeile ?? '', d.alt ?? z?.wcVariationId ?? '']);
      }
      // Sheet-Zeilen, zu denen keine Shop-Variation passt (bleiben leer).
      const getroffen = new Set(p.r.details.filter(d => d.index !== undefined).map(d => d.index));
      p.zeilen.forEach((z, i) => {
        if (!getroffen.has(i)) zeilen.push([p.ssot, p.pid, '', z.paare.filter(([e]) => String(e ?? '').trim()).map(([e, v]) => `${e}=${v}`).join(', '),
          'Sheet-Zeile ohne Shop-Variation', z.sheetZeile, z.wcVariationId]);
      });
    }
    writeFileSync(CSV, '﻿' + [kopf, ...zeilen].map(r => r.map(esc).join(';')).join('\r\n') + '\r\n');
    console.log(`CSV: ${zeilen.length} Zeilen -> ${CSV}`);
  }

  if (!WRITE) { console.log('TROCKENLAUF - nichts geschrieben. Schreiben mit --write.'); return; }
  const w = await schreibeNachtrag({ sheets, plaene });
  console.log(`Geschrieben: ${w.geschrieben} Zellen WC_Variation_ID. Uebersprungen: ${w.uebersprungen.length}`);
  for (const u of w.uebersprungen) console.log(`  ${u}`);
}

run().catch(err => { console.error(err?.message ?? err); process.exit(1); });
