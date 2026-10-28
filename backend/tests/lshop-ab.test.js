// BO4i: Auftragsbestaetigung (AB-XML) auswerten. Lesen (Aufbau gemessen 28.10.), Zuordnung zum Korb, Abweichungen,
// Versandkosten-Zeile, UTF-16, Schreibweg gegen ein In-Memory-Sheet (Status-Regel, nur geaenderte Zellen, doppelte/
// zweite AB), Beleg-Abruf mit Chat nur bei Abweichung, und: kein Preis, keine Adresse, keine Kundennummer in
// Rueckgabe, Sheet, Chat oder Konsole. Alle Werte erfunden.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KORB_SPALTEN, TAB_KORB } from '../utils/korb-logic.js';
import { EDI_TAB, EDI_SPALTEN, referenzFuer } from '../utils/edi-bestellung.js';
import { BELEGE_TAB, BELEGE_SPALTEN, SENDUNGEN_TAB, SENDUNGEN_SPALTEN, ORDNER, dekodiere } from '../utils/lshop-belege.js';
import {
  leseAb, abAbgleich, abKurz, abStufe, ediStatusNachAb, buildAbNachricht, isoDatum, AbFormatFehler, AB_EDI_SPALTEN, AB_KORB_SPALTEN,
} from '../utils/lshop-ab.js';
import { werteAbAus, richteAbSpaltenEin } from '../lib/lshopAb.js';
import { ediBestellZeilen } from '../utils/lshop-bestellungen.js';
import { runBelegeAbruf } from '../lib/lshopBelege.js';
import { machSheets } from './hilfen/korb-sheet.js';

const hier = dirname(fileURLToPath(import.meta.url));
const ID = 'JFN-2026-0009';
const PREIS = '47.11';
const ADRESSE = 'Teststraße 99';
const KUNDE = '12345678';
const NUN = new Date('2026-10-28T08:00:00Z');

// ── AB-XML wie gemessen (Kopf, Adressen, Items, Versandzeile, PayTerms) ──────
const item = ({ art, menge = 1, termin = '27.10.2026', ref = '' }) =>
  `<Item><Artikelnummer>${art}</Artikelnummer><Katalognummer></Katalognummer><Artikelbezeichung>Test &amp; Shirt</Artikelbezeichung><Farbe></Farbe><Groesse></Groesse>`
  + `<Menge>${menge}</Menge><EPreis>${PREIS}</EPreis><GPreis>${PREIS}</GPreis><Liefertermin>${termin}</Liefertermin>${ref === null ? '' : `<PositionFreiText>${ref}</PositionFreiText>`}</Item>`;
