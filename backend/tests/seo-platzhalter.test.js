// SG2 (Inhaber 19.11.): "[Material: bitte ergänzen]" darf nie veroeffentlicht werden; Material-Pflichtfeld;
// Zeile "Farben" nur Textilfarbe (Schrift-/Druckfarbe eigene Zeile). Nur erfundene Werte.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: () => ({ spreadsheets: { values: { get: async () => ({ data: { values: [] } }) } } }) },
}));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));
const wc = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient:   jest.fn(() => wc),
}));

const sp = await import('../lib/seo-prompt.js');
const { pruefeGeneratorText } = await import('../lib/seo-pruefung.js');
const { platzhalterSperre, brauchtShopStand } = await import('../utils/platzhalter-sperre.js');

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const QUELLE_WC = readFileSync(resolve(hier, '../routes/woocommerce.js'), 'utf8');
const QUELLE_CLAUDE = readFileSync(resolve(hier, '../routes/claude.js'), 'utf8');

const block = html.slice(html.indexOf('// ── Platzhalter: Anfang ──'), html.indexOf('// ── Platzhalter: Ende ──'));
const F = new Function(`${block}\nreturn { PLATZHALTER_TEXT, platzhalterIn, materialHandPruefen, ersetzeMaterialPlatzhalter, platzhalterSperrGrund };`)();

const TEXT_PH = '<h3>Produktdetails</h3><ul><li><strong>Material:</strong> [Material: bitte ergänzen]</li></ul>';

describe('1. Platzhalter erkennen (Backend = Frontend)', () => {
  const faelle = [
    [TEXT_PH, ['[Material: bitte ergänzen]']],
    ['<p>[Material: bitte erg&auml;nzen]</p>', ['[Material: bitte erg&auml;nzen]']],
    ['[Grammatur bitte ergaenzen] und [Material: bitte ergänzen]', ['[Grammatur bitte ergaenzen]', '[Material: bitte ergänzen]']],
    ['<p>100 % Polyacryl</p>', []],
    ['bitte ergänzen ohne Klammer', []],
  ];
  test.each(faelle)('%s', (t, soll) => {
    expect(sp.platzhalterIn(t)).toEqual(soll);
    expect(F.platzhalterIn(t)).toEqual(soll);
  });
  test('Text gleich', () => expect(F.PLATZHALTER_TEXT).toBe(sp.PLATZHALTER_TEXT));
});

describe('2. Material-Feld: pruefen und deterministisch einsetzen', () => {
  test.each([
    ['100 % Polyacryl', '100 % Polyacryl', null],
    ['  80% Baumwolle,  20% Polyester ', '80% Baumwolle, 20% Polyester', null],
    ['', null, null],
    ['Polyacryl', null, 'Prozent'],
    ['100 % <b>Polyacryl</b>', null, 'Klammern'],
    ['x'.repeat(201), null, '200'],
  ])('%s', (ein, faser, fehlerTeil) => {
    for (const f of [sp.materialHandPruefen, F.materialHandPruefen]) {
      const r = f(ein);
      expect(r.faser).toBe(faser);
      if (fehlerTeil) expect(r.fehler).toContain(fehlerTeil); else expect(r.fehler).toBeNull();
    }
  });
  test('ersetzt nur den Material-Platzhalter, beide Seiten gleich', () => {
    const ein = `${TEXT_PH}<p>[Grammatur bitte ergänzen]</p>`;
    const b = sp.ersetzeMaterialPlatzhalter(ein, '100 % Polyacryl');
    expect(b.ersetzt).toBe(1);
    expect(b.html).toContain('<strong>Material:</strong> 100 % Polyacryl</li>');
    expect(b.html).toContain('[Grammatur bitte ergänzen]');
    expect(F.ersetzeMaterialPlatzhalter(ein, '100 % Polyacryl')).toEqual(b);
    expect(sp.ersetzeMaterialPlatzhalter(ein, 'Polyacryl')).toEqual({ html: ein, ersetzt: 0 });
  });
});

