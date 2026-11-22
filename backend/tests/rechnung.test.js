// RE1: Sammelrechnung als Lexware-Entwurf. Nur ERFUNDENE Kunden, Namen und Betraege; Lexware nur als Attrappe.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import { nettoAusBrutto } from '../utils/auftrag-preise.js';
import { TAB_AUFTRAEGE, TAB_POSITIONEN, AUFTRAG_SPALTEN, POSITION_SPALTEN, POSITION_OPTIONAL, AUFTRAG_OPTIONAL } from '../utils/auftraege.js';
import { TAB_AUFGABEN, AUFGABE_SPALTEN, TAB_TODOS, TODO_SPALTEN } from '../utils/aufgaben.js';
import { KUNDEN_SPALTEN, TAB_KUNDEN } from '../utils/kunden.js';
import { abrechnenListe, rechnungsPlan, lexwareDatum, kennzeichenPlan, chatText, RECHNUNG_SPALTEN } from '../utils/rechnung.js';
import { legeRechnungsentwurfAn, rechnungSchluessel, sucheEntwuerfe } from '../lib/lexwareRechnung.js';
import { rechnungAnlegen, rechnungKennzeichen, abrechnenVorschau, rechnungNachsehen } from '../lib/rechnung.js';
import { _auftraegeCacheLeeren } from '../lib/auftraege.js';
import { _kundenCacheLeeren } from '../lib/kunden.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { _lieferbarkeitCacheLeeren } from '../lib/lieferbarkeitLesen.js';
import { SECRET_KEYS } from '../utils/secrets.js';

const hier = dirname(fileURLToPath(import.meta.url));
const ID = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const KONTAKT = '11111111-2222-4333-8444-555555555555';
const jetzt = () => new Date('2026-11-22T10:00:00.000Z');

const au = (nr, extra = {}) => ({ Auftrag_Nr: nr, Kunden_Nr: 'K-00900', Kurztitel: `Test ${nr}`, Status: 'übergeben', Termin: '2026-10-02', Stand: `S-${nr}`, Preis_Eingabe: 'brutto', ...extra });
const pos = (id, nr, extra = {}) => ({ Position_ID: id, Auftrag_Nr: nr, Art: 'frei', Freitext: `Muster ${id}`, Menge: 2, Preis_Netto: nettoAusBrutto(34.5), ...extra });

describe('Auswahl über das Kennzeichen', () => {
  const auftraege = [
    au('AU-2026-0001', { Status: 'bezahlt' }),
    au('AU-2026-0002', { Rechnung_Status: 'entwurf', Rechnung_Lexware_ID: ID, Rechnung_Am: '2026-11-01' }),
    au('AU-2026-0003', { Status: 'storniert', Storniert_Am: '2026-10-05' }),
    au('AU-2026-0004', { Lexoffice_Rechnung: 'RE-0815' }),
    au('AU-2026-0005'),
    au('AU-2026-0006', { Kunden_Nr: 'K-00901' }),
  ];
  const positionen = [pos('AU-2026-0001-01', 'AU-2026-0001'), pos('AU-2026-0005-01', 'AU-2026-0005', { Preis_Netto: '' }),
    pos('AU-2026-0005-02', 'AU-2026-0005', { Entfernt: '2026-10-01' })];
  const l = abrechnenListe({ auftraege, positionen, kundenNr: 'K-00900' });
  test('bezahlt ohne Kennzeichen drin, Kennzeichen/von Hand abgerechnet, Storno und fremde Kunden nie', () => {
    expect(l.offen.map(x => x.auftragNr)).toEqual(['AU-2026-0001', 'AU-2026-0005']);
    expect(l.abgerechnet.map(x => x.auftragNr)).toEqual(['AU-2026-0002', 'AU-2026-0004']);
    expect(l.offen[0].grund).toBe('');
  });
  test('entfernte Positionen zaehlen nicht, ohne Preis = Grund', () => {
    expect(l.offen[1]).toMatchObject({ positionen: 1, ohnePreis: 1, grund: '1 Position ohne Preis' });
  });
});

