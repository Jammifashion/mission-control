// Woher die Größen im SEO-Modus kommen.
//
// Anders als bei anfrage-widget/service-worker laesst sich das hier wirklich
// ausfuehren: die Entscheidungslogik steht in index.html in einem markierten
// Block, der bewusst nichts aus dem Seitenkontext benutzt (kein document, keine
// Modul-Variablen). Dieser Test schneidet den Block heraus und fuehrt ihn aus -
// die vier Faelle sind Verhalten, kein Quelltextabgleich.
//
// Hintergrund: fallen die Groessen still weg, schreibt das Modell einen Text
// ohne Groessenangabe, und niemand sieht es. Genau das ist vorher passiert -
// das Attribut heisst im Shop "Größe", und /gr(ö|oe)ss?e/ trifft das ß nicht.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const html = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'),
  'utf8',
);

const START = '// ── SEO-Größenquelle: Anfang';
const ENDE  = '// ── SEO-Größenquelle: Ende ──';
const von   = html.indexOf(START);
const bis   = html.indexOf(ENDE);
const block = html.slice(von, bis);

const {
  GROESSEN_ATTR_RE, FARB_ATTR_RE,
  seoWerteAusVarianten, seoWerteAusWcProdukt, seoGroessenQuelle, SEO_GROESSEN_TEXT,
} = new Function(`${block}
  return {
    GROESSEN_ATTR_RE, FARB_ATTR_RE,
    seoWerteAusVarianten, seoWerteAusWcProdukt, seoGroessenQuelle, SEO_GROESSEN_TEXT,
  };`)();

// Varianten-Zeile aus [[Eigenschaft, Wert], ...]
const variante = (paare, aktiv = true) => ({
  e1: paare[0]?.[0] ?? '', v1: paare[0]?.[1] ?? '',
  e2: paare[1]?.[0] ?? '', v2: paare[1]?.[1] ?? '',
  e3: paare[2]?.[0] ?? '', v3: paare[2]?.[1] ?? '',
  aktiv,
});

const WC_MIT_GROESSEN = {
  id: 7,
  attributes: [
    { name: 'Farbe', options: ['Navy', 'Schwarz'] },
    { name: 'Größe', options: ['S', 'M', 'L'] },
  ],
};
const WC_OHNE_GROESSEN = { id: 7, attributes: [{ name: 'Farbe', options: ['Navy'] }] };
const ALLES_LESBAR = { varianten: true, wc: true };

test('der Logikblock wurde gefunden und benutzt nichts aus dem Seitenkontext', () => {
  expect(von).toBeGreaterThan(-1);
  expect(bis).toBeGreaterThan(von);
  expect(block).not.toMatch(/document\.|apiFetch|seoVarianten|seoWcProdukt|seoQuellenOk/);
});

describe('1. Größen aus dem Varianten-Reiter', () => {
  test('Attribut "Größe" wird erkannt, Quelle ist "varianten"', () => {
    const vs = [variante([['Farbe', 'Navy'], ['Größe', 'S']]),
                variante([['Farbe', 'Navy'], ['Größe', 'M']])];
    const r = seoGroessenQuelle(vs, WC_MIT_GROESSEN, ALLES_LESBAR);

    expect(r.quelle).toBe('varianten');
    expect(r.groessen).toEqual(['S', 'M']);
  });

  test('Regression: die alte Fassung traf "Größe" nicht', () => {
    // ß ist EIN Zeichen, nicht "ss" - damit lief Schritt 1 ins Leere.
    expect(/gr(ö|oe)ss?e|size/i.test('Größe')).toBe(false);
    expect(GROESSEN_ATTR_RE.test('Größe')).toBe(true);
  });

  test('Schreibweisen des Attributnamens', () => {
    for (const name of ['Größe', 'Größen', 'Grösse', 'Groesse', 'Size', 'Sizes', 'größe']) {
      expect(GROESSEN_ATTR_RE.test(name)).toBe(true);
    }
    expect(GROESSEN_ATTR_RE.test('Farbe')).toBe(false);
  });

  test('der Reiter schlägt WooCommerce', () => {
    const r = seoGroessenQuelle([variante([['Größe', 'S']])], WC_MIT_GROESSEN, ALLES_LESBAR);

    expect(r.quelle).toBe('varianten');
    expect(r.groessen).toEqual(['S']);
  });

  test('angeboten = aktive Varianten; ist keine aktiv, zählen alle', () => {
    const gemischt = [variante([['Größe', 'S']], false), variante([['Größe', 'M']], true)];
    expect(seoGroessenQuelle(gemischt, null, ALLES_LESBAR).groessen).toEqual(['M']);

    const nurInaktiv = [variante([['Größe', 'S']], false)];
    expect(seoGroessenQuelle(nurInaktiv, null, ALLES_LESBAR).groessen).toEqual(['S']);
  });

  test('Dubletten fliegen raus, Schreibweise egal', () => {
    const vs = [variante([['Größe', 'S']]), variante([['Größe', 's']])];
    expect(seoGroessenQuelle(vs, null, ALLES_LESBAR).groessen).toEqual(['S']);
  });
});

