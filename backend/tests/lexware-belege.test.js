// RE2: Lexware-Belegleser (nur lesen). Nur ERFUNDENE IDs, Namen und Betraege; Lexware nur als Attrappe.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  leseBelegliste, leseRechnung, beleglisteAbfrage, belegSchluessel, belegeBereit, _belegTaktNeu,
  SCHLUESSEL_BELEGE, MAX_SEITEN_BELEGE,
} from '../lib/lexwareBelege.js';
import { sucheEntwuerfe } from '../lib/lexwareRechnung.js';
import { taktgeber, TAKT_MS } from '../lib/lexware.js';
import { SECRET_KEYS } from '../utils/secrets.js';

const hier = dirname(fileURLToPath(import.meta.url));
const KONTAKT = '11111111-2222-4333-8444-555555555555';
const RE_ID = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const antwort = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
const beleg = (n, extra = {}) => ({
  id: `0b1c2d3e-4f50-4617-8899-${String(n).padStart(12, '0')}`, voucherType: 'invoice', voucherStatus: 'draft', voucherNumber: '',
  voucherDate: '2026-11-22T00:00:00.000+01:00', createdDate: '2026-11-22T10:00:00.000+01:00', updatedDate: '2026-11-22T10:00:00.000+01:00',
  contactId: KONTAKT, contactName: 'Testverein Erfunden', totalAmount: 69, openAmount: 69, currency: 'EUR', archived: false, ...extra,
});

/** Attrappe: zeichnet URL + Methode auf, liefert Seiten nacheinander. */
function attrappe(seiten) {
  const aufrufe = [];
  let i = 0;
  const fetchFn = async (url, o) => { aufrufe.push({ url, methode: o.method, auth: o.headers.Authorization }); return seiten[Math.min(i++, seiten.length - 1)](); };
  return { aufrufe, fetchFn };
}

beforeEach(() => _belegTaktNeu(async () => {}, () => 0));

describe('Abfrage', () => {
  test('feste Reihenfolge, geprueft', () => {
    const q = beleglisteAbfrage({ voucherStatus: ['draft', 'open'], contactId: KONTAKT, createdDateFrom: '2026-11-01', sort: 'createdDate,DESC' });
    expect(q.toString()).toBe(`voucherType=invoice&voucherStatus=draft%2Copen&contactId=${KONTAKT}&createdDateFrom=2026-11-01&sort=createdDate%2CDESC`);
  });
  test.each([
    [{ voucherStatus: 'bezahlt' }, /Belegstatus unbekannt/],
    [{ voucherStatus: 'draft', voucherType: 'rechnung' }, /Belegart unbekannt/],
    [{ voucherStatus: '' }, /Belegstatus fehlt/],
    [{ voucherStatus: 'draft', contactId: 'abc' }, /Kontakt-ID/],
    [{ voucherStatus: 'draft', voucherDateFrom: '22.11.2026' }, /JJJJ-MM-TT/],
    [{ voucherStatus: 'draft', sort: 'name,ASC' }, /Sortierung/],
    [{ voucherStatus: 'draft', contactName: 'x' }, /unbekannter Filter/],
    [{ voucherStatus: 'draft', voucherNumber: 'RE 1&x=y' }, /Belegnummer/],
  ])('ungueltig %#', (filter, re) => {
    expect(() => beleglisteAbfrage(filter)).toThrow(re);
    try { beleglisteAbfrage(filter); } catch (e) { expect(e.status).toBe(422); }
  });
});

