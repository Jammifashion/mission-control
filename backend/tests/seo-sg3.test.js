// SG3: Material bei Nicht-Textil ohne Prozent, SEO liest SKU_Extern (Fremdware). Nur erfundene Werte.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: () => ({ spreadsheets: { values: { get: async () => ({ data: { values: [] } }) } } }) },
}));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));

const sp = await import('../lib/seo-prompt.js');
const ex = await import('../utils/sku-extern.js');
const { externFuerNummer, ladeExternZeilen } = await import('../lib/skuExtern.js');

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const QUELLE_CLAUDE = readFileSync(resolve(hier, '../routes/claude.js'), 'utf8');
const QUELLE_UTIL = readFileSync(resolve(hier, '../utils/sku-extern.js'), 'utf8');
const QUELLE_LIB = readFileSync(resolve(hier, '../lib/skuExtern.js'), 'utf8');
const block = html.slice(html.indexOf('// ── Platzhalter: Anfang ──'), html.indexOf('// ── Platzhalter: Ende ──'));
const F = new Function(`${block}\nreturn { materialHandPruefen, ersetzeMaterialPlatzhalter, materialProzentPflicht, PH_TEXTIL_RE };`)();

// Reiter SKU_Extern (erfunden): Tasse, Fremd-Shirt, Zeile ohne Material
const KOPF = ['ArticleNr', 'CatalogNr', 'Description', 'Lieferant', 'Consistence', 'Weight', 'Masse', 'Volumen', 'Eigenschaften_Shop', 'Lieferzeit_ID', 'Nur_intern'];
const ZEILEN = [
  ['PROBE-TASSE', 'PT', 'Tasse weiß', 'Geheimlieferant GmbH', 'Keramik', '330', 'Höhe 9,5 cm, Ø 8 cm', '330 ml', 'spülmaschinenfest; mikrowellengeeignet', '1203', 'Marke Geheimcode ZX-9, nie nennen'],
  ['PROBE-SHIRT', 'PS', 'Fremd-Shirt', 'Geheimlieferant GmbH', 'Baumwolle', '', '', '', '', '', 'intern'],
  ['PROBE-LEER', 'PL', 'Ohne Material', 'X', '', '', '', '', '', 'abc', ''],
];
/** Sheets-Attrappe: Kopfzeile ueber get, Spalten ueber batchGet (wie lib/ssot-reiter.js liest). Merkt die gelesenen Spalten. */
function sheetsMit(kopf = KOPF, zeilen = ZEILEN) {
  const gelesen = [];
  const spalte = b => b.match(/!([A-Z]+)2:/)[1].split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return {
    gelesen,
    spreadsheets: { values: {
      get: async () => ({ data: { values: [kopf] } }),
      batchGet: async ({ ranges }) => ({ data: { valueRanges: ranges.map(r => { const i = spalte(r); gelesen.push(kopf[i]); return { values: [zeilen.map(z => z[i] ?? '')] }; }) } }),
    } },
  };
}
const opt = sheets => ({ sheets, spreadsheetId: 'x' });

