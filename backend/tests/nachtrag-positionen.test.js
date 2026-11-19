// Nachtragen gleicher Positionen: welche fehlen, Trockenlauf schreibt nichts, --write sichert, legt Positions-ID an,
// schreibt ohne append; ein zweiter Lauf findet nichts mehr. Nur erfundene Werte.
import { jest } from '@jest/globals';
import { mkdtempSync, readdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { sheetsAttrappe, FIXKOSTEN_VOLL } from './hilfen/sheets-attrappe.js';
import { fehlendePositionen, bestellungenMitZeilen } from '../utils/nachtrag-positionen.js';

const LK = ['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status',
  'Produkt-ID', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status'];
const vhL = c => LK.indexOf(c);
const SPL = { bestellung: 'Order-ID', artikel: 'Artikelnummer' };
const altZeile = (o = {}) => { const r = LK.map(() => ''); Object.assign(r, { 0: 'P-001', 1: '10.09.2026', 2: '900', 3: 'Shirt - M', 4: '5', 5: '1', 8: 'offen', 9: '50' }, o); return r; };
const ORDER = {
  id: 900, status: 'completed', date_created: '2026-09-10T10:00:00', shipping_total: '0.00', shipping_lines: [{ method_id: 'flat_rate' }],
  line_items: [
    { id: 11, name: 'Shirt - M', product_id: 50, variation_id: 5, quantity: 1, total: '20.00' },
    { id: 12, name: 'Shirt - M', product_id: 50, variation_id: 5, quantity: 1, total: '20.00' },
    { id: 13, name: 'Cap', product_id: 60, variation_id: 0, quantity: 1, total: '10.00' },
  ],
};

describe('fehlendePositionen', () => {
  test('eine Altzeile, zwei gleiche Positionen -> die zweite fehlt', () => {
    expect(fehlendePositionen({ order: ORDER, zeilen: [altZeile()], vh: vhL, spalten: SPL }).map(f => [f.item.id, f.partnerId])).toEqual([[12, 'P-001']]);
  });
  test('nie erfasste Position (Cap) ist Sache des Syncs, nicht des Nachtrags', () => {
    expect(fehlendePositionen({ order: ORDER, zeilen: [altZeile()], vh: vhL, spalten: SPL }).some(f => f.item.id === 13)).toBe(false);
  });
  test('Zeile mit Positions-ID deckt genau ihre Position', () => {
    const kopf = [...LK, 'Positions-ID']; const vh = c => kopf.indexOf(c);
    expect(fehlendePositionen({ order: ORDER, zeilen: [[...altZeile(), ''], [...altZeile(), 12]], vh, spalten: SPL })).toEqual([]);
    expect(fehlendePositionen({ order: ORDER, zeilen: [[...altZeile(), 11]], vh, spalten: SPL }).map(f => f.item.id)).toEqual([12]);
  });
  test('Gegenbuchungen zaehlen nicht; Bestellungen ohne Gegenbuchung', () => {
    const storno = altZeile({ 14: 'Storniert/Rückerstattet' });
    expect(fehlendePositionen({ order: ORDER, zeilen: [storno], vh: vhL, spalten: SPL })).toEqual([]);
    expect(bestellungenMitZeilen([altZeile(), altZeile({ 2: '901', 14: 'x' })], vhL, SPL)).toEqual(['900']);
  });
});

describe('Ablauf Lizenz und Festpreis', () => {
  let nachtragenPositionen, tabs, attrappe, wcGet, ordner;
  beforeAll(async () => {
    ({ nachtragenPositionen } = await import('../lib/nachtragPositionen.js'));
  });
  beforeEach(() => {
    ordner = mkdtempSync(join(tmpdir(), 'nachtrag-'));
    tabs = {
      Kalkulation_Fixkosten: FIXKOSTEN_VOLL.map(r => [...r]),
      Partner: [['Partner-ID', 'Name', 'Aktiv', 'Lizenz-%', 'Porto-Modell'], ['P-001', 'X', 'Ja', '40', 'geteilt-50-50']],
      Partner_Artikel: [['Partner-ID', 'Produkt-ID', 'EK-Preis-Netto', 'Druckkosten', 'Versandart'], ['P-001', '50', '3', '2', 'P']],
      'Partner_Verkäufe': [LK, altZeile()],
      FP_Partner: [['Partner-ID', 'Shop'], ['FP-001', 'jfn']],
      FP_Artikel: [['Partner-ID', 'Produkt-ID', 'Festpreis-EK-Netto', 'Handling-Gebühr', 'Versandart', 'Artikelkategorie'], ['FP-001', '50', '0', '0', 'P', 'T-Shirt']],
      FP_Artikel_Kategorie: [['Kategorie', 'Festpreispartner-ID', 'Festpreis', 'Handlingskosten'], ['T-Shirt', 'FP-001', '8', '1']],
    };
    const FK = ['Partner-ID', 'Datum', 'WC-Bestellnummer', 'Artikelname', 'Variante', 'Stückzahl', 'Festpreis-EK', 'Handling', 'Porto-Einnahme',
      'Porto-Kosten', 'Versandnebenkosten', 'PayPal-Kosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto', 'Status Abrechnung', 'Produkt-ID',
      'Storno-Status', 'Artikelkategorie', 'Festpreis', 'Mehrkosten', 'VK-Netto', 'Handlingskosten', 'Versandmethode', 'Sperre', 'Porto_Bestellung', 'Porto_Versandart'];
    const fz = FK.map(() => ''); Object.assign(fz, { 0: 'FP-001', 1: '10.09.2026', 2: '900', 3: 'Shirt - M', 4: '5', 5: '1', 14: 'offen', 15: '50' });
    tabs['FP_Verkäufe'] = [FK, fz];
    attrappe = sheetsAttrappe(() => tabs);
    wcGet = jest.fn(async (_p, q) => ({ data: q.include.split(',').includes('900') ? [ORDER] : [] }));
  });
  const lauf = (art, write = false) => nachtragenPositionen({ sheets: attrappe, spreadsheetId: 's', art, write, sicherungOrdner: ordner,
    drossel: async () => {}, wcFuer: () => ({ get: wcGet }), jetzt: () => new Date('2026-11-19T12:00:00Z') });

  test('Lizenz: Trockenlauf schreibt nichts', async () => {
    const r = await lauf('lizenz');
    expect(r).toMatchObject({ geprueft: 1, zeilen: 1, geschrieben: 0, bestellungen: [{ bestellung: '900', zeilen: 1, partner: ['P-001'] }] });
    expect(attrappe.spreadsheets.values.update).not.toHaveBeenCalled();
    expect(readdirSync(ordner)).toEqual([]);
  });

  test('Lizenz --write: Sicherung, Positions-ID, Zeile offen ohne append; zweiter Lauf findet nichts', async () => {
    const r = await lauf('lizenz', true);
    expect(r.geschrieben).toBe(1);
    expect(readdirSync(ordner)).toEqual(['Partner_Verkaeufe_vor_Nachtrag_2026-11-19T12-00-00-000Z.json']);
    expect(JSON.parse(readFileSync(r.sicherung, 'utf8')).values).toHaveLength(2);
    const v = tabs['Partner_Verkäufe'];
    expect(v[0].at(-1)).toBe('Positions-ID');
    expect(v).toHaveLength(3);
    expect(v[2][v[0].indexOf('Positions-ID')]).toBe(12);
    expect(v[2][v[0].indexOf('Status')]).toBe('offen');
    expect(typeof v[2][v[0].indexOf('Lizenzgebühr')]).toBe('number');
    expect(attrappe.spreadsheets.values.append).not.toHaveBeenCalled();
    expect((await lauf('lizenz')).zeilen).toBe(0);
  });

  test('Festpreis --write: Zeile mit Positions-ID in AA, zweiter Lauf findet nichts', async () => {
    const r = await lauf('fp', true);
    expect(r.geschrieben).toBe(1);
    const v = tabs['FP_Verkäufe'];
    expect(v[0][26]).toBe('Positions-ID');
    expect(v[2][26]).toBe(12);
    expect(v[2][14]).toBe('offen');
    expect(v[2][18]).toBe(8);
    expect((await lauf('fp')).zeilen).toBe(0);
  });

  test('fehlende Fixkosten zum Bestelldatum: Abbruch, nichts geschrieben', async () => {
    tabs.Kalkulation_Fixkosten = FIXKOSTEN_VOLL.filter(r => r[0] !== 'MwSt');
    await expect(lauf('lizenz', true)).rejects.toMatchObject({ code: 'fixkosten_fehlen' });
    expect(tabs['Partner_Verkäufe']).toHaveLength(2);
  });
});

describe('Raster: neue Spalte hinter dem Raster (z. B. AA bei 26 Spalten)', () => {
  test('sichereSpaltenRaster verbreitert nur, wenn noetig', async () => {
    const { sichereSpaltenRaster } = await import('../lib/sheet-zeilen.js');
    const tabs = { T: [['a']] };
    const raster = { T: 26 };
    const a = sheetsAttrappe(() => tabs, raster);
    expect(await sichereSpaltenRaster(a, 's', 'T', 27)).toBe(1);
    expect(raster.T).toBe(27);
    expect(await sichereSpaltenRaster(a, 's', 'T', 27)).toBe(0);
    expect(a.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
  });

  test('FP-Nachtrag mit Raster A-Z: legt AA an und schreibt', async () => {
    const { nachtragenPositionen } = await import('../lib/nachtragPositionen.js');
    const FK = ['Partner-ID', 'Datum', 'WC-Bestellnummer', 'Artikelname', 'Variante', 'Stückzahl', 'Festpreis-EK', 'Handling', 'Porto-Einnahme',
      'Porto-Kosten', 'Versandnebenkosten', 'PayPal-Kosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto', 'Status Abrechnung', 'Produkt-ID',
      'Storno-Status', 'Artikelkategorie', 'Festpreis', 'Mehrkosten', 'VK-Netto', 'Handlingskosten', 'Versandmethode', 'Sperre', 'Porto_Bestellung', 'Porto_Versandart'];
    const fz = FK.map(() => ''); Object.assign(fz, { 0: 'FP-001', 1: '10.09.2026', 2: '900', 3: 'Shirt - M', 4: '5', 5: '1', 14: 'offen', 15: '50' });
    const tabs = {
      Kalkulation_Fixkosten: FIXKOSTEN_VOLL.map(r => [...r]), 'FP_Verkäufe': [FK, fz],
      FP_Partner: [['Partner-ID', 'Shop'], ['FP-001', 'jfn']],
      FP_Artikel: [['Partner-ID', 'Produkt-ID', 'Festpreis-EK-Netto', 'Handling-Gebühr', 'Versandart', 'Artikelkategorie'], ['FP-001', '50', '0', '0', 'P', 'T-Shirt']],
      FP_Artikel_Kategorie: [['Kategorie', 'Festpreispartner-ID', 'Festpreis', 'Handlingskosten'], ['T-Shirt', 'FP-001', '8', '1']],
    };
    const raster = { 'FP_Verkäufe': 26 };
    const a = sheetsAttrappe(() => tabs, raster);
    const r = await nachtragenPositionen({ sheets: a, spreadsheetId: 's', art: 'fp', write: true, sicherungOrdner: mkdtempSync(join(tmpdir(), 'n-')),
      drossel: async () => {}, wcFuer: () => ({ get: async () => ({ data: [ORDER] }) }) });
    expect(r.geschrieben).toBe(1);
    expect(raster['FP_Verkäufe']).toBe(27);
    expect(tabs['FP_Verkäufe'][0][26]).toBe('Positions-ID');
  });

  test('FP-Sync verbreitert das Raster vor dem Kopf in AA', () => {
    const src = readFileSync(join(process.cwd(), 'routes', 'festpreis-portal.js'), 'utf8');
    const i = src.indexOf("await sichereSpaltenRaster(sheets, sheetId, TAB_FP_VERKAEUFE, POSITION_INDEX + 1)");
    expect(i).toBeGreaterThan(-1);
    expect(src.indexOf('1:AA1`', i)).toBeGreaterThan(i);
  });
});
