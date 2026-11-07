// AM-6: Historie je Kunde (utils/auftrag-historie.js) und "Wie letztes Mal" im Backend (Vorlage_Von). Nur erfundene Werte.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { kundenHistorie, historieArt, historieDatum, lfbHinweis } from '../utils/auftrag-historie.js';
import { anlagePlan, AUFTRAG_OPTIONAL, alsZeile, AUFTRAG_SPALTEN } from '../utils/auftraege.js';

const hier = dirname(fileURLToPath(import.meta.url));

const A = (nr, status, x = {}) => ({ Auftrag_Nr: nr, Kunden_Nr: 'K-00001', Kurztitel: 'Test', Status: status, Anfrage_Am: '2026-01-02', Angelegt: '2026-01-02T10:00:00Z', ...x });
let pid = 0;
const P = (nr, x) => ({ Position_ID: `${nr}-${String(++pid).padStart(2, '0')}`, Auftrag_Nr: nr, Art: 'lshop', LShop_ArticleNr: '', Freitext: '', Menge: '1', Motiv: '', Druck: '', Notiz: '',
  Preis_Netto: '', Aufpreis_Netto: '', Aufpreis_Ab: '', USt_Satz: '', Entfernt: '', ...x });
// erfundene L-Shop-Daten: Modell M1 in Navy (S, M) und Black (S), Modell M2 Red ausgelaufen
const info = new Map([
  ['1000000001', { modell: 'M1', bezeichnung: 'Testshirt', farbe: 'Navy', groesse: 'S', bestellbar: true, lieferbar: { stufe: 'lieferbar' } }],
  ['1000000002', { modell: 'M1', bezeichnung: 'Testshirt', farbe: 'Navy', groesse: 'M', bestellbar: true, lieferbar: { stufe: 'auslauf', auslaufdatum: '2026-12-31' } }],
  ['1000000003', { modell: 'M1', bezeichnung: 'Testshirt', farbe: 'Black', groesse: 'S', bestellbar: true, lieferbar: { stufe: 'lieferbar' } }],
  ['2000000001', { modell: 'M2', bezeichnung: 'Testhoodie', farbe: 'Red', groesse: 'L', bestellbar: false }],
]);

describe('Status-Regeln', () => {
  test('hatte ab bestellt, angefragt bis Design, storniert zaehlt nicht', () => {
    expect(['Anfrage', 'Angebot', 'Design'].map(s => historieArt({ Status: s }))).toEqual(['angefragt', 'angefragt', 'angefragt']);
    expect(['bestellt', 'in Produktion', 'fertig', 'übergeben', 'bezahlt'].map(s => historieArt({ Status: s }))).toEqual(Array(5).fill('hatte'));
    expect(historieArt({ Status: 'storniert' })).toBe('');
  });
  test('Datum: ab bestellt das Bestelldatum, sonst Anfrage', () => {
    expect(historieDatum({ Status: 'bestellt', Bestellt_Am: '2026-03-04', Anfrage_Am: '2026-03-01' })).toBe('2026-03-04');
    expect(historieDatum({ Status: 'Angebot', Bestellt_Am: '', Anfrage_Am: '2026-03-01' })).toBe('2026-03-01');
  });
  test('lfbHinweis: laeuft aus / 0 / nicht gefuehrt', () => {
    expect(['auslauf', 'auslauf_null', 'null', 'nicht_gefuehrt'].every(stufe => lfbHinweis({ stufe }))).toBe(true);
    expect(lfbHinweis({ stufe: 'lieferbar' })).toBe(false);
    expect(lfbHinweis(null)).toBe(false);
  });
});

