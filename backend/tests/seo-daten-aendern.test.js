// Befehl SE1: Reiter "SEO-Daten aendern".
//
// Jeder veroeffentlichte Artikel, auch ohne SSOT-Zeile. Laden aus dem Shop
// (meta_data), frei aendern, "Titel und Meta neu bauen" mit dem Baustein des
// SEO-Reiters, schreiben ueber DENSELBEN Yoast-Schreibweg (yoastSchreiben).
// Nur geaenderte Felder, leere nie, nichts ins Sheet.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const wc = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient:   jest.fn(() => wc),
}));

let lib, request, app;
beforeAll(async () => {
  lib = await import('../lib/seo-artikel.js');
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  app = express();
  app.use(express.json());
  app.use('/api/seo', (await import('../routes/seo-meta.js')).default);
  app.use('/api/woocommerce', (await import('../routes/woocommerce.js')).default);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

const kw = (id, name, keyphrase, status = 'publish') => ({
  id, name, status, sku: `SKU-${id}`,
  meta_data: keyphrase == null ? [] : [{ id: 1, key: '_yoast_wpseo_focuskw', value: keyphrase }],
});
// 3 Seiten a 100 wuerden reichen; hier 2 Seiten
const SEITE1 = [kw(1, 'Oldschool T-Shirt Herren', 'Crocodiles Hamburg Oldschool T-Shirt Herren'), kw(2, 'Skyline Hoodie', 'Skyline Hoodie')];
const SEITE2 = [kw(3, 'Oldschool T-Shirt Damen', 'crocodiles hamburg oldschool t-shirt herren'), kw(4, 'Puck', null)];

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  lib._resetKeyphraseCache();
  wc.get.mockReset(); wc.put.mockReset(); wc.post.mockReset();
  wc.get.mockImplementation(async (pfad, params = {}) => {
    if (pfad === 'products' && params._fields) {
      return { data: params.page === 1 ? SEITE1 : SEITE2, headers: { 'x-wp-totalpages': '2' } };
    }
    if (pfad === 'products' && params.sku)    return { data: [kw(21044, 'Oldschool T-Shirt Herren', null)] };
    if (pfad === 'products' && params.search) return { data: [kw(21044, 'Oldschool T-Shirt Herren', null), kw(99, 'Entwurf', null, 'draft')] };
    if (pfad === 'products/21044') return { data: kw(21044, 'Oldschool T-Shirt Herren', null) };
    if (pfad === 'products/424242') { const e = new Error('nf'); e.response = { status: 404 }; throw e; }
    return { data: [] };
  });
  wc.put.mockImplementation(async (_p, body) => ({ data: { id: 2, name: 'Skyline Hoodie', meta_data: body.meta_data ?? [] } }));
});
afterEach(() => jest.restoreAllMocks());

// ── Frontend-Bloecke ────────────────────────────────────────────────────────
const html  = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = (a, e) => html.slice(html.indexOf(a), html.indexOf(e));
const SYN   = block('// ── Keyphrase-Synonyme: Anfang', '// ── Keyphrase-Synonyme: Ende ──');
const SE    = block('// ── SEO-Daten aendern: Anfang', '// ── SEO-Daten aendern: Ende ──');
const fe    = new Function(`${SYN}\n${SE}\n return { seAenderungen, seErgebnis, seMetaWert, synonymeZuYoast, synonymeAusYoast };`)();
const aend  = (metaData, eingabe) => fe.seAenderungen({ metaData, eingabe, zuYoast: fe.synonymeZuYoast, ausYoast: fe.synonymeAusYoast });

// Artikel OHNE SSOT-Zeile, Stand im Shop
const SHOP = [
  { key: '_yoast_wpseo_focuskw',         value: 'Oldschool T-Shirt Herren' },
  { key: '_yoast_wpseo_keywordsynonyms', value: '["Oldschool Shirt, Retro T-Shirt"]' },
  { key: '_yoast_wpseo_title',           value: 'Oldschool T-Shirt Herren %%sep%% %%sitename%%' },
  { key: '_yoast_wpseo_metadesc',        value: 'Alt.' },
];
const UNVERAENDERT = {
  keyphrase: 'Oldschool T-Shirt Herren', synonyme: 'Oldschool Shirt, Retro T-Shirt',
  titel: 'Oldschool T-Shirt Herren %%sep%% %%sitename%%', metadesc: 'Alt.',
};

