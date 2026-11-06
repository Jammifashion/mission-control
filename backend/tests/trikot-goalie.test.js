// TR7: Goalie-Trikots, Trikotzeilen vor dem Absenden aendern (Shop + INT), Goalie im Produzenten-Formular.
// Nur ERFUNDENE Daten, Sheet im Speicher.

import { jest } from '@jest/globals';
import ExcelJS from 'exceljs';
import { machSheets } from './hilfen/korb-sheet.js';
import { TRIKOT_HEADER, SPALTE_GOALIE, existingIds, resolveTrikotColumns, toSheetRow, buildRowsForOrder, parseArtikel } from '../utils/trikot-logic.js';
import { aenderbar, aenderungPlan, anlagePlan, GESPERRT_CHARGE } from '../utils/trikot-intern.js';
import { trikotZeilen, baueTrikotAnsicht } from '../utils/trikot-ansicht.js';
import { formularPositionen, sortierePositionen, zaehleJeGroesse } from '../utils/trikot-formular.js';
import { aendereTrikot, legeInterneTrikotsAn, _trikotInternCacheLeeren } from '../lib/trikotIntern.js';
import { baueXlsx } from '../lib/trikotFormular.js';

const KOPF = [...TRIKOT_HEADER, 'Ersetzt', SPALTE_GOALIE];
const KOPF_OHNE = [...TRIKOT_HEADER, 'Ersetzt'];
const zeile = (o, kopf = KOPF) => kopf.map(s => o[s] ?? '');
const SHOP = (id, extra = {}, kopf) => zeile({ 'Zeilen-ID': `${id}|1|1`, Bestelldatum: '2026-11-01T09:00:00', 'Order-ID': id, 'Order-Item-ID': '1',
  Produktname: 'Testverein Heimtrikot', Groesse: 'M', Name: 'MUSTER', Nummer: '7', Stueck: '1', Quelle: 'variante', Rohtext: 'Name: MUSTER', ...extra }, kopf);
const INT = (id, extra = {}, kopf) => zeile({ 'Zeilen-ID': id, Produktname: 'Testverein Heimtrikot', Artikelnummer: 'HEIM-T', Groesse: 'L', Name: 'PROBE', Nummer: '3',
  Quelle: 'intern', Stueck: '1', Rohtext: 'Referenz: Vereinsfeier\nNotiz: alt', ...extra }, kopf);
const wc = { get: jest.fn(async pfad => ({ data: { id: pfad.split('/')[1], name: pfad.endsWith('111') ? 'Testverein Heimtrikot' : 'Testverein Auswärtstrikot', sku: pfad.endsWith('111') ? 'HEIM-T' : 'AUS-T' } })) };
const tabs = (kopf = KOPF) => ({
  Trikots: [kopf, SHOP('50001', {}, kopf), SHOP('50002', { Charge: 4, Bestellt_Am: '20.10.2026' }, kopf), INT('INT-2026-0001', {}, kopf), SHOP('50003', { Status: 'storniert' }, kopf)],
  Trikot_Artikel: [['Artikelnummer', 'Produkt-ID', 'Produktname', 'Aktiv'], ['', '111', '', 'TRUE'], ['', '222', '', 'TRUE']],
});
const VORHER_SHOP = { groesse: 'M', name: 'MUSTER', nummer: '7', notiz: '', goalie: '' };
const w = (t, z, s) => t.Trikots[z - 1][t.Trikots[0].indexOf(s)];

beforeEach(() => { process.env.BUSINESS_SHEET_ID = 'biz'; _trikotInternCacheLeeren(); wc.get.mockClear(); });