describe('3. Prompt: Material-Feld und weitere Achsen', () => {
  const basis = { produktname: 'Testpulli Rentier', farben: ['Red/White', 'Dark Green/White'], groessen: ['S', 'M'] };
  test('ohne Faser -> Platzhalter (wie bisher), mit Handeingabe -> Faser, L-Shop-Faser hat Vorrang', () => {
    expect(sp.buildSeoUserPrompt(basis).prompt).toContain(`- Material: ${sp.MATERIAL_PLACEHOLDER}`);
    const hand = sp.buildSeoUserPrompt({ ...basis, materialHand: '100 % Polyacryl' }).prompt;
    expect(hand).toContain('- Material: 100 % Polyacryl');
    expect(hand).not.toContain(sp.MATERIAL_PLACEHOLDER);
    const beide = sp.buildSeoUserPrompt({ ...basis, materialHand: '50 % Wolle, 50 % Polyacryl', strukturiert: { faser: '100% Polyacryl' } }).prompt;
    expect(beide).toContain('- Material: 100% Polyacryl');
  });
  test('Schriftfarbe eigene Zeile, nicht unter FARBEN', () => {
    const p = sp.buildSeoUserPrompt({ ...basis, weitereAchsen: [{ name: 'Schriftfarbe', werte: ['Weiß', 'Weißglitzer'] }] }).prompt;
    expect(p).toContain('- FARBEN: Red/White, Dark Green/White\n');
    expect(p).toContain('- SCHRIFTFARBE: Weiß, Weißglitzer');
    expect(p).toContain('<li><strong>Farben:</strong> Red/White, Dark Green/White</li>');
    expect(p).toContain('<li><strong>Schriftfarbe:</strong> Weiß, Weißglitzer</li>');
    expect(p).toContain('FARBEN sind nur die Textilfarben');
    expect(sp.buildSeoUserPrompt(basis).prompt).not.toContain('FARBEN sind nur');
  });
  test('weitereAchsenSauber: Farbe/Größe/kaputte Namen raus, hoechstens 3', () => {
    expect(sp.weitereAchsenSauber([
      { name: 'Farbe', werte: ['Rot'] }, { name: 'Größe', werte: ['M'] }, { name: '<b>x', werte: ['a'] },
      { name: 'Druckfarbe', werte: ['Weiß', 'weiß', ''] }, { name: 'Leer', werte: [] },
    ])).toEqual([{ name: 'Druckfarbe', werte: ['Weiß'] }]);
    expect(sp.weitereAchsenSauber('kaputt')).toEqual([]);
  });
  test('Route: Material ungueltig = 400, Platzhalter nach Handeingabe ersetzt, Achsen in Prompt und Pruefung', () => {
    expect(QUELLE_CLAUDE).toContain("if (hand.fehler) return res.status(400).json({ error: hand.fehler, code: 'material' });");
    expect(QUELLE_CLAUDE).toContain('ersetzeMaterialPlatzhalter(produktbeschreibung, hand.faser, { textil })');
    expect(QUELLE_CLAUDE).toContain('weitereAchsen: achsen,');
  });
});

describe('4. Pruefregeln 11 (Platzhalter) und 12 (Farben-Zeile)', () => {
  test('Platzhalter -> Befund "Platzhalter im Text", gesperrt', () => {
    const h = pruefeGeneratorText({ kurzbeschreibung: 'Pulli', produktbeschreibung: TEXT_PH });
    expect(h).toEqual([`Platzhalter im Text [Material: bitte ergänzen] in Produktbeschreibung – ${sp.PLATZHALTER_TEXT}. Veröffentlichen gesperrt.`]);
  });
  test('Farben-Zeile mit Schriftfarbe -> Befund; richtige Zeile -> nichts', () => {
    const achsen = [{ name: 'Schriftfarbe', werte: ['Weiß', 'Weißglitzer'] }];
    const falsch = '<ul><li><strong>Farben:</strong> Red/White, Weiß, Weißglitzer, Dark Green/White</li></ul>';
    expect(pruefeGeneratorText({ produktbeschreibung: falsch, weitereAchsen: achsen }))
      .toEqual(['Zeile „Farben“ nennt Schriftfarbe (Weiß, Weißglitzer) – Farben sind nur die Textilfarben.']);
    const richtig = '<ul><li><strong>Farben:</strong> Red/White</li><li><strong>Schriftfarbe:</strong> Weiß</li></ul>';
    expect(pruefeGeneratorText({ produktbeschreibung: richtig, weitereAchsen: achsen })).toEqual([]);
  });
});

