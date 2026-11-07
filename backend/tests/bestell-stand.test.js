// KS4: Stand je Position auf der Bestellseite, "gedruckt"/"geliefert", Verschieben in einen anderen Termin.
// Nur erfundene Werte (Kürzel, Notizen, Rückennamen sind ausgedacht; keine echten Bestell-IDs).
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import { legeZugangAn, _bestellseiteCacheLeeren } from '../lib/bestellseite.js';
import { legeTerminAn, sendeAb, aendereEintragSeite, leseEintraege, leseEintraegeMc } from '../lib/bestellEintraege.js';
import { pruefeEintraege, uebernehmen } from '../lib/bestellUebernahme.js';
import { setzeFertig, setzeGeliefert, verschiebe, _standCacheLeeren, STAND_MS } from '../lib/bestellStand.js';
import { ZUGANG_SPALTEN, ZUGANG_OPTIONAL, TERMIN_SPALTEN, EINTRAG_SPALTEN, BILD_SPALTEN, BILD_OPTIONAL } from '../utils/bestellseite.js';
import { EINTRAG_OPTIONAL } from '../utils/bestell-eintraege.js';
import { AUFTRAG_SPALTEN, AUFTRAG_OPTIONAL, POSITION_SPALTEN, POSITION_OPTIONAL, wareStand } from '../utils/auftraege.js';
import { KORB_SPALTEN } from '../utils/korb-logic.js';
import { BUCHUNG_SPALTEN, ARTIKEL_SPALTEN, ORTE_SPALTEN } from '../utils/lager.js';
import { standFuer, standFuerSeite, standSumme, isoWoche, rueckstandJeKorb, lieferInfo } from '../utils/bestell-stand.js';
import { verschiebenPlan, herkunftNachVerschieben } from '../utils/bestell-verschieben.js';
import { _auftraegeCacheLeeren, leseAuftraege } from '../lib/auftraege.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { _lieferbarkeitCacheLeeren } from '../lib/lieferbarkeitLesen.js';

const hier = dirname(fileURLToPath(import.meta.url));
process.env.GOOGLE_SHEET_ID = 'test-sheet';
process.env.BUSINESS_SHEET_ID = 'test-business';
const JETZT = () => new Date('2026-11-07T10:00:00Z');
const SPAETER = () => new Date('2026-11-07T11:00:00Z');
const kunden = async () => ({ kunden: [{ Kunden_Nr: 'K-00063', Status: 'aktiv' }] });
let z = 0; const zufall = () => Buffer.alloc(32, ++z);
const V = n => `vorgang-ks4-${String(n).padStart(4, '0')}`;
const NR_M = '1000000001', NR_L = '1000000002';
const KUERZEL = 'Testi', NOTIZ = 'fuer Erfundene Person';
const KORB_KOPF = [...KORB_SPALTEN, 'Liefertermin', 'AB_Hinweis'];
const kz = o => KORB_KOPF.map(c => o[c] ?? '');
const TRIKOT_KOPF = ['Zeilen-ID', 'Order-ID', 'Produktname', 'Groesse', 'Name', 'Nummer', 'Quelle', 'Rohtext', 'Charge', 'Bestellt_Am', 'Geliefert_Am', 'Status', 'Notiz'];

function tabs() {
  const LS = (nr, size) => [nr, 'X3000', 'Black', '', size, '', '', 'Erfunden', '', '0', 'aktiv', 'Muster-Hoodie'];
  return {
    Bestellseiten: [[...ZUGANG_SPALTEN, ...ZUGANG_OPTIONAL]],
    Bestell_Termine: [TERMIN_SPALTEN],
    Bestell_Eintraege: [[...EINTRAG_SPALTEN, ...EINTRAG_OPTIONAL]],
    Bestell_Bilder: [[...BILD_SPALTEN, ...BILD_OPTIONAL], ['901', 'produkt', 'https://i0.wp.com/shop.example/t.jpg', 'publish', 's', '561']],
    Struktur_Kategorien: [['Kategorienummer', 'Kategorien', 'Kategoriename'], ['549', 'Club', 'Club'], ['554', 'Club > Basics', 'Basics'], ['561', 'Club > Trikots', 'Trikots']],
    Erfassungsmaske: [['ID', 'Status Shop', 'Produkt-ID', 'Produktname', 'Kategorien'], ['A1', 'Veröffentlicht', '11', 'Hoodie Club', 'Club, Basics']],
    Varianten: [['SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'Preis', 'Aktiv', 'WC_Variation_ID', 'Google_Farbe', 'LShop_ArticleNr'],
      ['A1', '1', 'Farbe', 'Black', 'Größe', 'M', '', '', '49,95', 'TRUE', '101', '', NR_M],
      ['A1', '2', 'Farbe', 'Black', 'Größe', 'L', '', '', '49,95', 'TRUE', '102', '', NR_L]],
    Trikot_Artikel: [['Artikelnummer', 'Produkt-ID', 'Produktname', 'Aktiv'], ['TR-H', '901', 'Heimtrikot Test', 'TRUE']],
    Trikots: [TRIKOT_KOPF],
    Auftraege: [[...AUFTRAG_SPALTEN, ...AUFTRAG_OPTIONAL]],
    Auftrag_Positionen: [[...POSITION_SPALTEN, ...POSITION_OPTIONAL]],
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Brand', 'CatNrManufacturer', 'Discontinued', 'Status', 'Description'],
      LS(NR_M, 'M'), LS(NR_L, 'L')],
    Warenkorb_LShop: [KORB_KOPF, kz({ Schluessel: 'EIGEN:2026-0101', Shop: 'JFN', Herkunft: 'eigen', Referenz: 'Fanshop', LShop_ArticleNr: NR_L, Menge: 5, Status: 'offen', Status_Datum: '2026-11-06' })],
    Lager_Buchungen: [BUCHUNG_SPALTEN], Lager_Artikel: [ARTIKEL_SPALTEN], Lager_Orte: [ORTE_SPALTEN, ['Wrist', 'aktiv', '']],
  };
}

