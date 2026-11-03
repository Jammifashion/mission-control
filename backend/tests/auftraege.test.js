// AM-2: Auftraege erfassen - Logik (utils/auftraege.js) und Schreibwege (lib/auftraege.js). Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import {
  TAB_AUFTRAEGE, TAB_POSITIONEN, AUFTRAG_SPALTEN, POSITION_SPALTEN, naechsteAuftragNr, naechstePositionId, statusWechsel,
  anlagePlan, bearbeitenPlan, fertigPlan, auftragZahlen, terminBald, pruefePositionen, zeilenAus,
} from '../utils/auftraege.js';
import {
  legeAuftragAn, bearbeiteAuftrag, wechsleStatus, setzePositionFertig, leseAuftraege, _auftraegeCacheLeeren,
} from '../lib/auftraege.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { _lieferbarkeitCacheLeeren } from '../lib/lieferbarkeitLesen.js';

const hier = dirname(fileURLToPath(import.meta.url));
const JETZT = '2026-11-03T10:00:00.000Z';
const jetzt = () => new Date(JETZT);
const NR_S = '9000000110', NR_M = '9000000120', NR_AUS = '9000000199';
const kundeOk = async () => {};
const V = n => `vorgang-${String(n).padStart(6, '0')}`;

const az = o => AUFTRAG_SPALTEN.map(s => o[s] ?? '');
const pz = o => POSITION_SPALTEN.map(s => o[s] ?? '');
function tabs({ auftraege = [], positionen = [] } = {}) {
  const LS = (nr, size, status = 'aktiv') => [nr, 'X3000', 'Black', '', size, '', '', 'Erfunden', '', '0', status, 'Muster-Shirt'];
  return {
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Brand', 'CatNrManufacturer', 'Discontinued', 'Status', 'Description'],
      LS(NR_S, 'S'), LS(NR_M, 'M'), LS(NR_AUS, 'XL', 'ausgelaufen')],
    [TAB_AUFTRAEGE]: [AUFTRAG_SPALTEN, ...auftraege.map(az)],
    [TAB_POSITIONEN]: [POSITION_SPALTEN, ...positionen.map(pz)],
  };
}
const eingabe = (extra = {}) => ({
  Kunden_Nr: 'K-00001', Kurztitel: 'Polos Saison 27', Kanal: 'Mail', Termin: '2026-11-08', Notiz: '', status: 'Anfrage', vorgang: V(1),
  positionen: [
    { art: 'lshop', articleNr: NR_S, menge: 3, motiv: 'Wappen vorne', druck: 'Brust links DTF' },
    { art: 'lshop', articleNr: NR_M, menge: 5, motiv: 'Wappen vorne', druck: 'Brust links DTF' },
    { art: 'frei', freitext: 'Tassen', menge: 10 },
  ],
  ...extra,
});

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot-test';
  _auftraegeCacheLeeren(); _resetLShopCache(); _lieferbarkeitCacheLeeren();
});

