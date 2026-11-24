// DK2 (+ antwort-DK2-1): Maße je Größenzeile, führende Seite, Gründe statt still nichts, Merken -> sofort rechnen,
// "Wie letztes Mal", alter Freitext -> "bitte zuordnen". Nur erfundene Werte (keine echten Preise/Maße), Sheets als Attrappe.
import { machSheets } from './hilfen/korb-sheet.js';
import * as dk from '../utils/druckkosten.js';
import { TAB_AUFTRAEGE, TAB_POSITIONEN, AUFTRAG_SPALTEN, POSITION_SPALTEN, POSITION_OPTIONAL, AUFTRAG_OPTIONAL, pruefePositionen } from '../utils/auftraege.js';
import { TAB_AUFGABEN, AUFGABE_SPALTEN } from '../utils/aufgaben.js';
import { legeAuftragAn, leseAuftraege, setzeDruckmasseHand, _auftraegeCacheLeeren } from '../lib/auftraege.js';
import { merkeDruckmasse, legeDruckmassAn, leseDruckmasse } from '../lib/druckmasse.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { _lieferbarkeitCacheLeeren } from '../lib/lieferbarkeitLesen.js';

// Erfundene Preise: Bogen 57 x 50 cm = 0,285 m² zu 28,50 € -> 100 €/m² brutto, Verschnitt 15 %.
const CONFIG = { 'dtf.breite_cm': 57, 'dtf.bogen_laenge_cm': 50, 'dtf.preis_je_bogen_brutto': '28,50', 'dtf.preis_je_bogen_express_brutto': 57, 'dtf.verschnitt_prozent': 15 };
const preise = dk.dtfPreise(CONFIG);
const stueckCent = cm2 => Math.round((cm2 / 10000) * 10000 * 1.15 * 100 / 119 * 100) / 100;   // 100 €/m² = 10000 Cent

describe('Gründe statt still nichts (je Position ein Satz)', () => {
  const masse = [{ Druckmass_ID: 'DM-0001', Bezug: 'Anker', Position: 'Rücken', Groesse: 'L', Breite_cm: 30, Hoehe_cm: '', Fuehrend: 'Breite', Aktiv: 'ja' }];
  test.each([
    [{ druck: 'Stick', motiv: 'Anker', groesse: 'L' }, 'kein_dtf', /Druckart ist nicht DTF/],
    [{ motiv: 'Anker', groesse: 'M' }, 'ohne_mass', /^Maß fehlt für Größe M/],
    [{ motiv: '', groesse: 'M' }, 'ohne_mass', /Motiv leer/],
    [{ motiv: 'Anker', groesse: 'L' }, 'seite_fehlt', /^Höhe fehlt für Rücken, Größe L \(führende Seite Breite\)$/],
    [{ motiv: 'x', groesse: 'L', hand: 'Rücken ?x31 H' }, 'seite_fehlt', /^Breite fehlt für Rücken, Größe L \(führende Seite Höhe\)$/],
    [{ motiv: 'x', groesse: 'L', hand: 'Ruecken L boardgame club 29x32' }, 'zuordnen', /bitte zuordnen/],
  ])('%o -> %s', (p, status, text) => {
    const d = dk.positionDruck({ menge: 1, ...p }, { masse, preise });
    expect(d.status).toBe(status);
    expect(d.text).toMatch(text);
    expect(d.netto).toBeUndefined();
  });
  test('Preis fehlt (auch Express getrennt)', () => {
    const p = { motiv: 'x', groesse: 'L', hand: 'Brust 10x10', menge: 1 };
    expect(dk.positionDruck(p, { preise: dk.dtfPreise({}) }).text).toBe('Preis fehlt (Einstellungen)');
    expect(dk.positionDruck(p, { preise: dk.dtfPreise({ ...CONFIG, 'dtf.preis_je_bogen_express_brutto': '' }), express: true }).text).toBe('Preis fehlt (Einstellungen, Express)');
  });
  test('Summen zählen die neuen Gründe als offen', () => {
    const s = dk.druckSummen([{ status: 'seite_fehlt' }, { status: 'zuordnen' }], { rohertrag: 100, umsatzMitEk: 200, positionen: [{ netto: 1, ek: 1 }, { netto: 1, ek: 1 }] });
    expect(s).toMatchObject({ offen: 2, seiteFehlt: 1, zuordnen: 1, rohertragNachDruck: 100 });
  });
});

