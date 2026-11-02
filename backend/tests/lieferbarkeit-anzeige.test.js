// BO7-2: Lieferbarkeit L-Shop sichtbar machen - nur Anzeige aus LShop_Lieferbarkeit (vier Stufen, Null_seit, Auslaufdatum,
// Stand/veraltet, fehlender Reiter = ohne Kennzeichen). Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { LIEFERBARKEIT_TAB, LIEFERBARKEIT_SPALTEN, stufeAus, lieferbarkeitAusWerten, STUFE } from '../utils/lshop-lieferbarkeit.js';
import { leseLieferbarkeit, _lieferbarkeitCacheLeeren } from '../lib/lieferbarkeitLesen.js';
import { leseKorb, lshopModellVarianten, runKorbAbgleich, _korbCacheLeeren } from '../lib/lshopKorb.js';
import { rohlingVarianten, lagerCacheLeeren, _stammCacheLeeren } from '../lib/lager.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { TAB_BUCHUNGEN, TAB_ARTIKEL, TAB_ORTE, BUCHUNG_SPALTEN, ARTIKEL_SPALTEN, ORTE_SPALTEN } from '../utils/lager.js';
import { machSheets, grundTabs, machWc, pos, bestellung, NR, NR2, NR_AUS } from './hilfen/korb-sheet.js';

const JETZT = new Date('2026-11-03T10:00:00Z');
const zeile = (nr, stock, o = {}) => ({ ArticleNr: nr, CatalogNr: 'JH030F', stock, Stand_Datei: '2026-11-03T09:30:12.000Z', Auslauf: 'nein',
  Auslaufdatum: '', Quelle_Liste: 'Auslaufartikel - Stand 30.10.2026.de.xlsx', Geaendert_Am: 'x', Null_seit: '', ...o });
const werte = zeilen => [LIEFERBARKEIT_SPALTEN, ...zeilen.map(z => LIEFERBARKEIT_SPALTEN.map(n => z[n] ?? ''))];

describe('Stufen', () => {
  test.each([
    [zeile(NR, 37), STUFE.LIEFERBAR],
    [zeile(NR, 0, { Null_seit: '2026-11-01T10:00:00Z' }), STUFE.NULL],
    [zeile(NR, 5, { Auslauf: 'ja', Auslaufdatum: '2026-12-31' }), STUFE.AUSLAUF],
    [zeile(NR, 0, { Auslauf: 'ja' }), STUFE.AUSLAUF],          // laeuft aus geht vor 0
    [zeile(NR, '', { Auslauf: 'ja' }), STUFE.WEG],             // nicht gefuehrt geht vor allem
  ])('%j -> %s', (z, st) => expect(stufeAus(z).stufe).toBe(st));
  test('Zahl, Null_seit und Auslaufdatum werden mitgegeben', () => {
    expect(stufeAus(zeile(NR, 0, { Null_seit: '2026-11-01T10:00:00Z', Auslauf: 'ja', Auslaufdatum: '2026-12-31' })))
      .toEqual({ stufe: 'auslauf', stock: 0, nullSeit: '2026-11-01T10:00:00Z', auslaufdatum: '2026-12-31' });
  });
  test('Stand: veraltet ab 3 h, Liste alt ab 14 Tagen, ohne Liste = alt; leerer Reiter -> kein Stand', () => {
    const w = werte([zeile(NR, 1)]);
    expect(lieferbarkeitAusWerten(w, JETZT).stand).toMatchObject({ datei: '2026-11-03T09:30:12.000Z', veraltet: false, listeTage: 4, listeAlt: false });
    expect(lieferbarkeitAusWerten(w, new Date('2026-11-03T12:31:00Z')).stand.veraltet).toBe(true);
    expect(lieferbarkeitAusWerten(w, new Date('2026-11-14T09:40:00Z')).stand).toMatchObject({ listeTage: 15, listeAlt: true });
    expect(lieferbarkeitAusWerten(werte([zeile(NR, 1, { Quelle_Liste: '' })]), JETZT).stand).toMatchObject({ liste: '', listeAlt: true });
    expect(lieferbarkeitAusWerten([LIEFERBARKEIT_SPALTEN], JETZT)).toEqual({ je: new Map(), stand: null });
  });
});

