// ZW2 Teil A: JFN-Kurzfassung - Satzvergleich (Backend + Spiegel im Frontend), Produktdetails 1:1, Aktion seo_kurzfassung
// mit KI-Attrappe (ein zweiter Lauf bei gleichen Saetzen), Verdrahtung im SEO-Reiter. Nur erfundene Texte.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const textAufruf = jest.fn();
class KiAbgeschnittenError extends Error {}
class KiAbgelehntError extends Error {}
jest.unstable_mockModule('../lib/modellAufruf.js', () => ({
  textAufruf, schluesselFehlt: () => null, KiAbgeschnittenError, KiAbgelehntError,
}));
jest.unstable_mockModule('../lib/modelConfig.js', () => ({ getModel: jest.fn(async () => 'claude-haiku-5-5') }));
const pruefeTextMitSsot = jest.fn(async () => []);
jest.unstable_mockModule('../lib/seo-pruefung.js', () => ({ pruefeTextMitSsot, sperrKontext: jest.fn(), sperrTreffer: jest.fn(() => []) }));

const K = await import('../utils/kurzfassung.js');
const request = (await import('supertest')).default;
const express = (await import('express')).default;
const app = express();
app.use(express.json());
app.use('/api/claude', (await import('../routes/claude.js')).default);

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = (a, e) => html.slice(html.indexOf(a), html.indexOf(e));
const FE = new Function(`${block('// ── Satzvergleich: Anfang', '// ── Satzvergleich: Ende ──')}\n return { svSaetze, svGleich, svPaare, svNorm };`)();

const VOLL = [
  '<h2>Warmer Sweater mit Wintermotiv</h2>',
  '<p>Der Testpulli bringt dich gut durch kalte Abende. Vorne prangt ein großes Rentier aus Lebkuchen.</p>',
  '<h3>Produktdetails</h3>',
  '<ul>\n<li><strong>Material:</strong> 80 % Baumwolle, 20 % Polyester</li>\n<li><strong>Größen:</strong> S, M, L</li>\n</ul>',
  '<p>Pack ihn ein, bevor es schneit.</p>',
].join('\n');
const KURZ_VOLL = 'Testpulli mit Rentier aus Lebkuchen – jetzt bestellen.';

describe('Satzvergleich', () => {
  test('Listenpunkte (Produktdetails) zaehlen nicht, kurze Saetze auch nicht, Satzzeichen/Gross egal', () => {
    const s = K.satzListe(VOLL).map(x => x.text);
    expect(s).toContain('Der Testpulli bringt dich gut durch kalte Abende.');
    expect(s.join(' ')).not.toMatch(/Baumwolle/);
    expect(s).not.toContain('Produktdetails');
    expect(K.gleicheSaetze('<p>der testpulli BRINGT dich gut durch kalte Abende!</p>', VOLL)).toHaveLength(1);
    expect(K.gleicheSaetze('<p>Ein ganz anderer Satz über den Pulli hier.</p>', VOLL)).toEqual([]);
  });

  test('Spiegel im Frontend rechnet gleich', () => {
    const proben = [VOLL, '<p>Erster Satz hat genug Wörter. Zweiter&nbsp;Satz – mit „Zeichen“ drin!</p>', KURZ_VOLL, '<h2>Ganz kurz</h2>'];
    for (const p of proben) {
      expect(FE.svSaetze(p)).toEqual(K.satzListe(p));
      for (const q of proben) expect(FE.svGleich(p, q)).toEqual(K.gleicheSaetze(p, q));
    }
    const paar = { jfnKurz: KURZ_VOLL, jfnLang: VOLL, honkKurz: KURZ_VOLL, honkLang: VOLL };
    expect(FE.svPaare(paar)).toEqual(K.gleicheSaetzePaare(paar));
  });

  test('Produktdetails-Block wird 1:1 uebernommen, Teile des Modells ohne HTML', () => {
    const d = K.detailsBlock(VOLL);
    expect(d).toMatch(/^<h3>Produktdetails<\/h3>\s*<ul>[\s\S]*<\/ul>$/);
    const l = K.baueKurzfassung({ h2: 'Rentier <b>Sweater</b>', einleitung: 'Neu & warm.', abschluss: '', details: d });
    expect(l).toBe(`<h2>Rentier Sweater</h2>\n<p>Neu &amp; warm.</p>\n${d}`);
    expect(K.detailsBlock('<p>ohne</p>')).toBe('');
  });
});

