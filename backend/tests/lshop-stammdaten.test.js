// Befehl LS1: L-Shop-Stammdaten-Update (lib/lshopStammdaten.js, POST /api/lshop/stammdaten,
// buildLShopStammdatenNachricht). Sheet, Drive und WC sind In-Memory-Mocks; alle Werte
// sind Platzhalter. Es wird nie ein echtes Sheet beschrieben.

import { jest } from '@jest/globals';
import { Readable } from 'stream';

// ── In-Memory-Sheet (SSOT- und Business-Reiter, Namen eindeutig) ────────────
let tabs, calls;
const colIdx = b => [...b].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
const nichtDa = r => Object.assign(new Error(`Unable to parse range: ${r}`), { status: 400 });
const values = {
  get: jest.fn(async ({ range }) => {
    const [tab, teil] = range.split('!');
    if (!tabs[tab]) throw nichtDa(range);
    if (teil === '1:1') return { data: { values: tabs[tab].length ? [[...tabs[tab][0]]] : [] } };
    return { data: { values: tabs[tab].map(r => [...r]) } };
  }),
  batchGet: jest.fn(async ({ ranges }) => ({ data: { valueRanges: ranges.map(r => {
    const [tab, teil] = r.split('!');
    const c = colIdx(/^([A-Z]+)2:/.exec(teil)[1]);
    return { values: [tabs[tab].slice(1).map(z => (z[c] === undefined ? '' : String(z[c])))] };
  }) } })),
  update: jest.fn(async ({ range, requestBody, valueInputOption }) => {
    calls.push({ art: 'update', range, valueInputOption });
    const [tab, teil] = range.split('!');
    const [, sp, nr] = /^([A-Z]+)(\d+)/.exec(teil);
    requestBody.values.forEach((row, i) => {
      const z = Number(nr) - 1 + i;
      while (tabs[tab].length <= z) tabs[tab].push([]);
      row.forEach((v, j) => { tabs[tab][z][colIdx(sp) + j] = v; });
    });
    return { data: {} };
  }),
  clear: jest.fn(async ({ range }) => {
    calls.push({ art: 'clear', range });
    const [tab, teil] = range.split('!');
    tabs[tab].length = Math.min(tabs[tab].length, Number(/^[A-Z]+(\d+)/.exec(teil)[1]) - 1);
    return { data: {} };
  }),
  append: jest.fn(async () => { calls.push({ art: 'append' }); return { data: {} }; }),
};
const spreadsheets = {
  values,
  get: jest.fn(async () => ({ data: { sheets: Object.keys(tabs).map((title, i) => ({ properties: { title, sheetId: 100 + i, gridProperties: { rowCount: 1000, columnCount: 26 } } })) } })),
  batchUpdate: jest.fn(async ({ requestBody }) => {
    calls.push({ art: 'batchUpdate', requests: requestBody.requests });
    const replies = requestBody.requests.map(r => {
      if (!r.addSheet) return {};
      tabs[r.addSheet.properties.title] = [];
      return { addSheet: { properties: { ...r.addSheet.properties, sheetId: 999 } } };
    });
    return { data: { replies } };
  }),
};
const sheets = { spreadsheets };

// ── Drive ───────────────────────────────────────────────────────────────────
let csvText, dateien, streamAufrufe;
const drive = {
  files: {
    list: jest.fn(async () => ({ data: { files: dateien } })),
    get: jest.fn(async () => {
      streamAufrufe++;
      // In kleinen Stuecken, damit Zeilen, Anfuehrungen und CRLF ueber Chunk-Grenzen laufen.
      const buf = Buffer.from(csvText, 'utf8');
      const teile = [];
      for (let i = 0; i < buf.length; i += 7) teile.push(buf.subarray(i, i + 7));
      return { data: Readable.from(teile) };
    }),
  },
};

// ── WC ──────────────────────────────────────────────────────────────────────
let produkte;
const wcFuer = shop => ({ get: jest.fn(async (_p, params) => ({ data: params.page > 1 ? [] : produkte[shop] })) });