describe('Materialpruefung: Prozentpflicht nur fuer Textil', () => {
  test('Textil (Standard): ohne Prozent Fehler wie bisher, mit Prozent ok - Backend und Spiegel gleich', () => {
    for (const f of [sp.materialHandPruefen, F.materialHandPruefen]) {
      expect(f('Keramik')).toEqual({ faser: null, fehler: 'Material: bitte mit Prozent angeben, z. B. 100 % Polyacryl.' });
      expect(f('Baumwolle', { textil: true }).fehler).toMatch(/mit Prozent/);
      expect(f('100 % Baumwolle')).toEqual({ faser: '100 % Baumwolle', fehler: null });
      expect(f('100% Keramik')).toEqual({ faser: '100% Keramik', fehler: null });   // Fund Inhaber: mit Prozent immer gueltig
      expect(f('')).toEqual({ faser: null, fehler: null });
    }
  });
  test('Nicht-Textil: ein Materialwort genuegt, Text mit Prozent bleibt gueltig', () => {
    for (const f of [sp.materialHandPruefen, F.materialHandPruefen]) {
      for (const w of ['Keramik', 'Edelstahl', 'Polymer', 'Kork', 'Kunststoff (BPA-frei)', 'Acrylglas', '100 % Keramik'])
        expect(f(w, { textil: false })).toEqual({ faser: w, fehler: null });
    }
  });
  test('Nicht-Textil: Textilfaser ohne Prozent bleibt Fehler, Unsinn und Klammern auch', () => {
    for (const f of [sp.materialHandPruefen, F.materialHandPruefen]) {
      expect(f('Baumwolle', { textil: false }).fehler).toBe('Material: Textilfaser bitte mit Prozent angeben, z. B. 100 % Baumwolle.');
      expect(f('Polyester und Elasthan', { textil: false }).fehler).toMatch(/Textilfaser/);
      expect(f('80 % Baumwolle, 20 % Polyester', { textil: false }).fehler).toBeNull();
      expect(f('12', { textil: false }).fehler).toBe('Material: bitte ein Material nennen, z. B. Keramik.');
      expect(f('<b>Keramik</b>', { textil: false }).fehler).toMatch(/Klammern/);
      expect(f('x'.repeat(201), { textil: false }).fehler).toMatch(/200 Zeichen/);
    }
  });
  test('Platzhalter ersetzen: Keramik nur bei Nicht-Textil', () => {
    const ein = '<li><strong>Material:</strong> [Material: bitte ergänzen]</li>';
    for (const f of [sp.ersetzeMaterialPlatzhalter, F.ersetzeMaterialPlatzhalter]) {
      expect(f(ein, 'Keramik')).toEqual({ html: ein, ersetzt: 0 });
      expect(f(ein, 'Keramik', { textil: false })).toEqual({ html: '<li><strong>Material:</strong> Keramik</li>', ersetzt: 1 });
    }
  });
  test('Textilfaser-Muster ist im Frontend wortgleich gespiegelt', () => {
    expect(F.PH_TEXTIL_RE.source).toBe(ex.TEXTIL_FASER_RE.source);
    expect(F.PH_TEXTIL_RE.flags).toBe(ex.TEXTIL_FASER_RE.flags);
  });
});

describe('prozentPflicht', () => {
  const tasse = { textil: false }, shirt = { textil: true };
  test('Fremdware ohne Textilfaser und ohne Groessen: keine Pflicht', () => {
    for (const f of [ex.prozentPflicht, F.materialProzentPflicht]) {
      expect(f({ extern: tasse, groessen: [] })).toBe(false);
      expect(f({ extern: tasse })).toBe(false);
    }
  });
  test('Pflicht bleibt: unbekannte Nummer, Fremdware mit Textilfaser, Groessen-Achse', () => {
    for (const f of [ex.prozentPflicht, F.materialProzentPflicht]) {
      expect(f({ extern: null, groessen: [] })).toBe(true);
      expect(f({})).toBe(true);
      expect(f({ extern: shirt, groessen: [] })).toBe(true);
      expect(f({ extern: tasse, groessen: ['S', 'M'] })).toBe(true);
    }
  });
});

