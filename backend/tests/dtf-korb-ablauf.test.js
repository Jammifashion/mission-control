// DT1: DTF-Warenkorb - Ablaeufe mit Sheets-Attrappe, Shop- und Drive-Attrappe. Nur erfundene Werte.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sheetsAttrappe } from './hilfen/sheets-attrappe.js';
import { KORB_SPALTEN, DATEI_SPALTEN, PROTOKOLL_SPALTEN, TAB_DTF_KORB, TAB_DTF_PROTOKOLL, TAB_DTF_DATEIEN, STATUS, BESTELL_STATUS } from '../utils/dtf-korb.js';

const {
  runDtfAbgleich, bestellungAbsenden, bestellungPruefen, lieferungDa, zuordnen, leseDtfKorb, leseDtfJeAuPosition, startDatumAus, _dtfKorbZustandLeeren,
} = await import('../lib/dtfKorb.js');

const hier = dirname(fileURLToPath(import.meta.url));
let tabs, sheets;
const DM_KOPF = ['Druckmass_ID', 'Bezug', 'Position', 'Groesse', 'Breite_cm', 'Hoehe_cm', 'Aktiv', 'Notiz', 'Angelegt', 'Stand', 'Fuehrend', 'Modell'];

function grundTabs() {
  return {
    [TAB_DTF_KORB]: [KORB_SPALTEN],
    [TAB_DTF_DATEIEN]: [DATEI_SPALTEN],
    [TAB_DTF_PROTOKOLL]: [PROTOKOLL_SPALTEN],
    Druckmasse: [DM_KOPF, ['DM-0001', 'XY-Test', 'Brust', 'alle', 10, 10, 'ja', '', '', '', '', '']],
    Config: [['Schlüssel', 'Wert'], ['dtf.start_datum', '2026-11-25'], ['dtf.breite_cm', 57], ['dtf.verschnitt_prozent', 15], ['dtf.scan_basis_url', 'https://mc.example.test']],
    Varianten: [['SSOT-ID', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'WC_Variation_ID'], ['0001', 'Farbe', 'Schwarz', 'Größe', 'L', '', '', '555']],
    Erfassungsmaske: [['ID', 'Produkt-ID', 'Artikelkurzbezeichnung', 'Artikelnummer'], ['0001', '111', 'XY-Test', 'M100/XY-Test'], ['0002', '222', 'ST-Stick', 'M100/ST-Stick']],
    Motive: [['Artikelkurzbezeichnung', 'Druckart'], ['XY-Test', ''], ['ST-Stick', 'Stick']],
    Trikot_Artikel: [['Produkt-ID'], ['500']],
  };
}
const order = (id, status, items, datum = '2026-11-26T10:00:00') => ({ id, status, date_created: datum,
  line_items: items.map(([lid, pid, vid, q]) => ({ id: lid, product_id: pid, variation_id: vid, quantity: q, meta_data: [] })) });

function wcMit(offene, nachId = {}) {
  const get = jest.fn(async (_pfad, q) => {
    if (q.include) return { data: q.include.split(',').map(i => nachId[i]).filter(Boolean) };
    return { data: q.status === 'processing' && q.page === 1 ? offene : [] };
  });
  return () => ({ get });
}
const keineAuftraege = async () => [];

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot';
  process.env.BUSINESS_SHEET_ID = 'business';
  tabs = grundTabs();
  sheets = sheetsAttrappe(() => tabs);
  _dtfKorbZustandLeeren();
});

