// Befehl M4: Generator-Eingaben aus der SSOT.
//
//  - Leser (lib/seo-ssot.js) gegen Platzhalter-Reiter im Reiterformat:
//    Motive, Struktur_Kategorien, SEO_Karte (dazu LShop_Modelle fuer die Marke).
//  - Hinweis-Vorlage aus zwei Kategorien, Keyphrase-Kollision und Teilstring.
//  - GET /api/seo/generator-eingaben: nie Nur_intern.
//  - seo_description: Motiv-Felder im Prompt, Nur_intern NIE im Prompttext,
//    Pruefhinweise in der Antwort.
//  - Frontend-Block "Generator-Eingaben": Vorbelegung ueberschreibt nichts
//    Getipptes.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Platzhalter-Reiter (Kopfzeile + Zeilen, wie im Sheet) ──────────────────
const TABS = {
  Motive: [
    ['Artikelkurzbezeichnung', 'Motiv', 'Druckposition', 'Druckfarben', 'Druckfarbe_je_Textilfarbe', 'Serie_Kontext', 'Nur_intern', 'Offen', 'Stand'],
    ['BL-Test', 'Testmotiv', 'Brust', 'Schwarz', 'nein', 'Test', '', '', '2026-09-01'],
    ['CH-Matchday', 'Vereinslogo mit Krokodil', 'Front Mitte', 'mehrfarbig: Grün, Rot, Weiß, Schwarz', 'nein',
      'Fanartikel der Crocodiles Hamburg, Kollektion 26/27', 'Carbon Cap', '', '2026-09-25'],
  ],
  Struktur_Kategorien: [
    ['Kategorienummer', 'Kategorien', 'Kategoriename', 'Instagram URL', 'TikTok URL', 'SEO_Hinweis'],
    ['549', 'Crocodiles Hamburg', 'Crocodiles Hamburg', '', '', 'Vereinstext A'],
    ['556', 'Crocodiles Hamburg > Accessoires', 'Accessoires', '', '', ''],
    ['686', 'Crocodiles Hamburg > Kollektion-26/27', 'Kollektion 26/27', '', '', 'Vereinstext A'],
    ['702', 'Crocodiles Hamburg > Kollektion-26/27 > Trainingsanzüge', 'Trainingsanzüge', '', '', 'Titelmuster B'],
  ],
  SEO_Karte: [
    ['Typ', 'Name', 'Pfad', 'Artikel', 'Ist_Keyphrase', 'Ist_Synonyme', 'Ist_SEO_Titel', 'Ist_Meta', 'noindex', 'WC_ID',
      'Ueberschreiben', 'Oberkategorie', 'Befund', 'Soll_Keyphrase', 'Soll_Synonyme', 'Soll_SEO_Titel', 'Soll_Meta', 'Status', 'Stand', 'Notiz'],
    ['Artikel', 'Crocodiles Hamburg Cap - Carbon Look', 'Crocodiles Hamburg > Accessoires', '', 'Crocodiles Hamburg Cap - Carbon Look',
      '', '', '', '', '16157', '', '', '', 'Crocodiles Hamburg Cap - Carbon Look', '', '', '', 'geschrieben', '', ''],
    ['Kategorie', 'Hamburg', 'Hamburg', '', 'Hamburg', '', '', '', '', '600', '', '', '', 'Hamburg Shirts', '', '', '', 'Vorschlag', '', ''],
    ['Artikel', 'Crocodiles Hamburg Wintermütze', 'Crocodiles Hamburg > Accessoires', '', 'crocodiles hamburg wintermütze',
      '', '', '', '', '15110', '', '', '', 'Crocodiles Hamburg Wintermütze', '', '', '', 'geschrieben', '', ''],
  ],
  LShop_Modelle: [
    ['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Brand', 'Consistence', 'Grammage', 'CatNrManufacturer'],
    ['1000412880', 'CB166R', 'Black', 'Kelly Green', 'One Size', 'Beechfield', '100% Polyester', '', 'B166R'],
    // LS2: CatNrManufacturer mit fuehrender Null (LShop_Modelle schreibt Text).
    ['1000311706', 'L03581', 'White', '', '3XL', 'SOL´S', '100% Baumwolle', '150 g/m²', '03581'],
  ],
};