jest.unstable_mockModule('googleapis', () => ({ google: {
  sheets: () => sheets, drive: () => drive,
} }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));
jest.unstable_mockModule('../lib/shopConfig.js', () => ({ getWcClient: s => wcFuer(s === 'honk' ? 'honk' : 'jfn') }));
jest.unstable_mockModule('../utils/secrets.js', () => ({
  SECRET_KEYS: [], getSecret: jest.fn(async () => ''), loadAllSecrets: jest.fn(),
}));

process.env.GOOGLE_SHEET_ID = 'ssot';
process.env.BUSINESS_SHEET_ID = 'business';
process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID = 'drive-1';

const ls = await import('../lib/lshopStammdaten.js');
const { buildLShopStammdatenNachricht } = await import('../lib/chatNotify.js');

// ── Fixture ─────────────────────────────────────────────────────────────────
// Kopf mit Nachbarspalten (SinglePrice/CartonPrice neben 10CartonsPrice) und
// einer Beschreibung mit ";" in Anfuehrung. Reihenfolge absichtlich anders als KOPF.
const CSV_KOPF = ['ArticleNr', 'CatalogNr', 'SinglePrice', 'CartonPrice', '10CartonsPrice', 'color1', 'color2', 'color3', 'color4',
  'Size', 'Brand', 'Discontinued', 'CatNrManufacturer', 'EAN', 'Description', 'Consistence', 'Grammage', 'QtyCarton'];
const zeile = o => CSV_KOPF.map(n => o[n] ?? '').join(';');
const BASIS = [
  { ArticleNr: '1000048353', CatalogNr: 'E3000', SinglePrice: '9,99', CartonPrice: '8', '10CartonsPrice': '4,25', color1: 'Black', Size: 'M', Brand: 'B&C', Discontinued: '0', CatNrManufacturer: '3000', EAN: '5400000000013', Description: '"Shirt; weich, ""neu"""', Consistence: '100% Baumwolle', Grammage: '150 g/m²', QtyCarton: '50' },
  { ArticleNr: '1000048354', CatalogNr: 'E3000', SinglePrice: '9,99', CartonPrice: '8', '10CartonsPrice': '4,25', color1: 'Black', Size: 'L', Brand: 'B&C', Discontinued: '0', CatNrManufacturer: '3000', EAN: '', QtyCarton: '50' },
  { ArticleNr: '1000311706', CatalogNr: 'L03581', '10CartonsPrice': '3,10', color1: 'White', Size: '3XL', Brand: 'Promodoro', Discontinued: '0', CatNrManufacturer: '03581', EAN: '04044444444444', Consistence: 'Ökotex™', QtyCarton: '25' },
  { ArticleNr: '1000030393', CatalogNr: 'BG42', '10CartonsPrice': '1,05', color1: 'Black', Size: '38 x 14 x 8 cm', Brand: 'BagBase', Discontinued: '2', CatNrManufacturer: 'BG42', EAN: '123456789012', QtyCarton: '100' },
  { ArticleNr: '1000306860', CatalogNr: 'XT903', '10CartonsPrice': '2,00', color1: 'Black', Size: 'approx. 38 x 42 cm', Discontinued: '6' },
  { ArticleNr: '1000412880', CatalogNr: 'CB166R', '10CartonsPrice': '2,50', color1: 'Black', color2: 'Kelly Green', Size: 'One Size', Discontinued: '0' },
  { ArticleNr: '1000500001', CatalogNr: 'JH030F', '10CartonsPrice': '5,00', color1: 'Red', Size: 'S' },
  { ArticleNr: '1000999999', CatalogNr: 'ZZ999', '10CartonsPrice': '9,00', color1: 'Blue', Size: 'XL' },
  { ArticleNr: '12345', CatalogNr: 'E3000', color1: 'Kaputt', Size: 'S' },
];
const baueCsv = (zeilen, kopf = CSV_KOPF) => '﻿' + [kopf.join(';'), ...zeilen.map(zeile)].join('\r\n') + '\r\n';
const PREISTEXTE = ['4,25', '4.25', '3,10', '3.1', '1,05', '1.05', '9,99', '9.99'];

