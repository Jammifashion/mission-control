// Halloween-Kollektion 2026 anlegen (Auftraege HW2/HW3): Kategorie "Halloween"
// + 4 variable Artikel als Entwurf. Logik: backend/lib/anlageHalloween.js.
//
// Verwendung:
//   node backend/scripts/anlage-halloween.js --bilder <ordner> [--kollektion halloween|ch-halloween] [--csv <pfad>] [--nur <Modell>] [--write | --pruefen]
//
// --kollektion (HW4): halloween (Standard, 8 Motive, Sammelbild) oder ch-halloween
// (Crocodiles Hamburg Kinder, ohne Motiv-Achse, ein Bild je Artikel aus <ordner>,
// feste Kategorien, FP_Artikel-Zeile fuer den Festpreis-Partner).
//
// --bilder: Ordner mit mockups/ (32 Mockups, Namen vom Inhaber) und den lokal
// gebauten sammelbild-<Modell>.jpg. Fuer --write Pflicht.
// --pruefen: nur lesen - die angelegten Entwuerfe zuruecklesen und pruefen.
// Uploads (Medien-IDs je Dateiname) stehen in scripts/.halloween-medien.json
// (gitignored); ein erneuter Lauf laedt nichts doppelt.
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
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient, getShopConfig } from '../lib/shopConfig.js';
import { ladeLShopZeilen } from '../lib/lshop.js';
import { heuteBerlin } from '../lib/seo-karte.js';
import { ladeMedienHoch, setzeMedienText, medienTitel } from '../lib/wpMedien.js';
import { leseAlleVariationen } from '../lib/wc-variation-ids.js';
import { lieferzeitAusMetaData } from '../lib/lieferzeiten.js';
import {
  KOLLEKTIONEN, MOTIVE, TAKT_MS, AnlageStopp, istStoppFehler, fpArtikelZeile,
  ordneMockups, bildListe, bilderAusZustand, ladeBilderHoch, sammelbildDatei, galerie,
  planeArtikel, planeSheets, geplanteAufrufe, preisVorlage, getakteterClient, leseShopStand,
  findeProdukt, legeArtikelAn, schreibeArtikelSheets, haengeZeileAn, standardLieferzeit, kategorieZeile, karteZeile,
} from '../lib/anlageHalloween.js';

