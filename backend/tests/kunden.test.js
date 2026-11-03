// AM-1: Kundenstamm - Logik (utils/kunden.js), Sheet-Schreibwege (lib/kunden.js), Lexware nur lesen (lib/lexware.js),
// Backup mit drittem Sheet. Nur erfundene Daten.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import {
  KUNDEN_SPALTEN, TAB_KUNDEN, kundenZeilen, naechsteKundenNr, sucheKunden, kundeAusKontakt, zaehleKontakte, importPlan,
  neuerKunde, bearbeitenPlan, archivPlan, dsgvoPlan, STATUS,
} from '../utils/kunden.js';
import { lexwareGet, leseKundenKontakte, taktgeber, MAX_429 } from '../lib/lexware.js';
import {
  leseKunden, legeKundeAn, bearbeiteKunde, archiviereKunde, sperreKundeDsgvo, importiereKunden, _kundenCacheLeeren,
} from '../lib/kunden.js';

const hier = dirname(fileURLToPath(import.meta.url));
const JETZT = '2026-11-03T10:00:00.000Z';
const jetzt = () => new Date(JETZT);

// ── Erfundene Testdaten ──────────────────────────────────────────────────────
const zeile = o => KUNDEN_SPALTEN.map(s => o[s] ?? '');
const K1 = { Kunden_Nr: 'K-00001', Lexoffice_Nr: '10001', Lexoffice_ID: 'aaaa-1', Art: 'Verein', Name: 'Testverein Musterstadt', Spitzname: 'Kicker; die Blauen', Ort: 'Musterstadt', Status: 'aktiv', Quelle: 'lexoffice', Notiz: 'Polos jedes Jahr', Stand: '2026-10-01T00:00:00.000Z' };
const K2 = { Kunden_Nr: 'K-00002', Art: 'Firma', Name: 'Beispiel GmbH', Ort: 'Probehausen', Status: 'aktiv', Quelle: 'mc', Stand: '2026-10-02T00:00:00.000Z' };
const K3 = { Kunden_Nr: 'K-00007', Lexoffice_Nr: '10003', Lexoffice_ID: 'aaaa-3', Art: 'Person', Name: 'gelöscht K-00007', Status: 'gesperrt-DSGVO', Quelle: 'lexoffice', Stand: '2026-10-03T00:00:00.000Z' };
const tabsMit = (...kunden) => ({ [TAB_KUNDEN]: [KUNDEN_SPALTEN, ...kunden.map(zeile)] });

const firma = (id, nr, name, extra = {}) => ({
  id, roles: { customer: { number: nr } },
  company: { name, contactPersons: [{ firstName: 'Erika', lastName: 'Erfunden', primary: false }, { firstName: 'Max', lastName: 'Probe', primary: true, emailAddress: 'max@example.test' }] },
  addresses: { billing: [{ street: 'Teststr. 1', zip: '01234', city: 'Musterstadt', countryCode: 'DE' }] },
  emailAddresses: { business: ['info@example.test'] }, phoneNumbers: { business: ['+49 000 111'] }, ...extra,
});
const person = (id, nr, vor, nach, extra = {}) => ({ id, roles: { customer: { number: nr } }, person: { firstName: vor, lastName: nach }, ...extra });

beforeEach(() => {
  process.env.KUNDEN_SHEET_ID = 'kunden-test';
  _kundenCacheLeeren();
});

