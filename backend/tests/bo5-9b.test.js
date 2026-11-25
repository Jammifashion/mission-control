// BO5-9 Teil B (antwort-BO5-9-1, Variante B1): DTF-Stand in der Bestellkarte aus dem DTF-Korb. "DTF bestellen" / "DTF bestellt"
// (nur Anzeige) / "DTF aus dem Lager" (abgewaehlt mit Grund, keine Lager-Buchung). Sheets-, Shop-Attrappe, nur erfundene Werte.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sheetsAttrappe } from './hilfen/sheets-attrappe.js';
import {
  KORB_SPALTEN, DATEI_SPALTEN, PROTOKOLL_SPALTEN, TAB_DTF_KORB, TAB_DTF_PROTOKOLL, TAB_DTF_DATEIEN, STATUS, GRUENDE, GRUND_LAGER,
  dtfStandJePosition, dtfKartenPlan, dtfAbgleichPlan, zeileAnsicht,
} from '../utils/dtf-korb.js';
import { dtfFuerKarte, DTF_AUS } from '../utils/produktion-stand.js';
import { shopPositionStand } from '../utils/mika.js';
import { KLASSE } from '../utils/korb-logic.js';

const { runDtfAbgleich, setzeDtfKarte, leseDtfJePosition, leseDtfJeAuPosition, _dtfKorbZustandLeeren } = await import('../lib/dtfKorb.js');

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
let tabs, sheets;
const DM_KOPF = ['Druckmass_ID', 'Bezug', 'Position', 'Groesse', 'Breite_cm', 'Hoehe_cm', 'Aktiv', 'Notiz', 'Angelegt', 'Stand', 'Fuehrend', 'Modell'];
function grundTabs() {
  return {
    [TAB_DTF_KORB]: [KORB_SPALTEN],
    [TAB_DTF_DATEIEN]: [DATEI_SPALTEN],
    [TAB_DTF_PROTOKOLL]: [PROTOKOLL_SPALTEN],
    Druckmasse: [DM_KOPF, ['DM-0001', 'XY-Test', 'Brust', 'alle', 10, 10, 'ja', '', '', '', '', '']],
    Config: [['Schlüssel', 'Wert'], ['dtf.start_datum', '2026-11-25'], ['dtf.breite_cm', 57]],
    Varianten: [['SSOT-ID', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'WC_Variation_ID'], ['0001', 'Farbe', 'Schwarz', 'Größe', 'L', '', '', '555']],
    Erfassungsmaske: [['ID', 'Produkt-ID', 'Artikelkurzbezeichnung', 'Artikelnummer'], ['0001', '111', 'XY-Test', 'M100/XY-Test']],
    Motive: [['Artikelkurzbezeichnung', 'Druckart'], ['XY-Test', '']],
    Trikot_Artikel: [['Produkt-ID'], ['500']],
  };
}
const order = (id, status, items, datum = '2026-11-26T10:00:00') => ({ id, status, date_created: datum,
  line_items: items.map(([lid, pid, vid, q]) => ({ id: lid, product_id: pid, variation_id: vid, quantity: q, meta_data: [] })) });
function wcMit(offene) {
  const get = jest.fn(async (_p, q) => ({ data: q.include ? offene.filter(o => q.include.split(',').includes(String(o.id))) : q.status === 'processing' && q.page === 1 ? offene : [] }));
  return () => ({ get });
}
const keineAuftraege = async () => [];
const spalte = (z, s) => z[KORB_SPALTEN.indexOf(s)];
const zeilenObj = () => tabs[TAB_DTF_KORB].slice(1).map(z => Object.fromEntries(KORB_SPALTEN.map((s, i) => [s, z[i]])));
const gesehen = pos => dtfStandJePosition(zeilenObj()).get(pos)?.zeilen ?? [];

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot';
  process.env.BUSINESS_SHEET_ID = 'business';
  tabs = grundTabs();
  sheets = sheetsAttrappe(() => tabs);
  _dtfKorbZustandLeeren();
});

