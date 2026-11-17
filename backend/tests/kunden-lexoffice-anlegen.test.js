// AM-9: neuen MC-Kunden gleich in Lexoffice anlegen. Nur erfundene Daten; Lexware ist eine Attrappe (kein Netz).
// Geprueft: Felder-Zuordnung, Dublettenregel, Anlegen + Zurueckschreiben, Verknuepfen, Fehlerfaelle (Schluessel fehlt,
// 401/403, 406, 429), nie doppelt, Lexoffice nur NEU (kein PUT), Log nur Kunden_Nr, Oberflaeche.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';
import { machSheets } from './hilfen/korb-sheet.js';
import { KUNDEN_SPALTEN, TAB_KUNDEN, kontaktFuerLexware, namensTeile, laenderCode, dublettenAnfragen, dublettenAus, verknuepfenPlan, lexAnlagePruefen } from '../utils/kunden.js';
import { legeKontaktAn, schreibSchluessel, schreibenBereit, _suchTaktNeu, LexwareSchluesselFehlt, SCHLUESSEL_SCHREIBEN, MAX_429 } from '../lib/lexware.js';
import { legeInLexofficeAn, verknuepfeMitLexoffice, _kundenCacheLeeren } from '../lib/kunden.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const JETZT = '2026-11-17T12:00:00.000Z';
const jetzt = () => new Date(JETZT);
const ID_NEU = '44444444-4444-4444-8444-444444444444';
const ID_ALT = '55555555-5555-4555-8555-555555555555';
const zeile = o => KUNDEN_SPALTEN.map(s => o[s] ?? '');
const NEU_FIRMA = { Kunden_Nr: 'K-00010', Art: 'Verein', Name: 'Erfundener Sportverein', Ansprechpartner: 'Erika Beispiel', 'E-Mail': 'info@verein.test',
  Telefon: '+49 000 0000', Strasse: 'Teststraße 1', PLZ: '01234', Ort: 'Musterstadt', Land: 'DE', Notiz: 'intern', Spitzname: 'Erfi', Status: 'aktiv', Quelle: 'mc', Stand: 's1' };
const NEU_PERSON = { Kunden_Nr: 'K-00011', Art: 'Person', Name: 'Max Muster Mann', 'E-Mail': 'max@privat.test', Status: 'aktiv', Quelle: 'mc', Stand: 's2' };
const IN_LEX = { Kunden_Nr: 'K-00001', Art: 'Firma', Name: 'Alte GmbH', Lexoffice_ID: ID_ALT, Lexoffice_Nr: '10001', Status: 'aktiv', Quelle: 'lexoffice', Stand: 's0' };
const tabsMit = (...k) => ({ [TAB_KUNDEN]: [KUNDEN_SPALTEN, ...k.map(zeile)] });
const antwort = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => body });
const zelle = (t, nr, sp) => t[TAB_KUNDEN].find(r => r[0] === nr)[KUNDEN_SPALTEN.indexOf(sp)];

beforeEach(() => {
  process.env.KUNDEN_SHEET_ID = 'kunden-test';
  _kundenCacheLeeren();
  _suchTaktNeu(async () => {}, () => 0);
});

describe('Felder-Zuordnung MC -> Lexware', () => {
  test('Verein/Firma -> company + ein Ansprechpartner, E-Mail/Telefon business, Adresse mit Laendercode; Notiz/Spitzname nie', () => {
    const { kontakt, hinweise } = kontaktFuerLexware(NEU_FIRMA);
    expect(kontakt).toEqual({
      version: 0, roles: { customer: {} },
      company: { name: 'Erfundener Sportverein', contactPersons: [{ firstName: 'Erika', lastName: 'Beispiel', primary: true }] },
      emailAddresses: { business: ['info@verein.test'] }, phoneNumbers: { business: ['+49 000 0000'] },
      addresses: { billing: [{ street: 'Teststraße 1', zip: '01234', city: 'Musterstadt', countryCode: 'DE' }] },
    });
    expect(hinweise).toEqual([]);
    expect(JSON.stringify(kontakt)).not.toMatch(/intern|Erfi|K-00010/);
  });
  test('Person -> person (letztes Wort Nachname), private Kontaktdaten, ohne Adresse keine addresses', () => {
    expect(kontaktFuerLexware(NEU_PERSON).kontakt).toEqual({ version: 0, roles: { customer: {} },
      person: { firstName: 'Max Muster', lastName: 'Mann' }, emailAddresses: { private: ['max@privat.test'] } });
    expect(namensTeile('Mann')).toEqual({ firstName: '', lastName: 'Mann' });
  });
  test('Adresse ohne gueltigen Laendercode: nicht uebertragen + Hinweis ohne Werte; Name fehlt -> 422', () => {
    for (const land of ['', 'Deutschland', 'ES_CN']) {
      const r = kontaktFuerLexware({ ...NEU_FIRMA, Land: land });
      expect(r.kontakt.addresses).toBeUndefined();
      expect(r.hinweise[0]).toMatch(/Länderkürzel/);
      expect(r.hinweise[0]).not.toMatch(/Musterstadt|Teststraße/);
    }
    expect(laenderCode('us')).toBe('US');
    expect(() => kontaktFuerLexware({ ...NEU_FIRMA, Name: '' })).toThrow(/Name fehlt/);
  });
});