// ── Lesen + Anhaengen gegen das In-Memory-Sheet ─────────────────────────────
function tabsMit({ lieferbarkeit } = {}) {
  const tabs = grundTabs();
  if (lieferbarkeit) tabs[LIEFERBARKEIT_TAB] = werte(lieferbarkeit);
  tabs[TAB_BUCHUNGEN] = [BUCHUNG_SPALTEN];
  tabs[TAB_ORTE] = [ORTE_SPALTEN, ['Wrist', 'aktiv', '']];
  tabs[TAB_ARTIKEL] = [ARTIKEL_SPALTEN];
  tabs.Trikots = [['Produktname', 'Groesse']];
  tabs.LShop_Modelle.push([NR_AUS.replace(/9$/, '8'), 'JH030F', 'Navy', '', 'S', '', '', '6', 'aktiv']);
  return tabs;
}

describe('Anzeige aus LShop_Lieferbarkeit', () => {
  beforeEach(() => {
    process.env.GOOGLE_SHEET_ID = 'ssot'; process.env.BUSINESS_SHEET_ID = 'ssot';
    _lieferbarkeitCacheLeeren(); _resetLShopCache(); _korbCacheLeeren(); lagerCacheLeeren(); _stammCacheLeeren();
  });

  test('fehlender Reiter: leere Map, kein Fehler; Korb ohne Kennzeichen und ohne Stand', async () => {
    const tabs = tabsMit();
    const { sheets } = machSheets(tabs);
    expect(await leseLieferbarkeit({ sheets })).toEqual({ je: new Map(), stand: null });
    await runKorbAbgleich({ sheets, wcFuer: () => machWc([bestellung(5, 'processing', [pos(9, 100, 501)])]), jetzt: () => JETZT });
    const d = await leseKorb({ shop: 'jfn', sheets });
    expect(d.buendel[0].lieferbar).toBeUndefined();
    expect(d.lieferbarkeitStand).toBeNull();
    expect(d.summen.nichtLieferbar).toBe(0);
  });

  test('Korb: Buendel traegt die Stufe, Zaehler nicht lieferbar, Stand; Zwischenspeicher 60 s', async () => {
    const tabs = tabsMit({ lieferbarkeit: [zeile(NR, 0, { Null_seit: '2026-11-01T10:00:00Z' }), zeile(NR2, 12)] });
    const { sheets } = machSheets(tabs);
    await runKorbAbgleich({ sheets, wcFuer: () => machWc([bestellung(5, 'processing', [pos(9, 100, 501), pos(10, 100, 502)])]), jetzt: () => JETZT });
    const d = await leseKorb({ shop: 'jfn', sheets });
    const b = Object.fromEntries(d.buendel.map(x => [x.articleNr, x.lieferbar]));
    expect(b[NR]).toEqual({ stufe: 'null', stock: 0, nullSeit: '2026-11-01T10:00:00Z', auslaufdatum: '' });
    expect(b[NR2]).toMatchObject({ stufe: 'lieferbar', stock: 12 });
    expect(d.summen.nichtLieferbar).toBe(1);
    expect(d.lieferbarkeitStand).toMatchObject({ datei: '2026-11-03T09:30:12.000Z' });
    tabs[LIEFERBARKEIT_TAB] = werte([zeile(NR, 5)]);   // innerhalb von 60 s noch der alte Stand
    expect((await leseLieferbarkeit({ sheets })).je.get(NR).stufe).toBe('null');
    _lieferbarkeitCacheLeeren();
    expect((await leseLieferbarkeit({ sheets })).je.get(NR).stufe).toBe('lieferbar');
  });

  test('Raster BO6/BO6-1: Varianten mit Punkt, "laeuft aus" nur aus der Liste, Stand dabei', async () => {
    const { sheets } = machSheets(tabsMit({ lieferbarkeit: [zeile(NR, 4, { Auslauf: 'ja', Auslaufdatum: '2026-12-31' }), zeile(NR2, '')] }));
    const r = await lshopModellVarianten({ catalogNr: 'JH030F', sheets });
    const v = Object.fromEntries(r.varianten.map(x => [x.articleNr, x]));
    expect(v[NR].lieferbar).toMatchObject({ stufe: 'auslauf', auslaufdatum: '2026-12-31' });
    expect(v[NR2].lieferbar.stufe).toBe('nicht_gefuehrt');
    expect(r.varianten.every(x => !('auslauf' in x))).toBe(true);
    expect(r.lieferbarkeitStand).not.toBeNull();
  });

  test('Lager: Discontinued 3/6 bleibt Sperre (gesperrt), Punkt aus der Liste', async () => {
    const { sheets } = machSheets(tabsMit({ lieferbarkeit: [zeile(NR, 0, { Null_seit: '2026-11-02T10:00:00Z' })] }));
    const r = await rohlingVarianten({ catalogNr: 'JH030F', sheets });
    const v = Object.fromEntries(r.varianten.map(x => [x.articleNr, x]));
    expect(v[NR]).toMatchObject({ gesperrt: false, lieferbar: { stufe: 'null' } });
    expect(v[NR_AUS]).toMatchObject({ gesperrt: true });             // Status ausgelaufen
    expect(v[NR_AUS.replace(/9$/, '8')]).toMatchObject({ gesperrt: true });   // Discontinued 6
    expect(v[NR2]).not.toHaveProperty('lieferbar');
  });
});

