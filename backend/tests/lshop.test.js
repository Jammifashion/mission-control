// Befehl M1: Faser und Grammatur aus dem Reiter LShop_Modelle (lib/lshop.js).
//
// Testdaten sind Platzhalter-Fixtures im Format des Reiters, keine Kopie der
// Stammdatei. Die Werte fuer CB166R und die Consistence-Texte fuer E3000 und
// L03581 sind woertlich aus dem Reiter (gemessen 25.09.), damit die Tests die
// echten Klammerformen treffen.

import { jest } from '@jest/globals';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn() },
}));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

const {
  farbwert, prozentAbschnitte, pruefeHundertProzent, lshopAuswertung,
  ladeLShopZeilen, lshopFuerArtikel, _resetLShopCache, TAB_LSHOP,
} = await import('../lib/lshop.js');

// ── Fixtures ────────────────────────────────────────────────────────────────

const zeile = (articleNr, catalogNr, color1, color2, size, consistence, grammage) =>
  ({ articleNr, catalogNr, color1, color2, size, consistence, grammage });

const CB166R = [
  zeile('1000412880', 'CB166R', 'Black', 'Kelly Green', 'One Size', '100% Polyester', ''),
  zeile('1000412881', 'CB166R', 'Black', 'Red', 'One Size', '100% Polyester', ''),
  zeile('1000412882', 'CB166R', 'Black', 'White', 'One Size', '100% Polyester', ''),
  zeile('1000412883', 'CB166R', 'Navy', 'Sky Blue', 'One Size', '100% Polyester', ''),
  zeile('1000412884', 'CB166R', 'White', 'Black', 'One Size', '100% Polyester', ''),
];

const E3000_FASER = '100% Baumwolle (Sports Grey: 85% Baumwolle / 15% Viskose)';
const E3000 = ['Black', 'Sports Grey (Heather)'].flatMap((farbe, i) =>
  ['M', 'S', 'XL'].map((g, j) => zeile(`90000000${i}${j}`, 'E3000', farbe, '', g, E3000_FASER, '180 g/m²')));

const L03581_FASER = '100% Baumwolle (Heather Beige, Heather Light Green, Heather Pink: 60% Baumwolle / 40% Polyester), '
  + '(Grey Melange: 85% Baumwolle / 15% Viskose) (Ash: 98% Baumwolle / 15% Viskose)';
const L03581 = ['Deep Black', 'Ash (Heather)'].map((farbe, i) =>
  zeile(`91000000${i}0`, 'L03581', farbe, '', 'M', L03581_FASER, '150 g/m²'));

// ── Reine Logik ─────────────────────────────────────────────────────────────

describe('farbwert', () => {
  test('color1/color2, ohne color2 nur color1', () => {
    expect(farbwert('Black', 'Kelly Green')).toBe('Black/Kelly Green');
    expect(farbwert(' Black ', '')).toBe('Black');
    expect(farbwert('Black', undefined)).toBe('Black');
    expect(farbwert('', '')).toBe('');
  });
});

describe('CB166R (Match Day Cap)', () => {
  const r = lshopAuswertung(CB166R, { farben: ['Black/Kelly Green', 'Black/Red', 'Black/White'] });

  test('drei Farbwerte englisch wie L-Shop, in Auswahlreihenfolge', () => {
    expect(r.farben).toEqual(['Black/Kelly Green', 'Black/Red', 'Black/White']);
  });

  test('ArticleNr je Variante als String', () => {
    expect(r.varianten).toEqual([
      { farbe: 'Black/Kelly Green', groesse: 'One Size', articleNr: '1000412880' },
      { farbe: 'Black/Red',         groesse: 'One Size', articleNr: '1000412881' },
      { farbe: 'Black/White',       groesse: 'One Size', articleNr: '1000412882' },
    ]);
    for (const v of r.varianten) expect(typeof v.articleNr).toBe('string');
  });

  test('Faser "100% Polyester", Grammatur leer ohne Hinweis', () => {
    expect(r.faser).toBe('100% Polyester');
    expect(r.grammatur).toBeNull();
    expect(r.hinweise).toEqual([]);
  });

  test('eine Groesse "One Size" ohne Sortierhinweis', () => {
    expect(r.groessen).toEqual(['One Size']);
  });

  test('alle Farben der Nummer bleiben sichtbar, "White/Black" ist nicht "Black/White"', () => {
    expect(r.alleFarben).toEqual(['Black/Kelly Green', 'Black/Red', 'Black/White', 'Navy/Sky Blue', 'White/Black']);
  });

  test('Farbe gross/klein egal, unbekannte Farbe -> Hinweis', () => {
    const x = lshopAuswertung(CB166R, { farben: ['black/red', 'Black/Blue'] });
    expect(x.farben).toEqual(['Black/Red']);
    expect(x.hinweise).toEqual(['Farbe "Black/Blue" gibt es im L-Shop für diese Nummer nicht.']);
  });
});

