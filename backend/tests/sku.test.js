// S2 - kurze, eindeutige SKUs fuer Elternprodukt und Varianten.
//
// Drei Ebenen, absichtlich getrennt:
//  1. backend/lib/sku.js - die Regeln selbst
//  2. der markierte Block in index.html - muss dieselben Ergebnisse liefern,
//     sonst meldet das Frontend etwas anderes als das Backend erzwingt
//  3. psZeilenFinden() im Auftragsmonitor - der Fallback, der mit kurzen
//     Kuerzeln sonst ins Leere laeuft

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import {
  normalisiereTeil, pruefeKurzbezeichnung, pruefeArtikelnummer,
  baueArtikelnummer, baueVariantenSku, baueVariantenSkus,
  KURZ_MIN, KURZ_MAX, ARTNR_MAX, SKU_MAX,
} from '../lib/sku.js';
import { psZeilenFinden } from '../routes/auftragsmonitor.js';

const html = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8',
);

// ── Frontend-Block herausschneiden und ausfuehren ───────────────────────────
const START = '// ── SKU-Regeln: Anfang';
const ENDE  = '// ── SKU-Regeln: Ende ──';
const von   = html.indexOf(START);
const bis   = html.indexOf(ENDE);
const block = html.slice(von, bis);

const fe = new Function(`${block}
  return { skuNormalisiereTeil, skuPruefeKurz, skuBaueArtikelnummer,
           skuBaueVariantenSku, skuBaueVariantenSkus };`)();

const attrs = (...werte) => werte.map(w => ({ name: 'X', value: w }));

test('der Frontend-Block wurde gefunden und benutzt nichts aus dem Seitenkontext', () => {
  expect(von).toBeGreaterThan(-1);
  expect(bis).toBeGreaterThan(von);
  expect(block).not.toMatch(/document\.|apiFetch|showToast|variants\b/);
});

describe('Kurzbezeichnung ist Pflicht', () => {
  test('leer wird abgelehnt - es gibt keinen Fallback mehr', () => {
    for (const leer of ['', '   ', null, undefined]) {
      expect(pruefeKurzbezeichnung(leer)).not.toBeNull();
      expect(fe.skuPruefeKurz(leer)).toBeTruthy();
    }
    expect(pruefeKurzbezeichnung('').fehler).toMatch(/fehlt/);
  });

  test('zu kurz und zu lang', () => {
    expect(pruefeKurzbezeichnung('ab')).not.toBeNull();
    expect(pruefeKurzbezeichnung('a'.repeat(KURZ_MAX + 1))).not.toBeNull();
    expect(pruefeKurzbezeichnung('a'.repeat(KURZ_MIN))).toBeNull();
    expect(pruefeKurzbezeichnung('a'.repeat(KURZ_MAX))).toBeNull();
  });

  test('nur A-Z a-z 0-9 und Bindestrich', () => {
    expect(pruefeKurzbezeichnung('Ugly-Sw01')).toBeNull();
    for (const schlecht of ['Ugly Sw', 'Ugly_Sw', 'Größe01', 'Ugly/Sw', 'Ugly.Sw']) {
      expect(pruefeKurzbezeichnung(schlecht)).not.toBeNull();
      expect(fe.skuPruefeKurz(schlecht)).toBeTruthy();
    }
  });

  test('die Spiegelung Produktname -> Kurzbezeichnung ist aus index.html entfernt', () => {
    expect(html).not.toMatch(/_lastMirrored/);
    expect(html).not.toMatch(/pfShortName\.value\s*=\s*pfName\.value/);
  });
});

