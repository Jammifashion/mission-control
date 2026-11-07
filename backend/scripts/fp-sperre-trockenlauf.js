// PA8: Trockenlauf gegen echt - NUR LESEN, nur Anzahlen und Produkt-IDs (nie Preise).
//
//   node backend/scripts/fp-sperre-trockenlauf.js            Sheet: gesperrte Zeilen, Nachrechnen-Kandidaten, FP_Artikel ohne
//                                                            gueltige Festpreis-Zuordnung (wuerden beim Verkauf gesperrt)
//   node backend/scripts/fp-sperre-trockenlauf.js --shop     zusaetzlich der taegliche Abgleich: welche FP_Artikel-Zeilen er
//                                                            OHNE Kategorie anlegen wuerde (Shop-Abrufe im 1,5-s-Takt, nichts geschrieben)

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { nachrechnenInSperre, leseGesperrte } from '../lib/fpSperre.js';
import { fpArtikelPruefung } from '../lib/fpArtikel.js';
import { fpAnlagePlan } from '../utils/fp-artikel.js';
import { festpreisZuordnungen, zuordnungFuer } from '../utils/fp-sperre.js';

const SHEET = process.env.BUSINESS_SHEET_ID;
const SHOP = process.argv.includes('--shop');
const t = v => String(v ?? '').trim();

async function main() {
  if (!SHEET) throw new Error('BUSINESS_SHEET_ID fehlt.');
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const lies = async tab => { const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET, range: `'${tab}'` }); const [k = [], ...z] = data.values ?? []; return { k: k.map(t), z }; };

  const v = await lies('FP_Verkäufe');
  console.log(`FP_Verkäufe: ${v.z.length} Zeilen, ${v.k.length} Spalten, Spalte Sperre ${v.k.includes('Sperre') ? 'da' : 'fehlt (legt der Sync beim ersten gesperrten Verkauf als X an)'}`);
  const g = await leseGesperrte({ sheets, spreadsheetId: SHEET });
  console.log(`gesperrt heute: ${g.anzahl}${g.jePartner.map(p => ` · ${p.partnerId}: ${p.anzahl} (IDs ${p.produktIds.join(', ')})`).join('')}`);
  const n = await nachrechnenInSperre({ sheets, spreadsheetId: SHEET, dryRun: true });
  console.log(`Nachrechnen (Trockenlauf): ${n.nachgerechnet} würden offen, ${n.nochGesperrt} blieben gesperrt`);

  const art = await lies('FP_Artikel'), ak = await lies('FP_Artikel_Kategorie'), pa = await lies('FP_Partner');
  const aktiv = new Set(pa.z.filter(r => t(r[pa.k.indexOf('Aktiv')]).toLowerCase() === 'ja').map(r => t(r[pa.k.indexOf('Partner-ID')])));
  const zu = festpreisZuordnungen(ak.k, ak.z);
  const ohne = art.z.filter(r => aktiv.has(t(r[art.k.indexOf('Partner-ID')])) && !zuordnungFuer(zu, r[art.k.indexOf('Partner-ID')], r[art.k.indexOf('Artikelkategorie')]));
  console.log(`FP_Artikel aktiver Partner ohne gültige Festpreis-Zuordnung (Verkauf würde gesperrt): ${ohne.length}${ohne.length ? ` (IDs ${ohne.map(r => t(r[art.k.indexOf('Produkt-ID')])).join(', ')})` : ''}`);

  if (SHOP) {
    const start = Date.now();
    const fp = await fpArtikelPruefung({ sheets, sheetId: SHEET });
    const plan = fpAnlagePlan(art.k, art.z, fp.partner);
    console.log(`Abgleich: ${fp.summen.partner} FP-Partner, ${fp.abrufe} Shop-Abrufe in ${Math.round((Date.now() - start) / 1000)} s`);
    console.log(`würde anlegen (ohne Artikelkategorie, ohne Festpreis): ${plan.neu.length}${plan.neu.length ? ` (${plan.neu.map(x => `${x.partnerId}:${x.produktId}`).join(', ')})` : ''}`);
  }
  console.log('Trockenlauf - nichts geschrieben.');
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