describe('Nummern und Status', () => {
  test('AU-JJJJ-NNNN je Jahr, Positionen -NN', () => {
    expect(naechsteAuftragNr([{ Auftrag_Nr: 'AU-2026-0007' }, { Auftrag_Nr: 'AU-2025-0099' }], '2026')).toBe('AU-2026-0008');
    expect(naechsteAuftragNr([], '2027')).toBe('AU-2027-0001');
    expect(naechstePositionId([{ Auftrag_Nr: 'AU-2026-0001', Position_ID: 'AU-2026-0001-03' }], 'AU-2026-0001', 1)).toBe('AU-2026-0001-05');
  });
  const a = (status, extra = {}) => ({ Auftrag_Nr: 'AU-2026-0001', Status: status, ...extra });
  test('weiter setzt Datum, zurueck leert es; nur ein Schritt', () => {
    expect(statusWechsel(a('Angebot'), 'weiter', JETZT)).toEqual({ Status: 'bestellt', Bestellt_Am: '2026-11-03' });
    expect(statusWechsel(a('bestellt', { Bestellt_Am: '2026-11-01' }), 'zurueck', JETZT)).toEqual({ Status: 'Angebot', Bestellt_Am: '' });
    expect(() => statusWechsel(a('Anfrage'), 'zurueck', JETZT)).toThrow();
    expect(() => statusWechsel(a('bezahlt'), 'weiter', JETZT)).toThrow();
  });
  test('bezahlt unabhaengig (Vorkasse); bei uebergeben wird der Auftrag bezahlt; zuruecknehmen', () => {
    expect(statusWechsel(a('Angebot'), 'bezahlt', JETZT)).toEqual({ Bezahlt_Am: '2026-11-03' });
    expect(statusWechsel(a('übergeben'), 'bezahlt', JETZT)).toEqual({ Bezahlt_Am: '2026-11-03', Status: 'bezahlt' });
    expect(statusWechsel(a('übergeben', { Bezahlt_Am: '2026-10-01' }), 'weiter', JETZT)).toEqual({ Status: 'bezahlt', Bezahlt_Am: '2026-10-01' });
    expect(statusWechsel(a('bezahlt', { Bezahlt_Am: 'x' }), 'bezahlt_zurueck', JETZT)).toEqual({ Bezahlt_Am: '', Status: 'übergeben' });
  });
  test('stornieren und zuruecknehmen (letzter Schritt mit Datum); bezahlt nicht stornierbar', () => {
    expect(statusWechsel(a('in Produktion'), 'stornieren', JETZT)).toEqual({ Status: 'storniert', Storniert_Am: '2026-11-03' });
    expect(statusWechsel(a('storniert', { Anfrage_Am: '1', Angebot_Am: '2', Bestellt_Am: '3' }), 'storno_zurueck', JETZT)).toEqual({ Status: 'bestellt', Storniert_Am: '' });
    expect(() => statusWechsel(a('bezahlt'), 'stornieren', JETZT)).toThrow();
    expect(() => statusWechsel(a('storniert'), 'weiter', JETZT)).toThrow(/storniert/);
  });
});