describe('Abgleich', () => {
  test('neu je Druckposition; Trikot und Stick nicht; doppelt nichts', async () => {
    const wcFuer = wcMit([order(9001, 'processing', [[11, 111, 555, 2], [12, 500, 0, 1], [13, 222, 0, 1]])]);
    const r = await runDtfAbgleich({ sheets, wcFuer, auftraege: keineAuftraege });
    expect(r.neu).toBe(1);
    const korb = tabs[TAB_DTF_KORB];
    expect(korb).toHaveLength(2);
    const z = Object.fromEntries(KORB_SPALTEN.map((s, i) => [s, korb[1][i]]));
    expect(z).toMatchObject({ Schluessel: 'JFN:9001:11:Brust', Kuerzel: 'XY-Test', Modell: 'M100', Textilfarbe: 'Schwarz', Groesse: 'L', Menge: 2, Status: STATUS.OFFEN });
    const r2 = await runDtfAbgleich({ sheets, wcFuer, auftraege: keineAuftraege });
    expect(r2.neu).toBe(0);
    expect(tabs[TAB_DTF_KORB]).toHaveLength(2);
    expect(sheets.spreadsheets.values.append).not.toHaveBeenCalled();
  });

  test('vor dem Start: nicht im Korb, aber in "aelter"; "trotzdem aufnehmen" holt sie', async () => {
    const wcFuer = wcMit([order(8000, 'processing', [[21, 111, 555, 1]], '2026-11-20T09:00:00')]);
    const r = await runDtfAbgleich({ sheets, wcFuer, auftraege: keineAuftraege });
    expect(r.neu).toBe(0);
    expect(r.aelter).toEqual([{ quelle: 'JFN', nummer: '8000', datum: '2026-11-20', positionen: 1 }]);
    const r2 = await runDtfAbgleich({ sheets, wcFuer, auftraege: keineAuftraege, zwang: new Set(['JFN:8000']) });
    expect(r2.neu).toBe(1);
  });

  test('storniert: nur Hinweis, Status bleibt', async () => {
    await runDtfAbgleich({ sheets, wcFuer: wcMit([order(9001, 'processing', [[11, 111, 555, 2]])]), auftraege: keineAuftraege });
    const r = await runDtfAbgleich({ sheets, wcFuer: wcMit([], { 9001: order(9001, 'cancelled', [[11, 111, 555, 2]]) }), auftraege: keineAuftraege });
    expect(r.hinweise).toBe(1);
    const z = tabs[TAB_DTF_KORB][1];
    expect(z[KORB_SPALTEN.indexOf('Hinweis')]).toBe('Bestellung storniert');
    expect(z[KORB_SPALTEN.indexOf('Status')]).toBe(STATUS.OFFEN);
  });

  test('Auftrag: Express, Hand-Masse, Druckname -> Hinweis "Namensdruck separat"; Nicht-DTF nicht', async () => {
    const auftraege = async () => [{ Auftrag_Nr: 'AU-2026-0001', Status: 'bestellt', Angelegt: '2026-11-26', DTF_Express: 'ja', positionen: [
      { Position_ID: 'AU-2026-0001-01', Druck: 'DTF', Menge: 5, Motiv: 'Vereinslogo', Druckmasse_Hand: 'Rücken 28x30', Druckname: 'M: A', lshop: { modell: 'M100', farbe: 'Rot', groesse: 'M' } },
      { Position_ID: 'AU-2026-0001-02', Druck: 'Stick', Menge: 5, Motiv: 'Vereinslogo' },
    ] }];
    const r = await runDtfAbgleich({ sheets, wcFuer: wcMit([]), auftraege });
    expect(r.neu).toBe(1);
    const z = Object.fromEntries(KORB_SPALTEN.map((s, i) => [s, tabs[TAB_DTF_KORB][1][i]]));
    expect(z).toMatchObject({ Schluessel: 'AU:AU-2026-0001:AU-2026-0001-01:Rücken', Express: 'ja', Hinweis: 'Namensdruck separat', Kuerzel: 'Vereinslogo' });
  });

  test('Startdatum aus Config (Text, Seriennummer, TT.MM.JJJJ)', () => {
    expect(startDatumAus('2026-11-25')).toBe('2026-11-25');
    expect(startDatumAus('25.11.2026')).toBe('2026-11-25');
    expect(startDatumAus(46351)).toBe('2026-11-25');
    expect(startDatumAus('')).toBe('');
  });
});

// ── Bestellung ───────────────────────────────────────────────────────────────

function ablageMit(ergebnis, { info = {} } = {}) {
  return {
    dtfAblageId: async () => 'dtf-ablage',
    dateiInfos: jest.fn(async ids => new Map(ids.map(id => [id, info[id] ?? { da: true, name: `${id}.png`, pfad: `Motive/XY-Test/${id}.png`, ablage: 'dtf' }]))),
    kopiereKundenmotiv: jest.fn(async ({ auNr, id }) => ({ id: `kopie-${id}`, pfad: `Kunden/${auNr}/${id}.png` })),
    legeXmlAb: jest.fn(async () => ergebnis),
    findeXml: jest.fn(async () => ({ liegt: false })),
    dateiOeffentlich: (id, i) => ({ id, ...i }),
  };
}
async function korbMitBereiterZeile(dateiId = 'f1') {
  await runDtfAbgleich({ sheets, wcFuer: wcMit([order(9001, 'processing', [[11, 111, 555, 57]])]), auftraege: keineAuftraege });
  tabs[TAB_DTF_DATEIEN].push(['XY-Test', 'Brust', 'alle', 'alle', 'alle', dateiId, `${dateiId}.png`, '', 'ja', '', '']);
}
const auswahl = () => [{ schluessel: 'JFN:9001:11:Brust' }];

