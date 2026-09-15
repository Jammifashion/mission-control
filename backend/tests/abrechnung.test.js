// Lizenz-Abrechnungen (kalkulation.js) gegen gemockte Sheets.
//
// Punkt 4: Der angezeigte Lizenzsatz einer Verkaufszeile kommt aus ihren
// gespeicherten Werten (Lizenz-Anteil ÷ Gewinn-netto), nicht aus dem aktuellen
// Partner-Satz. Alte 50-%-Zeilen muessen weiter 50 % zeigen.
//
// B17: Freigabe und Verwerfen ordnen die Zeilen frisch gelesen ueber Partner +
// Zeitraum + Status + Inhalt zu, nie ueber den gespeicherten rowIndex.

import { jest } from '@jest/globals';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn() },
}));

jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: jest.fn(),
  getShopConfig: jest.fn().mockReturnValue({
    shop: 'jfn', label: 'JFN', wcUrl: '', wcKey: '', wcSecret: '',
    tabVerkaeufe: 'Partner_Verkäufe', tabAbrechnungen: 'Partner_Abrechnungen',
  }),
  normalizeShop: jest.fn(s => s ?? 'jfn'),
}));

const VH = [
  'Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante',
  'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status', 'Produkt-ID',
  'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status',
];
const AH = ['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Verkaufs-Guthaben', 'Saldo', 'Status', 'Erstellt-Am', 'Notiz', 'Positionen'];
const IH = ['Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Einzelpreis', 'Summe', 'Status'];
const STORNO = 'Storniert/Rückerstattet';