describe('Rechnungsplan', () => {
  const info = new Map([['1000000001', { bezeichnung: 'Muster-Hoodie', farbe: 'Black', groesse: 'L' }]]);
  test('Brutto-Rechnung: vereinbarter Bruttopreis kommt exakt heraus, Summe = Menge x Preis', () => {
    const preise = [34.5, 10, 2.25, 5.4, 12, 28.36, 33.4];
    const auftraege = [au('AU-2026-0010')];
    const positionen = preise.map((b, i) => pos(`AU-2026-0010-0${i + 1}`, 'AU-2026-0010', { Preis_Netto: nettoAusBrutto(b), Menge: i + 1 }));
    const p = rechnungsPlan({ auftraege, positionen, kontaktId: KONTAKT, jetzt: jetzt() });
    expect(p.probleme).toEqual([]);
    expect(p.taxType).toBe('gross');
    const items = p.payload.lineItems.filter(x => x.type === 'custom');
    expect(items.map(x => x.unitPrice.grossAmount)).toEqual(preise);
    const soll = preise.reduce((s, b, i) => s + Math.round(b * 100) * (i + 1), 0);
    expect(p.summen.brutto).toBe(soll);
    expect(p.summen.netto + p.summen.mwst[0].betrag).toBe(soll);
    expect(p.payload.taxConditions).toEqual({ taxType: 'gross' });
    expect(p.payload).not.toHaveProperty('finalize');
  });
  test('Zwischenzeile je Auftrag, "für" im Positionstext, L-Shop-Text Artikel · Farbe · Groesse', () => {
    const p = rechnungsPlan({
      auftraege: [au('AU-2026-0011', { Termin: '2026-10-16' })],
      positionen: [pos('AU-2026-0011-01', 'AU-2026-0011', { Art: 'lshop', LShop_ArticleNr: '1000000001', Motiv: 'Muster-Hoodie Vereinslogo', Freitext: '' })],
      info, fuerJe: new Map([['AU-2026-0011-01', ['Erika Muster']]]), kontaktId: KONTAKT, jetzt: jetzt(),
    });
    expect(p.payload.lineItems[0]).toEqual({ type: 'text', name: 'Lieferung 16.10.2026 · AU-2026-0011' });
    expect(p.payload.lineItems[1]).toMatchObject({ type: 'custom', name: 'Muster-Hoodie Vereinslogo · Black · L', description: 'für Erika Muster', quantity: 2, unitName: 'Stück' });
    expect(p.positionen[1].fuer).toBe(true);
    expect(JSON.stringify(p.positionen)).not.toContain('Erika');   // Vorschau an MC: nur Kennzeichen
    expect(p.payload.shippingConditions).toEqual({ shippingType: 'delivery', shippingDate: '2026-10-16T00:00:00.000+02:00' });
  });
  test('Netto-Rechnung: netAmount mit bis zu 4 Stellen; mehrere Liefertage = Zeitraum', () => {
    const p = rechnungsPlan({
      auftraege: [au('AU-2026-0012', { Preis_Eingabe: '' }), au('AU-2026-0013', { Preis_Eingabe: '', Termin: '2026-11-06' })],
      positionen: [pos('AU-2026-0012-01', 'AU-2026-0012', { Preis_Netto: 25.1261, Menge: 1 }), pos('AU-2026-0013-01', 'AU-2026-0013', { Preis_Netto: 10, Menge: 3 })],
      kontaktId: KONTAKT, jetzt: jetzt(),
    });
    expect(p.taxType).toBe('net');
    expect(p.payload.lineItems.filter(x => x.type === 'custom').map(x => x.unitPrice.netAmount)).toEqual([25.1261, 10]);
    expect(p.payload.shippingConditions.shippingType).toBe('deliveryperiod');
    expect(p.summen.netto).toBe(5513);
  });
  test('Probleme: kein Kontakt, gemischt, Rabatt, ohne Preis, schon abgerechnet', () => {
    const p = rechnungsPlan({
      auftraege: [au('AU-2026-0014', { Rabatt: '10%' }), au('AU-2026-0015', { Preis_Eingabe: '' }), au('AU-2026-0016', { Rechnung_Status: 'unklar' })],
      positionen: [pos('AU-2026-0014-01', 'AU-2026-0014', { Preis_Netto: '' })], kontaktId: '', jetzt: jetzt(),
    });
    expect(p.probleme.join(' | ')).toMatch(/nicht mit Lexoffice verknüpft.*gemischt.*Rabatt.*ohne Preis.*schon abgerechnet/);
  });
  test('Lexware-Datum mit Versatz Winter/Sommer', () => {
    expect(lexwareDatum('2026-11-22')).toBe('2026-11-22T00:00:00.000+01:00');
    expect(lexwareDatum('2026-07-01')).toBe('2026-07-01T00:00:00.000+02:00');
  });
  test('Kennzeichen von Hand nur fuer entwurf/unklar; angelegt braucht ID', () => {
    expect(() => kennzeichenPlan({ auftrag: au('AU-1'), aktion: 'zuruecksetzen' })).toThrow(/kein Rechnungskennzeichen/);
    expect(kennzeichenPlan({ auftrag: au('AU-1', { Rechnung_Status: 'entwurf' }), aktion: 'zuruecksetzen' })).toEqual({ zuruecksetzen: true });
    expect(() => kennzeichenPlan({ auftrag: au('AU-1', { Rechnung_Status: 'unklar' }), aktion: 'angelegt' })).toThrow(/Lexware-ID/);
    expect(kennzeichenPlan({ auftrag: au('AU-1', { Rechnung_Status: 'unklar' }), aktion: 'angelegt', lexwareId: ID })).toEqual({ id: ID });
  });
  test('Chat ohne Betraege und Namen', () => {
    expect(chatText({ ergebnis: 'unklar', auftragNrn: ['AU-2026-0001'] })).toMatch(/UNKLAR.*AU-2026-0001/);
  });
});