describe('Dublettenregel und Verknuepfen', () => {
  test('Anfragen: Name (ganzer Name, Vorname filtert die Suche) und E-Mail; zusammengefuehrt je ID', () => {
    expect(dublettenAnfragen(NEU_PERSON)).toEqual([{ feld: 'name', q: 'Max Muster Mann' }, { feld: 'email', q: 'max@privat.test' }]);
    expect(dublettenAnfragen({ Name: 'AB' })).toEqual([]);
    expect(dublettenAus([[{ id: 'a' }, { id: 'b' }], [{ id: 'a' }]]).map(x => x.id)).toEqual(['a', 'b']);
  });
  test('nur aktiv und ohne Lexoffice_ID; dieselbe ID darf kein anderer MC-Kunde tragen', () => {
    expect(() => lexAnlagePruefen(IN_LEX)).toThrow(/schon mit Lexoffice/);
    expect(() => lexAnlagePruefen({ ...NEU_FIRMA, Status: 'archiviert' })).toThrow(/nicht aktiv/);
    expect(() => verknuepfenPlan({ kunden: [NEU_FIRMA, IN_LEX], kundenNr: 'K-00010', lexofficeId: ID_ALT, jetzt: JETZT })).toThrow(/K-00001/);
    const p = verknuepfenPlan({ kunden: [NEU_FIRMA], kundenNr: 'K-00010', lexofficeId: ID_NEU, lexofficeNr: '10099', jetzt: JETZT });
    expect(p.nachher).toEqual({ ...NEU_FIRMA, Lexoffice_ID: ID_NEU, Lexoffice_Nr: '10099', Stand: JETZT });
  });
});