describe('Belegliste (Attrappe)', () => {
  test('nur GET auf /v1/voucherlist, Felder ohne contactName', async () => {
    const { aufrufe, fetchFn } = attrappe([() => antwort(200, { content: [beleg(1)], last: true, totalPages: 1 })]);
    const r = await leseBelegliste({ voucherStatus: 'draft', contactId: KONTAKT }, { schluessel: 'geheim-b', fetchFn });
    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0].methode).toBe('GET');
    expect(aufrufe[0].url).toMatch(/^https:\/\/api\.lexware\.io\/v1\/voucherlist\?voucherType=invoice&voucherStatus=draft&contactId=.*&page=0&size=250$/);
    expect(aufrufe[0].auth).toBe('Bearer geheim-b');
    expect(r).toMatchObject({ seiten: 1, mehr: false });
    expect(r.belege[0]).toMatchObject({ id: beleg(1).id, voucherStatus: 'draft', voucherDate: '2026-11-22', totalAmount: 69, contactId: KONTAKT });
    expect(JSON.stringify(r)).not.toContain('Testverein');
  });
  test('mehrere Seiten nacheinander, Abbruch an der Grenze mit mehr=true', async () => {
    const voll = () => antwort(200, { content: [beleg(1), beleg(2)], last: false, totalPages: 99 });
    const { aufrufe, fetchFn } = attrappe([voll]);
    const r = await leseBelegliste({ voucherStatus: 'any' }, { schluessel: 's', fetchFn, maxSeiten: 3, groesse: 2 });
    expect(aufrufe.map(a => new URL(a.url).searchParams.get('page'))).toEqual(['0', '1', '2']);
    expect(r).toMatchObject({ seiten: 3, mehr: true });
    expect(r.belege).toHaveLength(6);
  });
  test('maxSeiten nie ueber MAX_SEITEN_BELEGE', async () => {
    const { aufrufe, fetchFn } = attrappe([() => antwort(200, { content: [beleg(1)], last: false })]);
    await leseBelegliste({ voucherStatus: 'any' }, { schluessel: 's', fetchFn, maxSeiten: 999, groesse: 1 });
    expect(aufrufe).toHaveLength(MAX_SEITEN_BELEGE);
  });
  test('429 wartet und wiederholt, dann ok', async () => {
    const { aufrufe, fetchFn } = attrappe([() => antwort(429, {}), () => antwort(200, { content: [], last: true })]);
    const r = await leseBelegliste({ voucherStatus: 'paid' }, { schluessel: 's', fetchFn, warte: async () => {} });
    expect(aufrufe).toHaveLength(2);
    expect(r.belege).toEqual([]);
  });
  test('403: Fehlertext nur Pfad + Status + Recht, nie Inhalt, Query oder Schluessel', async () => {
    const { fetchFn } = attrappe([() => ({ ...antwort(403, {}), json: async () => ({ message: 'Testverein Erfunden' }) })]);
    const e = await leseBelegliste({ voucherStatus: 'draft', contactId: KONTAKT }, { schluessel: 'geheim-b', fetchFn }).catch(x => x);
    expect(e.message).toBe('Lexware /v1/voucherlist: Status 403 (Schlüssel ohne Recht auf Belege lesen).');
    expect(e.lexwareStatus).toBe(403);
    expect(e.message).not.toMatch(/geheim|Testverein|contactId|page=/);
  });
  test('Zeitlimit bricht ab', async () => {
    const fetchFn = (u, o) => new Promise((_, nein) => o.signal.addEventListener('abort', () => nein(Object.assign(new Error('a'), { name: 'AbortError' }))));
    await expect(leseBelegliste({ voucherStatus: 'draft' }, { schluessel: 's', fetchFn, zeitlimitMs: 20 })).rejects.toThrow(/voucherlist: Zeitlimit/);
  });
  test('Antwort ohne content -> Fehler', async () => {
    const { fetchFn } = attrappe([() => antwort(200, {})]);
    await expect(leseBelegliste({ voucherStatus: 'draft' }, { schluessel: 's', fetchFn })).rejects.toThrow(/ohne Liste/);
  });
});

describe('Einzelne Rechnung (Attrappe)', () => {
  test('GET /v1/invoices/{id}, ohne Adresse und Positionstexte', async () => {
    const { aufrufe, fetchFn } = attrappe([() => antwort(200, {
      id: RE_ID, voucherNumber: 'RE0001', voucherStatus: 'open', voucherDate: '2026-11-22T00:00:00.000+01:00',
      address: { contactId: KONTAKT, name: 'Testverein Erfunden', street: 'Erfundene Str. 1' },
      lineItems: [{ name: 'Shirt für Erfunden' }, { name: 'Porto' }], taxConditions: { taxType: 'gross' },
      totalPrice: { currency: 'EUR', totalNetAmount: 57.98, totalGrossAmount: 69, totalTaxAmount: 11.02 }, remark: 'Danke Erfunden',
    })]);
    const r = await leseRechnung({ id: RE_ID, schluessel: 's', fetchFn });
    expect(aufrufe).toEqual([expect.objectContaining({ url: `https://api.lexware.io/v1/invoices/${RE_ID}`, methode: 'GET' })]);
    expect(r).toMatchObject({ id: RE_ID, voucherStatus: 'open', contactId: KONTAKT, totalGrossAmount: 69, positionen: 2, taxType: 'gross' });
    expect(JSON.stringify(r)).not.toMatch(/Erfunden|Str\./);
  });
  test('ungueltige ID -> 422 ohne Abruf; 404 -> Status 404', async () => {
    const { aufrufe, fetchFn } = attrappe([() => antwort(404, {})]);
    await expect(leseRechnung({ id: '../contacts', schluessel: 's', fetchFn })).rejects.toMatchObject({ status: 422 });
    expect(aufrufe).toHaveLength(0);
    await expect(leseRechnung({ id: RE_ID, schluessel: 's', fetchFn })).rejects.toMatchObject({ lexwareStatus: 404 });
  });
});