describe('Positionen, Anlage, Bearbeiten', () => {
  test('Positionen: L-Shop nur waehlbare Nummer, frei mit Text, Menge 1-9999; Fehlertext ohne Werte', () => {
    const w = new Set([NR_S]);
    expect(pruefePositionen([{ art: 'frei', freitext: 'Tassen', menge: 2 }], { waehlbar: w })[0]).toMatchObject({ Art: 'frei', Freitext: 'Tassen', Menge: '2' });
    expect(() => pruefePositionen([{ art: 'lshop', articleNr: NR_AUS, menge: 1 }], { waehlbar: w })).toThrow(/nicht \(mehr\) bestellbar/);
    expect(() => pruefePositionen([{ art: 'frei', freitext: '', menge: 1 }], { waehlbar: w })).toThrow(/Freitext fehlt/);
    expect(() => pruefePositionen([{ art: 'frei', freitext: 'x', menge: 0 }], { waehlbar: w })).toThrow(/Menge/);
    expect(() => pruefePositionen([], { waehlbar: w })).toThrow(/Mindestens/);
  });
  test('Anlage: Status Anfrage/Angebot mit Datum, Nummern, keine Preise', () => {
    const p = anlagePlan({ auftraege: [], positionen: [], eingabe: eingabe({ status: 'Angebot' }), waehlbar: new Set([NR_S, NR_M]), jetzt: JETZT });
    expect(p.auftrag).toMatchObject({ Auftrag_Nr: 'AU-2026-0001', Status: 'Angebot', Anfrage_Am: '2026-11-03', Angebot_Am: '2026-11-03', Kunden_Nr: 'K-00001' });
    expect(p.positionen.map(x => x.Position_ID)).toEqual(['AU-2026-0001-01', 'AU-2026-0001-02', 'AU-2026-0001-03']);
    expect(AUFTRAG_SPALTEN.join(' ') + POSITION_SPALTEN.join(' ')).not.toMatch(/Preis|Betrag|EK|Summe/);
    expect(() => anlagePlan({ auftraege: [], positionen: [], eingabe: eingabe({ status: 'bestellt' }), waehlbar: new Set([NR_S, NR_M]), jetzt: JETZT })).toThrow();
  });
  test('Bearbeiten-Sperre ab bestellt: Positionen 409, Notiz/Termin gehen, Kurztitel bleibt', () => {
    const auftrag = { Auftrag_Nr: 'AU-2026-0001', Status: 'bestellt', Kurztitel: 'Alt', Notiz: '', Termin: '' };
    expect(() => bearbeitenPlan({ auftrag, positionen: [], eingabe: { positionen: [] }, jetzt: JETZT })).toThrow(/gesperrt/);
    const p = bearbeitenPlan({ auftrag, positionen: [], eingabe: { Notiz: 'neu', Termin: '2026-12-01', Kurztitel: 'Anders' }, jetzt: JETZT });
    expect(p.aenderungAuftrag).toEqual({ Notiz: 'neu', Termin: '2026-12-01', Stand: JETZT });
  });
  test('Bearbeiten frei: aendern, neu, fehlende als entfernt (nie loeschen)', () => {
    const auftrag = { Auftrag_Nr: 'AU-2026-0001', Status: 'Anfrage', Kurztitel: 'T', Kunden_Nr: 'K-00001' };
    const positionen = [
      { Position_ID: 'AU-2026-0001-01', Auftrag_Nr: 'AU-2026-0001', Art: 'lshop', LShop_ArticleNr: NR_AUS, Menge: '2', _zeile: 2 },
      { Position_ID: 'AU-2026-0001-02', Auftrag_Nr: 'AU-2026-0001', Art: 'frei', Freitext: 'Tassen', Menge: '1', _zeile: 3 },
    ];
    const p = bearbeitenPlan({ auftrag, positionen, jetzt: JETZT, waehlbar: new Set([NR_S]), eingabe: { positionen: [
      { positionId: 'AU-2026-0001-01', art: 'lshop', articleNr: NR_AUS, menge: 4 },   // bisherige ausgelaufene Nummer bleibt erlaubt
      { art: 'lshop', articleNr: NR_S, menge: 1 },
    ] } });
    expect(p.aenderungPositionen).toEqual([
      { zeile: 2, positionId: 'AU-2026-0001-01', felder: { Menge: '4', Stand: JETZT } },
      { zeile: 3, positionId: 'AU-2026-0001-02', felder: { Entfernt: '2026-11-03', Stand: JETZT } },
    ]);
    expect(p.neuePositionen[0].Position_ID).toBe('AU-2026-0001-03');
  });
  test('fertig-Vorschlag erst, wenn alle aktiven Positionen fertig sind', () => {
    const auftrag = { Auftrag_Nr: 'AU-2026-0001', Status: 'in Produktion' };
    const positionen = [
      { Position_ID: 'AU-2026-0001-01', Auftrag_Nr: 'AU-2026-0001', Fertig: 'ja' },
      { Position_ID: 'AU-2026-0001-02', Auftrag_Nr: 'AU-2026-0001', Fertig: '' },
      { Position_ID: 'AU-2026-0001-03', Auftrag_Nr: 'AU-2026-0001', Fertig: '', Entfernt: '2026-11-01' },
    ];
    const p = fertigPlan({ auftrag, positionen, positionId: 'AU-2026-0001-02', fertig: true, jetzt: JETZT });
    expect(p.felder).toEqual({ Fertig: 'ja', Fertig_Am: '2026-11-03', Stand: JETZT });
    expect(p.vorschlagFertig).toBe(true);
    expect(fertigPlan({ auftrag: { ...auftrag, Status: 'fertig' }, positionen, positionId: 'AU-2026-0001-02', fertig: true, jetzt: JETZT }).vorschlagFertig).toBe(false);
  });
});

