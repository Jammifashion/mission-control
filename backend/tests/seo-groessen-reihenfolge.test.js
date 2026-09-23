// Befehl G: Groessen im SEO-Text aufsteigend.
//
// Anlass: Die generierte Produktbeschreibung nannte die Groessen in
// umgekehrter Reihenfolge (3XL … XS). R (8666a38) sortierte nur die
// WooCommerce-Optionen und menu_order, nicht die Eingabe des SEO-Prompts.
//
// Weg der Groessen: Frontend (Block "SEO-Größenquelle") sammelt sie aus dem
// Varianten-Reiter oder - Fallback - aus den WooCommerce-Optionen, in der
// Reihenfolge der Quelle. buildSeoUserPrompt sortiert sie an EINER Stelle
// (groessenFuerText -> lib/groessen.js). Die Zeile "Größen: …" im Text schreibt
// das Modell nach der Vorlage - pruefeSeoText prueft die Reihenfolge nach.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const getModel        = jest.fn();
const generateContent = jest.fn();
jest.unstable_mockModule('../lib/modelConfig.js', () => ({ getModel }));
jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: () => ({ generateContent }) })),
}));
jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => ({ messages: { create: jest.fn() } })),
}));

let lib, request, app;
beforeAll(async () => {
  lib = await import('../lib/seo-prompt.js');
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  app = express();
  app.use(express.json());
  app.use('/api/claude', (await import('../routes/claude.js')).default);
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  process.env.GEMINI_API_KEY = 'test-gemini';
  getModel.mockResolvedValue('gemini-3.5-flash-lite');
});
afterEach(() => jest.restoreAllMocks());

// ── Frontend-Block "SEO-Größenquelle" ausfuehren ─────────────────────────────
const html  = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von   = html.indexOf('// ── SEO-Größenquelle: Anfang');
const bis   = html.indexOf('// ── SEO-Größenquelle: Ende ──');
const { seoGroessenQuelle } = new Function(`${html.slice(von, bis)}
  return { seoGroessenQuelle };`)();

const zeile = (farbe, groesse) => ({ e1: 'Farbe', v1: farbe, e2: 'Größe', v2: groesse, e3: '', v3: '', aktiv: true });
const ABSTEIGEND = ['3XL', '2XL', 'XL', 'L', 'M', 'S', 'XS'];
const AUFSTEIGEND = 'XS, S, M, L, XL, 2XL, 3XL';

const prompt = groessen => lib.buildSeoUserPrompt({
  produktname: 'Testshirt', modus: 'kollektion', eigenschaften: '100% Baumwolle', farben: ['Schwarz'], groessen,
}).prompt;
const groessenZeilen = p => p.split('\n').filter(z => /GRÖSSEN:|<strong>Größen:/.test(z));

