// VR1: Reiter Varianten header-basiert. Reine Logik aus utils/varianten-zeilen.js.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  variantenSchluessel, pruefeLShopArticleNr, pruefeVariantenPayload,
  baueVariantenZeilen, varianteAusZeile, variantenSpalten, wcVariationMap,
} from '../utils/varianten-zeilen.js';

const KOPF = ['SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3',
  'Preis', 'Aktiv', 'WC_Variation_ID', 'Google_Farbe', 'LShop_ArticleNr'];
// Dieselben Spalten, andere Reihenfolge, dazu eine fremde Spalte.
const KOPF_GEMISCHT = ['Preis', 'LShop_ArticleNr', 'E2', 'V2', 'SSOT-ID', 'Notiz', 'E1', 'V1',
  'Varianten-Nr', 'Google_Farbe', 'E3', 'V3', 'WC_Variation_ID', 'Aktiv'];

const zeile = (kopf, werte) => kopf.map(h => werte[h] ?? '');
const spalte = (kopf, z, name) => z[kopf.indexOf(name)];

describe('variantenSchluessel', () => {
  test('reihenfolgeunabhaengig: Farbe in E1 oder E2 ergibt denselben Schluessel', () => {
    expect(variantenSchluessel([['Farbe', 'Schwarz'], ['Größe', 'XL']]))
      .toBe(variantenSchluessel([['Größe', 'XL'], ['Farbe', 'Schwarz']]));
  });

  test('trim und Gross/Klein egal', () => {
    expect(variantenSchluessel([[' farbe ', 'SCHWARZ ']])).toBe(variantenSchluessel([['Farbe', 'schwarz']]));
  });

  test('ß: "GRÖSSE" (Grossschreibung von "Größe") trifft "Größe"', () => {
    expect(variantenSchluessel([['GRÖSSE', 'XL']])).toBe(variantenSchluessel([['Größe', 'XL']]));
    expect(variantenSchluessel([['Größe', 'XL']])).toBe(variantenSchluessel([['größe', 'xl']]));
  });

  test('anderer Wert = anderer Schluessel', () => {
    expect(variantenSchluessel([['Größe', 'XL']])).not.toBe(variantenSchluessel([['Größe', 'XXL']]));
  });

  test('Paare ohne Achsennamen zaehlen nicht; ohne Achsen = ""', () => {
    expect(variantenSchluessel([['Farbe', 'Rot'], ['', ''], ['', '']])).toBe('farbe=rot');
    expect(variantenSchluessel([['', ''], ['', '']])).toBe('');
  });
});

describe('pruefeLShopArticleNr', () => {
  test('10 Ziffern ok', () => expect(pruefeLShopArticleNr('1000311706')).toBeNull());
  test('als Zahl uebergeben ebenfalls ok', () => expect(pruefeLShopArticleNr(1000311706)).toBeNull());
  test.each(['100031170', '10003117060', '100031170A', 'ABCDEFGHIJ', '1,00031E+09', '1000311706.0', ''])(
    '%s abgelehnt', w => expect(pruefeLShopArticleNr(w)).toMatch(/10 Ziffern/));
});

describe('pruefeVariantenPayload', () => {
  test('doppelter Schluessel (Achsen vertauscht) -> Fehler mit SSOT-ID', () => {
    expect(() => pruefeVariantenPayload('JFN-2026-0007', [
      { e1: 'Farbe', v1: 'Rot', e2: 'Größe', v2: 'M' },
      { e1: 'Größe', v1: 'm', e2: 'Farbe', v2: 'rot' },
    ])).toThrow(/JFN-2026-0007.*doppelt/);
  });

  test('9-stellige Nummer -> Fehler mit SSOT-ID und Schluessel, status 400', () => {
    let err;
    try { pruefeVariantenPayload('JFN-2026-0007', [{ e1: 'Größe', v1: 'M', lshopArticleNr: '100031170' }]); }
    catch (e) { err = e; }
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/JFN-2026-0007/);
    expect(err.message).toMatch(/"Größe=M"/);
  });

  test('Buchstaben -> Fehler', () => {
    expect(() => pruefeVariantenPayload('X', [{ e1: 'Größe', v1: 'M', lshopArticleNr: '10003117AB' }])).toThrow(/10 Ziffern/);
  });

  test('fehlend und "" sind erlaubt', () => {
    expect(() => pruefeVariantenPayload('X', [
      { e1: 'Größe', v1: 'M' },
      { e1: 'Größe', v1: 'L', lshopArticleNr: '' },
    ])).not.toThrow();
  });
});

