// Befehl M8, Teil SEO-Reiter: Schlagwoerter, Keyphrase und Synonyme vorschlagen.
//
//  - lib/schlagwoerter.js: vorhandene bevorzugt, neue als "neu", Pruefung
//    (Nur_intern, Marke/Modell, feste Liste) je Wort; tagsFuerPut schickt IMMER
//    die ganze Liste (ein tags-Array ersetzt alle Schlagwoerter).
//  - SEO_Karte-Kollision auch gegen Ist_Synonyme.
//  - Prompt: Vorschlagsblock nur auf Anfrage, keine Verbotswoerter.
//  - seo_description: Antwort `vorschlaege`.
//  - Frontend-Spiegel tagsFuerPut / Chips.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const TABS = {
  Motive: [
    ['Artikelkurzbezeichnung', 'Motiv', 'Druckposition', 'Druckfarben', 'Serie_Kontext', 'Nur_intern'],
    ['CH-Matchday', 'Vereinslogo', 'Front Mitte', 'mehrfarbig', 'Kollektion 26/27', 'Carbon Cap'],
  ],
  SKU_LShop: [
    ['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Brand', 'Consistence', 'Grammage', 'CatNrManufacturer'],
    ['1000412880', 'CB166R', 'Black', 'Kelly Green', 'One Size', 'Beechfield', '100% Polyester', '', 'B166R'],
  ],
  SEO_Karte: [
    ['Typ', 'Name', 'WC_ID', 'Ist_Keyphrase', 'Ist_Synonyme', 'Soll_Keyphrase'],
    ['Artikel', 'Crocodiles Hamburg Cap - Carbon Look', '16157', 'Crocodiles Hamburg Cap - Carbon Look',
      '["Crocodiles Cap, Crocodiles Hamburg Basecap"]', 'Crocodiles Hamburg Cap - Carbon Look'],
    ['Artikel', 'Match Day Cap Crocodiles Hamburg', '21117', 'Crocodiles Hamburg Match Day Cap',
      '["Crocodiles Hamburg Matchday Cap"]', 'Crocodiles Hamburg Match Day Cap'],
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
const TAGS = [
  { id: 11, name: 'Crocodiles Hamburg', slug: 'crocodiles-hamburg', count: 55 },
  { id: 12, name: 'Eishockey', slug: 'eishockey', count: 9 },
  { id: 13, name: 'Cap', slug: 'cap', count: 4 },
  { id: 14, name: 'Ungenutzt', slug: 'ungenutzt', count: 0 },
];
const wcGet = jest.fn(async () => ({ data: TAGS }));
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: () => ({ get: wcGet }), getShopConfig: () => ({ shop: 'jfn' }),
}));
const getModel = jest.fn(), generateContent = jest.fn();
jest.unstable_mockModule('../lib/modelConfig.js', () => ({ getModel }));
jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: () => ({ generateContent }) })),
}));
jest.unstable_mockModule('@anthropic-ai/sdk', () => ({ default: jest.fn(() => ({ messages: { create: jest.fn() } })) }));

process.env.GOOGLE_SHEET_ID = 'ssot-test';
const sw = await import('../lib/schlagwoerter.js');
const { buildSeoUserPrompt, } = await import('../lib/seo-prompt.js');
const { VERBOTENE_BEGRIFFE } = await import('../lib/seo-pruefung.js');
const ssot = await import('../lib/seo-ssot.js');
const { _resetLShopCache } = await import('../lib/lshop.js');

const KONTEXT = { nurIntern: 'Carbon Cap', marken: ['Beechfield'], modellnummern: ['CB166R', 'B166R'], produktname: 'Match Day Cap Crocodiles Hamburg' };