describe('E3000 (Klammerform)', () => {
  test('nur Black: Klammer der nicht angebotenen Farbe faellt weg', () => {
    const r = lshopAuswertung(E3000, { farben: ['Black'] });
    expect(r.faser).toBe('100% Baumwolle');
    expect(r.grammatur).toBe('180 g/m²');
    expect(r.hinweise).toEqual([]);
  });

  test('Black + Sports Grey (Heather): Klammer bleibt, beide Abschnitte auf 100 %', () => {
    const r = lshopAuswertung(E3000, { farben: ['Black', 'Sports Grey (Heather)'] });
    expect(r.faser).toBe(E3000_FASER);
    expect(r.hinweise).toEqual([]);
  });

  test('Groessen sortiert ueber lib/groessen.js', () => {
    expect(lshopAuswertung(E3000, { farben: ['Black'] }).groessen).toEqual(['S', 'M', 'XL']);
  });
});

describe('100-%-Regel (L03581)', () => {
  test('Ash (Heather): 98 % + 15 % = 113 % -> keine Faser, Hinweis', () => {
    const r = lshopAuswertung(L03581, { farben: ['Ash (Heather)'] });
    expect(r.faser).toBeNull();
    expect(r.hinweise).toEqual([
      'Faserangabe geht nicht auf 100 % auf ("Ash: 98% Baumwolle / 15% Viskose" = 113 %) – nicht übernommen, bitte prüfen.',
    ]);
    expect(r.grammatur).toBe('150 g/m²');
  });

  test('Deep Black allein: Klammern fallen weg, 100 % - uebernommen', () => {
    const r = lshopAuswertung(L03581, { farben: ['Deep Black'] });
    expect(r.faser).toBe('100% Baumwolle');
    expect(r.hinweise).toEqual([]);
  });

  test('prozentAbschnitte zaehlt aussen und je Klausel', () => {
    expect(prozentAbschnitte(E3000_FASER)).toEqual([
      { teil: '100% Baumwolle', summe: 100 },
      { teil: 'Sports Grey: 85% Baumwolle / 15% Viskose', summe: 100 },
    ]);
    expect(pruefeHundertProzent('100% Polyester')).toBeNull();
    expect(pruefeHundertProzent('Jersey')).toBeNull();
    expect(pruefeHundertProzent('60% Baumwolle / 30% Polyester')).toMatch(/= 90 %/);
  });
});

describe('ungleiche Werte je Farbe', () => {
  const MIX = [
    zeile('9200000001', 'X1', 'Black', '', 'M', '100% Baumwolle', '180 g/m²'),
    zeile('9200000002', 'X1', 'Heather Grey', '', 'M', '80% Baumwolle / 20% Polyester', '190 g/m²'),
  ];

  test('Faser unterscheidet sich -> keine Faser, Hinweis mit den Werten', () => {
    const r = lshopAuswertung(MIX, { farben: ['Black', 'Heather Grey'] });
    expect(r.faser).toBeNull();
    expect(r.hinweise).toContain(
      'Faserangabe unterscheidet sich je Farbe (Black: 100% Baumwolle; Heather Grey: 80% Baumwolle / 20% Polyester)'
      + ' – nicht übernommen, bitte prüfen.');
  });

  test('Grammatur unterscheidet sich -> keine Grammatur, Hinweis', () => {
    const r = lshopAuswertung(MIX, { farben: ['Black', 'Heather Grey'] });
    expect(r.grammatur).toBeNull();
    expect(r.hinweise).toContain(
      'Grammatur unterscheidet sich je Farbe (Black: 180 g/m²; Heather Grey: 190 g/m²) – nicht übernommen, bitte prüfen.');
  });

  test('eine Farbe allein ist eindeutig', () => {
    const r = lshopAuswertung(MIX, { farben: ['Heather Grey'] });
    expect(r.faser).toBe('80% Baumwolle / 20% Polyester');
    expect(r.grammatur).toBe('190 g/m²');
    expect(r.hinweise).toEqual([]);
  });
});