describe('Filter und Zahlen', () => {
  const liste = [
    { Auftrag_Nr: '1', Status: 'Anfrage', Termin: '2026-11-08' },     // in 5 Tagen
    { Auftrag_Nr: '2', Status: 'bestellt', Termin: '2026-11-01' },    // ueberfaellig
    { Auftrag_Nr: '3', Status: 'fertig', Termin: '2026-12-24' },
    { Auftrag_Nr: '4', Status: 'übergeben', Bezahlt_Am: '' },
    { Auftrag_Nr: '5', Status: 'bezahlt', Bezahlt_Am: '2026-10-01', Termin: '2026-11-04' },
    { Auftrag_Nr: '6', Status: 'storniert', Termin: '2026-11-04' },
  ];
  test('Termin in <= 7 Tagen: nur offene, auch ueberfaellige', () => {
    expect(liste.filter(a => terminBald(a, JETZT)).map(a => a.Auftrag_Nr)).toEqual(['1', '2']);
  });
  test('Kachel-Zahlen: offen, Termin bald, fertig nicht bezahlt', () => {
    expect(auftragZahlen(liste, JETZT)).toEqual({ offen: 4, terminBald: 2, fertigNichtBezahlt: 2 });
  });
});

describe('Schreibwege (ein batchUpdate, kein append, zurueckgelesen)', () => {
  test('Anlegen: Auftrag + Positionen in einem Aufruf; Doppelklick (gleicher Vorgang) legt nichts doppelt an', async () => {
    const t = tabs();
    const { sheets, aufrufe } = machSheets(t);
    const r = await legeAuftragAn({ eingabe: eingabe(), sheets, jetzt, kundePruefen: kundeOk });
    expect(r).toMatchObject({ ok: true, schon: false, auftragNr: 'AU-2026-0001', positionen: 3 });
    expect(aufrufe.append).toBe(0);
    expect(aufrufe.update).toEqual([]);
    expect(t[TAB_AUFTRAEGE]).toHaveLength(2);
    expect(t[TAB_POSITIONEN]).toHaveLength(4);
    const zwei = await legeAuftragAn({ eingabe: eingabe(), sheets, jetzt, kundePruefen: kundeOk });
    expect(zwei).toMatchObject({ schon: true, auftragNr: 'AU-2026-0001' });
    expect(t[TAB_AUFTRAEGE]).toHaveLength(2);
  });
  test('alles oder nichts: ungueltige Position -> nichts geschrieben', async () => {
    const t = tabs();
    const { sheets, aufrufe } = machSheets(t);
    await expect(legeAuftragAn({ eingabe: eingabe({ positionen: [{ art: 'lshop', articleNr: NR_S, menge: 1 }, { art: 'lshop', articleNr: NR_AUS, menge: 1 }] }), sheets, jetzt, kundePruefen: kundeOk }))
      .rejects.toMatchObject({ status: 422 });
    expect(aufrufe.batchUpdate).toEqual([]);
    expect(t[TAB_AUFTRAEGE]).toHaveLength(1);
    expect(t[TAB_POSITIONEN]).toHaveLength(1);
  });
  test('Status, Stand-Pruefung, Haken fertig, Bearbeiten-Sperre, Lesen mit L-Shop-Anzeige', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await legeAuftragAn({ eingabe: eingabe(), sheets, jetzt, kundePruefen: kundeOk });
    let a = (await leseAuftraege({ sheets, jetzt })).auftraege[0];
    expect(a.stueck).toBe(18);
    expect(a.positionen[0].lshop).toMatchObject({ modell: 'X3000', farbe: 'Black', groesse: 'S', bestellbar: true });
    await expect(wechsleStatus({ eingabe: { auftragNr: a.Auftrag_Nr, stand: 'alt', aktion: 'weiter' }, sheets, jetzt })).rejects.toMatchObject({ status: 409, code: 'konflikt' });
    for (const _ of [1, 2]) {   // Anfrage -> Angebot -> bestellt
      a = (await leseAuftraege({ sheets, jetzt })).auftraege[0];
      await wechsleStatus({ eingabe: { auftragNr: a.Auftrag_Nr, stand: a.Stand, aktion: 'weiter' }, sheets, jetzt: () => new Date(Date.parse(JETZT) + _ * 1000) });
    }
    a = (await leseAuftraege({ sheets, jetzt })).auftraege[0];
    expect(a).toMatchObject({ Status: 'bestellt', Bestellt_Am: '2026-11-03' });
    await expect(bearbeiteAuftrag({ eingabe: { auftragNr: a.Auftrag_Nr, stand: a.Stand, positionen: [] }, sheets, jetzt, kundePruefen: kundeOk })).rejects.toMatchObject({ status: 409, code: 'gesperrt' });
    for (const p of a.positionen) await setzePositionFertig({ eingabe: { auftragNr: a.Auftrag_Nr, positionId: p.Position_ID, fertig: true }, sheets, jetzt });
    a = (await leseAuftraege({ sheets, jetzt })).auftraege[0];
    expect(a.vorschlagFertig).toBe(true);
    expect(a.Status).toBe('bestellt');   // der Mensch bestaetigt
  });
  test('Doppelklick beim Haken: zweimal gleich = einmal geschrieben', async () => {
    const t = tabs();
    const { sheets, aufrufe } = machSheets(t);
    await legeAuftragAn({ eingabe: eingabe(), sheets, jetzt, kundePruefen: kundeOk });
    const vorher = aufrufe.batchUpdate.length;
    const e = { auftragNr: 'AU-2026-0001', positionId: 'AU-2026-0001-01', fertig: true };
    await setzePositionFertig({ eingabe: e, sheets, jetzt });
    const r = await setzePositionFertig({ eingabe: e, sheets, jetzt });
    expect(r.unveraendert).toBe(true);
    expect(aufrufe.batchUpdate.length - vorher).toBe(3);   // Fertig, Fertig_Am, Stand - nur einmal
  });
  test('Reiter fehlen -> 409 einrichtung', async () => {
    const { sheets } = machSheets({ LShop_Modelle: [['ArticleNr']] });
    await expect(leseAuftraege({ sheets })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
  });
});