describe('SKU_Extern lesen', () => {
  test('Tasse: Material, Zeilen fuer den Generator, Lieferzeit - ueber ArticleNr (ohne Gross/Klein) und CatalogNr', async () => {
    const soll = {
      nr: 'PROBE-TASSE', material: 'Keramik', textil: false, lieferzeitId: '1203',
      zeilen: ['Gewicht: 330 g', 'Maße: Höhe 9,5 cm, Ø 8 cm', 'Volumen: 330 ml', 'Eigenschaften: spülmaschinenfest', 'Eigenschaften: mikrowellengeeignet'],
    };
    expect(await externFuerNummer('PROBE-TASSE', opt(sheetsMit()))).toEqual(soll);
    expect(await externFuerNummer(' probe-tasse ', opt(sheetsMit()))).toEqual(soll);
    expect(await externFuerNummer('PT', opt(sheetsMit()))).toEqual(soll);
  });
  test('Nur_intern und Lieferant werden nie gelesen und stehen nie in der Antwort', async () => {
    const s = sheetsMit();
    const e = await externFuerNummer('PROBE-TASSE', opt(s));
    expect(s.gelesen).not.toContain('Nur_intern');
    expect(s.gelesen).not.toContain('Lieferant');
    expect(JSON.stringify(e)).not.toMatch(/Geheim|ZX-9|nie nennen/);
    for (const n of ex.NIE_LESEN) {
      expect(Object.values({ ...ex.SPALTEN_EXTERN, ...ex.OPTIONAL_EXTERN })).not.toContain(n);
      expect(QUELLE_LIB).not.toContain(n === 'Lieferant' ? "'Lieferant'" : "'Nur_intern'");
    }
  });
  test('unbekannte Nummer = null; Fremd-Shirt = Textil; kaputte Lieferzeit faellt weg; fehlende Spalten = leere Felder', async () => {
    expect(await externFuerNummer('GIBTSNICHT', opt(sheetsMit()))).toBeNull();
    expect(await externFuerNummer('', opt(sheetsMit()))).toBeNull();
    expect((await externFuerNummer('PROBE-SHIRT', opt(sheetsMit()))).textil).toBe(true);
    expect((await externFuerNummer('PROBE-LEER', opt(sheetsMit()))).lieferzeitId).toBe('');
    const alt = sheetsMit(['ArticleNr', 'CatalogNr', 'Description'], [['PROBE-TASSE', 'PT', 'Tasse']]);
    expect(await externFuerNummer('PROBE-TASSE', opt(alt))).toEqual({ nr: 'PROBE-TASSE', material: '', textil: false, zeilen: [], lieferzeitId: '' });
    expect((await ladeExternZeilen(opt(alt))).length).toBe(1);
  });
});

describe('Generator: Tasse aus SKU_Extern', () => {
  test('Material "Keramik" ohne Prozent im Prompt, Angaben aus SKU_Extern dabei, kein Platzhalter, kein Faser-Hinweis', async () => {
    const extern = await externFuerNummer('PROBE-TASSE', opt(sheetsMit()));
    const textil = ex.prozentPflicht({ extern, groessen: [] });
    const hand = sp.materialHandPruefen(extern.material, { textil });
    expect(hand).toEqual({ faser: 'Keramik', fehler: null });
    const { prompt, faserHinweis } = sp.buildSeoUserPrompt({
      produktname: 'Tasse Probe', kategorien: 'Tassen', modus: 'kollektion', farben: [], groessen: [],
      eigenschaften: ex.eigenschaftenMitExtern('Druck: Sublimation', extern), materialHand: hand.faser, materialTextil: textil,
    });
    expect(prompt).toContain('Keramik');
    expect(prompt).toContain('330 ml');
    expect(prompt).toContain('spülmaschinenfest');
    expect(prompt).not.toContain(sp.MATERIAL_PLACEHOLDER);
    expect(prompt).not.toMatch(/Geheim|ZX-9|nie nennen/);
    expect(faserHinweis).toBeNull();
  });
  test('Textil ohne Prozent: Handeingabe zaehlt nicht (Platzhalter bleibt), mit Prozent steht sie im Prompt', () => {
    const basis = { produktname: 'Shirt Probe', kategorien: 'Shirts', modus: 'kollektion', farben: ['Black'], groessen: ['S', 'M'], eigenschaften: '' };
    expect(sp.buildSeoUserPrompt({ ...basis, materialHand: 'Baumwolle' }).prompt).toContain(sp.MATERIAL_PLACEHOLDER);
    const ok = sp.buildSeoUserPrompt({ ...basis, materialHand: '100 % Baumwolle' }).prompt;
    expect(ok).toContain('100 % Baumwolle');
    expect(ok).not.toContain(sp.MATERIAL_PLACEHOLDER);
  });
  test('eigenschaftenMitExtern: Freitext gewinnt bei gleichem Label, ohne Fremdware unveraendert', () => {
    const e = { zeilen: ['Gewicht: 330 g', 'Volumen: 330 ml', 'Eigenschaften: spülmaschinenfest'] };
    expect(ex.eigenschaftenMitExtern('Volumen: 300 ml\nDruck: rundum', e)).toBe('Gewicht: 330 g\nEigenschaften: spülmaschinenfest\nVolumen: 300 ml\nDruck: rundum');
    expect(ex.eigenschaftenMitExtern('Druck: rundum', null)).toBe('Druck: rundum');
    expect(ex.eigenschaftenMitExtern('', e)).toBe('Gewicht: 330 g\nVolumen: 330 ml\nEigenschaften: spülmaschinenfest');
  });
  test('Route: SKU_Extern wird gelesen, Prozentpflicht entschieden, Material ungueltig bleibt 400', () => {
    expect(QUELLE_CLAUDE).toContain('extern = await externFuerNummer(lshopNr);');
    expect(QUELLE_CLAUDE).toContain('const textil = prozentPflicht({ extern, groessen });');
    expect(QUELLE_CLAUDE).toContain('const hand = materialHandPruefen(handRoh, { textil });');
    expect(QUELLE_CLAUDE).toContain("if (hand.fehler) return res.status(400).json({ error: hand.fehler, code: 'material' });");
    expect(QUELLE_CLAUDE).toContain('eigenschaften: eigenschaftenMitExtern(eigenschaften, extern),');
    expect(QUELLE_UTIL).not.toMatch(/nurIntern|lieferant\s*:/);
  });
});