describe('baueVariantenZeilen', () => {
  const payload = [
    { nr: 1, e1: 'Farbe', v1: 'Schwarz', e2: 'Größe', v2: 'M', preis: '22', aktiv: true },
    { nr: 2, e1: 'Farbe', v1: 'Schwarz', e2: 'Größe', v2: 'L', preis: '22', aktiv: false },
  ];

  test('Spaltenreihenfolge im Sheet vertauscht -> jeder Wert in seiner Spalte', () => {
    const [z] = baueVariantenZeilen(KOPF_GEMISCHT, 'JFN-1', payload, []);
    expect(z).toHaveLength(KOPF_GEMISCHT.length);
    expect(spalte(KOPF_GEMISCHT, z, 'SSOT-ID')).toBe('JFN-1');
    expect(spalte(KOPF_GEMISCHT, z, 'Varianten-Nr')).toBe(1);
    expect(spalte(KOPF_GEMISCHT, z, 'E1')).toBe('Farbe');
    expect(spalte(KOPF_GEMISCHT, z, 'V2')).toBe('M');
    expect(spalte(KOPF_GEMISCHT, z, 'Preis')).toBe('22');
    expect(spalte(KOPF_GEMISCHT, z, 'Aktiv')).toBe(true);
  });

  test('unbekannte Spalten (LShop_ArticleNr, Notiz) bleiben aus der alten Zeile erhalten', () => {
    const alt = [zeile(KOPF_GEMISCHT, { 'SSOT-ID': 'JFN-1', E1: 'Farbe', V1: 'Schwarz', E2: 'Größe', V2: 'M',
      LShop_ArticleNr: '1000311706', Notiz: 'Charge 3' })];
    const [m, l] = baueVariantenZeilen(KOPF_GEMISCHT, 'JFN-1', payload, alt);
    expect(spalte(KOPF_GEMISCHT, m, 'LShop_ArticleNr')).toBe('1000311706');
    expect(spalte(KOPF_GEMISCHT, m, 'Notiz')).toBe('Charge 3');
    expect(spalte(KOPF_GEMISCHT, l, 'LShop_ArticleNr')).toBe('');
  });

  test('Achsen in anderer Reihenfolge als im Bestand -> Wert bleibt erhalten', () => {
    const alt = [zeile(KOPF, { 'SSOT-ID': 'JFN-1', E1: 'Größe', V1: 'M', E2: 'Farbe', V2: 'Schwarz',
      LShop_ArticleNr: '1000311706' })];
    const [m] = baueVariantenZeilen(KOPF, 'JFN-1', payload, alt);
    expect(spalte(KOPF, m, 'LShop_ArticleNr')).toBe('1000311706');
    expect(spalte(KOPF, m, 'E1')).toBe('Farbe');   // Payload gewinnt fuer bekannte Felder
  });

  test('neue Kombination -> leer, entfernte Kombination -> verschwindet', () => {
    const alt = [
      zeile(KOPF, { 'SSOT-ID': 'JFN-1', E1: 'Farbe', V1: 'Schwarz', E2: 'Größe', V2: 'M', LShop_ArticleNr: '1000000001' }),
      zeile(KOPF, { 'SSOT-ID': 'JFN-1', E1: 'Farbe', V1: 'Schwarz', E2: 'Größe', V2: '5XL', LShop_ArticleNr: '1000000009' }),
    ];
    const neu = baueVariantenZeilen(KOPF, 'JFN-1', payload, alt);
    expect(neu).toHaveLength(2);
    expect(neu.map(z => spalte(KOPF, z, 'LShop_ArticleNr'))).toEqual(['1000000001', '']);
    expect(neu.flat()).not.toContain('1000000009');
  });

  test('LShop_ArticleNr aus dem Payload wird als String geschrieben; "" leert', () => {
    const alt = [zeile(KOPF, { 'SSOT-ID': 'JFN-1', E1: 'Farbe', V1: 'Schwarz', E2: 'Größe', V2: 'L', LShop_ArticleNr: '1000000002' })];
    const [m, l] = baueVariantenZeilen(KOPF, 'JFN-1',
      [{ ...payload[0], lshopArticleNr: 1000311706 }, { ...payload[1], lshopArticleNr: '' }], alt);
    expect(spalte(KOPF, m, 'LShop_ArticleNr')).toBe('1000311706');
    expect(typeof spalte(KOPF, m, 'LShop_ArticleNr')).toBe('string');
    expect(spalte(KOPF, l, 'LShop_ArticleNr')).toBe('');
  });

  test('doppelter Schluessel im Bestand -> Fehler 409 mit SSOT-ID', () => {
    const z = zeile(KOPF, { 'SSOT-ID': 'JFN-1', E1: 'Größe', V1: 'M' });
    expect(() => baueVariantenZeilen(KOPF, 'JFN-1', [{ e1: 'Größe', v1: 'M' }], [z, [...z]]))
      .toThrow(expect.objectContaining({ status: 409, message: expect.stringMatching(/JFN-1.*doppelt/) }));
  });

  test('Pflichtspalte fehlt -> laut', () => {
    const ohne = KOPF.filter(h => h !== 'WC_Variation_ID');
    expect(() => baueVariantenZeilen(ohne, 'JFN-1', payload, [])).toThrow(/WC_Variation_ID/);
  });
});