describe('Logik (utils/dtf-korb.js)', () => {
  const z = (o = {}) => ({ Schluessel: 'JFN:1:11:Brust', Quelle: 'JFN', Nummer: '1', Position: '11', Druckposition: 'Brust', Status: STATUS.OFFEN, Grund: '', Stand: 's1', DTF_Bestellung: '', ...o });
  test('neuer Grund steht in der Liste (Korb-Abwaehlen und Auftragspositionen bieten ihn an)', () => {
    expect(GRUENDE).toContain(GRUND_LAGER);
    expect(GRUND_LAGER).toBe('schon da (aus dem Lager)');
  });
  test('Stand je Position: bestellt vor lager vor bestellen; abgewaehlt mit anderem Grund', () => {
    expect(dtfStandJePosition([z()]).get('JFN:1:11').stand).toBe('bestellen');
    expect(dtfStandJePosition([z({ Status: STATUS.ABGEWAEHLT, Grund: GRUND_LAGER })]).get('JFN:1:11').stand).toBe('lager');
    expect(dtfStandJePosition([z({ Status: STATUS.ABGEWAEHLT, Grund: 'anderer Drucker' })]).get('JFN:1:11')).toMatchObject({ stand: 'abgewaehlt', grund: 'anderer Drucker' });
    const b = dtfStandJePosition([z({ Status: STATUS.BESTELLT, DTF_Bestellung: 'DTF-2026-0001' }), z({ Schluessel: 'JFN:1:11:Rücken', Druckposition: 'Rücken' })]).get('JFN:1:11');
    expect(b).toMatchObject({ stand: 'bestellt', bestellung: 'DTF-2026-0001', geliefert: false });
    expect(dtfStandJePosition([z({ Status: STATUS.GELIEFERT, DTF_Bestellung: 'DTF-2026-0001' })]).get('JFN:1:11').geliefert).toBe(true);
  });
  test('Karten-Plan: aus dem Lager = abwaehlen mit Grund (offen und anders abgewaehlt), bestellen = zurueckholen', () => {
    const g = [{ schluessel: 'JFN:1:11:Brust', stand: 's1' }];
    expect(dtfKartenPlan([z()], { ziel: 'lager', gesehen: g })).toEqual([{ schluessel: 'JFN:1:11:Brust', felder: { Status: STATUS.ABGEWAEHLT, Grund: GRUND_LAGER, Notiz: '' } }]);
    expect(dtfKartenPlan([z({ Status: STATUS.ABGEWAEHLT, Grund: GRUND_LAGER })], { ziel: 'lager', gesehen: g })).toEqual([]);   // schon so
    expect(dtfKartenPlan([z({ Status: STATUS.ABGEWAEHLT, Grund: GRUND_LAGER })], { ziel: 'bestellen', gesehen: g })[0].felder.Status).toBe(STATUS.OFFEN);
  });
  test('Karten-Plan: bestellt sperrt "aus dem Lager"; fremder Stand oder neue Zeile = 409', () => {
    expect(() => dtfKartenPlan([z({ Status: STATUS.BESTELLT })], { ziel: 'lager', gesehen: [{ schluessel: 'JFN:1:11:Brust', stand: 's1' }] })).toThrow(/schon bestellt/);
    expect(() => dtfKartenPlan([z()], { ziel: 'lager', gesehen: [{ schluessel: 'JFN:1:11:Brust', stand: 'alt' }] })).toThrow(/inzwischen/);
    expect(() => dtfKartenPlan([z()], { ziel: 'lager', gesehen: [] })).toThrow(/weitere DTF-Zeilen/);
  });
  test('Lager-Zeilen sind nicht bestellbar (zaehlen nicht in Auswahl/Meter-Schaetzung)', () => {
    const v = zeileAnsicht(z({ Status: STATUS.ABGEWAEHLT, Grund: GRUND_LAGER }), { masse: [], dateien: [], handJe: new Map(), dateiInfo: new Map() });
    expect(v).toMatchObject({ bereit: false, grundNicht: 'status', grund: GRUND_LAGER });
  });
  test('Abgleich: "aus dem Lager"-Zeilen machen eine aeltere Bestellung nicht bekannt', () => {
    const lager = z({ Nummer: '8000', Schluessel: 'JFN:8000:21:Brust', Position: '21', Status: STATUS.ABGEWAEHLT, Grund: GRUND_LAGER });
    const kand = { quelle: 'JFN', nummer: '8000', position: '22', datum: '2026-11-20', druckpositionen: ['Brust'], menge: 1 };
    const r = dtfAbgleichPlan({ vorhanden: [lager], kandidaten: [kand], start: '2026-11-25' });
    expect(r.neu).toEqual([]);
    expect(r.aelter).toHaveLength(1);
  });
});