describe('Lexware-Kontakt -> Kunde', () => {
  test('Firma: Name, primaerer Ansprechpartner, Mail/Telefon, Rechnungsadresse, Nummer als Text', () => {
    const k = kundeAusKontakt(firma('id-1', 10007, 'Erfundene AG'));
    expect(k).toMatchObject({ Art: 'Firma', Name: 'Erfundene AG', Ansprechpartner: 'Max Probe', 'E-Mail': 'info@example.test',
      Telefon: '+49 000 111', Strasse: 'Teststr. 1', PLZ: '01234', Ort: 'Musterstadt', Land: 'DE', Lexoffice_Nr: '10007', Lexoffice_ID: 'id-1' });
  });
  test('Person: Vor- und Nachname, ohne Ansprechpartner', () => {
    expect(kundeAusKontakt(person('id-2', 10008, 'Paula', 'Platzhalter'))).toMatchObject({ Art: 'Person', Name: 'Paula Platzhalter', Ansprechpartner: '' });
  });
  test('Zaehler fuer den Trockenlauf: nur Zahlen', () => {
    const z = zaehleKontakte([firma('a', 1, 'X AG'), firma('b', 2, 'x ag'), person('c', 3, 'P', 'Q', { archived: true }),
      { id: 'd', company: { name: 'Ohne AP' } }]);
    expect(z).toMatchObject({ gesamt: 4, firmen: 3, personen: 1, archiviert: 1, mitAnsprechpartner: 2, firmenOhneAnsprechpartner: 1,
      ohneKundennummer: 1, dublettenGruppen: 1, dublettenKontakte: 2 });
    expect(JSON.stringify(z)).not.toMatch(/AG|Ohne AP/);
  });
});

describe('Importplan', () => {
  const kunden = () => kundenZeilen(tabsMit(K1, K2, K3)[TAB_KUNDEN]).kunden;

  test('neue Kunden bekommen fortlaufende K-Nummern ab der hoechsten (auch gesperrte zaehlen)', () => {
    const p = importPlan({ kunden: kunden(), kontakte: [firma('neu-1', 20001, 'Neu A'), person('neu-2', 20002, 'N', 'B')], jetzt: JETZT });
    expect(p.neu.map(k => k.Kunden_Nr)).toEqual(['K-00008', 'K-00009']);
    expect(p.neu[0]).toMatchObject({ Quelle: 'lexoffice', Status: 'aktiv', Spitzname: '', Notiz: '' });
  });
  test('Abgleich ueber Lexoffice_ID: Spitzname, Notiz, Status bleiben; Verein bleibt Verein', () => {
    const c = firma('aaaa-1', 10001, 'Testverein Musterstadt neu');
    const p = importPlan({ kunden: kunden(), kontakte: [c], jetzt: JETZT });
    expect(p.neu).toEqual([]);
    expect(p.aenderungen).toHaveLength(1);
    const f = p.aenderungen[0].felder;
    expect(f.Name).toBe('Testverein Musterstadt neu');
    expect(f).not.toHaveProperty('Spitzname');
    expect(f).not.toHaveProperty('Notiz');
    expect(f).not.toHaveProperty('Status');
    expect(f).not.toHaveProperty('Art');   // Firma in Lexware, Verein in MC -> bleibt
  });
  test('Rueckfall Lexoffice_Nr, wenn die Zeile noch keine ID hat', () => {
    const ohneId = { ...K2, Kunden_Nr: 'K-00004', Lexoffice_Nr: '30000', Quelle: 'mc' };
    const ks = kundenZeilen(tabsMit(ohneId)[TAB_KUNDEN]).kunden;
    const p = importPlan({ kunden: ks, kontakte: [firma('id-x', 30000, 'Beispiel GmbH')], jetzt: JETZT });
    expect(p.neu).toEqual([]);
    expect(p.aenderungen[0].felder).toMatchObject({ Lexoffice_ID: 'id-x', Quelle: 'lexoffice' });
  });
  test('zweiter Lauf mit denselben Daten: nichts neu, nichts geaendert', () => {
    const kontakte = [firma('neu-1', 20001, 'Neu A')];
    const erst = importPlan({ kunden: kunden(), kontakte, jetzt: JETZT });
    const danach = [...kunden(), ...erst.neu];
    const zweit = importPlan({ kunden: danach, kontakte, jetzt: JETZT });
    expect(zweit.zaehler).toMatchObject({ neu: 0, geaendert: 0, unveraendert: 1 });
  });
  test('DSGVO-gesperrte Zeile wird nie wieder befuellt; archivierter Lexware-Kontakt legt nichts an', () => {
    const p = importPlan({ kunden: kunden(), kontakte: [person('aaaa-3', 10003, 'Wieder', 'Da'), person('alt', 1, 'A', 'B', { archived: true })], jetzt: JETZT });
    expect(p.aenderungen).toEqual([]);
    expect(p.neu).toEqual([]);
    expect(p.zaehler).toMatchObject({ gesperrtUebersprungen: 1, archiviertUebersprungen: 1 });
  });
  test('Zeile mit derselben ID doppelt -> mehrdeutig, nichts', () => {
    const ks = kundenZeilen(tabsMit(K1, { ...K1, Kunden_Nr: 'K-00009' })[TAB_KUNDEN]).kunden;
    const p = importPlan({ kunden: ks, kontakte: [firma('aaaa-1', 10001, 'Egal')], jetzt: JETZT });
    expect(p.zaehler.mehrdeutig).toBe(1);
    expect(p.aenderungen).toEqual([]);
  });
});

