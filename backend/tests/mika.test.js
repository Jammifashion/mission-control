// MI1: Assistent "Mika" Stufe 0 - Regeln "heute"/"dringend" (feste Uhr, Europe/Berlin), Suche, Logzeile, Route.
// Nur erfundene Daten (Namen, Nummern). Kein Netz: Lader, Shop und Sheets sind Attrappen.
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { sheetsAttrappe } from './hilfen/sheets-attrappe.js';

// Lesungen zaehlen: Sheets + Drive als Attrappe, Shop-Client als Attrappe
const TABS = { LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage']] };   // sonst scheitert der L-Shop-Leser
const SHEETS = sheetsAttrappe(() => TABS);
const DRIVE = { files: { list: jest.fn(async () => ({ data: { files: [] } })), get: jest.fn(async () => ({ data: {} })) } };
const WC = { get: jest.fn(async () => ({ data: [] })) };
jest.unstable_mockModule('googleapis', () => ({ google: { sheets: () => SHEETS, drive: () => DRIVE } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}), googleAuthMitScopes: () => ({}) }));
jest.unstable_mockModule('../lib/shopConfig.js', () => ({ getWcClient: () => WC, normalizeShop: s => (s === 'honk' ? 'honk' : 'jfn') }));

const m = await import('../utils/mika.js');
const lib = await import('../lib/mika.js');
const { mikaHandler } = await import('../routes/mika.js');
const { leseDashboard, _dashboardCacheLeeren } = await import('../lib/dashboard.js');
const { _auftraegeCacheLeeren } = await import('../lib/auftraege.js');
const { _lshopBestellungenZuletztLeeren } = await import('../lib/lshopBestellungen.js');
const { HosterPruefseiteError } = await import('../lib/hosterPruefseite.js');

// Mittwoch, 18.11.2026, 23:30 Berlin (22:30 UTC) - Tag in Berlin = 18.11., in UTC auch; 00:30 Berlin am 19.11. = 23:30 UTC am 18.11.
const JETZT = new Date('2026-11-18T22:30:00Z');
const NACH_MITTERNACHT = new Date('2026-11-18T23:30:00Z');   // Berlin schon 19.11.