describe('Bestellkarte (utils/produktion-stand.js, Mika)', () => {
  test('Knoepfe aus mit Grund, Trikot ohne Knoepfe, ohne Korb-Zeile "keine"', () => {
    expect(dtfFuerKarte({ einrichtung: false, je: new Map() }, 'JFN:1:1')).toEqual({ aus: DTF_AUS.einrichtung });
    expect(dtfFuerKarte({ einrichtung: null, je: new Map() }, 'JFN:1:1')).toEqual({ aus: DTF_AUS.lesen });
    expect(dtfFuerKarte({ einrichtung: true, je: new Map() }, 'JFN:1:1', KLASSE.TRIKOT)).toBeNull();
    expect(dtfFuerKarte({ einrichtung: true, je: new Map() }, 'JFN:1:1')).toEqual({ stand: 'keine', zeilen: [] });
  });
  test('Mika liest den DTF-Stand aus dem Korb, nicht aus dem alten Haken', () => {
    expect(shopPositionStand({ dtfBestellt: true, lshop: {} })).not.toContain('DTF');
    expect(shopPositionStand({ dtf: { stand: 'bestellt', geliefert: false }, lshop: {} })).toContain('DTF bestellt');
    expect(shopPositionStand({ dtf: { stand: 'lager' }, lshop: {} })).toContain('DTF schon da');
  });
});