describe('Führende Seite', () => {
  test('Eingabe: führende Seite Pflicht, die andere darf fehlen; Text mit H am Ende, ohne = Breite', () => {
    expect(dk.handText([{ position: 'Rücken', breite: 28, hoehe: '31', fuehrend: 'Hoehe' }, { position: 'brust', breite: '11', hoehe: '12,5' }]))
      .toBe('Rücken 28x31 H; Brust 11x12,5');
    expect(dk.handText([{ position: 'Rücken', breite: 28, hoehe: '' }])).toBe('Rücken 28x?');
    expect(() => dk.handText([{ position: 'Rücken', breite: '', hoehe: 31 }])).toThrow(/Breite fehlt \(führende Seite\)/);
    expect(() => dk.handText([{ position: 'Rücken', breite: 28, hoehe: '', fuehrend: 'Hoehe' }])).toThrow(/Höhe fehlt \(führende Seite\)/);
    expect(dk.handTeile('Rücken 28x31 H; Brust 11x12,5')).toEqual([
      { position: 'Rücken', breite: 28, hoehe: 31, fuehrend: 'Hoehe', zuordnen: false },
      { position: 'Brust', breite: 11, hoehe: 12.5, fuehrend: 'Breite', zuordnen: false }]);
  });
  test('Position nur aus der Liste, nicht doppelt (kein Freitext für Position/Größe)', () => {
    expect(() => dk.handText([{ position: 'Rücken L Motiv', breite: 1, hoehe: 1 }])).toThrow(/aus der Liste/);
    expect(() => dk.handText([{ position: 'Brust', breite: 1, hoehe: 1 }, { position: 'brust', breite: 2, hoehe: 2 }])).toThrow(/doppelt/);
    expect(dk.positionAusListe('aermel LINKS')).toBe('Ärmel links');
  });
  test('Tabelle: Fuehrend leer = Breite (nur so gelesen), Modell genau vor alle Modelle, fremdes Modell nie', () => {
    const z = [
      { Druckmass_ID: 'DM-0001', Bezug: 'Anker', Position: 'Rücken', Groesse: 'alle', Breite_cm: 30, Hoehe_cm: 20, Aktiv: 'ja' },
      { Druckmass_ID: 'DM-0002', Bezug: 'Anker', Position: 'Rücken', Groesse: 'alle', Breite_cm: 25, Hoehe_cm: 20, Fuehrend: 'Hoehe', Modell: 'X1', Aktiv: 'ja' },
      { Druckmass_ID: 'DM-0003', Bezug: 'Anker', Position: 'Brust', Groesse: 'alle', Breite_cm: 9, Hoehe_cm: 9, Modell: 'Y9', Aktiv: 'ja' },
    ];
    expect(dk.masseFuer(z, 'Anker', 'M', '')).toEqual([{ id: 'DM-0001', position: 'Rücken', breite: 30, hoehe: 20, fuehrend: 'Breite', groesse: 'alle', modell: '' }]);
    expect(dk.masseFuer(z, 'Anker', 'M', 'X1').map(x => [x.id, x.fuehrend])).toEqual([['DM-0002', 'Hoehe']]);
    expect(dk.druckmassEingabe({ bezug: 'Anker', position: 'Rücken', breite: 30, hoehe: '' })).toMatchObject({ Breite_cm: 30, Hoehe_cm: '', Fuehrend: 'Breite' });
    expect(() => dk.druckmassEingabe({ bezug: 'Anker', position: 'Hosentasche', breite: 3, hoehe: 3 })).toThrow(/aus der Liste/);
    expect(dk.druckmassEingabe({ bezug: 'Anker', position: 'Hosentasche', positionAlt: 'Hosentasche', breite: 3, hoehe: 3 }).Position).toBe('Hosentasche');
  });
});

describe('Alter Freitext (antwort-DK2-1 Punkt 5)', () => {
  const alt = 'Ruecken L Motiv A 29x32; ruecken M Motiv A 28x31; Brust M Motiv A 11x12.5; Brust L Motiv A 11.3x12.8';
  test('wird nie umgedeutet, nur vorgeschlagen', () => {
    expect(dk.handTeile(alt).every(x => x.zuordnen)).toBe(true);
    expect(dk.zuordnenVorschlag(alt).map(v => [v.position, v.groesse])).toEqual([['Rücken', 'L'], ['Rücken', 'M'], ['Brust', 'M'], ['Brust', 'L']]);
    expect(dk.handTextAusZelle(alt)).toBe('');   // "Wie letztes Mal" nimmt ihn nicht mit
    expect(dk.handTextAusZelle('Rücken 28x31 H')).toBe('Rücken 28x31 H');
  });
});