describe('Suche, Nummern, Pflege', () => {
  const ks = () => kundenZeilen(tabsMit(K1, K2, K3)[TAB_KUNDEN]).kunden;
  test('Suche ueber Spitzname, Nummer, Lexoffice-Nr., Ort; jedes Wort muss passen', () => {
    expect(sucheKunden(ks(), 'blauen').map(k => k.Kunden_Nr)).toEqual(['K-00001']);
    expect(sucheKunden(ks(), 'k-00002').map(k => k.Kunden_Nr)).toEqual(['K-00002']);
    expect(sucheKunden(ks(), '10001').map(k => k.Kunden_Nr)).toEqual(['K-00001']);
    expect(sucheKunden(ks(), 'probehausen beispiel').map(k => k.Kunden_Nr)).toEqual(['K-00002']);
    expect(sucheKunden(ks(), 'kicker probehausen')).toEqual([]);
  });
  test('naechste Nummer', () => expect(naechsteKundenNr(ks())).toBe('K-00008'));
  test('neuer Kunde: Name und Art Pflicht, Quelle mc', () => {
    expect(() => neuerKunde({ eingabe: { Art: 'Firma' }, kunden: [], jetzt: JETZT })).toThrow('Name fehlt');
    expect(neuerKunde({ eingabe: { Art: 'Verein', Name: 'X', Land: 'de' }, kunden: [], jetzt: JETZT }))
      .toMatchObject({ Kunden_Nr: 'K-00001', Quelle: 'mc', Status: 'aktiv', Land: 'DE' });
  });
  test('Quelle lexoffice: Lexoffice-Felder nicht aenderbar, Spitzname schon', () => {
    expect(() => bearbeitenPlan({ kunden: ks(), eingabe: { kundenNr: 'K-00001', stand: K1.Stand, Name: 'Anders' }, jetzt: JETZT }))
      .toThrow(/aus Lexoffice übernommen/);
    const p = bearbeitenPlan({ kunden: ks(), eingabe: { kundenNr: 'K-00001', stand: K1.Stand, Spitzname: 'Kicker' }, jetzt: JETZT });
    expect(p.nachher).toMatchObject({ Spitzname: 'Kicker', Name: K1.Name, Stand: JETZT });
  });
  test('anderer Stand -> 409; Fehlertext ohne Namen', () => {
    let e; try { bearbeitenPlan({ kunden: ks(), eingabe: { kundenNr: 'K-00002', stand: 'alt', Name: 'Neu' }, jetzt: JETZT }); } catch (x) { e = x; }
    expect(e).toMatchObject({ status: 409, code: 'konflikt' });
    expect(e.message).not.toContain('Beispiel');
  });
  test('E-Mail falsch -> Fehler nennt das Feld, nicht den Wert', () => {
    let e; try { bearbeitenPlan({ kunden: ks(), eingabe: { kundenNr: 'K-00002', stand: K2.Stand, 'E-Mail': 'kein-at-zeichen' }, jetzt: JETZT }); } catch (x) { e = x; }
    expect(e.status).toBe(422);
    expect(e.message).not.toContain('kein-at-zeichen');
  });
  test('Archivieren und zurueckholen', () => {
    expect(archivPlan({ kunden: ks(), eingabe: { kundenNr: 'K-00002', stand: K2.Stand }, jetzt: JETZT }).nachher.Status).toBe(STATUS.ARCHIVIERT);
    const arch = ks().map(k => (k.Kunden_Nr === 'K-00002' ? { ...k, Status: 'archiviert' } : k));
    expect(archivPlan({ kunden: arch, eingabe: { kundenNr: 'K-00002', stand: K2.Stand, archivieren: false }, jetzt: JETZT }).nachher.Status).toBe('aktiv');
  });
  test('DSGVO: nur mit getippter Kunden-Nr.; Personenfelder leer, Nummer und Lexoffice-ID bleiben', () => {
    expect(() => dsgvoPlan({ kunden: ks(), eingabe: { kundenNr: 'K-00001', stand: K1.Stand, bestaetigung: 'ja' }, jetzt: JETZT })).toThrow(/eintippen/);
    const p = dsgvoPlan({ kunden: ks(), eingabe: { kundenNr: 'K-00001', stand: K1.Stand, bestaetigung: 'K-00001' }, jetzt: JETZT });
    expect(p.nachher).toMatchObject({ Kunden_Nr: 'K-00001', Lexoffice_ID: 'aaaa-1', Name: 'gelöscht K-00001', Spitzname: '', Notiz: '', Ort: '', Status: 'gesperrt-DSGVO' });
    expect(() => bearbeitenPlan({ kunden: [{ ...p.nachher }], eingabe: { kundenNr: 'K-00001', stand: JETZT, Notiz: 'x' }, jetzt: JETZT })).toThrow(/gesperrt/);
  });
});