describe('Schreibweg aus der Karte (lib/dtfKorb.js)', () => {
  const opt = o => ({ sheets, wcFuer: wcMit(o), auftraege: keineAuftraege });
  test('aus dem Lager -> Korb "abgewählt · schon da", Karte zeigt lager; bestellen -> wieder offen; keine Lager-Buchung', async () => {
    const o = [order(9001, 'processing', [[11, 111, 555, 2]])];
    await runDtfAbgleich(opt(o));
    const r = await setzeDtfKarte({ ...opt(o), eingabe: { nummer: '9001', position: '11', ziel: 'lager', gesehen: gesehen('JFN:9001:11') } });
    expect(r.dtf.stand).toBe('lager');
    expect(spalte(tabs[TAB_DTF_KORB][1], 'Status')).toBe(STATUS.ABGEWAEHLT);
    expect(spalte(tabs[TAB_DTF_KORB][1], 'Grund')).toBe(GRUND_LAGER);
    expect(tabs.Lager_Buchungen).toBeUndefined();
    const k = await leseDtfJePosition({ sheets });
    expect(k.je.get('JFN:9001:11').stand).toBe('lager');
    const r2 = await setzeDtfKarte({ ...opt(o), eingabe: { nummer: '9001', position: '11', ziel: 'bestellen', gesehen: gesehen('JFN:9001:11') } });
    expect(r2.dtf.stand).toBe('bestellen');
    expect(spalte(tabs[TAB_DTF_KORB][1], 'Status')).toBe(STATUS.OFFEN);
    expect(sheets.spreadsheets.values.append).not.toHaveBeenCalled();
  });
  test('Position vor dem Start-Datum: "aus dem Lager" legt nur diese Position abgewählt an; der naechste Abgleich holt die anderen nicht', async () => {
    const o = [order(8000, 'processing', [[21, 111, 555, 1], [22, 111, 555, 1]], '2026-11-20T09:00:00')];
    await runDtfAbgleich(opt(o));
    expect(tabs[TAB_DTF_KORB]).toHaveLength(1);
    const r = await setzeDtfKarte({ ...opt(o), eingabe: { nummer: '8000', position: '21', ziel: 'lager', gesehen: [] } });
    expect(r).toMatchObject({ angelegt: 1, dtf: { stand: 'lager' } });
    expect(zeilenObj().map(x => [x.Schluessel, x.Status, x.Grund])).toEqual([['JFN:8000:21:Brust', STATUS.ABGEWAEHLT, GRUND_LAGER]]);
    await runDtfAbgleich(opt(o));
    expect(tabs[TAB_DTF_KORB]).toHaveLength(2);   // Position 22 bleibt draussen (aelter)
  });
  test('Position vor dem Start-Datum: "bestellen" nimmt auf wie "trotzdem aufnehmen" (ganze Bestellung)', async () => {
    const o = [order(8000, 'processing', [[21, 111, 555, 1], [22, 111, 555, 1]], '2026-11-20T09:00:00')];
    const r = await setzeDtfKarte({ ...opt(o), eingabe: { nummer: '8000', position: '21', ziel: 'bestellen', gesehen: [] } });
    expect(r).toMatchObject({ angelegt: 2, dtf: { stand: 'bestellen' } });
    expect(zeilenObj().every(x => x.Status === STATUS.OFFEN)).toBe(true);
  });
  test('keine DTF-Position (Trikot) -> 422 mit Grund, nichts geschrieben', async () => {
    const o = [order(9002, 'processing', [[31, 500, 0, 1]])];
    await expect(setzeDtfKarte({ ...opt(o), eingabe: { nummer: '9002', position: '31', ziel: 'lager', gesehen: [] } })).rejects.toMatchObject({ status: 422, code: 'kein_dtf' });
    expect(tabs[TAB_DTF_KORB]).toHaveLength(1);
  });
  test('bestellte Zeile: "aus dem Lager" 409; Korb nicht eingerichtet: 409 einrichtung', async () => {
    const o = [order(9001, 'processing', [[11, 111, 555, 2]])];
    await runDtfAbgleich(opt(o));
    tabs[TAB_DTF_KORB][1][KORB_SPALTEN.indexOf('Status')] = STATUS.BESTELLT;
    await expect(setzeDtfKarte({ ...opt(o), eingabe: { nummer: '9001', position: '11', ziel: 'lager', gesehen: gesehen('JFN:9001:11') } })).rejects.toMatchObject({ status: 409, code: 'bestellt' });
    delete tabs[TAB_DTF_KORB];
    expect((await leseDtfJePosition({ sheets })).einrichtung).toBe(false);
  });
  test('Auftrag unten: "schon da"', async () => {
    tabs[TAB_DTF_KORB].push(KORB_SPALTEN.map(s => ({ Schluessel: 'AU:AU-2026-0001:AU-2026-0001-01:Brust', Quelle: 'AU', Nummer: 'AU-2026-0001',
      Position: 'AU-2026-0001-01', Druckposition: 'Brust', Status: STATUS.ABGEWAEHLT, Grund: GRUND_LAGER }[s] ?? '')));
    expect((await leseDtfJeAuPosition({ sheets })).get('AU-2026-0001-01')).toEqual({ status: 'schon da', bestellung: '' });
  });
});

describe('Oberflaeche', () => {
  test('drei Knoepfe mit Nicoles Wortlaut, "DTF bestellt" nur Anzeige, aktiver Stand gedrueckt, Mouse-over', () => {
    expect(html).toContain('data-hilfe="ps-dtf-bestellen">DTF bestellen</button>');
    expect(html).toContain('aria-disabled="true" data-hilfe="ps-dtf-bestellt">${btext}</button>');
    expect(html).toContain('data-hilfe="ps-dtf-lager">DTF aus dem Lager</button>');
    expect(html).toContain('data-hilfe="ps-dtf-lager-gesperrt">DTF aus dem Lager</button>');
    expect(html).toContain('früher als „DTF bestellt“ markiert');
  });
  test('alter Haken nicht mehr bedienbar; Klick schreibt ueber /api/dtf/karte und zeichnet nur die Karte neu', () => {
    expect(html).not.toContain("box('dtfBestellt')");
    expect(html).toContain('`${API_BASE()}/api/dtf/karte`');
    expect(html).toContain('try { await psEinzelnNeu(order); } catch { /* Anzeige bleibt */ }');
  });
});