describe('varianteAusZeile', () => {
  test('liest ueber Namen, LShop_ArticleNr immer als String', () => {
    const idx = variantenSpalten(KOPF_GEMISCHT, 't');
    const v = varianteAusZeile(zeile(KOPF_GEMISCHT, { 'Varianten-Nr': '3', E1: 'Größe', V1: 'XL', Preis: '24',
      Aktiv: 'TRUE', WC_Variation_ID: '10505', LShop_ArticleNr: 1000311706 }), idx);
    expect(v).toMatchObject({ nr: 3, e1: 'Größe', v1: 'XL', preis: 24, aktiv: true, wcVariationId: 10505,
      lshopArticleNr: '1000311706' });
  });

  test('ohne Spalte LShop_ArticleNr -> ""', () => {
    const k = KOPF.slice(0, -1);
    expect(varianteAusZeile(zeile(k, { E1: 'Größe' }), variantenSpalten(k, 't')).lshopArticleNr).toBe('');
  });
});

describe('Auftragsmonitor: wcVariationMap liest ueber Namen', () => {
  test('Spalten vertauscht -> richtige Zuordnung', () => {
    const map = wcVariationMap([
      KOPF_GEMISCHT,
      zeile(KOPF_GEMISCHT, { 'SSOT-ID': 'JFN-9', WC_Variation_ID: '4711', E1: 'Farbe', V1: 'Rot', E2: 'Größe', V2: 'S' }),
      zeile(KOPF_GEMISCHT, { 'SSOT-ID': 'JFN-9', WC_Variation_ID: '0' }),
      zeile(KOPF_GEMISCHT, { 'SSOT-ID': 'JFN-9', WC_Variation_ID: '' }),
    ], 't');
    expect(Object.keys(map)).toEqual(['4711']);
    expect(map['4711']).toEqual({ ssotId: 'JFN-9', e1: 'Farbe', v1: 'Rot', e2: 'Größe', v2: 'S', e3: '', v3: '' });
  });

  test('auftragsmonitor.js nutzt wcVariationMap, keine festen Varianten-Indizes/Ranges', () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../routes/auftragsmonitor.js'), 'utf8');
    expect(src.match(/wcVariationMap\(varResp\.data\.values/g)).toHaveLength(2);
    expect(src).not.toMatch(/TAB_VAR\}!A1:L/);
    expect(src).not.toMatch(/const VI\s*=/);
  });
});
