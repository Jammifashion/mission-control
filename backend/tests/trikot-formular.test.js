// TR3: Produzenten-Bestellung (utils/trikot-formular.js, lib/trikotFormular.js). Nur erfundene Daten.

import { jest } from '@jest/globals';
import ExcelJS from 'exceljs';
import {
  formularZuordnung, formularPositionen, sortierePositionen, zaehleJeGroesse, naechsteCharge, bestellNummer, dateiName,
  tagWerte, eintragPlan, KOPF_BESCHRIFTUNG, TABELLE_KOPF,
} from '../utils/trikot-formular.js';
import { trikotZeilen } from '../utils/trikot-ansicht.js';
import { formularVorschau, formularDatei, alsBestelltEintragen, baueXlsx, _leereNamenCache, LETZTE_RAHMENZEILE } from '../lib/trikotFormular.js';

const HEIM = 'Verein Heimtrikot 26/27', AUS = 'Verein Auswärtstrikot 26/27';
const ART = [['Artikelnummer', 'Produkt-ID', 'Produktname', 'Aktiv', 'Formular_Artikel', 'Formular_Material', 'Formular_Kragen'],
  ['', '111', '', 'TRUE', 'Trikot schwarz', 'Heavy', ''],
  ['', '222', '', 'TRUE', 'Trikot weiss', 'Heavy', '']];
const NAMEN = new Map([['111', HEIM], ['222', AUS]]);
const KOPF = ['Zeilen-ID', 'Bestelldatum', 'Order-ID', 'Kunde', 'Produktname', 'Groesse', 'Name', 'Nummer', 'Quelle', 'Rohtext',
  'Charge', 'Bestellt_Am', 'Geliefert_Am', 'Status', 'Notiz'];
const z = (id, prod, gr, name, nr, charge = '', bam = '') => [id, '', '1', 'Erika Muster', prod, gr, name, nr, 'addon', '', charge, bam, '', '', ''];
const TRI = [KOPF,
  z('1|1|1', HEIM, 'L', 'ALPHA', '7', 6, 46300),
  z('2|1|1', AUS, '2XL', 'BETA', '07'),
  z('3|1|1', HEIM, '120', 'GAMMA', '9'),
  z('4|1|1', HEIM, 'S', 'DELTA', '23'),
  z('5|1|1', HEIM, '90', '', '5'),
  z('6|1|1', 'Schal', 'M', 'EPS', '1'),
  z('7|1|1', HEIM, 'S', 'ZETA', '3'),
];

describe('Zuordnung und Positionen', () => {
  const zu = formularZuordnung(ART, NAMEN);
  test('Heim/Auswaerts ueber den Shop-Namen der Produkt-ID, ohne Festwerte', () => {
    expect(zu.fehlend).toEqual([]);
    expect(zu.jeName.get(HEIM)).toMatchObject({ produktId: '111', artikel: 'Trikot schwarz', material: 'Heavy', kragen: '', reihenfolge: 0 });
    expect(zu.jeName.get(AUS)).toMatchObject({ artikel: 'Trikot weiss', reihenfolge: 1 });
  });
  test('Zeile ohne Zuordnung -> Fehler; fehlende Spalten gemeldet; inaktiv/leer -> keine Zuordnung', () => {
    const pos = formularPositionen(trikotZeilen(TRI).zeilen, zu);
    expect(pos.find(p => p.id === '6|1|1').fehler).toEqual(['ohne_zuordnung']);
    expect(formularZuordnung(ART.map(r => r.slice(0, 4)), NAMEN)).toMatchObject({ fehlend: ['Formular_Artikel', 'Formular_Material', 'Formular_Kragen'] });
    expect(formularZuordnung([ART[0], [...ART[1].slice(0, 3), 'FALSE', ...ART[1].slice(4)]], NAMEN).jeName.size).toBe(0);
    expect(formularZuordnung([ART[0], ART[1], ART[1]], NAMEN).jeName.size).toBe(0);   // doppelt -> nie raten
  });
  test('Reihenfolge: Heim vor Auswaerts, Kinder (cm) aufsteigend, dann S -> 4XL, dann Nummer; Nummer bleibt Text', () => {
    const offen = trikotZeilen(TRI).zeilen.filter(x => !x.charge && x.id !== '6|1|1');
    const s = sortierePositionen(formularPositionen(offen, zu));
    expect(s.map(p => `${p.produkt}/${p.groesse}/${p.nummer}`)).toEqual(['Heim/90/5', 'Heim/120/9', 'Heim/S/3', 'Heim/S/23', 'Auswärts/2XL/07']);
    expect(zaehleJeGroesse(s)).toEqual([
      { produkt: 'Heim', groesse: '90', anzahl: 1 }, { produkt: 'Heim', groesse: '120', anzahl: 1 },
      { produkt: 'Heim', groesse: 'S', anzahl: 2 }, { produkt: 'Auswärts', groesse: '2XL', anzahl: 1 }]);
  });
});