let request, app, values, ss, tabs, lizenzSatzAusZeile, abrZeilen;

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';
  ({ lizenzSatzAusZeile } = await import('../utils/partner-kalkulation.js'));
  abrZeilen = await import('../utils/abrechnung-zeilen.js');

  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');

  values = { get: jest.fn(), append: jest.fn(), batchUpdate: jest.fn() };
  ss = { values, get: jest.fn(), batchUpdate: jest.fn() };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: ss });

  const { default: router } = await import('../routes/kalkulation.js');
  app = express();
  app.use(express.json());
  app.use('/api/kalkulation', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

function basisTabs() {
  return {
    Partner: [
      ['Partner-ID', 'Name', 'Aktiv', 'Lizenz-%', 'Porto-Modell'],
      ['P-001', 'Test', 'Ja', '40', 'geteilt-50-50'],
    ],
    Partner_Artikel: [
      ['Partner-ID', 'Artikelnummer', 'Produkt-ID', 'Artikelname', 'EK-Preis-Netto', 'Druckkosten', 'Versandart', 'Lizenz-%'],
      ['P-001', 'S1', '1', 'Shirt', '3', '2', 'P', '50'],
    ],
    Kalkulation_Fixkosten: [['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis'], ['MwSt', '19', '%', '01.01.2022', '']],
    'Partner_Verkäufe': [VH],
    Partner_Interne_Bestellungen: [IH],
    Partner_Abrechnungen: [AH],
  };
}

beforeEach(() => {
  tabs = basisTabs();
  values.get.mockReset();
  // Kopie je Read: readTab haengt _sheetRow an die Zeilen-Arrays.
  values.get.mockImplementation(async ({ range }) => ({
    data: { values: (tabs[range.slice(0, range.indexOf('!'))] ?? []).map(r => [...r]) },
  }));
  values.append.mockReset();
  values.append.mockResolvedValue({ data: {} });
  values.batchUpdate.mockReset();
  values.batchUpdate.mockResolvedValue({ data: {} });
  ss.get.mockReset();
  ss.get.mockResolvedValue({ data: { sheets: [{ properties: { title: 'Partner_Abrechnungen', sheetId: 77 } }] } });
  ss.batchUpdate.mockReset();
  ss.batchUpdate.mockResolvedValue({ data: {} });
});

const erstellen = (von = '01.06.2026', bis = '30.06.2026') => request(app)
  .post('/api/kalkulation/abrechnung/erstellen')
  .send({ partnerId: 'P-001', zeitraumVon: von, zeitraumBis: bis });

// Entwurf wie im echten Ablauf ins Abrechnungs-Sheet uebernehmen.
async function entwurfAnlegen(von, bis) {
  const res = await erstellen(von, bis);
  expect(res.status).toBe(201);
  const zeile = values.append.mock.calls.at(-1)[0].requestBody.values[0];
  tabs.Partner_Abrechnungen.push(zeile.map(v => (typeof v === 'number' ? String(v).replace('.', ',') : v)));
  return res.body.abrechnungId;
}

const markierungen = () => values.batchUpdate.mock.calls.flatMap(c => c[0].requestBody.data);

// ── Punkt 4 ──────────────────────────────────────────────────────────────────

describe('lizenzSatzAusZeile', () => {
  test.each([
    [15, 7.5, 50], [28, 11.2, 40], [14.23, 5.690528, 40], [-28, -11.2, 40], [10, 4.5, 45], ['15', '7,5', 50],
  ])('Gewinn %p, Anteil %p → %p %', (g, a, erwartet) => {
    expect(lizenzSatzAusZeile(g, a)).toBe(erwartet);
  });

  test.each([[0, 0], ['', ''], [undefined, undefined], ['x', 1]])('nicht ableitbar (%p, %p) → null', (g, a) => {
    expect(lizenzSatzAusZeile(g, a)).toBeNull();
  });
});

describe('POST /abrechnung/erstellen – Satz im Positions-Detail', () => {
  beforeEach(() => {
    tabs['Partner_Verkäufe'].push(
      // Altzeile, mit 50 % gerechnet
      ['P-001', '01.06.2026', '100', 'Shirt', '0', '1', '21', '7,5', 'offen', '1', '15', '7,5', '0', '8,93', ''],
      // neue Zeile, mit 40 % gerechnet
      ['P-001', '02.06.2026', '101', 'Shirt', '0', '2', '42', '11,2', 'offen', '1', '28', '11,2', '0', '13,33', ''],
      // Altsync ohne Aufschluesselung
      ['P-001', '03.06.2026', '102', 'Shirt', '0', '1', '21', '6', 'offen', '1', '', '', '', '', ''],
    );
  });

  test('alte 50-%-Zeile zeigt 50 %, neue 40 %, Altsync fällt auf den Partner-Satz', async () => {
    const res = await erstellen();
    expect(res.status).toBe(201);
    const zeile = values.append.mock.calls[0][0].requestBody.values[0];
    const positionen = JSON.parse(zeile[AH.indexOf('Positionen')]);
    expect(positionen.verkaeufe.map(v => v.detail.lizenzProzent)).toEqual([50, 40, 40]);
  });

  test('Partner-Satz 40 % ändert gespeicherte Lizenzbeträge nicht', async () => {
    const res = await erstellen();
    expect(res.body.lizenzSumme).toBe(24.7); // 7,5 + 11,2 + 6 aus dem Sheet
  });
});

// ── B17 ──────────────────────────────────────────────────────────────────────

describe('B17 – Freigabe ordnet über Inhalt zu, nicht über rowIndex', () => {
  const A      = ['P-001', '05.06.2026', '200', 'Shirt - M', '11', '1', '21', '5',   'offen', '1', '12,5', '5',   '0', '5,95',  ''];
  const B      = ['P-001', '06.06.2026', '201', 'Shirt - L', '12', '2', '42', '10',  'offen', '1', '25',   '10',  '0', '11,9',  ''];
  const B_ST   = ['P-001', '08.06.2026', '201', 'Shirt - L', '12', '-2', '-42', '-10', 'offen', '1', '-25', '-10', '0', '-11,9', STORNO];
  const FREMD  = ['P-002', '07.06.2026', '300', 'Hoodie',    '0',  '1', '40', '9',   'offen', '2', '20',   '9',   '0', '10,71', ''];
  const JULI   = ['P-001', '02.07.2026', '202', 'Shirt - S', '13', '1', '21', '5',   'offen', '1', '12,5', '5',   '0', '5,95',  ''];
  const TASSE  = ['P-001', '10.06.2026', 'Tasse', '1', '5', '5', 'offen'];
  const TASSE2 = ['P-002', '10.06.2026', 'Tasse', '1', '5', '5', 'offen'];

  // Spalte I = Status Verkaeufe, G = Status intern
  const vMark = nr => ({ range: `Partner_Verkäufe!I${nr}`, majorDimension: 'ROWS', values: [['abgerechnet']] });
  const iMark = nr => ({ range: `Partner_Interne_Bestellungen!G${nr}`, majorDimension: 'ROWS', values: [['abgerechnet']] });

  beforeEach(() => {
    tabs['Partner_Verkäufe'].push(A, B, B_ST, FREMD, JULI);          // Zeilen 2..6
    tabs.Partner_Interne_Bestellungen.push(TASSE, TASSE2);            // Zeilen 2..3
  });

  const freigeben = id => request(app).post(`/api/kalkulation/abrechnung/${id}/freigeben`);

  test('Zeilen eingefügt und gelöscht zwischen Entwurf und Freigabe → genau die Entwurfszeilen markiert', async () => {
    const id = await entwurfAnlegen();

    // Zwischen Entwurf und Freigabe: oben zwei Zeilen eingefuegt (eine davon
    // offen, gleicher Partner, im Zeitraum - ein Sync-Nachzuegler), die fremde
    // Zeile geloescht. Intern ebenfalls eine neue offene Zeile oben.
    const NACHZUEGLER = ['P-001', '09.06.2026', '205', 'Shirt - XL', '14', '1', '21', '5', 'offen', '1', '12,5', '5', '0', '5,95', ''];
    const ANDERER     = ['P-003', '09.06.2026', '206', 'Cap', '0', '1', '15', '3', 'offen', '3', '7', '3', '0', '3,57', ''];
    tabs['Partner_Verkäufe'] = [VH, NACHZUEGLER, ANDERER, A, B, B_ST, JULI];
    tabs.Partner_Interne_Bestellungen = [IH, ['P-001', '11.06.2026', 'Neu', '2', '4', '8', 'offen'], TASSE, TASSE2];

    const res = await freigeben(id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'freigegeben', anzahlVerkäufe: 3, anzahlInterne: 1 });

    const data = markierungen();
    expect(data[0]).toEqual({ range: 'Partner_Abrechnungen!G2', majorDimension: 'ROWS', values: [['freigegeben']] });
    // A, B, B-Storno stehen jetzt in 4, 5, 6 - die gespeicherten rowIndex waeren 2, 3, 4.
    expect(data.slice(1)).toEqual([vMark(4), vMark(5), vMark(6), iMark(3)]);
    // Der Nachzuegler (Zeile 2) ist nicht im Entwurf und bleibt offen.
    expect(data.map(d => d.range)).not.toContain('Partner_Verkäufe!I2');
  });

  test('ohne Änderungen: markiert die Zeilen an ihrer Stelle', async () => {
    const id = await entwurfAnlegen();
    await freigeben(id);
    expect(markierungen().slice(1)).toEqual([vMark(2), vMark(3), vMark(4), iMark(2)]);
  });

  test('Verkauf und Gegenbuchung mit gleichem Order/Artikel/Variante werden getrennt zugeordnet', async () => {
    const id = await entwurfAnlegen();
    // Gegenbuchung nach vorn sortiert - trotzdem beide genau einmal.
    tabs['Partner_Verkäufe'] = [VH, B_ST, A, B, FREMD, JULI];
    await freigeben(id);
    expect(markierungen().slice(1, 4).map(d => d.range).sort())
      .toEqual(['Partner_Verkäufe!I2', 'Partner_Verkäufe!I3', 'Partner_Verkäufe!I4']);
  });

  test('Position gelöscht → 409, nichts geschrieben', async () => {
    const id = await entwurfAnlegen();
    tabs['Partner_Verkäufe'] = [VH, A, B_ST, FREMD, JULI];            // B fehlt
    const res = await freigeben(id);
    expect(res.status).toBe(409);
    expect(res.body.fehlendVerkaeufe).toEqual([expect.objectContaining({ orderId: '201', artikelname: 'Shirt - L' })]);
    expect(values.batchUpdate).not.toHaveBeenCalled();
  });

  test('Position inzwischen abgerechnet → 409, nichts geschrieben', async () => {
    const id = await entwurfAnlegen();
    tabs['Partner_Verkäufe'][1] = Object.assign([...A], { 8: 'abgerechnet' });
    const res = await freigeben(id);
    expect(res.status).toBe(409);
    expect(values.batchUpdate).not.toHaveBeenCalled();
  });

  test('Entwurf von vor B17 (ohne storno-Feld, rowIndex falsch) wird korrekt zugeordnet', async () => {
    const id = await entwurfAnlegen();
    const zeile = tabs.Partner_Abrechnungen[1];
    const pos = JSON.parse(zeile[AH.indexOf('Positionen')]);
    pos.verkaeufe.forEach(p => { delete p.storno; p.rowIndex = 99; });
    pos.intern.forEach(p => { p.rowIndex = 99; });
    zeile[AH.indexOf('Positionen')] = JSON.stringify(pos);

    await freigeben(id);
    expect(markierungen().slice(1)).toEqual([vMark(2), vMark(3), vMark(4), iMark(2)]);
  });

  test('nur Entwürfe → 400', async () => {
    const id = await entwurfAnlegen();
    tabs.Partner_Abrechnungen[1][AH.indexOf('Status')] = 'freigegeben';
    const res = await freigeben(id);
    expect(res.status).toBe(400);
    expect(values.batchUpdate).not.toHaveBeenCalled();
  });

  test('zweiter Entwurf mit überlappendem Zeitraum → 409', async () => {
    await entwurfAnlegen('01.06.2026', '30.06.2026');
    const res = await erstellen('15.06.2026', '15.07.2026');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/überlappend/);
  });

  test('anschließender Zeitraum ist kein Konflikt', async () => {
    await entwurfAnlegen('01.06.2026', '30.06.2026');
    const res = await erstellen('01.07.2026', '31.07.2026');
    expect(res.status).toBe(201);
  });

  describe('Verwerfen', () => {
    const verwerfen = id => request(app).delete(`/api/kalkulation/abrechnung/${id}`);

    test('Normalfall: nichts zurückzusetzen, Entwurfszeile gelöscht', async () => {
      const id = await entwurfAnlegen();
      const res = await verwerfen(id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ deleted: true, zurueckgesetzt: 0 });
      expect(values.batchUpdate).not.toHaveBeenCalled();
      expect(ss.batchUpdate.mock.calls[0][0].requestBody.requests[0].deleteDimension.range)
        .toMatchObject({ sheetId: 77, startIndex: 1, endIndex: 2 });
    });

    test('abgerechnete Zeilen des Entwurfs → offen, fremde abgerechnete Zeile bleibt', async () => {
      const id = await entwurfAnlegen();
      const ALT = ['P-001', '04.06.2026', '199', 'Shirt - M', '11', '1', '21', '5', 'abgerechnet', '1', '12,5', '5', '0', '5,95', ''];
      tabs['Partner_Verkäufe'] = [
        VH, ALT,
        Object.assign([...A], { 8: 'abgerechnet' }),
        B, B_ST, FREMD, JULI,
      ];
      tabs.Partner_Interne_Bestellungen = [IH, Object.assign([...TASSE], { 6: 'abgerechnet' }), TASSE2];

      const res = await verwerfen(id);
      expect(res.body.zurueckgesetzt).toBe(2);
      expect(markierungen()).toEqual([
        { range: 'Partner_Verkäufe!I3', values: [['offen']] },
        { range: 'Partner_Interne_Bestellungen!G2', values: [['offen']] },
      ]);
    });
  });
});