let t, s, token, termin, termin2, trikotAufrufe;
const quellen = { rueckstand: async () => new Map() };   // Drive nie im Test
const trikotsAnlegen = async ({ trikots, vorgang }) => {
  trikotAufrufe.push({ trikots, vorgang });
  return { ok: true, ids: trikots.map((_, i) => `INT-2026-${String(i + 1).padStart(4, '0')}`) };
};
async function aufbau() {
  t = tabs();
  s = machSheets(t);
  const r = await legeZugangAn({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', vorgang: V(1) }, sheets: s.sheets, jetzt: JETZT, kundenLesen: kunden, zufall, schluesselLaden: async () => null });
  token = r.token;
  termin = (await legeTerminAn({ token, eingabe: { datum: '2026-11-22', notiz: '' }, sheets: s.sheets, jetzt: JETZT })).termin;
  termin2 = (await legeTerminAn({ token, eingabe: { datum: '2026-11-27', notiz: '' }, sheets: s.sheets, jetzt: JETZT })).termin;
}
const absenden = (positionen, n = 2, tm = termin) => sendeAb({ token, eingabe: { termin: tm, kuerzel: KUERZEL, vorgang: V(n), positionen }, sheets: s.sheets, jetzt: JETZT, melden: async () => {} });
const mc = () => leseEintraegeMc({ zugangId: 'BS-001', sheets: s.sheets, quellen });
const wahl = async (filter = () => true) => (await mc()).eintraege.filter(filter).map(e => ({ id: e.id, stand: e.stand }));
const seite = (tm = termin) => leseEintraege({ token, termin: tm, sheets: s.sheets, jetzt: JETZT, quellen });
const spalte = (tab, name) => t[tab][0].indexOf(name);
const zelle = (tab, zeile, name) => t[tab][zeile][spalte(tab, name)];

/** Einträge absenden, prüfen, übernehmen (Artikel L verknüpft mit der offenen Korb-Zeile, Rest neu/frei). */
async function uebernommen(positionen, { verknuepfen = true, n = 2 } = {}) {
  await absenden(positionen, n);
  await pruefeEintraege({ eingabe: { zugangId: 'BS-001', aktion: 'geprueft', auswahl: await wahl(e => e.status === 'eingegangen') }, sheets: s.sheets, jetzt: SPAETER });
  const a = await wahl(e => e.status === 'geprüft');
  const eintr = (await mc()).eintraege;
  const vk = {};
  if (verknuepfen) for (const w of a) if (eintr.find(e => e.id === w.id)?.auswahl === '102') vk[w.id] = { verweis: 'EIGEN:2026-0101' };
  return uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: a, vorgang: V(50 + n), verknuepfen: vk }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen });
}

beforeEach(async () => {
  _bestellseiteCacheLeeren(); _auftraegeCacheLeeren(); _resetLShopCache?.(); _lieferbarkeitCacheLeeren?.(); _standCacheLeeren();
  trikotAufrufe = [];
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await aufbau();
});
afterEach(() => jest.restoreAllMocks());