describe('Nummer und Datum', () => {
  test('naechste Charge = hoechste + 1; JJJJ/NN mit Jahr des Bestelltags (Berlin, auch Jahreswechsel)', () => {
    expect(naechsteCharge(TRI)).toBe(7);
    expect(naechsteCharge([KOPF])).toBe(1);
    expect(bestellNummer(7, new Date('2026-10-30T10:00:00Z'))).toBe('2026/07');
    expect(bestellNummer(12, new Date('2026-12-31T23:30:00Z'))).toBe('2027/12');   // 00:30 Berlin
    expect(bestellNummer(1, new Date('2026-12-31T22:59:00Z'))).toBe('2026/01');
    expect(dateiName(7)).toBe('7. Crocodiles Hamburg 26_27.xlsx');
  });
  test('Tag + 30 als Text und Tabellen-Datumswert', () => {
    const h = tagWerte(new Date('2026-10-30T10:00:00Z')), l = tagWerte(new Date('2026-10-30T10:00:00Z'), 30);
    expect(h).toMatchObject({ text: '30.10.2026', serial: 46325 });
    expect(l).toMatchObject({ text: '29.11.2026', serial: 46355 });
  });
});

describe('Eintragen (Plan)', () => {
  const unf = TRI.map(r => [...r]);
  test('nur P und Q, nur leere Zellen, Charge als Zahl, Datum als Datumswert', () => {
    const p = eintragPlan(unf, [{ id: '3|1|1', zeile: 4 }, { id: '2|1|1', zeile: 3 }], { charge: 7, serial: 46325 });
    expect(p.probleme).toEqual([]);
    expect(p.zellen).toEqual([
      { range: "'Trikots'!K3", values: [[7]] }, { range: "'Trikots'!L3", values: [[46325]] },
      { range: "'Trikots'!K4", values: [[7]] }, { range: "'Trikots'!L4", values: [[46325]] }]);
  });
  test('409-Gruende: Zelle belegt, Zeile geaendert, Nummer vergeben, doppelt', () => {
    const g = (auswahl, charge = 7) => eintragPlan(unf, auswahl, { charge, serial: 1 }).probleme.map(x => x.grund);
    expect(g([{ id: '1|1|1', zeile: 2 }])).toEqual(['charge_belegt', 'bestellt_am_belegt']);
    expect(g([{ id: 'x', zeile: 3 }])).toEqual(['zeile_geaendert']);
    expect(g([{ id: '2|1|1', zeile: 3 }], 6)).toEqual(['nummer_vergeben']);
    expect(g([{ id: '2|1|1', zeile: 3 }, { id: '2|1|1', zeile: 3 }])).toEqual(['doppelt']);
    expect(g([{ id: '2|1|1', zeile: 99 }])).toEqual(['zeile_fehlt']);
    expect(() => eintragPlan(unf, [], { charge: 7, serial: 1 })).toThrow(/Keine Trikots/);
  });
});

