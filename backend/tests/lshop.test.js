// Befehl M1: Faser und Grammatur aus dem Reiter SKU_LShop (lib/lshop.js).
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