function basis() {
  tabs = {
    Partner_Artikel: [['Partner-ID', 'Artikelnummer'], ['P-1', 'BG110/Tasche']],
    Varianten: [['SSOT-ID', 'LShop_ArticleNr'], ['JFN-1', '1000412880'], ['JFN-2', '']],
    Erfassungsmaske: [['ID', 'L-Shop-Artikelnummer'], ['JFN-1', 'JH30F'], ['JFN-2', 'Tasse']],
    Modelle_Zusatz: [['CatalogNr'], ['XT903']],
  };
  calls = [];
  streamAufrufe = 0;
  csvText = baueCsv(BASIS);
  dateien = [
    { id: 'f-alt', name: 'DE_Standard_DE_EUR_01.08.2026.csv', modifiedTime: '2026-09-26T10:00:00Z', size: '100' },
    { id: 'f-neu', name: 'DE_Standard_DE_EUR_07.09.2026.csv', modifiedTime: '2026-09-26T09:52:31Z', size: '203172820' },
    { id: 'x', name: 'Notizen.csv', modifiedTime: '2026-09-27T00:00:00Z' },
  ];
  produkte = {
    jfn: [{ sku: 'E3000/Shirt' }, { sku: 'KING BG42_Delfin' }, { sku: 'Tasse-Rot' }, { sku: 'L03581 Damen' }, { sku: '' }],
    honk: [{ sku: 'E3000 Keine Party' }],
  };
}
beforeEach(basis);

const JETZT = new Date('2026-09-26T10:00:00Z');
const lauf = (o = {}) => ls.stammdatenLauf({ sheets, drive, wcFuer, jetzt: JETZT, ...o });
const schreibAufrufe = () => calls.filter(c => ['update', 'clear', 'append', 'batchUpdate'].includes(c.art));
const zielZeilen = () => {
  const [kopf, ...rest] = tabs.LShop_Modelle;
  return rest.map(r => Object.fromEntries(kopf.map((n, i) => [n, r[i]])));
};