const buchstabeZuIndex = b => [...b].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
const values = {
  get: jest.fn(async ({ range }) => {
    const [tab, teil] = range.split('!');
    if (teil !== '1:1' || !TABS[tab]) throw new Error(`unerwartete Range ${range}`);
    return { data: { values: [TABS[tab][0]] } };
  }),
  batchGet: jest.fn(async ({ ranges }) => ({
    data: { valueRanges: ranges.map(r => {
      const [tab, teil] = r.split('!');
      const idx = buchstabeZuIndex(/^([A-Z]+)2:/.exec(teil)[1]);
      return { range: r, values: [TABS[tab].slice(1).map(z => z[idx] ?? '')] };
    }) },
  })),
};
jest.unstable_mockModule('googleapis', () => ({ google: { sheets: () => ({ spreadsheets: { values } }) } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));

const getModel        = jest.fn();
const generateContent = jest.fn();
jest.unstable_mockModule('../lib/modelConfig.js', () => ({ getModel }));
jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: () => ({ generateContent }) })),
}));
jest.unstable_mockModule('@anthropic-ai/sdk', () => ({ default: jest.fn(() => ({ messages: { create: jest.fn() } })) }));

process.env.GOOGLE_SHEET_ID = 'ssot-test';
const ssot = await import('../lib/seo-ssot.js');
const { _resetLShopCache } = await import('../lib/lshop.js');

