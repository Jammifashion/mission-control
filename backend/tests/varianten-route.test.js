// VR1: Routen fuer den Reiter Varianten mit gemocktem Sheets-Client.
// Das Mock haelt den Reiter als Array; deleteDimension und append wirken darauf,
// sodass "Bestand -> Speichern -> Ergebnis" pruefbar ist.

import { jest } from '@jest/globals';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn() },
}));

jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

let request, app, values, spreadsheets, tab;

beforeAll(async () => {
  process.env.GOOGLE_SHEET_ID = 'ssot-test';
  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');

  values = { get: jest.fn(), update: jest.fn(), append: jest.fn(), batchUpdate: jest.fn() };
  spreadsheets = { get: jest.fn(), batchUpdate: jest.fn(), values };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets });

  const { default: router } = await import('../routes/sheets.js');
  app = express();
  app.use(express.json());
  app.use('/api/sheets', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

const setzeTab = rows => { tab = rows.map(r => [...r]); };

beforeEach(() => {
  spreadsheets.get.mockReset().mockResolvedValue({
    data: { sheets: [{ properties: { title: 'Varianten', sheetId: 77 } }] },
  });
  values.get.mockReset().mockImplementation(async ({ range }) => {
    if (range !== 'Varianten') throw new Error(`unerwartete Range ${range}`);
    return { data: { values: tab.map(r => [...r]) } };
  });
  spreadsheets.batchUpdate.mockReset().mockImplementation(async ({ requestBody }) => {
    for (const rq of requestBody.requests) {
      if (rq.deleteDimension) tab.splice(rq.deleteDimension.range.startIndex, 1);
    }
    return { data: {} };
  });
  values.update.mockReset().mockImplementation(async ({ range, requestBody }) => {
    if (/^Varianten![A-Z]+1$/.test(range)) {
      tab[0].push(requestBody.values[0][0]);   // sichereSpalte: Kopfzelle anhaengen
    }
    return { data: {} };
  });
  values.append.mockReset().mockImplementation(async ({ requestBody }) => {
    const erste = tab.length + 1;
    tab.push(...requestBody.values.map(r => r.map(c => (typeof c === 'boolean' ? String(c).toUpperCase() : String(c)))));
    // Wie die echte API: updates.updatedRange nennt die eingefuegten Zeilen.
    return { data: { updates: { updatedRange: `Varianten!A${erste}:N${tab.length}` } } };
  });
  values.batchUpdate.mockReset().mockResolvedValue({ data: {} });
});

// Absichtlich nicht A..L: Reihenfolge vertauscht, WC_Variation_ID vorne,
// dazu eine fremde Spalte und LShop_ArticleNr.
const KOPF = ['WC_Variation_ID', 'SSOT-ID', 'LShop_ArticleNr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3',
  'Varianten-Nr', 'Preis', 'Aktiv', 'Google_Farbe', 'Notiz'];
const z = w => KOPF.map(h => w[h] ?? '');
const wert = (row, name) => row[tab[0].indexOf(name)];
const zeilenVon = id => tab.slice(1).filter(r => wert(r, 'SSOT-ID') === id);

const BESTAND = [
  KOPF,
  z({ 'SSOT-ID': 'JFN-A', 'Varianten-Nr': '1', E1: 'Größe', V1: 'M', E2: 'Farbe', V2: 'Schwarz', LShop_ArticleNr: '1000311706', Notiz: 'n1' }),
  z({ 'SSOT-ID': 'JFN-B', 'Varianten-Nr': '1', E1: 'Größe', V1: 'S', LShop_ArticleNr: '1000000123' }),
  z({ 'SSOT-ID': 'JFN-A', 'Varianten-Nr': '2', E1: 'Größe', V1: '5XL', E2: 'Farbe', V2: 'Schwarz', LShop_ArticleNr: '1000000999' }),
];

const speichern = (id, varianten) => request(app).put(`/api/sheets/varianten/${id}`).send({ varianten });

describe('PUT /api/sheets/varianten/:ssotId', () => {
  test('unbekannte Spalten bleiben erhalten, Achsen vertauscht, neue leer, entfernte weg', async () => {
    setzeTab(BESTAND);
    const res = await speichern('JFN-A', [
      { nr: 1, e1: 'Farbe', v1: 'Schwarz', e2: 'Größe', v2: 'M', preis: '22', aktiv: true },
      { nr: 2, e1: 'Farbe', v1: 'Schwarz', e2: 'Größe', v2: 'L', preis: '22', aktiv: true },
    ]);
    expect(res.status).toBe(200);

    const a = zeilenVon('JFN-A');
    expect(a).toHaveLength(2);
    const m = a.find(r => wert(r, 'V2') === 'M');
    const l = a.find(r => wert(r, 'V2') === 'L');
    expect(wert(m, 'LShop_ArticleNr')).toBe('1000311706');
    expect(wert(m, 'Notiz')).toBe('n1');
    expect(wert(m, 'E1')).toBe('Farbe');            // Payload gewinnt fuer bekannte Felder
    expect(wert(l, 'LShop_ArticleNr')).toBe('');
    expect(tab.flat()).not.toContain('1000000999');  // 5XL entfernt
    // Andere SSOT-ID unberuehrt
    expect(wert(zeilenVon('JFN-B')[0], 'LShop_ArticleNr')).toBe('1000000123');
    // Jede angehaengte Zeile hat die volle Breite der Kopfzeile
    for (const r of values.append.mock.calls[0][0].requestBody.values) expect(r).toHaveLength(KOPF.length);
  });

  test('lshopArticleNr aus dem Payload landet als String "1000311706"', async () => {
    setzeTab(BESTAND);
    const res = await speichern('JFN-B', [{ nr: 1, e1: 'Größe', v1: 'S', lshopArticleNr: 1000311706 }]);
    expect(res.status).toBe(200);
    const gesendet = values.append.mock.calls[0][0].requestBody.values[0];
    expect(gesendet[KOPF.indexOf('LShop_ArticleNr')]).toBe('1000311706');
  });

  test.each([['9-stellig', '100031170'], ['Buchstaben', '10003117AB']])(
    '%s -> 400 mit SSOT-ID und Schluessel, nichts geschrieben', async (_n, nr) => {
      setzeTab(BESTAND);
      const res = await speichern('JFN-B', [{ nr: 1, e1: 'Größe', v1: 'S', lshopArticleNr: nr }]);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/JFN-B/);
      expect(res.body.error).toMatch(/"Größe=S"/);
      expect(spreadsheets.batchUpdate).not.toHaveBeenCalled();
      expect(values.append).not.toHaveBeenCalled();
      expect(values.update).not.toHaveBeenCalled();
    });

  test('doppelter Schluessel im Payload -> 400, nichts geloescht', async () => {
    setzeTab(BESTAND);
    const res = await speichern('JFN-A', [
      { e1: 'Größe', v1: 'M', e2: 'Farbe', v2: 'Schwarz' },
      { e1: 'Farbe', v1: 'schwarz', e2: 'GRÖSSE', v2: 'm' },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JFN-A.*doppelt/);
    expect(spreadsheets.batchUpdate).not.toHaveBeenCalled();
    expect(zeilenVon('JFN-A')).toHaveLength(2);
  });

  test('doppelter Schluessel im Bestand -> 409, nichts geloescht', async () => {
    setzeTab([...BESTAND, z({ 'SSOT-ID': 'JFN-B', E1: 'größe', V1: 's' })]);
    const res = await speichern('JFN-B', [{ e1: 'Größe', v1: 'S' }]);
    expect(res.status).toBe(409);
    expect(spreadsheets.batchUpdate).not.toHaveBeenCalled();
    expect(zeilenVon('JFN-B')).toHaveLength(2);
  });

  test('Spalte LShop_ArticleNr fehlt + Payload bringt sie -> hinten angelegt, Format Text', async () => {
    const ohne = BESTAND.map(r => r.filter((_, i) => KOPF[i] !== 'LShop_ArticleNr'));
    setzeTab(ohne);
    const res = await speichern('JFN-B', [{ nr: 1, e1: 'Größe', v1: 'S', lshopArticleNr: '1000311706' }]);
    expect(res.status).toBe(200);
    expect(tab[0][tab[0].length - 1]).toBe('LShop_ArticleNr');
    const neuIdx = tab[0].length - 1;
    const format = spreadsheets.batchUpdate.mock.calls
      .flatMap(c => c[0].requestBody.requests).find(r => r.repeatCell)?.repeatCell;
    expect(format).toMatchObject({
      range: { sheetId: 77, startRowIndex: 1, startColumnIndex: neuIdx, endColumnIndex: neuIdx + 1 },
      cell:  { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
    });
    expect(wert(zeilenVon('JFN-B')[0], 'LShop_ArticleNr')).toBe('1000311706');
  });

  test('ohne L-Shop im Payload wird keine Spalte angelegt', async () => {
    const ohne = BESTAND.map(r => r.filter((_, i) => KOPF[i] !== 'LShop_ArticleNr'));
    setzeTab(ohne);
    await speichern('JFN-B', [{ nr: 1, e1: 'Größe', v1: 'S' }]);
    expect(tab[0]).not.toContain('LShop_ArticleNr');
    expect(values.update).not.toHaveBeenCalled();
  });
});

describe('Reihenfolge: erst anhaengen, dann alte Zeilen loeschen', () => {
  const PAYLOAD_A = [
    { nr: 1, e1: 'Farbe', v1: 'Schwarz', e2: 'Größe', v2: 'M', preis: '22', aktiv: true },
    { nr: 2, e1: 'Farbe', v1: 'Schwarz', e2: 'Größe', v2: 'L', preis: '22', aktiv: true },
  ];

  test('Normalfall: append vor delete, Ergebnis wie bisher', async () => {
    setzeTab(BESTAND);
    const res = await speichern('JFN-A', PAYLOAD_A);
    expect(res.status).toBe(200);
    const appendNr = values.append.mock.invocationCallOrder[0];
    const deleteNr = spreadsheets.batchUpdate.mock.invocationCallOrder[0];
    expect(appendNr).toBeLessThan(deleteNr);
    // Geloescht wurden genau die alten JFN-A-Zeilen (Index 3 und 1, absteigend)
    expect(spreadsheets.batchUpdate.mock.calls[0][0].requestBody.requests
      .map(r => r.deleteDimension.range.startIndex)).toEqual([3, 1]);
    expect(tab).toEqual([
      KOPF,
      BESTAND[2],
      z({ 'SSOT-ID': 'JFN-A', 'Varianten-Nr': '1', E1: 'Farbe', V1: 'Schwarz', E2: 'Größe', V2: 'M',
        Preis: '22', Aktiv: 'TRUE', LShop_ArticleNr: '1000311706', Notiz: 'n1' }),
      z({ 'SSOT-ID': 'JFN-A', 'Varianten-Nr': '2', E1: 'Farbe', V1: 'Schwarz', E2: 'Größe', V2: 'L',
        Preis: '22', Aktiv: 'TRUE' }),
    ]);
  });

  test('Anhaengen wirft -> Reiter unveraendert, nichts geloescht', async () => {
    setzeTab(BESTAND);
    values.append.mockRejectedValueOnce(new Error('quota'));
    const res = await speichern('JFN-A', PAYLOAD_A);
    expect(res.status).toBe(500);
    expect(spreadsheets.batchUpdate).not.toHaveBeenCalled();
    expect(tab).toEqual(BESTAND);
  });

  test('Loeschen wirft -> neue Zeilen stehen, Fehler nennt SSOT-ID und die alten Zeilen', async () => {
    setzeTab(BESTAND);
    spreadsheets.batchUpdate.mockRejectedValueOnce(new Error('timeout'));
    const res = await speichern('JFN-A', PAYLOAD_A);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/JFN-A/);
    expect(res.body.error).toMatch(/Zeilen doppelt/);
    expect(res.body.error).toMatch(/Alte Zeilen 2, 4 von Hand löschen/);
    expect(zeilenVon('JFN-A')).toHaveLength(4);   // 2 alt + 2 neu
  });

  test('zusammenhaengende alte Zeilen erscheinen als Bereich X–Y', async () => {
    setzeTab([KOPF, BESTAND[1], BESTAND[3], BESTAND[2]]);   // JFN-A in Zeile 2 und 3
    spreadsheets.batchUpdate.mockRejectedValueOnce(new Error('timeout'));
    const res = await speichern('JFN-A', PAYLOAD_A);
    expect(res.body.error).toMatch(/Alte Zeilen 2–3 von Hand löschen/);
  });

  test('API fuegt vor alten Zeilen ein -> alte Indizes werden verschoben, richtige Zeilen geloescht', async () => {
    // Leerzeile nach Zeile 2: die API erkennt die Tabelle nur bis dort und fuegt
    // dahinter ein - die JFN-A-Zeile weiter unten rutscht nach unten.
    setzeTab([KOPF, BESTAND[1], KOPF.map(() => ''), BESTAND[3]]);
    values.append.mockImplementationOnce(async ({ requestBody }) => {
      tab.splice(2, 0, ...requestBody.values.map(r => r.map(String)));
      return { data: { updates: { updatedRange: `Varianten!A3:N${2 + requestBody.values.length}` } } };
    });
    const res = await speichern('JFN-A', PAYLOAD_A);
    expect(res.status).toBe(200);
    // Alte Zeilen: Index 1 (vor der Einfuegung) und 3 -> 3 + 2 = 5
    expect(spreadsheets.batchUpdate.mock.calls[0][0].requestBody.requests
      .map(r => r.deleteDimension.range.startIndex)).toEqual([5, 1]);
    expect(zeilenVon('JFN-A').map(r => wert(r, 'V2'))).toEqual(['M', 'L']);
  });
});

describe('GET /api/sheets/varianten', () => {
  test('liest ueber Namen, lshopArticleNr als String', async () => {
    setzeTab(BESTAND);
    const res = await request(app).get('/api/sheets/varianten?ssotId=JFN-A');
    expect(res.status).toBe(200);
    expect(res.body.varianten.map(v => [v.nr, v.v1, v.lshopArticleNr]))
      .toEqual([[1, 'M', '1000311706'], [2, '5XL', '1000000999']]);
  });
});

describe('PUT /api/sheets/varianten/:ssotId/wc-ids', () => {
  test('schreibt in die Spalte namens WC_Variation_ID, egal wo sie steht', async () => {
    setzeTab(BESTAND);   // WC_Variation_ID = Spalte A, JFN-A Nr 2 = Zeile 4
    const res = await request(app).put('/api/sheets/varianten/JFN-A/wc-ids')
      .send({ mappings: [{ variantenNr: 2, wcVariationId: 4711 }] });
    expect(res.status).toBe(200);
    expect(values.batchUpdate.mock.calls[0][0].requestBody.data)
      .toEqual([{ range: 'Varianten!A4', values: [[4711]] }]);
  });

  test('Spalte weiter hinten -> Buchstabe folgt dem Namen', async () => {
    const k2 = [...KOPF.filter(h => h !== 'WC_Variation_ID'), 'WC_Variation_ID'];   // Spalte N
    setzeTab([k2, k2.map(h => ({ 'SSOT-ID': 'JFN-A', 'Varianten-Nr': '1' }[h] ?? ''))]);
    await request(app).put('/api/sheets/varianten/JFN-A/wc-ids')
      .send({ mappings: [{ variantenNr: 1, wcVariationId: 1 }] });
    expect(values.batchUpdate.mock.calls[0][0].requestBody.data[0].range).toBe('Varianten!N2');
  });
});