// ── M8b: Discontinued ───────────────────────────────────────────────────────

// BG42 wie im Reiter (gemessen 25.09.): 12 Farben, eine Groesse, Jungle Camo
// und Fluorescent Yellow mit Discontinued 1. ArticleNr Platzhalter.
const BG42_FARBEN = ['Black', 'Bright Royal', 'Classic Red', 'French Navy', 'Fuchsia', 'Graphite Grey',
  'Lime Green', 'Orange', 'White', 'Burgundy', 'Jungle Camo', 'Fluorescent Yellow'];
const BG42 = BG42_FARBEN.map((f, i) => ({
  ...zeile(`10000304${String(i).padStart(2, '0')}`, 'BG42', f, '', '38 x 14 x 8 cm', '100% Polyester', ''),
  discontinued: ['Jungle Camo', 'Fluorescent Yellow'].includes(f) ? '1' : '0',
}));

describe('Discontinued (M8b)', () => {
  test('BG42: Wert 1 bleibt waehlbar, ist als auslaufend markiert, kein Hinweis', () => {
    const r = lshopAuswertung(BG42, {});
    expect(r.alleFarben).toEqual(BG42_FARBEN);
    expect(r.gesperrt).toEqual([]);
    expect(r.auslaufend).toEqual([
      { farbe: 'Jungle Camo', groesse: '38 x 14 x 8 cm', wert: 1 },
      { farbe: 'Fluorescent Yellow', groesse: '38 x 14 x 8 cm', wert: 1 },
    ]);
    expect(r.varianten.find(v => v.farbe === 'Jungle Camo')).toMatchObject({ auslauf: 1 });
    expect(r.varianten.find(v => v.farbe === 'Black')).not.toHaveProperty('auslauf');
    expect(r.hinweise).toEqual([]);
  });

  test('BG42 White, Black, Pink: Pink gibt es nicht, Auswahl sonst wie bisher', () => {
    const r = lshopAuswertung(BG42, { farben: ['White', 'Black', 'Pink'] });
    expect(r.farben).toEqual(['White', 'Black']);
    expect(r.hinweise).toEqual(['Farbe "Pink" gibt es im L-Shop für diese Nummer nicht.']);
  });

  test('3 und 6: Farbe/Variante nicht waehlbar, mit Hinweis', () => {
    const z = [
      { ...zeile('9000000001', 'X1', 'Black', '', 'M', '100% Baumwolle', ''), discontinued: '0' },
      { ...zeile('9000000002', 'X1', 'Black', '', 'L', '100% Baumwolle', ''), discontinued: '6' },
      { ...zeile('9000000003', 'X1', 'Red', '', 'M', '100% Baumwolle', ''), discontinued: '3' },
      { ...zeile('9000000004', 'X1', 'Red', '', 'L', '100% Baumwolle', ''), discontinued: '3' },
      { ...zeile('9000000005', 'X1', 'Blue', '', 'M', '100% Baumwolle', ''), discontinued: '2' },
    ];
    const r = lshopAuswertung(z, { farben: ['Black', 'Red', 'Blue'] });
    expect(r.alleFarben).toEqual(['Black', 'Blue']);
    expect(r.farben).toEqual(['Black', 'Blue']);
    expect(r.varianten).toEqual([
      { farbe: 'Black', groesse: 'M', articleNr: '9000000001' },
      { farbe: 'Blue', groesse: 'M', articleNr: '9000000005', auslauf: 2 },
    ]);
    expect(r.groessen).toEqual(['M']);
    expect(r.hinweise).toEqual([
      'Farbe "Red" ist im L-Shop gesperrt (Discontinued 3) – nicht wählbar.',
      'Black / L: im L-Shop gesperrt (Discontinued 6) – nicht wählbar.',
    ]);
    expect(r.gesperrt.map(g => `${g.farbe}/${g.groesse}=${g.wert}`)).toEqual(['Black/L=6', 'Red/M=3', 'Red/L=3']);
    expect(r.auslaufend).toEqual([{ farbe: 'Blue', groesse: 'M', wert: 2 }]);
  });

  // LS2: Status "ausgelaufen" (Nummer nicht mehr in der Stammdatei) wie
  // Discontinued 3/6: nicht anbieten, aber Marke/Modellnummer bleiben lesbar.
  test('Status ausgelaufen: nicht waehlbar, eigener Hinweis, Pruefdaten bleiben', () => {
    const z = [
      { ...zeile('9000000001', 'X2', 'Black', '', 'M', '100% Baumwolle', ''), status: 'aktiv', marke: 'Marke A', herstellerNr: '03581' },
      { ...zeile('9000000002', 'X2', 'Black', '', 'L', '100% Baumwolle', ''), status: 'ausgelaufen', discontinued: '2' },
      { ...zeile('9000000003', 'X2', 'Red', '', 'M', '100% Baumwolle', ''), status: 'Ausgelaufen', marke: 'Marke A', herstellerNr: '03581' },
      { ...zeile('9000000004', 'X2', 'Blue', '', 'M', '100% Baumwolle', ''), status: '' },
    ];
    const r = lshopAuswertung(z, { farben: ['Black', 'Red', 'Blue'] });
    expect(r.alleFarben).toEqual(['Black', 'Blue']);
    expect(r.varianten).toEqual([
      { farbe: 'Black', groesse: 'M', articleNr: '9000000001' },
      { farbe: 'Blue', groesse: 'M', articleNr: '9000000004' },
    ]);
    expect(r.hinweise).toEqual([
      'Farbe "Red" steht nicht mehr in der L-Shop-Stammdatei (ausgelaufen) – nicht wählbar.',
      'Black / L: nicht mehr in der L-Shop-Stammdatei (ausgelaufen) – nicht wählbar.',
    ]);
    expect(r.gesperrt.map(g => `${g.farbe}/${g.groesse}=${g.wert}`)).toEqual(['Black/L=ausgelaufen', 'Red/M=ausgelaufen']);
    expect(r.auslaufend).toEqual([]);                      // Discontinued 2 der ausgelaufenen Zeile zaehlt nicht
    expect(r.marken).toEqual(['Marke A']);
    expect(r.herstellerNummern).toEqual(['03581']);        // fuehrende Null bleibt
  });

  test('ohne Spalte oder leer: normal', () => {
    const r = lshopAuswertung(CB166R, {});
    expect(r.gesperrt).toEqual([]);
    expect(r.auslaufend).toEqual([]);
    expect(r.alleFarben).toHaveLength(5);
  });
});