describe('Lexware-Schreibweg (Attrappe)', () => {
  const antwort = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  test('genau EIN POST ohne finalize; 2xx mit id = angelegt', async () => {
    const aufrufe = [];
    const f = async (url, o) => { aufrufe.push([url, o.method]); return antwort(200, { id: ID }); };
    expect(await legeRechnungsentwurfAn({ payload: {}, schluessel: 's', fetchFn: f, mitTakt: false })).toEqual({ ergebnis: 'angelegt', id: ID });
    expect(aufrufe).toEqual([['https://api.lexware.io/v1/invoices', 'POST']]);
  });
  test.each([
    ['5xx', 'unklar', async () => antwort(503, {})],
    ['2xx ohne id', 'unklar', async () => antwort(200, {})],
    ['Netzfehler', 'unklar', async () => { throw Object.assign(new Error('x'), { code: 'ECONNRESET' }); }],
    ['400', 'nicht', async () => ({ ...antwort(400, {}), json: async () => ({ IssueList: [{ source: 'lineItems[0].unitPrice', type: 'x' }] }) })],
    ['429', 'nicht', async () => antwort(429, {})],
    ['403', 'nicht', async () => antwort(403, {})],
  ])('%s -> %s, kein zweiter Versuch', async (_, ergebnis, fn) => {
    let n = 0;
    const r = await legeRechnungsentwurfAn({ payload: {}, schluessel: 'geheim-1', fetchFn: async (...a) => { n++; return fn(...a); }, mitTakt: false });
    expect(r.ergebnis).toBe(ergebnis);
    expect(n).toBe(1);
    expect(JSON.stringify(r)).not.toContain('geheim-1');
  });
  test('Zeitlimit = unklar', async () => {
    const f = (url, o) => new Promise((_, nein) => o.signal.addEventListener('abort', () => nein(Object.assign(new Error('a'), { name: 'AbortError' }))));
    expect(await legeRechnungsentwurfAn({ payload: {}, schluessel: 's', fetchFn: f, zeitlimitMs: 20, mitTakt: false })).toMatchObject({ ergebnis: 'unklar' });
  });
  test('Schluessel fehlt -> 503, nicht in SECRET_KEYS', async () => {
    await expect(rechnungSchluessel(async () => '')).rejects.toMatchObject({ status: 503, code: 'lexware_rechnungen' });
    expect(SECRET_KEYS).not.toContain('LEXWARE_API_KEY_RECHNUNGEN');
  });
  test('Quelltext: kein finalize, kein PUT/PATCH/DELETE, Host nur ueber BASIS', () => {
    const q = readFileSync(resolve(hier, '../lib/lexwareRechnung.js'), 'utf8');
    expect(q).not.toMatch(/finalize=|'PUT'|'PATCH'|'DELETE'/);
    expect(q).not.toContain('api.lexware.io');
    expect((q.match(/method: 'POST'/g) || []).length).toBe(1);
  });
  test('Nachsehen: Belegliste nur GET', async () => {
    const aufrufe = [];
    const r = await sucheEntwuerfe({ kontaktId: KONTAKT, seit: '2026-11-22', schluessel: 's', fetchFn: async (u, o) => { aufrufe.push([u, o.method]); return antwort(200, { content: [{ id: ID, totalAmount: 69 }] }); } });
    expect(r.ok).toBe(true);
    expect(aufrufe[0][1]).toBe('GET');
    expect(aufrufe[0][0]).toMatch(/voucherlist\?voucherType=invoice&voucherStatus=draft&contactId=/);
  });
});