// ── Parser ──────────────────────────────────────────────────────────────────
describe('csvParser', () => {
  const parse = (teile) => {
    const out = [];
    const p = ls.csvParser(f => out.push(f));
    for (const s of teile) p.schreibe(s);
    p.ende();
    return out;
  };

  test('BOM weg, CRLF, Anfuehrung mit Semikolon und "" , leere Zeilen uebersprungen', () => {
    const r = parse(['﻿a;b;c\r\n1;"x; y ""z""";3\r\n\r\n4;;6\r\n']);
    expect(r).toEqual([['a', 'b', 'c'], ['1', 'x; y "z"', '3'], ['4', '', '6']]);
  });

  test('Chunk-Grenzen mitten in Anfuehrung, zwischen \\r und \\n, Zeilenumbruch im Feld', () => {
    const text = 'a;b\r\n"eins\r\nzwei";"x"";"\r\nletzte;ohne Umbruch';
    const teile = text.match(/[\s\S]{1,3}/g);
    expect(parse(teile)).toEqual([['a', 'b'], ['eins\r\nzwei', 'x";'], ['letzte', 'ohne Umbruch']]);
  });

  test('nur LF geht auch', () => {
    expect(parse(['a;b\n1;2\n'])).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('spaltenIndex', () => {
  test('ueber den Namen, Reihenfolge egal, BOM am ersten Namen', () => {
    const idx = ls.spaltenIndex(['﻿' + CSV_KOPF[0], ...CSV_KOPF.slice(1)]);
    expect(idx['10CartonsPrice']).toBe(4);
    expect(idx.CatNrManufacturer).toBe(12);
  });

  test('fehlende Spalte -> Abbruch mit Namen (422)', () => {
    const kopf = CSV_KOPF.filter(n => n !== '10CartonsPrice');
    expect(() => ls.spaltenIndex(kopf)).toThrow(/fehlt: 10CartonsPrice/);
    try { ls.spaltenIndex(kopf); } catch (e) { expect(e.status).toBe(422); }
  });

  test('doppelte Spalte -> Abbruch', () => {
    expect(() => ls.spaltenIndex([...CSV_KOPF, 'EAN'])).toThrow(/doppelt: EAN/);
  });

  test('aehnlicher Name zaehlt nicht (CartonPrice ist nicht 10CartonsPrice)', () => {
    const kopf = CSV_KOPF.map(n => (n === '10CartonsPrice' ? '10CartonPrice' : n));
    expect(() => ls.spaltenIndex(kopf)).toThrow(/fehlt: 10CartonsPrice/);
  });
});

describe('preisZahl und zeileFuersSheet', () => {
  test('Komma, Tausenderpunkt, Punkt, leer, unlesbar', () => {
    expect(ls.preisZahl('4,25')).toBe(4.25);
    expect(ls.preisZahl('1.234,50')).toBe(1234.5);
    expect(ls.preisZahl('4.25')).toBe(4.25);
    expect(ls.preisZahl(3.1)).toBe(3.1);
    expect(ls.preisZahl('')).toBeNull();
    expect(ls.preisZahl('abc')).toBeNaN();
  });

  test('Text bleibt Text (fuehrende Null, EAN 12/14 Ziffern), Preis und Zahlen als Zahl', () => {
    const z = ls.zeileFuersSheet({ ArticleNr: '1000311706', CatNrManufacturer: '03581', EAN: '04044444444444', '10CartonsPrice': '3,10', Discontinued: '2', QtyCarton: '25' });
    const w = n => z[ls.KOPF.indexOf(n)];
    expect(w('ArticleNr')).toBe('1000311706');
    expect(w('CatNrManufacturer')).toBe('03581');
    expect(w('EAN')).toBe('04044444444444');
    expect(ls.zeileFuersSheet({ EAN: '123456789012' })[ls.KOPF.indexOf('EAN')]).toBe('123456789012');
    expect(w('10CartonsPrice')).toBe(3.1);
    expect(w('Discontinued')).toBe(2);
    expect(w('QtyCarton')).toBe(25);
  });
});

describe('Datei', () => {
  test('namensDatum: Muster und echtes Datum', () => {
    expect(ls.namensDatum('DE_Standard_DE_EUR_07.09.2026.csv')).toBe('2026-09-07');
    expect(ls.namensDatum('DE_Standard_DE_EUR_31.02.2026.csv')).toBeNull();
    expect(ls.namensDatum('DE_Standard_DE_EUR_07.09.2026 (1).csv')).toBeNull();
  });

  test('neueste nach Namensdatum, nicht nach Upload-Zeit', () => {
    expect(ls.neuesteDatei(dateien).id).toBe('f-neu');
    expect(ls.neuesteDatei([{ name: 'x.csv' }])).toBeNull();
  });
});

describe('gebrauchte Modelle', () => {
  test('Regel wie LS0: vor "/", Altpraefix weg, Zusatz nach Leerzeichen weg, kein Modell -> null', () => {
    expect(ls.modellAus('E3000/Shirt')).toBe('E3000');
    expect(ls.modellAus('KING BG42_Delfin')).toBe('BG42');
    expect(ls.modellAus('Queen  bcww02q')).toBe('BCWW02Q');
    expect(ls.modellAus('E3000 Keine Party')).toBe('E3000');
    expect(ls.modellAus('Tasse-Rot')).toBeNull();
    expect(ls.modellAus('POLY-CB-20x25')).toBeNull();
    expect(ls.modellAus('387')).toBeNull();
  });

  test('Quellen je Modell, inkl. Modelle_Zusatz', () => {
    const m = ls.gebrauchteModelle({ 'Shop JFN': ['E3000/A', 'Tasse'], Modelle_Zusatz: ['xt903', 'E3000'] });
    expect([...m.keys()].sort()).toEqual(['E3000', 'XT903']);
    expect([...m.get('E3000')].sort()).toEqual(['Modelle_Zusatz', 'Shop JFN']);
  });

  test('kandidaten fuer Tippfehler', () => {
    const kat = new Set(['JH030F', 'JH305', 'E3005', 'E3000', 'BCWU02K']);
    expect(ls.kandidaten('JH30F', kat)).toEqual(['JH030F', 'JH305']);
    expect(ls.kandidaten('E30050', kat)).toEqual(['E3000', 'E3005']);
  });
});

describe('abgleich', () => {
  const datei = { name: 'DE_Standard_DE_EUR_07.09.2026.csv', datum: '07.09.2026' };
  const alt = (o) => ({ ...Object.fromEntries(ls.KOPF.map(n => [n, ''])), Status: 'aktiv', Quelle_Datei: 'alt.csv', Quelle_Datum: '01.08.2026', Stand: '2026-08-01 08:00', ...o });
  const csvZ = (o) => ({ ...Object.fromEntries(ls.CSV_SPALTEN.map(n => [n, ''])), ...o });

  test('neu / geaendert (Spalte + Preis getrennt) / unveraendert / ausgelaufen bleibt stehen', () => {
    const bestand = [
      alt({ ArticleNr: '1', CatalogNr: 'A', color1: 'Black', '10CartonsPrice': 4.25 }),           // unveraendert (Zahl vs "4,25")
      alt({ ArticleNr: '2', CatalogNr: 'A', color1: 'Black', '10CartonsPrice': 4.25 }),           // Preis + Farbe geaendert
      alt({ ArticleNr: '3', CatalogNr: 'A', color1: 'Red' }),                                     // fehlt in der Datei
      alt({ ArticleNr: '4', CatalogNr: 'A', Status: 'ausgelaufen', Stand: '2026-08-02 08:00' }),  // bleibt ausgelaufen
      alt({ ArticleNr: '5', CatalogNr: 'A', Status: 'ausgelaufen' }),                             // wieder da
    ];
    const csv = new Map([
      ['1', csvZ({ ArticleNr: '1', CatalogNr: 'A', color1: 'Black', '10CartonsPrice': '4,25' })],
      ['2', csvZ({ ArticleNr: '2', CatalogNr: 'A', color1: 'Navy', '10CartonsPrice': '4,50' })],
      ['5', csvZ({ ArticleNr: '5', CatalogNr: 'A' })],
      ['6', csvZ({ ArticleNr: '6', CatalogNr: 'A' })],
    ]);
    const { zeilen, zaehler } = ls.abgleich({ bestand, csv, datei, stand: '2026-09-26 12:00' });
    expect(zaehler).toMatchObject({ neu: 1, geaendert: 2, unveraendert: 1, ausgelaufen: 1, bleibtAusgelaufen: 1, reaktiviert: 1, preisAenderungen: 1 });
    expect(zaehler.spalten).toEqual({ color1: 1 });
    const by = Object.fromEntries(zeilen.map(z => [z.ArticleNr, z]));
    expect(zeilen).toHaveLength(6);
    expect(by['1'].Stand).toBe('2026-08-01 08:00');
    expect(by['1'].Quelle_Datei).toBe(datei.name);
    expect(by['2'].Stand).toBe('2026-09-26 12:00');
    expect(by['3']).toMatchObject({ Status: 'ausgelaufen', Stand: '2026-09-26 12:00', Quelle_Datei: 'alt.csv', color1: 'Red' });
    expect(by['4']).toMatchObject({ Status: 'ausgelaufen', Stand: '2026-08-02 08:00' });
    expect(by['5'].Status).toBe('aktiv');
    expect(by['6']).toMatchObject({ Status: 'aktiv', Quelle_Datum: '07.09.2026' });
  });

  test('doppelte ArticleNr im Reiter -> Abbruch', () => {
    const b = [alt({ ArticleNr: '1' }), alt({ ArticleNr: '1' })];
    expect(() => ls.abgleich({ bestand: b, csv: new Map(), datei, stand: 'x' })).toThrow(/doppelt/);
  });
});

// ── Lauf ────────────────────────────────────────────────────────────────────
describe('stammdatenLauf', () => {
  test('Trockenlauf: Zaehler, Nicht-Treffer mit Quelle und Kandidat, schreibt NIE', async () => {
    const r = await lauf({ modus: 'trockenlauf' });
    expect(r.datei).toMatchObject({ name: 'DE_Standard_DE_EUR_07.09.2026.csv', datum: '07.09.2026', passendeDateien: 2 });
    // E3000, BG42, L03581 (Shops), BG110 (Partner), JH30F (Maske), XT903 (Zusatz), CB166R (nur Varianten)
    expect(r.modelle).toEqual({ gebraucht: 7, gefunden: 5, ohneTreffer: 2 });
    expect(r.zeilen).toMatchObject({ gesamt: 6, neu: 6, geaendert: 0, ausgelaufen: 0 });
    expect(r.nichtTreffer).toEqual([
      { catalogNr: 'BG110', quellen: ['Partner_Artikel'], kandidaten: [] },
      { catalogNr: 'JH30F', quellen: ['Erfassungsmaske'], kandidaten: ['JH030F'] },
    ]);
    expect(r.discontinuedGesperrt).toBe(1);
    expect(r.dateiZaehler).toMatchObject({ dateiZeilen: 9, ungueltigeArticleNr: 1 });
    expect(r.hinweise.join(' ')).toMatch(/LShop_Modelle fehlt/);
    expect(streamAufrufe).toBe(2);             // zweiter Durchlauf fuer CB166R (nur ueber Varianten)
    expect(schreibAufrufe()).toEqual([]);
    expect(tabs.LShop_Modelle).toBeUndefined();
  });

  test('Modelle_Zusatz fehlt -> leer, Hinweis', async () => {
    delete tabs.Modelle_Zusatz;
    const r = await lauf({ modus: 'trockenlauf' });
    expect(r.modelle.gebraucht).toBe(6);
    expect(r.hinweise.join(' ')).toMatch(/Modelle_Zusatz fehlt/);
  });

  test('fehlende Spalte in der Datei -> 422, nichts geschrieben', async () => {
    const kopf = CSV_KOPF.map(n => (n === 'CatNrManufacturer' ? 'CatNrManufactur' : n));
    csvText = '﻿' + kopf.join(';') + '\r\n1;2\r\n';
    await expect(lauf({ modus: 'uebernehmen', datei: 'DE_Standard_DE_EUR_07.09.2026.csv' }))
      .rejects.toMatchObject({ status: 422, message: expect.stringMatching(/fehlt: CatNrManufacturer/) });
    expect(schreibAufrufe()).toEqual([]);
  });

  test('Uebernehmen mit anderer Datei als im Trockenlauf -> 409, nichts geschrieben', async () => {
    await expect(lauf({ modus: 'uebernehmen', datei: 'DE_Standard_DE_EUR_01.08.2026.csv' }))
      .rejects.toMatchObject({ status: 409 });
    await expect(lauf({ modus: 'uebernehmen' })).rejects.toMatchObject({ status: 400 });
    expect(schreibAufrufe()).toEqual([]);
    expect(streamAufrufe).toBe(0);             // Datei gar nicht erst gelesen
  });

  test('ungueltiger Modus -> 400', async () => {
    await expect(lauf({ modus: 'los' })).rejects.toMatchObject({ status: 400 });
  });

  test('Uebernehmen: Reiter anlegen (Kopf + Textformat), RAW schreiben, zuruecklesen, Chat ohne Preise', async () => {
    const notify = jest.fn(async () => true);
    const r = await lauf({ modus: 'uebernehmen', datei: 'DE_Standard_DE_EUR_07.09.2026.csv', notify, baueMeldung: buildLShopStammdatenNachricht });

    expect(tabs.LShop_Modelle[0]).toEqual(ls.KOPF);
    const add = calls.find(c => c.art === 'batchUpdate' && c.requests.some(q => q.addSheet));
    expect(add).toBeTruthy();
    const format = calls.filter(c => c.art === 'batchUpdate').flatMap(c => c.requests).filter(q => q.repeatCell);
    expect(format.map(q => q.repeatCell.range.startColumnIndex).sort((a, b) => a - b))
      .toEqual(['ArticleNr', 'CatNrManufacturer', 'EAN'].map(n => ls.KOPF.indexOf(n)).sort((a, b) => a - b));
    expect(format.every(q => q.repeatCell.cell.userEnteredFormat.numberFormat.type === 'TEXT' && q.repeatCell.range.startRowIndex === 1)).toBe(true);
    expect(calls.filter(c => c.art === 'update').every(c => c.valueInputOption === 'RAW')).toBe(true);

    const z = Object.fromEntries(zielZeilen().map(x => [x.ArticleNr, x]));
    expect(Object.keys(z).sort()).toEqual(['1000030393', '1000048353', '1000048354', '1000306860', '1000311706', '1000412880']);
    expect(z['1000311706']).toMatchObject({ CatNrManufacturer: '03581', EAN: '04044444444444', '10CartonsPrice': 3.1, Consistence: 'Ökotex™', Status: 'aktiv',
      Quelle_Datei: 'DE_Standard_DE_EUR_07.09.2026.csv', Quelle_Datum: '07.09.2026', Stand: '2026-09-26 12:00' });
    expect(z['1000030393']).toMatchObject({ EAN: '123456789012', Discontinued: 2 });
    expect(z['1000306860'].Discontinued).toBe(6);
    expect(typeof z['1000048353'].ArticleNr).toBe('string');
    expect(z['1000999999']).toBeUndefined();      // ungebrauchtes Modell

    expect(r.rueckgelesen).toMatchObject({ ok: true, zeilen: 6, erwartet: 6, aktiv: 6 });
    expect(r.chat).toBe('gesendet');
    const text = notify.mock.calls[0][0];
    expect(text).toMatch(/Datei vom 07\.09\.2026/);
    expect(text).toMatch(/5 Modelle · Zeilen: 6 neu, 0 geändert, 0 ausgelaufen/);
    expect(text).toMatch(/Ohne Treffer in der Datei \(2\): BG110, JH30F/);
    for (const p of PREISTEXTE) {
      expect(text).not.toContain(p);
      expect(JSON.stringify(r)).not.toContain(p);
    }
  });

  test('zweiter Lauf: Preis geaendert, Zeile fehlt -> ausgelaufen und bleibt, kein neuer Reiter', async () => {
    await lauf({ modus: 'uebernehmen', datei: 'DE_Standard_DE_EUR_07.09.2026.csv' });
    calls = [];
    const neu = BASIS.filter(z => z.ArticleNr !== '1000048354').map(z => (z.ArticleNr === '1000048353' ? { ...z, '10CartonsPrice': '4,40', color2: 'Grey' } : z));
    csvText = baueCsv(neu);
    dateien.push({ id: 'f-3', name: 'DE_Standard_DE_EUR_21.09.2026.csv', modifiedTime: '2026-09-26T11:00:00Z' });

    const tr = await lauf({ modus: 'trockenlauf' });
    expect(tr.datei.name).toBe('DE_Standard_DE_EUR_21.09.2026.csv');
    expect(tr.zeilen).toMatchObject({ gesamt: 6, neu: 0, geaendert: 1, unveraendert: 4, ausgelaufen: 1 });
    expect(tr.preisAenderungen).toBe(1);
    expect(tr.geaendertJeSpalte).toEqual({ color2: 1 });
    expect(schreibAufrufe()).toEqual([]);

    const r = await lauf({ modus: 'uebernehmen', datei: tr.datei.name });
    expect(calls.some(c => c.art === 'batchUpdate' && c.requests.some(q => q.addSheet))).toBe(false);
    const z = Object.fromEntries(zielZeilen().map(x => [x.ArticleNr, x]));
    expect(z['1000048354']).toMatchObject({ Status: 'ausgelaufen', Quelle_Datum: '07.09.2026', color1: 'Black' });
    expect(z['1000048353']).toMatchObject({ '10CartonsPrice': 4.4, color2: 'Grey', Quelle_Datum: '21.09.2026' });
    expect(r.rueckgelesen).toMatchObject({ ok: true, zeilen: 6, aktiv: 5, ausgelaufen: 1 });
  });

  test('Kopfzeile des Reiters von Hand veraendert -> 409, nichts geschrieben', async () => {
    tabs.LShop_Modelle = [[...ls.KOPF.slice(0, -1), 'Notiz']];
    await expect(lauf({ modus: 'uebernehmen', datei: 'DE_Standard_DE_EUR_07.09.2026.csv' })).rejects.toMatchObject({ status: 409 });
    expect(schreibAufrufe()).toEqual([]);
  });
});

describe('Chat-Text', () => {
  test('hoechstens 10 Nicht-Treffer + "weitere", keine Preise', () => {
    const text = buildLShopStammdatenNachricht({
      datum: '07.09.2026', modelle: 85, neu: 3, geaendert: 2, ausgelaufen: 1, preisAenderungen: 4,
      ohneTreffer: Array.from({ length: 13 }, (_, i) => `M${100 + i}`),
    });
    expect(text).toMatch(/^📦 L-Shop-Stammdaten übernommen · Datei vom 07\.09\.2026/);
    expect(text).toMatch(/85 Modelle · Zeilen: 3 neu, 2 geändert, 1 ausgelaufen/);
    expect(text).toMatch(/Preisänderungen: 4/);
    expect(text).toMatch(/\(13\): M100, .*M109 \+3 weitere/);
    expect(text).not.toMatch(/M110/);
  });

  test('ohne Nicht-Treffer keine Zeile dafuer', () => {
    expect(buildLShopStammdatenNachricht({ datum: '07.09.2026', ohneTreffer: [] })).not.toMatch(/Ohne Treffer/);
  });
});

// ── Route ───────────────────────────────────────────────────────────────────
describe('POST /api/lshop/stammdaten', () => {
  let app, request;
  beforeAll(async () => {
    ({ default: request } = await import('supertest'));
    const { default: express } = await import('express');
    const { default: router } = await import('../routes/lshop.js');
    app = express();
    app.use(express.json());
    app.use('/api/lshop', router);
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  });

  test('Trockenlauf 200, Log nur Zaehler (keine Preise), nichts geschrieben', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const res = await request(app).post('/api/lshop/stammdaten').send({ modus: 'trockenlauf' });
    expect(res.status).toBe(200);
    expect(res.body.modelle.gefunden).toBe(5);
    const ausgabe = log.mock.calls.flat().join(' ');
    log.mockRestore();
    expect(ausgabe).toMatch(/trockenlauf DE_Standard_DE_EUR_07\.09\.2026\.csv: modelle=5\/7/);
    for (const p of PREISTEXTE) expect(ausgabe).not.toContain(p);
    expect(schreibAufrufe()).toEqual([]);
  });

  test('falscher Modus 400, andere Datei 409', async () => {
    expect((await request(app).post('/api/lshop/stammdaten').send({ modus: 'x' })).status).toBe(400);
    const r = await request(app).post('/api/lshop/stammdaten').send({ modus: 'uebernehmen', datei: 'alt.csv' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/bitte neu prüfen/);
  });
});
