// Auftrag NEU1: Ugly Christmas Sweater "Leb, Kuchen!" (Kategorien je Artikel, KI-Satz) und
// Tobi Torpedo Fluffy Hoodies (mehrere Farben je Artikel, Bild je Farbe, Motive-Zeile TT-Logo
// aendern) im Anlage-Skript (lib/anlageHalloween.js).

import {
  KOLLEKTIONEN, UCS_LEBKUCHEN, TT_FLUFFY, FANMEET_TAYNEW, planeArtikel, planeSheets, produktPayload,
  variationsPayloads, produktKategorien, pruefeVorblendung, bildListe, bilderAusZustand, galerie, farbBild,
  maskeBody, variantenSheetPayload, farbenVon,
} from '../lib/anlageHalloween.js';
import { readFileSync } from 'fs';

const TERME = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
const ATTR_IDS = { farbe: 3, groesse: 2 };
const BIS_5XL = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
let nr = 1000000000;
const zeilen = (catalogNr, farbe, groessen) => groessen.map(size => ({
  articleNr: String(++nr), catalogNr, color1: farbe, color2: '', size, discontinued: '0', status: 'aktiv',
}));
const LSHOP = [
  ...zeilen('JH030', 'Deep Black', BIS_5XL), ...zeilen('JH030', 'Arctic White', BIS_5XL),
  ...zeilen('JH030F', 'Deep Black', BIS_5XL.slice(0, 6)),
  ...zeilen('BY284', 'Black', BIS_5XL), ...zeilen('BY284', 'Beryl Blue', BIS_5XL), ...zeilen('BY284', 'Soft Pink', BIS_5XL),
  ...zeilen('BY289', 'Black', BIS_5XL), ...zeilen('BY289', 'Soft Pink', BIS_5XL),
];
const PREISE = { BY284: { basis: '30', groessen: { '3XL': '31', '4XL': '32', '5XL': '33' } } };
const plan = (k, modell, lshop = LSHOP, preise = null) =>
  planeArtikel({ artikel: k.artikel.find(a => a.modell === modell), lshopZeilen: lshop, groessenTerme: TERME, preise, k });