describe('Oberflaeche', () => {
  test('SEO-Reiter: Anzeige "Fremdware: Angaben aus SKU_Extern (…)", Feld vorbelegt, ohne Alarm', () => {
    expect(html).toContain('`Fremdware: Angaben aus SKU_Extern (${seoExtern.nr})`');
    expect(html).toContain("if (ausExtern && !feld.value.trim()) feld.value = ausExtern;");
    expect(html).toContain("wrap.classList.toggle('seo-material-ruhig', !!seoExtern && !seoMaterialFehlt && !p.length);");
    expect(html).toContain('seoMaterialFehlt = !!nr && !seoMaterialFaser && !ausExtern;');   // unbekannte Nummer ohne SKU_Extern = Pflichtfeld wie bisher
  });
  test('Maske: Lieferzeit aus SKU_Extern nur als Vorschlag (Standard bzw. leer), nie ueber eine Handwahl', () => {
    const a = html.indexOf('function lzVorschlagAusExtern('), b = html.indexOf('// Aenderungspfad: gesendet wird nur', a);
    const lz = new Function(`${html.slice(a, b)}\nreturn lzVorschlagAusExtern;`)();
    const liste = [{ id: 1201, name: 'Standard', standard: true }, { id: 1203, name: 'Fremdware 7–10 Tage' }];
    const sel = v => ({ value: v, n: 0, dispatchEvent() { this.n++; } });
    globalThis.Event = globalThis.Event ?? class { constructor(t) { this.type = t; } };
    let s = sel('1201');
    expect(lz('1203', liste, s)).toBe('Lieferzeit vorgeschlagen: Fremdware 7–10 Tage.');
    expect(s.value).toBe('1203'); expect(s.n).toBe(1);
    s = sel('');
    expect(lz('1203', liste, s)).toMatch(/vorgeschlagen/);
    s = sel('1205');   // von Hand gewaehlt
    expect(lz('1203', liste, s)).toBe(''); expect(s.value).toBe('1205');
    s = sel('1201');
    expect(lz('9999', liste, s)).toBe(''); expect(lz('', liste, s)).toBe(''); expect(s.value).toBe('1201');   // Term nicht im Reiter
  });
});