describe('kundenHistorie', () => {
  const auftraege = [
    A('AU-2026-0001', 'bezahlt', { Bestellt_Am: '2026-02-01' }),
    A('AU-2026-0002', 'bestellt', { Bestellt_Am: '2026-05-10' }),
    A('AU-2026-0003', 'Angebot', { Anfrage_Am: '2026-06-01' }),
    A('AU-2026-0004', 'storniert', { Bestellt_Am: '2026-06-15' }),
    A('AU-2026-0005', 'fertig', { Kunden_Nr: 'K-00002', Bestellt_Am: '2026-07-01' }),   // anderer Kunde
  ];
  const positionen = [
    P('AU-2026-0001', { LShop_ArticleNr: '1000000001', Menge: '3', Motiv: 'Wappen alt', Druck: 'Brust', Preis_Netto: 10 }),
    P('AU-2026-0001', { LShop_ArticleNr: '1000000002', Menge: '2', Motiv: 'Wappen alt', Druck: 'Brust', Preis_Netto: 10 }),
    P('AU-2026-0001', { Art: 'frei', Freitext: 'Tasse', Menge: '4' }),
    P('AU-2026-0002', { LShop_ArticleNr: '1000000001', Menge: '5', Motiv: 'Wappen neu', Druck: 'Rücken', Preis_Netto: 12.5, Aufpreis_Netto: 2, Aufpreis_Ab: '3XL', USt_Satz: 7 }),
    P('AU-2026-0002', { LShop_ArticleNr: '2000000001', Menge: '1' }),
    P('AU-2026-0002', { Art: 'frei', Freitext: 'Tasse', Menge: '2' }),
    P('AU-2026-0002', { Art: 'frei', Freitext: 'Druck Pauschale', Menge: '1', Entfernt: '2026-05-11' }),   // entfernt -> zaehlt nicht
    P('AU-2026-0003', { LShop_ArticleNr: '1000000003', Menge: '9' }),
    P('AU-2026-0004', { LShop_ArticleNr: '1000000003', Menge: '7' }),   // storniert
    P('AU-2026-0004', { LShop_ArticleNr: '1000000001', Menge: '100' }),   // storniert
    P('AU-2026-0005', { LShop_ArticleNr: '1000000001', Menge: '50' }),   // anderer Kunde
  ];
  const h = kundenHistorie({ auftraege, positionen, info, kundenNr: 'K-00001' });
  const g = (m, f) => h.gruppen.find(x => x.modell === m && x.farbe === f);

  test('Verdichtung je Modell + Farbe: mehrere Auftraege, Stueck gesamt, zuletzt, letzter Preis/Motiv/Druck', () => {
    const navy = g('M1', 'Navy');
    expect(navy).toMatchObject({ zuletzt: '2026-05-10', auftraege: 2, stueck: 10, nurAngefragt: false, katalog: true });
    expect(navy.letzter).toMatchObject({ auftragNr: 'AU-2026-0002', datum: '2026-05-10', motiv: 'Wappen neu', druck: 'Rücken',
      Preis_Netto: 12.5, Aufpreis_Netto: 2, Aufpreis_Ab: '3XL', USt_Satz: 7 });
  });
  test('Lieferbarkeit: schlechteste Stufe der Groessen, die der Kunde hatte', () => {
    expect(g('M1', 'Navy').lieferbar).toEqual({ stufe: 'auslauf', auslaufdatum: '2026-12-31' });
  });
  test('"nur angefragt" (grau) - Stueck 0, storniert zaehlt nicht', () => {
    expect(g('M1', 'Black')).toMatchObject({ nurAngefragt: true, auftraege: 1, stueck: 0, zuletzt: '2026-06-01' });
  });
  test('nicht mehr im Katalog: katalog false', () => {
    expect(g('M2', 'Red')).toMatchObject({ katalog: false, nurAngefragt: false, stueck: 1 });
  });
  test('Reihenfolge: hatte vor nur angefragt, neueste zuerst', () => {
    expect(h.gruppen.map(x => `${x.modell} ${x.farbe}`)).toEqual(['M1 Navy', 'M2 Red', 'M1 Black']);
  });
  test('freie Positionen: gleicher Text = eine Zeile, entfernte zaehlen nicht', () => {
    expect(h.frei).toHaveLength(1);
    expect(h.frei[0]).toMatchObject({ text: 'Tasse', auftraege: 2, zuletzt: '2026-05-10', nurAngefragt: false });
  });
  test('ArticleNr gar nicht mehr in LShop_Modelle: eigene Gruppe, nicht im Katalog', () => {
    const x = kundenHistorie({ auftraege: [A('AU-2026-0009', 'bestellt', { Bestellt_Am: '2026-01-05' })],
      positionen: [P('AU-2026-0009', { LShop_ArticleNr: '9999999999', Menge: '2' })], info, kundenNr: 'K-00001' });
    expect(x.gruppen).toEqual([expect.objectContaining({ modell: '', articleNr: '9999999999', katalog: false, stueck: 2 })]);
  });
  test('Kunde ohne Historie: leer; nur Kunden_Nr, kein Name in der Antwort', () => {
    expect(kundenHistorie({ auftraege, positionen, info, kundenNr: 'K-09999' })).toEqual({ kundenNr: 'K-09999', gruppen: [], frei: [] });
    expect(Object.keys(h)).toEqual(['kundenNr', 'gruppen', 'frei']);
  });
});