const args  = process.argv.slice(2);
const WRITE = args.includes('--write');
const wert  = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const CSV   = wert('--csv');
const NUR   = wert('--nur');
const BILDER = wert('--bilder');
const K = KOLLEKTIONEN[wert('--kollektion') ?? 'halloween'];
if (!K) throw new Error(`Unbekannte Kollektion "${wert('--kollektion')}" (${Object.keys(KOLLEKTIONEN).join(', ')}).`);
const PRUEFEN = args.includes('--pruefen');
const PREISDATEI = resolve(dirname(fileURLToPath(import.meta.url)), '.preise-halloween.json');
const MEDIENDATEI = resolve(dirname(fileURLToPath(import.meta.url)), '.halloween-medien.json');
const leseMedien = () => (existsSync(MEDIENDATEI) ? JSON.parse(readFileSync(MEDIENDATEI, 'utf8')) : {});
const speichereMedien = z => writeFileSync(MEDIENDATEI, JSON.stringify(z, null, 2) + '\n');
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
  const shop = await leseShopStand(wc, { markenSlug: getShopConfig('jfn').markenSlug, k: K });
  if (shop.kategorienFehlen?.length) throw new Error(`Kategorien fehlen im Shop: ${shop.kategorienFehlen.join(', ')} – Stopp.`);

  let preise = lesePreise();
  const artikelListe = K.artikel.filter(a => !NUR || a.modell === NUR);
  let plaene = artikelListe.map(artikel => planeArtikel({ artikel, lshopZeilen, groessenTerme: shop.groessenTerme, preise, k: K }));
  if (!preise) {
    writeFileSync(PREISDATEI, JSON.stringify(preisVorlage(plaene), null, 2) + '\n');
    log(`Preisdatei fehlte – Vorlage mit leeren Werten angelegt: ${PREISDATEI}`);
    preise = lesePreise();
    plaene = artikelListe.map(artikel => planeArtikel({ artikel, lshopZeilen, groessenTerme: shop.groessenTerme, preise, k: K }));
  }

  // Vorhandene Produkte (Fortsetzen): nur GET ueber die SKU.
  for (const p of plaene.filter(x => x.status === 'bereit')) p.imShop = await findeProdukt(wc, p.artikelnummer);

  const heute = heuteBerlin();
  const sp = planeSheets(reiter, plaene, { kategorieId: shop.kategorie?.id ?? '', heute, k: K });
  const neueFarbTerme = [...new Set(plaene.filter(p => p.status === 'bereit' && !shop.farbTerme.some(f => f.toLowerCase() === p.farbe.toLowerCase())).map(p => p.farbe))];
  const neueGroessen = [...new Set(plaene.flatMap(p => p.groessen.filter(g => g.neuTerm).map(g => g.shop)))];
  // Bilder: Zuordnung pruefen (Stopp bei Fehler), Sammelbilder vorhanden?
  const medien = leseMedien();
  const bilderJe = {};
  if (BILDER && !K.motive) {
    for (const a of artikelListe) {
      if (!existsSync(join(BILDER, a.bilddatei))) throw new Error(`Bild fehlt: ${a.bilddatei}`);
      bilderJe[a.modell] = bildListe(a, null, K);
    }
  } else if (BILDER) {
    const m = ordneMockups(readdirSync(join(BILDER, 'mockups')), artikelListe);
    if (m.fehler.length) throw new Error(`Mockups passen nicht – Stopp:\n  ${m.fehler.join('\n  ')}`);
    for (const a of artikelListe) {
      if (!existsSync(join(BILDER, sammelbildDatei(a.modell)))) throw new Error(`Sammelbild fehlt: ${sammelbildDatei(a.modell)}`);
      bilderJe[a.modell] = bildListe(a, m.zuordnung[a.modell]);
    }
  } else if (WRITE) throw new Error('--bilder <ordner> fehlt – ohne Bilder wird nicht angelegt.');
  const offeneBilder = Object.values(bilderJe).flat().filter(b => !medien[b.dateiname]?.id).length;
  const aufrufe = geplanteAufrufe(plaene, { kategorieFehlt: !shop.kategorie, neueTerme: neueFarbTerme.length + neueGroessen.length,
    bilderJeArtikel: BILDER ? Math.ceil(offeneBilder / Math.max(1, artikelListe.length)) : 0 });

  // ── Ausgabe (ohne Preise) ──
  log(`\n${WRITE ? 'SCHREIBLAUF' : 'TROCKENLAUF'} Halloween – ${heute}`);
  log(`Zaehler: SSOT zuletzt ${sp.zaehler.ssotZuletzt}, Maske Z${sp.zaehler.maskeZuletzt}, Varianten Z${sp.zaehler.variantenZuletzt}, Motive Z${sp.zaehler.motiveZuletzt}, Struktur_Kategorien Z${sp.zaehler.kategorienZuletzt}, SEO_Karte Z${sp.zaehler.karteZuletzt}`);
  log(`Shop: Attribute Farbe=${shop.attrIds.farbe}, Größe=${shop.attrIds.groesse} (global, mit id); Motiv lokal (globales "Motiv": ${shop.motivGlobal ? `JA, id ${shop.motivGlobal}` : 'nein'})`);
  log(K.kategorie
    ? `Kategorie "${K.kategorie.name}": ${shop.kategorie ? `vorhanden (id ${shop.kategorie.id})` : 'fehlt – wird mit --write angelegt (parent 0)'}`
    : `Kategorien (fest, im Shop vorhanden): ${shop.kategorie.ids.map((id, i) => `${id} ${shop.kategorie.namen[i]}`).join(' · ')}`);
  log(`Kollektion ${K.schluessel}: Kurzbezeichnung ${K.kurz}, ${K.motive ? `${K.motive.length} Motive (Achse "Motiv")` : 'ohne Motiv-Achse'}`);
  if (K.fp) {
    const fp = await leseFpArtikel();
    for (const p of plaene.filter(x => x.status === 'bereit')) {
      const da = fp.rows.some(r => r[fp.header.indexOf('Partner-ID')] === K.fp.partnerId && r[fp.header.indexOf('Artikelname')] === p.artikel.titel);
      log(`FP_Artikel ${K.fp.partnerId}: ${p.artikel.titel} – ${da ? 'Zeile vorhanden' : `neue Zeile ${JSON.stringify(fpArtikelZeile(fp.header, p, '<Produkt-ID>'))}`}`);
    }
  }
  log(`Marke: ${shop.marke ? shop.marke.name : 'FEHLT'} · Lieferzeit Standard: ${lieferzeit.name} (${lieferzeit.id}), Variationen "-1"`);
  log(`Farbterme neu: ${neueFarbTerme.join(', ') || '–'} · Größen-Terme neu: ${neueGroessen.join(', ') || '–'}`);
  log(`Motive Z${sp.motive.zeile ?? '-'} ${sp.motive.vorhanden ? '(vorhanden)' : `"${K.kurz}"`} · Struktur_Kategorien ${sp.kategorie.vorhanden ? 'vorhanden' : `Z${sp.kategorie.zeile}`} · SEO_Karte ${sp.karte.vorhanden ? 'vorhanden' : `Z${sp.karte.zeile}`}`);

  const csv = [['Artikel', 'Status', 'SSOT-ID (geplant)', 'Maske-Zeile', 'Varianten-Zeile', 'Artikelnummer', 'Versandklasse',
    'Achsen', 'Nr', 'Variations-SKU', 'SKU-Laenge', 'Farbe', 'Größe (Shop)', 'Größe (L-Shop)', 'Motiv', 'LShop_ArticleNr', 'Preis vorhanden', 'Hinweis']];
  for (const a of sp.artikel) {
    const p = a.plan;
    const ohnePreis = p.varianten.filter(v => !v.preis).length;
    const versandOk = shop.versandklassen.includes(p.artikel.versand);
    log(`\n[${p.artikel.modell}] ${p.artikel.titel} – ${p.status}`);
    if (p.status === 'bereit') {
      log(`  Artikelnummer ${p.artikelnummer} · Farbe ${p.farbe} · ${p.groessen.length} Größen${K.motive ? ` × ${K.motive.length} Motive` : ""} = ${p.varianten.length} Variationen · Versand ${p.artikel.versand}${versandOk ? '' : ' (FEHLT im Shop)'}`);
      log(`  Größen/ArticleNr: ${p.groessen.map(g => `${g.shop}${g.shop !== g.lshop ? `(${g.lshop})` : ''}=${g.articleNr}`).join(' ')}`);
      log(`  SKU längste: ${Math.max(...p.varianten.map(v => v.sku.length))} Zeichen · Preise fehlen: ${ohnePreis}`);
      log(`  Sheets: ${a.vorhanden ? `Maske vorhanden (${a.ssot}, Z${a.maskeZeile})` : `SSOT ${a.ssot}, Maske Z${a.maskeZeile}, Varianten Z${a.variantenVon}–Z${a.variantenBis}`}`);
      log(`  Shop: ${p.imShop ? `Produkt ${p.imShop.id} schon da (${p.imShop.status}) – nur Fehlendes` : 'neu'} · Aufrufe --write: ${aufrufe.jeArtikel[plaene.filter(x => x.status === 'bereit').indexOf(p)]}`);
      const bl = bilderJe[p.artikel.modell] ?? [];
      if (bl.length) log(`  Bilder: ${bl.length} (${bl.filter(b => medien[b.dateiname]?.id).length} schon hochgeladen), Galerie: ${bl.map(b => b.dateiname).join(', ')}`);
    }
    for (const h of p.hinweise) log(`  Hinweis: ${h}`);
    if (p.status !== 'bereit') { csv.push([p.artikel.titel, p.status, '', '', '', p.artikelnummer, p.artikel.versand, '', '', '', '', '', '', '', '', '', '', p.hinweise.join(' | ')]); continue; }
    p.varianten.forEach((v, j) => csv.push([p.artikel.titel, p.status, a.ssot, a.maskeZeile, a.variantenVon ? a.variantenVon + j : '', p.artikelnummer, p.artikel.versand,
      'Farbe (global) / Größe (global) / Motiv (lokal)', j + 1, v.sku, v.sku.length, v.farbe, v.groesse, v.lshopGroesse, v.motiv, v.articleNr, v.preis ? 'ja' : 'nein', '']));
  }
  log(`\nBilder hochzuladen: ${offeneBilder} · Shop-Aufrufe fuer --write: ${aufrufe.summe} (2-s-Takt: ca. ${Math.ceil(aufrufe.sekunden / 60)} min, ohne Nachtrag Titel/ALT)`);
  log(`Shop-Aufrufe dieses Laufs: ${wc.zaehler.get} GET, ${wc.zaehler.post} POST · ${Math.round((Date.now() - t0) / 1000)} s`);

  if (CSV) {
    writeFileSync(CSV, '﻿' + csv.map(r => r.map(esc).join(';')).join('\r\n') + '\r\n');
    log(`CSV: ${csv.length - 1} Zeilen -> ${CSV}`);
  }

  if (PRUEFEN) { await pruefeAnlage({ wc, plaene, reiter, medien, bilderJe, kategorieIds: K.kategorieIds ?? [shop.kategorie?.id] }); return; }
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
    if (K.kategorie && !kategorieId) {
      const { data: k } = await wc.post('products/categories', { name: K.kategorie.name, slug: K.kategorie.slug, parent: K.kategorie.parent });
      kategorieId = k?.id;
      if (!kategorieId) throw new Error('Kategorie: keine ID zurück.');
      log(`Kategorie angelegt: ${kategorieId}`);
    }
    for (const name of neueFarbTerme) { await wc.post(`products/attributes/${shop.attrIds.farbe}/terms`, { name }); log(`Farbterm angelegt: ${name}`); }
    for (const name of neueGroessen) { await wc.post(`products/attributes/${shop.attrIds.groesse}/terms`, { name }); log(`Größen-Term angelegt: ${name}`); }

    if (!sp.kategorie.vorhanden) await haengeZeileAn(sheets, spreadsheetId, 'Struktur_Kategorien', kategorieZeile(reiter.Struktur_Kategorien[0], kategorieId, K));
    if (!sp.karte.vorhanden) await haengeZeileAn(sheets, spreadsheetId, 'SEO_Karte', karteZeile(reiter.SEO_Karte[0], kategorieId, heute, K));
    if (!sp.motive.vorhanden) await haengeZeileAn(sheets, spreadsheetId, 'Motive', sp.motive.werte);

    const hoch = wc.getaktet('upload', ladeMedienHoch);
    const text = wc.getaktet('upload', setzeMedienText);
    const lade = async b => {
      const r = await hoch({ shop: 'jfn', buffer: readFileSync(join(BILDER, b.quelle)), dateiname: b.dateiname, mimetype: 'image/jpeg', titel: b.titel, alt: b.titel });
      if (!r.ok) throw Object.assign(new Error(`Upload ${b.dateiname}: HTTP ${r.status} ${r.data?.message ?? ''}`), { response: { status: r.status } });
      let titel = medienTitel(r.data), alt = r.data.alt_text ?? '';
      if (titel !== b.titel || alt !== b.titel) {
        const tx = await text({ shop: 'jfn', id: r.data.id, titel: b.titel, alt: b.titel });
        if (tx.ok) { titel = medienTitel(tx.data); alt = tx.data.alt_text ?? ''; }
      }
      return { id: r.data.id, src: r.data.source_url, titel, alt };
    };
    const kontextBasis = { kategorieId, attrIds: shop.attrIds, markeId: shop.marke.id, lieferzeit: lieferzeit.id };
    for (const p of bereit) {
      log(`\n[${p.artikel.modell}] ${p.artikel.titel}`);
      const b = await ladeBilderHoch(bilderJe[p.artikel.modell], { zustand: medien, speichere: speichereMedien, lade, log });
      log(`  Bilder: ${b.neu} hochgeladen, ${b.vorhanden} vorhanden`);
      const kontext = { ...kontextBasis, bilder: b.bilder };
      const r = await legeArtikelAn(wc, p, kontext, { log });
      if (r.fehler.length || r.fehlend) {
        log(`  UNVOLLSTÄNDIG: ${r.fehlend} Kombinationen fehlen, ${r.fehler.length} Fehler – Sheets nicht geschrieben, Lauf hält an.`);
        r.fehler.slice(0, 10).forEach(f => log(`    ${f}`));
        process.exitCode = 2;
        return;
      }
      const s = await schreibeArtikelSheets(sheets, spreadsheetId, p, { produktId: r.produktId, marke: shop.marke.name, wcIds: r.wcIds });
      if (K.fp) {
        const fp = await leseFpArtikel();
        const da = fp.rows.some(x => x[fp.header.indexOf('Produkt-ID')] === String(r.produktId));
        if (!da) await haengeZeileAn(sheets, process.env.BUSINESS_SHEET_ID, 'FP_Artikel', fpArtikelZeile(fp.header, p, r.produktId));
        log(`  FP_Artikel ${K.fp.partnerId}: ${da ? 'Zeile vorhanden' : 'Zeile angelegt'}`);
      }
      log(`  Produkt ${r.produktId}: ${r.angelegt} angelegt, ${r.vorhanden} vorhanden · ${s.ssot}: Maske ${s.maskeNeu ? 'neu' : 'vorhanden'}, Varianten ${s.variantenNeu}${s.hinweis ? ` · ${s.hinweis}` : ''}`);
    }
  } catch (fehler) {
    let err = fehler;
    if (!(err instanceof AnlageStopp) && istStoppFehler(err)) err = new AnlageStopp(err.message, { hinweis: 'bei Kategorie, Termen oder Bild-Upload' }, err);
    if (err instanceof AnlageStopp) {
      log(`\nSTOPP: ${err.message}`);
      log(`Stand: ${JSON.stringify(err.stand)}`);
      log('Fortsetzen: denselben Befehl erneut ausführen – vorhandenes Produkt und Variationen werden über SKU/Kombination erkannt.');
      process.exitCode = 3;
      return;
    }
    throw err;
  } finally {
    log(`Shop-Aufrufe: ${wc.zaehler.get} GET, ${wc.zaehler.post} POST, ${wc.zaehler.upload ?? 0} Upload, Takt ${TAKT_MS / 1000} s`);
  }
}