describe('Stand-Schritte je Quelle (Logik)', () => {
  const pos = o => ({ Position_ID: 'AU-2026-0001-01', Auftrag_Nr: 'AU-2026-0001', Art: 'lshop', LShop_ArticleNr: NR_L, Menge: '2', ...o });
  const e = (o = {}) => ({ Eintrag_ID: 'BE-00001', Art: 'artikel', Status: 'übernommen', Position_ID: 'AU-2026-0001-01', Termin_ID: 'BT-0001', ...o });
  const ctx = (p, korb = {}, extra = {}) => ({ posJe: new Map([[p.Position_ID, p]]), korbJe: new Map(Object.entries(korb)), terminDatum: '2026-11-22', ...extra });

  test('Korb offen / gesendet / AB mit Liefertermin / AB sofort / geliefert / Lager; gedruckt; geliefert', () => {
    const p = pos({ Korb_Schluessel: 'EIGEN:1' });
    expect(standFuer(e(), ctx(p, { 'EIGEN:1': { Status: 'offen' } }))).toMatchObject({ schritt: 'uebernommen', text: 'übernommen' });
    expect(standFuer(e(), ctx(p, { 'EIGEN:1': { Status: 'bestellt', Status_Datum: '2026-11-08' } }))).toMatchObject({ schritt: 'bestellt', datum: '2026-11-08' });
    const ab = standFuer(e(), ctx(p, { 'EIGEN:1': { Status: 'bestellt', Liefertermin: '2026-11-26', AB_Hinweis: 'ok' } }));
    expect(ab).toMatchObject({ schritt: 'unterwegs', text: 'ca. KW 48', spaet: true, kw: 48 });
    expect(standFuerSeite(ab).hinweis).toBe('kommt voraussichtlich erst KW 48 – wir melden uns');
    expect(standFuer(e(), ctx(p, { 'EIGEN:1': { Status: 'bestellt', Liefertermin: '2026-11-12', AB_Hinweis: 'ok' } }))).toMatchObject({ text: 'ca. KW 46', spaet: false });
    expect(standFuer(e(), ctx(p, { 'EIGEN:1': { Status: 'bestellt', AB_Hinweis: 'ok' } }))).toMatchObject({ schritt: 'unterwegs', text: 'lieferbar' });
    expect(standFuer(e(), ctx(p, { 'EIGEN:1': { Status: 'geliefert', Status_Datum: '2026-11-10' } }))).toMatchObject({ schritt: 'beiUns', text: 'bei uns', datum: '2026-11-10' });
    expect(standFuer(e(), ctx(p, { 'EIGEN:1': { Status: 'Lager' } }))).toMatchObject({ schritt: 'beiUns' });
    expect(standFuer(e(), ctx({ ...p, Fertig: 'ja', Fertig_Am: '2026-11-15' }, { 'EIGEN:1': { Status: 'geliefert' } }))).toMatchObject({ schritt: 'fertig', text: 'fertig', datum: '2026-11-15' });
    expect(standFuer(e(), ctx({ ...p, Fertig: 'ja', Versendet: '2026-11-22' }))).toMatchObject({ schritt: 'geliefert', text: 'geliefert', datum: '2026-11-22' });
    // noch nicht an den Korb uebergeben
    expect(standFuer(e(), ctx(pos()))).toMatchObject({ schritt: 'uebernommen', intern: { korb: 'nicht übergeben' } });
  });
  test('RS1 (KW, sofort, in Klärung) vor AB, BO7 als Rückfall; Verweis auf Korb (KS3-1) folgt dem Korb', () => {
    const rs = rueckstandJeKorb([{ korbSchluessel: ['EIGEN:1'], stufe: 'kw', teile: [{ status: 'kw', kw: 49, jahr: 2026 }] }]);
    const p = pos({ Herkunft: 'vorhanden', Verweis: 'EIGEN:1' });
    const k = { 'EIGEN:1': { Status: 'bestellt', Liefertermin: '2026-11-12' } };
    expect(standFuer(e(), ctx(p, k, { rsJe: rs }))).toMatchObject({ text: 'Rückstand – ca. KW 49', spaet: true, intern: { quelle: 'Rückstandsliste' } });
    expect(lieferInfo({ rs: { stufe: 'klaerung' } })).toMatchObject({ text: 'Rückstand' });
    expect(lieferInfo({ rs: { stufe: 'sofort' } })).toMatchObject({ text: 'lieferbar' });
    expect(lieferInfo({ korb: { Status: 'bestellt' }, lfb: { stufe: 'null' } })).toMatchObject({ text: 'Rückstand', quelle: 'Lieferbarkeit' });
    expect(lieferInfo({ korb: { Status: 'bestellt' }, lfb: { stufe: 'lieferbar' } })).toMatchObject({ text: 'lieferbar' });
    expect(standFuer(e(), ctx(p, { 'EIGEN:1': { Status: 'offen' } }))).toMatchObject({ schritt: 'uebernommen' });
    expect(isoWoche('2026-11-22')).toEqual({ kw: 47, jahr: 2026 });
  });
  test('schon vorhanden ohne Verweis / Lager ausgebucht -> "bei uns"; frei -> übernommen; Trikot: Produzent -> bei uns -> geliefert; abgelehnt', () => {
    expect(standFuer(e(), ctx(pos({ Herkunft: 'vorhanden', Verweis: 'ohne Verweis: Restbestand' })))).toMatchObject({ schritt: 'beiUns', weg: 'vorhanden' });
    expect(standFuer(e(), ctx(pos({ Herkunft: 'lager', Lager_Ort: 'Wrist', Lager_Buchung: 'LB-2026-00001' })))).toMatchObject({ schritt: 'beiUns' });
    expect(standFuer(e(), ctx(pos({ Herkunft: 'lager', Lager_Ort: 'Wrist' })))).toMatchObject({ schritt: 'uebernommen' });
    expect(standFuer(e({ Art: 'extra' }), ctx(pos({ Art: 'frei', LShop_ArticleNr: '', Herkunft: '' })))).toMatchObject({ schritt: 'uebernommen', weg: 'frei' });
    const tr = (o, z) => standFuer(e({ Art: 'trikot', Position_ID: 'INT-2026-0001', ...o }), { trikotJe: new Map([['INT-2026-0001', z]]) });
    expect(tr({}, { charge: '', status: '' })).toMatchObject({ schritt: 'uebernommen', weg: 'trikot' });
    expect(tr({}, { charge: '7', bestelltAm: '01.11.2026', status: '' })).toMatchObject({ schritt: 'produzent', text: 'beim Produzenten', datum: '2026-11-01' });
    expect(tr({}, { charge: '7', geliefertAm: '20.11.2026', status: 'ok' })).toMatchObject({ schritt: 'beiUns', datum: '2026-11-20' });
    expect(tr({}, { charge: '7', status: 'ersetzt', geliefertAm: '20.11.2026' })).toMatchObject({ schritt: 'produzent' });
    expect(tr({ Geliefert_Am: '2026-11-22' }, { charge: '7', status: 'ok' })).toMatchObject({ schritt: 'geliefert' });
    expect(standFuer(e({ Status: 'storniert', Ablehn_Grund: 'gibt es nicht' }), {})).toMatchObject({ schritt: 'abgelehnt' });
    expect(standFuer(e({ Status: 'eingegangen', Zeit: '2026-11-07T10:00:00Z' }), {})).toMatchObject({ schritt: 'eingegangen', datum: '2026-11-07' });
  });
  test('Seite bekommt keine internen Angaben; Summe nur Zahlen', () => {
    const p = pos({ Korb_Schluessel: 'EIGEN:2026-0001' });
    const st = standFuer(e(), ctx(p, { 'EIGEN:2026-0001': { Status: 'bestellt', Bestell_ID: 'JFN-2026-0042', Liefertermin: '2026-11-26' } }));
    const sei = JSON.stringify(standFuerSeite(st));
    expect(sei).not.toMatch(/EIGEN|JFN-|L-Shop|AB|quelle|intern|AU-2026|\d{10}/);
    expect(Object.keys(standFuerSeite(st)).sort()).toEqual(['datum', 'hinweis', 'schritt', 'schritte', 'text']);
    expect(standSumme([{ schritt: 'beiUns', weg: 'bestellen' }, { schritt: 'fertig', weg: 'bestellen' }, { schritt: 'geliefert', weg: 'frei' }, { schritt: 'uebernommen', weg: 'bestellen' }, { schritt: 'abgelehnt', weg: 'bestellen' }]))
      .toEqual({ gesamt: 4, beiUns: 3, fertig: 2 });
  });
});