describe('POST /api/claude/generate-product seo_kurzfassung', () => {
  const antwort = o => ({ text: JSON.stringify({ h2: 'Lebkuchen-Rentier für kalte Tage', abschluss: 'Gleich mitnehmen.',
    kurzbeschreibung: 'Rentier-Sweater mit Lebkuchenmotiv.', ...o }) });
  beforeEach(() => { textAufruf.mockReset(); jest.spyOn(console, 'warn').mockImplementation(() => {}); });

  test('eigene Saetze: ein Lauf, Produktdetails aus der vollen Fassung, keine gleichen Saetze', async () => {
    textAufruf.mockResolvedValueOnce(antwort({ einleitung: 'Dieser Sweater mit Rentier hält warm. Das Motiv zeigt Lebkuchen.' }));
    const r = await request(app).post('/api/claude/generate-product').send({ action: 'seo_kurzfassung', produktname: 'Testpulli',
      keyphrase: 'Sweater mit Rentier', full_description: VOLL, short_description: KURZ_VOLL });
    expect(r.status).toBe(200);
    expect(textAufruf).toHaveBeenCalledTimes(1);
    expect(r.body.full_description).toContain(K.detailsBlock(VOLL));
    expect(r.body.gleicheSaetze).toEqual([]);
    expect(r.body.versuch).toBe(1);
    expect(textAufruf.mock.calls[0][0].prompt).toContain('VOLLER TEXT (nicht wiederholen)');
  });

  test('gleicher Satz -> genau ein zweiter Lauf mit dem Satz als verboten; bleibt er, steht er in gleicheSaetze', async () => {
    const doppelt = 'Der Testpulli bringt dich gut durch kalte Abende.';
    textAufruf.mockResolvedValue(antwort({ einleitung: doppelt }));
    const r = await request(app).post('/api/claude/generate-product').send({ action: 'seo_kurzfassung', produktname: 'Testpulli',
      full_description: VOLL, short_description: KURZ_VOLL });
    expect(textAufruf).toHaveBeenCalledTimes(2);
    expect(textAufruf.mock.calls[1][0].prompt).toContain(`- ${doppelt}`);
    expect(r.body.versuch).toBe(2);
    expect(r.body.gleicheSaetze).toEqual([doppelt]);
  });

  test('volle Fassung ohne Produktdetails -> 422, kein KI-Aufruf', async () => {
    const r = await request(app).post('/api/claude/generate-product').send({ action: 'seo_kurzfassung', produktname: 'X', full_description: '<p>nur Text</p>' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('details_fehlen');
    expect(textAufruf).not.toHaveBeenCalled();
  });
});

describe('SEO-Reiter: Verdrahtung', () => {
  test('Knopf mit Mouse-over, zwei Paare nur mit Zwilling, Speichern in beide Shops', () => {
    expect(html).toMatch(/id="btn-seo-kurz"[^>]*data-hilfe="seo-kurzfassung"/);
    expect(html).toMatch(/'seo-kurzfassung':\s*\{ name:/);
    const f = block('async function seoArtikelOeffnen(item)', '// ── SG2: Material-Pflichtfeld');
    expect(f).toContain("document.getElementById('seo-jfn-block').hidden = !mitZwilling;");
    expect(f).toContain('?shop=honk');
    const save = block("document.getElementById('btn-seo-save').addEventListener", '// ── Bestehende Varianten');
    expect(save).toContain('short_description: jfnKurz,');
    expect(save).toMatch(/products\/\$\{encodeURIComponent\(zw\)\}\?shop=honk`, \{\s*method: 'PUT'/);
    expect(save).toContain("['_yoast_wpseo_focuskw', '_yoast_wpseo_title', '_yoast_wpseo_metadesc']");
    expect(save).not.toMatch(/keywordsynonyms'[^\n]*shop=honk/);
    expect(save).toContain('svPaare(');
  });
});
