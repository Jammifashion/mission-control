// BO7-4: "läuft aus · schon 0" (Auslaufliste UND L-Shop-Bestand 0) als eigene, dringendste Stufe nach "nicht mehr geführt".
// Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { stufeAus, STUFE } from '../utils/lshop-lieferbarkeit.js';
import { problemStufe, vorschlagFuer, baueProblemliste, exportText, stufeText } from '../utils/lieferbarkeit-shop.js';

const JETZT = new Date('2026-11-20T10:00:00Z');
const vor = tage => new Date(JETZT.getTime() - tage * 86_400_000 - 3_600_000).toISOString();
const R = (stock, o = {}) => ({ ArticleNr: '9000000001', stock, Auslauf: 'nein', Auslaufdatum: '', Null_seit: '', ...o });

describe('Stufe', () => {
  test('Auslauf + 0 -> laeuft aus · schon 0, ohne 14-Tage-Grenze', () => {
    const l = stufeAus(R(0, { Auslauf: 'ja', Auslaufdatum: '2026-12-31', Null_seit: vor(1) }));
    expect(l.stufe).toBe(STUFE.AUSLAUF_NULL);
    expect(problemStufe(l, JETZT)).toMatchObject({ stufe: 'auslauf_null', auslaufdatum: '2026-12-31', stock: 0 });
  });
  test('Auslauf + Bestand > 0 -> laeuft aus; 0 ohne Auslauf erst ab 14 Tagen; nicht gefuehrt bleibt vorn', () => {
    expect(stufeAus(R(4, { Auslauf: 'ja' })).stufe).toBe('auslauf');
    expect(problemStufe(stufeAus(R(0, { Null_seit: vor(13) })), JETZT)).toBeNull();
    expect(problemStufe(stufeAus(R(0, { Null_seit: vor(14) })), JETZT).stufe).toBe('null');
    expect(stufeAus(R('', { Auslauf: 'ja' })).stufe).toBe('nicht_gefuehrt');
  });
  test('Vorschlag: jetzt handeln, mit Nachfolger-Hinweis', () => {
    expect(vorschlagFuer({ stufe: 'auslauf_null' })).toBe('jetzt handeln: Nachfolger anlegen oder Variation privat (Löschliste) · Lieferzeit prüfen');
    expect(vorschlagFuer({ stufe: 'auslauf_null' }, { farben: ['Navy'], modelle: [], marke: 'M' }))
      .toBe('jetzt handeln: Nachfolger anlegen oder Variation privat (Löschliste) · Lieferzeit prüfen – lieferbar: gleiches Modell in Navy (nur Hinweis)');
    expect(stufeText({ stufe: 'auslauf_null', auslaufdatum: '2026-12-31', nullSeit: '2026-11-02T10:00:00Z' })).toBe('läuft aus bis 31.12.2026 · schon 0 seit 02.11.2026');
  });
});

// ── Liste ────────────────────────────────────────────────────────────────────
const zeile = (vid, nr, farbe, groesse) => ({ 'SSOT-ID': '0001', Aktiv: 'TRUE', WC_Variation_ID: vid, LShop_ArticleNr: nr, E1: 'Farbe', V1: farbe, E2: 'Größe', V2: groesse });
const varianten = [zeile('501', '9000000101', 'Black', 'M'), zeile('502', '9000000102', 'Black', 'L'), zeile('503', '9000000103', 'Navy', 'M'),
  zeile('504', '9000000104', 'Navy', 'L'), { ...zeile('601', '9000000201', 'White', 'S'), 'SSOT-ID': '0002' }];
const je = new Map([
  ['9000000101', stufeAus(R(3, { Auslauf: 'ja', Auslaufdatum: '2026-12-31' }))],
  ['9000000102', stufeAus(R(0, { Auslauf: 'ja', Auslaufdatum: '2027-01-31', Null_seit: vor(2) }))],
  ['9000000103', stufeAus(R(0, { Null_seit: vor(20) }))],
  ['9000000104', stufeAus(R(0, { Auslauf: 'ja', Auslaufdatum: '2026-12-31', Null_seit: vor(3) }))],
  ['9000000201', stufeAus(R(''))],
]);
const produkte = new Map([['100', { status: 'publish', name: 'Muster Hoodie', kategorien: [], lieferzeit: '' }], ['200', { status: 'publish', name: 'Muster Shirt', kategorien: [], lieferzeit: '' }]]);
const l = baueProblemliste({ varianten, produktJeSsot: new Map([['0001', '100'], ['0002', '200']]), je, produkte, jetzt: JETZT });