describe('Datenschutz', () => {
  test('Reiter ohne Personenfelder; Route loggt nur Nummern/Status', () => {
    expect([...AUFTRAG_SPALTEN, ...POSITION_SPALTEN].join(' ')).not.toMatch(/Name|Mail|Telefon|Adresse|Strasse/);
    const route = readFileSync(resolve(hier, '../routes/auftraege.js'), 'utf8');
    for (const z of route.split('\n').filter(l => l.includes('console.'))) expect(z).not.toMatch(/Kurztitel|Notiz|Motiv|req\.body/);
    const lib = readFileSync(resolve(hier, '../lib/auftraege.js'), 'utf8');
    expect(lib.split('\n').filter(l => l.includes('console.'))).toEqual([]);
    const code = lib.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    expect(code).not.toMatch(/values\.append|legeEigenePositionenAn|Warenkorb_LShop/);   // kein Korb in AM-2
  });
  test('Fehlertext ohne Kundenname', () => {
    let e; try { anlagePlan({ auftraege: [], positionen: [], eingabe: eingabe({ Kurztitel: '' }), waehlbar: new Set([NR_S, NR_M]), jetzt: JETZT }); } catch (x) { e = x; }
    expect(e.message).toBe('Kurztitel fehlt.');
    expect(zeilenAus([AUFTRAG_SPALTEN], AUFTRAG_SPALTEN, 'Auftrag_Nr').fehlt).toEqual([]);
  });
});