const au = (nr, x = {}) => ({ Auftrag_Nr: nr, Kurztitel: `Titel ${nr.slice(-2)}`, Kunden_Nr: 'K-00042', Status: 'bestellt', Termin: '', Zustaendig: '', positionen: [], ...x });
const ag = (nr, x = {}) => ({ Aufgabe_Nr: nr, Kurztitel: `Aufgabe ${nr.slice(-2)}`, Status: 'offen', Faellig: '', Zustaendig: '', ...x });
const todo = (bezug, text, faellig, x = {}) => ({ Todo_ID: `${bezug}-T01`, Bezug: bezug, Text: text, Faellig: faellig, Erledigt: '', ...x });
const AU = {
  auftraege: [
    au('AU-2026-0001', { Termin: '2026-11-18' }),                                  // heute
    au('AU-2026-0002', { Termin: '2026-11-19', Zustaendig: 'Nicole' }),            // morgen
    au('AU-2026-0003', { Termin: '2026-11-21' }),                                  // in 3 Tagen
    au('AU-2026-0004', { Termin: '2026-11-22' }),                                  // in 4 Tagen - nicht dringend
    au('AU-2026-0005', { Termin: '2026-11-15' }),                                  // 3 Tage ueberschritten
    au('AU-2026-0006', { Termin: '2026-11-18', Status: 'storniert' }),             // storniert - nie
    au('AU-2026-0007', { Status: 'fertig', Fertig_Am: '2026-11-10' }),
    au('AU-2026-0008', { Status: 'übergeben', Fertig_Am: '2026-11-01' }),
    au('AU-2026-0009', { Status: 'fertig', Bezahlt_Am: '2026-11-12' }),            // bezahlt-Datum -> nicht
  ],
  aufgaben: [ag('AG-2026-0001', { Faellig: '2026-11-17' }), ag('AG-2026-0002', { Faellig: '2026-11-18', Status: 'erledigt' }), ag('AG-2026-0003', { Faellig: '2026-11-25' })],
  todos: [
    todo('AU-2026-0001', 'Druckdatei an Erika Testfrau schicken', '2026-11-16'),
    todo('AU-2026-0002', 'Muster prüfen', '2026-11-18'),
    todo('AU-2026-0003', 'später', '2026-11-20'),
    todo('AU-2026-0006', 'gehört zu storniert', '2026-11-10'),
    todo('AU-2026-0001', 'schon erledigt', '2026-11-10', { Erledigt: 'ja' }),
  ],
};
const DASH = {
  shop: 'jfn', wer: '', fehler: [],
  kacheln: {
    hinweise: { zahl: 2 }, lange: { zahl: 3, liste: [
      { art: 'shop', shop: 'jfn', shopKurz: 'JFN', nr: '90015', id: 90015, kunde: 'Erika Testfrau', tage: 20, grund: ['Zahlung offen'] },
      { art: 'shop', shop: 'jfn', shopKurz: 'JFN', nr: '90016', id: 90016, kunde: 'Max Beispielmann', tage: 15, grund: [] },
      { art: 'shop', shop: 'jfn', shopKurz: 'JFN', nr: '90017', id: 90017, kunde: 'Max Beispielmann', tage: 14, grund: [] },   // genau 14 -> nicht
      { art: 'au', nr: 'AU-2026-0001', kunde: 'FC Erfunden 1899', tage: 30 },
    ] },
    todos: { ueberfaellig: 1, heute: 1 }, ware: { zahl: 0 }, abholung: { zahl: 1 }, rueckstand: { positionen: 0 }, trikots: { ueber6Wochen: 0, goalie: 0 }, bestellseiten: { zahl: 0 },
  },
};
const LSHOP = { bestellungen: [
  { orderId: 'JFN-2026-0012', wahrscheinlichDa: { liste: '2026-11-18', positionen: [{ schluessel: 'JFN:1:1' }, { schluessel: 'JFN:1:2' }] } },
  { orderId: 'JFN-2026-0013', wahrscheinlichDa: null },
] };
const NAMEN = ['Erika Testfrau', 'Max Beispielmann', 'FC Erfunden 1899'];
const json = x => JSON.stringify(x);

describe('heute', () => {
  const a = m.mikaHeute({ dash: DASH, au: AU, jetzt: JETZT });
  test('faellig: To-dos und Aufgaben ueberfaellig/heute, nur offene Bezuege, aelteste zuerst', () => {
    const g = a.gruppen.find(x => x.id === 'faellig');
    expect(g.eintraege.map(e => e.zusatz)).toEqual(['seit 2 Tagen überfällig', 'seit gestern überfällig', 'heute fällig']);
    expect(g.eintraege[0].ziel).toEqual({ art: 'au', nr: 'AU-2026-0001' });
    expect(g.eintraege[1]).toMatchObject({ text: 'Aufgabe AG-2026-0001 · Aufgabe 01', ziel: { art: 'ag', nr: 'AG-2026-0001' } });
    expect(json(g)).not.toContain('storniert');
  });
  test('Termin heute oder morgen, offen; storniert nie', () => {
    const g = a.gruppen.find(x => x.id === 'termin');
    expect(g.eintraege.map(e => [e.text, e.zusatz])).toEqual([['AU-2026-0001 · Titel 01', 'Termin heute · bestellt'], ['AU-2026-0002 · Titel 02', 'Termin morgen · bestellt']]);
  });
  test('Zu tun: nur Zahlen > 0, je mit Liste', () => {
    const g = a.gruppen.find(x => x.id === 'zutun');
    expect(g.eintraege.map(e => e.text)).toEqual(['2 Kundenhinweise ungelesen', '3 Bestellungen/Aufträge warten über 7 Tage', 'Ein To-do überfällig', 'Ein To-do heute fällig', 'Eine Abholung offen']);
    expect(g.eintraege.every(e => e.ziel.art === 'liste' && m.LISTEN.includes(e.ziel.liste))).toBe(true);
  });
  test('Europe/Berlin: nach Mitternacht Berlin ist "morgen" schon heute', () => {
    const b = m.mikaHeute({ au: AU, jetzt: NACH_MITTERNACHT });
    expect(b.gruppen.find(x => x.id === 'termin').eintraege.map(e => e.zusatz)).toEqual(['Termin heute · bestellt']);
  });
  test('Ansicht Nicole: nur ihre Auftraege/To-dos', () => {
    const b = m.mikaHeute({ au: AU, wer: 'Nicole', jetzt: JETZT });
    expect(b.gruppen.find(x => x.id === 'termin').eintraege.map(e => e.ziel.nr)).toEqual(['AU-2026-0002']);
    expect(b.gruppen.find(x => x.id === 'faellig').eintraege.map(e => e.ziel.nr)).toEqual(['AU-2026-0002']);
  });
  test('keine Kundennamen (Dashboard-Daten tragen sie)', () => {
    for (const n of NAMEN.slice(1)) expect(json(a)).not.toContain(n);
  });
  test('Vorlesen ohne Nummern', () => {
    expect(a.vorlesen.join(' ')).not.toMatch(/AU-|AG-|\d{5}/);
    expect(a.vorlesen[0]).toBe('Fällig: 2 überfällig, 1 heute.');
  });
  test('leer', () => {
    const b = m.mikaHeute({ dash: { kacheln: {}, fehler: [] }, au: { auftraege: [], aufgaben: [], todos: [] }, jetzt: JETZT });
    expect(b).toMatchObject({ gruppen: [], treffer: 0, leer: 'Heute liegt nichts an.', vorlesen: ['Heute liegt nichts an.'] });
    expect(b.unvollstaendig).toBeUndefined();
  });
});

