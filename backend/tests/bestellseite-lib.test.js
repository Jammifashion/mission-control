// KS1: Bestellseite - Lesen/Schreiben (lib/bestellseite.js) gegen ein In-Memory-Sheet, Router mit Fehlversuchs-Bremse.
// Nur erfundene Werte.
import { jest } from '@jest/globals';
import express from 'express';
import { machSheets } from './hilfen/korb-sheet.js';
import {
  legeZugangAn, neuerLink, bearbeiteZugang, leseSeite, leseZugaenge, aktualisiereBilder, _bestellseiteCacheLeeren,
} from '../lib/bestellseite.js';
import { bauRouter, FEHLVERSUCHE_MAX } from '../routes/bestellseite.js';
import { ZUGANG_SPALTEN, ZUGANG_OPTIONAL, TERMIN_SPALTEN, BILD_SPALTEN, tokenHash } from '../utils/bestellseite.js';
import { AUFTRAG_SPALTEN, POSITION_SPALTEN } from '../utils/auftraege.js';

process.env.GOOGLE_SHEET_ID = 'test-sheet';
const JETZT = () => new Date('2026-11-07T10:00:00Z');
const kunden = async () => ({ kunden: [{ Kunden_Nr: 'K-00063', Status: 'aktiv' }, { Kunden_Nr: 'K-00001', Status: 'aktiv' }] });
const zeile = (spalten, o) => spalten.map(s => o[s] ?? '');
let zufallZaehler = 0;
const zufall = () => Buffer.alloc(32, ++zufallZaehler);