describe('Ablauf mit Attrappe', () => {
  const setup = (...k) => { const t = tabsMit(...k); return { t, ...machSheets(t) }; };
  test('keine Dublette -> angelegt, Kundennummer per GET, ID + Nr. im Reiter; nur diese Zellen + Stand geaendert', async () => {
    const { t, sheets } = setup(IN_LEX, NEU_FIRMA);
    const vorher = zeile(NEU_FIRMA);
    const anlegen = jest.fn(async () => ({ id: ID_NEU }));
    const r = await legeInLexofficeAn({ eingabe: { kundenNr: 'K-00010' }, sheets, jetzt, suche: async () => ({ kontakte: [] }), anlegen,
      kontaktLesen: async ({ id }) => ({ id, roles: { customer: { number: 10099 } } }) });
    expect(r).toMatchObject({ angelegt: true, lexofficeNr: '10099', kunde: { Lexoffice_ID: ID_NEU, Lexoffice_Nr: '10099' } });
    expect(anlegen).toHaveBeenCalledWith({ kontakt: kontaktFuerLexware(NEU_FIRMA).kontakt });
    const nachher = t[TAB_KUNDEN].find(z => z[0] === 'K-00010');
    const geaendert = KUNDEN_SPALTEN.filter((s, i) => String(nachher[i]) !== String(vorher[i]));
    expect(geaendert.sort()).toEqual(['Lexoffice_ID', 'Lexoffice_Nr', 'Stand']);
  });
  test('Dublette (Name oder E-Mail) -> nichts angelegt, Treffer mit "schon in MC"; "trotzdem" legt an', async () => {
    const { sheets } = setup(IN_LEX, NEU_FIRMA);
    const anlegen = jest.fn(async () => ({ id: ID_NEU }));
    const suche = jest.fn(async ({ feld }) => ({ kontakte: feld === 'email' ? [{ id: ID_ALT, roles: { customer: { number: 10001 } }, company: { name: 'Alte GmbH' } }] : [] }));
    const r = await legeInLexofficeAn({ eingabe: { kundenNr: 'K-00010' }, sheets, jetzt, suche, anlegen, kontaktLesen: async () => ({}) });
    expect(r.angelegt).toBe(false);
    expect(r.treffer).toEqual([expect.objectContaining({ lexofficeId: ID_ALT, inMc: 'K-00001' })]);
    expect(anlegen).not.toHaveBeenCalled();
    expect(suche.mock.calls.map(c => c[0].feld)).toEqual(['name', 'email']);
    const t2 = await legeInLexofficeAn({ eingabe: { kundenNr: 'K-00010', trotzdem: true }, sheets, jetzt, suche, anlegen, kontaktLesen: async () => ({ roles: { customer: { number: 10100 } } }) });
    expect(t2.angelegt).toBe(true);
    expect(suche).toHaveBeenCalledTimes(2);   // "trotzdem" sucht nicht noch einmal
  });
  test('verknuepfen: Kontakt lesen (GET), ID + Nr. eintragen; Lexoffice unveraendert; schon verknuepft -> 409', async () => {
    const { t, sheets } = setup(NEU_PERSON);
    const r = await verknuepfeMitLexoffice({ eingabe: { kundenNr: 'K-00011', lexofficeId: ID_NEU }, sheets, jetzt,
      kontaktLesen: async () => ({ id: ID_NEU, roles: { customer: { number: 10200 } } }) });
    expect(r).toMatchObject({ kundenNr: 'K-00011', lexofficeNr: '10200' });
    expect(zelle(t, 'K-00011', 'Lexoffice_ID')).toBe(ID_NEU);
    _kundenCacheLeeren();
    await expect(verknuepfeMitLexoffice({ eingabe: { kundenNr: 'K-00011', lexofficeId: ID_NEU }, sheets, jetzt,
      kontaktLesen: async () => ({ id: ID_NEU, roles: { customer: {} } }) })).rejects.toMatchObject({ status: 409, code: 'lex_schon' });
  });
  test('Schluessel fehlt / Lexware 401: 503 lexware_schluessel, MC-Zeile unveraendert', async () => {
    const { t, sheets } = setup(NEU_FIRMA);
    const vorher = JSON.stringify(t[TAB_KUNDEN]);
    await expect(legeInLexofficeAn({ eingabe: { kundenNr: 'K-00010', trotzdem: true }, sheets, jetzt,
      anlegen: async () => { throw new LexwareSchluesselFehlt(); } })).rejects.toMatchObject({ status: 503, code: 'lexware_schluessel' });
    expect(JSON.stringify(t[TAB_KUNDEN])).toBe(vorher);
  });
  test('angelegt, aber Sheet scheitert -> 409 lex_angelegt mit Nr.; zweiter Versuch findet die Dublette (nie doppelt)', async () => {
    const { sheets } = setup(NEU_FIRMA);
    sheets.spreadsheets.values.update = async () => { throw new Error('Sheets weg'); };
    sheets.spreadsheets.values.batchUpdate = async () => { throw new Error('Sheets weg'); };
    const anlegen = jest.fn(async () => ({ id: ID_NEU }));
    const e = await legeInLexofficeAn({ eingabe: { kundenNr: 'K-00010' }, sheets, jetzt, suche: async () => ({ kontakte: [] }), anlegen,
      kontaktLesen: async () => ({ roles: { customer: { number: 10300 } } }) }).catch(x => x);
    expect(e).toMatchObject({ status: 409, code: 'lex_angelegt' });
    expect(e.message).toMatch(/10300/);
  });
  test('Doppelklick: zweiter Aufruf waehrend des ersten -> 409 laeuft_gerade, nur ein POST', async () => {
    const { sheets } = setup(NEU_FIRMA);
    let los;
    const warten = new Promise(r => { los = r; });
    const anlegen = jest.fn(async () => { await warten; return { id: ID_NEU }; });
    const a = legeInLexofficeAn({ eingabe: { kundenNr: 'K-00010', trotzdem: true }, sheets, jetzt, anlegen, kontaktLesen: async () => ({}) });
    await new Promise(r => setTimeout(r, 10));
    await expect(legeInLexofficeAn({ eingabe: { kundenNr: 'K-00010', trotzdem: true }, sheets, jetzt, anlegen, kontaktLesen: async () => ({}) }))
      .rejects.toMatchObject({ code: 'laeuft_gerade' });
    los();
    await a;
    expect(anlegen).toHaveBeenCalledTimes(1);
  });
});