describe('Aendern vor dem Absenden', () => {
  test('Shop-Zeile ohne Charge: Groesse/Name/Nummer/Notiz/Goalie, Rohtext (Kundenangabe) bleibt, kein Produkt-Abruf', async () => {
    const t = tabs();
    const { sheets, aufrufe } = machSheets(t);
    await aendereTrikot({ sheets, wc, aktion: 'aendern', ziel: { id: '50001|1|1', zeile: 2 }, vorher: VORHER_SHOP,
      trikot: { groesse: '2xl', name: 'NEU', nummer: '12', notiz: 'lange Ärmel', goalie: true } });
    expect(['Groesse', 'Name', 'Nummer', 'Notiz', SPALTE_GOALIE].map(s => w(t, 2, s))).toEqual(['2XL', 'NEU', '12', 'lange Ärmel', 'ja']);
    expect(w(t, 2, 'Rohtext')).toBe('Name: MUSTER');
    expect(w(t, 2, 'Produktname')).toBe('Testverein Heimtrikot');
    expect(wc.get).not.toHaveBeenCalled();
    expect(aufrufe.append).toBe(0);
  });

  test('INT-Zeile: Goalie setzen, Notiz im Rohtext, Referenz bleibt', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await aendereTrikot({ sheets, wc, aktion: 'aendern', ziel: { id: 'INT-2026-0001', zeile: 4 },
      vorher: { produkt: 'Testverein Heimtrikot', groesse: 'L', name: 'PROBE', nummer: '3', notiz: 'alt', goalie: '' },
      trikot: { produktId: '111', groesse: '130', name: 'PROBE', nummer: '3', notiz: 'neu', goalie: true } });
    expect([w(t, 4, 'Groesse'), w(t, 4, SPALTE_GOALIE), w(t, 4, 'Notiz')]).toEqual(['130', 'ja', '']);
    expect(w(t, 4, 'Rohtext')).toBe('Referenz: Vereinsfeier\nNotiz: neu');
  });

  test('mit Charge gesperrt (Ersatz TR3b), storniert gesperrt, nichts geschrieben', async () => {
    const t = tabs();
    const vorher = JSON.stringify(t.Trikots);
    const { sheets } = machSheets(t);
    await expect(aendereTrikot({ sheets, wc, aktion: 'aendern', ziel: { id: '50002|1|1', zeile: 3 }, vorher: VORHER_SHOP, trikot: { groesse: 'L' } }))
      .rejects.toMatchObject({ status: 409, code: 'gesperrt', message: GESPERRT_CHARGE });
    await expect(aendereTrikot({ sheets, wc, aktion: 'aendern', ziel: { id: '50003|1|1', zeile: 5 }, vorher: VORHER_SHOP, trikot: { groesse: 'L' } }))
      .rejects.toMatchObject({ status: 409, code: 'gesperrt' });
    expect(JSON.stringify(t.Trikots)).toBe(vorher);
    expect(aenderbar({ charge: '4', status: '' })).toBe(GESPERRT_CHARGE);
    expect(aenderbar({ charge: '', status: '' })).toBe('');
  });

  test('Vorher-Wert weicht ab (anderer Browser hat geaendert) -> 409 geaendert, nichts geschrieben; ohne vorher 422', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    const vorher = JSON.stringify(t.Trikots);
    await expect(aendereTrikot({ sheets, wc, aktion: 'aendern', ziel: { id: '50001|1|1', zeile: 2 }, vorher: { ...VORHER_SHOP, nummer: '8' }, trikot: { groesse: 'L' } }))
      .rejects.toMatchObject({ status: 409, code: 'geaendert', felder: ['nummer'] });
    await expect(aendereTrikot({ sheets, wc, aktion: 'aendern', ziel: { id: '50001|1|1', zeile: 2 }, trikot: { groesse: 'L' } }))
      .rejects.toMatchObject({ status: 422 });
    expect(JSON.stringify(t.Trikots)).toBe(vorher);
  });

  test('gleiche Werte = unveraendert (Doppelklick), Zeilen-ID anders = konflikt', () => {
    const t = tabs();
    expect(aenderungPlan({ werte: t.Trikots, ziel: { id: '50001|1|1', zeile: 2 }, aktion: 'aendern', vorher: VORHER_SHOP, trikot: { groesse: 'm', name: 'MUSTER', nummer: '7' } }).unveraendert).toBe(true);
    expect(() => aenderungPlan({ werte: t.Trikots, ziel: { id: '59999|1|1', zeile: 2 }, aktion: 'aendern', vorher: VORHER_SHOP, trikot: {} })).toThrow(expect.objectContaining({ code: 'konflikt' }));
  });

  test('Spalte Goalie fehlt: Goalie setzen -> 409 einrichtung; ohne Goalie geht alles wie bisher', async () => {
    const t = tabs(KOPF_OHNE);
    const { sheets } = machSheets(t);
    await expect(aendereTrikot({ sheets, wc, aktion: 'aendern', ziel: { id: '50001|1|1', zeile: 2 }, vorher: VORHER_SHOP, trikot: { groesse: 'L', goalie: true } }))
      .rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    await aendereTrikot({ sheets, wc, aktion: 'aendern', ziel: { id: '50001|1|1', zeile: 2 }, vorher: VORHER_SHOP, trikot: { groesse: 'L', name: 'MUSTER', nummer: '7' } });
    expect(w(t, 2, 'Groesse')).toBe('L');
    await expect(legeInterneTrikotsAn({ sheets, wc, vorgang: 'vorgang-goalie-0001', trikots: [{ produktId: '111', groesse: 'M', goalie: true }] }))
      .rejects.toMatchObject({ status: 409, code: 'einrichtung' });
  });

  test('TR6-Dialog: interne Bestellung mit Goalie je Trikot', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    const r = await legeInterneTrikotsAn({ sheets, wc, vorgang: 'vorgang-goalie-0002', jetzt: new Date('2026-11-06T10:00:00Z'),
      trikots: [{ produktId: '111', groesse: 'L', goalie: true }, { produktId: '111', groesse: 'M' }] });
    const zeilen = r.ids.map(id => t.Trikots.find(x => x[0] === id));
    expect(zeilen.map(x => x[KOPF.indexOf(SPALTE_GOALIE)])).toEqual(['ja', '']);
    expect(() => anlagePlan({ werte: t.Trikots, produkte: new Map([['111', { name: 'x', sku: 'y' }]]), heute: '2026-11-06', erfasstAm: '', vorgang: 'v', trikots: [{ produktId: '111', groesse: 'M', goalie: 'nein' }] })).not.toThrow();
  });
});