const VERSAND = `<Item><Artikelnummer>9900000001</Artikelnummer><Artikelbezeichung>Versandkosten Paketdienst</Artikelbezeichung><Menge>1</Menge><EPreis>${PREIS}</EPreis><Liefertermin>27.10.2026</Liefertermin></Item>`;
function abXml(items, { id = ID, abNr = 'AB00000009', bestell = '28.10.2026' } = {}) {
  return `<?xml version="1.0"?>\n<OrderConfirmation>\n<Header><Kundennummer>${KUNDE}</Kundennummer><Vorgang>VA00000009</Vorgang><Belegart>Auftragsbestätigung</Belegart>`
    + `<Belegnummer>${abNr}</Belegnummer><INET></INET><IhreBestellung>${id}</IhreBestellung><Kommission>KW44</Kommission><Teillieferung>-1</Teillieferung>`
    + `<Belegdatum>27.10.2026</Belegdatum><Bestelldatum>${bestell}</Bestelldatum><Lieferdatum>27.10.2026</Lieferdatum><Versand>DHL</Versand></Header>`
    + `<BillingAddress><Name1>Test GmbH</Name1><Strasse>${ADRESSE}</Strasse></BillingAddress><ShippingAddress><Strasse>${ADRESSE}</Strasse></ShippingAddress>`
    + `<Items>${items.join('')}${VERSAND}</Items><PayTerms><WKZ>EUR</WKZ><Nettobetrag>${PREIS}</Nettobetrag><Endsumme>${PREIS}</Endsumme></PayTerms>\n</OrderConfirmation>`;
}
const korbZ = o => ({ Shop: 'JFN', Herkunft: 'shop', Status: 'bestellt', Menge: '1', Bestell_ID: ID, ...o });
const KORB = () => [
  korbZ({ Schluessel: 'JFN:100:1', Bestellnummer: '100', Position: '1', LShop_ArticleNr: '1000000001', Menge: '2' }),
  korbZ({ Schluessel: 'JFN:101:1', Bestellnummer: '101', Position: '1', LShop_ArticleNr: '1000000002' }),
  korbZ({ Schluessel: 'EIGEN:2026-0001', Herkunft: 'eigen', Referenz: 'Lager', LShop_ArticleNr: '1000000003', Menge: '5' }),
  korbZ({ Schluessel: 'EIGEN:2026-0002', Herkunft: 'eigen', Referenz: 'Lager', LShop_ArticleNr: '1000000004', Menge: '5' }),
  korbZ({ Schluessel: 'JFN:200:1', Bestellnummer: '200', Position: '1', LShop_ArticleNr: '1000000001', Bestell_ID: 'JFN-2026-0008' }),
];
const allesOk = () => [
  item({ art: '1000000001', menge: 2, ref: 'JFN-100-1' }), item({ art: '1000000002', ref: 'JFN-101-1' }),
  item({ art: '1000000003', menge: 5, ref: 'Lager' }), item({ art: '1000000004', menge: 5, ref: 'Lager' }),
];
const objZeilen = rows => rows.map((o, i) => ({ _zeile: i + 2, ...o }));
const ohneGeheim = x => {
  const s = typeof x === 'string' ? x : JSON.stringify(x, (k, v) => (v instanceof Map ? [...v] : v));
  expect(s).not.toContain(PREIS); expect(s).not.toContain(ADRESSE); expect(s).not.toContain(KUNDE);
};

describe('AB lesen', () => {
  test('Kopf, Items in Reihenfolge, Versandzeile erkannt, Daten ISO, Entities; nie Preis/Adresse/Kundennummer', () => {
    const ab = leseAb(abXml(allesOk()));
    expect(ab).toMatchObject({ orderId: ID, va: 'VA00000009', abNr: 'AB00000009', belegdatum: '2026-10-27', bestelldatum: '2026-10-28', versandZeilen: 1 });
    expect(ab.items.map(i => [i.nr, i.artikel, i.menge, i.termin, i.reference])).toEqual([
      [1, '1000000001', 2, '2026-10-27', 'JFN-100-1'], [2, '1000000002', 1, '2026-10-27', 'JFN-101-1'],
      [3, '1000000003', 5, '2026-10-27', 'Lager'], [4, '1000000004', 5, '2026-10-27', 'Lager'],
    ]);
    ohneGeheim(ab);
  });
  test('UTF-16 LE mit BOM und UTF-8 lesen gleich', () => {
    const x = abXml([item({ art: '1000000001', ref: 'Größe &amp; Co' })]);
    const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(x, 'utf16le')]);
    expect(leseAb(dekodiere(u16))).toEqual(leseAb(dekodiere(Buffer.from(x, 'utf8'))));
    expect(leseAb(x).items[0].reference).toBe('Größe & Co');
  });
  test('Format: kein OrderConfirmation, Header fehlt, Menge unlesbar -> AbFormatFehler', () => {
    expect(() => leseAb('<Orderconfirmation/>')).toThrow(AbFormatFehler);
    expect(() => leseAb('<OrderConfirmation></OrderConfirmation>')).toThrow(/Header/);
    expect(() => leseAb(abXml([item({ art: '1000000001', menge: 'x' })]))).toThrow(/Position 1/);
    expect(isoDatum('5.1.2026')).toBe('');
  });
});