describe('dringend', () => {
  const a = m.mikaDringend({ dash: DASH, au: AU, lshop: LSHOP, jetzt: JETZT });
  const g = id => a.gruppen.find(x => x.id === id);
  test('Bestellungen > 14 Tage (14 genau nicht), aelteste zuerst, ohne Namen, mit Sprung', () => {
    expect(g('alt').eintraege.map(e => e.text)).toEqual(['JFN #90015', 'JFN #90016']);
    expect(g('alt').eintraege[0]).toMatchObject({ zusatz: 'seit 20 Tagen offen · Zahlung offen', ziel: { art: 'shop', shop: 'jfn', id: '90015' } });
    for (const n of NAMEN) expect(json(a)).not.toContain(n);
  });
  test('Termin <= 3 Tage inkl. ueberschritten, 4 Tage nicht', () => {
    expect(g('termin').eintraege.map(e => [e.ziel.nr, e.zusatz])).toEqual([
      ['AU-2026-0005', 'Termin seit 3 Tagen überschritten · bestellt'], ['AU-2026-0001', 'Termin heute · bestellt'],
      ['AU-2026-0002', 'Termin morgen · bestellt'], ['AU-2026-0003', 'Termin in 3 Tagen · bestellt']]);
  });
  test('fertig/uebergeben nicht bezahlt', () => {
    expect(g('unbezahlt').eintraege.map(e => e.ziel.nr)).toEqual(['AU-2026-0008', 'AU-2026-0007']);
  });
  test('L-Shop wahrscheinlich da', () => {
    expect(g('da').eintraege).toEqual([{ text: 'L-Shop JFN-2026-0012', zusatz: '2 Positionen wahrscheinlich da – bitte prüfen', ziel: { art: 'lshop', orderId: 'JFN-2026-0012' } }]);
  });
  test('hoechstens 5 je Gruppe, "… und n weitere" mit Liste', () => {
    const viele = { kacheln: { lange: { liste: Array.from({ length: 8 }, (_, i) => ({ art: 'shop', shop: 'jfn', shopKurz: 'JFN', nr: String(91000 + i), id: 91000 + i, tage: 20 + i })) } }, fehler: [] };
    const b = m.mikaDringend({ dash: viele, au: { auftraege: [] }, jetzt: JETZT });
    expect(b.gruppen[0]).toMatchObject({ mehr: 3, anzahl: 8, mehrZiel: { art: 'liste', liste: 'lange' } });
    expect(b.gruppen[0].eintraege).toHaveLength(5);
    expect(b.treffer).toBe(8);
  });
  test('leer', () => {
    expect(m.mikaDringend({ dash: { kacheln: {}, fehler: [] }, au: { auftraege: [] }, jetzt: JETZT })).toMatchObject({ gruppen: [], treffer: 0, leer: 'Nichts Dringendes.' });
  });
  test('Vorlesen ohne Nummern', () => {
    expect(a.vorlesen.join(' ')).not.toMatch(/AU-|JFN|#|\d{5}/);
  });
});

describe('Suche: Eingabe', () => {
  test.each([
    [{ nummer: '90015' }, { art: 'shop', shop: 'jfn', nr: '90015' }],
    [{ nummer: ' #90015 ', shop: 'honk' }, { art: 'shop', shop: 'honk', nr: '90015' }],
    [{ nummer: '90015', shop: 'quatsch' }, { art: 'shop', shop: 'jfn', nr: '90015' }],
    [{ nummer: 'au-2026-12' }, { art: 'au', nr: 'AU-2026-0012' }],
    [{ nummer: 'AU-2026-0012' }, { art: 'au', nr: 'AU-2026-0012' }],
  ])('%j', (e, soll) => expect(m.sucheEingabe(e)).toEqual(soll));
  test.each(['', 'Erika Testfrau', '0', '12345678901', 'AG-2026-0001', '90015; DROP'])('keine Namenssuche / ungueltig: %s', nummer => {
    expect(m.sucheEingabe({ nummer }).fehler).toMatch(/Bestellnummer/);
  });
});

const ORDER = { id: 90015, number: '90015', status: 'processing', date_created: '2026-11-10T09:00:00', line_items: [
  { id: 1, name: 'Trikot Heim - MÜLLERSOHN - 7', parent_name: 'Trikot Heim', quantity: 1, product_id: 5 },
  { id: 2, name: 'Hoodie Navy - L', parent_name: 'Hoodie', quantity: 2, product_id: 6 },
  { id: 3, name: 'Tasse', parent_name: '', quantity: 1, product_id: 7 },
] };
const STAND = { bestellungen: [{ id: '90015', artikel: [
  { wcItemId: '1', fertig: true, versendet: false, lshop: { art: 'kein', text: 'kein L-Shop-Artikel', grund: '' } },
  { wcItemId: '2', fertig: false, versendet: false, lshop: { art: 'bestellt', text: 'bestellt JFN-2026-0012 · versandt' }, lager: { art: 'offen', n: 3, genug: true } },
  { wcItemId: '3', fertig: false, versendet: false, lshop: { art: 'kein', text: 'kein L-Shop-Artikel', grund: '' } },
] }] };
const lader = (x = {}) => ({
  dashboard: jest.fn(async () => ({ d: DASH, au: AU })), lshop: jest.fn(async () => LSHOP), auftraege: jest.fn(async () => AU_SUCHE),
  shop: jest.fn(() => ({ get: jest.fn(async () => ({ data: ORDER })) })), stand: jest.fn(async () => STAND), ...x,
});
const AU_SUCHE = { auftraege: [au('AU-2026-0012', { Status: 'in Produktion', Termin: '2026-11-30', positionen: [
  { Position_ID: 'AU-2026-0012-01', Art: 'lshop', Menge: 5, Herkunft: 'bestellen', lshop: { modell: 'JH001', farbe: 'Navy', groesse: 'L' }, korb: { status: 'bestellt' }, Druckname: 'Anna' },
  { Position_ID: 'AU-2026-0012-02', Art: 'lshop', Menge: 2, Herkunft: 'lager', Lager_Ort: 'Wrist', lshop: { modell: 'JH001', farbe: 'Navy', groesse: 'M' } },
  { Position_ID: 'AU-2026-0012-03', Art: 'frei', Menge: 1, Herkunft: '', Freitext: 'Aufnäher', Fertig: 'ja' },
] })] };

describe('Suche', () => {
  test('Shop: genau EIN Shop-Abruf, Stand je Position, Elternname statt Variantenname (Rueckenname nie)', async () => {
    const l = lader();
    const a = await lib.sucheNummer({ eingabe: { nummer: '90015', shop: 'jfn' }, jetzt: JETZT, lader: l });
    expect(l.shop).toHaveBeenCalledTimes(1);
    expect(l.shop.mock.results[0].value.get).toHaveBeenCalledWith('orders/90015', { _fields: 'id,number,status,date_created,line_items' });
    expect(l.stand.mock.calls[0][0].bestellungen[0].line_items.map(x => x.name)).toEqual(['Trikot Heim', 'Hoodie', 'Tasse']);
    expect(a.titel).toBe('Bestellung JFN #90015');
    expect(a.gruppen[0].eintraege[0]).toEqual({ text: 'JFN #90015', zusatz: 'in Bearbeitung · seit 8 Tagen', ziel: { art: 'shop', shop: 'jfn', id: '90015' } });
    expect(a.gruppen[1].eintraege.map(e => [e.text, e.zusatz])).toEqual([
      ['1 × Trikot Heim', 'fertig'], ['2 × Hoodie', 'L-Shop bestellt JFN-2026-0012 · versandt · im Lager 3'], ['1 × Tasse', 'nicht im L-Shop-Korb']]);
    expect(json(a)).not.toContain('MÜLLERSOHN');
    expect(a.treffer).toBe(1);
  });
  test('Shop: nicht gefunden (404) und falscher Shop -> Hinweis auf den anderen Shop', async () => {
    const nf = Object.assign(new Error('Request failed with status code 404 orders/90099'), { response: { status: 404 } });
    const l = lader({ shop: jest.fn(() => ({ get: jest.fn(async () => { throw nf; }) })) });
    const a = await lib.sucheNummer({ eingabe: { nummer: '90099', shop: 'honk' }, lader: l });
    expect(a).toMatchObject({ treffer: 0, gruppen: [], leer: 'Im HONK-Shop gibt es keine Bestellung #90099. Anderer Shop? Dann JFN wählen und noch einmal suchen.' });
    expect(l.shop).toHaveBeenCalledWith('honk');
    expect(l.stand).not.toHaveBeenCalled();
  });
  test('Stand nicht lesbar -> Bestellung trotzdem, unvollstaendig', async () => {
    const a = await lib.sucheNummer({ eingabe: { nummer: '90015' }, jetzt: JETZT, lader: lader({ stand: jest.fn(async () => { throw new Error('kaputt'); }) }) });
    expect(a.unvollstaendig).toBe(true);
    expect(a.gruppen[1].eintraege[0].zusatz).toBe('Stand nicht lesbar');
  });
  test('Pruefseite: Nummer aus dem Fehlertext entfernt, Fehler geht weiter (Laufstopp-Meldung)', async () => {
    const err = new HosterPruefseiteError({ shop: 'jfn', pfad: 'orders/90015', status: 200, titel: 'x' });
    const l = lader({ shop: jest.fn(() => ({ get: jest.fn(async () => { throw err; }) })) });
    await expect(lib.sucheNummer({ eingabe: { nummer: '90015' }, lader: l })).rejects.toBe(err);
    expect(`${err.message} ${err.pfad}`).not.toContain('90015');
  });
  test('AU-Nummer: aus den Auftraegen (ohne Automatik), Stand je Position, kein Shop-Abruf, kein Druckname', async () => {
    const l = lader();
    const a = await lib.sucheNummer({ eingabe: { nummer: 'AU-2026-0012' }, lader: l });
    expect(l.shop).not.toHaveBeenCalled();
    expect(a.gruppen[0].eintraege[0]).toEqual({ text: 'AU-2026-0012 · Titel 12', zusatz: 'in Produktion · Termin 30.11.2026', ziel: { art: 'au', nr: 'AU-2026-0012' } });
    expect(a.gruppen[1].eintraege.map(e => e.zusatz)).toEqual(['bei L-Shop bestellt', 'aus dem Lager (Wrist) – noch nicht gebucht', 'fertig']);
    expect(json(a)).not.toContain('Anna');
  });
  test('AU-Nummer unbekannt', async () => {
    expect(await lib.sucheNummer({ eingabe: { nummer: 'AU-2026-0999' }, lader: lader() })).toMatchObject({ treffer: 0, leer: 'Auftrag AU-2026-0999 gibt es nicht.' });
  });
  test('ungueltig -> 422 mit festem Text', async () => {
    await expect(lib.sucheNummer({ eingabe: { nummer: 'Erika Testfrau' }, lader: lader() })).rejects.toMatchObject({ status: 422, code: 'mika_eingabe' });
  });
});

describe('Logzeile', () => {
  test('nur frage, wer, treffer', () => {
    expect(JSON.parse(m.mikaLogZeile({ frage: 'suche', wer: 'nicole', treffer: 1 }))).toEqual({ event: 'mika_frage', frage: 'suche', wer: 'nicole', treffer: 1 });
    expect(JSON.parse(m.mikaLogZeile({ frage: 'AU-2026-0001', wer: 'automation', treffer: -3 }))).toEqual({ event: 'mika_frage', frage: 'unbekannt', wer: 'unbekannt', treffer: 0 });
  });
});

describe('Route', () => {
  const app = (l, log, wer = 'inhaber') => {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.mcSchluessel = wer; next(); });
    a.post('/frage', mikaHandler('frage', l, log));
    a.post('/suche', mikaHandler('suche', l, log));
    a.use((err, _req, res, _next) => res.status(599).json({ weiter: err.constructor.name }));
    return a;
  };
  test('jede Frage: GENAU eine Logzeile ohne Nummer und Suchtext', async () => {
    const log = jest.fn();
    const l = lader();
    for (const [pfad, body] of [['/frage', { frage: 'heute' }], ['/frage', { frage: 'dringend', fuer: 'Nicole' }], ['/suche', { nummer: '90015', shop: 'jfn' }],
      ['/suche', { nummer: 'AU-2026-0012' }], ['/suche', { nummer: 'AU-2026-0999' }]]) {
      const r = await request(app(l, log)).post(pfad).send(body);
      expect(r.status).toBe(200);
    }
    expect(log).toHaveBeenCalledTimes(5);
    const zeilen = log.mock.calls.map(c => c[0]);
    for (const z of zeilen) {
      expect(Object.keys(JSON.parse(z)).sort()).toEqual(['event', 'frage', 'treffer', 'wer']);
      expect(z).not.toMatch(/90015|AU-|JFN|Erika|Nicole\b/);
    }
    expect(zeilen.map(z => JSON.parse(z).frage)).toEqual(['heute', 'dringend', 'suche', 'suche', 'suche']);
    expect(JSON.parse(zeilen[4]).treffer).toBe(0);
  });
  test('Automatik-Schluessel: 403, keine Logzeile', async () => {
    const log = jest.fn();
    const r = await request(app(lader(), log, 'automation')).post('/frage').send({ frage: 'heute' });
    expect(r.status).toBe(403);
    expect(log).not.toHaveBeenCalled();
  });
  test('Fehler: fester Mika-Text, nie der interne Text; 422 bei Eingabe', async () => {
    const log = jest.fn(), warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const l = lader({ dashboard: jest.fn(async () => { throw new Error('interner Text 90015'); }), shop: jest.fn(() => ({ get: jest.fn(async () => { throw new Error('orders/90015 kaputt'); }) })) });
    const r1 = await request(app(l, log)).post('/frage').send({ frage: 'heute' });
    expect(r1.status).toBe(502);
    expect(r1.body).toEqual({ error: m.FEHLER_TEXT, code: 'mika_fehler' });
    const r2 = await request(app(l, log)).post('/suche').send({ nummer: '90015' });
    expect(r2.body.error).toBe('Mika findet gerade nichts – bitte die Liste direkt öffnen.');
    const r3 = await request(app(l, log)).post('/suche').send({ nummer: 'Erika Testfrau' });
    expect(r3.status).toBe(422);
    expect(r3.body.error).not.toContain('Erika');
    expect(log).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/90015|Erika/);
    warn.mockRestore();
  });
  test('Pruefseite geht an den Laufstopp-Handler', async () => {
    const err = new HosterPruefseiteError({ shop: 'jfn', pfad: 'orders/90015', status: 200, titel: 'x' });
    const r = await request(app(lader({ shop: jest.fn(() => ({ get: jest.fn(async () => { throw err; }) })) }), jest.fn())).post('/suche').send({ nummer: '90015' });
    expect(r.status).toBe(599);
    expect(r.body.weiter).toBe('HosterPruefseiteError');
  });
  test('unbekannte Frage -> 422', async () => {
    const r = await request(app(lader(), jest.fn())).post('/frage').send({ frage: 'wetter' });
    expect(r.status).toBe(422);
  });
});