describe('Sheet: Schreibwege (kein append, zurueckgelesen)', () => {
  test('Liste lesen; ohne Reiterspalten -> einrichtung', async () => {
    const { sheets } = machSheets(tabsMit(K1, K2));
    expect((await leseKunden({ sheets })).kunden.map(k => k.Kunden_Nr)).toEqual(['K-00001', 'K-00002']);
    const kaputt = machSheets({ [TAB_KUNDEN]: [['Kunden_Nr', 'Name']] });
    await expect(leseKunden({ sheets: kaputt.sheets })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
  });
  test('neuer Kunde: eine Zeile unter der letzten, ohne append', async () => {
    const tabs = tabsMit(K1, K2);
    const { sheets, aufrufe } = machSheets(tabs);
    const r = await legeKundeAn({ eingabe: { Art: 'Firma', Name: 'Neue Testfirma', Spitzname: 'Testi' }, sheets, jetzt });
    expect(r).toMatchObject({ ok: true, kundenNr: 'K-00003', zeile: 4 });
    expect(aufrufe.append).toBe(0);
    expect(tabs[TAB_KUNDEN][3][0]).toBe('K-00003');
  });
  test('bearbeiten ersetzt nur die eine Zeile; Spitzname bleibt durchsuchbar', async () => {
    const tabs = tabsMit(K1, K2);
    const { sheets, aufrufe } = machSheets(tabs);
    await bearbeiteKunde({ eingabe: { kundenNr: 'K-00001', stand: K1.Stand, Spitzname: 'Krokos' }, sheets, jetzt });
    expect(aufrufe.append).toBe(0);
    expect(tabs[TAB_KUNDEN][1][KUNDEN_SPALTEN.indexOf('Spitzname')]).toBe('Krokos');
    _kundenCacheLeeren();
    const { kunden } = await leseKunden({ sheets });
    expect(sucheKunden(kunden, 'krokos').map(k => k.Kunden_Nr)).toEqual(['K-00001']);
  });
  test('archivieren und DSGVO-Sperre schreiben in die Zeile, loeschen nichts', async () => {
    const tabs = tabsMit(K1, K2);
    const { sheets } = machSheets(tabs);
    await archiviereKunde({ eingabe: { kundenNr: 'K-00002', stand: K2.Stand }, sheets, jetzt });
    await sperreKundeDsgvo({ eingabe: { kundenNr: 'K-00001', stand: K1.Stand, bestaetigung: 'K-00001' }, sheets, jetzt });
    expect(tabs[TAB_KUNDEN]).toHaveLength(3);
    expect(tabs[TAB_KUNDEN][2][KUNDEN_SPALTEN.indexOf('Status')]).toBe('archiviert');
    expect(tabs[TAB_KUNDEN][1][KUNDEN_SPALTEN.indexOf('Name')]).toBe('gelöscht K-00001');
    expect(tabs[TAB_KUNDEN][1].join('|')).not.toMatch(/Testverein|Kicker|Musterstadt/);
  });
  test('Import: Trockenlauf schreibt nichts, --write legt an und aendert, zweiter Lauf nichts doppelt', async () => {
    const tabs = tabsMit(K1, K2);
    const { sheets, aufrufe } = machSheets(tabs);
    const kontakte = [firma('aaaa-1', 10001, 'Testverein Musterstadt'), firma('neu-1', 20001, 'Neu A'), person('neu-2', 20002, 'N', 'B')];
    const kontakteLesen = async () => ({ kontakte, seiten: 1 });
    const trocken = await importiereKunden({ dryRun: true, sheets, kontakteLesen, jetzt });
    expect(trocken.plan).toMatchObject({ neu: 2, geaendert: 1 });
    expect(aufrufe.batchUpdate).toEqual([]);
    expect(tabs[TAB_KUNDEN]).toHaveLength(3);

    const echt = await importiereKunden({ dryRun: false, sheets, kontakteLesen, jetzt });
    expect(echt.geschrieben).toMatchObject({ neu: 2, geaendert: 1, ersteNeueZeile: 4 });
    expect(aufrufe.append).toBe(0);
    expect(tabs[TAB_KUNDEN].slice(1).map(r => r[0])).toEqual(['K-00001', 'K-00002', 'K-00003', 'K-00004']);
    const sp = KUNDEN_SPALTEN.indexOf('Spitzname');
    expect(tabs[TAB_KUNDEN][1][sp]).toBe('Kicker; die Blauen');
    expect(tabs[TAB_KUNDEN][1][KUNDEN_SPALTEN.indexOf('Notiz')]).toBe('Polos jedes Jahr');

    const zweit = await importiereKunden({ dryRun: false, sheets, kontakteLesen, jetzt });
    expect(zweit.geschrieben).toMatchObject({ neu: 0, geaendert: 0 });
    expect(tabs[TAB_KUNDEN]).toHaveLength(5);
  });
  test('Import-Antwort enthaelt nur Zahlen, keine Namen', async () => {
    const { sheets } = machSheets(tabsMit(K1));
    const r = await importiereKunden({ dryRun: true, sheets, kontakteLesen: async () => ({ kontakte: [firma('z', 1, 'Geheim GmbH')], seiten: 1 }), jetzt });
    expect(JSON.stringify(r)).not.toMatch(/Geheim|Max|Probe|example|Teststr/);
  });
});

describe('Lexware: nur lesen, Takt, 429, Paging', () => {
  const antwort = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => body });

  test('Paging bis last, nur customer=true, nur GET, Schluessel nur im Header', async () => {
    const urls = [];
    const fetchFn = jest.fn(async (url, opt) => {
      urls.push(url);
      expect(opt.method).toBe('GET');
      expect(opt.headers.Authorization).toBe('Bearer test-schluessel');
      const seite = Number(new URL(url).searchParams.get('page'));
      return antwort(200, { content: [person(`p${seite}`, seite, 'A', 'B')], last: seite === 2, totalPages: 3 });
    });
    const r = await leseKundenKontakte({ schluessel: 'test-schluessel', fetchFn, warte: async () => {} });
    expect(r.seiten).toBe(3);
    expect(r.kontakte).toHaveLength(3);
    for (const u of urls) {
      expect(u).toMatch(/^https:\/\/api\.lexware\.io\/v1\/contacts\?customer=true&page=\d&size=250$/);
      expect(u).not.toContain('test-schluessel');
    }
  });
  test('Takt: zwischen zwei Abrufen mindestens 600 ms', async () => {
    let uhr = 0; const gewartet = [];
    const takt = taktgeber(async ms => { gewartet.push(ms); uhr += ms; }, () => uhr);
    await takt(); await takt(); uhr += 100; await takt();
    expect(gewartet).toEqual([600, 500]);
  });
  test('429: wartet (Retry-After), dann weiter; nach MAX_429 Abbruch ohne Endlosschleife', async () => {
    const gewartet = [];
    let n = 0;
    const f1 = async () => (++n === 1 ? antwort(429, {}, { 'retry-after': '2' }) : antwort(200, { ok: 1 }));
    expect(await lexwareGet('/v1/contacts?page=0', { schluessel: 's', fetchFn: f1, warte: async ms => gewartet.push(ms) })).toEqual({ ok: 1 });
    expect(gewartet).toEqual([2000]);
    const immer = jest.fn(async () => antwort(429, {}));
    await expect(lexwareGet('/v1/contacts', { schluessel: 's', fetchFn: immer, warte: async () => {} })).rejects.toThrow(/Ratenlimit/);
    expect(immer).toHaveBeenCalledTimes(MAX_429 + 1);
  });
  test('Fehlertext: Pfad + Status, nie Antwortinhalt oder Schluessel', async () => {
    const f = async () => ({ ...antwort(401, {}), json: async () => ({ message: 'Max Probe' }) });
    const e = await lexwareGet('/v1/contacts?page=0', { schluessel: 'geheim-123', fetchFn: f, warte: async () => {} }).catch(x => x);
    expect(e.message).toMatch(/\/v1\/contacts: Status 401/);
    expect(e.message).not.toMatch(/geheim-123|Max Probe|page=/);
  });
  test('Quelltext: kein schreibender Aufruf an Lexware', () => {
    const quelle = readFileSync(resolve(hier, '../lib/lexware.js'), 'utf8');
    expect(quelle).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/i);
    expect(quelle.match(/method:\s*'[A-Z]+'/g)).toEqual(["method: 'GET'"]);
    // Nur lib/lexware.js spricht mit api.lexware.io
    for (const datei of ['../lib/kunden.js', '../routes/kunden.js', '../utils/kunden.js', '../scripts/kunden-import.js']) {
      expect(readFileSync(resolve(hier, datei), 'utf8')).not.toContain('api.lexware.io');
    }
  });
});

describe('Log und Schluessel', () => {
  test('Route loggt nur Kunden_Nr; Schluessel nur ueber getSecret, nicht in SECRET_KEYS (Start ohne Schluessel)', async () => {
    const route = readFileSync(resolve(hier, '../routes/kunden.js'), 'utf8');
    for (const z of route.split('\n').filter(l => l.includes('console.'))) expect(z).not.toMatch(/Name|Spitzname|req\.body\?\.(?!archivieren)/);
    const { SECRET_KEYS } = await import('../utils/secrets.js');
    expect(SECRET_KEYS).toContain('KUNDEN_SHEET_ID');
    expect(SECRET_KEYS).not.toContain('LEXWARE_API_KEY');
  });
  test('Backup sichert das Kunden-Sheet als drittes Ziel', async () => {
    const { ZIELE } = await import('../scripts/backup-daily.js');
    expect(ZIELE.map(z => z.envKey)).toEqual(['GOOGLE_SHEET_ID', 'BUSINESS_SHEET_ID', 'KUNDEN_SHEET_ID']);
  });
});