describe('Problemliste', () => {
  test('Sortierung: nicht gefuehrt -> laeuft aus · schon 0 (Datum) -> laeuft aus -> 0', () => {
    expect(l.artikel.map(a => a.produktId)).toEqual(['200', '100']);
    expect(l.artikel[1].variationen.map(v => [v.variationId, v.stufe])).toEqual([
      ['504', 'auslauf_null'], ['502', 'auslauf_null'], ['501', 'auslauf'], ['503', 'null']]);
  });
  test('Zaehler oben und "x davon schon 0" beim Artikel', () => {
    expect(l.zaehler).toMatchObject({ artikel: 2, variationen: 5, auslauf_null: { variationen: 2, artikel: 1 }, auslauf: { variationen: 1, artikel: 1 }, nicht_gefuehrt: { variationen: 1 } });
    expect(l.artikel[1]).toMatchObject({ betroffen: 4, schonNull: 2 });
    expect(l.artikel[0].schonNull).toBe(0);
  });
  test('Export nennt die Stufe und "davon schon 0"', () => {
    const text = exportText(l);
    expect(text).toContain('Artikel 100 · Muster Hoodie · 4 von 4 Variationen · 2 davon schon 0');
    expect(text).toContain('  Variation 504 · Navy / L · L-Shop 9000000104 · läuft aus bis 31.12.2026 · schon 0 seit');
    expect(text).toContain('jetzt handeln: Nachfolger anlegen oder Variation privat (Löschliste)');
  });
});

// ── Frontend ─────────────────────────────────────────────────────────────────
describe('Frontend', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const blk = (a, e) => html.slice(html.indexOf(a), html.indexOf(e));
  const A = new Function(`${blk('// ── Lieferbarkeit-Anzeige: Anfang', '// ── Lieferbarkeit-Anzeige: Ende ──')}\nreturn { lfbPunkt, lfbRang, lfbText };`)();
  const S = new Function(`${blk('// ── Lieferbarkeit-Shop: Anfang', '// ── Lieferbarkeit-Shop: Ende ──')}\nreturn { lfbsFiltern, lfbsExport, lfbsStufeText, lfbsZaehlen };`)();

  test('Punkt in Korb/Raster: eigene Klasse, Mouse-over mit Datum und "schon 0 seit"', () => {
    const h = A.lfbPunkt({ stufe: 'auslauf_null', stock: 0, nullSeit: '2026-11-02T10:00:00Z', auslaufdatum: '2026-12-31' }, { text: true });
    expect(h).toMatch(/class="lfb-punkt lfb-auslauf_null"/);
    expect(h).toContain('data-hilfe="lfb-auslauf-null" data-hilfe-zusatz="läuft aus bis 31.12.2026 – bei L-Shop schon 0 seit 02.11."');
    expect(h).toContain('● läuft aus bis 31.12.2026 · schon 0');
  });
  test('"nicht lieferbar zuerst" im Korb: schon 0 direkt nach nicht gefuehrt', () => {
    const r = ['lieferbar', 'null', 'auslauf', 'auslauf_null', 'nicht_gefuehrt'].map(stufe => ({ stufe }));
    expect([...r, undefined].sort((a, b) => A.lfbRang(a) - A.lfbRang(b)).map(x => x?.stufe ?? '-'))
      .toEqual(['nicht_gefuehrt', 'auslauf_null', 'auslauf', 'null', 'lieferbar', '-']);
  });
  test('Liste: Filter auf die Stufe, Zaehler, Export = Backend', () => {
    expect(S.lfbsFiltern(l.artikel, { stufe: 'auslauf_null' }).flatMap(a => a.variationen.map(v => v.variationId))).toEqual(['504', '502']);
    expect(S.lfbsZaehlen(l.artikel)).toMatchObject({ auslauf_null: 2, auslauf: 1 });
    expect(S.lfbsExport(l.artikel)).toBe(exportText(l));
    for (const v of l.artikel.flatMap(a => a.variationen)) expect(S.lfbsStufeText(v)).toBe(stufeText(v));
    expect(html).toContain('<option value="auslauf_null">läuft aus · schon 0</option>');
    expect(html).toMatch(/'lfb-auslauf-null':\s+\{ name:/);
    expect(html).toMatch(/'lfbs-schon-null':\s+\{ name:/);
  });
});
