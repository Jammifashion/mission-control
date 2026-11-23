// PR1: Preisrunde - EK-Verlauf, "EK damals", Marge-Vergleich bei "Wie letztes Mal", Leseliste "EK gestiegen". Nur ERFUNDENE Werte.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ekZumTag, verlaufJe, verlaufZeilenAus, tagAus } from '../utils/ek-verlauf.js';
import { ekGestiegen, ekGestiegenText } from '../utils/ek-gestiegen.js';
import { abgleich } from '../lib/lshopStammdaten.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const ab = (a, e) => html.slice(html.indexOf(a), html.indexOf(e));
const kuEsc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const F = new Function('kuEsc', `${ab('// ── Groessen: Anfang', '// ── Groessen: Ende')}\n${ab('// ── Auftrag-Preise: Anfang', '// ── Auftrag-Preise: Ende')}\n`
  + `${ab('// ── Preisvergleich: Anfang', '// ── Preisvergleich: Ende')}\n${ab('// ── EK-gestiegen: Anfang', '// ── EK-gestiegen: Ende')}\n`
  + 'return { pvGruppe, pvSummen, pvHtml, pvRunden, pvZahl, ekgFiltern, ekgHtml, apBruttoAusNetto };')(kuEsc);

describe('EK damals (EK-Verlauf)', () => {
  const verlauf = verlaufJe([
    { ArticleNr: '1000000001', EK_alt: 4.1, EK_neu: 4.5, Geaendert_Am: '2027-01-08' },
    { ArticleNr: '1000000001', EK_alt: 3.9, EK_neu: 4.1, Geaendert_Am: '2026-03-01' },
  ]);
  const a = verlauf.get('1000000001');
  test('Aenderung nach dem Auftragstag -> EK_alt der fruehesten danach', () => {
    expect(ekZumTag({ tag: '2026-11-22', ekHeute: 4.5, geaendertAm: '2027-01-08 09:00', aenderungen: a })).toEqual({ ek: 4.1, quelle: 'verlauf' });
    expect(ekZumTag({ tag: '2026-01-15', ekHeute: 4.5, geaendertAm: '2027-01-08', aenderungen: a })).toEqual({ ek: 3.9, quelle: 'verlauf' });
  });
  test('keine Aenderung danach: heutiger EK, wenn die Zeile vor dem Auftrag zuletzt geaendert wurde; sonst unbekannt', () => {
    expect(ekZumTag({ tag: '2027-02-01', ekHeute: 4.5, geaendertAm: '2027-01-08 09:00', aenderungen: a })).toEqual({ ek: 4.5, quelle: 'heute' });
    expect(ekZumTag({ tag: '2026-10-01', ekHeute: 4.5, geaendertAm: '2026-11-20 12:00', aenderungen: [] })).toEqual({ ek: null, quelle: 'unbekannt' });
    expect(ekZumTag({ tag: '', ekHeute: 4.5, geaendertAm: '2026-01-01', aenderungen: [] }).quelle).toBe('unbekannt');
  });
  test('Tage: TT.MM.JJJJ, ISO, Seriennummer', () => {
    expect(tagAus('22.11.2026')).toBe('2026-11-22');
    expect(tagAus('2026-11-22T10:00:00Z')).toBe('2026-11-22');
    expect(tagAus(46348)).toBe('2026-11-22');
  });
  test('Stammdaten-Abgleich merkt Preisaenderungen (alter und neuer EK), sonst nichts', () => {
    const bestand = [{ ArticleNr: '1000000001', CatalogNr: 'M1', '10CartonsPrice': 4.1, Status: 'aktiv' }, { ArticleNr: '1000000002', CatalogNr: 'M1', '10CartonsPrice': 5, Status: 'aktiv' }];
    const csv = new Map([['1000000001', { ArticleNr: '1000000001', CatalogNr: 'M1', '10CartonsPrice': 4.5 }], ['1000000002', { ArticleNr: '1000000002', CatalogNr: 'M1', '10CartonsPrice': 5 }]]);
    const { zaehler } = abgleich({ bestand, csv, datei: { name: 'DE.csv', datum: '08.01.2027' }, stand: '2027-01-08 09:00' });
    expect(zaehler.ekAenderungen).toEqual([{ articleNr: '1000000001', alt: 4.1, neu: 4.5 }]);
    expect(verlaufZeilenAus(zaehler.ekAenderungen, { tag: '2027-01-08', datei: 'DE.csv' })).toEqual([['1000000001', 4.1, 4.5, '2027-01-08', 'DE.csv']]);
  });
});

