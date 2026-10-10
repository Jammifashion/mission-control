// Halloween-Kollektion 2026 anlegen (Auftrag HW2): Kategorie "Halloween" +
// 5 variable Artikel als Entwurf. Logik: backend/lib/anlageHalloween.js.
//
// Verwendung:
//   node backend/scripts/anlage-halloween.js [--csv <pfad>] [--nur <Modell>] [--write]
//
// Standard ist ein TROCKENLAUF: liest SSOT-Reiter und Shop (nur GET, 1 Aufruf
// je 2 s), plant je Artikel Variationen, SKUs, LShop_ArticleNr, Maske- und
// Varianten-Zeilen und zaehlt die Shop-Aufrufe fuer --write. Schreibt nichts.
//
// Preise: backend/scripts/.preise-halloween.json (in .gitignore). Fehlt die
// Datei, legt der Trockenlauf sie mit leeren Werten als Vorlage an. Preise
// stehen nie in der Ausgabe und nie in der CSV.
//
// --write (erst nach Freigabe): legt fehlende Kategorie/Terme an, dann je
// Artikel Produkt (Entwurf) + Variationen in Bloecken <= 50 und schreibt erst
// danach Maske/Varianten. Pruefseite, Zeitlimit oder 502: sofort Stopp mit
// Stand; ein erneuter Lauf ergaenzt nur Fehlendes (SKU + Kombination).
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient, getShopConfig } from '../lib/shopConfig.js';
import { ladeLShopZeilen } from '../lib/lshop.js';
import { heuteBerlin } from '../lib/seo-karte.js';
import {
  ARTIKEL, KATEGORIE, MOTIVE, KURZ, TAKT_MS, AnlageStopp,
  planeArtikel, planeSheets, geplanteAufrufe, preisVorlage, getakteterClient, leseShopStand,
  findeProdukt, legeArtikelAn, schreibeArtikelSheets, haengeZeileAn, standardLieferzeit, kategorieZeile, karteZeile,
} from '../lib/anlageHalloween.js';

const args  = process.argv.slice(2);
const WRITE = args.includes('--write');
const wert  = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const CSV   = wert('--csv');
const NUR   = wert('--nur');
const PREISDATEI = resolve(dirname(fileURLToPath(import.meta.url)), '.preise-halloween.json');
const TABS = ['Erfassungsmaske', 'Varianten', 'Motive', 'Struktur_Kategorien', 'SEO_Karte', 'Struktur_Lieferzeiten'];

const esc = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const log = (...a) => console.log(...a);

function lesePreise() {
  if (!existsSync(PREISDATEI)) return null;
  try { return JSON.parse(readFileSync(PREISDATEI, 'utf8')); }
  catch (e) { throw new Error(`Preisdatei nicht lesbar (${e.message}).`); }
}

