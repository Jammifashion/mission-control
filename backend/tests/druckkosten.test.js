// DK1: Druckkosten (DTF) je Auftrag. Nur erfundene Werte (keine echten Preise), Sheets als Attrappe.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sheetsAttrappe } from './hilfen/sheets-attrappe.js';

jest.unstable_mockModule('googleapis', () => ({ google: { sheets: () => { throw new Error('kein echter Sheets-Client im Test'); } } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}), googleAuthMitScopes: () => ({}) }));

const dk = await import('../utils/druckkosten.js');
const lib = await import('../lib/druckmasse.js');
const HIER = dirname(fileURLToPath(import.meta.url));
const quelle = d => readFileSync(resolve(HIER, d), 'utf8');

// Erfundene Preise: Bogen 57 x 50 cm = 0,285 m² zu 28,50 € -> 100 €/m² brutto; Express 57,00 € -> 200 €/m².
const CONFIG = {
  'dtf.breite_cm': 57, 'dtf.bogen_laenge_cm': 50, 'dtf.preis_je_bogen_brutto': '28,50', 'dtf.preis_je_bogen_express_brutto': 57,
  'dtf.verschnitt_prozent': 15,
};
const MASSE = [
  { Druckmass_ID: 'DM-0001', Bezug: 'Skyline', Position: 'Rücken', Groesse: 'alle', Breite_cm: 28, Hoehe_cm: 17.5, Aktiv: 'ja' },
  { Druckmass_ID: 'DM-0002', Bezug: 'Skyline', Position: 'Brust', Groesse: 'alle', Breite_cm: 10.5, Hoehe_cm: 5, Aktiv: 'ja' },
  { Druckmass_ID: 'DM-0003', Bezug: 'Skyline', Position: 'Rücken', Groesse: 'XS', Breite_cm: 22, Hoehe_cm: 14, Aktiv: 'ja' },
  { Druckmass_ID: 'DM-0004', Bezug: 'Skyline', Position: 'Nacken', Groesse: 'alle', Breite_cm: 5, Hoehe_cm: 2, Aktiv: 'nein' },
];

describe('Preise aus Config', () => {
  test('Bogen: Preis je m² = Bogenpreis / Bogenfläche, normal und Express getrennt', () => {
    const p = dk.dtfPreise(CONFIG);
    expect(p.normal).toMatchObject({ modell: 'bogen' });
    expect(p.normal.qmBruttoCent).toBeCloseTo(10000, 6);
    expect(p.express.qmBruttoCent).toBeCloseTo(20000, 6);
    expect(p.verschnitt).toBe(15);
  });
  test('Meter: Preis je laufendem Meter bei der Breite', () => {
    const p = dk.dtfPreise({ 'dtf.breite_cm': 57, 'dtf.preis_je_meter_brutto': '57,00', 'dtf.preis_je_meter_express_brutto': 114, 'dtf.verschnitt_prozent': 0 });
    expect(p.normal.modell).toBe('meter');
    expect(p.normal.qmBruttoCent).toBeCloseTo(10000, 6);   // 57 € / 0,57 m²
    expect(p.express.qmBruttoCent).toBeCloseTo(20000, 6);
  });
  test('Fehlt ein Wert: "Preis fehlt", nie 0', () => {
    expect(dk.dtfPreise({}).normal.text).toBe('Druckkosten: Preis fehlt (Einstellungen)');
    expect(dk.dtfPreise({ ...CONFIG, 'dtf.bogen_laenge_cm': '' }).normal.fehlt).toContain('dtf.bogen_laenge_cm');
    expect(dk.dtfPreise({ ...CONFIG, 'dtf.breite_cm': '' }).normal.fehlt).toContain('dtf.breite_cm');
    expect(dk.dtfPreise({ ...CONFIG, 'dtf.verschnitt_prozent': '' }).verschnitt).toBeNull();
    const nurNormal = dk.dtfPreise({ ...CONFIG, 'dtf.preis_je_bogen_express_brutto': '' });
    expect(nurNormal.normal.fehlt).toEqual([]);
    expect(nurNormal.express.fehlt.length).toBe(1);
  });
  test('Bogen UND Meter im selben Tarif = widersprüchlich, nicht still einer', () => {
    const p = dk.dtfPreise({ ...CONFIG, 'dtf.preis_je_meter_brutto': 10 });
    expect(p.normal.doppelt).toBe(true);
    expect(p.express.doppelt).toBeUndefined();
  });
  test('Setup belegt Breite 57 und Verschnitt 15 vor, nie einen Preis', () => {
    expect(dk.DTF_CONFIG_VORGABE).toEqual({ 'dtf.breite_cm': '57', 'dtf.verschnitt_prozent': '15' });
  });
});

