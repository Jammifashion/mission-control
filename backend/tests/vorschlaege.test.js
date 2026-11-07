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
  // M8b: Katalog fuer modellAusSku (nur die Pflichtspalten von lib/lshop.js).
  LShop_Modelle: [
    ['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage'],
    ['1000030393', 'BG42', 'Black', '', '38 x 14 x 8 cm', '100% Polyester', ''],
    ['9000000001', 'E3000', 'Black', '', 'M', '100% Baumwolle', ''],
  ],
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
  { id: 6, sku: 'BG42_Delfin', shipping_class: 'grossbrief' }, { id: 7, sku: 'BG42 Deutsches ECK', shipping_class: 'grossbrief' },
];
const wcGet = jest.fn(async () => ({ data: PRODUKTE }));
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: () => ({ get: wcGet }), getShopConfig: () => ({ shop: 'jfn' }),
  normalizeShop: s => (String(s ?? '').toLowerCase() === 'honk' ? 'honk' : 'jfn'),   // NAV3: routes/sheets.js -> utils/shop-spalte.js
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

  // Nachtrag M8 (antwort-M8-1): erstes Wort unter 6 Buchstaben -> zweites klein dazu.
  test('"Match Day Cap Crocodiles Hamburg" in Crocodiles -> "CH-Matchday"', () => {
    expect(v.kurzVorschlag({ name: 'Match Day Cap Crocodiles Hamburg', ...croco }))
      .toEqual({ wert: 'CH-Matchday', hinweis: null });
  });
  test('bei existierendem CH-Matchday -> "CH-Matchday2"', () => {
    expect(v.kurzVorschlag({ name: 'Match Day Cap Crocodiles Hamburg', ...croco, belegt: ['CH-Matchday'] }).wert)
      .toBe('CH-Matchday2');
  });
  test('Kollision (Gross/Klein egal) -> naechste Ziffer', () => {
    expect(v.kurzVorschlag({ name: 'Match Day Cap Crocodiles Hamburg', ...croco, belegt: ['ch-matchday', 'CH-Matchday2'] }).wert)
      .toBe('CH-Matchday3');
  });
  test('erstes Wort ab 6 Buchstaben bleibt allein; kurzes ohne zweites Wort bleibt allein', () => {
    expect(v.kurzVorschlag({ name: 'Skyline Hoodie', praefix: 'CH-' }).wert).toBe('CH-Skyline');
    expect(v.kurzVorschlag({ name: 'Cap', praefix: 'CH-' }).wert).toBe('CH-Cap');
    expect(v.kurzVorschlag({ name: 'Retro Puck Shirt', praefix: 'CH-' }).wert).toBe('CH-Retropuck');
  });
  test('Vereinsname und Fuellwoerter fallen weg, CamelCase, Umlaute', () => {
    expect(v.kurzVorschlag({ name: 'Crocodiles Hamburg – Trainingsjacke Herren', ...croco }).wert).toBe('CH-Trainingsjacke');
    expect(v.kurzVorschlag({ name: 'Größe Test-Shirt', praefix: '' }).wert).toBe('Groesse');
    expect(v.kurzVorschlag({ name: 'T-Shirt', praefix: 'CH-' }).wert).toBe('CH-TShirt');
  });
  test('SKU-Regeln: hoechstens 20 Zeichen, mindestens 3', () => {
    const lang = v.kurzVorschlag({ name: 'Donaudampfschifffahrtsgesellschaftskapitaen', praefix: 'CH-' }).wert;
    expect(lang).toHaveLength(20);
    expect(v.kurzVorschlag({ name: 'Ab Cd', praefix: '' }).wert).toBe('Abcd');
    expect(v.kurzVorschlag({ name: 'Sehrlangeswort Zweitwort', praefix: 'CH-' }).wert).toBe('CH-Sehrlangeswort');
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

// ── M8b ─────────────────────────────────────────────────────────────────────

describe('Modell aus der SKU (M8b)', () => {
  const KATALOG = ['BG42', 'BCWU02K', 'BCWW02Q', 'E3000'];
  test('fuehrender Token bis "/", "_", "-", Leerzeichen; KING/Queen uebersprungen', () => {
    for (const sku of ['BG42_Delfin', 'BG42_torpedo', 'BG42', 'BG42-SCALA', 'BG42 Deutsches ECK', 'bg42/Test'])
      expect(v.modellAusSku(sku, KATALOG)).toBe('BG42');
    expect(v.modellAusSku('KING BCWU02K/Hoodie-Malle-Prinz-Ultras', KATALOG)).toBe('BCWU02K');
    expect(v.modellAusSku('Queen BCWW02Q/Damenhoodie', KATALOG)).toBe('BCWW02Q');
  });
  test('Token nicht im Katalog -> kein Modell', () => {
    expect(v.modellAusSku('King/Tobi-Torpedo', KATALOG)).toBeNull();
    expect(v.modellAusSku('Zipper Crocodiles', KATALOG)).toBeNull();
    expect(v.modellAusSku('JC092/Badelatschen', KATALOG)).toBeNull();
    expect(v.modellAusSku('', KATALOG)).toBeNull();
  });
  test('BG42-Bestand (5 SKU-Formen, alle grossbrief) -> grossbrief', () => {
    const p = ['BG42_Delfin', 'BG42_torpedo', 'BG42', 'BG42-SCALA', 'BG42 Deutsches ECK']
      .map((sku, i) => ({ id: i, sku, shipping_class: 'grossbrief' }));
    const r = v.versandVorschlag(p, 'BG42', { katalog: KATALOG });
    expect(r).toMatchObject({ klasse: 'grossbrief', verteilung: { grossbrief: 5 } });
    // ohne Katalog: nur die alte Regel "SKU vor '/'", keiner der fuenf zaehlt
    expect(v.versandVorschlag(p, 'BG42').klasse).toBe('paket');
  });
  test('alte Regel "SKU vor /" gilt weiter fuer Modelle ausserhalb des Katalogs', () => {
    expect(v.versandVorschlag(PRODUKTE, 'JC092', { katalog: KATALOG }))
      .toMatchObject({ klasse: 'paket', verteilung: { paket: 2, grossbrief: 1 } });
  });
});

describe('Praefix je direkter Kategorie (M8b)', () => {
  const KAT = [
    ...TABS.Struktur_Kategorien.slice(1).map(([nr, pfad, name]) => ({ nr, pfad, name })),
    { nr: '67', pfad: 'Künstler und Marken', name: 'Künstler und Marken' },
    { nr: '670', pfad: 'Künstler und Marken > Malle Prinz', name: 'Malle Prinz' },
    { nr: '671', pfad: 'Künstler und Marken > Kati Zucker', name: 'Kati Zucker' },
  ];
  const ERF = [
    ...TABS.Erfassungsmaske.slice(1).map(([, kurz, kategorien]) => ({ kurz, kategorien })),
    { kurz: 'MP-Ultras', kategorien: 'Malle Prinz' },
    { kurz: 'Hoodie Malle Prinz Ultras', kategorien: 'Malle Prinz' },
    { kurz: 'Kati Zucker Badelatschen', kategorien: 'Kati Zucker' },
  ];
  const kat = nr => KAT.find(k => k.nr === nr);

  test('Crocodiles weiter CH- (direkt aus Kollektion 26/27 bzw. Accessoires)', () => {
    expect(v.praefixFuerKategorien(ERF, KAT, [kat('686'), kat('556')]))
      .toMatchObject({ praefix: 'CH-', ebene: 'kategorie' });
  });
  test('Crocodiles ohne eigenes Praefix in der Unterkategorie -> Elternkategorie (MK1, vorher Hauptkategorie)', () => {
    expect(v.praefixFuerKategorien(ERF, KAT, [kat('702')]))
      .toMatchObject({ praefix: 'CH-', ebene: 'eltern', in: 'Kollektion 26/27', quelle: 'bestand' });
  });
  test('Praefix an der Hauptkategorie selbst gilt (BL-)', () => {
    expect(v.praefixFuerKategorien(ERF, KAT, [kat('800')])).toMatchObject({ praefix: 'BL-' });
  });
  test('670 Malle Prinz -> MP-', () => {
    expect(v.praefixFuerKategorien(ERF, KAT, [kat('670')]))
      .toEqual({ praefix: 'MP-', anzahl: 1, ebene: 'kategorie', in: 'Malle Prinz', quelle: 'bestand', ueblich: ['MP-'] });
  });
  test('Praefix aus 670 gilt nicht fuer einen anderen Kuenstler', () => {
    expect(v.praefixFuerKategorien(ERF, KAT, [kat('671')])).toBeNull();
    expect(v.kurzVorschlag({ name: 'Kati Zucker Bauchtasche', praefix: '', ausschluss: ['Künstler und Marken', 'Kati Zucker'] }).wert)
      .toBe('Bauchtasche');
  });
  test('Kategorie ohne Zeilen -> null', () => {
    expect(v.praefixFuerKategorien(ERF, KAT, [kat('900')])).toBeNull();
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
    // "CH-Matchday" steht im Reiter Motive -> "CH-Matchday2"
    expect(res.body.kurz).toMatchObject({ wert: 'CH-Matchday2', praefix: 'CH-', hauptkategorie: 'Crocodiles Hamburg' });
    expect(res.body.versand.klasse).toBe('paket');
  });
  test('M8b: BG42 ueber den Katalog aus LShop_Modelle -> grossbrief', async () => {
    const res = await request(app).get('/api/sheets/vorschlaege').query({ lshopNr: 'BG42' });
    expect(res.body.versand).toMatchObject({ klasse: 'grossbrief', verteilung: { grossbrief: 2 } });
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

// KZ1 - Praefix mit Kleinbuchstaben ("KaZu-") zaehlt, gesperrte Teile nie.
describe('Praefix KaZu und Sperrliste', () => {
  const kat = [{ nr: '1', pfad: 'Kati Zucker', name: 'Kati Zucker' }];
  test('"KaZu-" wird als Praefix erkannt, "Ugly-" nicht', () => {
    const erf = [{ kurz: 'KaZu-Logo', kategorien: 'Kati Zucker' }, { kurz: 'KaZu-KeineParty', kategorien: 'Kati Zucker' }, { kurz: 'Ugly-Sw01', kategorien: 'Kati Zucker' }];
    expect(v.praefixeJeHauptkategorie(erf, kat).get('Kati Zucker')).toEqual({ praefix: 'KaZu-', anzahl: 2 });
  });
  test('ein gesperrtes Praefix ("KZ-") wird nie vorgeschlagen', () => {
    const erf = [{ kurz: 'KZ-Logo', kategorien: 'Kati Zucker' }, { kurz: 'KZ-KeineParty', kategorien: 'Kati Zucker' }];
    expect(v.praefixeJeHauptkategorie(erf, kat).has('Kati Zucker')).toBe(false);
  });
  test('kurzVorschlag liefert keinen Wert mit gesperrtem Teil', () => {
    expect(v.kurzVorschlag({ name: 'Logo Shirt', praefix: 'SA-' }).wert).toBeNull();
    expect(v.kurzVorschlag({ name: 'SA Logo Shirt', praefix: '' }).wert).toBe('SAlogo');
    expect(v.kurzVorschlag({ name: 'Santa Shirt', praefix: 'KaZu-' }).wert).toBe('KaZu-Santashirt');
  });
});

describe('MK1: Kuerzel je Kategorie (festgelegt > Bestand > Elternkategorie)', () => {
  const KAT = [
    { nr: '1', pfad: 'Vereine', name: 'Vereine' },
    { nr: '2', pfad: 'Vereine > Verein A', name: 'Verein A' },
    { nr: '3', pfad: 'Vereine > Verein A > Jugend', name: 'Jugend A' },
    { nr: '4', pfad: 'Vereine > Verein B', name: 'Verein B' },
    { nr: '5', pfad: 'Vereine > Verein C', name: 'Verein C' },
    { nr: '6', pfad: 'Weihnacht', name: 'Weihnacht', kuerzel: 'WX-' },
    { nr: '7', pfad: 'Weihnacht > Damen', name: 'Damen W' },
    { nr: '8', pfad: 'Marken', name: 'Marken', kuerzel: '-' },
    { nr: '9', pfad: 'Marken > Kuenstler X', name: 'Kuenstler X' },
    { nr: '10', pfad: 'Marken > Kuenstler Y', name: 'Kuenstler Y', kuerzel: 'KY' },
    { nr: '11', pfad: 'Gesperrt', name: 'Gesperrt', kuerzel: 'KZ-' },
  ];
  const ERF = [
    { kurz: 'VA-Hoodie', kategorien: 'Verein A' }, { kurz: 'VA-Shirt', kategorien: 'Verein A' },
    { kurz: 'VB-Hoodie', kategorien: 'Vereine, Verein B' }, { kurz: 'VA-Cap', kategorien: 'Vereine' },
    { kurz: 'UCS-Elch', kategorien: 'Weihnacht' }, { kurz: 'XX-Mix', kategorien: 'Weihnacht' },
    { kurz: 'MX-Ultra', kategorien: 'Marken' }, { kurz: 'KX-Eins', kategorien: 'Kuenstler X' },
  ];
  const k = nr => KAT.find(x => x.nr === nr);
  const f = nrs => v.praefixFuerKategorien(ERF, KAT, nrs.map(k));
  test('festgelegt an der Kategorie geht vor dem Bestand; ohne Bindestrich ergaenzt', () => {
    expect(f(['6'])).toMatchObject({ praefix: 'WX-', quelle: 'festgelegt', ebene: 'kategorie' });
    expect(f(['6']).ueblich).toEqual(expect.arrayContaining(['WX-', 'UCS-', 'XX-']));
    expect(f(['10'])).toMatchObject({ praefix: 'KY-', quelle: 'festgelegt' });
  });
  test('abgeleitet aus dem Bestand der Kategorie; Elternkategorie, wenn die Unterkategorie keins hat', () => {
    expect(f(['2'])).toMatchObject({ praefix: 'VA-', quelle: 'bestand', ebene: 'kategorie', anzahl: 2 });
    expect(f(['3'])).toMatchObject({ praefix: 'VA-', quelle: 'bestand', ebene: 'eltern', in: 'Verein A' });
    expect(f(['7'])).toMatchObject({ praefix: 'WX-', quelle: 'festgelegt', ebene: 'eltern', in: 'Weihnacht' });
  });
  test('kein Vorschlag: Eltern gemischt (jeder Verein eigenes), "-" festgelegt, gesperrtes Kuerzel zaehlt nicht', () => {
    expect(f(['5'])).toBeNull();          // Vereine: VA- und VB- -> nichts raten
    expect(f(['9'])).toMatchObject({ praefix: 'KX-' });   // eigenes geht vor
    expect(f(['8'])).toMatchObject({ keins: true, praefix: '' });
    expect(v.praefixFuerKategorien([], KAT, [k('9')])?.praefix ?? null).toBe(null);
    expect(v.praefixFuerKategorien([], KAT, [{ nr: '12', pfad: 'Marken > Neu', name: 'Neu' }])).toBeNull();   // "-" an Marken stoppt
    expect(v.festgelegtesKuerzel(k('11'))).toBeNull();
    expect(v.festgelegtesKuerzel({ kuerzel: 'Ugly' })).toBeNull();
  });
  test('Hinweis bei fremdem Kuerzel (kein Sperren); Quelle als Text', () => {
    expect(v.kuerzelHinweis('VA-Neu', ['VA-'])).toBeNull();
    expect(v.kuerzelHinweis('va-neu', ['VA-'])).toBeNull();
    expect(v.kuerzelHinweis('CH-Neu', ['VA-'])).toBe('Kürzel CH- ist in dieser Kategorie nicht üblich (üblich: VA-).');
    expect(v.kuerzelHinweis('Hoodie', ['VA-'])).toMatch(/Ohne Kürzel-Präfix/);
    expect(v.kuerzelHinweis('CH-Neu', [])).toBeNull();
    expect(v.quelleText(f(['3']))).toBe('Präfix VA- aus Elternkategorie Verein A (2× im Bestand)');
    expect(v.quelleText(f(['6']))).toBe('Präfix WX- aus Kategorie Weihnacht (festgelegt)');
    expect(v.quelleText(f(['8']))).toMatch(/bewusst kein Kürzel/);
  });
});