// ── Auftrag mit zwei Größen (Attrappe) ───────────────────────────────────────
const NR_M = '9000000120', NR_L = '9000000130';
const JETZT = '2026-11-24T10:00:00.000Z';
const jetzt = () => new Date(JETZT);
const kundeOk = async () => {};
function tabs({ fuehrendSpalte = true } = {}) {
  const AS = [...AUFTRAG_SPALTEN, ...AUFTRAG_OPTIONAL], PS = [...POSITION_SPALTEN, ...POSITION_OPTIONAL];
  const LS = (nr, size) => [nr, 'X3000', 'Black', '', size, '', '', 'Erfunden', '', '0', 'aktiv', 'Muster-Jacke', 4, '01.11.2026'];
  return {
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Brand', 'CatNrManufacturer', 'Discontinued', 'Status', 'Description', '10CartonsPrice', 'Quelle_Datum'],
      LS(NR_M, 'M'), LS(NR_L, 'L')],
    [TAB_AUFTRAEGE]: [AS], [TAB_POSITIONEN]: [PS], [TAB_AUFGABEN]: [AUFGABE_SPALTEN],
    Druckmasse: [fuehrendSpalte ? [...dk.DRUCKMASSE_SPALTEN, ...dk.DRUCKMASSE_OPTIONAL] : dk.DRUCKMASSE_SPALTEN],
    Config: [['Schlüssel', 'Wert', 'Anbieter'], ...Object.entries(CONFIG).map(([k, v]) => [k, v, ''])],
  };
}
const auftrag = (extra = {}) => ({
  Kunden_Nr: 'K-00001', Kurztitel: 'Jacken', vorgang: 'vorgang-dk2-0001',
  positionen: [
    { art: 'lshop', articleNr: NR_M, menge: 1, motiv: 'Motiv A', preis: '30', ...extra.m },
    { art: 'lshop', articleNr: NR_L, menge: 1, motiv: 'Motiv A', preis: '30', ...extra.l },
  ],
});
const druckJe = async sheets => {
  const a = (await leseAuftraege({ sheets, jetzt, autoBestellen: false })).auftraege[0];
  return { a, d: Object.fromEntries(a.positionen.map((p, i) => [p.lshop.groesse, a.preise.druck.positionen[i]])) };
};

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot-test';
  process.env.BUSINESS_SHEET_ID = 'business-test';
  _auftraegeCacheLeeren(); _resetLShopCache(); _lieferbarkeitCacheLeeren();
});

describe('Rechnung je Größenzeile', () => {
  test('zwei Größen mit verschiedenen Maßen: je Zeile nur ihre Maße, keine Doppelzählung; nach dem Speichern sofort sichtbar', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await legeAuftragAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: auftrag() });
    let { a, d } = await druckJe(sheets);
    expect(d.M).toMatchObject({ status: 'ohne_mass', text: expect.stringMatching(/Größe M/) });
    const [m, l] = a.positionen;
    await setzeDruckmasseHand({ sheets, eingabe: { auftragNr: a.Auftrag_Nr, positionIds: [m.Position_ID], teile: [{ position: 'Brust', breite: 11, hoehe: 12.5 }, { position: 'Rücken', breite: 28, hoehe: 31, fuehrend: 'Hoehe' }] } });
    await setzeDruckmasseHand({ sheets, eingabe: { auftragNr: a.Auftrag_Nr, positionIds: [l.Position_ID], teile: [{ position: 'Brust', breite: 11.3, hoehe: 12.8 }, { position: 'Rücken', breite: 29, hoehe: 32 }] } });
    ({ a, d } = await druckJe(sheets));   // ohne Cache-Leeren: der Schreibweg leert ihn selbst
    expect(d.M).toMatchObject({ status: 'ok', quelle: 'hand', flaeche: 11 * 12.5 + 28 * 31 });
    expect(d.L).toMatchObject({ status: 'ok', quelle: 'hand', flaeche: 1072.64 });
    expect(d.M.teile.find(x => x.position === 'Rücken').fuehrend).toBe('Hoehe');
    expect(d.M.stueck).toBe(stueckCent(d.M.flaeche));
    expect(a.preise.druck.gesamt).toBe(d.M.netto + d.L.netto);
    expect(a.Druckmasse_Hand).toBeUndefined();
    expect(a.positionen[0].Druckmasse_Hand).toBe('Brust 11x12,5; Rücken 28x31 H');
  });
  test('alter Freitext in beiden Zeilen: "bitte zuordnen", keine Kosten', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await legeAuftragAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: auftrag() });
    const iH = t[TAB_POSITIONEN][0].indexOf('Druckmasse_Hand');
    t[TAB_POSITIONEN][1][iH] = t[TAB_POSITIONEN][2][iH] = 'Ruecken L Motiv A 29x32; ruecken M Motiv A 28x31';
    _auftraegeCacheLeeren();
    const { a, d } = await druckJe(sheets);
    expect([d.M.status, d.L.status]).toEqual(['zuordnen', 'zuordnen']);
    expect(a.preise.druck).toMatchObject({ gesamt: 0, zuordnen: 2 });
  });
});