describe('Seite: Stand je Eintrag', () => {
  test('nach Übernahme: Stand folgt dem Korb, Hinweis nach dem Termin, keine internen Details in der Antwort, Summe', async () => {
    await uebernommen([{ art: 'artikel', id: '102', menge: 2, notiz: NOTIZ }, { art: 'artikel', id: '101', menge: 1 }]);
    let r = await seite();
    expect(r.eintraege.map(e => e.fortschritt.text)).toEqual(['übernommen', 'übernommen']);
    expect(r.summe).toEqual({ gesamt: 2, beiUns: 0, fertig: 0 });
    // Korb-Zeile wird gesendet, AB mit spaeterem Liefertermin -> Seite (nach Zwischenspeicher) zeigt "ca. KW 48" + Hinweis
    const i = spalte('Warenkorb_LShop', 'Status');
    t.Warenkorb_LShop[1][i] = 'bestellt';
    t.Warenkorb_LShop[1][spalte('Warenkorb_LShop', 'Bestell_ID')] = 'JFN-2026-0042';
    t.Warenkorb_LShop[1][spalte('Warenkorb_LShop', 'Liefertermin')] = '2026-11-26';
    t.Warenkorb_LShop[1][spalte('Warenkorb_LShop', 'AB_Hinweis')] = 'ok';
    expect((await seite()).eintraege[0].fortschritt.text).toBe('übernommen');   // Zwischenspeicher (hoechstens STAND_MS)
    expect(STAND_MS).toBeLessThanOrEqual(5 * 60 * 1000);
    _standCacheLeeren(); _auftraegeCacheLeeren();
    r = await seite();
    expect(r.eintraege[0].fortschritt).toMatchObject({ text: 'ca. KW 48', hinweis: 'kommt voraussichtlich erst KW 48 – wir melden uns' });
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/EIGEN:|JFN-2026|L-Shop|Rückstandsliste|AU-2026|1000000002|Preis|intern/);
    // MC sieht die Quelle
    expect((await mc()).eintraege[0].fortschritt).toMatchObject({ text: 'ca. KW 48', spaet: true, intern: { quelle: 'AB', korb: 'bestellt' } });
  });
});

