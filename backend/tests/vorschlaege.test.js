// Befehl M8, Teil Maske: Kurzbezeichnung und Versandklasse vorschlagen
// (lib/vorschlaege.js, GET /api/sheets/vorschlaege, Block "Vorschlaege").

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Platzhalter-Reiter im Reiterformat.
const TABS = {
  Erfassungsmaske: [
    ['ID', 'Artikelkurzbezeichnung', 'Kategorien'],
    ['JFN-1', 'CH-Skyline', 'Crocodiles Hamburg, Skyline Kollektion'],
    ['JFN-2', 'CH-Oldschool', 'Kollektion 26/27, Oldschool Kollektion'],
    ['JFN-3', 'Crocodiles Hamburg – Trainingsjacke Herren', 'Trainingsanzüge'],
    ['JFN-4', 'BL-Logo', 'BoysLove (BL)'],
    ['JFN-5', 'CH-Match', 'Accessoires'],
  ],
  Struktur_Kategorien: [
    ['Kategorienummer', 'Kategorien', 'Kategoriename', 'SEO_Hinweis'],
    ['549', 'Crocodiles Hamburg', 'Crocodiles Hamburg', ''],
    ['556', 'Crocodiles Hamburg > Accessoires', 'Accessoires', ''],
    ['686', 'Crocodiles Hamburg > Kollektion-26/27', 'Kollektion 26/27', ''],
    ['702', 'Crocodiles Hamburg > Kollektion-26/27 > Trainingsanzüge', 'Trainingsanzüge', ''],
    ['705', 'Crocodiles Hamburg > Skyline Kollektion', 'Skyline Kollektion', ''],
    ['706', 'Crocodiles Hamburg > Oldschool Kollektion', 'Oldschool Kollektion', ''],
    ['800', 'BoysLove (BL)', 'BoysLove (BL)', ''],
    ['900', 'Kawaii', 'Kawaii', ''],
  ],
  Motive: [['Artikelkurzbezeichnung', 'Motiv'], ['CH-Matchday', 'Vereinslogo']],
};
const idx = b => [...b].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
const values = {
  get: jest.fn(async ({ range }) => ({ data: { values: [TABS[range.split('!')[0]][0]] } })),
  batchGet: jest.fn(async ({ ranges }) => ({ data: { valueRanges: ranges.map(r => {
    const [tab, teil] = r.split('!');
    return { values: [TABS[tab].slice(1).map(z => z[idx(/^([A-Z]+)2:/.exec(teil)[1])] ?? '')] };
  }) } })),
};
jest.unstable_mockModule('googleapis', () => ({ google: { sheets: () => ({ spreadsheets: { values } }) } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));
const PRODUKTE = [
  { id: 1, sku: 'JC092/A', shipping_class: 'paket' }, { id: 2, sku: 'JC092/B', shipping_class: 'paket' },
  { id: 3, sku: 'JC092/C', shipping_class: 'grossbrief' }, { id: 4, sku: 'E3000/X', shipping_class: 'grossbrief' },
  { id: 5, sku: 'ohne-schraegstrich', shipping_class: 'brief' },
];
const wcGet = jest.fn(async () => ({ data: PRODUKTE }));
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: () => ({ get: wcGet }), getShopConfig: () => ({ shop: 'jfn' }),
}));

process.env.GOOGLE_SHEET_ID = 'ssot-test';
const v = await import('../lib/vorschlaege.js');

describe('Praefix je Hauptkategorie (aus der Erfassungsmaske)', () => {
  test('haeufigstes Praefix; Zeilen ohne Praefix zaehlen nicht', () => {
    const kat = TABS.Struktur_Kategorien.slice(1).map(([nr, pfad, name]) => ({ nr, pfad, name }));
    const erf = TABS.Erfassungsmaske.slice(1).map(([, kurz, kategorien]) => ({ kurz, kategorien }));
    const p = v.praefixeJeHauptkategorie(erf, kat);
    expect(p.get('Crocodiles Hamburg')).toEqual({ praefix: 'CH-', anzahl: 3 });
    expect(p.get('BoysLove (BL)')).toEqual({ praefix: 'BL-', anzahl: 1 });
    expect(p.has('Kawaii')).toBe(false);
  });
});