// ════════════════════════════════════════════════════════════════════════════
describe('Auswahl: jeder veroeffentlichte Artikel, auch ohne SSOT-Zeile', () => {
  test('Suche nach Name, SKU und ID - nur veroeffentlichte, ohne Dubletten', async () => {
    const res = await request(app).get('/api/seo/artikel-suche?q=21044');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 21044, name: 'Oldschool T-Shirt Herren', sku: 'SKU-21044', status: 'publish' }]);
    expect(wc.get).toHaveBeenCalledWith('products/21044');
    expect(wc.get).toHaveBeenCalledWith('products', expect.objectContaining({ sku: '21044', status: 'publish' }));
    expect(wc.get).toHaveBeenCalledWith('products', expect.objectContaining({ search: '21044', status: 'publish' }));
  });

  test('unbekannte ID ist kein Fehler', async () => {
    const res = await request(app).get('/api/seo/artikel-suche?q=424242');
    expect(res.status).toBe(200);
  });

  test('Laden fragt die SSOT-Zeile nur an und kommt ohne sie aus', () => {
    const von = html.indexOf('async function seLaden(id)');
    const fn  = html.slice(von, html.indexOf('\n      }', von));
    expect(fn).toContain("/api/sheets/erfassung/by-wc-id?id=${id}");
    expect(fn).toContain(".catch(() => ({}))");
    expect(fn).toContain("'keine SSOT-Zeile'");
  });

  test('Artikel ohne SSOT-Zeile laden und schreiben: Werte aus meta_data, geaenderte Keyphrase wird geschrieben', () => {
    expect(fe.seMetaWert(SHOP, '_yoast_wpseo_focuskw')).toBe('Oldschool T-Shirt Herren');
    expect(fe.synonymeAusYoast(fe.seMetaWert(SHOP, '_yoast_wpseo_keywordsynonyms'))).toBe('Oldschool Shirt, Retro T-Shirt');
    const r = aend(SHOP, { ...UNVERAENDERT, keyphrase: 'Crocodiles Hamburg Oldschool T-Shirt Herren' });
    expect(r.schreiben).toEqual([{ key: '_yoast_wpseo_focuskw', name: 'Fokus-Keyphrase', wert: 'Crocodiles Hamburg Oldschool T-Shirt Herren' }]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Nur geaenderte Felder, leere nie', () => {
  test('nichts geaendert -> nichts zu schreiben, alles "unveraendert"', () => {
    const r = aend(SHOP, UNVERAENDERT);
    expect(r.schreiben).toEqual([]);
    expect(r.meldungen.map(m => m.text)).toEqual([
      'Fokus-Keyphrase: unverändert', 'Synonyme: unverändert', 'SEO-Titel: unverändert', 'Meta-Beschreibung: unverändert',
    ]);
  });

  test('nur ein Feld geaendert -> nur dieses geschrieben', () => {
    const r = aend(SHOP, { ...UNVERAENDERT, metadesc: 'Neu.' });
    expect(r.schreiben).toEqual([{ key: '_yoast_wpseo_metadesc', name: 'Meta-Beschreibung', wert: 'Neu.' }]);
  });

  test('Synonyme: gleiche Liste, andere Leerzeichen -> unveraendert; neue Liste -> Yoast-Format', () => {
    expect(aend(SHOP, { ...UNVERAENDERT, synonyme: ' Oldschool Shirt ,Retro T-Shirt ' }).schreiben).toEqual([]);
    expect(aend(SHOP, { ...UNVERAENDERT, synonyme: 'Oldschool Shirt, Vintage Tee' }).schreiben)
      .toEqual([{ key: '_yoast_wpseo_keywordsynonyms', name: 'Synonyme', wert: '["Oldschool Shirt, Vintage Tee"]' }]);
  });

  test('leeres Synonymfeld -> Bestand bleibt (nichts geschrieben, Meldung mit Grund)', () => {
    const r = aend(SHOP, { ...UNVERAENDERT, synonyme: '  ,  ' });
    expect(r.schreiben).toEqual([]);
    expect(r.meldungen).toContainEqual({ name: 'Synonyme', text: 'Synonyme: nicht geschrieben – Feld leer, Bestand bleibt' });
  });

  test('jedes leere Feld loescht nichts', () => {
    const r = aend(SHOP, { keyphrase: '', synonyme: '', titel: ' ', metadesc: '' });
    expect(r.schreiben).toEqual([]);
    expect(r.meldungen).toHaveLength(4);
  });

  test('Rueckmeldung je Feld: geschrieben / nicht geschrieben mit Grund', () => {
    const schreiben = [
      { key: '_yoast_wpseo_focuskw', name: 'Fokus-Keyphrase', wert: 'Neu' },
      { key: '_yoast_wpseo_title',   name: 'SEO-Titel',       wert: 'T' },
    ];
    expect(fe.seErgebnis(schreiben, [{ key: '_yoast_wpseo_focuskw', value: 'Neu' }, { key: '_yoast_wpseo_title', value: 'X' }]).map(r => r.text))
      .toEqual(['Fokus-Keyphrase: geschrieben', 'SEO-Titel: nicht geschrieben – im Shop steht "X"']);
    expect(fe.seErgebnis(schreiben, null, 'HTTP 500').map(r => r.text))
      .toEqual(['Fokus-Keyphrase: nicht geschrieben – HTTP 500', 'SEO-Titel: nicht geschrieben – HTTP 500']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Keyphrase-Dublette', () => {
  test('gleiche Keyphrase an einem anderen Artikel (Gross/Klein egal) -> mit ID und Name', async () => {
    const res = await request(app).get('/api/seo/keyphrase-dubletten?kw=CROCODILES%20Hamburg%20Oldschool%20T-Shirt%20Herren&ausser=1');
    expect(res.body).toEqual([{ id: 3, name: 'Oldschool T-Shirt Damen', keyphrase: 'crocodiles hamburg oldschool t-shirt herren' }]);
    // nur veroeffentlichte, nur id/name/meta_data
    expect(wc.get).toHaveBeenCalledWith('products', expect.objectContaining({ status: 'publish', _fields: 'id,name,meta_data', per_page: 100 }));
  });

  test('keine Dublette, eigener Artikel zaehlt nicht, leere Keyphrase -> leer', async () => {
    expect((await request(app).get('/api/seo/keyphrase-dubletten?kw=Skyline%20Hoodie&ausser=2')).body).toEqual([]);
    expect((await request(app).get('/api/seo/keyphrase-dubletten?kw=&ausser=2')).body).toEqual([]);
  });

  test('Speicher: zweite Pruefung liest nicht neu; Schreiben zieht den Eintrag nach', async () => {
    await request(app).get('/api/seo/keyphrase-dubletten?kw=Skyline%20Hoodie&ausser=9');
    const aufrufe = wc.get.mock.calls.length;
    await request(app).get('/api/seo/keyphrase-dubletten?kw=Skyline%20Hoodie&ausser=9');
    expect(wc.get.mock.calls.length).toBe(aufrufe);

    // Artikel 2 bekommt eine neue Keyphrase ueber den Yoast-Schreibweg
    await request(app).put('/api/woocommerce/products/2').send({ meta_data: [{ key: '_yoast_wpseo_focuskw', value: 'Neue Phrase' }] });
    expect((await request(app).get('/api/seo/keyphrase-dubletten?kw=Skyline%20Hoodie&ausser=9')).body).toEqual([]);
    expect((await request(app).get('/api/seo/keyphrase-dubletten?kw=neue%20phrase&ausser=9')).body)
      .toEqual([{ id: 2, name: 'Skyline Hoodie', keyphrase: 'Neue Phrase' }]);
  });

  test('Frontend: Hinweis mit ID und Name, ohne Bestaetigung kein Schreiben', () => {
    const von = html.indexOf("getElementById('se-speichern').addEventListener");
    const h   = html.slice(von, html.indexOf('\n      });', von));
    const confirmAt = h.indexOf('await showConfirm(');
    const abbruch   = h.indexOf("if (!ok) {");
    const schreiben = h.indexOf('await yoastSchreiben(');
    expect(confirmAt).toBeGreaterThan(-1);
    expect(h).toContain('${d.id}</strong> – ${d.name}');
    expect(abbruch).toBeGreaterThan(confirmAt);
    expect(h.slice(abbruch, h.indexOf('}', abbruch))).toContain('return;');
    expect(schreiben).toBeGreaterThan(abbruch);
    // Pruefung schlaegt fehl -> auch nichts schreiben
    expect(h).toMatch(/Dubletten-Prüfung fehlgeschlagen[^\n]*\n\s*return;/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Derselbe Baustein, derselbe Schreibweg, kein Sheet', () => {
  const seTeil = html.slice(html.indexOf('// ── SECTION: SEO-Daten aendern (Befehl SE1) ──'),
                            html.indexOf('// ── SECTION: SEO-Flow'));

  test('Titel und Meta neu bauen = gleicher Baustein wie der SEO-Reiter', () => {
    expect(seTeil).toContain('await seoMetaEingabenHolen(document.getElementById(\'se-eigenschaften\').value, seStand.quellen)');
    expect(seTeil).toContain('seoMetaBau({ keyphrase, quellen: seStand.quellen, ein })');
    expect(seTeil).toContain('seoMetaQuellen(varianten, produkt, quellenOk)');
    // SEO-Reiter: dieselben drei Funktionen
    expect(html).toContain('const bau   = seoMetaBau({ keyphrase, quellen: seoMetaQuellen(seoVarianten, seoWcProdukt, seoQuellenOk), ein });');
    expect(html).toContain('seoMetaEingabenStand = await seoMetaEingabenHolen(');
    // Faser-Hinweis (F2) im neuen Reiter
    expect(seTeil).toMatch(/if \(ein\.faserHinweis\)[^\n]*showToast\(ein\.faserHinweis, 'warn'/);
  });

  test('gleiches Ergebnis: seoMetaBau liefert fuer dieselben Eingaben dasselbe wie der SEO-Meta-Block', () => {
    const META = block('// ── SEO-Meta: Anfang', '// ── SEO-Meta: Ende ──');
    const baueFn = html.slice(html.indexOf('function seoMetaBau('), html.indexOf('\n      }', html.indexOf('function seoMetaBau(')) + 8);
    const m = new Function(`${META}\n${baueFn}\n return { seoMetaBau, seoMetaTitel, seoMetaBeschreibung };`)();
    const quellen = { farben: ['Rot', 'Schwarz'], groessen: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'], lieferzeit: '21' };
    const ein     = { faserangabe: '100% Baumwolle', faserMeldung: null, grammatur: '180 g/m²' };
    const keyphrase = 'Crocodiles Hamburg Oldschool T-Shirt Herren';
    const bau = m.seoMetaBau({ keyphrase, quellen, ein });
    expect(bau.titel).toBe(m.seoMetaTitel(keyphrase));
    expect(bau.desc).toEqual(m.seoMetaBeschreibung({ keyphrase, ...quellen, ...ein }));
    expect(bau.desc.text).toBe('Crocodiles Hamburg Oldschool T-Shirt Herren in Rot und Schwarz, 100% Baumwolle, 180 g/m². '
      + 'Größen XS bis 5XL, gedruckt nach Bestellung in Wrist.');
  });

  test('geschrieben wird ueber yoastSchreiben - kein zweiter PUT', () => {
    expect(seTeil).toContain('await yoastSchreiben(p.id, schreiben.map(f => ({ key: f.key, value: f.wert })))');
    expect(seTeil).not.toMatch(/method:\s*'PUT'/);
  });

  test('SEO_Status unveraendert: der Reiter schreibt nichts ins Sheet', () => {
    // Nur Code pruefen - der Warnkommentar nennt SEO_Status ausdruecklich.
    const code = seTeil.split('\n').filter(z => !z.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/SEO_Status|patch-fields|erfassung\/overwrite|method:\s*'POST'/);
  });

  test('keine Texte und kein Sprachmodell', () => {
    expect(seTeil).not.toMatch(/short_description|description:|generate-product|\/api\/claude/);
  });

  test('Reiter-Knopf steht neben "Artikel ändern"', () => {
    expect(html).toMatch(/id="mode-btn-edit">✏️ Artikel ändern<\/button>\s*\n\s*<button class="mode-btn" id="mode-btn-seoedit">/);
  });
});