let request, app;
beforeAll(async () => {
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  app = express();
  app.use(express.json());
  app.use('/api/seo',    (await import('../routes/seo-meta.js')).default);
  app.use('/api/claude', (await import('../routes/claude.js')).default);
});
beforeEach(() => {
  ssot._resetSeoSsotCache();
  _resetLShopCache();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ── Leser und reine Logik ───────────────────────────────────────────────────

describe('Leser: Motive', () => {
  test('Zeile je Artikelkurzbezeichnung, Gross/Klein egal', async () => {
    const m = await ssot.motivFuer('ch-matchday');
    expect(m).toMatchObject({ kurz: 'CH-Matchday', druckposition: 'Front Mitte', nurIntern: 'Carbon Cap' });
    expect(await ssot.motivFuer('XX-Unbekannt')).toBeNull();
  });
  test('motivFuerPrompt laesst Nur_intern weg', async () => {
    const p = ssot.motivFuerPrompt(await ssot.motivFuer('CH-Matchday'));
    expect(p).toEqual({
      motiv: 'Vereinslogo mit Krokodil', druckposition: 'Front Mitte',
      druckfarben: 'mehrfarbig: Grün, Rot, Weiß, Schwarz',
      serieKontext: 'Fanartikel der Crocodiles Hamburg, Kollektion 26/27',
    });
    expect(JSON.stringify(p)).not.toMatch(/Carbon/);
  });
  test('Cache: zweiter Aufruf liest nicht erneut', async () => {
    values.get.mockClear();
    await ssot.motivFuer('CH-Matchday');
    await ssot.motivFuer('BL-Test');
    expect(values.get).toHaveBeenCalledTimes(1);
  });
});

describe('Leser: SEO_Hinweis zweier Kategorien', () => {
  test('Reihenfolge der Kategorien, leere weg, doppelte weg', async () => {
    expect(await ssot.seoHinweisVorlage(['686', '556', '549', '702'])).toBe('Vereinstext A\n\nTitelmuster B');
    expect(await ssot.seoHinweisVorlage(['702', '686'])).toBe('Titelmuster B\n\nVereinstext A');
    expect(await ssot.seoHinweisVorlage(['556'])).toBe('');
  });
});

describe('Leser: SEO_Karte, Keyphrase', () => {
  test('"Crocodiles Hamburg Match Day Cap" ist frei', async () => {
    expect(await ssot.keyphraseGegenKarte('Crocodiles Hamburg Match Day Cap', { wcId: '99001' }))
      .toEqual({ kollisionen: [], teiltreffer: [] });
  });
  test('"Crocodiles Hamburg Cap" steckt in der Keyphrase von 16157 -> nur Teiltreffer', async () => {
    const r = await ssot.keyphraseGegenKarte('Crocodiles Hamburg Cap', { wcId: '99001' });
    expect(r.kollisionen).toEqual([]);
    expect(r.teiltreffer).toEqual([
      { typ: 'Artikel', name: 'Crocodiles Hamburg Cap - Carbon Look', wcId: '16157',
        feld: 'Soll_Keyphrase', wert: 'Crocodiles Hamburg Cap - Carbon Look' },
    ]);
  });
  test('gleich (Gross/Klein, Raender egal) -> Kollision; eigener Eintrag zaehlt nicht', async () => {
    const r = await ssot.keyphraseGegenKarte('  CROCODILES Hamburg Wintermütze ', { wcId: '99001' });
    expect(r.kollisionen.map(k => k.wcId)).toEqual(['15110']);
    expect(await ssot.keyphraseGegenKarte('Crocodiles Hamburg Wintermütze', { wcId: '15110' }))
      .toEqual({ kollisionen: [], teiltreffer: [] });
  });
  test('Meldungstexte', () => {
    const m = ssot.keyphraseMeldungen('Crocodiles Hamburg Cap', {
      kollisionen: [], teiltreffer: [{ typ: 'Artikel', name: 'X', wcId: '1', feld: 'Soll_Keyphrase', wert: 'Crocodiles Hamburg Cap - Carbon Look' }],
    });
    expect(m).toEqual({ warnungen: [], infos: ['Keyphrase "Crocodiles Hamburg Cap" steckt in: Artikel "X" (ID 1), Soll_Keyphrase "Crocodiles Hamburg Cap - Carbon Look".'] });
  });
});

// ── GET /api/seo/generator-eingaben ─────────────────────────────────────────

describe('GET /api/seo/generator-eingaben', () => {
  test('Motiv ohne Nur_intern, Hinweis-Vorlage, Keyphrase-Pruefung', async () => {
    const res = await request(app).get('/api/seo/generator-eingaben')
      .query({ kurz: 'CH-Matchday', kategorien: '686,556', keyphrase: 'Crocodiles Hamburg Cap', wcId: '99001' });
    expect(res.status).toBe(200);
    expect(res.body.motiv.druckposition).toBe('Front Mitte');
    expect(JSON.stringify(res.body)).not.toMatch(/Carbon Cap|nurIntern/);
    expect(res.body.hinweisVorlage).toBe('Vereinstext A');
    expect(res.body.keyphrase.warnungen).toEqual([]);
    expect(res.body.keyphrase.infos).toHaveLength(1);
    expect(res.body.fehler).toEqual([]);
  });
  test('ohne Parameter: leere Antwort, kein Lesen', async () => {
    values.get.mockClear();
    const res = await request(app).get('/api/seo/generator-eingaben');
    expect(res.body).toEqual({ motiv: null, hinweisVorlage: '', keyphrase: null, fehler: [] });
    expect(values.get).not.toHaveBeenCalled();
  });
});

// ── seo_description mit Motiv und Pruefung ──────────────────────────────────

describe('seo_description', () => {
  const antwort = (kurz, lang) => ({ response: { text: () => JSON.stringify({ kurzbeschreibung: kurz, produktbeschreibung: lang }) } });
  const post = body => request(app).post('/api/claude/generate-product').send({
    action: 'seo_description', produktname: 'Match Day Cap Crocodiles Hamburg', modus: 'kollektion',
    keyphrase: 'Crocodiles Hamburg Match Day Cap', farben: ['Black/Kelly Green'], groessen: [],
    artikelkurz: 'CH-Matchday', lshopNr: 'CB166R', hinweise: 'Vereinstext A', ...body,
  });
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-gemini';
    getModel.mockResolvedValue('gemini-3.5-flash-lite');
    generateContent.mockReset();
  });

  test('Motiv-Felder im Prompt, Nur_intern NIE im Prompttext', async () => {
    generateContent.mockResolvedValue(antwort(
      'Crocodiles Hamburg Match Day Cap mit Logo, jetzt bestellen.',
      '<h2>Logo vorne, Kontrast am Schirm</h2><p>Die Crocodiles Hamburg Match Day Cap trägt das Logo.</p>'));
    const res = await post({ motiv: '' });
    expect(res.status).toBe(200);
    const prompt = JSON.stringify(generateContent.mock.calls[0]);
    expect(prompt).toContain('- MOTIV: Vereinslogo mit Krokodil');
    expect(prompt).toContain('- DRUCKPOSITION: Front Mitte');
    expect(prompt).toContain('- DRUCKFARBEN: mehrfarbig: Grün, Rot, Weiß, Schwarz');
    expect(prompt).toContain('- KONTEXT: Fanartikel der Crocodiles Hamburg, Kollektion 26/27');
    expect(prompt).not.toMatch(/Carbon/i);
    expect(res.body.pruefhinweise).toEqual([]);
  });

  test('getipptes Motiv gewinnt', async () => {
    generateContent.mockResolvedValue(antwort('x', '<h2>y</h2><p>z</p>'));
    await post({ motiv: 'Eigenes Motiv' });
    expect(JSON.stringify(generateContent.mock.calls[0])).toContain('- MOTIV: Eigenes Motiv');
  });

  test('Pruefhinweise: Nur_intern, Marke, Modellnummer, feste Liste, Zeit, Stick', async () => {
    generateContent.mockResolvedValue(antwort(
      'Crocodiles Hamburg Match Day Cap von Beechfield, in 3-4 Werktagen da.',
      '<h2>Logo vorne</h2><p>Die Crocodiles Hamburg Match Day Cap (CB166R) ist wie die Carbon Cap bestickt, offizielles Merch.</p>'));
    const res = await post({});
    expect(res.body.pruefhinweise).toEqual([
      'Interner Begriff "Carbon Cap" (Nur_intern) in Produktbeschreibung.',
      'Marke des Rohlings "Beechfield" in Kurzbeschreibung.',
      'Modellnummer "CB166R" in Produktbeschreibung.',
      'Begriff "offiziell" in Produktbeschreibung.',
      'Zeitangabe "3-4 Werktagen" in Kurzbeschreibung – keine Liefer- oder Bearbeitungszeiten nennen.',
      'Das Motiv ist gedruckt, der Text spricht von Stick/bestickt in Produktbeschreibung.',
    ]);
    expect(generateContent).toHaveBeenCalledTimes(1);          // kein zweiter Modelllauf dafuer
  });

  test('LS2: Herstellernummer mit fuehrender Null (03581) wird erkannt', async () => {
    const { pruefeTextMitSsot } = await import('../lib/seo-pruefung.js');
    const h = await pruefeTextMitSsot({
      lshopNr: 'L03581',
      kurzbeschreibung: 'Shirt von SOL´S',
      produktbeschreibung: '<h2>Shirt</h2><p>Basis ist das Modell 03581.</p>',
    });
    expect(h).toContain('Modellnummer "03581" in Produktbeschreibung.');
    expect(h).toContain('Marke des Rohlings "SOL´S" in Kurzbeschreibung.');
  });

  test('ohne artikelkurz/lshopNr: kein SSOT-Lesen, feste Regeln gelten trotzdem', async () => {
    values.get.mockClear();
    generateContent.mockResolvedValue(antwort('Kappe. Lieferung in 2 Wochen.', '<h2>Logo</h2><p>Kappe</p>'));
    const res = await post({ artikelkurz: undefined, lshopNr: undefined });
    expect(values.get).not.toHaveBeenCalled();
    expect(res.body.pruefhinweise).toEqual([
      'Zeitangabe "2 Wochen" in Kurzbeschreibung – keine Liefer- oder Bearbeitungszeiten nennen.',
    ]);
  });
});