describe('Druckmaße nachschlagen', () => {
  test('genaue Größe vor "alle", inaktive Zeilen zählen nicht', () => {
    expect(dk.masseFuer(MASSE, 'skyline', 'XS').map(({ position, breite, hoehe, groesse }) => ({ position, breite, hoehe, groesse }))).toEqual([
      { position: 'Rücken', breite: 22, hoehe: 14, groesse: 'XS' }, { position: 'Brust', breite: 10.5, hoehe: 5, groesse: 'alle' }]);
    expect(dk.masseFuer(MASSE, 'Skyline', 'L').map(m => m.breite)).toEqual([28, 10.5]);
    expect(dk.masseFuer(MASSE, 'Anderes', 'L')).toEqual([]);
    expect(dk.normGroesse('XXL')).toBe(dk.normGroesse('2xl'));
  });
  test('Fläche des Beispiels: 28 × 17,5 + 10,5 × 5 = 542,5 cm²', () => {
    expect(dk.flaecheCm2(dk.masseFuer(MASSE, 'Skyline', 'M'))).toBe(542.5);
  });
});

describe('Kosten je Position', () => {
  const preise = dk.dtfPreise(CONFIG);
  test('Fläche × Preis je m² × (1 + Verschnitt), netto', () => {
    // 0,05425 m² × 100 € × 1,15 = 6,23875 € brutto -> /1,19 = 5,2426 € netto je Stück; 3 Stück = 15,73 €
    const d = dk.positionDruck({ druck: '', motiv: 'Skyline', groesse: 'M', menge: 3 }, { masse: MASSE, preise });
    expect(d).toMatchObject({ status: 'ok', quelle: 'tabelle', flaeche: 542.5, stueck: 524.26, netto: 1573 });
  });
  test('Express nimmt den Express-Preis', () => {
    const d = dk.positionDruck({ motiv: 'Skyline', groesse: 'M', menge: 1 }, { masse: MASSE, preise, express: true });
    expect(d.netto).toBe(1049);   // doppelt so teuer (10,4853 €)
  });
  test('fehlender Preis: Status preis_fehlt mit Text, keine 0', () => {
    const d = dk.positionDruck({ motiv: 'Skyline', groesse: 'M', menge: 1 }, { masse: MASSE, preise: dk.dtfPreise({}) });
    expect(d).toMatchObject({ status: 'preis_fehlt', text: 'Preis fehlt (Einstellungen)', flaeche: 542.5 });
    expect(d.netto).toBeUndefined();
  });
  test('Nicht-DTF (Stick, Flex …) wird nicht berechnet; "DTF" oder leer schon', () => {
    for (const druck of ['Stick', 'Flexdruck', 'Siebdruck', 'Flock']) {
      expect(dk.positionDruck({ druck, motiv: 'Skyline', menge: 1 }, { masse: MASSE, preise }).status).toBe('kein_dtf');
    }
    expect(dk.istDtf('DTF Rücken')).toBe(true);
    expect(dk.istDtf('')).toBe(true);
  });
  test('ohne Maß: ohne_mass', () => {
    expect(dk.positionDruck({ motiv: 'Unbekannt', menge: 1 }, { masse: MASSE, preise }).status).toBe('ohne_mass');
    expect(dk.positionDruck({ motiv: '', menge: 1 }, { masse: MASSE, preise }).text).toMatch(/Motiv leer/);
  });
  test('freie Eingabe geht vor der Tabelle', () => {
    const hand = dk.handText([{ position: 'Brust', breite: '10,5', hoehe: 5 }, { position: 'Rücken', breite: 28, hoehe: '17,5' }]);
    expect(hand).toBe('Brust 10,5x5; Rücken 28x17,5');
    expect(dk.handTeile(hand)).toEqual([{ position: 'Brust', breite: 10.5, hoehe: 5, fuehrend: 'Breite', zuordnen: false }, { position: 'Rücken', breite: 28, hoehe: 17.5, fuehrend: 'Breite', zuordnen: false }]);
    const d = dk.positionDruck({ motiv: 'Skyline', groesse: 'XS', menge: 1, hand: 'Brust 10x10' }, { masse: MASSE, preise });
    expect(d).toMatchObject({ status: 'ok', quelle: 'hand', flaeche: 100 });
  });
  test('freie Eingabe prüft Maße und Namen', () => {
    expect(() => dk.handText([{ position: 'Brust', breite: 0, hoehe: 5 }])).toThrow(/Breite/);
    expect(() => dk.handText([{ position: 'Brust', breite: 400, hoehe: 5 }])).toThrow(/300/);
    expect(() => dk.handText([{ position: '', breite: 5, hoehe: 5 }])).toThrow(/bitte wählen/);
    expect(dk.handText([])).toBe('');
  });
  test('Summe und Rohertrag nach Druck nur über Positionen mit Preis und EK', () => {
    const druck = [{ status: 'ok', netto: 500 }, { status: 'ok', netto: 300 }, { status: 'ohne_mass' }, { status: 'kein_dtf' }];
    const summen = { rohertrag: 5000, umsatzMitEk: 10000, positionen: [{ netto: 4000, ek: 1000 }, { netto: 3000, ek: null }, { netto: 2000, ek: 500 }, { netto: 1000, ek: 200 }] };
    const s = dk.druckSummen(druck, summen);
    expect(s).toMatchObject({ gesamt: 800, ohneMass: 1, keinDtf: 1, offen: 1, rohertragNachDruck: 4500, rohertragNachDruckProzent: 45 });
  });
});