describe('Schluessel', () => {
  test('fehlt -> 503 lexware_belege; nicht in SECRET_KEYS', async () => {
    await expect(belegSchluessel(async () => '')).rejects.toMatchObject({ status: 503, code: 'lexware_belege' });
    await expect(belegSchluessel(async () => { throw new Error('x'); })).rejects.toMatchObject({ status: 503 });
    expect(await belegeBereit(async () => 'k')).toBe(true);
    expect(await belegeBereit(async () => '')).toBe(false);
    expect(SECRET_KEYS).not.toContain(SCHLUESSEL_BELEGE);
  });
  test('Takt: zwei Abrufe mindestens TAKT_MS auseinander', async () => {
    let jetzt = 0; const gewartet = [];
    const t = taktgeber(async ms => { gewartet.push(ms); jetzt += ms; }, () => jetzt);
    await t(); await t();
    expect(gewartet).toEqual([TAKT_MS]);
    expect(TAKT_MS).toBeGreaterThanOrEqual(500);
  });
});

describe('In Lexware nachsehen (RE1) ueber den Belegleser', () => {
  test('Entwuerfe ueber den Belege-Schluessel, ohne contactName', async () => {
    const { aufrufe, fetchFn } = attrappe([() => antwort(200, { content: [beleg(1)], last: true })]);
    const r = await sucheEntwuerfe({ kontaktId: KONTAKT, seit: '2026-11-22', schluessel: 'belege-k', fetchFn });
    expect(r).toEqual({ ok: true, entwuerfe: [{ id: beleg(1).id, voucherDate: '2026-11-22', createdDate: beleg(1).createdDate, totalAmount: 69 }] });
    const u = new URL(aufrufe[0].url);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ voucherType: 'invoice', voucherStatus: 'draft', contactId: KONTAKT, createdDateFrom: '2026-11-22', size: '25', page: '0' });
    expect(aufrufe[0].auth).toBe('Bearer belege-k');
  });
  test('Belege-Schluessel fehlt -> ok false mit Hinweis, kein Abruf', async () => {
    const r = await sucheEntwuerfe({ kontaktId: KONTAKT, lesen: async () => { const { BelegSchluesselFehlt } = await import('../lib/lexwareBelege.js'); throw new BelegSchluesselFehlt(); } });
    expect(r).toEqual({ ok: false, grund: 'Lexware-Belegleser nicht eingerichtet (Secret LEXWARE_API_KEY_BELEGE fehlt)' });
  });
  test('403 -> verstaendlicher Grund; Kunde ohne Verknuepfung -> kein Abruf', async () => {
    const { aufrufe, fetchFn } = attrappe([() => antwort(403, {})]);
    expect(await sucheEntwuerfe({ kontaktId: KONTAKT, schluessel: 's', fetchFn })).toEqual({ ok: false, grund: 'Belege-Schlüssel darf die Belegliste nicht lesen (403)' });
    expect(await sucheEntwuerfe({ kontaktId: '', schluessel: 's', fetchFn })).toMatchObject({ ok: false, grund: 'Kunde ohne Lexoffice-Verknüpfung' });
    expect(aufrufe).toHaveLength(1);
  });
});

describe('Quelltext', () => {
  test('Belegleser: nur GET, kein POST/PUT/PATCH/DELETE, Host nur ueber BASIS', () => {
    const q = readFileSync(resolve(hier, '../lib/lexwareBelege.js'), 'utf8');
    expect(q).not.toMatch(/'(POST|PUT|PATCH|DELETE)'|method:/);
    expect(q).not.toContain('api.lexware.io');
    expect(q).not.toMatch(/console\./);
    expect(q.match(/lexwareGet\(/g)).toHaveLength(2);
    expect(q).toContain("SCHLUESSEL_BELEGE = 'LEXWARE_API_KEY_BELEGE'");
  });
  test('Nachsehen nutzt nicht mehr den Rechnungen-Schluessel', () => {
    const q = readFileSync(resolve(hier, '../lib/lexwareRechnung.js'), 'utf8');
    const teil = q.slice(q.indexOf('export async function sucheEntwuerfe'));
    expect(teil).not.toMatch(/rechnungSchluessel|fetchFn\(/);
    expect(teil).toContain('leseBelegliste');
  });
});