describe('Sync ueberschreibt MC-Aenderungen nicht', () => {
  test('geaenderte Shop-Zeile: Zeilen-ID im Bestand -> der Sync legt sie nicht neu an; neue Zeilen lassen Goalie leer (null)', () => {
    const t = tabs();
    t.Trikots[1][KOPF.indexOf('Name')] = 'IN MC GEAENDERT';
    t.Trikots[1][KOPF.indexOf(SPALTE_GOALIE)] = 'ja';
    const bestand = existingIds(t.Trikots);
    const order = { id: 50001, date_created: '2026-11-01T09:00:00', billing: { first_name: 'A', last_name: 'B' }, status: 'processing',
      line_items: [{ id: 1, product_id: 111, variation_id: 0, quantity: 1, name: 'Testverein Heimtrikot', sku: 'HEIM-T', meta_data: [{ key: 'Name', value: 'MUSTER' }] }] };
    const alle = buildRowsForOrder(order, parseArtikel(t.Trikot_Artikel), '2026-11-06T10:00:00');
    expect(alle.map(o => o['Zeilen-ID'])).toEqual(['50001|1|1']);   // der Sync wuerde genau diese Zeile bauen …
    expect(alle.filter(o => !bestand.has(o['Zeilen-ID']))).toEqual([]);   // … aber sie steht schon da: nichts angehaengt
    const cols = resolveTrikotColumns(KOPF);
    const row = toSheetRow(cols, { 'Zeilen-ID': '50009|1|1' });
    expect(row[KOPF.indexOf(SPALTE_GOALIE)] ?? null).toBeNull();
  });
});

describe('Anzeige', () => {
  test('Goalie-Kennzeichen, aenderbar/gesperrt, Stand je Bestellung zaehlt Goalie', () => {
    const t = tabs();
    t.Trikots[1][KOPF.indexOf(SPALTE_GOALIE)] = 'ja';
    const a = baueTrikotAnsicht(trikotZeilen(t.Trikots));
    const offen = a.gruppen[0].zeilen;
    expect(offen.find(z => z.id === '50001|1|1')).toMatchObject({ goalie: true, aenderbar: true, aendernGesperrt: false, notizMc: '' });
    expect(offen.find(z => z.id === 'INT-2026-0001')).toMatchObject({ goalie: false, aenderbar: true, bearbeitbar: true, notizMc: 'alt' });
    expect(a.gruppen.find(g => g.charge === '4').zeilen[0]).toMatchObject({ aenderbar: false, aendernGesperrt: true });
    expect(a.bestellungen['50001']).toMatchObject({ goalie: 1 });
    expect(a.bestellungen['50002']).toMatchObject({ goalie: 0 });
    expect(a.spalteGoalie).toBe(true);
    expect(baueTrikotAnsicht(trikotZeilen(tabs(KOPF_OHNE).Trikots)).spalteGoalie).toBe(false);
  });
});

describe('Produzenten-Formular', () => {
  const zuordnung = { jeName: new Map([['Testverein Heimtrikot', { artikel: 'HOME', material: 'M1', kragen: 'V', reihenfolge: 0 }]]) };
  const z = (n, groesse, goalie = false, nummer = '1') => ({ id: `INT-2026-000${n}`, zeile: n + 1, produkt: 'Testverein Heimtrikot', produktKurz: 'Heim', groesse, name: 'X', nummer, goalie });

  test('SIZE GK2XL/GKL/GK130, EXTRA GOALI; normale Zeilen unveraendert (EXTRA leer); Goalie ans Ende des Produkts', () => {
    const p = sortierePositionen(formularPositionen([z(1, '2XL', true), z(2, 'L', true), z(3, '130', true), z(4, 'M'), z(5, '120')], zuordnung));
    expect(p.map(x => [x.size, x.extra])).toEqual([['120', ''], ['M', ''], ['GK130', 'GOALI'], ['GKL', 'GOALI'], ['GK2XL', 'GOALI']]);
    expect(zaehleJeGroesse(p).map(x => x.groesse)).toEqual(['120', 'M', 'GK130', 'GKL', 'GK2XL']);
  });

  test('xlsx: Goalie-SIZE als Text, EXTRA GOALI; Kindergroesse normal als Zahl', async () => {
    const positionen = sortierePositionen(formularPositionen([z(1, '130', true), z(2, '120')], zuordnung));
    const tag = { utc: Date.UTC(2026, 10, 6) };
    const buf = await baueXlsx({ kopf: { team: 'T', nummer: '2026/07', wiederholung: 'NO' }, positionen, tage: { heute: tag, liefer: tag } });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Sheet1');
    expect([ws.getCell(8, 5).value, ws.getCell(8, 8).value]).toEqual([120, null]);
    expect([ws.getCell(9, 5).value, ws.getCell(9, 8).value]).toEqual(['GK130', 'GOALI']);
  });
});