describe('Kurzbezeichnung', () => {
  const croco = { praefix: 'CH-', ausschluss: ['Crocodiles Hamburg', 'Accessoires', 'Kollektion 26/27'] };

  test('"Match Day Cap Crocodiles Hamburg" in Crocodiles -> "CH-Match"', () => {
    expect(v.kurzVorschlag({ name: 'Match Day Cap Crocodiles Hamburg', ...croco, belegt: ['CH-Matchday'] }))
      .toEqual({ wert: 'CH-Match', hinweis: null });
  });
  test('Kollision (Gross/Klein egal) -> Ziffer', () => {
    expect(v.kurzVorschlag({ name: 'Match Day Cap Crocodiles Hamburg', ...croco, belegt: ['ch-match', 'CH-Match2'] }).wert)
      .toBe('CH-Match3');
  });
  test('Vereinsname und Fuellwoerter fallen weg, CamelCase, Umlaute', () => {
    expect(v.kurzVorschlag({ name: 'Crocodiles Hamburg – Trainingsjacke Herren', ...croco }).wert).toBe('CH-Trainingsjacke');
    expect(v.kurzVorschlag({ name: 'Größe Test-Shirt', praefix: '' }).wert).toBe('Groesse');
    expect(v.kurzVorschlag({ name: 'T-Shirt', praefix: 'CH-' }).wert).toBe('CH-TShirt');
  });
  test('SKU-Regeln: hoechstens 20 Zeichen, mindestens 3', () => {
    const lang = v.kurzVorschlag({ name: 'Donaudampfschifffahrtsgesellschaftskapitaen', praefix: 'CH-' }).wert;
    expect(lang).toHaveLength(20);
    expect(v.kurzVorschlag({ name: 'Ab Cd', praefix: '' }).wert).toBe('AbCd');
  });
  test('nichts Kennzeichnendes -> kein Wert, Hinweis', () => {
    expect(v.kurzVorschlag({ name: 'Crocodiles Hamburg', ...croco })).toEqual({
      wert: null, hinweis: 'Kein kennzeichnendes Wort im Namen – Kurzbezeichnung bitte selbst setzen.',
    });
  });
});

describe('Versandklasse je L-Shop-Modell', () => {
  test('Mehrheit der veroeffentlichten Artikel', () => {
    expect(v.versandVorschlag(PRODUKTE, 'JC092')).toMatchObject({ klasse: 'paket', verteilung: { paket: 2, grossbrief: 1 } });
    expect(v.versandVorschlag(PRODUKTE, 'e3000').klasse).toBe('grossbrief');
  });
  test('kein Artikel mit dem Modell -> "paket" mit Quelle', () => {
    expect(v.versandVorschlag(PRODUKTE, 'CB166R')).toEqual({
      klasse: 'paket', verteilung: {},
      quelle: 'Kein veröffentlichter Artikel mit Modell CB166R – Standard "paket".',
    });
  });
  test('Gleichstand: "paket" vor den anderen, sonst alphabetisch', () => {
    const p = [{ sku: 'X/1', shipping_class: 'grossbrief' }, { sku: 'X/2', shipping_class: 'paket' }];
    expect(v.versandVorschlag(p, 'X').klasse).toBe('paket');
    const q = [{ sku: 'Y/1', shipping_class: 'grossbrief' }, { sku: 'Y/2', shipping_class: 'brief' }];
    expect(v.versandVorschlag(q, 'Y').klasse).toBe('brief');
  });
});