describe('2. Varianten leer → WooCommerce', () => {
  test('leerer Reiter, WooCommerce hat Größen', () => {
    const r = seoGroessenQuelle([], WC_MIT_GROESSEN, ALLES_LESBAR);

    expect(r.quelle).toBe('woocommerce');
    expect(r.groessen).toEqual(['S', 'M', 'L']);
  });

  test('keine SSOT-ID (Reiter nie gelesen) → WooCommerce', () => {
    const r = seoGroessenQuelle([], WC_MIT_GROESSEN, { varianten: false, wc: true });

    expect(r.quelle).toBe('woocommerce');
    expect(r.groessen).toEqual(['S', 'M', 'L']);
  });

  test('Fetch-Fehler beim Reiter → WooCommerce', () => {
    // .catch setzt seoVarianten = [] und varianten: false
    expect(seoGroessenQuelle([], WC_MIT_GROESSEN, { varianten: false, wc: true }).quelle)
      .toBe('woocommerce');
  });

  test('Varianten ohne Größen-Attribut → WooCommerce', () => {
    const nurFarbe = [variante([['Farbe', 'Navy']])];
    expect(seoGroessenQuelle(nurFarbe, WC_MIT_GROESSEN, ALLES_LESBAR).quelle).toBe('woocommerce');
  });

  test('WC-Produkt ohne attributes kippt nicht um', () => {
    expect(seoWerteAusWcProdukt(null, GROESSEN_ATTR_RE)).toEqual([]);
    expect(seoWerteAusWcProdukt({ id: 1 }, GROESSEN_ATTR_RE)).toEqual([]);
    expect(seoWerteAusWcProdukt({ id: 1, attributes: 'kaputt' }, GROESSEN_ATTR_RE)).toEqual([]);
  });
});

describe('3. Beide ohne Größen → echter Artikel ohne Größen, keine Meldung', () => {
  test('Schal/Puck: Quelle "ohne", keine Größen', () => {
    const r = seoGroessenQuelle([variante([['Farbe', 'Navy']])], WC_OHNE_GROESSEN, ALLES_LESBAR);

    expect(r.quelle).toBe('ohne');
    expect(r.groessen).toEqual([]);
  });

  test('der Statustext dazu ist eine Feststellung, keine Fehlermeldung', () => {
    expect(SEO_GROESSEN_TEXT.ohne).toBe('Artikel ohne Größen');
    expect(SEO_GROESSEN_TEXT.ohne).not.toMatch(/nicht ermittelt|Fehler|prüfen/);
  });

  test('eine lesbare Quelle reicht für die Feststellung', () => {
    // Reiter gelesen und leer, WC-Produkt fehlt → kein Fehlalarm.
    expect(seoGroessenQuelle([], null, { varianten: true, wc: false }).quelle).toBe('ohne');
    // Umgekehrt genauso.
    expect(seoGroessenQuelle([], WC_OHNE_GROESSEN, { varianten: false, wc: true }).quelle).toBe('ohne');
  });
});

describe('4. Keine Quelle lesbar → sichtbare Meldung', () => {
  test('Fetch-Fehler und kein WooCommerce-Produkt', () => {
    const r = seoGroessenQuelle([], null, { varianten: false, wc: false });

    expect(r.quelle).toBe('unbekannt');
    expect(r.groessen).toEqual([]);
  });

  test('die Meldung nennt, was zu tun ist', () => {
    expect(SEO_GROESSEN_TEXT.unbekannt).toBe(
      'Größen konnten nicht ermittelt werden – bitte im Text prüfen',
    );
  });

  test('unbekannt ist von "ohne Größen" unterschieden', () => {
    const unbekannt = seoGroessenQuelle([], null, { varianten: false, wc: false });
    const ohne      = seoGroessenQuelle([], null, { varianten: true, wc: false });

    expect(unbekannt.quelle).not.toBe(ohne.quelle);
  });
});

describe('Farben bleiben beim Varianten-Reiter', () => {
  test('Farben werden nicht aus WooCommerce nachgeladen', () => {
    expect(seoWerteAusVarianten([variante([['Farbe', 'Navy']])], FARB_ATTR_RE)).toEqual(['Navy']);
    expect(FARB_ATTR_RE.test('Größe')).toBe(false);
  });
});

describe('Verdrahtung im SEO-Flow', () => {
  const genStart = html.indexOf("getElementById('btn-seo-generate').addEventListener");
  const genBlock = html.slice(genStart, html.indexOf("getElementById('btn-seo-save')", genStart));

  test('die Quelle wird vor dem Request bestimmt und mitgeschickt', () => {
    expect(genBlock).toMatch(/seoGroessenQuelle\(seoVarianten, seoWcProdukt, seoQuellenOk\)/);
    expect(genBlock).toMatch(/groessen:\s*gr\.groessen/);
  });

  test('die Quelle steht im Statustext', () => {
    expect(genBlock).toMatch(/SEO_GROESSEN_TEXT\[gr\.quelle\]/);
  });

  test('nur "unbekannt" meldet zusätzlich als Toast', () => {
    expect(genBlock).toMatch(/gr\.quelle === 'unbekannt'/);
    expect(genBlock).toMatch(/showToast\(SEO_GROESSEN_TEXT\.unbekannt, 'error'\)/);
  });

  test('die Generierung läuft trotz Meldung durch – kein früher Abbruch', () => {
    const nachAntwort = genBlock.slice(genBlock.indexOf('const data = await res.json()'));
    expect(nachAntwort).not.toMatch(/\breturn;/);
  });

  test('WC-Produkt und Lesbarkeit der Quellen werden gemerkt', () => {
    expect(html).toMatch(/seoWcProdukt\s*=\s*p;/);
    expect(html).toMatch(/seoQuellenOk\.wc\s*=\s*!!\(p && p\.id\)/);
    expect(html).toMatch(/seoQuellenOk\.varianten = Array\.isArray\(v\.varianten\)/);
    expect(html).toMatch(/seoQuellenOk\.varianten = false/);
  });
});