describe('Abgleich', () => {
  const abg = items => abAbgleich({ ab: leseAb(abXml(items)), korbZeilen: objZeilen(KORB()), referenz: referenzFuer });
  test('alles da, alles sofort -> ok; doppelte reference ueber Artikelnummer; fremde Bestellung zaehlt nicht', () => {
    const a = abg(allesOk());
    expect(a.abweichungen).toBe(0);
    expect(a.positionen.map(p => [p.schluessel, p.hinweis, p.liefertermin])).toEqual([
      ['JFN:100:1', '', ''], ['JFN:101:1', '', ''], ['EIGEN:2026-0001', '', ''], ['EIGEN:2026-0002', '', ''],
    ]);
    expect(abKurz(a)).toBe('ok');
  });
  test('gekuerzt (rot), mehr (gelb), spaeter (gelb), fehlt (rot), unbekannt (rot)', () => {
    const a = abg([
      item({ art: '1000000001', menge: 1, ref: 'JFN-100-1' }),
      item({ art: '1000000002', menge: 3, ref: 'JFN-101-1', termin: '05.11.2026' }),
      item({ art: '1000000003', menge: 5, ref: 'Lager' }),
      item({ art: '1000000099', menge: 2, ref: 'JFN-999-1' }),
    ]);
    const p = Object.fromEntries(a.positionen.map(x => [x.schluessel, x]));
    expect(p['JFN:100:1']).toMatchObject({ hinweis: 'Menge 1 statt 2', stufe: 'rot', liefertermin: '' });
    expect(p['JFN:101:1']).toMatchObject({ hinweis: 'Menge 3 statt 1 · Termin 05.11.2026', stufe: 'gelb', liefertermin: '2026-11-05' });
    expect(p['EIGEN:2026-0002']).toMatchObject({ hinweis: 'fehlt in AB', stufe: 'rot' });
    expect(a.unbekannt).toEqual([{ nr: 4, artikel: '1000000099', reference: 'JFN-999-1', menge: 2 }]);
    expect(abKurz(a)).toBe('5 Abweichungen: 1× Menge gekürzt, 1× Menge mehr, 1× Termin später, 1× fehlt in AB, 1× unbekannte AB-Zeile');
  });
  test('Termin = Bestelldatum ist nicht spaeter', () => {
    expect(abg([item({ art: '1000000001', menge: 2, ref: 'JFN-100-1', termin: '28.10.2026' })]).positionen[0].liefertermin).toBe('');
  });
  test('Status-Regel: nur gesendet -> bestaetigt', () => {
    expect(['gesendet', 'bestätigt', 'versandt', 'geliefert', 'unklar'].map(ediStatusNachAb)).toEqual(['bestätigt', 'bestätigt', 'versandt', 'geliefert', 'unklar']);
  });
  test('Chat-Text: Referenz und Abweichung, nie Preis', () => {
    const a = abg([item({ art: '1000000001', menge: 1, ref: 'JFN-100-1' })]);
    const n = buildAbNachricht({ orderId: ID, abNr: 'AB00000009', abgleich: a, referenzen: new Map([['JFN:100:1', 'JFN-100-1']]) });
    expect(n.split('\n').slice(0, 3)).toEqual([`⚠️ L-Shop-AB ${ID} (AB00000009)`, expect.stringMatching(/^4 Abweichungen/), '• JFN-100-1: Menge 1 statt 2']);
    ohneGeheim(n);
  });
});

// ── Schreibweg ───────────────────────────────────────────────────────────────
function aufbau({ status = 'gesendet', abNr = '', mitSpalten = true } = {}) {
  const ediKopf = [...EDI_SPALTEN, ...(mitSpalten ? AB_EDI_SPALTEN : [])];
  const korbKopf = [...KORB_SPALTEN, ...(mitSpalten ? AB_KORB_SPALTEN : [])];
  const tabs = {
    [EDI_TAB]: [ediKopf, ediKopf.map(n => ({ order_id: ID, Status: status, AB_Nr: abNr }[n] ?? ''))],
    [TAB_KORB]: [korbKopf, ...KORB().map(o => korbKopf.map(n => o[n] ?? ''))],
    [BELEGE_TAB]: [BELEGE_SPALTEN],
    [SENDUNGEN_TAB]: [SENDUNGEN_SPALTEN],
  };
  const m = machSheets(tabs);
  return { tabs, ...m };
}
const zelle = (tabs, tab, z, n) => tabs[tab][z][tabs[tab][0].indexOf(n)] ?? '';
beforeEach(() => { process.env.GOOGLE_SHEET_ID = 'ssot'; });