describe('Vertrag-ab – Abrechnung mit Zeilen vor dem Vertragsbeginn wird abgelehnt', () => {
  const zeile = (datum, order) =>
    ['P-001', datum, order, 'Shirt', '0', '1', '21', '5', 'offen', '1', '12,5', '5', '0', '5,95', ''];

  const mitVertrag = wert => {
    tabs.Partner = [
      ['Partner-ID', 'Name', 'Aktiv', 'Lizenz-%', 'Porto-Modell', 'Vertrag-ab'],
      ['P-001', 'Test', 'Ja', '40', 'geteilt-50-50', wert],
    ];
  };

  beforeEach(() => {
    tabs['Partner_Verkäufe'].push(
      zeile('01.06.2026', '300'),
      zeile('02.06.2026', '301'),
      zeile('03.06.2026', '302'),
      zeile('20.06.2026', '303'),
    );
  });

  const vorschau = (von = '01.06.2026', bis = '30.06.2026') => request(app)
    .post('/api/kalkulation/abrechnung/vorschau')
    .send({ partnerId: 'P-001', zeitraumVon: von, zeitraumBis: bis });

  test('Zeitraum enthält Zeilen vor Vertrag-ab → 409 mit Partner-ID und Datum, nichts angelegt', async () => {
    mitVertrag('03.06.2026');
    const res = await erstellen('01.06.2026', '30.06.2026');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      partnerId: 'P-001', vertragAb: '03.06.2026', anzahlVorVertragsbeginn: 2, fruehestesDatum: '01.06.2026',
    });
    expect(res.body.error).toMatch(/P-001/);
    expect(res.body.error).toMatch(/03\.06\.2026/);
    expect(values.append).not.toHaveBeenCalled();
    expect(values.batchUpdate).not.toHaveBeenCalled();
  });

  test('Zeitraum ab Vertrag-ab → 201, Stichtag gehört dazu', async () => {
    mitVertrag('03.06.2026');
    const res = await erstellen('03.06.2026', '30.06.2026');
    expect(res.status).toBe(201);
    expect(res.body.anzahlVerkäufe).toBe(2);   // 03.06. und 20.06.
  });

  test('Zeitraum beginnt vor Vertrag-ab, aber ohne Zeilen davor → 201', async () => {
    mitVertrag('03.06.2026');
    tabs['Partner_Verkäufe'] = [VH, zeile('03.06.2026', '302'), zeile('20.06.2026', '303')];
    const res = await erstellen('01.01.2026', '30.06.2026');
    expect(res.status).toBe(201);
  });

  test('leeres Vertrag-ab → keine Grenze', async () => {
    mitVertrag('');
    const res = await erstellen('01.06.2026', '30.06.2026');
    expect(res.status).toBe(201);
    expect(res.body.anzahlVerkäufe).toBe(4);
  });

  test('Vorschau lehnt genauso ab', async () => {
    mitVertrag('03.06.2026');
    const res = await vorschau();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ partnerId: 'P-001', anzahlVorVertragsbeginn: 2 });
  });

  test('Vorschau ohne Grenze liefert weiter die Summe', async () => {
    const res = await vorschau();
    expect(res.status).toBe(200);
    expect(res.body.verkaeufe).toHaveLength(4);
  });

  test('ungültiges Vertrag-ab → 500 mit Partner-ID, nichts angelegt', async () => {
    mitVertrag('31.02.2026');
    const res = await erstellen('01.06.2026', '30.06.2026');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/P-001/);
    expect(values.append).not.toHaveBeenCalled();
  });
});