// ════════════════════════════════════════════════════════════════════════════
describe('Prompt: aufsteigend fuer jede Quelle', () => {
  test('Reiter Varianten mit 3XL … XS -> XS … 3XL im Prompt', () => {
    const quelle = seoGroessenQuelle(ABSTEIGEND.map(g => zeile('Schwarz', g)), null, { varianten: true, wc: true });
    expect(quelle).toEqual({ groessen: ABSTEIGEND, quelle: 'varianten' });   // Frontend reicht durch
    expect(groessenZeilen(prompt(quelle.groessen))).toEqual([
      `- GRÖSSEN: ${AUFSTEIGEND}`,
      `<li><strong>Größen:</strong> ${AUFSTEIGEND}</li>`,
    ]);
  });

  test('dieselbe Eingabe ueber den WooCommerce-Fallback', () => {
    const wc = { id: 1, attributes: [{ name: 'Größe', options: ABSTEIGEND }] };
    const quelle = seoGroessenQuelle([], wc, { varianten: true, wc: true });
    expect(quelle.quelle).toBe('woocommerce');
    expect(groessenZeilen(prompt(quelle.groessen))[0]).toBe(`- GRÖSSEN: ${AUFSTEIGEND}`);
  });

  test('Oldschool-Stand aus WooCommerce (4XL … XS, 5XL)', () => {
    expect(groessenZeilen(prompt(['4XL', '3XL', '2XL', 'XL', 'L', 'M', 'S', 'XS', '5XL']))[0])
      .toBe('- GRÖSSEN: XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL');
  });

  test('2XL und XXL gemischt: gleichrangig, Eingabereihenfolge', () => {
    expect(groessenZeilen(prompt(['XXL', 'M', '2XL', 'S']))[0]).toBe('- GRÖSSEN: S, M, XXL, 2XL');
    expect(groessenZeilen(prompt(['3XL', 'XXL', 'L']))[0]).toBe('- GRÖSSEN: L, XXL, 3XL');
  });

  test('Kindergroessen bleiben ganz und numerisch sortiert', () => {
    expect(groessenZeilen(prompt(['134/146', '110/116', '98/104', '122/128']))[0])
      .toBe('- GRÖSSEN: 98/104, 110/116, 122/128, 134/146');
  });

  test('unbekannte Groesse ans Ende', () => {
    expect(groessenZeilen(prompt(['Einheitsgröße', 'L', 'S']))[0]).toBe('- GRÖSSEN: S, L, Einheitsgröße');
  });

  test('Anweisung: genau diese Reihenfolge', () => {
    expect(prompt(['S', 'M'])).toContain('in GENAU dieser Reihenfolge (aufsteigend)');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Nachpruefung der Modellantwort', () => {
  const LI = liste => `<h2>Schnitt</h2><p>x</p><ul><li><strong>Größen:</strong> ${liste}</li></ul>`;

  test('vertauschte Reihenfolge wird gemeldet', () => {
    const m = lib.pruefeGroessenReihenfolge({ produktbeschreibung: LI('3XL, 2XL, XL, L, M, S, XS'), groessen: ABSTEIGEND });
    expect(m).toEqual([`Größen im Text nicht aufsteigend ("3XL, 2XL, XL, L, M, S, XS") – erwartet: ${AUFSTEIGEND}. Bitte prüfen.`]);
  });

  test('richtige Reihenfolge: keine Meldung, auch mit Leerzeichen im <strong> und <span>', () => {
    const lang = '<ul><li><strong>Größen: </strong>XS, S, M, L, XL, 2XL, 3XL, 4XL, <span style="x">5XL</span></li></ul>';
    expect(lib.pruefeGroessenReihenfolge({
      produktbeschreibung: lang, groessen: ['5XL', '4XL', '3XL', '2XL', 'XL', 'L', 'M', 'S', 'XS'],
    })).toEqual([]);
  });

  test('Kindergroessen in richtiger Reihenfolge: keine Meldung; vertauscht: Meldung', () => {
    const g = ['122/128', '110/116'];
    expect(lib.pruefeGroessenReihenfolge({ produktbeschreibung: LI('110/116, 122/128'), groessen: g })).toEqual([]);
    expect(lib.pruefeGroessenReihenfolge({ produktbeschreibung: LI('122/128 und 110/116'), groessen: g })).toHaveLength(1);
  });

  test('absteigende Spanne "3XL bis XS" in der Kurzbeschreibung wird gemeldet', () => {
    const m = lib.pruefeGroessenReihenfolge({ kurzbeschreibung: '<p>Erhältlich von 3XL bis XS.</p>', groessen: ABSTEIGEND });
    expect(m).toEqual(['Größenspanne "3XL bis XS" ist absteigend – erwartet aufsteigend. Bitte prüfen.']);
    expect(lib.pruefeGroessenReihenfolge({ kurzbeschreibung: '<p>Von XS bis 3XL.</p>', groessen: ABSTEIGEND })).toEqual([]);
  });

  test('ohne oder mit nur einer Groesse: keine Pruefung', () => {
    expect(lib.pruefeGroessenReihenfolge({ produktbeschreibung: LI('M, S'), groessen: [] })).toEqual([]);
    expect(lib.pruefeGroessenReihenfolge({ produktbeschreibung: LI('M'), groessen: ['M'] })).toEqual([]);
  });

  test('Route: Meldung im Hinweis, KEIN zweiter Modellaufruf', async () => {
    generateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify({
      kurzbeschreibung: '<p>Testshirt mit Motiv.</p>',
      produktbeschreibung: '<h2>Schnitt und Material</h2><p>Testshirt mit Motiv.</p>'
        + '<ul><li><strong>Größen:</strong> 3XL, 2XL, XL, L, M, S, XS</li></ul>',
    }) } });
    const res = await request(app).post('/api/claude/generate-product').send({
      action: 'seo_description', produktname: 'Testshirt', modus: 'kollektion',
      eigenschaften: '100% Baumwolle', farben: ['Schwarz'], groessen: ABSTEIGEND,
    });
    expect(res.status).toBe(200);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(res.body.versuch).toBe(1);
    expect(res.body.hinweise.some(h => /Größen im Text nicht aufsteigend/.test(h))).toBe(true);
    // Der Prompt ging schon sortiert raus
    expect(generateContent.mock.calls[0][0]).toContain(`- GRÖSSEN: ${AUFSTEIGEND}`);
  });
});
