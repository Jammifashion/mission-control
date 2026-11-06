// AM-1-1: einzelne Kunden bei Bedarf aus Lexoffice (Suche -> auswaehlen -> uebernehmen), Import-Folgelauf,
// Dashboard-Kachel und Reihenfolge der Bereiche. Nur erfundene Daten.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import { KUNDEN_SPALTEN, TAB_KUNDEN, kundenZeilen, importPlan, lexTreffer, uebernahmePlan, kundenZahlen } from '../utils/kunden.js';
import { suchAnfrage, sucheKundenKontakte, leseKontakt, _suchTaktNeu, SUCH_GROESSE, MAX_429, AUSWEICH_SEITEN } from '../lib/lexware.js';
import { sucheInLexoffice, uebernehmeAusLexoffice, leseKundenZahlen, _kundenCacheLeeren } from '../lib/kunden.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const JETZT = '2026-11-03T12:00:00.000Z';
const jetzt = () => new Date(JETZT);
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';

const zeile = o => KUNDEN_SPALTEN.map(s => o[s] ?? '');
const FIRMA_IN_MC = { Kunden_Nr: 'K-00001', Lexoffice_Nr: '10001', Lexoffice_ID: ID1, Art: 'Firma', Name: 'Erfundene GmbH', Status: 'aktiv', Quelle: 'lexoffice', Stand: 's1' };
const GESPERRT = { Kunden_Nr: 'K-00002', Lexoffice_Nr: '10003', Lexoffice_ID: ID3, Art: 'Person', Name: 'gelöscht K-00002', Status: 'gesperrt-DSGVO', Quelle: 'lexoffice', Stand: 's2' };
const tabsMit = (...k) => ({ [TAB_KUNDEN]: [KUNDEN_SPALTEN, ...k.map(zeile)] });
const person = (id, nr, vor, nach, extra = {}) => ({ id, roles: { customer: { number: nr } }, person: { firstName: vor, lastName: nach },
  addresses: { billing: [{ zip: '01234', city: 'Musterstadt', countryCode: 'DE' }] }, ...extra });
const firma = (id, nr, name) => ({ id, roles: { customer: { number: nr } }, company: { name } });
const antwort = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => body });

beforeEach(() => {
  process.env.KUNDEN_SHEET_ID = 'kunden-test';
  _kundenCacheLeeren();
  _suchTaktNeu(async () => {}, () => 0);
});