describe('5. Sperre beim Veroeffentlichen', () => {
  test('platzhalterSperre / Frontend-Spiegel', () => {
    expect(platzhalterSperre({ status: 'publish', description: TEXT_PH })).toMatchObject({ status: 422, code: 'platzhalter' });
    expect(platzhalterSperre({ status: 'draft', description: TEXT_PH })).toBeNull();
    expect(platzhalterSperre({ description: TEXT_PH }, { status: 'publish' })).not.toBeNull();
    expect(platzhalterSperre({ status: 'publish' }, { description: '<p>ok</p>', short_description: TEXT_PH })).not.toBeNull();
    expect(platzhalterSperre({ status: 'publish', description: '<p>100 % Polyacryl</p>' }, { description: TEXT_PH })).toBeNull();
    expect(F.platzhalterSperrGrund({ status: 'publish', texte: [TEXT_PH] })).toContain('Veröffentlichen gesperrt');
    expect(F.platzhalterSperrGrund({ status: 'draft', texte: [TEXT_PH] })).toBeNull();
    expect(F.platzhalterSperrGrund({ status: 'publish', texte: ['<p>ok</p>'] })).toBeNull();
  });
  test('brauchtShopStand nur wenn noetig', () => {
    expect(brauchtShopStand({ description: TEXT_PH })).toBe(true);
    expect(brauchtShopStand({ description: TEXT_PH, status: 'draft' })).toBe(false);
    expect(brauchtShopStand({ status: 'publish', description: 'a', short_description: 'b' })).toBe(false);
    expect(brauchtShopStand({ status: 'publish', description: 'a' })).toBe(true);
    expect(brauchtShopStand({ name: 'x' })).toBe(false);
  });

  let request, app;
  beforeAll(async () => {
    request = (await import('supertest')).default;
    const express = (await import('express')).default;
    const { default: router } = await import('../routes/woocommerce.js');
    app = express(); app.use(express.json()); app.use('/api/woocommerce', router);
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  });
  beforeEach(() => { wc.get.mockReset(); wc.put.mockReset(); wc.post.mockReset(); });

  test('PUT: veroeffentlichter Artikel + Platzhalter im Body -> 422, nichts geschrieben', async () => {
    wc.get.mockResolvedValue({ data: { status: 'publish', description: '', short_description: '' } });
    const r = await request(app).put('/api/woocommerce/products/100').send({ description: TEXT_PH });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('platzhalter');
    expect(r.body.error).toContain(sp.PLATZHALTER_TEXT);
    expect(wc.put).not.toHaveBeenCalled();
    expect(wc.post).not.toHaveBeenCalled();
  });
  test('PUT: auf "Veröffentlicht" umstellen, Platzhalter steht schon im Shop -> 422', async () => {
    wc.get.mockResolvedValue({ data: { status: 'draft', description: TEXT_PH, short_description: '' } });
    const r = await request(app).put('/api/woocommerce/products/100').send({ status: 'publish' });
    expect(r.status).toBe(422);
    expect(wc.put).not.toHaveBeenCalled();
  });
  test('PUT: Shop-Stand nicht lesbar -> 502, nichts geschrieben', async () => {
    wc.get.mockRejectedValue(new Error('weg'));
    const r = await request(app).put('/api/woocommerce/products/100').send({ description: TEXT_PH });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('shop_stand');
    expect(wc.put).not.toHaveBeenCalled();
  });
  test('PUT: Entwurf mit Platzhalter -> durch (kein 422)', async () => {
    wc.put.mockResolvedValue({ data: { id: 100, status: 'draft' } });
    wc.get.mockResolvedValue({ data: [] });
    const r = await request(app).put('/api/woocommerce/products/100').send({ status: 'draft', description: TEXT_PH });
    expect(r.status).not.toBe(422);
    expect(wc.put).toHaveBeenCalled();
  });
  test('Anlage legt immer als Entwurf an - keine Sperre dort (Quelltext)', () => {
    expect(QUELLE_WC).toContain("await wc.post('products', { ...payload, status: 'draft' })");
    expect(QUELLE_WC).toContain('platzhalterSperre(payload, alt ?? {}, \'publish\')');
  });
});