describe('schlagwortVorschlaege', () => {
  test('vorhandene: Schreibweise und ID; neue: "neu", hoechstens 2 (Nachtrag M8); Dubletten weg', () => {
    const r = sw.schlagwortVorschlaege(['crocodiles hamburg', 'Eishockey', 'Match Day', 'Eishockey', 'Fanartikel', 'Basecap', 'Sechstes'], TAGS, KONTEXT);
    expect(r.liste).toEqual([
      { name: 'Crocodiles Hamburg', id: 11, neu: false, pruefung: [], vorausgewaehlt: true },
      { name: 'Eishockey', id: 12, neu: false, pruefung: [], vorausgewaehlt: true },
      { name: 'Match Day', id: null, neu: true, pruefung: [], vorausgewaehlt: true },
      { name: 'Fanartikel', id: null, neu: true, pruefung: [], vorausgewaehlt: true },
    ]);
    expect(r.hinweise).toEqual([
      'Schlagwort "Basecap" weggelassen (mehr als 2 neue).',
      'Schlagwort "Sechstes" weggelassen (mehr als 2 neue).',
    ]);
  });
  test('vorhandene bis zusammen 5; danach auch vorhandene weg', () => {
    const viele = ['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => ({ id: 100 + i, name: n, slug: n.toLowerCase(), count: 1 }));
    const r = sw.schlagwortVorschlaege(['A', 'Neu1', 'B', 'C', 'D', 'E', 'F'], viele, KONTEXT);
    expect(r.liste.map(x => x.name)).toEqual(['A', 'Neu1', 'B', 'C', 'D']);
    expect(r.hinweise).toEqual(['Schlagwort "E" weggelassen (mehr als 5).', 'Schlagwort "F" weggelassen (mehr als 5).']);
  });
  test('gesperrte zaehlen nicht mit (stehen nur zur Anzeige da)', () => {
    const r = sw.schlagwortVorschlaege(['Carbon', 'Neu1', 'Beechfield', 'Neu2'], TAGS, KONTEXT);
    expect(r.liste.map(x => [x.name, x.vorausgewaehlt])).toEqual([['Carbon', false], ['Neu1', true], ['Beechfield', false], ['Neu2', true]]);
    expect(r.hinweise).toEqual([]);
  });
  test('Pruefung aus M4 laeuft ueber jedes Schlagwort', () => {
    const r = sw.schlagwortVorschlaege(['Carbon', 'Beechfield', 'CB166R', 'offiziell', 'Cap'], TAGS, KONTEXT).liste;
    expect(r.map(x => [x.name, x.pruefung, x.vorausgewaehlt])).toEqual([
      ['Carbon', ['Nur_intern "Carbon"'], false],
      ['Beechfield', ['Marke "Beechfield"'], false],
      ['CB166R', ['Modellnummer "CB166R"'], false],
      ['offiziell', ['Begriff "offiziell"'], false],
      ['Cap', [], true],
    ]);
  });
  test('promptListe: meistgenutzte zuerst, ungenutzte nicht', () => {
    expect(sw.promptListe(TAGS)).toEqual(['Crocodiles Hamburg', 'Eishockey', 'Cap']);
  });
});

describe('tagsFuerPut: ganze Liste, sonst gehen vorhandene verloren', () => {
  test('vorhandene per id bleiben, behaltene neue per name', () => {
    const chips = [{ id: 11, name: 'Crocodiles Hamburg' }, { id: 12, name: 'Eishockey' }, { id: null, name: 'Match Day', neu: true }];
    expect(sw.tagsFuerPut(chips)).toEqual([{ id: 11 }, { id: 12 }, { name: 'Match Day' }]);
  });
  test('entfernter Chip ist nicht dabei; Dubletten einmal', () => {
    expect(sw.tagsFuerPut([{ id: 11, name: 'A' }, { id: 11, name: 'A' }, { name: 'neu' }, { name: 'NEU' }]))
      .toEqual([{ id: 11 }, { name: 'neu' }]);
  });
  test('Frontend-Spiegel liefert dasselbe; Mischen behaelt vorhandene und laesst gesperrte weg', () => {
    const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
    const a = html.indexOf('// ── Vorschlaege: Anfang'), e = html.indexOf('// ── Vorschlaege: Ende ──');
    const fe = new Function(`${html.slice(a, e)}\n return { tagsFuerPut, schlagwortChipsStart, schlagwortChipsMischen };`)();
    const start = fe.schlagwortChipsStart([{ id: 11, name: 'Crocodiles Hamburg' }, { id: 99, name: 'Alt' }]);
    const m = fe.schlagwortChipsMischen(start, sw.schlagwortVorschlaege(['Crocodiles Hamburg', 'Match Day', 'Carbon'], TAGS, KONTEXT).liste);
    expect(m.gesperrt.map(g => g.name)).toEqual(['Carbon']);
    expect(fe.tagsFuerPut(m.chips)).toEqual([{ id: 11 }, { id: 99 }, { name: 'Match Day' }]);
    expect(fe.tagsFuerPut(m.chips)).toEqual(sw.tagsFuerPut(m.chips));
    // Speichern schickt tags nur, wenn die vorhandenen gelesen wurden.
    expect(html).toContain('...(seoTagsGeladen ? { tags: tagsFuerPut(seoTags) } : {}),');
  });
});

describe('SEO_Karte: Kollision auch gegen Ist_Synonyme', () => {
  beforeEach(() => ssot._resetSeoSsotCache());
  test('Synonym eines anderen Artikels -> Kollision; eigener Eintrag nicht', async () => {
    const r = await ssot.werteGegenKarte(['Crocodiles Cap', 'Crocodiles Hamburg Matchday Cap', 'Crocodiles Hamburg Fancap'], { wcId: '21117' });
    expect(r).toEqual([
      { wert: 'Crocodiles Cap', kollisionen: [{ typ: 'Artikel', name: 'Crocodiles Hamburg Cap - Carbon Look', wcId: '16157', feld: 'Ist_Synonyme', wert: 'Crocodiles Cap' }] },
      { wert: 'Crocodiles Hamburg Matchday Cap', kollisionen: [] },
      { wert: 'Crocodiles Hamburg Fancap', kollisionen: [] },
    ]);
  });
});

describe('Prompt', () => {
  const basis = { produktname: 'Match Day Cap Crocodiles Hamburg', farben: ['Black/Red'], groessen: [] };
  test('ohne Anfrage kein Vorschlagsblock, Antwortformat unveraendert', () => {
    const p = buildSeoUserPrompt(basis).prompt;
    expect(p).not.toMatch(/VORSCHLÄGE|schlagwoerter/);
    expect(p).toContain('{\n  "kurzbeschreibung": "...",\n  "produktbeschreibung": "Valides HTML wie oben definiert"\n}');
  });
  test('mit Anfrage: Liste vorhandener Schlagwoerter, Felder im JSON, KEINE Verbotswoerter', () => {
    const p = buildSeoUserPrompt({ ...basis, vorschlagen: { schlagwoerter: ['Crocodiles Hamburg', 'Eishockey'], keyphrase: true, synonyme: true } }).prompt;
    expect(p).toContain('Bevorzugt aus dieser Liste vorhandener Schlagwörter, Schreibweise genau übernehmen: Crocodiles Hamburg, Eishockey.');
    expect(p).toContain('"schlagwoerter": ["...", "..."]');
    expect(p).toContain('"keyphrase": "..."');
    expect(p).toContain('"synonyme": ["...", "...", "..."]');
    for (const b of [...VERBOTENE_BEGRIFFE, 'Carbon', 'Beechfield', 'CB166R']) expect(p).not.toContain(b);
  });
});

describe('seo_description mit vorschlagen', () => {
  let request, app;
  beforeAll(async () => {
    request = (await import('supertest')).default;
    const express = (await import('express')).default;
    app = express();
    app.use(express.json());
    app.use('/api/claude', (await import('../routes/claude.js')).default);
  });
  beforeEach(() => {
    ssot._resetSeoSsotCache(); sw._resetSchlagwortCache(); _resetLShopCache();
    process.env.GEMINI_API_KEY = 'test-gemini';
    getModel.mockResolvedValue('gemini-3.5-flash-lite');
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('Schlagwoerter, Keyphrase und Synonyme kommen geprueft zurueck', async () => {
    generateContent.mockResolvedValue({ response: { text: () => JSON.stringify({
      kurzbeschreibung: 'Crocodiles Hamburg Match Day Cap, jetzt bestellen.',
      produktbeschreibung: '<h2>Logo vorne</h2><p>Die Crocodiles Hamburg Match Day Cap mit Logo.</p>',
      schlagwoerter: ['Crocodiles Hamburg', 'Match Day', 'Beechfield'],
      keyphrase: 'Crocodiles Hamburg Cap - Carbon Look',
      synonyme: ['Crocodiles Cap', 'Eishockey Cap Hamburg', 'Crocodiles Match Day Mütze'],
    }) } });
    const res = await request(app).post('/api/claude/generate-product').send({
      action: 'seo_description', produktname: 'Match Day Cap Crocodiles Hamburg', modus: 'kollektion',
      farben: ['Black/Red'], groessen: [], artikelkurz: 'CH-Matchday', lshopNr: 'CB166R', wcId: '21117',
      vorschlagen: { schlagwoerter: true, keyphrase: true, synonyme: true },
    });
    expect(res.status).toBe(200);
    const v = res.body.vorschlaege;
    expect(v.schlagwoerter.map(x => [x.name, x.neu, x.pruefung])).toEqual([
      ['Crocodiles Hamburg', false, []], ['Match Day', true, []], ['Beechfield', true, ['Marke "Beechfield"']],
    ]);
    expect(v.schlagwortHinweise).toEqual([]);
    expect(v.keyphrase.kollisionen.map(k => k.wcId)).toEqual(['16157']);   // Soll = Ist, einmal gemeldet
    expect(v.synonyme.map(s => [s.wert, s.kollisionen.length])).toEqual([
      ['Crocodiles Cap', 1], ['Eishockey Cap Hamburg', 0], ['Crocodiles Match Day Mütze', 0],
    ]);
    const prompt = JSON.stringify(generateContent.mock.calls[0]);
    expect(prompt).toContain('Crocodiles Hamburg, Eishockey, Cap');
    expect(prompt).not.toMatch(/Carbon|Beechfield/);
  });

  test('ohne vorschlagen: kein Feld, kein Tag-Lesen', async () => {
    wcGet.mockClear();
    generateContent.mockResolvedValue({ response: { text: () => JSON.stringify({ kurzbeschreibung: 'x', produktbeschreibung: '<h2>y</h2><p>z</p>' }) } });
    const res = await request(app).post('/api/claude/generate-product').send({
      action: 'seo_description', produktname: 'Test', modus: 'kollektion', farben: [], groessen: [],
    });
    expect(res.body.vorschlaege).toBeNull();
    expect(wcGet).not.toHaveBeenCalled();
  });
});
