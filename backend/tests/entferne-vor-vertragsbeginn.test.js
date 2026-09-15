// EINMAL-TEST – wird zusammen mit backend/scripts/entferne-vor-vertragsbeginn.js
// und .github/workflows/entferne-vor-vertragsbeginn.yml wieder entfernt.
//
// Schutzregeln des Einmal-Skripts: Trockenlauf ist Standard, geloescht wird nur
// mit --loeschen UND passender Erwartung (Zeilen + Summe) gegen den frisch
// gelesenen Stand, in einem batchUpdate von unten nach oben.

import { jest } from '@jest/globals';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn() },
}));

jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

const PH = ['Partner-ID', 'Name', 'Aktiv', 'Lizenz-%', 'Porto-Modell', 'Shop', 'Vertrag-ab'];
const VH = [
  'Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante',
  'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status', 'Produkt-ID',
  'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status',
];
const STORNO = 'Storniert/Rückerstattet';
const z = (partner, datum, order, artikel, stk, liz, status = 'offen', storno = '') =>
  [partner, datum, order, artikel, '1', stk, '20', liz, status, '1', '10', liz, '0', liz, storno];

// Sheet-Zeile steht im Kommentar (Kopfzeile = 1)
function verkaeufe() {
  return [
    VH,
    z('P-004', '25.11.2022', '880',  'Shirt A', '1',  '3,82'),                       // 2  weg
    z('P-004', '10.01.2025', '2100', 'Shirt B', '1',  '4,00'),                       // 3  bleibt
    z('P-004', '18.08.2023', '985',  'Shirt C', '1',  '4,60'),                       // 4  weg
    z('P-004', '12.01.2024', '985',  'Shirt C', '-1', '-4,60', 'offen', STORNO),     // 5  weg (Paar vor Stichtag)
    z('P-004', '01.02.2024', '1500', 'Shirt D', '1',  '5,00'),                       // 6  weg
    z('P-004', '03.02.2025', '1500', 'Shirt D', '-1', '-5,00', 'offen', STORNO),     // 7  weg (folgt Verkauf)
    z('P-005', '01.01.2022', '100',  'Fremd',   '1',  '9,99'),                       // 8  fremder Partner
    [],                                                                               // 9  Leerzeile
    z('P-004', '01.01.2025', '2000', 'Shirt E', '1',  '2,00'),                       // 10 Stichtag bleibt
    z('P-004', '05.05.2022', '700',  'Shirt F', '-1', '-1,00', 'offen', STORNO),     // 11 Waise bleibt
  ];
}

let mod, values, ss, tabs;

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';
  values = { get: jest.fn() };
  ss = { values, get: jest.fn(), batchUpdate: jest.fn() };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: ss });
  mod = await import('../scripts/entferne-vor-vertragsbeginn.js');
});

beforeEach(() => {
  tabs = {
    Partner: [PH, ['P-004', 'Honk', 'Ja', '40', 'geteilt-50-50', 'honk', '01.01.2025'], ['P-005', 'X', 'Ja', '40', 'geteilt-50-50', 'honk', '']],
    'HK_Partner_Verkäufe': verkaeufe(),
  };
  values.get.mockReset();
  values.get.mockImplementation(async ({ range }) => ({
    data: { values: (tabs[range.slice(0, range.indexOf('!'))] ?? []).map(r => [...r]) },
  }));
  ss.get.mockReset();
  ss.get.mockResolvedValue({ data: { sheets: [{ properties: { title: 'HK_Partner_Verkäufe', sheetId: 4711 } }] } });
  ss.batchUpdate.mockReset();
  ss.batchUpdate.mockResolvedValue({ data: {} });
});

const leise = () => {};
const ARGS = ['--partner=P-004', '--shop=honk'];

// ── Auswahl ──────────────────────────────────────────────────────────────────