describe('Anlegen mit In-Memory-Sheet', () => {
  const AS = [...AUFTRAG_SPALTEN, ...AUFTRAG_OPTIONAL], PS = [...POSITION_SPALTEN, ...POSITION_OPTIONAL];
  function tabs(auftraege = [au('AU-2026-0020'), au('AU-2026-0021', { Termin: '2026-10-10' })]) {
    return {
      LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Brand', 'CatNrManufacturer', 'Discontinued', 'Status', 'Description', '10CartonsPrice', 'Quelle_Datum']],
      [TAB_AUFTRAEGE]: [AS, ...auftraege.map(o => AS.map(s => o[s] ?? ''))],
      [TAB_POSITIONEN]: [PS, ...[pos('AU-2026-0020-01', 'AU-2026-0020'), pos('AU-2026-0021-01', 'AU-2026-0021', { Freitext: 'Porto', Menge: 1, Preis_Netto: nettoAusBrutto(5.9) })].map(o => PS.map(s => o[s] ?? ''))],
      [TAB_AUFGABEN]: [AUFGABE_SPALTEN],
      [TAB_TODOS]: [TODO_SPALTEN, ['AU-2026-0020-T01', 'AU-2026-0020', 'Rechnung schreiben', '', '', '', 1, '2026-10-01', 'X', '', '']],
      [TAB_KUNDEN]: [KUNDEN_SPALTEN, KUNDEN_SPALTEN.map(s => ({ Kunden_Nr: 'K-00900', Lexoffice_ID: KONTAKT, Name: 'Musterverein', Status: 'aktiv', Art: 'Verein' })[s] ?? '')],
    };
  }
  beforeEach(() => {
    process.env.GOOGLE_SHEET_ID = 'ssot-test'; process.env.KUNDEN_SHEET_ID = 'kunden-test';
    _auftraegeCacheLeeren(); _kundenCacheLeeren(); _resetLShopCache(); _lieferbarkeitCacheLeeren();
  });
  const eingabe = { kundenNr: 'K-00900', auftraege: [{ nr: 'AU-2026-0020', stand: 'S-AU-2026-0020' }, { nr: 'AU-2026-0021', stand: 'S-AU-2026-0021' }] };
  const sp = (t, s) => t[TAB_AUFTRAEGE][0].indexOf(s);
  const kz = t => t[TAB_AUFTRAEGE].slice(1).map(z => [z[sp(t, 'Rechnung_Status')], z[sp(t, 'Rechnung_Lexware_ID')], z[sp(t, 'Rechnung_Am')]]);
  const opts = (senden, melden = async () => {}) => ({ jetzt, senden, melden, schluesselLesen: async () => 's' });

  test('angelegt: Kennzeichen entwurf + ID an allen Auftraegen, To-do erledigt, genau ein Aufruf', async () => {
    const t = tabs(); const { sheets } = machSheets(t);
    let n = 0, payload = null;
    const r = await rechnungAnlegen({ eingabe, sheets, ...opts(async o => { n++; payload = o.payload; return { ergebnis: 'angelegt', id: ID }; }) });
    expect(r).toMatchObject({ ok: true, ergebnis: 'angelegt', id: ID, link: `https://app.lexware.de/permalink/invoices/edit/${ID}`, todos: 1 });
    expect(n).toBe(1);
    expect(kz(t)).toEqual([['entwurf', ID, '2026-11-22'], ['entwurf', ID, '2026-11-22']]);
    expect(t[TAB_TODOS][1][TODO_SPALTEN.indexOf('Erledigt')]).toBe('ja');
    expect(payload.address).toEqual({ contactId: KONTAKT });
    expect(payload.lineItems.filter(x => x.type === 'custom').map(x => x.unitPrice.grossAmount)).toEqual([34.5, 5.9]);
    // nie doppelt: zweiter Versuch mit neuem Stand -> 409 schon
    const st = t[TAB_AUFTRAEGE][1][sp(t, 'Stand')];
    await expect(rechnungAnlegen({ eingabe: { kundenNr: 'K-00900', auftraege: [{ nr: 'AU-2026-0020', stand: st }] }, sheets, ...opts(async () => { n++; return {}; }) }))
      .rejects.toMatchObject({ status: 409, code: 'schon' });
    expect(n).toBe(1);
  });
  test('unklar: Kennzeichen bleibt "unklar", Chat ohne Betraege, nie erneut', async () => {
    const t = tabs(); const { sheets } = machSheets(t);
    const chat = [];
    const r = await rechnungAnlegen({ eingabe, sheets, ...opts(async () => ({ ergebnis: 'unklar', grund: 'Zeitlimit 30 s' }), async x => chat.push(x)) });
    expect(r).toMatchObject({ ok: false, ergebnis: 'unklar' });
    expect(kz(t)).toEqual([['unklar', '', '2026-11-22'], ['unklar', '', '2026-11-22']]);
    expect(chat[0]).toMatch(/UNKLAR/);
    expect(chat[0]).not.toMatch(/€|34|Muster/);
    const v = await abrechnenVorschau({ kundenNr: 'K-00900', sheets, bereit: async () => true });
    expect(v.offen).toEqual([]);
    expect(v.abgerechnet.map(x => x.rechnung.status)).toEqual(['unklar', 'unklar']);
  });
  test('nicht angelegt (400): Kennzeichen wieder leer, Fehler mit Grund', async () => {
    const t = tabs(); const { sheets } = machSheets(t);
    await expect(rechnungAnlegen({ eingabe, sheets, ...opts(async () => ({ ergebnis: 'nicht', status: 400, grund: 'Lexware lehnt den Entwurf ab (Status 400)' })) }))
      .rejects.toMatchObject({ status: 422, code: 'lexware' });
    expect(kz(t)).toEqual([['', '', ''], ['', '', '']]);
  });
  test('Stand geaendert -> 409, nichts gesendet; Probleme -> 422, nichts gesendet', async () => {
    const t = tabs([au('AU-2026-0020'), au('AU-2026-0021', { Rabatt: '10%' })]); const { sheets } = machSheets(t);
    let n = 0;
    const senden = async () => { n++; return { ergebnis: 'angelegt', id: ID }; };
    await expect(rechnungAnlegen({ eingabe: { ...eingabe, auftraege: [{ nr: 'AU-2026-0020', stand: 'alt' }] }, sheets, ...opts(senden) })).rejects.toMatchObject({ status: 409 });
    await expect(rechnungAnlegen({ eingabe, sheets, ...opts(senden) })).rejects.toMatchObject({ status: 422, code: 'probleme' });
    expect(n).toBe(0);
    expect(kz(t)).toEqual([['', '', ''], ['', '', '']]);
  });
  test('Schluessel fehlt -> 503 vor jedem Schreiben', async () => {
    const t = tabs(); const { sheets } = machSheets(t);
    await expect(rechnungAnlegen({ eingabe, sheets, jetzt, senden: async () => ({}), schluesselLesen: () => rechnungSchluessel(async () => '') }))
      .rejects.toMatchObject({ status: 503 });
    expect(kz(t)).toEqual([['', '', ''], ['', '', '']]);
  });
  test('unklar -> von Hand "angelegt" (ganze Gruppe) bzw. zuruecksetzen; Nachsehen liest nur', async () => {
    const t = tabs([au('AU-2026-0020', { Rechnung_Status: 'unklar', Rechnung_Am: '2026-11-22' }), au('AU-2026-0021', { Rechnung_Status: 'unklar', Rechnung_Am: '2026-11-22' })]);
    const { sheets } = machSheets(t);
    const ns = await rechnungNachsehen({ nr: 'AU-2026-0020', sheets, suche: async o => ({ ok: true, entwuerfe: [{ id: ID, kontakt: o.kontaktId }] }) });
    expect(ns.entwuerfe[0]).toMatchObject({ id: ID, kontakt: KONTAKT });
    const r = await rechnungKennzeichen({ eingabe: { nr: 'AU-2026-0020', stand: 'S-AU-2026-0020', aktion: 'angelegt', lexwareId: ID }, sheets, jetzt });
    expect(r.auftraege).toEqual(['AU-2026-0020', 'AU-2026-0021']);
    expect(kz(t)).toEqual([['entwurf', ID, '2026-11-22'], ['entwurf', ID, '2026-11-22']]);
    const st = t[TAB_AUFTRAEGE][1][sp(t, 'Stand')];
    await rechnungKennzeichen({ eingabe: { nr: 'AU-2026-0020', stand: st, aktion: 'zuruecksetzen' }, sheets, jetzt });
    expect(kz(t)).toEqual([['', '', ''], ['', '', '']]);
  });
  test('Spalten fehlen -> 409 einrichtung', async () => {
    const t = tabs();
    const weg = RECHNUNG_SPALTEN.map(s => sp(t, s)).sort((a, b) => b - a);
    for (const z of t[TAB_AUFTRAEGE]) for (const i of weg) z.splice(i, 1);
    const { sheets } = machSheets(t);
    await expect(rechnungAnlegen({ eingabe, sheets, ...opts(async () => ({})) })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
  });
});