describe('MC: gedruckt und an Fanshop geliefert', () => {
  test('gedruckt je Position und gesammelt, zurück; geliefert je Termin setzt Positionen + Trikots, fertig -> übergeben; Rücknahme', async () => {
    await uebernommen([{ art: 'artikel', id: '102', menge: 2 }, { art: 'extra', freitext: 'Fahne', menge: 1 }, { art: 'trikot', produktId: '901', groesse: 'M', name: 'ERFUNDEN', nummer: '7' }]);
    const au = () => t.Auftraege[1];
    const nr = au()[spalte('Auftraege', 'Auftrag_Nr')];
    const ids = t.Auftrag_Positionen.slice(1).map(r => r[0]);
    expect(ids).toHaveLength(2);
    let r = await setzeFertig({ eingabe: { positionIds: ids, fertig: true }, sheets: s.sheets, jetzt: JETZT });
    expect(r).toMatchObject({ geaendert: 2, unveraendert: 0 });
    expect(zelle('Auftrag_Positionen', 1, 'Fertig')).toBe('ja');
    expect(zelle('Auftrag_Positionen', 1, 'Fertig_Am')).toBe('2026-11-07');
    r = await setzeFertig({ eingabe: { positionIds: ids, fertig: true }, sheets: s.sheets, jetzt: JETZT });
    expect(r).toMatchObject({ geaendert: 0, unveraendert: 2 });   // Doppelklick
    expect((await seite()).summe).toMatchObject({ fertig: 2 });
    await setzeFertig({ eingabe: { positionIds: [ids[1]], gedruckt: false }, sheets: s.sheets, jetzt: JETZT });
    expect(zelle('Auftrag_Positionen', 2, 'Fertig')).toBe('');
    // Auftrag noch "Anfrage": geliefert setzt Positionen, Status bleibt mit Hinweis
    r = await setzeGeliefert({ eingabe: { zugangId: 'BS-001', terminId: termin }, sheets: s.sheets, jetzt: JETZT });
    expect(r).toMatchObject({ positionen: 2, trikots: 1, auftraege: [] });
    expect(r.hinweise[0]).toMatch(/steht auf „Anfrage“/);
    expect(zelle('Auftrag_Positionen', 1, 'Versendet')).toBe('2026-11-07');
    expect(zelle('Bestell_Eintraege', 3, 'Geliefert_Am')).toBe('2026-11-07');
    _standCacheLeeren();
    expect((await seite()).eintraege.map(e => e.fortschritt.schritt)).toEqual(['geliefert', 'geliefert', 'geliefert']);
    // Ruecknahme, dann Auftrag auf "fertig" -> geliefert setzt "übergeben"
    await setzeGeliefert({ eingabe: { zugangId: 'BS-001', terminId: termin, zurueck: true }, sheets: s.sheets, jetzt: JETZT });
    expect(zelle('Auftrag_Positionen', 1, 'Versendet')).toBe('');
    expect(zelle('Bestell_Eintraege', 3, 'Geliefert_Am')).toBe('');
    au()[spalte('Auftraege', 'Status')] = 'fertig';
    r = await setzeGeliefert({ eingabe: { zugangId: 'BS-001', auftragNr: nr }, sheets: s.sheets, jetzt: JETZT });
    expect(r.auftraege).toEqual([{ auftragNr: nr, status: 'übergeben' }]);
    expect(zelle('Auftraege', 1, 'Uebergeben_Am')).toBe('2026-11-07');
    r = await setzeGeliefert({ eingabe: { zugangId: 'BS-001', auftragNr: nr }, sheets: s.sheets, jetzt: JETZT });
    expect(r.unveraendert).toBe(true);
    await setzeGeliefert({ eingabe: { zugangId: 'BS-001', auftragNr: nr, zurueck: true }, sheets: s.sheets, jetzt: JETZT });
    expect(zelle('Auftraege', 1, 'Status')).toBe('fertig');
    expect(s.aufrufe.append).toBe(0);
  });
});