async function run() {
  const t0 = Date.now();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: TABS.map(x => `'${x}'`), valueRenderOption: 'FORMATTED_VALUE' });
  const reiter = Object.fromEntries(TABS.map((x, i) => [x, data.valueRanges[i]?.values ?? []]));
  const lshopZeilen = await ladeLShopZeilen({ sheets, spreadsheetId });
  const lieferzeit = standardLieferzeit(reiter.Struktur_Lieferzeiten);

  const wc = getakteterClient(getWcClient('jfn'));
  const shop = await leseShopStand(wc, { markenSlug: getShopConfig('jfn').markenSlug });

  let preise = lesePreise();
  const artikelListe = ARTIKEL.filter(a => !NUR || a.modell === NUR);
  let plaene = artikelListe.map(artikel => planeArtikel({ artikel, lshopZeilen, groessenTerme: shop.groessenTerme, preise }));
  if (!preise) {
    writeFileSync(PREISDATEI, JSON.stringify(preisVorlage(plaene), null, 2) + '\n');
    log(`Preisdatei fehlte – Vorlage mit leeren Werten angelegt: ${PREISDATEI}`);
    preise = lesePreise();
    plaene = artikelListe.map(artikel => planeArtikel({ artikel, lshopZeilen, groessenTerme: shop.groessenTerme, preise }));
  }

  // Vorhandene Produkte (Fortsetzen): nur GET ueber die SKU.
  for (const p of plaene.filter(x => x.status === 'bereit')) p.imShop = await findeProdukt(wc, p.artikelnummer);

  const heute = heuteBerlin();
  const sp = planeSheets(reiter, plaene, { kategorieId: shop.kategorie?.id ?? '', heute });
  const neueFarbTerme = [...new Set(plaene.filter(p => p.status === 'bereit' && !shop.farbTerme.some(f => f.toLowerCase() === p.farbe.toLowerCase())).map(p => p.farbe))];
  const neueGroessen = [...new Set(plaene.flatMap(p => p.groessen.filter(g => g.neuTerm).map(g => g.shop)))];
  const aufrufe = geplanteAufrufe(plaene, { kategorieFehlt: !shop.kategorie, neueTerme: neueFarbTerme.length + neueGroessen.length });

  // ── Ausgabe (ohne Preise) ──
  log(`\n${WRITE ? 'SCHREIBLAUF' : 'TROCKENLAUF'} Halloween – ${heute}`);
  log(`Zaehler: SSOT zuletzt ${sp.zaehler.ssotZuletzt}, Maske Z${sp.zaehler.maskeZuletzt}, Varianten Z${sp.zaehler.variantenZuletzt}, Motive Z${sp.zaehler.motiveZuletzt}, Struktur_Kategorien Z${sp.zaehler.kategorienZuletzt}, SEO_Karte Z${sp.zaehler.karteZuletzt}`);
  log(`Shop: Attribute Farbe=${shop.attrIds.farbe}, Größe=${shop.attrIds.groesse} (global, mit id); Motiv lokal (globales "Motiv": ${shop.motivGlobal ? `JA, id ${shop.motivGlobal}` : 'nein'})`);
  log(`Kategorie "${KATEGORIE.name}": ${shop.kategorie ? `vorhanden (id ${shop.kategorie.id})` : 'fehlt – wird mit --write angelegt (parent 0)'}`);
  log(`Marke: ${shop.marke ? shop.marke.name : 'FEHLT'} · Lieferzeit Standard: ${lieferzeit.name} (${lieferzeit.id}), Variationen "-1"`);
  log(`Farbterme neu: ${neueFarbTerme.join(', ') || '–'} · Größen-Terme neu: ${neueGroessen.join(', ') || '–'}`);
  log(`Motive Z${sp.motive.zeile ?? '-'} ${sp.motive.vorhanden ? '(vorhanden)' : `"${KURZ}"`} · Struktur_Kategorien ${sp.kategorie.vorhanden ? 'vorhanden' : `Z${sp.kategorie.zeile}`} · SEO_Karte ${sp.karte.vorhanden ? 'vorhanden' : `Z${sp.karte.zeile}`}`);

  const csv = [['Artikel', 'Status', 'SSOT-ID (geplant)', 'Maske-Zeile', 'Varianten-Zeile', 'Artikelnummer', 'Versandklasse',
    'Achsen', 'Nr', 'Variations-SKU', 'SKU-Laenge', 'Farbe', 'Größe (Shop)', 'Größe (L-Shop)', 'Motiv', 'LShop_ArticleNr', 'Preis vorhanden', 'Hinweis']];
  for (const a of sp.artikel) {
    const p = a.plan;
    const ohnePreis = p.varianten.filter(v => !v.preis).length;
    const versandOk = shop.versandklassen.includes(p.artikel.versand);
    log(`\n[${p.artikel.modell}] ${p.artikel.titel} – ${p.status}`);
    if (p.status === 'bereit') {
      log(`  Artikelnummer ${p.artikelnummer} · Farbe ${p.farbe} · ${p.groessen.length} Größen × ${MOTIVE.length} Motive = ${p.varianten.length} Variationen · Versand ${p.artikel.versand}${versandOk ? '' : ' (FEHLT im Shop)'}`);
      log(`  Größen/ArticleNr: ${p.groessen.map(g => `${g.shop}${g.shop !== g.lshop ? `(${g.lshop})` : ''}=${g.articleNr}`).join(' ')}`);
      log(`  SKU längste: ${Math.max(...p.varianten.map(v => v.sku.length))} Zeichen · Preise fehlen: ${ohnePreis}`);
      log(`  Sheets: ${a.vorhanden ? `Maske vorhanden (${a.ssot}, Z${a.maskeZeile})` : `SSOT ${a.ssot}, Maske Z${a.maskeZeile}, Varianten Z${a.variantenVon}–Z${a.variantenBis}`}`);
      log(`  Shop: ${p.imShop ? `Produkt ${p.imShop.id} schon da (${p.imShop.status}) – nur Fehlendes` : 'neu'} · Aufrufe --write: ${aufrufe.jeArtikel[plaene.filter(x => x.status === 'bereit').indexOf(p)]}`);
    }
    for (const h of p.hinweise) log(`  Hinweis: ${h}`);
    if (p.status !== 'bereit') { csv.push([p.artikel.titel, p.status, '', '', '', p.artikelnummer, p.artikel.versand, '', '', '', '', '', '', '', '', '', '', p.hinweise.join(' | ')]); continue; }
    p.varianten.forEach((v, j) => csv.push([p.artikel.titel, p.status, a.ssot, a.maskeZeile, a.variantenVon ? a.variantenVon + j : '', p.artikelnummer, p.artikel.versand,
      'Farbe (global) / Größe (global) / Motiv (lokal)', j + 1, v.sku, v.sku.length, v.farbe, v.groesse, v.lshopGroesse, v.motiv, v.articleNr, v.preis ? 'ja' : 'nein', '']));
  }
  log(`\nShop-Aufrufe fuer --write: ${aufrufe.summe} (2-s-Takt: ca. ${Math.ceil(aufrufe.sekunden / 60)} min)`);
  log(`Shop-Aufrufe dieses Laufs: ${wc.zaehler.get} GET, ${wc.zaehler.post} POST · ${Math.round((Date.now() - t0) / 1000)} s`);

  if (CSV) {
    writeFileSync(CSV, '﻿' + csv.map(r => r.map(esc).join(';')).join('\r\n') + '\r\n');
    log(`CSV: ${csv.length - 1} Zeilen -> ${CSV}`);
  }

  if (!WRITE) { log('TROCKENLAUF – nichts geschrieben. Schreiben mit --write (erst nach Freigabe).'); return; }

  // ── Schreiblauf ──
  const bereit = plaene.filter(p => p.status === 'bereit');
  const ohnePreis = bereit.filter(p => p.varianten.some(v => !v.preis));
  if (ohnePreis.length) throw new Error(`Preise fehlen (${ohnePreis.map(p => p.artikel.modell).join(', ')}) – nichts geschrieben.`);
  const ohneVersand = bereit.filter(p => !shop.versandklassen.includes(p.artikel.versand));
  if (ohneVersand.length) throw new Error(`Versandklasse fehlt im Shop (${ohneVersand.map(p => p.artikel.versand).join(', ')}) – nichts geschrieben.`);
  if (!shop.marke) throw new Error('Marke fehlt im Shop – nichts geschrieben.');

  try {
    let kategorieId = shop.kategorie?.id;
    if (!kategorieId) {
      const { data: k } = await wc.post('products/categories', { name: KATEGORIE.name, slug: KATEGORIE.slug, parent: KATEGORIE.parent });
      kategorieId = k?.id;
      if (!kategorieId) throw new Error('Kategorie: keine ID zurück.');
      log(`Kategorie angelegt: ${kategorieId}`);
    }
    for (const name of neueFarbTerme) { await wc.post(`products/attributes/${shop.attrIds.farbe}/terms`, { name }); log(`Farbterm angelegt: ${name}`); }
    for (const name of neueGroessen) { await wc.post(`products/attributes/${shop.attrIds.groesse}/terms`, { name }); log(`Größen-Term angelegt: ${name}`); }

    if (!sp.kategorie.vorhanden) await haengeZeileAn(sheets, spreadsheetId, 'Struktur_Kategorien', kategorieZeile(reiter.Struktur_Kategorien[0], kategorieId));
    if (!sp.karte.vorhanden) await haengeZeileAn(sheets, spreadsheetId, 'SEO_Karte', karteZeile(reiter.SEO_Karte[0], kategorieId, heute));
    if (!sp.motive.vorhanden) await haengeZeileAn(sheets, spreadsheetId, 'Motive', sp.motive.werte);

    const kontext = { kategorieId, attrIds: shop.attrIds, markeId: shop.marke.id, lieferzeit: lieferzeit.id };
    for (const p of bereit) {
      log(`\n[${p.artikel.modell}] ${p.artikel.titel}`);
      const r = await legeArtikelAn(wc, p, kontext, { log });
      if (r.fehler.length || r.fehlend) {
        log(`  UNVOLLSTÄNDIG: ${r.fehlend} Kombinationen fehlen, ${r.fehler.length} Fehler – Sheets nicht geschrieben, Lauf hält an.`);
        r.fehler.slice(0, 10).forEach(f => log(`    ${f}`));
        process.exitCode = 2;
        return;
      }
      const s = await schreibeArtikelSheets(sheets, spreadsheetId, p, { produktId: r.produktId, marke: shop.marke.name, wcIds: r.wcIds });
      log(`  Produkt ${r.produktId}: ${r.angelegt} angelegt, ${r.vorhanden} vorhanden · ${s.ssot}: Maske ${s.maskeNeu ? 'neu' : 'vorhanden'}, Varianten ${s.variantenNeu}${s.hinweis ? ` · ${s.hinweis}` : ''}`);
    }
  } catch (err) {
    if (err instanceof AnlageStopp) {
      log(`\nSTOPP: ${err.message}`);
      log(`Stand: ${JSON.stringify(err.stand)}`);
      log('Fortsetzen: denselben Befehl erneut ausführen – vorhandenes Produkt und Variationen werden über SKU/Kombination erkannt.');
      process.exitCode = 3;
      return;
    }
    throw err;
  } finally {
    log(`Shop-Aufrufe: ${wc.zaehler.get} GET, ${wc.zaehler.post} POST, Takt ${TAKT_MS / 1000} s`);
  }
}

run().catch(err => { console.error(err?.message ?? err); if (err?.stand) console.error(`Stand: ${JSON.stringify(err.stand)}`); process.exit(1); });