describe('abrechnung-zeilen – Helfer', () => {
  test('parseDatum: zweistellig, einstellig, ISO, Unsinn', () => {
    const { parseDatum } = abrZeilen;
    expect(parseDatum('01.06.2026')).toEqual(new Date(Date.UTC(2026, 5, 1)));
    expect(parseDatum('1.6.2026')).toEqual(new Date(Date.UTC(2026, 5, 1)));
    expect(parseDatum('2026-06-01')).toEqual(new Date(Date.UTC(2026, 5, 1)));
    expect(parseDatum('Juni')).toBeNull();
    expect(parseDatum('')).toBeNull();
  });

  test('Dubletten: jede Position verbraucht genau eine Zeile', () => {
    const rows = [
      ['P-001', '05.06.2026', '200', 'Shirt', '0', '1', 'offen', ''],
      ['P-001', '05.06.2026', '200', 'Shirt', '0', '1', 'offen', ''],
    ];
    rows.forEach((r, i) => { r._sheetRow = i + 2; });
    const header = ['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'Status', 'Storno-Status'];
    const { treffer, fehlend } = abrZeilen.verkaufsZeilenDerAbrechnung({
      header, rows, partnerId: 'P-001',
      von: new Date(Date.UTC(2026, 5, 1)), bis: new Date(Date.UTC(2026, 5, 30)),
      positionen: [{ orderId: '200', artikelname: 'Shirt', variationId: '0', storno: false }],
      statusPasst: s => s === 'offen',
    });
    expect(treffer.map(r => r._sheetRow)).toEqual([2]);
    expect(fehlend).toEqual([]);
  });
});