describe('Verschieben in einen anderen Termin', () => {
  test('noch nicht übernommen: nur Termin_ID; alter Termin zeigt "verschoben auf"; früherer Termin 422; Doppelklick', async () => {
    await absenden([{ art: 'artikel', id: '101', menge: 1 }]);
    const a = await wahl();
    await expect(verschiebe({ eingabe: { zugangId: 'BS-001', auswahl: a, zielTermin: termin2, grund: 'x'.repeat(101), vorgang: V(60) }, sheets: s.sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 422 });
    const r = await verschiebe({ eingabe: { zugangId: 'BS-001', auswahl: a, zielTermin: termin2, grund: 'Lieferrückstand', vorgang: V(60) }, sheets: s.sheets, jetzt: JETZT });
    expect(r).toMatchObject({ anzahl: 1, auftragNr: null, positionenNeu: 0 });
    expect(zelle('Bestell_Eintraege', 1, 'Termin_ID')).toBe(termin2);
    expect(zelle('Bestell_Eintraege', 1, 'Verschoben_Von')).toBe(termin);
    const alt = await seite(termin);
    expect(alt.eintraege).toHaveLength(0);
    expect(alt.verschoben[0]).toMatchObject({ verschobenAuf: '2026-11-27', verschobenGrund: 'Lieferrückstand' });
    expect((await seite(termin2)).eintraege[0]).toMatchObject({ verschobenVon: termin });
    const b = await wahl();
    expect(await verschiebe({ eingabe: { zugangId: 'BS-001', auswahl: b, zielTermin: termin2, vorgang: V(61) }, sheets: s.sheets, jetzt: JETZT })).toMatchObject({ schon: true });
    await expect(verschiebe({ eingabe: { zugangId: 'BS-001', auswahl: b, zielTermin: termin, vorgang: V(62) }, sheets: s.sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 422, code: 'frueher' });
  });
  test('übernommen: alte Position "verschoben", neue mit Verweis auf die Korb-Zeile im neuen Termin-Auftrag; Korb unverändert; Ware/Packliste richtig', async () => {
    await uebernommen([{ art: 'artikel', id: '102', menge: 2 }, { art: 'artikel', id: '101', menge: 1 }]);
    const korbVorher = JSON.stringify(t.Warenkorb_LShop);
    const altNr = t.Auftraege[1][0];
    const [e1] = await wahl(e => e.auswahl === '102');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const probe = await verschiebe({ eingabe: { zugangId: 'BS-001', auswahl: [e1], zielTermin: termin2, dryRun: true }, sheets: s.sheets, jetzt: JETZT });
    expect(probe).toMatchObject({ dryRun: true, auftragNeu: true, positionenNeu: 1, positionenGeaendert: 1 });
    expect(t.Auftraege).toHaveLength(2);   // Trockenlauf schreibt nichts
    const r = await verschiebe({ eingabe: { zugangId: 'BS-001', auswahl: [e1], zielTermin: termin2, grund: 'Lieferrückstand', vorgang: V(70) }, sheets: s.sheets, jetzt: JETZT });
    expect(r).toMatchObject({ auftragNeu: true, positionenNeu: 1, positionenGeaendert: 1 });
    const neuNr = r.auftragNr;
    expect(neuNr).not.toBe(altNr);
    expect(JSON.stringify(t.Warenkorb_LShop)).toBe(korbVorher);   // Korb unveraendert
    const alt = t.Auftrag_Positionen[1], neu = t.Auftrag_Positionen.at(-1);
    const sp = n => spalte('Auftrag_Positionen', n);
    expect(alt[sp('Entfernt')]).toBe('2026-11-07');
    expect(alt[sp('Verschoben_Nach')]).toBe(neu[sp('Position_ID')]);
    expect(neu).toEqual(expect.arrayContaining([neuNr, 'vorhanden', 'EIGEN:2026-0101']));
    expect(t.Bestell_Termine[2][spalte('Bestell_Termine', 'Auftrag_Nr')]).toBe(neuNr);
    expect(zelle('Bestell_Eintraege', 1, 'Auftrag_Nr')).toBe(neuNr);
    // Auftragsansicht: alter Auftrag zeigt "verschoben nach", zaehlt die Position nicht mehr (Ware, Stueck)
    _auftraegeCacheLeeren();
    const liste = (await leseAuftraege({ sheets: s.sheets, jetzt: JETZT })).auftraege;
    const a0 = liste.find(x => x.Auftrag_Nr === altNr), a1 = liste.find(x => x.Auftrag_Nr === neuNr);
    expect(a0.positionen.map(p => p.LShop_ArticleNr)).toEqual([NR_M]);
    expect(a0.verschoben).toEqual([expect.objectContaining({ nach: neu[sp('Position_ID')], ganz: true })]);
    expect(a1.positionen[0]).toMatchObject({ Herkunft: 'vorhanden', Verweis: 'EIGEN:2026-0101', verweisKorb: { status: 'offen' } });
    expect(a1.ware).toBe('offen');
    // Seite: Eintrag steht im neuen Termin, Stand folgt weiter dem Korb; alter Termin zeigt ihn als verschoben
    expect((await seite(termin2)).eintraege[0].fortschritt.text).toBe('übernommen');
    expect((await seite(termin)).verschoben).toHaveLength(1);
    expect(s.aufrufe.append).toBe(0);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(new RegExp(`${KUERZEL}|Fanshop|Lieferrückstand`));
  });
  test('Teil einer zusammengefassten Position: Menge sinkt, Verschoben_Nach; Ziel-Termin mit Auftrag bis "bestellt" wird angehängt; geliefert -> gesperrt', async () => {
    await absenden([{ art: 'artikel', id: '101', menge: 2 }], 2);
    await absenden([{ art: 'artikel', id: '101', menge: 3 }], 3);
    await pruefeEintraege({ eingabe: { zugangId: 'BS-001', aktion: 'geprueft', auswahl: await wahl() }, sheets: s.sheets, jetzt: SPAETER });
    await uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: await wahl(), vorgang: V(80) }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen });
    const sp = n => spalte('Auftrag_Positionen', n);
    expect(t.Auftrag_Positionen[1][sp('Menge')]).toBe('5');
    const [a] = await wahl();
    const r = await verschiebe({ eingabe: { zugangId: 'BS-001', auswahl: [a], neuesDatum: '2026-12-06', vorgang: V(81) }, sheets: s.sheets, jetzt: JETZT });
    expect(r).toMatchObject({ terminNeu: true, auftragNeu: true, hinweise: [expect.stringMatching(/2 von 5 Stück verschoben, 3 bleiben/)] });
    expect(t.Auftrag_Positionen[1][sp('Menge')]).toBe(3);
    expect(t.Auftrag_Positionen[1][sp('Entfernt')]).toBe('');
    expect(t.Auftrag_Positionen.at(-1)[sp('Herkunft')]).toBe('bestellen');   // noch nicht bereitgestellt: bleibt bestellen
    expect(t.Bestell_Termine).toHaveLength(4);
    // geliefert -> gesperrt
    const [, b] = await wahl();
    t.Auftrag_Positionen[1][sp('Versendet')] = '2026-11-22';
    await expect(verschiebe({ eingabe: { zugangId: 'BS-001', auswahl: [b], zielTermin: termin2, vorgang: V(82) }, sheets: s.sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 409, code: 'geliefert' });
  });
  test('Herkunft nach Verschieben: 🛒 übergeben / 📦 ausgebucht / ✓ / frei', () => {
    expect(herkunftNachVerschieben({ Art: 'lshop', Korb_Schluessel: 'EIGEN:1' })).toMatchObject({ Herkunft: 'vorhanden', Verweis: 'EIGEN:1' });
    expect(herkunftNachVerschieben({ Art: 'lshop', Herkunft: 'lager', Lager_Buchung: 'LB-1', Position_ID: 'AU-2026-0001-02' })).toMatchObject({ Herkunft: 'vorhanden', Verweis: 'AU-2026-0001-02' });
    expect(herkunftNachVerschieben({ Art: 'lshop', Herkunft: 'lager', Lager_Ort: 'Wrist' })).toMatchObject({ Herkunft: 'lager', Lager_Ort: 'Wrist' });
    expect(herkunftNachVerschieben({ Art: 'frei', Herkunft: 'vorhanden', Verweis: 'ohne Verweis: x' })).toMatchObject({ Verweis: 'ohne Verweis: x' });
    expect(herkunftNachVerschieben({ Art: 'frei', Herkunft: '' })).toMatchObject({ Herkunft: '', Verweis: '' });
    // verschobene Lager-Position: Ware "da" ueber die alte Position
    const posJe = new Map([['AU-2026-0001-02', { Position_ID: 'AU-2026-0001-02', Art: 'lshop', Herkunft: 'lager', Lager_Buchung: 'LB-1' }]]);
    expect(standFuer({ Eintrag_ID: 'BE-1', Art: 'artikel', Status: 'übernommen', Position_ID: 'AU-2026-0002-01' },
      { posJe: new Map([...posJe, ['AU-2026-0002-01', { Position_ID: 'AU-2026-0002-01', Art: 'lshop', Herkunft: 'vorhanden', Verweis: 'AU-2026-0001-02' }]]) })).toMatchObject({ schritt: 'beiUns' });
    expect(wareStand([{ Art: 'lshop', Herkunft: 'vorhanden', Verweis: 'AU-2026-0001-02' }], new Map())).toBe('');
    expect(() => verschiebenPlan({ zugang: { Zugang_ID: 'BS-001' }, termine: [], zielTermin: null, eintraege: [], auswahl: [{ id: 'x' }], jetzt: JETZT().toISOString() })).toThrow();
  });
  test('Trikot: nur der Eintrag wandert (Trikot-Zeile unverändert), geliefert -> gesperrt', async () => {
    await uebernommen([{ art: 'trikot', produktId: '901', groesse: 'M', name: 'ERFUNDEN', nummer: '7' }]);
    expect(trikotAufrufe).toHaveLength(1);
    const [a] = await wahl();
    const r = await verschiebe({ eingabe: { zugangId: 'BS-001', auswahl: [a], zielTermin: termin2, vorgang: V(90) }, sheets: s.sheets, jetzt: JETZT });
    expect(r).toMatchObject({ anzahl: 1, positionenNeu: 0, auftragNr: null });
    expect(zelle('Bestell_Eintraege', 1, 'Termin_ID')).toBe(termin2);
    expect(zelle('Bestell_Eintraege', 1, 'Auftrag_Nr')).toMatch(/^AU-/);   // bleibt (Referenz der Trikot-Zeile)
    expect(trikotAufrufe).toHaveLength(1);
  });
});