describe('Merken -> sofort rechnen, Maß-Sets', () => {
  test('gemerkt für Motiv + Größe: der Auftrag rechnet sofort mit dem Set (dieselbe Quelle)', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await legeAuftragAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: auftrag() });
    await druckJe(sheets);   // Zwischenspeicher gefuellt
    const r = await merkeDruckmasse({ sheets, jetzt, eingabe: { bezug: 'Motiv A', groesse: 'L', teile: [{ position: 'Rücken', breite: 29, hoehe: 32, fuehrend: 'Hoehe' }] } });
    expect(r).toMatchObject({ neu: 1 });
    const kopf = t.Druckmasse[0];
    expect(t.Druckmasse[1][kopf.indexOf('Groesse')]).toBe('L');
    expect(t.Druckmasse[1][kopf.indexOf('Fuehrend')]).toBe('Hoehe');
    const { d } = await druckJe(sheets);
    expect(d.L).toMatchObject({ status: 'ok', quelle: 'tabelle', flaeche: 29 * 32 });
    expect(d.M.status).toBe('ohne_mass');   // nur die Größe L
    const sets = (await leseDruckmasse({ sheets })).sets;
    expect(sets).toEqual([{ bezug: 'Motiv A', groesse: 'L', modell: '', teile: [{ position: 'Rücken', breite: 29, hoehe: 32, fuehrend: 'Hoehe' }] }]);
  });
  test('ohne Spalte Fuehrend: Höhe führend bzw. Modell -> 409 einrichtung, Breite führend geht', async () => {
    const t = tabs({ fuehrendSpalte: false });
    const { sheets } = machSheets(t);
    await expect(legeDruckmassAn({ sheets, jetzt, eingabe: { bezug: 'A', position: 'Brust', breite: 5, hoehe: 5, fuehrend: 'Hoehe' } })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    await expect(legeDruckmassAn({ sheets, jetzt, eingabe: { bezug: 'A', position: 'Brust', breite: 5, hoehe: 5, modell: 'X1' } })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    await expect(legeDruckmassAn({ sheets, jetzt, eingabe: { bezug: 'A', position: 'Brust', breite: 5, hoehe: 5 } })).resolves.toMatchObject({ ok: true });
  });
});

describe('„Wie letztes Mal“', () => {
  test('neue Positionen übernehmen die Maße von Hand (nur zugeordnete)', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await legeAuftragAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: auftrag({ m: { druckmasseHand: 'Rücken 28x31 H' }, l: { druckmasseHand: 'Ruecken L alt 29x32' } }) });
    const iH = t[TAB_POSITIONEN][0].indexOf('Druckmasse_Hand');
    expect([t[TAB_POSITIONEN][1][iH], t[TAB_POSITIONEN][2][iH]]).toEqual(['Rücken 28x31 H', '']);
  });
  test('bestehende Positionen (Bearbeiten) bekommen nie Maße über diesen Weg', () => {
    const [p] = pruefePositionen([{ positionId: 'AU-2026-0001-01', art: 'frei', freitext: 'Tasse', menge: 1, druckmasseHand: 'Brust 5x5' }], { waehlbar: new Set() });
    expect(p.Druckmasse_Hand).toBeUndefined();
  });
});