// ── Frontend-Block ───────────────────────────────────────────────────────────
describe('Frontend-Block Lieferbarkeit-Anzeige', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const block = html.slice(html.indexOf('// ── Lieferbarkeit-Anzeige: Anfang'), html.indexOf('// ── Lieferbarkeit-Anzeige: Ende ──'));
  const F = new Function(`${block}\nreturn { lfbText, lfbPunkt, lfbStand, lfbStandHtml, lfbRang, lfbRasterHinweis, lfbZusatz };`)();
  const l = (stufe, o = {}) => ({ stufe, stock: 3, nullSeit: '', auslaufdatum: '', ...o });

  test('vier Stufen mit Text, "seit" aus Null_seit, Auslaufdatum mit Jahr', () => {
    expect(F.lfbText(l('lieferbar'))).toBe('lieferbar');
    expect(F.lfbText(l('null', { stock: 0, nullSeit: '2026-11-01T10:00:00Z' }))).toBe('bei L-Shop 0 seit 01.11.');
    expect(F.lfbText(l('null', { stock: 0 }))).toBe('bei L-Shop 0');
    expect(F.lfbText(l('auslauf', { auslaufdatum: '2026-12-31' }))).toBe('läuft aus bis 31.12.2026');
    expect(F.lfbText(l('nicht_gefuehrt', { stock: null }))).toBe('nicht mehr geführt');
    expect(F.lfbText(null)).toBe('');
  });
  test('Punkt: Klasse je Stufe, Mouse-over ueber data-hilfe + Zahl in data-hilfe-zusatz, kein title', () => {
    const h = F.lfbPunkt(l('lieferbar', { stock: 37 }));
    expect(h).toMatch(/class="lfb-punkt lfb-lieferbar"/);
    expect(h).toMatch(/data-hilfe="lfb-lieferbar" data-hilfe-zusatz="Bestand bei L-Shop: 37"/);
    expect(h).not.toMatch(/title=/);
    expect(F.lfbPunkt(l('nicht_gefuehrt', { stock: null }), { text: true })).toMatch(/data-hilfe="lfb-nicht-gefuehrt"[^>]*>● nicht mehr geführt</);
    expect(F.lfbPunkt(undefined)).toBe('');
    expect(F.lfbZusatz(l('auslauf', { stock: 0, nullSeit: '2026-11-01T10:00:00Z' }))).toBe('Bestand bei L-Shop: 0 · 0 seit 01.11.');
  });
  test('Stand: HH:MM (Berlin), veraltet ab 3 h, Hinweis bei alter/fehlender Liste', () => {
    const st = { datei: '2026-11-03T09:30:12.000Z', liste: 'L', listeTage: 4, listeAlt: false };
    expect(F.lfbStand(st, new Date('2026-11-03T10:00:00Z'))).toEqual({ text: 'Lieferbarkeit Stand 10:30', veraltet: false, hinweis: '' });
    expect(F.lfbStand(st, new Date('2026-11-03T12:31:00Z')).veraltet).toBe(true);
    expect(F.lfbStandHtml(st, new Date('2026-11-03T12:31:00Z'))).toMatch(/lfb-veraltet" tabindex="0" data-hilfe="lfb-veraltet">Lieferbarkeit Stand 10:30 · veraltet/);
    expect(F.lfbStand({ ...st, listeTage: 20, listeAlt: true }, new Date('2026-11-03T10:00:00Z')).hinweis).toBe('Auslaufliste 20 Tage alt');
    expect(F.lfbStand({ ...st, liste: '', listeAlt: true }, new Date('2026-11-03T10:00:00Z')).hinweis).toBe('keine Auslaufliste');
    expect(F.lfbStandHtml(null)).toBe('');
  });
  test('Sortierung: nicht gefuehrt, laeuft aus, 0, lieferbar, unbekannt; Raster-Hinweis nur bei Problemen', () => {
    const liste = [l('lieferbar'), undefined, l('null'), l('nicht_gefuehrt'), l('auslauf')];
    expect([...liste].sort((a, b) => F.lfbRang(a) - F.lfbRang(b)).map(x => x?.stufe ?? '-')).toEqual(['nicht_gefuehrt', 'auslauf', 'null', 'lieferbar', '-']);
    expect(F.lfbRasterHinweis([{ lieferbar: l('lieferbar') }, {}])).toBe('');
    expect(F.lfbRasterHinweis([{ groesse: 'L', lieferbar: l('null', { nullSeit: '2026-11-01T10:00:00Z' }) }, { groesse: 'XL', lieferbar: l('auslauf', { auslaufdatum: '2026-12-31' }) }, { groesse: 'M', lieferbar: l('lieferbar') }]))
      .toBe('Bei L-Shop: L: bei L-Shop 0 seit 01.11. · XL: läuft aus bis 31.12.2026 – wählbar bleiben sie, L-Shop liefert nach.');
  });
  test('das ganze Modul-Skript laesst sich parsen (Namenskollisionen zwischen Bloecken)', () => {
    const i = html.indexOf('<script type="module">') + '<script type="module">'.length;
    const code = html.slice(i, html.indexOf('</script>', i));
    // Funktionskoerper statt Modul: doppelte const/let/function auf oberster Ebene sind auch hier ein SyntaxError
    expect(() => new Function(code.replace(/^\s*import\s.*$/gm, ''))).not.toThrow();
  });
  test('verbaut: Korb-Kopf und Position, BO6-Raster, BO6-1, Lager, Maske, LS4; Mouse-over ergaenzt den Zusatz', () => {
    expect(html).toContain('${b.lieferbar ? `<div class="lshop-card-bedarf">${lfbPunkt(b.lieferbar, { text: true })}</div>` : \'\'}');
    expect(html).toContain("p.status === 'offen' && b?.lieferbar ? ` · ${lfbPunkt(b.lieferbar)}` : ''");
    expect(html).toContain("(r.lieferbar ? lfbPunkt(r.lieferbar) : '') + '</label>').join('');   // BO7-2: nur der Punkt");
    expect(html).toContain("g.lieferbar && g.lieferbar.stufe !== 'lieferbar' ? ` · ${korbEsc(lfbText(g.lieferbar))}`");
    expect(html).toContain("(r.lieferbar ? lfbPunkt(r.lieferbar) : '')");
    expect(html).toContain('lshopGroesseLb(lshopModell, t, lshopGewaehlteFarben())');
    expect(html).toContain('data-hilfe="lsm-lieferbar"');
    expect(html).toContain('const text = el?.dataset?.hilfeZusatz ? `${el.dataset.hilfeZusatz} – ${fest}` : fest;');
    expect(html).not.toMatch(/läuft aus \(\$\{korbEsc\(r\.auslauf\)\}\)|Wert \$\{werte\}/);   // kein Discontinued-"laeuft aus" mehr
  });
});