// ── Lesungen vorher/nachher (Auftrag: keine zusaetzliche Last aufs Sheets-Kontingent) ──
describe('Lesungen', () => {
  const lesungen = () => SHEETS.spreadsheets.values.get.mock.calls.length + SHEETS.spreadsheets.values.batchGet.mock.calls.length + SHEETS.spreadsheets.get.mock.calls.length;
  const shopAbrufe = () => WC.get.mock.calls.length;
  const zaehle = async fn => { const s = lesungen(), w = shopAbrufe(), d = DRIVE.files.list.mock.calls.length; await fn(); return { sheets: lesungen() - s, shop: shopAbrufe() - w, drive: DRIVE.files.list.mock.calls.length - d }; };
  const ergebnis = {};
  beforeEach(() => { _dashboardCacheLeeren(); _auftraegeCacheLeeren(); _lshopBestellungenZuletztLeeren(); lib._mikaCacheLeeren(); process.env.GOOGLE_SHEET_ID = 'ssot'; process.env.BUSINESS_SHEET_ID = 'biz'; process.env.RUECKSTAND_ORDNER_ID = 'ordner'; });
  afterAll(() => console.info(`MI1 Lesungen: ${JSON.stringify(ergebnis)}`));

  test('heute direkt nach dem Dashboard: 0 weitere Lesungen, 0 Shop-Abrufe', async () => {
    ergebnis.dashboard = await zaehle(() => leseDashboard({ shop: 'jfn' }));
    ergebnis.heuteNachDashboard = await zaehle(() => lib.beantworteFrage({ frage: 'heute', shop: 'jfn' }));
    expect(ergebnis.dashboard.sheets).toBeGreaterThan(0);
    expect(ergebnis.heuteNachDashboard).toEqual({ sheets: 0, shop: 0, drive: 0 });
  });
  test('dringend nach dem Dashboard: nur die L-Shop-Bestellungen einmal, danach 0', async () => {
    await leseDashboard({ shop: 'jfn' });
    ergebnis.dringendNachDashboard = await zaehle(() => lib.beantworteFrage({ frage: 'dringend', shop: 'jfn' }));
    lib._mikaCacheLeeren();   // auch ohne Antwort-Speicher: L-Shop-Antwort bleibt 10 min gemerkt
    ergebnis.dringendZweites = await zaehle(() => lib.beantworteFrage({ frage: 'dringend', shop: 'jfn' }));
    expect(ergebnis.dringendZweites).toEqual({ sheets: 0, shop: 0, drive: 0 });
    expect(ergebnis.dringendNachDashboard.shop).toBe(0);
  });
  test('ohne Dashboard vorher: hoechstens so viel wie ein Dashboard, dann 60 s nichts', async () => {
    ergebnis.heuteKalt = await zaehle(() => lib.beantworteFrage({ frage: 'heute', shop: 'jfn' }));
    ergebnis.heuteWiederholt = await zaehle(() => lib.beantworteFrage({ frage: 'heute', shop: 'jfn' }));
    _dashboardCacheLeeren(); _auftraegeCacheLeeren();
    ergebnis.dashboardVergleich = await zaehle(() => leseDashboard({ shop: 'jfn' }));
    expect(ergebnis.heuteKalt.sheets).toBeLessThanOrEqual(ergebnis.dashboardVergleich.sheets);
    expect(ergebnis.heuteWiederholt).toEqual({ sheets: 0, shop: 0, drive: 0 });
  });
  test('Mika schreibt nie (kein automatisches "bestellt")', async () => {
    await lib.beantworteFrage({ frage: 'heute', shop: 'jfn' });
    await lib.beantworteFrage({ frage: 'dringend', shop: 'jfn' });
    expect(SHEETS.spreadsheets.values.update).not.toHaveBeenCalled();
    expect(SHEETS.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
    expect(SHEETS.spreadsheets.values.append).not.toHaveBeenCalled();
  });
});