describe('Seite: Termin ändern bis "übernommen"', () => {
  test('anderer Termin wählbar; vorbei/fremd abgelehnt; übernommen nur lesen', async () => {
    await absenden([{ art: 'artikel', id: '101', menge: 1 }]);
    let e = (await seite()).eintraege[0];
    await expect(aendereEintragSeite({ token, eingabe: { eintrag: e.id, stand: e.stand, kuerzel: KUERZEL, termin: 'BT-9999' }, sheets: s.sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 404 });
    await aendereEintragSeite({ token, eingabe: { eintrag: e.id, stand: e.stand, kuerzel: KUERZEL, termin: termin2 }, sheets: s.sheets, jetzt: JETZT });
    e = (await seite(termin2)).eintraege[0];
    expect(e).toMatchObject({ termin: termin2, verschobenVon: termin, geaendertVon: KUERZEL });
    await pruefeEintraege({ eingabe: { zugangId: 'BS-001', aktion: 'geprueft', auswahl: await wahl() }, sheets: s.sheets, jetzt: SPAETER });
    await uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin2, auswahl: await wahl(), vorgang: V(95) }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen });
    e = (await seite(termin2)).eintraege[0];
    await expect(aendereEintragSeite({ token, eingabe: { eintrag: e.id, stand: e.stand, kuerzel: KUERZEL, termin }, sheets: s.sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 422 });
  });
});