// ── lib mit Attrappen ──
function attrappe(tri = TRI) {
  let werte = tri.map(r => [...r]);
  const batchUpdate = jest.fn(async ({ requestBody }) => {
    for (const d of requestBody.data) {
      const [, ref] = d.range.split('!');
      const sp = ref.charCodeAt(0) - 65, zl = Number(ref.slice(1));
      werte[zl - 1][sp] = d.values[0][0];
    }
  });
  const fmt = () => werte.map((r, i) => (i ? r.map((v, j) => (j === 11 && typeof v === 'number' ? '30.10.2026' : String(v ?? ''))) : r));
  const sheets = { spreadsheets: {
    values: {
      batchGet: jest.fn(async () => ({ data: { valueRanges: [{ values: fmt() }, { values: ART }] } })),
      get: jest.fn(async ({ valueRenderOption }) => ({ data: { values: valueRenderOption === 'FORMATTED_VALUE' ? fmt() : werte } })),
      batchUpdate, append: jest.fn(), update: jest.fn(),
    },
    get: jest.fn(), batchUpdate: jest.fn(),
  } };
  return { sheets, batchUpdate, werte: () => werte };
}
const wc = { get: jest.fn(async p => ({ data: { id: Number(p.split('/')[1]), name: NAMEN.get(p.split('/')[1]) } })) };
const JETZT = new Date('2026-10-30T10:00:00Z');