describe('Absenden', () => {
  test('liegt: XML abgelegt, Zeile bestellt mit Druck-ID und festen Massen, Chat ohne Namen', async () => {
    await korbMitBereiterZeile();
    const ablage = ablageMit({ ergebnis: 'liegt', id: 'xml1' });
    const melde = jest.fn(async () => {});
    const r = await bestellungAbsenden({ eingabe: { auswahl: auswahl() }, sheets, ablage, auftraege: keineAuftraege, melde, jetzt: () => new Date('2026-11-27T10:00:00Z') });
    expect(r).toMatchObject({ ok: true, id: 'DTF-2026-0001', anzahl: 1, laengeCm: 120 });
    expect(ablage.legeXmlAb).toHaveBeenCalledTimes(1);
    const { dateiname, inhalt } = ablage.legeXmlAb.mock.calls[0][0];
    expect(dateiname).toBe('DTF-2026-0001.xml');
    expect(inhalt).toContain('druckId="DTF-2026-0001-01" datei="Motive/XY-Test/f1.png" breite_mm="100" hoehe_mm="100" fuehrend="breite" anzahl="57" referenz="JFN-9001"');
    expect(inhalt).toContain('qr="https://mc.example.test/#dtf/scan/DTF-2026-0001-01"');
    const z = Object.fromEntries(KORB_SPALTEN.map((s, i) => [s, tabs[TAB_DTF_KORB][1][i]]));
    expect(z).toMatchObject({ Status: STATUS.BESTELLT, DTF_Bestellung: 'DTF-2026-0001', Druck_ID: 'DTF-2026-0001-01', Breite_cm: 10, Hoehe_cm: 10, Datei_ID: 'f1' });
    const p = Object.fromEntries(PROTOKOLL_SPALTEN.map((s, i) => [s, tabs[TAB_DTF_PROTOKOLL][1][i]]));
    expect(p).toMatchObject({ Bestell_ID: 'DTF-2026-0001', Status: BESTELL_STATUS.ABGELEGT, Lieferart: 'abholung', Laenge_cm: 120 });
    expect(melde).toHaveBeenCalledWith('🖨️ DTF-2026-0001 abgelegt · ≈ 1,2 m · Abholung');
    expect(r.nachricht).toContain('DTF-2026-0001');
  });

  test('unklar: Status "unklar", Alarm, KEIN zweiter Versuch; Zeilen bleiben offen; erneutes Absenden gesperrt', async () => {
    await korbMitBereiterZeile();
    const ablage = ablageMit({ ergebnis: 'unklar', grund: 'keine Antwort' });
    const alarm = jest.fn(async () => {});
    await expect(bestellungAbsenden({ eingabe: { auswahl: auswahl() }, sheets, ablage, auftraege: keineAuftraege, alarm, melde: jest.fn() }))
      .rejects.toMatchObject({ code: 'unklar' });
    expect(ablage.legeXmlAb).toHaveBeenCalledTimes(1);
    expect(alarm).toHaveBeenCalledTimes(1);
    expect(tabs[TAB_DTF_KORB][1][KORB_SPALTEN.indexOf('Status')]).toBe(STATUS.OFFEN);
    expect(tabs[TAB_DTF_PROTOKOLL][1][PROTOKOLL_SPALTEN.indexOf('Status')]).toBe(BESTELL_STATUS.UNKLAR);
    await expect(bestellungAbsenden({ eingabe: { auswahl: auswahl() }, sheets, ablage, auftraege: keineAuftraege, alarm, melde: jest.fn() }))
      .rejects.toMatchObject({ code: 'probleme' });
    expect(ablage.legeXmlAb).toHaveBeenCalledTimes(1);
    // Pruefen: liegt nicht -> abgebrochen, danach wieder bestellbar
    const r = await bestellungPruefen({ id: 'DTF-2026-0001', sheets, ablage });
    expect(r.ergebnis).toBe('abgebrochen');
    expect(tabs[TAB_DTF_PROTOKOLL][1][PROTOKOLL_SPALTEN.indexOf('Status')]).toBe(BESTELL_STATUS.ABGEBROCHEN);
  });

  test('Pruefen: XML liegt doch -> Zeilen bestellt', async () => {
    await korbMitBereiterZeile();
    const ablage = ablageMit({ ergebnis: 'unklar', grund: 'Zeitlimit' });
    await expect(bestellungAbsenden({ eingabe: { auswahl: auswahl() }, sheets, ablage, auftraege: keineAuftraege, alarm: jest.fn(), melde: jest.fn() })).rejects.toThrow();
    ablage.findeXml.mockResolvedValue({ liegt: true, id: 'xml9' });
    const r = await bestellungPruefen({ id: 'DTF-2026-0001', sheets, ablage, melde: jest.fn() });
    expect(r.ergebnis).toBe('abgelegt');
    expect(tabs[TAB_DTF_KORB][1][KORB_SPALTEN.indexOf('Status')]).toBe(STATUS.BESTELLT);
    // Lieferung da
    await lieferungDa({ id: 'DTF-2026-0001', sheets });
    expect(tabs[TAB_DTF_KORB][1][KORB_SPALTEN.indexOf('Status')]).toBe(STATUS.GELIEFERT);
    expect(tabs[TAB_DTF_PROTOKOLL][1][PROTOKOLL_SPALTEN.indexOf('Status')]).toBe(BESTELL_STATUS.GELIEFERT);
  });

  test('nicht abgelegt (vor der Uebertragung abgelehnt): abgebrochen, Zeilen offen', async () => {
    await korbMitBereiterZeile();
    const ablage = ablageMit({ ergebnis: 'nicht-da', grund: 'Drive 403' });
    await expect(bestellungAbsenden({ eingabe: { auswahl: auswahl() }, sheets, ablage, auftraege: keineAuftraege, melde: jest.fn() })).rejects.toMatchObject({ code: 'nicht_abgelegt' });
    expect(tabs[TAB_DTF_PROTOKOLL][1][PROTOKOLL_SPALTEN.indexOf('Status')]).toBe(BESTELL_STATUS.ABGEBROCHEN);
    expect(tabs[TAB_DTF_KORB][1][KORB_SPALTEN.indexOf('Status')]).toBe(STATUS.OFFEN);
  });

  test('Datei fehlt in Drive: nichts abgelegt', async () => {
    await korbMitBereiterZeile();
    const ablage = ablageMit({ ergebnis: 'liegt' }, { info: { f1: { da: false } } });
    await expect(bestellungAbsenden({ eingabe: { auswahl: auswahl() }, sheets, ablage, auftraege: keineAuftraege, melde: jest.fn() })).rejects.toMatchObject({ code: 'probleme' });
    expect(ablage.legeXmlAb).not.toHaveBeenCalled();
    expect(tabs[TAB_DTF_PROTOKOLL]).toHaveLength(1);
  });

  test('Kundenmotiv (Entwurf in "Mission Control") wird vorher nach Kunden/<AU>/ kopiert, XML zeigt die Kopie', async () => {
    const auftraege = async () => [{ Auftrag_Nr: 'AU-2026-0001', Status: 'bestellt', Angelegt: '2026-11-26', positionen: [
      { Position_ID: 'AU-2026-0001-01', Druck: '', Menge: 3, Motiv: 'Vereinslogo', Druckmasse_Hand: 'Brust 10x5', lshop: {} } ] }];
    await runDtfAbgleich({ sheets, wcFuer: wcMit([]), auftraege });
    tabs[TAB_DTF_DATEIEN].push(['Vereinslogo', 'Brust', 'alle', 'alle', 'alle', 'ent1', 'logo.png', '', 'ja', '', '']);
    const ablage = ablageMit({ ergebnis: 'liegt', id: 'x' }, { info: { ent1: { da: true, name: 'logo.png', pfad: 'logo.png', ablage: 'mc' } } });
    await bestellungAbsenden({ eingabe: { auswahl: [{ schluessel: 'AU:AU-2026-0001:AU-2026-0001-01:Brust' }], lieferart: 'versand_dhl' }, sheets, ablage, auftraege, melde: jest.fn() });
    expect(ablage.kopiereKundenmotiv).toHaveBeenCalledWith({ id: 'ent1', auNr: 'AU-2026-0001' });
    expect(ablage.legeXmlAb.mock.calls[0][0].inhalt).toContain('datei="Kunden/AU-2026-0001/ent1.png"');
    expect(ablage.legeXmlAb.mock.calls[0][0].inhalt).toContain('lieferart="versand-dhl"');
    const m = await leseDtfJeAuPosition({ sheets });
    expect(m.get('AU-2026-0001-01')).toEqual({ status: STATUS.BESTELLT, bestellung: 'DTF-2026-0001' });
  });
});