describe('werteAbAus', () => {
  test('gesendet -> bestaetigt, AB-Spalten, Korb Liefertermin/AB_Hinweis; Menge/Status bleiben; zweiter Aufruf schreibt nichts', async () => {
    const a = aufbau();
    const items = [item({ art: '1000000001', menge: 1, ref: 'JFN-100-1' }), item({ art: '1000000002', ref: 'JFN-101-1', termin: '05.11.2026' }), ...allesOk().slice(2)];
    const r = await werteAbAus({ ab: leseAb(abXml(items)), sheets: a.sheets, nun: NUN });
    expect(r).toMatchObject({ statusAlt: 'gesendet', statusNeu: 'bestätigt', anlass: '', kurz: '2 Abweichungen: 1× Menge gekürzt, 1× Termin später' });
    expect(Object.fromEntries(['Status', ...AB_EDI_SPALTEN].map(n => [n, zelle(a.tabs, EDI_TAB, 1, n)]))).toEqual({
      Status: 'bestätigt', AB_Nr: 'AB00000009', AB_VA: 'VA00000009', AB_Datum: '2026-10-27', AB_Eingang: NUN.toISOString(), AB_Hinweis: r.kurz,
    });
    expect([1, 2, 3, 4, 5].map(z => [zelle(a.tabs, TAB_KORB, z, 'Liefertermin'), zelle(a.tabs, TAB_KORB, z, 'AB_Hinweis'), zelle(a.tabs, TAB_KORB, z, 'Menge'), zelle(a.tabs, TAB_KORB, z, 'Status')])).toEqual([
      ['', 'Menge 1 statt 2', '2', 'bestellt'], ['2026-11-05', 'Termin 05.11.2026', '1', 'bestellt'], ['', '', '5', 'bestellt'], ['', '', '5', 'bestellt'], ['', '', '1', 'bestellt'],
    ]);
    expect(a.aufrufe.append).toBe(0);
    ohneGeheim(a.tabs);
    const n = a.aufrufe.batchUpdate.length;
    const r2 = await werteAbAus({ ab: leseAb(abXml(items)), sheets: a.sheets, nun: new Date('2026-10-28T09:00:00Z') });
    expect(r2.zellen).toBe(0);
    expect(a.aufrufe.batchUpdate.length).toBe(n);
  });
  test('versandt bleibt versandt; andere AB-Nummer = zweite AB', async () => {
    const a = aufbau({ status: 'versandt', abNr: 'AB00000001' });
    const r = await werteAbAus({ ab: leseAb(abXml(allesOk())), sheets: a.sheets, nun: NUN });
    expect(r).toMatchObject({ statusNeu: 'versandt', anlass: 'zweite' });
    expect(zelle(a.tabs, EDI_TAB, 1, 'Status')).toBe('versandt');
  });
  test('Trockenlauf schreibt nichts; fehlende Spalten -> 409', async () => {
    const a = aufbau();
    const r = await werteAbAus({ ab: leseAb(abXml(allesOk())), sheets: a.sheets, nun: NUN, dryRun: true });
    expect(r.zellen).toBeGreaterThan(0);
    expect(a.aufrufe.batchUpdate).toEqual([]);
    const b = aufbau({ mitSpalten: false });
    expect((await werteAbAus({ ab: leseAb(abXml(allesOk())), sheets: b.sheets, nun: NUN, dryRun: true })).statusNeu).toBe('bestätigt');   // Trockenlauf auch ohne Spalten
    await expect(werteAbAus({ ab: leseAb(abXml(allesOk())), sheets: b.sheets, nun: NUN })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/setup-lshop-ab-spalten/) });
  });
  test('Spalten einrichten: Trockenlauf nichts, --write haengt hinten an, danach vorhanden', async () => {
    const b = aufbau({ mitSpalten: false });
    expect((await richteAbSpaltenEin({ sheets: b.sheets })).join('\n')).toMatch(/wuerden angehaengt/);
    expect(b.aufrufe.update).toEqual([]);
    await richteAbSpaltenEin({ write: true, sheets: b.sheets });
    expect(b.tabs[EDI_TAB][0].slice(-5)).toEqual(AB_EDI_SPALTEN);
    expect(b.tabs[TAB_KORB][0].slice(-2)).toEqual(AB_KORB_SPALTEN);
    expect((await richteAbSpaltenEin({ sheets: b.sheets })).every(z => /vorhanden/.test(z))).toBe(true);
  });
});