describe('Oberflächen', () => {
  const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
  const seiteHtml = readFileSync(resolve(hier, '../../frontend/bestellen.html'), 'utf8');
  test('Seite: Fortschritt, Hinweis orange, Summe, verschoben, Termin ändern - ohne title', () => {
    expect(seiteHtml).toMatch(/bsFortschrittHtml/);
    expect(seiteHtml).toMatch(/bsSummeHtml/);
    expect(seiteHtml).toMatch(/verschoben auf/);
    expect(seiteHtml).toMatch(/data-termin-aendern/);
    expect(seiteHtml).not.toMatch(/ title="/);
  });
  test('MC: gedruckt, geliefert, Warnliste, verschieben mit Mouse-over', () => {
    for (const k of ['bsm-fertig', 'bsm-s-fertig', 'bsm-geliefert', 'bsm-geliefert-zurueck', 'bsm-warn', 'bsm-verschieben', 'bsm-v-ziel', 'bsm-v-grund', 'bsm-v-los', 'bsm-fortschritt', 'au-geliefert', 'au-alle-fertig', 'au-verschoben']) {
      expect(html).toMatch(new RegExp(`'${k}':\\s*\\{ name:`));
      expect(html).toMatch(new RegExp(`data-hilfe="${k}"`));
    }
  });
});

describe('KS4-1: "fertig" nur vom Menschen, Texte "fertig", Liste oben', () => {
  const sp = n => spalte('Auftrag_Positionen', n);
  test('Übernahme setzt Fertig nie; Verschieben übernimmt Fertig nur von echter Quelle (ja)', async () => {
    await uebernommen([{ art: 'artikel', id: '102', menge: 2 }, { art: 'artikel', id: '101', menge: 1 }]);
    for (const r of t.Auftrag_Positionen.slice(1)) { expect(r[sp('Fertig')]).toBe(''); expect(r[sp('Fertig_Am')]).toBe(''); }
    expect((await mc()).eintraege.map(e => e.fortschritt.schritt)).toEqual(['uebernommen', 'uebernommen']);
    // Quelle ohne echten Haken (Datum ohne "ja", Unsinn) -> neue Position ohne Fertig
    t.Auftrag_Positionen[1][sp('Fertig')] = 'x'; t.Auftrag_Positionen[1][sp('Fertig_Am')] = '2026-11-07';
    t.Auftrag_Positionen[2][sp('Fertig')] = 'ja'; t.Auftrag_Positionen[2][sp('Fertig_Am')] = '2026-11-06';
    _auftraegeCacheLeeren(); _standCacheLeeren();
    expect((await mc()).eintraege.map(e => e.fortschritt.schritt)).toEqual(['uebernommen', 'fertig']);   // "fertig" nur aus Fertig = ja
    const a = await wahl();
    await verschiebe({ eingabe: { zugangId: 'BS-001', auswahl: a, zielTermin: termin2, vorgang: V(120) }, sheets: s.sheets, jetzt: JETZT });
    const neu = t.Auftrag_Positionen.slice(-2);
    expect(neu.map(r => [r[sp('Fertig')], r[sp('Fertig_Am')]])).toEqual([['', ''], ['ja', '2026-11-06']]);
  });
  test('Texte: Seite und MC sagen "fertig", nie "gedruckt"; Rückfragen bei fehlender Ware und beim Bereitstellen', () => {
    const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
    const seiteHtml = readFileSync(resolve(hier, '../../frontend/bestellen.html'), 'utf8');
    expect(seiteHtml.replace(/\/\/.*$/gm, '')).not.toMatch(/gedruckt/);
    expect(html).not.toMatch(/'(bsm|au)-[a-z-]*gedruckt'/);
    expect(html).toMatch(/Ware noch nicht da – trotzdem fertig\?/);
    expect(html).toMatch(/Schon als fertig markiert – trotzdem bestellen\?/);
    expect(html).toMatch(/<label class="au-pos-haken" data-hilfe="au-pos-fertig">/);   // Haken nicht mehr ueber die ganze Zeile
  });
  test('Seite: Liste "Eingetragen" oben direkt nach dem Termin, einklappbar (sessionStorage), Summe im Kopf, Sprung nach Absenden', () => {
    const seiteHtml = readFileSync(resolve(hier, '../../frontend/bestellen.html'), 'utf8');
    const z = seiteHtml.slice(seiteHtml.indexOf('function zeichnen()'), seiteHtml.indexOf('async function eintraegeLaden'));
    expect(z.indexOf('bsEingetragenHtml(')).toBeGreaterThan(0);
    expect(z.indexOf('bsEingetragenHtml(')).toBeLessThan(z.indexOf('Eintragen für'));
    expect(seiteHtml).toMatch(/bs_liste_zu/);
    expect(seiteHtml).not.toMatch(/localStorage\.setItem\('bs_liste/);
    expect(seiteHtml).toMatch(/getElementById\('bs-eingetragen'\)\?\.scrollIntoView/);
    const a = seiteHtml.indexOf('// ── Bestellseite-Anzeige: Anfang'), b = seiteHtml.indexOf('// ── Bestellseite-Anzeige: Ende ──');
    const F = new Function(`${seiteHtml.slice(a, b)}\nreturn { bsEingetragenHtml };`)();
    const h = F.bsEingetragenHtml({ eintraege: [{ id: 'BE-1', art: 'extra', freitext: 'Fahne', menge: 1, status: 'eingegangen', kuerzel: 'X', zeit: '' }], summe: { gesamt: 3, beiUns: 2, fertig: 1 },
      verschoben: [], laedt: false, offen: true, schreibbar: false, d: null, terminWahl: '', neu: new Set(['BE-1']) });
    expect(h).toMatch(/<details class="card bs-eingetragen" id="bs-eingetragen" open><summary><h2>Eingetragen für diesen Termin \(1\)<\/h2><span class="bs-summe">2 von 3 bei uns · 1 fertig<\/span>/);
    expect(h).toMatch(/class="bs-eintrag neu"/);
    expect(F.bsEingetragenHtml({ eintraege: [], offen: false, d: null })).not.toMatch(/ open>/);
  });
});
