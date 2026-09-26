// Befehl M4b: Luecke in der Zeitangaben-Pruefung.
//
// Anlass Echttest Cap 25.09.: "Die Lieferung erfolgt in drei bis fuenf
// Werktagen." blieb ungemeldet - Regel 4 kannte nur Ziffern. Jetzt auch
// Zahlwoerter und Spannen, dazu jedes "Lieferzeit" / "Lieferung erfolgt" /
// "geliefert in". Und die Pruefung laeuft auch nach dem Speichern im
// SEO-Reiter gegen den gespeicherten Text (POST /api/seo/text-pruefung).

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Platzhalter-Reiter fuer die Route (Motive + LShop_Modelle).
const TABS = {
  Motive: [
    ['Artikelkurzbezeichnung', 'Motiv', 'Druckposition', 'Druckfarben', 'Serie_Kontext', 'Nur_intern'],
    ['CH-Matchday', 'Vereinslogo', 'Front Mitte', 'mehrfarbig', 'Kollektion 26/27', 'Carbon Cap'],
  ],
  LShop_Modelle: [
    ['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Brand', 'Consistence', 'Grammage', 'CatNrManufacturer'],
    ['1000412880', 'CB166R', 'Black', 'Kelly Green', 'One Size', 'Beechfield', '100% Polyester', '', 'B166R'],
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

process.env.GOOGLE_SHEET_ID = 'ssot-test';
const { pruefeGeneratorText } = await import('../lib/seo-pruefung.js');
const { _resetSeoSsotCache } = await import('../lib/seo-ssot.js');
const { _resetLShopCache } = await import('../lib/lshop.js');

const pruefe = satz => pruefeGeneratorText({ kurzbeschreibung: '', produktbeschreibung: `<h2>Logo</h2><p>${satz}</p>` });
const ZEIT   = s => `Zeitangabe "${s}" in Produktbeschreibung – keine Liefer- oder Bearbeitungszeiten nennen.`;
const LIEFER = s => `Lieferangabe "${s}" in Produktbeschreibung – Lieferzeiten stehen im Shop, nicht im Text.`;

describe('Regel 4: Zahlwoerter und Lieferangaben', () => {
  test('Originalsatz aus dem Echttest -> Zeitangabe und Lieferangabe', () => {
    expect(pruefe('Die Lieferung erfolgt in drei bis fuenf Werktagen.'))
      .toEqual([ZEIT('drei bis fuenf Werktagen'), LIEFER('Lieferung erfolgt')]);
    expect(pruefe('Die Lieferung erfolgt in drei bis fünf Werktagen.'))
      .toEqual([ZEIT('drei bis fünf Werktagen'), LIEFER('Lieferung erfolgt')]);
  });

  test('Ziffern weiter: "3 bis 5 Werktage"', () => {
    expect(pruefe('Versand in 3 bis 5 Werktage.')).toEqual([ZEIT('3 bis 5 Werktage')]);
  });

  test.each([
    ['in fuenf-sechs Tagen', 'fuenf-sechs Tagen'],
    ['in wenigen Tagen bei dir', 'wenigen Tagen'],
    ['nach einem Arbeitstag', 'einem Arbeitstag'],
    ['in zwölf Wochen', 'zwölf Wochen'],
    ['in zwei Wochen', 'zwei Wochen'],
  ])('"%s" -> Zeitangabe', (satz, treffer) => {
    expect(pruefe(satz)).toEqual([ZEIT(treffer)]);
  });

  test.each([
    ['Lieferzeit siehe oben.', 'Lieferzeit'],
    ['Wird geliefert in Kürze.', 'geliefert in'],
  ])('"%s" -> Lieferangabe ohne Zahl', (satz, treffer) => {
    expect(pruefe(satz)).toEqual([LIEFER(treffer)]);
  });

  test('Grenzfall "ein Tag am Eis": meldet (bewusst, siehe Kommentar in seo-pruefung.js)', () => {
    // Entscheidung M4b: ein Hinweis blockiert nichts; eine uebersehene
    // Lieferzusage waere rechtlich relevant. Der Inhaber liest ohnehin gegen.
    expect(pruefe('Für jeden Tag am Eis – ein Tag am Eis mit Logo.')).toEqual([ZEIT('ein Tag')]);
  });

  test('ohne Zahl vor der Einheit keine Meldung', () => {
    expect(pruefe('Ein Spieltag voller Emotion, eine Saison lang, seit 1990 dabei.')).toEqual([]);
  });
});

// ── Pruefung nach dem Speichern ─────────────────────────────────────────────

describe('POST /api/seo/text-pruefung', () => {
  let request, app;
  beforeAll(async () => {
    request = (await import('supertest')).default;
    const express = (await import('express')).default;
    app = express();
    app.use(express.json());
    app.use('/api/seo', (await import('../routes/seo-meta.js')).default);
  });
  beforeEach(() => { _resetSeoSsotCache(); _resetLShopCache(); });

  test('handbearbeiteter Text: alle Regeln laufen, mit SSOT-Daten', async () => {
    const res = await request(app).post('/api/seo/text-pruefung').send({
      kurzbeschreibung: 'Crocodiles Hamburg Match Day Cap – jetzt bestellen.',
      produktbeschreibung: '<h2>Logo vorne</h2><p>Wie die Carbon Cap. Die Lieferung erfolgt in drei bis fünf Werktagen.</p>',
      produktname: 'Match Day Cap Crocodiles Hamburg', keyphrase: 'Crocodiles Hamburg Match Day Cap',
      artikelkurz: 'CH-Matchday', lshopNr: 'CB166R',
    });
    expect(res.status).toBe(200);
    expect(res.body.pruefhinweise).toEqual([
      'Interner Begriff "Carbon Cap" (Nur_intern) in Produktbeschreibung.',
      ZEIT('drei bis fünf Werktagen'),
      LIEFER('Lieferung erfolgt'),
    ]);
  });

  test('sauberer Text -> leere Liste', async () => {
    const res = await request(app).post('/api/seo/text-pruefung').send({
      kurzbeschreibung: 'Crocodiles Hamburg Match Day Cap.', produktbeschreibung: '<h2>Logo</h2><p>Mit Vereinslogo.</p>',
      artikelkurz: 'CH-Matchday', lshopNr: 'CB166R',
    });
    expect(res.body).toEqual({ pruefhinweise: [] });
  });
});

describe('Frontend: Speichern im SEO-Reiter prueft den gespeicherten Text', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const a = html.indexOf('// ── Generator-Eingaben: Anfang'), e = html.indexOf('// ── Generator-Eingaben: Ende ──');
  const fe = new Function(`${html.slice(a, e)}\n return { textPruefungBody };`)();

  test('Body aus dem zurueckgelesenen Produkt, nicht aus dem Editor', () => {
    const item = { artikelnummer: 'CB166R/CH-Matchday', lshopNr: 'CB166R', produktname: 'Alt', wcId: 99001 };
    const produkt = { name: 'Match Day Cap Crocodiles Hamburg', short_description: 'Kurz (bearbeitet)', description: '<h2>X</h2><p>Lang (bearbeitet)</p>' };
    expect(fe.textPruefungBody(item, produkt, ' Crocodiles Hamburg Match Day Cap ')).toEqual({
      kurzbeschreibung: 'Kurz (bearbeitet)', produktbeschreibung: '<h2>X</h2><p>Lang (bearbeitet)</p>',
      produktname: 'Match Day Cap Crocodiles Hamburg', keyphrase: 'Crocodiles Hamburg Match Day Cap',
      artikelkurz: 'CH-Matchday', lshopNr: 'CB166R',
    });
  });

  test('Speichern ruft die Pruefung nach dem PUT auf, liest den Shop-Stand zurueck', () => {
    const i = html.indexOf('// M4b: Pruefung gegen den gespeicherten Text (Shop-Stand zurueckgelesen),');
    expect(html.slice(i, i + 300)).toContain("seoTextNachSpeichernPruefen(seoCurrentItem, document.getElementById('seo-keyphrase').value);");
    const f = html.indexOf('async function seoTextNachSpeichernPruefen');
    const koerper = html.slice(f, f + 900);
    expect(koerper).toContain('/api/woocommerce/products/${item.wcId}');
    expect(koerper).toContain('/api/seo/text-pruefung');
    expect(koerper).toContain("'warn'");
  });
});