describe('Kollektionen (Entscheidungen Inhaber 28.10.)', () => {
  test('Sweater: Titel nach Muster 293, Keyphrase ohne Satzzeichen, Deep Black, grossbrief, Kategorien je Artikel', () => {
    expect(KOLLEKTIONEN['ucs-lebkuchen']).toBe(UCS_LEBKUCHEN);
    expect(UCS_LEBKUCHEN.artikel.map(a => [a.titel, a.modell, a.keyphrase, a.kategorieIds, a.versand, a.farbe])).toEqual([
      ['Leb, Kuchen! – Ugly Christmas Sweater Herren', 'JH030', 'Leb Kuchen Sweater Herren', [293, 685], 'grossbrief', 'Deep Black'],
      ['Leb, Kuchen! – Ugly Christmas Sweater Damen', 'JH030F', 'Leb Kuchen Sweater Damen', [293, 684], 'grossbrief', 'Deep Black'],
    ]);
    expect(UCS_LEBKUCHEN.ki).toBe(true);
    expect(UCS_LEBKUCHEN.artikel[1].bilddatei).toBe('ugly-christmas-sweater-leb-kuchen-damen-black-Jh030F.jpg');
  });

  test('Motive UCS-LebKuchen: KI-Vermerk in "Offen", Nur_intern leer (sonst meldet die Pruefung den KI-Satz)', () => {
    expect(UCS_LEBKUCHEN.motivZeile.nurIntern).toBe('');
    expect(UCS_LEBKUCHEN.motivZeile.offen).toMatch(/KI/);
    expect(UCS_LEBKUCHEN.motivZeile.motiv).toContain('„Leb, Kuchen!“');
  });

  test('Tobi Torpedo: Titel nach 16620/16658, Farben laut L-Shop, grossbrief, Kat. 121, Kurz TT-Logo', () => {
    expect(KOLLEKTIONEN['tt-fluffy']).toBe(TT_FLUFFY);
    expect(TT_FLUFFY.kurz).toBe('TT-Logo');
    expect(TT_FLUFFY.artikel.map(a => [a.titel, a.modell, a.farben, a.versand, a.keyphrase])).toEqual([
      ['Tobi Torpedo Fluffy Hoodie', 'BY284', ['Black', 'Beryl Blue', 'Soft Pink'], 'grossbrief', 'Tobi Torpedo Fluffy Hoodie'],
      ['Tobi Torpedo Damen Fluffy Hoodie', 'BY289', ['Black', 'Soft Pink'], 'grossbrief', 'Tobi Torpedo Damen Fluffy Hoodie'],
    ]);
    expect(produktKategorien(TT_FLUFFY, null, TT_FLUFFY.artikel[0])).toEqual([121]);
  });

  test('Prompt-Texte ohne "offiziell"', () => {
    const src = readFileSync(new URL('../lib/anlageHalloween.js', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('export const UCS_LEBKUCHEN'), src.indexOf('export const KOLLEKTIONEN'));
    expect(block).not.toMatch(/offiziell/i);
  });
});

describe('Plan', () => {
  test('Sweater: eine Farbe, Herren XS-5XL (9), Damen XS-2XL (6), SKU mit Kurz', () => {
    const h = plan(UCS_LEBKUCHEN, 'JH030');
    expect(h.status).toBe('bereit');
    expect(farbenVon(h)).toEqual(['Deep Black']);
    expect(h.varianten.map(v => v.groesse)).toEqual(TERME);
    expect(h.varianten[0].sku).toBe('JH030/UCS-LebKuchen-deep-black-xs');
    expect(plan(UCS_LEBKUCHEN, 'JH030F').varianten.map(v => v.groesse)).toEqual(TERME.slice(0, 6));
  });

  test('Fluffy: Farbe x Groesse, ArticleNr je Farbe, SKUs eindeutig, Preise je Groesse', () => {
    const p = plan(TT_FLUFFY, 'BY284', LSHOP, PREISE);
    expect(p.status).toBe('bereit');
    expect(p.varianten).toHaveLength(27);
    expect(p.varianten.map(v => v.farbe).filter((f, i, a) => a.indexOf(f) === i)).toEqual(['Black', 'Beryl Blue', 'Soft Pink']);
    const nrBlackXs = LSHOP.find(z => z.catalogNr === 'BY284' && z.color1 === 'Black' && z.size === 'XS').articleNr;
    const nrPinkXs = LSHOP.find(z => z.catalogNr === 'BY284' && z.color1 === 'Soft Pink' && z.size === 'XS').articleNr;
    expect(p.varianten.find(v => v.farbe === 'Black' && v.groesse === 'XS').articleNr).toBe(nrBlackXs);
    expect(p.varianten.find(v => v.farbe === 'Soft Pink' && v.groesse === 'XS').articleNr).toBe(nrPinkXs);
    expect(new Set(p.varianten.map(v => v.sku)).size).toBe(27);
    expect(p.varianten.find(v => v.farbe === 'Beryl Blue' && v.groesse === '3XL').sku).toBe('BY284/TT-Logo-beryl-blue-3xl');
    expect(p.varianten.filter(v => v.groesse === '2XL').map(v => v.preis)).toEqual(['30.00', '30.00', '30.00']);
    expect(p.varianten.filter(v => v.farbe === 'Black').slice(-3).map(v => v.preis)).toEqual(['31.00', '32.00', '33.00']);
  });

  test('Fluffy: Groessen je Farbe verschieden -> Fehler, nicht gemischt', () => {
    const lshop = LSHOP.filter(z => !(z.catalogNr === 'BY289' && z.color1 === 'Soft Pink' && z.size === '5XL'));
    const p = plan(TT_FLUFFY, 'BY289', lshop);
    expect(p.status).toBe('fehler');
    expect(p.hinweise.join(' ')).toMatch(/Soft Pink/);
  });

  test('Varianten-Reiter: Farbe je Zeile, Google_Farbe = Farbe, ArticleNr je Farbe', () => {
    const p = plan(TT_FLUFFY, 'BY289');
    const z = variantenSheetPayload(p);
    expect(z).toHaveLength(18);
    expect(z[9]).toMatchObject({ v1: 'Soft Pink', v2: 'XS', googleFarbe: 'Soft Pink' });
  });
});

describe('Payload', () => {
  test('Sweater: Kategorien des Artikels, eine Farbe vorgeblendet', () => {
    const b = produktPayload(plan(UCS_LEBKUCHEN, 'JH030F'), { kategorieId: null, attrIds: ATTR_IDS, markeId: 698, lieferzeit: '21', bilder: { einzel: 7 } });
    expect(b.categories).toEqual([{ id: 293 }, { id: 684 }]);
    expect(b.default_attributes).toEqual([{ id: 3, option: 'Deep Black' }]);
    expect(b.shipping_class).toBe('grossbrief');
  });

  test('Fluffy: Farbachse mit allen Farben, keine Vorblendung', () => {
    const p = plan(TT_FLUFFY, 'BY284');
    const bilder = { einzel: 11, farben: { 'Black': 11, 'Beryl Blue': 12, 'Soft Pink': 13 } };
    const b = produktPayload(p, { kategorieId: null, attrIds: ATTR_IDS, markeId: 698, lieferzeit: '21', bilder });
    expect(b.attributes[0].options).toEqual(['Black', 'Beryl Blue', 'Soft Pink']);
    expect(b.default_attributes).toEqual([]);
    expect(b.images).toEqual([{ id: 11 }, { id: 12 }, { id: 13 }]);
    expect(b.categories).toEqual([{ id: 121 }]);
  });

  test('Variationen: Bild und _wc_gla_color der eigenen Farbe, Reihenfolge Farbe dann Groesse', () => {
    const p = plan(TT_FLUFFY, 'BY284');
    const v = variationsPayloads(p, ATTR_IDS, { einzel: 11, farben: { 'Black': 11, 'Beryl Blue': 12, 'Soft Pink': 13 } });
    const pink = v.find(x => x.attributes[0].option === 'Soft Pink');
    expect(pink.image).toEqual({ id: 13 });
    expect(pink.meta_data.find(m => m.key === '_wc_gla_color').value).toBe('Soft Pink');
    expect(v.map(x => x.menu_order)).toEqual(v.map((_, i) => i + 1));
    expect(v.slice(0, 9).every(x => x.attributes[0].option === 'Black')).toBe(true);
  });

  test('Ruecklesen der Vorblendung bei mehreren Farben: leer ok, sonst Meldung', () => {
    expect(pruefeVorblendung([], null, 3)).toBeNull();
    expect(pruefeVorblendung([{ id: 3, option: 'black' }], null, 3)).toMatch(/mehrere Farben/);
  });

  test('farbBild: Farbe fehlt -> Fehler; ohne Farbbilder das einzige Bild', () => {
    expect(farbBild({ einzel: 5 }, 'Black')).toBe(5);
    expect(() => farbBild({ einzel: 5, farben: { Black: 5 } }, 'Soft Pink')).toThrow(/Soft Pink/);
  });

  test('Maske: Kategorien-Text des Artikels', () => {
    expect(maskeBody(plan(UCS_LEBKUCHEN, 'JH030'))).toMatchObject({
      'Artikelnummer': 'JH030/UCS-LebKuchen', 'Kategorien': 'Ugly Christmas Sweater, Ugly Christmas Sweater Herren',
      'Fokus_Keyphrase': 'Leb Kuchen Sweater Herren', 'Versandklasse': 'grossbrief',
    });
    expect(maskeBody(plan(FANMEET_TAYNEW, 'E3000', [...LSHOP, ...zeilen('E3000', 'Black', BIS_5XL)]))['Kategorien']).toBe('BoysLove (BL), Fanmeet');
  });
});

describe('Bilder', () => {
  test('Sweater: Dateiname und ALT mit Farbe (Muster Rentier/SE6)', () => {
    expect(bildListe(UCS_LEBKUCHEN.artikel[0], null, UCS_LEBKUCHEN)).toEqual([{
      schluessel: 'einzel', quelle: 'ugly-christmas-sweater-leb-kuchen-herren-black-Jh030.jpg',
      dateiname: 'leb-kuchen-ugly-christmas-sweater-herren-schwarz.jpg', titel: 'Leb, Kuchen! – Ugly Christmas Sweater Herren Schwarz',
    }]);
  });

  test('Fluffy: ein Bild je Farbe (Mockup-Namen des Inhabers), ALT mit Druckfarbe', () => {
    const l = bildListe(TT_FLUFFY.artikel[0], null, TT_FLUFFY);
    expect(l.map(b => [b.quelle, b.dateiname, b.titel])).toEqual([
      ['BY284-black-tobi-torpedo.jpg', 'tobi-torpedo-fluffy-hoodie-schwarz.jpg', 'Tobi Torpedo Fluffy Hoodie Schwarz mit weißem Druck'],
      ['BY284-beryl-blue-tobi-torpedo.jpg', 'tobi-torpedo-fluffy-hoodie-beryl-blue.jpg', 'Tobi Torpedo Fluffy Hoodie Beryl Blue mit weißem Druck'],
      ['BY284-Soft-pink-tobi-torpedo.jpg', 'tobi-torpedo-fluffy-hoodie-soft-pink.jpg', 'Tobi Torpedo Fluffy Hoodie Soft Pink mit schwarzem Druck'],
    ]);
    const zustand = Object.fromEntries(l.map((b, i) => [b.dateiname, { id: 20 + i }]));
    const bilder = bilderAusZustand(l, zustand);
    expect(bilder).toEqual({ einzel: 20, farben: { 'Black': 20, 'Beryl Blue': 21, 'Soft Pink': 22 } });
    expect(galerie(bilder, TT_FLUFFY)).toEqual([{ id: 20 }, { id: 21 }, { id: 22 }]);
    expect(bilderAusZustand(l, { [l[0].dateiname]: { id: 1 } })).toBeNull();
  });
});

describe('Sheet-Plan', () => {
  const MOTIV_KOPF = ['Artikelkurzbezeichnung', 'Motiv', 'Druckposition', 'Druckfarben', 'Druckfarbe_je_Textilfarbe', 'Serie_Kontext', 'Nur_intern', 'Offen', 'Stand'];
  const TT_ZEILE = ['TT-Logo', 'Schriftzug-Logo „TOBI TORPEDO“ (Torpedo als „I“)', 'Hoodies: Front groß', 'Design wählbar',
    'ja (1588/1717: Gold nur mit schwarzem Druck)', 'Merch von Partyschlagersänger Tobi Torpedo', '', 'Druckpositionen bestätigen', '2026-10-04'];
  const reiter = (tt = TT_ZEILE) => ({
    Erfassungsmaske: [['ID', 'Artikelnummer'], ['JFN-2026-0598', 'X/Y']],
    Varianten: [['SSOT-ID'], ['JFN-2026-0598']],
    Motive: [MOTIV_KOPF, ['UCS-Pinguin', 'Pinguin'], [...tt]],
    Struktur_Kategorien: [['Kategorienummer', 'Kategorien', 'Kategoriename', 'SEO_Hinweis']],
    SEO_Karte: [['Typ', 'Name']],
  });

  test('Sweater: neue Motive-Zeile, keine Aenderung, SSOT fortlaufend', () => {
    const sp = planeSheets(reiter(), UCS_LEBKUCHEN.artikel.map(a => plan(UCS_LEBKUCHEN, a.modell)), { heute: '2026-10-28', k: UCS_LEBKUCHEN });
    expect(sp.motive).toEqual({ zeile: 4, werte: ['UCS-LebKuchen', UCS_LEBKUCHEN.motivZeile.motiv, 'Front, Brust', 'vollfarbig', 'nein, fest',
      'Ugly Christmas Sweater', '', 'Motiv mit KI gestaltet – KI-Satz am Ende der Beschreibung', '2026-10-28'] });
    expect(sp.motivAenderung).toBeNull();
    expect(sp.artikel.map(a => a.ssot)).toEqual(['JFN-2026-0599', 'JFN-2026-0600']);
    expect(sp.kategorie).toEqual({ vorhanden: true });
    expect(sp.karte).toEqual({ vorhanden: true });
  });

  test('TT-Logo: Rakete im "O" und Druckfarbe der Fluffys, nur diese zwei Zellen', () => {
    const sp = planeSheets(reiter(), [], { k: TT_FLUFFY });
    expect(sp.motive).toEqual({ vorhanden: true });
    expect(sp.motivAenderung.zeile).toBe(3);
    expect(sp.motivAenderung.spalten.map(s => s.spalte)).toEqual(['Motiv', 'Druckfarbe_je_Textilfarbe']);
    expect(sp.motivAenderung.neu[1]).toBe('Schriftzug-Logo „TOBI TORPEDO“ (Rakete im „O“)');
    expect(sp.motivAenderung.neu[4]).toBe('ja (1588/1717: Gold nur mit schwarzem Druck); Fluffy BY284/BY289: weiß auf Black und Beryl Blue, schwarz auf Soft Pink');
    expect(sp.motivAenderung.neu.filter((w, j) => w !== TT_ZEILE[j])).toHaveLength(2);
  });

  test('TT-Logo: zweiter Lauf = schon so; unbekannter Text = Fehler', () => {
    const erst = planeSheets(reiter(), [], { k: TT_FLUFFY }).motivAenderung.neu;
    expect(planeSheets(reiter(erst), [], { k: TT_FLUFFY }).motivAenderung.gleich).toBe(true);
    const fremd = [...TT_ZEILE]; fremd[1] = 'Logo';
    expect(() => planeSheets(reiter(fremd), [], { k: TT_FLUFFY })).toThrow(/nicht gefunden/);
  });

  test('TT-Logo fehlt: Fehler statt neuer Zeile ohne Inhalt', () => {
    const r = reiter(); r.Motive.pop();
    expect(() => planeSheets(r, [], { k: TT_FLUFFY })).toThrow(/TT-Logo/);
  });
});