describe('Marge-Vergleich "Wie letztes Mal" (Frontend-Block)', () => {
  const pos = (extra = {}) => ({ art: 'lshop', menge: 10, groesse: 'M', aufpreisAb: '3XL', ust: '19', pvPreisAlt: 10, pvAufpreisAlt: '', pvEkAlt: 4, pvEkNeu: 5, ...extra });
  const gruppe = positionen => ({ art: 'lshop', modell: 'M1', farbe: 'Black', positionen });
  test('gleiche Marge %: EK 4 -> 5 bei Marge 60 % -> VK netto 12,50, brutto 14,875 aufgerundet auf 15,00', () => {
    const e = F.pvGruppe(gruppe([pos()]));
    expect(e).toMatchObject({ vkAlt: 10000, ekAlt: 4000, ekNeu: 5000, margeAlt: 6000, margeAltProzent: 60, margeHeute: 5000 });
    expect(F.apBruttoAusNetto(e.vorschlag.preis, 19)).toBe(15);
    expect(e.vorschlag.margeProzent).toBeGreaterThanOrEqual(60);
  });
  test('Rundungsstufe einstellbar, 7 % USt, Aufschlag', () => {
    const e7 = F.pvGruppe(gruppe([pos({ ust: '7' })]), { stufe: 1 });
    expect(F.apBruttoAusNetto(e7.vorschlag.preis, 7) % 1).toBe(0);
    const ohne = F.pvGruppe(gruppe([pos({ pvEkNeu: 4 })]));   // EK gleich, kein Aufschlag -> alter Preis (brutto 11,90 -> 12,00)
    expect(F.apBruttoAusNetto(ohne.vorschlag.preis, 19)).toBe(12);
    const mit = F.pvGruppe(gruppe([pos({ pvEkNeu: 4 })]), { aufschlag: 10 });
    expect(F.apBruttoAusNetto(mit.vorschlag.preis, 19)).toBe(13.5);   // 11,90 x 1,10 = 13,09 -> 13,50
  });
  test('EK gesunken -> niedrigerer Vorschlag; EK damals unbekannt -> kein Vorschlag', () => {
    expect(F.apBruttoAusNetto(F.pvGruppe(gruppe([pos({ pvEkNeu: 3 })])).vorschlag.preis, 19)).toBe(9);   // 7,50 netto -> 8,925 -> 9,00
    const u = F.pvGruppe(gruppe([pos({ pvEkAlt: null })]));
    expect(u).toMatchObject({ grund: 'EK damals unbekannt', ekAlt: null });
    expect(u.vorschlag).toBeUndefined();
  });
  test('Aufpreis wird mit skaliert; Summenzeile nur ueber Gruppen mit Vorschlag', () => {
    const e = F.pvGruppe(gruppe([pos({ pvAufpreisAlt: 2, groesse: '3XL', menge: 2 }), pos()]));
    expect(e.vorschlag.aufpreis).not.toBe('');
    const s = F.pvSummen([e, F.pvGruppe(gruppe([pos({ pvEkAlt: null })]))]);
    expect(s).toMatchObject({ gruppen: 1, ohne: 1 });
    expect(s.vorschlag).toBeGreaterThan(s.heute);
  });
  test('Anzeige: Knopf je Gruppe mit Mouse-over, unbekannter EK als Grund, keine Kundendaten noetig', () => {
    const g = [gruppe([pos()]), gruppe([pos({ pvEkAlt: null })])];
    const h = F.pvHtml(g, g.map(x => F.pvGruppe(x)), { brutto: true });
    expect(h).toMatch(/data-pv-uebernehmen="0" data-hilfe="pv-uebernehmen"/);
    expect(h).toContain('EK damals unbekannt');
    expect(h).toContain('Rohertrag');
    expect(F.pvRunden(14.875, 0.5)).toBe(15);
    expect(F.pvZahl('2,5')).toBe(2.5);
  });
  test('Einbau: Block nur bei Vorlage, Hilfetexte da, nichts wird gespeichert (nur Preisfelder im Dialog)', () => {
    expect(html).toContain('id="au-pv-block" hidden');
    for (const k of ['pv-titel', 'pv-aufschlag', 'pv-stufe', 'pv-alle', 'pv-uebernehmen', 'pv-ek-unbekannt', 'pv-summe']) expect(html).toContain(`'${k}':`);
    const fn = ab('function auPvUebernehmen', 'function auPreisSummeZeichnen');
    expect(fn).not.toMatch(/apiFetch|fetch\(/);
    expect(fn).toContain("p.vorbelegt = [...new Set([...(p.vorbelegt ?? []), f])]");
  });
});

describe('Leseliste "EK gestiegen"', () => {
  const verlauf = verlaufJe([
    { ArticleNr: '1000000001', EK_alt: 4, EK_neu: 4.5, Geaendert_Am: '2027-01-08' },   // +12,5 %
    { ArticleNr: '1000000002', EK_alt: 4, EK_neu: 4.1, Geaendert_Am: '2027-01-08' },   // +2,5 %
    { ArticleNr: '1000000003', EK_alt: 4, EK_neu: 5, Geaendert_Am: '2026-03-01' },     // alter Lauf
  ]);
  const r = ekGestiegen({
    verlauf, mwst: 19,
    modelle: [{ articleNr: '1000000001', catalogNr: 'M1', farbe: 'Black', groesse: 'M' }],
    varianten: [{ ssot: '0001', articleNr: '1000000001', preis: '19,90', aktiv: 'TRUE' }, { ssot: '0002', articleNr: '1000000001', preis: '19,90', aktiv: 'TRUE' },
      { ssot: '0003', articleNr: '1000000002', preis: '19,90', aktiv: 'TRUE' }, { ssot: '0004', articleNr: '1000000001', preis: '9', aktiv: 'FALSE' }],
    maske: [{ id: '0001', produktId: '501', name: 'Muster-Shirt', kategorien: 'Verein A' }, { id: '0002', produktId: '502', name: 'Muster-Hoodie', kategorien: 'Verein B' },
      { id: '0003', produktId: '503', name: 'Muster-Tasse', kategorien: 'Verein A' }],
    festpreis: new Map([['502', 'FP-901']]),
  });
  test('nur ueber der Schwelle, nur der letzte Lauf, nur aktive Varianten; Festpreis gekennzeichnet', () => {
    expect(r.seit).toBe('2027-01-08');
    expect(r.artikel.map(a => a.produktId).sort()).toEqual(['501', '502']);
    const a = r.artikel.find(x => x.produktId === '501');
    expect(a.zeilen[0]).toMatchObject({ modell: 'M1', farbe: 'Black', ekAlt: 4, ekNeu: 4.5, plus: 12.5, vk: 19.9 });
    expect(a.zeilen[0].margeNeu).toBeLessThan(a.zeilen[0].margeAlt);
    expect(r.artikel.find(x => x.produktId === '502').festpreis).toBe('FP-901');
  });
  test('ohne Verlauf: Hinweis statt Liste; Text zum Kopieren ohne Kundendaten', () => {
    expect(ekGestiegen({ verlauf: new Map() }).hinweis).toMatch(/nächsten L-Shop-Stammdaten-Update/);
    const text = ekGestiegenText(r);
    expect(text).toMatch(/^EK gestiegen \(> 5 %\) seit 2027-01-08/);
    expect(text).toContain('Festpreis FP-901');
  });
  test('Anzeige: Filter Kategorie/Partner, Festpreis-Kennzeichen', () => {
    expect(F.ekgFiltern(r.artikel, { kategorie: 'verein a' }).map(a => a.produktId)).toEqual(['501']);
    expect(F.ekgFiltern(r.artikel, { partner: 'festpreis' }).map(a => a.produktId)).toEqual(['502']);
    expect(F.ekgFiltern(r.artikel, { partner: 'ohne' }).map(a => a.produktId)).toEqual(['501']);
    const h = F.ekgHtml(r, {});
    expect(h).toContain('data-hilfe="ekg-festpreis"');
    expect(h).toContain('+12,5 %');
    expect(F.ekgHtml({ hinweis: 'x <b>' }, {})).toContain('x &#60;b&#62;');
  });
});
