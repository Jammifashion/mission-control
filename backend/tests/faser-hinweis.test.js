// Befehl F2: Faserangabe mit Prozent fehlt GANZ -> sichtbarer Hinweis.
//
// Ausloeser: keine Faserangabe mit Prozent UND (Groessen-Achse ODER eine
// Material-Zeile ohne Prozent). Nicht-Textilien bleiben still. Hat die
// Nachbedingung (Filter hat die Prozentangabe entfernt) schon gemeldet, kein
// zweiter Hinweis. Nicht blockierend: Text und Meta werden trotzdem gebaut.
// Eine Stelle: materialAusEigenschaften - Prompt- und Meta-Pfad lesen sie.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const getModel        = jest.fn();
const generateContent = jest.fn();
jest.unstable_mockModule('../lib/modelConfig.js', () => ({ getModel }));
jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: () => ({ generateContent }) })),
}));
jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => ({ messages: { create: jest.fn() } })),
}));

let prompt, meta, request, app;
beforeAll(async () => {
  prompt = await import('../lib/seo-prompt.js');
  meta   = await import('../lib/seo-meta.js');
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  app = express();
  app.use(express.json());
  app.use('/api/claude', (await import('../routes/claude.js')).default);
  app.use('/api/seo',    (await import('../routes/seo-meta.js')).default);
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  process.env.GEMINI_API_KEY = 'test-gemini';
  getModel.mockResolvedValue('gemini-3.5-flash-lite');
});
afterEach(() => jest.restoreAllMocks());

const HINWEIS = 'Keine Faserangabe mit Prozent gefunden – Pflichtangabe bei Textilien. '
              + 'Bitte im Feld Eigenschaften ergänzen (z. B. 100 % Baumwolle).';
const TAB = '\t';
const OLDSCHOOL = [
  `Materialzusammensetzung${TAB}100% Baumwolle (Sports Grey: 85% Baumwolle / 15% Viskose)`,
  `Material${TAB}Jersey`,
  `Grammatur in g/m²${TAB}180 g/m²`,
  `Größenlauf${TAB}XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL, 6XL, 7XL, 8XL`,
  `Farbigkeit${TAB}1-farbig`,
].join('\n');
const GROESSEN = ['XS', 'S', 'M', 'L', 'XL'];

// Beide Pfade fuer denselben Fall: Prompt und Meta muessen gleich entscheiden.
function beide({ eigenschaften, farben = ['Schwarz'], groessen = [] }) {
  const p = prompt.buildSeoUserPrompt({ produktname: 'X', modus: 'kollektion', eigenschaften, farben, groessen });
  const m = meta.metaEingaben({ eigenschaften, farben, groessen });
  expect(m.faserHinweis ?? null).toBe(p.faserHinweis);
  return { p, m };
}

test('Wortlaut', () => {
  expect(prompt.FASER_FEHLT_HINWEIS).toBe(HINWEIS);
});

describe('Hinweis', () => {
  test('Groessen-Achse ohne Prozent -> Hinweis', () => {
    const { p, m } = beide({ eigenschaften: 'Schnitt: Regular Fit', groessen: GROESSEN });
    expect(p.faserHinweis).toBe(HINWEIS);
    expect(m.faserHinweis).toBe(HINWEIS);
  });

  test('nur "Material: Jersey" ohne Achse -> Hinweis', () => {
    expect(beide({ eigenschaften: 'Material: Jersey' }).p.faserHinweis).toBe(HINWEIS);
    expect(beide({ eigenschaften: `Material${TAB}Jersey` }).p.faserHinweis).toBe(HINWEIS);
  });

  test('Groessen-Achse und leere Eigenschaften -> Hinweis', () => {
    expect(beide({ eigenschaften: '', groessen: ['S'] }).p.faserHinweis).toBe(HINWEIS);
  });
});

describe('kein Hinweis', () => {
  test('Puck ohne Achse und ohne Material-Zeile', () => {
    const { p, m } = beide({ eigenschaften: 'Durchmesser: 7,6 cm\nGewicht: 165 g', farben: [] });
    expect(p.faserHinweis).toBeNull();
    expect(m).not.toHaveProperty('faserHinweis');           // Antwort wie bisher
  });

  test('echter Oldschool-Text', () => {
    const { p } = beide({ eigenschaften: OLDSCHOOL, farben: ['Rot', 'Schwarz'], groessen: GROESSEN });
    expect(p.faserHinweis).toBeNull();
  });

  test('Faserangabe nur in gefilterter Farbklausel -> bestehende Meldung, KEIN zweiter Hinweis', () => {
    const eig = 'Material: Jersey (Sports Grey: 85% Baumwolle / 15% Viskose)';
    const r = prompt.materialAusEigenschaften(eig, ['Rot'], { groessen: ['S'] });
    expect(r.meldung).toMatch(/keine vollständige Faserangabe/);
    expect(r.faserHinweis).toBeNull();
    const { p, m } = beide({ eigenschaften: eig, farben: ['Rot'], groessen: ['S'] });
    expect(p.meldung).toMatch(/keine vollständige Faserangabe/);
    expect(m.faserMeldung).toMatch(/keine vollständige Faserangabe/);   // Meta: bestehende Meldung
  });
});