describe('Reiter Druckmasse (Attrappe)', () => {
  let tabs;
  const KOPF = dk.DRUCKMASSE_SPALTEN;
  beforeEach(() => {
    process.env.GOOGLE_SHEET_ID = 'ssot-test';
    process.env.BUSINESS_SHEET_ID = 'business-test';
    tabs = {
      Druckmasse: [KOPF, ['DM-0001', 'Skyline', 'Rücken', 'alle', 28, 17.5, 'ja', '', '2026-11-20', 'S1']],
      Config: [['Schlüssel', 'Wert', 'Anbieter'], ['modell.seo-text', 'x', ''], ...Object.entries(CONFIG).map(([k, v]) => [k, v, ''])],
    };
  });
  const sheets = () => sheetsAttrappe(() => tabs);
  const jetzt = () => new Date('2026-11-23T10:00:00Z');

  test('Lesen liefert Zeilen und Preis je m², ohne andere Config-Werte', async () => {
    const r = await lib.leseDruckmasse({ sheets: sheets() });
    expect(r.einrichtung).toBe(true);
    expect(r.zeilen[0]).toMatchObject({ id: 'DM-0001', bezug: 'Skyline', breite: 28, hoehe: 17.5, aktiv: true });
    expect(r.preise.normal).toEqual({ ok: true, modell: 'bogen', qmBrutto: 100 });
    expect(JSON.stringify(r)).not.toMatch(/modell\.seo/);
  });
  test('Anlegen: nächste ID, doppelter aktiver Schlüssel -> 409', async () => {
    const s = sheets();
    const r = await lib.legeDruckmassAn({ eingabe: { bezug: 'Skyline', position: 'Brust', breite: '10,5', hoehe: 5 }, sheets: s, jetzt });
    expect(r.id).toBe('DM-0002');
    expect(tabs.Druckmasse[2].slice(0, 7)).toEqual(['DM-0002', 'Skyline', 'Brust', 'alle', 10.5, 5, 'ja']);
    expect(s.spreadsheets.values.append).not.toHaveBeenCalled();
    await expect(lib.legeDruckmassAn({ eingabe: { bezug: 'skyline', position: 'rücken', breite: 1, hoehe: 1 }, sheets: s, jetzt })).rejects.toMatchObject({ status: 409, code: 'vorhanden' });
  });
  test('Ändern mit Stand, inaktiv statt löschen', async () => {
    const s = sheets();
    await expect(lib.aendereDruckmass({ eingabe: { id: 'DM-0001', stand: 'alt', bezug: 'Skyline', position: 'Rücken', breite: 1, hoehe: 1 }, sheets: s, jetzt })).rejects.toMatchObject({ status: 409 });
    await lib.aendereDruckmass({ eingabe: { id: 'DM-0001', stand: 'S1', bezug: 'Skyline', position: 'Rücken', breite: 30, hoehe: 18, aktiv: false }, sheets: s, jetzt });
    expect(tabs.Druckmasse[1].slice(4, 7)).toEqual([30, 18, 'nein']);
    expect(tabs.Druckmasse.length).toBe(2);
  });
  test('Merken: neue Zeilen; anderes Maß -> 409 anders, mit ersetzen überschrieben', async () => {
    const s = sheets();
    await expect(lib.merkeDruckmasse({ eingabe: { bezug: 'Skyline', teile: [{ position: 'Rücken', breite: 30, hoehe: 20 }, { position: 'Brust', breite: 10, hoehe: 5 }] }, sheets: s, jetzt }))
      .rejects.toMatchObject({ status: 409, code: 'anders', anders: [{ position: 'Rücken', alt: '28 × 17.5', neu: '30 × 20' }] });
    expect(tabs.Druckmasse.length).toBe(2);   // nichts geschrieben
    const r = await lib.merkeDruckmasse({ eingabe: { bezug: 'Skyline', ersetzen: true, teile: [{ position: 'Rücken', breite: 30, hoehe: 20 }, { position: 'Brust', breite: 10, hoehe: 5 }] }, sheets: s, jetzt });
    expect(r).toMatchObject({ neu: 1, ersetzt: 1, schon: 0 });
    expect(tabs.Druckmasse[1].slice(4, 6)).toEqual([30, 20]);
    expect(tabs.Druckmasse[2].slice(0, 6)).toEqual(['DM-0002', 'Skyline', 'Brust', 'alle', 10, 5]);
    const nochmal = await lib.merkeDruckmasse({ eingabe: { bezug: 'Skyline', teile: [{ position: 'Brust', breite: 10, hoehe: 5 }] }, sheets: s, jetzt });
    expect(nochmal).toMatchObject({ neu: 0, schon: 1 });
  });
  test('Reiter fehlt: Lesen ohne Fehler, Schreiben 409 einrichtung', async () => {
    delete tabs.Druckmasse;
    const s = sheets();
    s.spreadsheets.values.get.mockImplementation(async ({ range }) => {
      if (String(range).includes('Druckmasse')) throw Object.assign(new Error('Unable to parse range'), { code: 400 });
      return { data: { values: tabs.Config } };
    });
    expect((await lib.leseDruckKontext({ sheets: s, spreadsheetId: 'ssot-test' })).einrichtung).toBe(false);
    await expect(lib.legeDruckmassAn({ eingabe: { bezug: 'X', position: 'Brust', breite: 1, hoehe: 1 }, sheets: s })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
  });
  test('Setup: Trockenlauf schreibt nichts, Preise bleiben leer', async () => {
    delete tabs.Druckmasse;
    tabs.Config = [['Schlüssel', 'Wert', 'Anbieter']];
    const s = sheets();
    const r = await lib.richteDruckmasseEin({ sheets: s });
    expect(r.geschrieben).toBe(false);
    expect(s.spreadsheets.values.update).not.toHaveBeenCalled();
    await lib.richteDruckmasseEin({ write: true, sheets: s });
    expect(tabs.Druckmasse[0]).toEqual([...KOPF, ...dk.DRUCKMASSE_OPTIONAL]);   // DK2: Fuehrend, Modell hinten
    const cfg = Object.fromEntries(tabs.Config.slice(1).map(r => [r[0], r[1]]));
    expect(cfg).toMatchObject({ 'dtf.breite_cm': '57', 'dtf.verschnitt_prozent': '15', 'dtf.preis_je_bogen_brutto': '', 'dtf.bogen_laenge_cm': '' });
    // Config wird UNFORMATTED gelesen - sonst sieht eine Datumszelle (17.11.2026 = Zahl) beim Ruecklesen "geändert" aus (Befund Setup 23.11.)
    const cfgLesen = s.spreadsheets.values.get.mock.calls.map(c => c[0]).filter(x => String(x.range).startsWith("'Config'"));
    expect(cfgLesen.length).toBeGreaterThan(0);
    for (const x of cfgLesen) expect(x.valueRenderOption).toBe('UNFORMATTED_VALUE');
  });
});

describe('Datenschutz', () => {
  test('Druckkosten nie in Bestellseite, Portal, Lexware, Chat oder Log', () => {
    for (const d of ['../lib/bestellseite.js', '../lib/bestellStand.js', '../routes/partnerPortal.js', '../lib/lexwareRechnung.js', '../utils/rechnung.js', '../lib/chatNotify.js']) {
      expect(quelle(d)).not.toMatch(/druckkosten.js|druckmasse.js|positionDruck|druckSummen|dtfPreise|Druckmasse_Hand|DTF_Express/);
    }
    for (const d of ['../lib/druckmasse.js', '../routes/druckmasse.js', '../utils/druckkosten.js']) {
      expect(quelle(d)).not.toMatch(/console\.(log|info|warn|error)/);
    }
  });
});