describe('GET /api/sheets/vorschlaege', () => {
  let request, app;
  beforeAll(async () => {
    request = (await import('supertest')).default;
    const express = (await import('express')).default;
    app = express();
    app.use('/api/sheets', (await import('../routes/sheets.js')).default);
  });
  beforeEach(() => v._resetVorschlagCache());

  test('Cap: Kurzbezeichnung aus Praefix + Wort (Motive zaehlen mit), Versand Standard', async () => {
    const res = await request(app).get('/api/sheets/vorschlaege')
      .query({ name: 'Match Day Cap Crocodiles Hamburg', kategorien: '686,556', lshopNr: 'CB166R' });
    expect(res.status).toBe(200);
    // "CH-Match" ist in der Erfassungsmaske belegt -> "CH-Match2"
    expect(res.body.kurz).toMatchObject({ wert: 'CH-Match2', praefix: 'CH-', hauptkategorie: 'Crocodiles Hamburg' });
    expect(res.body.versand.klasse).toBe('paket');
  });
  test('Modell mit Artikeln -> deren Klasse', async () => {
    const res = await request(app).get('/api/sheets/vorschlaege').query({ lshopNr: 'E3000' });
    expect(res.body.kurz).toBeNull();
    expect(res.body.versand.klasse).toBe('grossbrief');
  });
});

describe('Frontend-Block Vorschlaege: nie Getipptes ueberschreiben', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const a = html.indexOf('// ── Vorschlaege: Anfang'), e = html.indexOf('// ── Vorschlaege: Ende ──');
  const fe = new Function(`${html.slice(a, e)}\n return { vorschlagSetzen, keyphraseVorschlag, synonymeVorschlag };`)();

  test('leer oder unveraendert -> setzen; getippt -> null', () => {
    expect(fe.vorschlagSetzen('', '', 'CH-Match')).toBe('CH-Match');
    expect(fe.vorschlagSetzen('CH-Match', 'CH-Match', 'CH-Match2')).toBe('CH-Match2');
    expect(fe.vorschlagSetzen('CH-Matchday', 'CH-Match', 'CH-Match2')).toBeNull();
    expect(fe.vorschlagSetzen('', '', null)).toBeNull();
  });
  test('Keyphrase: frei -> uebernehmen; Kollision -> markiert, nicht uebernommen; Feld belegt -> nichts', () => {
    expect(fe.keyphraseVorschlag('', { wert: 'Crocodiles Hamburg Match Day Cap', kollisionen: [] }).wert)
      .toBe('Crocodiles Hamburg Match Day Cap');
    const k = fe.keyphraseVorschlag('', { wert: 'Crocodiles Hamburg Cap', kollisionen: [{ typ: 'Artikel', name: 'X', feld: 'Ist_Synonyme' }] });
    expect(k.wert).toBeNull();
    expect(k.meldung).toBe('Vorschlag "Crocodiles Hamburg Cap" kollidiert mit Artikel "X" (Ist_Synonyme) – nicht übernommen.');
    expect(fe.keyphraseVorschlag('Eigene', { wert: 'Y', kollisionen: [] })).toEqual({ wert: null, meldung: '' });
  });
  test('Synonyme: nur freie, kommagetrennt (Yoast-Format wie gehabt)', () => {
    const r = fe.synonymeVorschlag('', [
      { wert: 'A', kollisionen: [] }, { wert: 'B', kollisionen: [{ typ: 'Artikel', name: 'Z', feld: 'Soll_Keyphrase' }] },
      { wert: 'C', kollisionen: [] },
    ]);
    expect(r.wert).toBe('A, C');
    expect(r.meldungen).toEqual(['Synonym "B" kollidiert mit Artikel "Z" (Soll_Keyphrase) – nicht übernommen.']);
    expect(fe.synonymeVorschlag('schon da', [{ wert: 'A', kollisionen: [] }])).toEqual({ wert: null, meldungen: [] });
  });
});