describe('Lexoffice-Suche (nur lesen)', () => {
  test('Name, E-Mail, Kundennummer -> eine Seite, nur Kunden, Suchbegriff kodiert', () => {
    expect(suchAnfrage('name', 'Mül ler')).toBe(`/v1/contacts?customer=true&name=M%C3%BCl%20ler&page=0&size=${SUCH_GROESSE}`);
    expect(suchAnfrage('email', 'a@b.test')).toContain('customer=true&email=a%40b.test&page=0&size=25');
    expect(suchAnfrage('number', '10007')).toContain('customer=true&number=10007');
  });
  test('Mindestlaenge 3, Nummer nur Ziffern, unbekanntes Feld -> 422; Fehlertext ohne den Suchbegriff', () => {
    for (const [f, q] of [['name', 'ab'], ['email', ' x '], ['number', '12a'], ['vorname', 'Paula']]) {
      let e; try { suchAnfrage(f, q); } catch (x) { e = x; }
      expect(e.status).toBe(422);
      expect(e.message).not.toContain(q.trim() || '§');
    }
  });
  test('Treffer begrenzt, "mehr" gemeldet; nur GET mit Schluessel im Header', async () => {
    const fetchFn = jest.fn(async (url, opt) => {
      expect(opt.method).toBe('GET');
      expect(url).toContain('customer=true');
      return antwort(200, { content: Array.from({ length: 25 }, (_, i) => person(`id-${i}`, i, 'A', 'B')), totalElements: 40, last: false });
    });
    const r = await sucheKundenKontakte({ feld: 'name', q: 'Platzhalter', schluessel: 'k', fetchFn, warte: async () => {} });
    expect(r.kontakte).toHaveLength(25);
    expect(r.mehr).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  test('Vor- und Nachname zusammen: 0 Treffer -> Ausweich ueber das laengste Wort, jedes Wort muss passen', async () => {
    const urls = [];
    const fetchFn = jest.fn(async url => {
      urls.push(decodeURIComponent(url));
      if (url.includes('name=Paula%20Platzhalter')) return antwort(200, { content: [], totalElements: 0, last: true });
      return antwort(200, { content: [person('a', 1, 'Paula', 'Platzhalter'), person('b', 2, 'Peter', 'Platzhalter'), firma('c', 3, 'Platzhalter Bau GmbH')], last: true });
    });
    const r = await sucheKundenKontakte({ feld: 'name', q: 'Paula Platzhalter', schluessel: 'k', fetchFn, warte: async () => {} });
    expect(r.kontakte.map(c => c.id)).toEqual(['a']);
    expect(r.mehr).toBe(false);
    expect(urls[1]).toContain('name=Platzhalter&page=0');
    // Treffer schon beim ersten Mal (z. B. Firma mit Leerzeichen) -> keine zweite Anfrage
    const f2 = jest.fn(async () => antwort(200, { content: [firma('c', 3, 'Platzhalter Bau GmbH')], last: true }));
    expect((await sucheKundenKontakte({ feld: 'name', q: 'Platzhalter Bau', schluessel: 'k', fetchFn: f2, warte: async () => {} })).kontakte).toHaveLength(1);
    expect(f2).toHaveBeenCalledTimes(1);
  });
  test('Ausweich hoechstens AUSWEICH_SEITEN Seiten, dann "mehr"', async () => {
    const fetchFn = jest.fn(async url => (url.includes('%20')
      ? antwort(200, { content: [], last: true })
      : antwort(200, { content: Array.from({ length: 25 }, (_, i) => person(`p${i}`, i, 'Paula', 'Platzhalter')), last: false })));
    const r = await sucheKundenKontakte({ feld: 'name', q: 'Paula Platzhalter', schluessel: 'k', fetchFn, warte: async () => {} });
    expect(fetchFn).toHaveBeenCalledTimes(1 + AUSWEICH_SEITEN);
    expect(r.kontakte).toHaveLength(25);
    expect(r.mehr).toBe(true);
  });
  test('429 bei der Suche: warten, dann Abbruch nach MAX_429', async () => {
    const fetchFn = jest.fn(async () => antwort(429, {}));
    await expect(sucheKundenKontakte({ feld: 'name', q: 'Platzhalter', schluessel: 'k', fetchFn, warte: async () => {} })).rejects.toThrow(/Ratenlimit/);
    expect(fetchFn).toHaveBeenCalledTimes(MAX_429 + 1);
  });
  test('Einzelabruf nur mit gueltiger ID', async () => {
    await expect(leseKontakt({ id: '../etwas', schluessel: 'k' })).rejects.toMatchObject({ status: 422 });
    const fetchFn = jest.fn(async url => { expect(url).toBe(`https://api.lexware.io/v1/contacts/${ID2}`); return antwort(200, person(ID2, 2, 'A', 'B')); });
    expect((await leseKontakt({ id: ID2, schluessel: 'k', fetchFn })).id).toBe(ID2);
  });
});

describe('Trefferliste und "schon in MC"', () => {
  const kunden = kundenZeilen(tabsMit(FIRMA_IN_MC, GESPERRT)[TAB_KUNDEN]).kunden;
  test('nur Name, Art, Ort, Nr., ID; schon in MC ueber ID; gesperrt markiert', () => {
    const t = lexTreffer([firma(ID1, 10001, 'Erfundene GmbH'), person(ID2, 10002, 'Paula', 'Platzhalter', { emailAddresses: { private: ['p@example.test'] } }), person(ID3, 10003, 'X', 'Y')], kunden);
    expect(t[0]).toMatchObject({ inMc: 'K-00001', art: 'Firma' });
    expect(t[1]).toEqual({ lexofficeId: ID2, lexofficeNr: '10002', art: 'Person', name: 'Paula Platzhalter', ort: '01234 Musterstadt', archiviert: false, inMc: null, gesperrt: false });
    expect(JSON.stringify(t)).not.toContain('p@example.test');
    expect(t[2]).toMatchObject({ inMc: 'K-00002', gesperrt: true });
  });
  test('Suche ueber lib: Antwort nur Treffer, Sheet nur gelesen', async () => {
    const { sheets, aufrufe } = machSheets(tabsMit(FIRMA_IN_MC));
    const r = await sucheInLexoffice({ feld: 'name', q: 'Platz', sheets, suche: async () => ({ kontakte: [person(ID2, 10002, 'Paula', 'Platzhalter')], mehr: false }) });
    expect(r).toEqual({ treffer: [expect.objectContaining({ lexofficeId: ID2, inMc: null })], mehr: false });
    expect(aufrufe.update).toEqual([]);
    expect(aufrufe.batchUpdate).toEqual([]);
  });
});

describe('Uebernehmen genau eines Kunden', () => {
  test('Plan: neu mit K-Nr., Quelle lexoffice, aktiv; schon da -> schon; kein Kunde -> 422; gesperrt -> 409', () => {
    const kunden = kundenZeilen(tabsMit(FIRMA_IN_MC, GESPERRT)[TAB_KUNDEN]).kunden;
    expect(uebernahmePlan({ kunden, kontakt: person(ID2, 10002, 'Paula', 'Platzhalter'), jetzt: JETZT }).neu)
      .toMatchObject({ Kunden_Nr: 'K-00003', Quelle: 'lexoffice', Status: 'aktiv', Spitzname: '', Notiz: '', Lexoffice_ID: ID2 });
    expect(uebernahmePlan({ kunden, kontakt: firma(ID1, 10001, 'Erfundene GmbH'), jetzt: JETZT }).schon.Kunden_Nr).toBe('K-00001');
    expect(() => uebernahmePlan({ kunden, kontakt: { id: ID2, person: { lastName: 'L' }, roles: { vendor: {} } }, jetzt: JETZT })).toThrow(/kein Kunde/);
    expect(() => uebernahmePlan({ kunden, kontakt: person(ID3, 10003, 'X', 'Y'), jetzt: JETZT })).toThrow(/gesperrt/);
  });
  test('Doppelklick: zweimal derselbe Kontakt -> genau eine Zeile, kein append', async () => {
    const tabs = tabsMit(FIRMA_IN_MC);
    const { sheets, aufrufe } = machSheets(tabs);
    const kontaktLesen = async ({ id }) => person(id, 10002, 'Paula', 'Platzhalter');
    const a = await uebernehmeAusLexoffice({ lexofficeId: ID2, sheets, kontaktLesen, jetzt });
    _kundenCacheLeeren();
    const b = await uebernehmeAusLexoffice({ lexofficeId: ID2, sheets, kontaktLesen, jetzt });
    expect(a).toMatchObject({ schon: false, kundenNr: 'K-00002' });
    expect(b).toMatchObject({ schon: true, kundenNr: 'K-00002' });
    expect(tabs[TAB_KUNDEN]).toHaveLength(3);
    expect(aufrufe.append).toBe(0);
  });
  test('gleichzeitige Uebernahme: die zweite bekommt 409 "gleich noch einmal", nichts doppelt', async () => {
    const tabs = tabsMit(FIRMA_IN_MC);
    const { sheets } = machSheets(tabs);
    const kontaktLesen = async ({ id }) => person(id, 10002, 'Paula', 'Platzhalter');
    const r = await Promise.allSettled([
      uebernehmeAusLexoffice({ lexofficeId: ID2, sheets, kontaktLesen, jetzt }),
      uebernehmeAusLexoffice({ lexofficeId: ID2, sheets, kontaktLesen, jetzt }),
    ]);
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.find(x => x.status === 'rejected')?.reason).toMatchObject({ status: 409 });
    expect(tabs[TAB_KUNDEN]).toHaveLength(3);
  });
});

describe('Import-Folgelauf (nur Firmen + schon uebernommene)', () => {
  test('einzeln uebernommene Person wird abgeglichen, andere Personen nicht geholt', () => {
    const uebernommen = { Kunden_Nr: 'K-00002', Lexoffice_Nr: '10002', Lexoffice_ID: ID2, Art: 'Person', Name: 'Paula Platzhalter', Spitzname: 'PP', Ort: 'Musterstadt', PLZ: '01234', Land: 'DE', Status: 'aktiv', Quelle: 'lexoffice', Stand: 's' };
    const kunden = kundenZeilen(tabsMit(FIRMA_IN_MC, uebernommen)[TAB_KUNDEN]).kunden;
    const p = importPlan({ kunden, kontakte: [
      firma(ID1, 10001, 'Erfundene GmbH'),
      person(ID2, 10002, 'Paula', 'Neuname'),
      person('44444444-4444-4444-8444-444444444444', 10004, 'Nicht', 'Geholt'),
    ], jetzt: JETZT, nurFirmen: true });
    expect(p.neu).toEqual([]);
    expect(p.zaehler).toMatchObject({ personenAbgeglichen: 1, personenUebersprungen: 1 });
    expect(p.aenderungen.find(a => a.kundenNr === 'K-00002').felder).toMatchObject({ Name: 'Paula Neuname' });
    expect(p.aenderungen.find(a => a.kundenNr === 'K-00002').felder).not.toHaveProperty('Spitzname');
  });
});

describe('Zahlen und Dashboard-Kachel', () => {
  test('GET zahlen: nur Zahlen', async () => {
    const { sheets } = machSheets(tabsMit(FIRMA_IN_MC, GESPERRT));
    const z = await leseKundenZahlen({ sheets });
    expect(z).toEqual({ gesamt: 2, aktiv: 1, archiviert: 0, gesperrt: 1, firmen: 1, vereine: 0, personen: 1 });
    expect(kundenZahlen([])).toMatchObject({ gesamt: 0, aktiv: 0 });
  });
  // DB1: Die Dashboard-Kachel "Aufträge" ist in das neue Dashboard aufgegangen (Abschnitt "Eigene Aufträge", nur Zahlen).
  const kb = html.slice(html.indexOf('// ── Dashboard-Anzeige: Anfang'), html.indexOf('// ── Dashboard-Anzeige: Ende ──'));
  const K = new Function(`${kb}\nreturn { dbAuHtml };`)();
  test('Eigene Auftraege: nur Zahlen je Status, klickbar mit Mouse-over; Quelle fehlt -> "–"', () => {
    const h = K.dbAuHtml({ Anfrage: 1, Angebot: 0, Design: 0, bestellt: 2, 'in Produktion': 0, fertigNichtBezahlt: 2, terminBald: 1, aufgabenOffen: 0, offen: 5 });
    expect(h).toContain('fertig, nicht bezahlt: <strong>2</strong>');
    expect(h).toContain('Termin ≤ 7 Tage: <strong>1</strong>');
    expect(h).toContain('data-hilfe="dash-au-status"');
    expect(K.dbAuHtml({ fehlt: ['auftraege'] })).toContain('– nicht geladen: Aufträge');
    expect(html).not.toContain('id="dash-auftraege"');
  });
});

describe('Navigation und Datenschutz', () => {
  test('Aufträge direkt hinter Dashboard, vor Bestellen (Tabelle und Hauptleiste)', () => {
    const knoepfe = [...html.matchAll(/<button[^>]*data-bereich="([a-z]+)"/g)].map(m => m[1]);
    expect(knoepfe.slice(0, 3)).toEqual(['dashboard', 'auftraege', 'bestellen']);
    const tabelle = html.slice(html.indexOf('const BEREICHE = {'), html.indexOf('// ── Navigation-Tabelle: Ende ──'));
    expect(tabelle.indexOf('auftraege: {')).toBeGreaterThan(tabelle.indexOf('dashboard: {'));
    expect(tabelle.indexOf('auftraege: {')).toBeLessThan(tabelle.indexOf('bestellen: {'));
    // Inhaber 03.11.: im Bereich Aufträge der Unterpunkt Aufträge vor Kunden
    const au = tabelle.slice(tabelle.indexOf('auftraege: {'), tabelle.indexOf('bestellen: {'));
    expect([...au.matchAll(/id: '([a-z]+)'/g)].map(m => m[1])).toEqual(['liste', 'todos', 'kunden']);   // AM-4: Offene To-dos hinter Auftraege
  });
  test('Suchbegriff geht per POST (nie in die Adresse), Route loggt keinen Suchbegriff/Namen', () => {
    const route = readFileSync(resolve(hier, '../routes/kunden.js'), 'utf8');
    expect(route).toContain("router.post('/lexoffice-suche'");
    for (const z of route.split('\n').filter(l => l.includes('console.'))) expect(z).not.toMatch(/req\.body\?\.q|feld|name|Name/);
    const lib = readFileSync(resolve(hier, '../lib/kunden.js'), 'utf8');
    expect(lib.split('\n').filter(l => l.includes('console.'))).toEqual([]);
    const js = html.slice(html.indexOf('// ── AM-1-1: Kunde suchen'), html.indexOf('// ── SECTION: Artikelerfassung ──')).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    expect(js).not.toMatch(/localStorage|sessionStorage|location\.hash|history\./);
    expect(js).toContain("klPost('lexoffice-suche', { feld, q: q.trim() })");
  });
  test('Quelltext: weiter kein schreibender Lexware-Aufruf', () => {
    const quelle = readFileSync(resolve(hier, '../lib/lexware.js'), 'utf8');
    expect(quelle.match(/method:\s*'[A-Z]+'/g)).toEqual(["method: 'GET'"]);
  });
});