describe('Artikelnummer', () => {
  test('leere L-Shop-Nummer: kein Speichern, keine leere SKU', () => {
    const r = baueArtikelnummer('', 'UglySw01');
    expect(r.fehler).toMatch(/L-Shop/);
    expect(r.artikelnummer).toBeUndefined();
    expect(fe.skuBaueArtikelnummer('', 'UglySw01').fehler).toBeTruthy();
  });

  test('normaler Fall', () => {
    expect(baueArtikelnummer('JH030', 'UglySw01').artikelnummer).toBe('JH030/UglySw01');
    expect(fe.skuBaueArtikelnummer('JH030', 'UglySw01').artikelnummer).toBe('JH030/UglySw01');
  });

  test(`${ARTNR_MAX}-Zeichen-Grenze`, () => {
    const kurz20 = 'a'.repeat(20);                       // 'JH030/' = 6 Zeichen
    expect(baueArtikelnummer('JH030', kurz20).artikelnummer).toHaveLength(26);
    // 30 genau erreicht ist erlaubt, 31 nicht
    const genau30 = baueArtikelnummer('JH0300000', kurz20);
    expect(genau30.artikelnummer).toHaveLength(30);
    const zu31 = baueArtikelnummer('JH03000001', kurz20);
    expect(zu31.fehler).toMatch(/31 Zeichen/);
    expect(fe.skuBaueArtikelnummer('JH03000001', kurz20).fehler).toBeTruthy();
  });

  test('fertige Artikelnummer pruefen (Backend-Eingang)', () => {
    expect(pruefeArtikelnummer('JH030/UglySw01')).toBeNull();
    expect(pruefeArtikelnummer('')).not.toBeNull();
    expect(pruefeArtikelnummer('ohne-schraegstrich')).not.toBeNull();
    expect(pruefeArtikelnummer('/UglySw01')).not.toBeNull();
    expect(pruefeArtikelnummer('JH030/Ugly Sw')).not.toBeNull();
    expect(pruefeArtikelnummer('JH30F/Nothing-Butt-A-Merry-Christmas-Damen').fehler)
      .toMatch(/Zeichen/);   // die Alt-SKU aus dem Bestand faellt durch
  });
});

describe('Normalisierung der Variantenteile', () => {
  test('Umlaute und ß', () => {
    expect(normalisiereTeil('Grün')).toBe('gruen');
    expect(normalisiereTeil('Größe')).toBe('groesse');
    expect(normalisiereTeil('Weiß')).toBe('weiss');
    expect(normalisiereTeil('Ärmel')).toBe('aermel');
    expect(normalisiereTeil('Öl')).toBe('oel');
  });

  test('Leerzeichen werden Bindestrich, Sonderzeichen fallen weg', () => {
    expect(normalisiereTeil('Grau meliert')).toBe('grau-meliert');
    expect(normalisiereTeil('  Navy  Blau ')).toBe('navy-blau');
    expect(normalisiereTeil('S/M')).toBe('sm');
    expect(normalisiereTeil('5XL')).toBe('5xl');
  });

  test('Frontend normalisiert identisch', () => {
    for (const w of ['Grün', 'Größe', 'Weiß', 'Grau meliert', '5XL', 'S/M', 'Ärmel']) {
      expect(fe.skuNormalisiereTeil(w)).toBe(normalisiereTeil(w));
    }
  });
});

describe('Varianten-SKU', () => {
  test('nur vorhandene Achsen, in ihrer Reihenfolge', () => {
    expect(baueVariantenSku('JH030/UglySw01', attrs('Navy', 'XL'))).toBe('JH030/UglySw01-navy-xl');
    expect(baueVariantenSku('JH030/UglySw01', attrs('Navy'))).toBe('JH030/UglySw01-navy');
    expect(baueVariantenSku('JH030/UglySw01', attrs('Navy', 'XL', 'Kurzarm')))
      .toBe('JH030/UglySw01-navy-xl-kurzarm');
  });

  test('ohne Achsen bleibt es bei der Eltern-SKU', () => {
    expect(baueVariantenSku('JH030/UglySw01', [])).toBe('JH030/UglySw01');
    expect(baueVariantenSku('JH030/UglySw01', undefined)).toBe('JH030/UglySw01');
  });

  test('kein Platzhalter fuer eine leere Achse', () => {
    expect(baueVariantenSku('JH030/UglySw01', attrs('Navy', ''))).toBe('JH030/UglySw01-navy');
    expect(baueVariantenSku('JH030/UglySw01', attrs('', 'XL'))).toBe('JH030/UglySw01-xl');
  });

  test('WooCommerce-Form {option} und Reiter-Form {wert} werden auch gelesen', () => {
    expect(baueVariantenSku('A/B', [{ name: 'Farbe', option: 'Navy' }])).toBe('A/B-navy');
    expect(baueVariantenSku('A/B', [{ name: 'Farbe', wert: 'Navy' }])).toBe('A/B-navy');
  });

  test('Frontend baut identisch', () => {
    const a = attrs('Grau meliert', '5XL');
    expect(fe.skuBaueVariantenSku('JH030/UglySw01', a)).toBe(baueVariantenSku('JH030/UglySw01', a));
  });
});