describe('waehleZeilen', () => {
  const auswahl = () => {
    const [header, ...rows] = verkaeufe();
    rows.forEach((r, i) => { r._sheetRow = i + 2; });
    return mod.waehleZeilen({
      header, rows: rows.filter(r => r.length), partnerId: 'P-004', beginn: new Date(Date.UTC(2025, 0, 1)),
    });
  };

  test('Zeilen vor Vertrag-ab, Gegenbuchung folgt ihrem Verkauf', () => {
    const a = auswahl();
    expect(a.zeilen.map(r => r._sheetRow)).toEqual([2, 4, 5, 6, 7]);
    expect(a.anzahl).toBe(5);
    expect(a.summe).toBe(3.82);
  });

  test('Stichtag bleibt, fremder Partner bleibt, Gegenbuchung ohne Verkauf bleibt (gemeldet)', () => {
    const a = auswahl();
    const nummern = a.zeilen.map(r => r._sheetRow);
    expect(nummern).not.toContain(10);
    expect(nummern).not.toContain(8);
    expect(nummern).not.toContain(11);
    expect(a.waisen.map(r => r._sheetRow)).toEqual([11]);
    expect(a.bleiben).toBe(3);   // 3, 10, 11
  });
});

// ── Freigabe ─────────────────────────────────────────────────────────────────

describe('pruefeFreigabe', () => {
  const auswahl = { anzahl: 48, summe: 192.61, abgerechnet: [] };

  test('ohne --loeschen: Trockenlauf', () => {
    expect(mod.pruefeFreigabe({ loeschen: false }, auswahl).loeschen).toBe(false);
  });

  test('Erwartung passt → löschen', () => {
    expect(mod.pruefeFreigabe({ loeschen: true, erwarteteZeilen: 48, erwarteteSumme: 192.61 }, auswahl).loeschen).toBe(true);
  });

  test.each([
    [47, 192.61], [49, 192.61], [48, 192.60], [48, 192.62], [48, 0],
  ])('Erwartung %p Zeilen / %p € passt nicht → kein Löschen, gefundene Werte im Grund', (zeilen, summe) => {
    const f = mod.pruefeFreigabe({ loeschen: true, erwarteteZeilen: zeilen, erwarteteSumme: summe }, auswahl);
    expect(f.loeschen).toBe(false);
    expect(f.grund).toMatch(/gefunden: 48 Zeilen, Summe 192,61 €/);
  });

  test('abgerechnete Zeile in der Auswahl → kein Löschen', () => {
    const f = mod.pruefeFreigabe(
      { loeschen: true, erwarteteZeilen: 48, erwarteteSumme: 192.61 },
      { ...auswahl, abgerechnet: [{ _sheetRow: 17 }] },
    );
    expect(f.loeschen).toBe(false);
    expect(f.grund).toMatch(/17/);
  });
});

// ── Argumente ────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  test('Standard ist Trockenlauf', () => {
    expect(mod.parseArgs(ARGS)).toMatchObject({ partnerId: 'P-004', shop: 'honk', loeschen: false });
  });

  test('Summe mit Komma', () => {
    expect(mod.parseArgs([...ARGS, '--erwartete-summe=192,61', '--erwartete-zeilen=48']))
      .toMatchObject({ erwarteteSumme: 192.61, erwarteteZeilen: 48 });
  });

  test.each([
    [['--shop=honk'], /--partner/],
    [['--partner=P-004; rm -rf', '--shop=honk'], /--partner/],
    [['--partner=P-004', '--shop=xyz'], /--shop/],
    [[...['--partner=P-004', '--shop=honk'], '--loeschen'], /erwartete/],
    [[...['--partner=P-004', '--shop=honk'], '--loeschen', '--erwartete-zeilen=48'], /erwartete/],
    [[...['--partner=P-004', '--shop=honk'], '--erwartete-zeilen=4,8'], /ganze Zahl/],
    [[...['--partner=P-004', '--shop=honk'], '--erwartete-summe=viel'], /keine Zahl/],
  ])('%p wirft', (argv, meldung) => {
    expect(() => mod.parseArgs(argv)).toThrow(meldung);
  });
});

// ── Lösch-Requests ───────────────────────────────────────────────────────────