// antwort-DT1-3: XML zuletzt, kein halber Satz, nichts nachtraeglich aendern
describe('Reihenfolge beim Ablegen (antwort-DT1-3)', () => {
  const auftraege = async () => [{ Auftrag_Nr: 'AU-2026-0001', Status: 'bestellt', Angelegt: '2026-11-26', positionen: [
    { Position_ID: 'AU-2026-0001-01', Druck: '', Menge: 3, Motiv: 'Vereinslogo', Druckmasse_Hand: 'Brust 10x5', lshop: {} } ] }];
  async function mitKundenmotiv() {
    await runDtfAbgleich({ sheets, wcFuer: wcMit([]), auftraege });
    tabs[TAB_DTF_DATEIEN].push(['Vereinslogo', 'Brust', 'alle', 'alle', 'alle', 'ent1', 'logo.png', '', 'ja', '', '']);
    return [{ schluessel: 'AU:AU-2026-0001:AU-2026-0001-01:Brust' }];
  }
  test('Bild scheitert -> keine XML, keine Protokollzeile, Zeile bleibt offen; erneuter Versuch geht', async () => {
    const auswahlAu = await mitKundenmotiv();
    const ablage = ablageMit({ ergebnis: 'liegt', id: 'x' }, { info: { ent1: { da: true, name: 'logo.png', pfad: 'logo.png', ablage: 'mc' } } });
    ablage.kopiereKundenmotiv.mockRejectedValueOnce(Object.assign(new Error('Drive 500'), { status: 502 }));
    await expect(bestellungAbsenden({ eingabe: { auswahl: auswahlAu }, sheets, ablage, auftraege, melde: jest.fn() }))
      .rejects.toMatchObject({ code: 'nicht_abgelegt', message: expect.stringMatching(/Nicht abgelegt.*bitte erneut/) });
    expect(ablage.legeXmlAb).not.toHaveBeenCalled();
    expect(tabs[TAB_DTF_PROTOKOLL]).toHaveLength(1);
    expect(tabs[TAB_DTF_KORB][1][KORB_SPALTEN.indexOf('Status')]).toBe(STATUS.OFFEN);
    const r = await bestellungAbsenden({ eingabe: { auswahl: auswahlAu }, sheets, ablage, auftraege, melde: jest.fn() });
    expect(r.id).toBe('DTF-2026-0001');
  });
  test('XML erst nach allen Bildern', async () => {
    const auswahlAu = await mitKundenmotiv();
    const reihe = [];
    const ablage = ablageMit({ ergebnis: 'liegt', id: 'x' }, { info: { ent1: { da: true, name: 'logo.png', pfad: 'logo.png', ablage: 'mc' } } });
    ablage.kopiereKundenmotiv.mockImplementation(async ({ auNr, id }) => { reihe.push('bild'); return { id: `k-${id}`, pfad: `Kunden/${auNr}/logo.png` }; });
    ablage.legeXmlAb.mockImplementation(async () => { reihe.push('xml'); return { ergebnis: 'liegt', id: 'x' }; });
    await bestellungAbsenden({ eingabe: { auswahl: auswahlAu }, sheets, ablage, auftraege, melde: jest.fn() });
    expect(reihe).toEqual(['bild', 'xml']);
  });
  test('Korrektur = neue Bestellung mit "ersetzt"; nur gegen eine abgelegte', async () => {
    await korbMitBereiterZeile();
    const ablage = ablageMit({ ergebnis: 'liegt', id: 'x1' });
    await bestellungAbsenden({ eingabe: { auswahl: auswahl() }, sheets, ablage, auftraege: keineAuftraege, melde: jest.fn() });
    await runDtfAbgleich({ sheets, wcFuer: wcMit([order(9005, 'processing', [[51, 111, 555, 1]])]), auftraege: keineAuftraege });
    await expect(bestellungAbsenden({ eingabe: { auswahl: [{ schluessel: 'JFN:9005:51:Brust' }], ersetzt: 'DTF-2026-0099' }, sheets, ablage, auftraege: keineAuftraege, melde: jest.fn() }))
      .rejects.toMatchObject({ code: 'ersetzt' });
    const r = await bestellungAbsenden({ eingabe: { auswahl: [{ schluessel: 'JFN:9005:51:Brust' }], ersetzt: 'DTF-2026-0001' }, sheets, ablage, auftraege: keineAuftraege, melde: jest.fn() });
    expect(r.id).toBe('DTF-2026-0002');
    expect(ablage.legeXmlAb.mock.calls.at(-1)[0].inhalt).toContain('ersetzt="DTF-2026-0001"');
    expect(r.nachricht).toContain('Sie ersetzt DTF-2026-0001.');
    // die alte Bestellung bleibt unveraendert abgelegt
    expect(tabs[TAB_DTF_PROTOKOLL][1][PROTOKOLL_SPALTEN.indexOf('Status')]).toBe(BESTELL_STATUS.ABGELEGT);
  });
  test('Ordner Rueckmeldung/ wird angelegt (leer); XML-Ablage ohne Umbenennen/Loeschen', async () => {
    const { ORDNER } = await import('../lib/dtfAblage.js');
    expect(Object.values(ORDNER)).toEqual(['Motive', 'Kunden', 'Bestellungen', 'Rueckmeldung']);
    const src = readFileSync(resolve(hier, '../lib/dtfAblage.js'), 'utf8');
    expect(src.match(/files\.create\(/g)).toHaveLength(4);   // Ordner, Motiv-Upload, Kundenmotiv, XML
  });
});

describe('Zuordnen', () => {
  test('nach dem Zuordnen sind alle passenden Zeilen gruen', async () => {
    tabs.Druckmasse = [DM_KOPF];
    await runDtfAbgleich({ sheets, wcFuer: wcMit([order(9001, 'processing', [[11, 111, 555, 2]]), order(9002, 'processing', [[21, 111, 555, 1]])]), auftraege: keineAuftraege });
    // ohne Mass: Platzhalter
    expect(tabs[TAB_DTF_KORB].slice(1).map(z => z[KORB_SPALTEN.indexOf('Druckposition')])).toEqual(['-', '-']);
    const ablage = ablageMit(null);
    const merke = jest.fn(async ({ eingabe }) => {
      for (const teil of eingabe.teile) tabs.Druckmasse.push([`DM-000${tabs.Druckmasse.length}`, eingabe.bezug, teil.position, eingabe.groesse, teil.breite, teil.hoehe, 'ja', '', '', '', teil.fuehrend, eingabe.modell]);
      return { neu: 1, ersetzt: 0, schon: 0 };
    });
    await zuordnen({ eingabe: { bezug: 'XY-Test', position: 'Brust', modell: 'M100', farbe: 'Schwarz', groesse: 'L', datei: { id: 'f1' }, mass: { breite: 22, hoehe: 11 } }, sheets, ablage, merke });
    expect(tabs[TAB_DTF_DATEIEN]).toHaveLength(2);
    expect(merke).toHaveBeenCalledTimes(1);
    // naechster Abgleich legt die echte Druckposition an, Platzhalter verschwinden aus der Anzeige
    await runDtfAbgleich({ sheets, wcFuer: wcMit([order(9001, 'processing', [[11, 111, 555, 2]]), order(9002, 'processing', [[21, 111, 555, 1]])]), auftraege: keineAuftraege });
    const a = await leseDtfKorb({ sheets, ablage, auftraege: keineAuftraege });
    expect(a.zeilen.map(z => [z.schluessel, z.bereit])).toEqual([['JFN:9001:11:Brust', true], ['JFN:9002:21:Brust', true]]);
  });
});

describe('Quelltext', () => {
  test('DTF-Routen hinter requireApiKey, Scheduler-Route im intern-Router', () => {
    const idx = readFileSync(resolve(hier, '../index.js'), 'utf8');
    expect(idx.indexOf("app.use('/api/dtf'")).toBeGreaterThan(idx.indexOf('app.use(requireApiKey)'));
    expect(readFileSync(resolve(hier, '../routes/intern.js'), 'utf8')).toContain("router.post('/dtf-korb/abgleich'");
  });
  test('kein values.append, keine Namen/Preise in XML-Bau oder Chat', () => {
    for (const f of ['../lib/dtfKorb.js', '../lib/dtfAblage.js', '../utils/dtf-korb.js']) {
      const src = readFileSync(resolve(hier, f), 'utf8');
      expect(src).not.toMatch(/values\.append/);
      expect(src).not.toMatch(/files\.(delete|update|emptyTrash)|permissions\.create/);
    }
  });
});