function tabs() {
  return {
    Bestellseiten: [[...ZUGANG_SPALTEN, ...ZUGANG_OPTIONAL]],
    Bestell_Termine: [TERMIN_SPALTEN],
    Bestell_Bilder: [BILD_SPALTEN],
    Struktur_Kategorien: [['Kategorienummer', 'Kategorien', 'Kategoriename'], ['549', 'Club', 'Club'], ['554', 'Club > Basics', 'Basics']],
    Erfassungsmaske: [['ID', 'Status Shop', 'Produkt-ID', 'Produktname', 'Kategorien'],
      ['A1', 'Veröffentlicht', '11', 'Hoodie Club', 'Club, Basics'], ['A2', 'Entwurf', '12', 'Entwurf', 'Club']],
    Varianten: [['SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'Preis', 'Aktiv', 'WC_Variation_ID', 'Google_Farbe', 'LShop_ArticleNr'],
      ['A1', '1', 'Farbe', 'Black', 'Größe', 'M', '', '', '49,95', 'TRUE', '101', '', '1000000001'],
      ['A1', '2', 'Farbe', 'Black', 'Größe', 'L', '', '', '49,95', 'TRUE', '102', '', ''],
      ['A2', '1', 'Farbe', 'Red', '', '', '', '', '19,95', 'TRUE', '201', '', '']],
    Auftraege: [AUFTRAG_SPALTEN, zeile(AUFTRAG_SPALTEN, { Auftrag_Nr: 'AU-2026-0007', Kunden_Nr: 'K-00001', Kurztitel: 'Turnier', Status: 'Angebot', Termin: '2026-12-01', Stand: 's' })],
    Auftrag_Positionen: [POSITION_SPALTEN, zeile(POSITION_SPALTEN, { Position_ID: 'AU-2026-0007-01', Auftrag_Nr: 'AU-2026-0007', Art: 'frei', Freitext: 'Tasse', Menge: 3 })],
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage']],
  };
}

beforeEach(() => { _bestellseiteCacheLeeren(); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe('Anlegen, neuer Link, sperren', () => {
  test('Token nur als Hash im Sheet, Klartext einmal in der Antwort; nie im Log', async () => {
    const t = tabs();
    const { sheets, aufrufe } = machSheets(t);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const r = await legeZugangAn({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', partnerId: 'FP-001', vorgang: 'vorgang-0001' }, sheets, jetzt: JETZT, kundenLesen: kunden, zufall });
    expect(r).toMatchObject({ ok: true, schon: false, zugangId: 'BS-001', ablauf: '2027-06-30' });
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const sheetText = JSON.stringify(t);
    expect(sheetText).not.toContain(r.token);
    expect(sheetText).toContain(tokenHash(r.token));
    expect(JSON.stringify(log.mock.calls)).not.toContain(r.token);
    expect(aufrufe.append).toBe(0);
    // Doppelklick: gleiche Vorgang-Kennung -> nichts doppelt, kein Token
    const zwei = await legeZugangAn({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', vorgang: 'vorgang-0001' }, sheets, jetzt: JETZT, kundenLesen: kunden, zufall });
    expect(zwei).toEqual({ ok: true, schon: true, zugangId: 'BS-001' });
    expect(t.Bestellseiten.length).toBe(2);
  });

  test('Art auftrag: Termin-Zeile im selben Schreibvorgang, Kunde vom Auftrag', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    const r = await legeZugangAn({ eingabe: { art: 'auftrag', auftragNr: 'AU-2026-0007', vorgang: 'vorgang-0002' }, sheets, jetzt: JETZT, kundenLesen: kunden, zufall });
    expect(r.zugangId).toBe('BS-001');
    expect(t.Bestell_Termine[1].slice(0, 3)).toEqual(['BT-0001', 'BS-001', '2026-12-01']);
    expect(t.Bestellseiten[1][2]).toBe('K-00001');
  });

  test('Seite: ok / neuer Link macht den alten ungueltig (401) / gesperrt 403 / abgelaufen 403', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    const { token } = await legeZugangAn({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', hinweis: 'Abholung im Laden', vorgang: 'vorgang-0003' }, sheets, jetzt: JETZT, kundenLesen: kunden, zufall });
    const s1 = await leseSeite({ token, sheets, jetzt: JETZT });
    expect(s1).toMatchObject({ art: 'dauer', hinweis: 'Abholung im Laden', ablauf: '2027-06-30', termine: [], eintragen: true });   // KS2
    expect(s1.artikel.map(a => a.name)).toEqual(['Hoodie Club']);   // nur veroeffentlicht
    expect(s1.artikel[0].groessen.map(g => [g.groesse, g.nochZuBesorgen])).toEqual([['M', false], ['L', true]]);
    expect(JSON.stringify(s1)).not.toMatch(/49,95|49\.95|preis/i);

    const stand = (await leseZugaenge({ sheets, jetzt: JETZT })).zugaenge[0].Stand;
    const neu = await neuerLink({ eingabe: { zugangId: 'BS-001', stand }, sheets, jetzt: () => new Date('2026-11-07T11:00:00Z'), zufall });
    expect(neu.token).not.toBe(token);
    await expect(leseSeite({ token, sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 401 });
    expect((await leseSeite({ token: neu.token, sheets, jetzt: JETZT })).art).toBe('dauer');

    await bearbeiteZugang({ eingabe: { zugangId: 'BS-001', stand: neu.stand, aktiv: false }, sheets, jetzt: JETZT });
    await expect(leseSeite({ token: neu.token, sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 403, code: 'gesperrt' });

    const z = (await leseZugaenge({ sheets, jetzt: JETZT })).zugaenge[0];
    expect(z).not.toHaveProperty('Token_Hash');
    await bearbeiteZugang({ eingabe: { zugangId: 'BS-001', stand: z.Stand, aktiv: true }, sheets, jetzt: JETZT });
    await expect(leseSeite({ token: neu.token, sheets, jetzt: () => new Date('2027-07-01T10:00:00Z') })).rejects.toMatchObject({ status: 403, code: 'abgelaufen' });
  });

  test('Stand veraltet -> 409, nichts geschrieben', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await legeZugangAn({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', vorgang: 'vorgang-0004' }, sheets, jetzt: JETZT, kundenLesen: kunden, zufall });
    const vorher = JSON.stringify(t.Bestellseiten);
    await expect(neuerLink({ eingabe: { zugangId: 'BS-001', stand: 'alt' }, sheets, jetzt: JETZT, zufall })).rejects.toMatchObject({ status: 409 });
    expect(JSON.stringify(t.Bestellseiten)).toBe(vorher);
  });

  test('Reiter fehlen: Seite 401 (verraet nichts), MC 409 einrichtung', async () => {
    const { sheets } = machSheets({});
    await expect(leseSeite({ token: 'A'.repeat(43), sheets })).rejects.toMatchObject({ status: 401 });
    await expect(leseZugaenge({ sheets })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
  });
});

describe('Artikelliste aktualisieren (Bilder)', () => {
  test('nur veroeffentlichte Artikel der Dauer-Sortimente, nacheinander mit Takt, _fields, ein Schreibvorgang', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await legeZugangAn({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', vorgang: 'vorgang-0005' }, sheets, jetzt: JETZT, kundenLesen: kunden, zufall });
    const get = jest.fn(async (pfad, q) => {
      if (pfad === 'products') return { data: [{ id: 11, status: 'publish', images: [{ src: 'https://shop.example/p11.jpg' }], price: '49.95' }] };
      return { data: [{ id: 101, image: { src: 'https://shop.example/v101.jpg' } }, { id: 102, image: { src: 'http://unsicher.example/x.jpg' } }] };
    });
    const r = await aktualisiereBilder({ sheets, wc: { get }, jetzt: JETZT, takt: 0 });
    expect(r).toMatchObject({ ok: true, produkte: 1, zeilen: 3, mitBild: 2, abrufe: 2 });
    expect(get.mock.calls.map(c => c[0])).toEqual(['products', 'products/11/variations']);
    expect(get.mock.calls[0][1]).toMatchObject({ include: '11', _fields: 'id,status,images,categories' });   // KS2: Kategorien
    expect(get.mock.calls[1][1]).toMatchObject({ _fields: 'id,image' });
    expect(t.Bestell_Bilder.slice(1).map(z => z.slice(0, 4))).toEqual([
      ['11', 'produkt', 'https://shop.example/p11.jpg', 'publish'], ['101', 'variante', 'https://shop.example/v101.jpg', ''], ['102', 'variante', '', '']]);
    expect(JSON.stringify(t.Bestell_Bilder)).not.toContain('49.95');
    _bestellseiteCacheLeeren();
    const z = (await leseZugaenge({ sheets, jetzt: JETZT }));
    expect(z.bilderAnzahl).toBe(3);
  });
});

describe('Router /api/bestellseite', () => {
  const app = (seite) => { const a = express(); a.set('trust proxy', 1); a.use('/api/bestellseite', bauRouter({ seite })); return a; };
  const rufe = async (a, headers = {}) => {
    const srv = a.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/bestellseite/zugang`, { headers });
      return { status: res.status, body: await res.json(), kopf: res.headers };
    } finally { srv.close(); }
  };
  test('Token nur aus Bearer-Header; ohne -> 401; Antwort no-store + no-referrer', async () => {
    const seite = jest.fn(async ({ token }) => ({ art: 'dauer', ok: token.length }));
    const a = app(seite);
    expect((await rufe(a)).status).toBe(401);
    const r = await rufe(a, { Authorization: `Bearer ${'B'.repeat(43)}` });
    expect(r.status).toBe(200);
    expect(r.kopf.get('cache-control')).toBe('no-store');
    expect(r.kopf.get('referrer-policy')).toBe('no-referrer');
    expect(seite).toHaveBeenCalledWith({ token: 'B'.repeat(43) });
  });
  test('403 mit freundlichem Text; Fehlversuchs-Bremse zaehlt nur 401', async () => {
    const seite = jest.fn(async ({ token }) => {
      const e = new Error(token.startsWith('G') ? 'Diese Bestellseite ist gesperrt.' : 'Bestellseite nicht gefunden.');
      e.status = token.startsWith('G') ? 403 : 401; e.code = token.startsWith('G') ? 'gesperrt' : 'unbekannt'; throw e;
    });
    const a = app(seite);
    for (let i = 0; i < FEHLVERSUCHE_MAX + 5; i++) expect((await rufe(a, { Authorization: `Bearer ${'G'.repeat(43)}` })).status).toBe(403);   // zaehlt nicht
    for (let i = 0; i < FEHLVERSUCHE_MAX; i++) expect((await rufe(a, { Authorization: `Bearer ${'U'.repeat(43)}` })).status).toBe(401);
    const gesperrt = await rufe(a, { Authorization: `Bearer ${'U'.repeat(43)}` });
    expect(gesperrt.status).toBe(429);
    expect(gesperrt.body.code).toBe('token_bremse');   // KS2: gemeinsamer Baustein middleware/tokenBremse.js
  });
});