describe('nicht blockierend', () => {
  test('Meta wird ohne Faserangabe trotzdem gebaut', () => {
    const e = meta.metaEingaben({ eigenschaften: 'Schnitt: Regular Fit', farben: ['Schwarz'], groessen: ['S', 'XL'] });
    const r = meta.baueMetaBeschreibung({ keyphrase: 'Testshirt', farben: ['Schwarz'], ...e, groessen: ['S', 'XL'], lieferzeit: '21' });
    expect(r.schreiben).toBe(true);
    expect(r.text).toBe('Testshirt in Schwarz. Größen S bis XL, gedruckt nach Bestellung in Wrist.');
    expect(e.faserHinweis).toBe(HINWEIS);
  });

  test('Stand: ohne Prozent-Zeile steht "Jersey" weiter an der Faser-Stelle der Meta (bisheriges Verhalten), Hinweis trotzdem', () => {
    const e = meta.metaEingaben({ eigenschaften: 'Material: Jersey', farben: ['Schwarz'], groessen: ['S', 'XL'] });
    const r = meta.baueMetaBeschreibung({ keyphrase: 'Testshirt', farben: ['Schwarz'], ...e, groessen: ['S', 'XL'], lieferzeit: '21' });
    expect(r.text).toBe('Testshirt in Schwarz, Jersey. Größen S bis XL, gedruckt nach Bestellung in Wrist.');
    expect(e.faserHinweis).toBe(HINWEIS);
  });

  test('Route SEO: Text erzeugt, faser_hinweis eigenes Feld, nicht im roten hinweis', async () => {
    generateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify({
      kurzbeschreibung: '<p>Testshirt mit Motiv.</p>',
      produktbeschreibung: '<h2>Schnitt und Material</h2><p>Testshirt mit Motiv.</p>',
    }) } });
    const res = await request(app).post('/api/claude/generate-product').send({
      action: 'seo_description', produktname: 'Testshirt', modus: 'kollektion',
      eigenschaften: 'Material: Jersey', farben: ['Schwarz'], groessen: ['S', 'M'],
    });
    expect(res.status).toBe(200);
    expect(res.body.full_description).toContain('Testshirt mit Motiv.');
    expect(res.body.faser_hinweis).toBe(HINWEIS);
    expect(res.body.hinweise).not.toContain(HINWEIS);
  });

  test('Route SEO: Oldschool -> faser_hinweis null', async () => {
    generateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify({
      kurzbeschreibung: '<p>x</p>', produktbeschreibung: '<h2>Druck</h2><p>x</p>',
    }) } });
    const res = await request(app).post('/api/claude/generate-product').send({
      action: 'seo_description', produktname: 'Testshirt', modus: 'kollektion',
      eigenschaften: OLDSCHOOL, farben: ['Rot', 'Schwarz'], groessen: GROESSEN,
    });
    expect(res.body.faser_hinweis).toBeNull();
  });

  test('Route meta-eingaben reicht groessen durch', async () => {
    const res = await request(app).post('/api/seo/meta-eingaben')
      .send({ eigenschaften: 'Schnitt: Regular Fit', farben: ['Schwarz'], groessen: ['S', 'M'] });
    expect(res.body.faserHinweis).toBe(HINWEIS);
    const ohne = await request(app).post('/api/seo/meta-eingaben')
      .send({ eigenschaften: 'Schnitt: Regular Fit', farben: ['Schwarz'] });
    expect(ohne.body).not.toHaveProperty('faserHinweis');
  });
});

describe('Frontend-Anbindung', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');

  test('Warn-Toast im SEO-Reiter, nicht im Statustext', () => {
    expect(html).toMatch(/\.toast\.warn\s*\{/);
    expect(html).toContain("if (data.faser_hinweis) showToast(data.faser_hinweis, 'warn'");
    expect(html).not.toMatch(/statusMsg\.textContent\s*=.*faser_hinweis/);
  });

  test('Meta-Vorschau zeigt den Hinweis, meta-eingaben bekommt die Groessen', () => {
    expect(html).toContain('if (st.desc.faserHinweis) dZeilen.push(st.desc.faserHinweis);');
    expect(html).toContain('faserHinweis: ein.faserHinweis || null');
    expect(html).toMatch(/groessen:\s+seoGroessenQuelle\(seoVarianten, seoWcProdukt, seoQuellenOk\)\.groessen,\s*\n\s*\}\),/);
  });
});