describe('6. Oberflaeche', () => {
  test('SEO-Reiter: Farben nur Farbachse, Material-Feld, Achsen und Material gehen mit', () => {
    expect(html).toContain('const seoFarben = () => seoMetaFarben();');
    expect(html).not.toMatch(/seoWerteAusVarianten\(seoVarianten, FARB_ATTR_RE\)/);
    expect(html).toContain("materialHand:  seoMaterialFaser ? '' : document.getElementById('seo-material').value.trim(),");
    expect(html).toContain('weitereAchsen: seoWeitere(),');
    expect(html).toMatch(/<input id="seo-material"[^>]*data-hilfe="seo-material"/);
    expect(html).toMatch(/<button[^>]*id="seo-material-einsetzen"[^>]*data-hilfe="seo-material-einsetzen"/);
    expect(html).toMatch(/'seo-material':\s+\{ name: 'Material \(Pflichtangabe\)'/);
    expect(html).toMatch(/'seo-material-einsetzen': \{ name: 'In den Text einsetzen'/);
  });
  test('Speichern sperrt bei veroeffentlichtem Artikel (SEO-Reiter und Maske), SE1 zeigt den Befund', () => {
    const save = html.slice(html.indexOf("getElementById('btn-seo-save').addEventListener"));
    expect(save.indexOf('platzhalterSperrGrund(')).toBeLessThan(save.indexOf('/api/woocommerce/products/'));
    expect(html).toContain('const statusDanach = ssZuSenden(shopStatusGeladen, statusShopSel.value) ?? shopStatusGeladen;');
    expect(html).toContain('sePlatzhalterZeigen();   // SG2');
    expect(html).toContain('id="se-platzhalter"');
  });
  test('seoWeitereAchsen: Schriftfarbe ja, Farbe/Groesse nein', () => {
    const teil = html.slice(html.indexOf('function seoWerteAusVarianten'), html.indexOf('const SEO_GROESSEN_TEXT'));
    const G = new Function('istFarbAchse', `const GROESSEN_ATTR_RE = /gr(?:ö|oe)(?:ß|ss|s)?e|sizes?/i; const FARB_ATTR_RE = /farbe|colou?r/i;\n${teil}\nreturn seoWeitereAchsen;`)(n => n === 'Farbe');
    const v = [{ aktiv: true, e1: 'Farbe', v1: 'Red', e2: 'Schriftfarbe', v2: 'Weiß', e3: 'Größe', v3: 'M' },
               { aktiv: true, e1: 'Farbe', v1: 'Red', e2: 'Schriftfarbe', v2: 'Weißglitzer', e3: 'Größe', v3: 'L' }];
    expect(G(v, null)).toEqual([{ name: 'Schriftfarbe', werte: ['Weiß', 'Weißglitzer'] }]);
    expect(G([], { attributes: [{ name: 'Farbe', options: ['Red'] }, { name: 'Druckfarbe', options: ['Gold'] }] }))
      .toEqual([{ name: 'Druckfarbe', werte: ['Gold'] }]);
  });
});