describe('Beleg-Abruf mit AB', () => {
  const ftp = inhalt => async fn => fn({
    liste: async o => Object.entries(inhalt[o] ?? {}).map(([name, buf]) => ({ name, size: buf.length, istDatei: true, modifiedAt: NUN, rawModifiedAt: '' })),
    lade: async (o, d) => inhalt[o][d],
  });
  const archiv = async ({ name }) => ({ status: 'neu', id: `drv-${name}` });
  test('Abweichung: Protokoll "Abweichung", Chat ohne Preis; alles ok: kein Chat', async () => {
    const log = [];
    for (const m of ['log', 'warn', 'error']) jest.spyOn(console, m).mockImplementation((...x) => log.push(x.join(' ')));
    const a = aufbau();
    const meldungen = [];
    const r = await runBelegeAbruf({ sheets: a.sheets, ftp: ftp({ [ORDNER.AB]: { 'AB_9.xml': Buffer.from(abXml([item({ art: '1000000001', menge: 1, ref: 'JFN-100-1' })])) } }),
      archiv, melde: async n => { meldungen.push(n); return true; }, jetzt: () => NUN });
    expect(r.abAusgewertet).toEqual([expect.objectContaining({ orderId: ID, status: 'bestätigt', abweichungen: 4 })]);
    const prot = a.tabs[BELEGE_TAB].at(-1);
    expect(prot[BELEGE_SPALTEN.indexOf('Ergebnis')]).toBe('Abweichung');
    expect(meldungen).toHaveLength(1);
    expect(meldungen[0]).toMatch(/^⚠️ L-Shop-AB JFN-2026-0009/);
    ohneGeheim({ r, meldungen, log, tabs: a.tabs });
    jest.restoreAllMocks();

    const b = aufbau();
    const m2 = [];
    await runBelegeAbruf({ sheets: b.sheets, ftp: ftp({ [ORDNER.AB]: { 'AB_9.xml': Buffer.from(abXml(allesOk())) } }), archiv, melde: async n => { m2.push(n); return true; }, jetzt: () => NUN });
    expect(m2).toEqual([]);
    expect(b.tabs[BELEGE_TAB].at(-1)[BELEGE_SPALTEN.indexOf('Ergebnis')]).toBe('ausgewertet');
  });
  test('IhreBestellung passt nicht zur gefundenen order_id -> Alarm, nichts ausgewertet', async () => {
    const a = aufbau();
    const x = abXml(allesOk()).replace('<Kommission>KW44</Kommission>', '<Kommission>JFN-2026-0008</Kommission>');
    const r = await runBelegeAbruf({ sheets: a.sheets, ftp: ftp({ [ORDNER.AB]: { 'AB_9.xml': Buffer.from(x) } }), archiv, melde: async () => true, jetzt: () => NUN });
    expect(r.alarme).toEqual([expect.objectContaining({ hinweis: expect.stringMatching(/nicht in LShop_EDI_Dateien|passt nicht/) })]);
    expect(zelle(a.tabs, EDI_TAB, 1, 'Status')).toBe('gesendet');
  });
});