// AM-2-2: Herkunft je Position (bestellen · lager · vorhanden), optionale Spalten, kein Lager-Schreiben
describe('Herkunft (AM-2-2)', () => {
  let L;
  beforeAll(async () => { L = await import('../utils/lager.js'); });
  const mitHerkunft = t => ({ ...t, [TAB_POSITIONEN]: [[...POSITION_SPALTEN, 'Herkunft', 'Lager_Ort']],
    [L.TAB_BUCHUNGEN]: [L.BUCHUNG_SPALTEN], [L.TAB_ARTIKEL]: [L.ARTIKEL_SPALTEN], [L.TAB_ORTE]: [L.ORTE_SPALTEN, ['Wrist', 'aktiv', ''], ['Alt', 'inaktiv', '']] });
  const pos = (herkunft, extra = {}) => ({ art: 'lshop', articleNr: NR_S, menge: 2, herkunft, ...extra });
  test('Spalten fehlen: bestellen geht wie bisher, lager/vorhanden -> 409 einrichtung, nichts geschrieben', async () => {
    const t = tabs();
    const { sheets, aufrufe } = machSheets(t);
    await legeAuftragAn({ eingabe: eingabe({ positionen: [pos('bestellen')] }), sheets, jetzt, kundePruefen: kundeOk });
    const r = await leseAuftraege({ sheets, jetzt });
    expect(r.auftraege[0].positionen[0].Herkunft).toBe('bestellen');   // leer = bestellen
    const vorher = aufrufe.batchUpdate.length;
    await expect(legeAuftragAn({ eingabe: eingabe({ vorgang: V(2), positionen: [pos('vorhanden')] }), sheets, jetzt, kundePruefen: kundeOk }))
      .rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    expect(aufrufe.batchUpdate.length).toBe(vorher);
  });
  test('mit Spalten: Herkunft + Lagerort gespeichert; Ort muss aktiv sein; Lager wird nie beschrieben', async () => {
    const t = mitHerkunft(tabs());
    const { sheets, aufrufe } = machSheets(t);
    await expect(legeAuftragAn({ eingabe: eingabe({ positionen: [pos('lager', { lagerOrt: 'Alt' })] }), sheets, jetzt, kundePruefen: kundeOk }))
      .rejects.toThrow(/Lagerort gibt es nicht/);
    await expect(legeAuftragAn({ eingabe: eingabe({ positionen: [pos('lager')] }), sheets, jetzt, kundePruefen: kundeOk })).rejects.toThrow(/Lagerort fehlt/);
    await legeAuftragAn({ eingabe: eingabe({ positionen: [pos('lager', { lagerOrt: 'Wrist' }), pos('bestellen', { articleNr: NR_M }), { art: 'frei', freitext: 'Tassen', menge: 1, herkunft: 'vorhanden' }] }),
      sheets, jetzt, kundePruefen: kundeOk });
    const p = (await leseAuftraege({ sheets, jetzt })).auftraege[0].positionen;
    expect(p.map(x => [x.Herkunft, x.Lager_Ort])).toEqual([['lager', 'Wrist'], ['bestellen', ''], ['vorhanden', '']]);
    expect(t[L.TAB_BUCHUNGEN]).toHaveLength(1);   // nur Kopfzeile: nichts ausgebucht
    expect(aufrufe.batchUpdate.some(b => b.includes(L.TAB_BUCHUNGEN))).toBe(false);
  });
  test('Herkunft aendern und teilen beim Bearbeiten; frei nur leer/vorhanden', async () => {
    const t = mitHerkunft(tabs());
    const { sheets } = machSheets(t);
    await legeAuftragAn({ eingabe: eingabe({ positionen: [pos('lager', { lagerOrt: 'Wrist', menge: 5 })] }), sheets, jetzt, kundePruefen: kundeOk });
    let a = (await leseAuftraege({ sheets, jetzt })).auftraege[0];
    await bearbeiteAuftrag({ eingabe: { auftragNr: a.Auftrag_Nr, stand: a.Stand, positionen: [
      { positionId: a.positionen[0].Position_ID, ...pos('lager', { lagerOrt: 'Wrist', menge: 2 }) }, pos('bestellen', { menge: 3 }),
    ] }, sheets, jetzt: () => new Date(Date.parse(JETZT) + 1000), kundePruefen: kundeOk });
    a = (await leseAuftraege({ sheets, jetzt })).auftraege[0];
    expect(a.positionen.map(x => [x.Herkunft, x.Menge])).toEqual([['lager', '2'], ['bestellen', '3']]);
    expect(a.stueck).toBe(5);
    expect(() => pruefePositionen([{ art: 'frei', freitext: 'x', menge: 1, herkunft: 'lager' }], { waehlbar: new Set() })).toThrow(/nur leer oder vorhanden/);
  });
  test('Quelltext: der Auftrag liest das Lager nur (leseLager), bucht nie', () => {
    const lib = readFileSync(resolve(hier, '../lib/auftraege.js'), 'utf8');
    expect(lib).toMatch(/import \{ leseLager \} from '\.\/lager\.js'/);
    expect(lib).not.toMatch(/bucheLager|gegenbuchung|mitLagerSperre/);
  });
});