describe('Wie letztes Mal - Backend', () => {
  const auftraege = [A('AU-2026-0001', 'bezahlt')];
  const eingabe = (x = {}) => ({ Kunden_Nr: 'K-00001', Kurztitel: 'Nachbestellung', vorgang: 'test-vorgang-1', positionen: [], ...x });
  test('Vorlage_Von hinten optional, wird beim Anlegen gesetzt; neue AU-Nr., Status Anfrage', () => {
    expect(AUFTRAG_OPTIONAL.at(-1)).toBe('Vorlage_Von');
    const plan = anlagePlan({ auftraege, positionen: [], eingabe: eingabe({ Vorlage_Von: 'AU-2026-0001' }), waehlbar: new Set(), jetzt: '2026-11-07T10:00:00Z' });
    expect(plan.auftrag).toMatchObject({ Auftrag_Nr: 'AU-2026-0002', Status: 'Anfrage', Vorlage_Von: 'AU-2026-0001' });
  });
  test('unbekannte oder falsche Vorlage -> 422, nichts geplant', () => {
    for (const v of ['AU-2026-0099', 'K-00001', 'x']) {
      expect(() => anlagePlan({ auftraege, positionen: [], eingabe: eingabe({ Vorlage_Von: v }), waehlbar: new Set(), jetzt: '2026-11-07T10:00:00Z' })).toThrow('Vorlage');
    }
  });
  test('ohne Spalte Vorlage_Von wird die Zelle nicht geschrieben (alsZeile nur ueber vorhandene Spalten)', () => {
    const idx = Object.fromEntries(AUFTRAG_SPALTEN.map((s, i) => [s, i]));
    const z = alsZeile(idx, { Auftrag_Nr: 'AU-2026-0002', Vorlage_Von: 'AU-2026-0001' }, AUFTRAG_SPALTEN);
    expect(z).toHaveLength(AUFTRAG_SPALTEN.length);
    expect(z).not.toContain('AU-2026-0001');
  });
  test('Vorlage bleibt unveraendert: Anlegen schreibt nur neue Zeilen (keine Zellen eines vorhandenen Auftrags)', () => {
    const lib = readFileSync(resolve(hier, '../lib/auftraege.js'), 'utf8');
    const anlegen = lib.slice(lib.indexOf('export async function legeAuftragAn'), lib.indexOf('\nasync function mitAuftrag('));
    expect(anlegen).toContain('await schreibe(sheets, spreadsheetId, { bloecke: [');
    expect(anlegen).not.toMatch(/zellen:/);
    expect(anlegen).toContain('vorlageNichtVermerkt');
  });
  test('Log: Historie-Route schreibt nichts ins Log, Anlegen nur Auftragsnummer + Zahl', () => {
    const route = readFileSync(resolve(hier, '../routes/auftraege.js'), 'utf8');
    const hist = route.slice(route.indexOf("router.get('/kunden/:kundenNr/historie'"));
    expect(hist.split('\n')[0]).not.toContain('console');
    const lib = readFileSync(resolve(hier, '../lib/auftraege.js'), 'utf8');
    const lesen = lib.slice(lib.indexOf('export async function leseKundenHistorie'));
    expect(lesen.slice(0, lesen.indexOf('\n}\n'))).not.toContain('console');
    expect(readFileSync(resolve(hier, '../utils/auftrag-historie.js'), 'utf8')).not.toContain('console');
  });
});