describe('POST an Lexware (Attrappe statt Netz)', () => {
  test('POST /v1/contacts mit dem Schreib-Schluessel, Body als JSON; 429 wartet und wiederholt', async () => {
    const aufrufe = [];
    let n = 0;
    const fetchFn = async (url, opt) => { aufrufe.push({ url, opt }); return ++n === 1 ? antwort(429, {}, { 'retry-after': '1' }) : antwort(201, { id: ID_NEU, version: 1 }); };
    const r = await legeKontaktAn({ kontakt: { version: 0 }, schluessel: 'schreib-schluessel', fetchFn, warte: async () => {} });
    expect(r).toEqual({ id: ID_NEU });
    expect(aufrufe).toHaveLength(2);
    expect(aufrufe[1].url).toBe('https://api.lexware.io/v1/contacts');
    expect(aufrufe[1].opt).toMatchObject({ method: 'POST', body: '{"version":0}' });
    expect(aufrufe[1].opt.headers).toMatchObject({ Authorization: 'Bearer schreib-schluessel', 'Content-Type': 'application/json' });
  });
  test('401/403 -> LexwareSchluesselFehlt; 406 -> Feldnamen, nie Werte; Netzfehler ohne Wiederholung', async () => {
    for (const s of [401, 403]) {
      await expect(legeKontaktAn({ kontakt: {}, schluessel: 'x', fetchFn: async () => antwort(s, {}), warte: async () => {} })).rejects.toMatchObject({ code: 'lexware_schluessel' });
    }
    const e = await legeKontaktAn({ kontakt: {}, schluessel: 'x', warte: async () => {},
      fetchFn: async () => antwort(406, { IssueList: [{ i18nKey: 'missing_entity', source: 'addresses.billing[0].countryCode', additionalData: 'Musterstadt' }] }) }).catch(x => x);
    expect(e.message).toMatch(/406, Felder: addresses\.billing\[0\]\.countryCode/);
    expect(e.message).not.toMatch(/Musterstadt/);
    let n = 0;
    await expect(legeKontaktAn({ kontakt: {}, schluessel: 'x', warte: async () => {}, fetchFn: async () => { n++; throw new Error('ECONNRESET'); } })).rejects.toThrow(/keine Verbindung/);
    expect(n).toBe(1);
    let m = 0;
    await expect(legeKontaktAn({ kontakt: {}, schluessel: 'x', warte: async () => {}, fetchFn: async () => { m++; return antwort(429, {}); } })).rejects.toThrow(/Ratenlimit/);
    expect(m).toBe(MAX_429 + 1);
  });
  test('Schluessel: nur LEXWARE_API_KEY_KONTAKTE_SCHREIBEN; leer/nicht lesbar -> fehlt, bereit false', async () => {
    const gelesen = [];
    expect(await schreibSchluessel(async k => { gelesen.push(k); return 'w'; })).toBe('w');
    expect(gelesen).toEqual([SCHLUESSEL_SCHREIBEN]);
    await expect(schreibSchluessel(async () => '')).rejects.toBeInstanceOf(LexwareSchluesselFehlt);
    expect(await schreibenBereit(async () => { throw new Error('PERMISSION_DENIED'); })).toBe(false);
    expect(await schreibenBereit(async () => 'w')).toBe(true);
  });
});

describe('Route und Oberflaeche', () => {
  test('Route: Log nur Kunden_Nr und Ergebnis', async () => {
    const quelle = readFileSync(resolve(hier, '../routes/kunden.js'), 'utf8');
    const block = quelle.slice(quelle.indexOf('// ── AM-9'), quelle.indexOf("router.post('/neu'"));
    for (const log of block.match(/console\.\w+\([^;]*\);/g)) expect(log).not.toMatch(/Name|E-Mail|treffer\b(?!\?\.length)|body/);
  });
  test('Dialog: Haken vorausgewaehlt nur beim neuen Kunden, Knopf "in Lexoffice anlegen" am Kunden, Mouse-over, kein title', () => {
    expect(html).toContain('id="ku-lex-anlegen" checked');
    expect(html).toContain('data-hilfe="ku-lex-anlegen"');
    expect(html).toContain('id="ku-lex-nachholen"');
    expect(html).toMatch(/'ku-lex-anlegen':\s*\{ name:/);
    expect(html).toMatch(/'ku-lex-nachholen':\s*\{ name:/);
    expect(html).toMatch(/'ku-lex-verknuepfen':\s*\{ name:/);
    const block = html.slice(html.indexOf('// ── Kunde-Lexoffice: Anfang'), html.indexOf('// ── Kunde-Lexoffice: Ende'));
    expect(block.length).toBeGreaterThan(500);
    expect(block).not.toMatch(/\stitle=|localStorage|sessionStorage|console\./);
  });
});