describe('lib/trikotFormular.js', () => {
  beforeEach(() => { process.env.BUSINESS_SHEET_ID = 'biz'; _leereNamenCache(); });
  test('Vorschau: nur offene Zeilen, Nummer vorlaeufig, schreibt nichts, ohne Kunde', async () => {
    const a = attrappe();
    const v = await formularVorschau({ auswahl: [{ id: '2|1|1', zeile: 3 }, { id: '1|1|1', zeile: 2 }], sheets: a.sheets, wc, jetzt: JETZT });
    expect(v).toMatchObject({ charge: 7, nummer: '2026/07', vorlaeufig: true, dateiname: '7. Crocodiles Hamburg 26_27.xlsx',
      kopf: { bestelltAm: '30.10.2026', lieferung: '29.11.2026', team: 'Crocodiles Hamburg', nummer: '2026/07', wiederholung: 'NO' } });
    expect(v.positionen.map(p => p.zeile)).toEqual([3]);
    expect(v.probleme[0].text).toMatch(/schon in Bestellung 6/);
    expect(a.batchUpdate).not.toHaveBeenCalled();
    expect(JSON.stringify(v)).not.toContain('Erika');
  });
  test('Datei verweigert Zeilen ohne Zuordnung (422)', async () => {
    const a = attrappe();
    await expect(formularDatei({ auswahl: [{ id: '6|1|1', zeile: 7 }], sheets: a.sheets, wc, jetzt: JETZT })).rejects.toMatchObject({ status: 422, code: 'ohne_zuordnung' });
  });
  test('xlsx: ein Blatt Sheet1, Kopf D1-D5, Zeile 7, Daten ab 8, Nummer als Text, Formate wie im Muster', async () => {
    const a = attrappe();
    const { dateiname, buffer } = await formularDatei({ auswahl: [{ id: '2|1|1', zeile: 3 }, { id: '3|1|1', zeile: 4 }], sheets: a.sheets, wc, jetzt: JETZT });
    expect(dateiname).toBe('7. Crocodiles Hamburg 26_27.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.worksheets.map(w => w.name)).toEqual(['Sheet1']);
    const ws = wb.getWorksheet('Sheet1');
    expect([1, 2, 3, 4, 5].map(r => ws.getCell(r, 1).value)).toEqual(KOPF_BESCHRIFTUNG);
    expect(ws.getCell('D1').value.toISOString().slice(0, 10)).toBe('2026-10-30');
    expect(ws.getCell('D2').value.toISOString().slice(0, 10)).toBe('2026-11-29');
    expect(ws.getCell('D1').numFmt).toBe('dd.mm.yyyy');
    expect(typeof ws.getCell('D1').value).toBe('object');   // Datum als Wert, keine Formel
    expect(ws.getCell('D1').formula).toBeUndefined();
    expect(ws.model.merges.sort()).toEqual(['D1:E1', 'D2:E2']);
    expect([ws.getCell('D3').value, ws.getCell('D4').value, ws.getCell('D5').value]).toEqual(['Crocodiles Hamburg', '2026/07', 'NO']);
    expect(ws.getCell('A1').font).toMatchObject({ name: 'Calibri', size: 12, bold: true });
    expect(ws.getCell('A1').fill.fgColor.argb).toBe('FFFFF2CC');
    expect(ws.getCell('C3').fill.fgColor.argb).toBe('FFFFF2CC');
    expect(ws.getCell('B2').fill?.fgColor).toBeUndefined();   // Zeile 2 nicht gelb
    expect([...Array(8)].map((_, i) => ws.getCell(7, i + 1).value)).toEqual(TABELLE_KOPF);
    expect(ws.getCell('A7').fill.fgColor.argb).toBe('FFFFCC00');
    expect(ws.getCell('A7').font).toMatchObject({ size: 9, bold: true });
    expect([...Array(8)].map((_, i) => ws.getCell(8, i + 1).value)).toEqual([1, 'Trikot schwarz', null, 'Heavy', 120, 'GAMMA', '9', null]);
    expect([...Array(8)].map((_, i) => ws.getCell(9, i + 1).value)).toEqual([1, 'Trikot weiss', null, 'Heavy', '2XL', 'BETA', '07', null]);
    expect(ws.getCell('G9').numFmt).toBe('@');
    expect(ws.getCell('A8').font).toMatchObject({ name: 'Calibri', size: 8 });
    expect(ws.getCell(`H${LETZTE_RAHMENZEILE}`).border.bottom.style).toBe('thin');
    expect(ws.getColumn(2).width).toBe(26.28);   // Excel zeigt 25.57 wie im Muster
  });
  test('Eintragen: schreibt nur P/Q, Doppelklick = zweiter Aufruf 409, Nummer vergeben 409', async () => {
    const a = attrappe();
    const auswahl = [{ id: '2|1|1', zeile: 3 }];
    const [r1, r2] = await Promise.allSettled([
      alsBestelltEintragen({ auswahl, charge: 7, sheets: a.sheets, jetzt: JETZT }),
      alsBestelltEintragen({ auswahl, charge: 7, sheets: a.sheets, jetzt: JETZT }),
    ]);
    expect(r1.value).toMatchObject({ charge: 7, nummer: '2026/07', bestelltAm: '30.10.2026', zeilen: 1, rueckgelesen: true, abweichungen: [] });
    expect(r2.reason).toMatchObject({ status: 409, code: 'laeuft_gerade' });
    expect(a.batchUpdate).toHaveBeenCalledTimes(1);
    expect(a.werte()[2][10]).toBe(7);
    expect(a.werte()[2][11]).toBe(46325);
    // nochmal dieselbe Zeile: P/Q belegt und Nummer 7 vergeben -> 409, nichts geschrieben
    await expect(alsBestelltEintragen({ auswahl, charge: 7, sheets: a.sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 409, code: 'nicht_eingetragen' });
    expect(a.batchUpdate).toHaveBeenCalledTimes(1);
    expect(a.sheets.spreadsheets.values.append).not.toHaveBeenCalled();
  });
});

describe('Muster-Formatkonstanten', () => {
  test('baueXlsx ohne Positionen zeichnet trotzdem die Rahmenzeilen', async () => {
    const t0 = tagWerte(JETZT), t1 = tagWerte(JETZT, 30);
    const buf = await baueXlsx({ kopf: { team: 'T', nummer: '2026/01', wiederholung: 'NO' }, positionen: [], tage: { heute: t0, liefer: t1 } });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    expect(wb.getWorksheet('Sheet1').getCell('A8').value).toBeNull();
    expect(wb.getWorksheet('Sheet1').getCell('A8').border.top.style).toBe('thin');
  });
});