// ── Anzeige ──────────────────────────────────────────────────────────────────
describe('Anzeige L-Shop-Bestellungen', () => {
  test('abStufe aus dem gespeicherten Hinweis', () => {
    expect(['', 'Menge 1 statt 2', 'Menge 3 statt 1', 'Termin 05.11.2026', 'fehlt in AB', 'Menge 3 statt 1 · Termin 05.11.2026'].map(abStufe))
      .toEqual(['', 'rot', 'gelb', 'gelb', 'rot', 'gelb']);
  });
  test('EDI-Zeile mit AB -> ab { nr, datum, hinweis, stufe }; ohne AB-Spalten null', () => {
    const kopf = [...EDI_SPALTEN, ...AB_EDI_SPALTEN];
    const z = h => kopf.map(n => ({ order_id: ID, Status: 'bestätigt', AB_Nr: 'AB1', AB_Datum: '2026-10-27', AB_Hinweis: h }[n] ?? ''));
    expect(ediBestellZeilen([kopf, z('ok')])[0].ab).toEqual({ nr: 'AB1', datum: '2026-10-27', hinweis: 'ok', stufe: '' });
    expect(ediBestellZeilen([kopf, z('1 Abweichung: 1× Menge gekürzt')])[0].ab.stufe).toBe('rot');
    expect(ediBestellZeilen([kopf, z('1 Abweichung: 1× Termin später')])[0].ab.stufe).toBe('gelb');
    expect(ediBestellZeilen([EDI_SPALTEN, EDI_SPALTEN.map(n => ({ order_id: ID, Status: 'gesendet' }[n] ?? ''))])[0].ab).toBeNull();
  });
  test('Karte: "AB vom …", sofort / Liefertermin gelb / Abweichung rot; ohne AB "Liefertermin folgt"', () => {
    const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
    const von = html.indexOf('// ── L-Shop-Bestellungen: Anfang');
    const bis = html.indexOf('// ── L-Shop-Bestellungen: Ende ──');
    const { lbKarteHtml } = new Function(`${html.slice(von, bis)}\nreturn { lbKarteHtml };`)();
    const pos = o => ({ schluessel: 'x', articleNr: '1000000001', catalogNr: 'JH030F', bezeichnung: '', farbe: '', groesse: '', menge: 1, reference: 'JFN-1-1', status: 'bestellt', statusDatum: '', liefertermin: '', abHinweis: '', abStufe: '', ...o });
    const b = o => ({ orderId: ID, va: [], erzeugt: '2026-10-27T10:00:00Z', gesendet: '', positionenZahl: 3, stueck: 3, commission: '', versandart: '', status: 'bestätigt', pakete: 0, lieferscheine: [], ...o });
    const h = lbKarteHtml(b({ ab: { nr: 'AB1', datum: '2026-10-27', hinweis: '2 Abweichungen: 1× Menge gekürzt, 1× Termin später', stufe: 'rot' }, positionen: [
      pos({}), pos({ liefertermin: '2026-11-05', abHinweis: 'Termin 05.11.2026', abStufe: 'gelb' }), pos({ menge: 2, abHinweis: 'Menge 1 statt 2', abStufe: 'rot' }),
    ] }), true);
    expect(h).toContain('<div class="lb-ab lb-ab-rot">AB vom 27.10.2026 · 2 Abweichungen: 1× Menge gekürzt, 1× Termin später</div>');
    expect(h).toContain('· sofort</span>');
    expect(h).toContain('<span class="lb-ab-gelb">Liefertermin 5.11.2026</span></span>');   // Termin-Hinweis nicht doppelt
    expect(h).toContain('<span class="lb-ab-rot">Menge 1 statt 2</span>');
    const fehlt = lbKarteHtml(b({ ab: { nr: 'AB1', datum: '2026-10-27', hinweis: '1 Abweichung: 1× fehlt in AB', stufe: 'rot' }, positionen: [pos({ abHinweis: 'fehlt in AB', abStufe: 'rot' })] }), true);
    expect(fehlt).toContain('1000000001 · JFN-1-1 · <span class="lb-ab-rot">fehlt in AB</span>');   // kein "sofort"
    const ohne = lbKarteHtml(b({ ab: null, positionen: [pos({})] }), true);
    expect(ohne).toContain('Liefertermin folgt');
    expect(ohne).not.toMatch(/class="lb-ab[ "]|lb-ab-(rot|gelb)/);
    expect(lbKarteHtml(b({ ab: { nr: 'AB1', datum: '2026-10-27', hinweis: 'ok', stufe: '' }, positionen: [pos({})] }), true)).toContain('<div class="lb-ab">AB vom 27.10.2026 · alles bestätigt</div>');
  });
});