describe('baueLoeschRequests', () => {
  test('von unten nach oben, je Zeile ein deleteDimension', () => {
    const req = mod.baueLoeschRequests(4711, [2, 4, 5, 6, 7].map(n => ({ _sheetRow: n })));
    expect(req.map(r => r.deleteDimension.range.startIndex)).toEqual([6, 5, 4, 3, 1]);
    expect(req[0]).toEqual({ deleteDimension: { range: { sheetId: 4711, dimension: 'ROWS', startIndex: 6, endIndex: 7 } } });
  });

  test('doppelte Zeilennummer wirft', () => {
    expect(() => mod.baueLoeschRequests(1, [{ _sheetRow: 3 }, { _sheetRow: 3 }])).toThrow(/Doppelte/);
  });
});

// ── Ablauf gegen gemocktes Sheet ─────────────────────────────────────────────

describe('run', () => {
  test('Trockenlauf: liest, schreibt nichts', async () => {
    const r = await mod.run(ARGS, leise);
    expect(r).toEqual({ geloescht: false, anzahl: 5, summe: 3.82 });
    expect(ss.batchUpdate).not.toHaveBeenCalled();
  });

  test('--loeschen mit falscher Erwartung: Abbruch ohne Schreiben, gefundene Werte in der Meldung', async () => {
    await expect(mod.run([...ARGS, '--loeschen', '--erwartete-zeilen=48', '--erwartete-summe=192,61'], leise))
      .rejects.toThrow(/ABBRUCH ohne Schreiben.*gefunden: 5 Zeilen, Summe 3,82 €/);
    expect(ss.batchUpdate).not.toHaveBeenCalled();
  });

  test('--loeschen mit passender Erwartung: genau ein batchUpdate, von unten nach oben', async () => {
    const r = await mod.run([...ARGS, '--loeschen', '--erwartete-zeilen=5', '--erwartete-summe=3,82'], leise);
    expect(r.geloescht).toBe(true);
    expect(ss.batchUpdate).toHaveBeenCalledTimes(1);
    const { requests } = ss.batchUpdate.mock.calls[0][0].requestBody;
    expect(requests.map(q => q.deleteDimension.range.startIndex)).toEqual([6, 5, 4, 3, 1]);
    expect(requests.every(q => q.deleteDimension.range.sheetId === 4711)).toBe(true);
  });

  test('Zeilennummern kommen aus dem frischen Read – eine eingefügte Zeile verschiebt die Auswahl mit', async () => {
    tabs['HK_Partner_Verkäufe'].splice(1, 0, z('P-005', '01.03.2026', '9999', 'Neu', '1', '1,00'));
    await mod.run([...ARGS, '--loeschen', '--erwartete-zeilen=5', '--erwartete-summe=3,82'], leise);
    const { requests } = ss.batchUpdate.mock.calls[0][0].requestBody;
    expect(requests.map(q => q.deleteDimension.range.endIndex)).toEqual([8, 7, 6, 5, 3]);
  });

  test('abgerechnete Zeile in der Auswahl: Abbruch ohne Schreiben', async () => {
    tabs['HK_Partner_Verkäufe'][1][8] = 'abgerechnet';
    await expect(mod.run([...ARGS, '--loeschen', '--erwartete-zeilen=5', '--erwartete-summe=3,82'], leise))
      .rejects.toThrow(/abgerechnete/);
    expect(ss.batchUpdate).not.toHaveBeenCalled();
  });

  test('Partner ohne Vertrag-ab: Abbruch, auch im Trockenlauf', async () => {
    tabs.Partner[1][6] = '';
    await expect(mod.run(ARGS, leise)).rejects.toThrow(/kein Vertrag-ab/);
    expect(ss.batchUpdate).not.toHaveBeenCalled();
  });

  test('Reiter nicht gefunden: Abbruch vor dem Löschen', async () => {
    ss.get.mockResolvedValue({ data: { sheets: [{ properties: { title: 'Anderer', sheetId: 1 } }] } });
    await expect(mod.run([...ARGS, '--loeschen', '--erwartete-zeilen=5', '--erwartete-summe=3,82'], leise))
      .rejects.toThrow(/nicht gefunden/);
    expect(ss.batchUpdate).not.toHaveBeenCalled();
  });
});