describe('Varianten-Satz: Laenge und Dubletten', () => {
  test(`${SKU_MAX}-Zeichen-Grenze schlaegt zu`, () => {
    const lang = baueVariantenSkus('JH0300000/' + 'a'.repeat(20), [
      { attrs: attrs('Dunkelblau-meliert', 'XXXL') },
    ]);
    expect(lang.fehler).toMatch(/erlaubt sind 50/);
  });

  test('genau 50 ist erlaubt', () => {
    // 'AB/' + 17 = 20 Zeichen Artikelnummer, + '-' + 29 = 50
    const artNr = 'AB/' + 'c'.repeat(17);
    const r = baueVariantenSkus(artNr, [{ attrs: attrs('d'.repeat(29)) }]);
    expect(r.fehler).toBeUndefined();
    expect(r.skus[0]).toHaveLength(50);
  });

  test('zwei Varianten mit derselben SKU werden abgelehnt', () => {
    const r = baueVariantenSkus('JH030/UglySw01', [
      { attrs: attrs('Navy', 'XL') },
      { attrs: attrs('Navy', 'XL') },
    ]);
    expect(r.fehler).toMatch(/dieselbe SKU/);
    expect(r.fehler).toMatch(/1 und 2/);
  });

  test('Dublette auch nach Normalisierung erkannt', () => {
    // "Grau meliert" und "grau-meliert" ergeben denselben Teil
    const r = baueVariantenSkus('JH030/UglySw01', [
      { attrs: attrs('Grau meliert') },
      { attrs: attrs('grau-meliert') },
    ]);
    expect(r.fehler).toMatch(/dieselbe SKU/);
  });

  test('Damen und Herren: gleiches Kuerzel, verschiedene L-Shop-Nummer', () => {
    const herren = baueArtikelnummer('JH030', 'UglySw01').artikelnummer;
    const damen  = baueArtikelnummer('JH30F', 'UglySw01').artikelnummer;

    expect(herren).not.toBe(damen);
    const h = baueVariantenSkus(herren, [{ attrs: attrs('Navy', 'XL') }]);
    const d = baueVariantenSkus(damen,  [{ attrs: attrs('Navy', 'XL') }]);
    expect(h.skus[0]).toBe('JH030/UglySw01-navy-xl');
    expect(d.skus[0]).toBe('JH30F/UglySw01-navy-xl');
    expect(h.skus[0]).not.toBe(d.skus[0]);
  });

  test('Frontend meldet dieselben Fehler', () => {
    const dublette = [{ attrs: attrs('Navy') }, { attrs: attrs('navy') }];
    expect(fe.skuBaueVariantenSkus('JH030/UglySw01', dublette).fehler).toBeTruthy();
    expect(fe.skuBaueVariantenSkus('JH030/UglySw01', [{ attrs: attrs('Navy') }]).skus)
      .toEqual(['JH030/UglySw01-navy']);
  });
});