// FP_Artikel (Business-Sheet) lesen - fuer die Festpreis-Zeile (nur Kollektionen mit fp).
async function leseFpArtikel() {
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.BUSINESS_SHEET_ID, range: "'FP_Artikel'" });
  const [header = [], ...rows] = data.values ?? [];
  return { header, rows };
}

// ── --pruefen: angelegte Entwuerfe zuruecklesen (nur GET) ──
async function pruefeAnlage({ wc, plaene, reiter, medien, bilderJe, kategorieIds }) {
  const E = reiter.Erfassungsmaske, V = reiter.Varianten;
  const ec = n => E[0].indexOf(n), vc = n => V[0].indexOf(n);
  const zeilen = [];
  for (const p of plaene.filter(x => x.status === 'bereit')) {
    const f = [];
    const kurz = await findeProdukt(wc, p.artikelnummer);
    if (!kurz) { zeilen.push({ artikel: p.artikel.modell, fehler: 'Produkt fehlt' }); continue; }
    const { data: prod } = await wc.get(`products/${kurz.id}`);
    const vars = await leseAlleVariationen(wc, kurz.id);
    const bilder = bilderAusZustand(bilderJe[p.artikel.modell] ?? [], medien);
    if (prod.status !== 'draft') f.push(`Status ${prod.status}`);
    const fehltKat = kategorieIds.filter(id => !prod.categories?.some(c => c.id === id));
    if (fehltKat.length) f.push(`Kategorie fehlt: ${fehltKat.join(',')}`);
    if (prod.shipping_class !== p.artikel.versand) f.push(`Versandklasse ${prod.shipping_class}`);
    if (prod.reviews_allowed !== true) f.push('reviews_allowed nicht true');
    const ids = (prod.images ?? []).map(i => i.id);
    if (bilder && JSON.stringify(ids) !== JSON.stringify(galerie(bilder, K).map(i => i.id))) f.push(`Galerie ${ids.join(',')}`);
    const ax = Object.fromEntries((prod.attributes ?? []).map(a => [a.name, a.id]));
    if (!ax.Farbe || !ax['Größe'] || (K.motive ? ax.Motiv !== 0 : 'Motiv' in ax)) f.push(`Attribute ${JSON.stringify(ax)}`);
    const motivAus = v => v.attributes.find(a => a.name === 'Motiv')?.option;
    const skuSoll = new Set(p.varianten.map(v => v.sku));
    const m = E.slice(1).find(r => r[ec('Artikelnummer')] === p.artikelnummer);
    const ssot = m?.[ec('ID')] ?? '';
    const vz = V.slice(1).filter(r => r[0] === ssot);
    const vIds = new Set(vars.map(v => String(v.id)));
    zeilen.push({
      artikel: p.artikel.modell, id: kurz.id, status: prod.status, variationen: `${vars.length}/${p.varianten.length}`,
      ohnePreis: vars.filter(v => !v.regular_price).length,
      ohneGla: vars.filter(v => (v.meta_data ?? []).find(x => x.key === '_wc_gla_color')?.value !== p.farbe).length,
      ohneLz: vars.filter(v => lieferzeitAusMetaData(v.meta_data) !== '-1').length,
      bildFalsch: bilder ? vars.filter(v => v.image?.id !== (K.motive ? bilder.motive[motivAus(v)] : bilder.einzel)).length : 'ohne Zustand',
      skuFalsch: vars.filter(v => !skuSoll.has(v.sku)).length, galerie: ids.length,
      maske: m ? `${ssot} / ${m[ec('Produkt-ID')]}` : 'fehlt',
      varianten: `${vz.filter(r => vIds.has(String(r[vc('WC_Variation_ID')]))).length}/${vz.length}`,
      fehler: f.join('; '),
    });
  }
  console.table(zeilen);
}

run().catch(err => { console.error(err?.message ?? err); if (err?.stand) console.error(`Stand: ${JSON.stringify(err.stand)}`); process.exit(1); });
