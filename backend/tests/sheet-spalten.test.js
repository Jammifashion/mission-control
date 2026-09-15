// sichereSpalte / colLetter - verschoben aus routes/kalkulation.js nach utils/.
// Das Verhalten fuer Vertrag-ab prueft vertrag-ab.test.js unveraendert.

import { jest } from '@jest/globals';
import { colLetter, sichereSpalte } from '../utils/sheet-spalten.js';

const neueSheets = () => ({ spreadsheets: { values: { update: jest.fn().mockResolvedValue({ data: {} }) } } });

describe('colLetter', () => {
  test.each([[0, 'A'], [25, 'Z'], [26, 'AA'], [77, 'BZ'], [78, 'CA'], [701, 'ZZ'], [702, 'AAA']])(
    '%i → %s', (i, s) => expect(colLetter(i)).toBe(s),
  );
});

describe('sichereSpalte', () => {
  test('fehlt → Name in Zeile 1 hinter der letzten Spalte, header erweitert', async () => {
    const sheets = neueSheets();
    const header = ['ID', 'Status', 'Produktname'];
    const idx = await sichereSpalte(sheets, 'sid', 'Erfassungsmaske', header, 'Marke');
    expect(idx).toBe(3);
    expect(header).toEqual(['ID', 'Status', 'Produktname', 'Marke']);
    expect(sheets.spreadsheets.values.update).toHaveBeenCalledTimes(1);
    expect(sheets.spreadsheets.values.update).toHaveBeenCalledWith({
      spreadsheetId: 'sid', range: 'Erfassungsmaske!D1', valueInputOption: 'RAW',
      requestBody: { values: [['Marke']] },
    });
  });

  test('Bestandszeilen bleiben leer: es wird nur Zeile 1 geschrieben', async () => {
    const sheets = neueSheets();
    await sichereSpalte(sheets, 'sid', 'Erfassungsmaske', ['A', 'B'], 'Marke');
    const { range, requestBody } = sheets.spreadsheets.values.update.mock.calls[0][0];
    expect(range).toMatch(/!C1$/);
    expect(requestBody.values).toEqual([['Marke']]);
  });

  test('hinter BZ: Spalte CA', async () => {
    const sheets = neueSheets();
    const header = Array.from({ length: 78 }, (_, i) => `S${i}`);
    expect(await sichereSpalte(sheets, 'sid', 'Erfassungsmaske', header, 'Marke')).toBe(78);
    expect(sheets.spreadsheets.values.update.mock.calls[0][0].range).toBe('Erfassungsmaske!CA1');
  });

  test.each([
    [['Marke', 'ID', 'Status'], 0],
    [['ID', 'Marke', 'Status'], 1],
    [['ID', 'Status', ' marke '], 2],
  ])('vorhanden an beliebiger Position %j → Index %i, nichts geschrieben', async (header, idx) => {
    const sheets = neueSheets();
    const vorher = [...header];
    expect(await sichereSpalte(sheets, 'sid', 'Erfassungsmaske', header, 'Marke')).toBe(idx);
    expect(header).toEqual(vorher);
    expect(sheets.spreadsheets.values.update).not.toHaveBeenCalled();
  });

  test('exakter Vergleich: "Markenname" zaehlt nicht als "Marke"', async () => {
    const sheets = neueSheets();
    expect(await sichereSpalte(sheets, 'sid', 'T', ['Markenname'], 'Marke')).toBe(1);
    expect(sheets.spreadsheets.values.update).toHaveBeenCalledTimes(1);
  });
});