describe('Auftragsmonitor: Zuordnung ohne wcItemIds', () => {
  // Produktions_Status: [orderId, wcItemId, artikelname, sku, menge, lshop, dtf]
  const KOPF = ['WC_Order_ID', 'WC_Item_ID', 'Artikelname', 'SKU', 'Menge', 'L-Shop_bestellt', 'DTF_bestellt'];

  test('wcItemIds schlagen alles andere', () => {
    const rows = [KOPF,
      ['100', '11', 'Irgendwas', 'JH030/UglySw01', '1', '', ''],
      ['100', '12', 'Anderes',   'JH030/Andere01', '1', '', ''],
    ];
    const t = psZeilenFinden(rows, { orderIds: ['100'], artikelnummer: 'JH030/UglySw01',
                                     wcItemIds: [{ orderId: '100', wcItemId: '12' }] });
    expect(t).toEqual([3]);   // Zeile 3 = zweiter Datensatz
  });

  test('kurzes Kuerzel: exakt ueber die SKU-Spalte, nicht ueber den Namen', () => {
    const rows = [KOPF,
      ['100', '11', 'Ugly Sweater Pinguin', 'JH030/UglySw01', '1', '', ''],
      ['100', '12', 'Ugly Sweater Einhorn', 'JH030/UglySw02', '1', '', ''],
    ];
    const t = psZeilenFinden(rows, { orderIds: ['100'], artikelnummer: 'JH030/UglySw01', wcItemIds: [] });
    expect(t).toEqual([2]);

    // Der alte Vergleich haette hier NICHTS gefunden: "UglySw01" steht in
    // keinem der Artikelnamen.
    const alt = rows.slice(1).filter(r => r[2].includes('JH030/UglySw01'.split('/').pop()));
    expect(alt).toHaveLength(0);
  });

  test('Altzeile ohne SKU: der Namensvergleich greift weiter', () => {
    // Artikelname, der das Fragment tatsaechlich enthaelt - nur dann konnte
    // der alte Vergleich ueberhaupt treffen.
    const rows = [KOPF,
      ['100', '11', 'Hoodie Ugly-Sweater-Yummy', '', '1', '', ''],
    ];
    const t = psZeilenFinden(rows, {
      orderIds: ['100'], artikelnummer: 'JH030/Ugly-Sweater-Yummy', wcItemIds: [],
    });
    expect(t).toEqual([2]);
  });

  test('der alte Fallback war schon vorher meist wirkungslos', () => {
    // Belegt, warum der Umbau kein Verlust ist: die Artikelnummer trug hinter
    // dem "/" die Kurzbezeichnung MIT Bindestrichen, der Artikelname im
    // Produktions_Status aber den WC-Titel MIT Leerzeichen. includes() traf
    // damit nur, wenn die Kurzbezeichnung zufaellig ohne Leerzeichen war.
    const artikelname = 'Ugly Sweater Yummy Herren';
    const fragment    = 'JH030/Ugly-Sweater-Yummy'.split('/').pop();
    expect(artikelname.includes(fragment)).toBe(false);

    // Neu: ueber die SKU-Spalte wird dieselbe Zeile zuverlaessig gefunden.
    const rows = [KOPF, ['100', '11', artikelname, 'JH030/Ugly-Sweater-Yummy', '1', '', '']];
    expect(psZeilenFinden(rows, {
      orderIds: ['100'], artikelnummer: 'JH030/Ugly-Sweater-Yummy', wcItemIds: [],
    })).toEqual([2]);
  });

  test('gefuellte SKU-Spalte schliesst Zufallstreffer im Namen aus', () => {
    const rows = [KOPF,
      ['100', '11', 'Enthaelt zufaellig Sw01 im Namen', 'JH030/Andere01', '1', '', ''],
    ];
    expect(psZeilenFinden(rows, { orderIds: ['100'], artikelnummer: 'JH030/Sw01', wcItemIds: [] }))
      .toEqual([]);
  });

  test('fremde Order-ID wird nie getroffen', () => {
    const rows = [KOPF, ['999', '11', 'X', 'JH030/UglySw01', '1', '', '']];
    expect(psZeilenFinden(rows, { orderIds: ['100'], artikelnummer: 'JH030/UglySw01', wcItemIds: [] }))
      .toEqual([]);
  });
});

describe('Punkt 8: keine 1:1-Annahme SKU zu Lieferantennummer', () => {
  test('zwei Artikel duerfen dieselbe L-Shop-Nummer tragen', () => {
    // Zwei Motive auf demselben Rohling: gleiche L-Shop-Nummer, andere SKU.
    const a = baueArtikelnummer('JH030', 'Motiv-A').artikelnummer;
    const b = baueArtikelnummer('JH030', 'Motiv-B').artikelnummer;
    expect(a).not.toBe(b);
    expect(a.split('/')[0]).toBe(b.split('/')[0]);
  });

  test('der Varianten-Reiter hat noch kein Lieferantenfeld', () => {
    const sheets = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../routes/sheets.js'), 'utf8',
    );
    const cols = sheets.match(/const VARIANTEN_COLS\s*=\s*\[([\s\S]*?)\]/);
    expect(cols).not.toBeNull();
    expect(cols[1]).not.toMatch(/L-Shop|Lieferant/i);
  });
});