// ── Frontend-Block "Generator-Eingaben" ─────────────────────────────────────

describe('Frontend-Block Generator-Eingaben', () => {
  const html  = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const a = html.indexOf('// ── Generator-Eingaben: Anfang'), e = html.indexOf('// ── Generator-Eingaben: Ende ──');
  const fe = new Function(`${html.slice(a, e)}\n return { artikelKurzAus, hinweisVorbelegen, motivInfo, generatorMeldungen };`)();

  test('artikelKurzAus', () => {
    expect(fe.artikelKurzAus('CB166R/CH-Matchday')).toBe('CH-Matchday');
    expect(fe.artikelKurzAus('ohne-schraegstrich')).toBe('');
  });

  test('Vorbelegung: leer oder unveraendert -> neue Vorlage; Getipptes -> nichts', () => {
    expect(fe.hinweisVorbelegen('', '', 'Vereinstext A')).toBe('Vereinstext A');
    expect(fe.hinweisVorbelegen('   ', '', 'Vereinstext A')).toBe('Vereinstext A');
    expect(fe.hinweisVorbelegen('Vereinstext A', 'Vereinstext A', 'Neu')).toBe('Neu');
    expect(fe.hinweisVorbelegen('Vereinstext A – plus Idee', 'Vereinstext A', 'Neu')).toBeNull();
    expect(fe.hinweisVorbelegen('Eigene Idee', '', 'Vereinstext A')).toBeNull();
  });

  test('motivInfo und Meldungen zusammen', () => {
    expect(fe.motivInfo({ druckposition: 'Front Mitte', druckfarben: '', serieKontext: 'Kollektion 26/27' }))
      .toBe('Aus dem Reiter Motive: Druckposition: Front Mitte · Kontext: Kollektion 26/27');
    expect(fe.generatorMeldungen({ hinweis: 'H2 fehlt.', pruefhinweise: ['Begriff "offiziell" in Kurzbeschreibung.'] }))
      .toEqual(['H2 fehlt.', 'Begriff "offiziell" in Kurzbeschreibung.']);
    expect(fe.generatorMeldungen({ hinweis: null })).toEqual([]);
  });
});