// ── Lesen: header-basiert, ganze Breite, ArticleNr als String ───────────────

function sheetsMock(kopf, spalten) {
  const get = jest.fn(async ({ range }) => {
    if (range !== `${TAB_LSHOP}!1:1`) throw new Error(`unerwartete Range ${range}`);
    return { data: { values: [kopf] } };
  });
  const batchGet = jest.fn(async ({ ranges }) => ({
    data: {
      valueRanges: ranges.map(r => {
        const buchstabe = /!([A-Z]+)2:/.exec(r)[1];
        return { range: r, values: [spalten[buchstabe] ?? []] };
      }),
    },
  }));
  return { api: { spreadsheets: { values: { get, batchGet } } }, get, batchGet };
}

// Kopf mit Fuellspalten: die gesuchten Spalten liegen hinter Z (AA, AB, ...).
const FUELL = Array.from({ length: 26 }, (_, i) => `Frei${i}`);
const KOPF  = [...FUELL, 'color2', 'CatalogNr', 'ArticleNr', 'Size', 'Consistence', 'Grammage', 'color1'];

describe('ladeLShopZeilen', () => {
  beforeEach(() => _resetLShopCache());

  test('Spalten ueber den Namen, auch hinter Z; FORMATTED_VALUE; Zeilen zusammengefuehrt', async () => {
    const { api, batchGet } = sheetsMock(KOPF, {
      AA: ['Kelly Green', 'Red'],
      AB: ['CB166R', 'CB166R'],
      AC: ['1000412880', '1000412881'],
      AD: ['One Size', 'One Size'],
      AE: ['100% Polyester', '100% Polyester'],
      AF: [],
      AG: ['Black', 'Black'],
    });
    const z = await ladeLShopZeilen({ sheets: api, spreadsheetId: 'ssot-test' });
    expect(z).toEqual([
      zeile('1000412880', 'CB166R', 'Black', 'Kelly Green', 'One Size', '100% Polyester', ''),
      zeile('1000412881', 'CB166R', 'Black', 'Red', 'One Size', '100% Polyester', ''),
    ]);
    const arg = batchGet.mock.calls[0][0];
    expect(arg.valueRenderOption).toBe('FORMATTED_VALUE');
    expect(arg.majorDimension).toBe('COLUMNS');
    expect(arg.ranges).toContain(`${TAB_LSHOP}!AC2:AC`);
  });

  test('fehlende Pflichtspalte wirft mit Spaltennamen', async () => {
    const { api } = sheetsMock(['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Grammage'], {});
    await expect(ladeLShopZeilen({ sheets: api, spreadsheetId: 'ssot-test' }))
      .rejects.toThrow(/Spalte "Consistence" fehlt/);
  });

  test('Cache: zweiter Aufruf liest nicht erneut', async () => {
    const { api, get } = sheetsMock(KOPF, { AB: ['CB166R'], AC: ['1000412880'], AG: ['Black'] });
    await ladeLShopZeilen({ sheets: api, spreadsheetId: 'ssot-test' });
    await ladeLShopZeilen({ sheets: api, spreadsheetId: 'ssot-test' });
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('lshopFuerArtikel: unbekannte Nummer -> 404', async () => {
    const { api } = sheetsMock(KOPF, { AB: ['CB166R'], AC: ['1000412880'], AG: ['Black'] });
    await expect(lshopFuerArtikel('ZZ999', { sheets: api, spreadsheetId: 'ssot-test' }))
      .rejects.toMatchObject({ status: 404 });
  });
});

// ── Route (duenn) ───────────────────────────────────────────────────────────

describe('GET /api/sheets/lshop/:catalogNr', () => {
  let request, app;

  beforeAll(async () => {
    process.env.GOOGLE_SHEET_ID = 'ssot-test';
    const { default: supertest } = await import('supertest');
    request = supertest;
    const { default: express } = await import('express');
    const { google } = await import('googleapis');
    const { api } = sheetsMock(KOPF, {
      AA: CB166R.map(z => z.color2),
      AB: CB166R.map(z => z.catalogNr),
      AC: CB166R.map(z => z.articleNr),
      AD: CB166R.map(z => z.size),
      AE: CB166R.map(z => z.consistence),
      AF: CB166R.map(z => z.grammage),
      AG: CB166R.map(z => z.color1),
    });
    google.sheets.mockReturnValue(api);
    const { default: router } = await import('../routes/sheets.js');
    app = express();
    app.use('/api/sheets', router);
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  });

  beforeEach(() => _resetLShopCache());

  test('Farben als wiederholter Parameter', async () => {
    const res = await request(app)
      .get('/api/sheets/lshop/CB166R')
      .query('farben=Black%2FKelly%20Green&farben=Black%2FRed&farben=Black%2FWhite');
    expect(res.status).toBe(200);
    expect(res.body.farben).toEqual(['Black/Kelly Green', 'Black/Red', 'Black/White']);
    expect(res.body.varianten.map(v => v.articleNr)).toEqual(['1000412880', '1000412881', '1000412882']);
    expect(res.body.faser).toBe('100% Polyester');
    expect(res.body.grammatur).toBeNull();
    expect(res.body.groessen).toEqual(['One Size']);
    expect(res.body.hinweise).toEqual([]);
  });

  test('Farben kommagetrennt', async () => {
    const res = await request(app).get('/api/sheets/lshop/CB166R?farben=Black%2FRed,Black%2FWhite');
    expect(res.body.farben).toEqual(['Black/Red', 'Black/White']);
  });

  test('unbekannte Nummer -> 404', async () => {
    const res = await request(app).get('/api/sheets/lshop/ZZ999');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/ZZ999/);
  });
});
