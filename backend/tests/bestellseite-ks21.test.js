// KS2-1: Variationsbilder je Farbkarte, Rueckmeldung nach "Artikelliste aktualisieren", Katalog sofort neu, Notiz je Position.
// Nur erfundene Werte.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import { legeZugangAn, leseSeite, aktualisiereBilder, _bestellseiteCacheLeeren } from '../lib/bestellseite.js';
import { legeTerminAn, sendeAb, leseEintraege, aendereEintragSeite } from '../lib/bestellEintraege.js';
import { ZUGANG_SPALTEN, ZUGANG_OPTIONAL, TERMIN_SPALTEN, EINTRAG_SPALTEN, BILD_SPALTEN, BILD_OPTIONAL, katalogDauer } from '../utils/bestellseite.js';
import { EINTRAG_OPTIONAL } from '../utils/bestell-eintraege.js';

const hier = dirname(fileURLToPath(import.meta.url));
process.env.GOOGLE_SHEET_ID = 'test-sheet';
process.env.BUSINESS_SHEET_ID = 'test-business';
const JETZT = () => new Date('2026-11-07T10:00:00Z');
const kunden = async () => ({ kunden: [{ Kunden_Nr: 'K-00063', Status: 'aktiv' }] });
let z = 100; const zufall = () => Buffer.alloc(32, ++z);
const H = 'https://i0.wp.com/shop.example/haupt.jpg?fit=800%2C800';
const E1 = 'https://i0.wp.com/shop.example/regenbogen.jpg?fit=800%2C800';
const E2 = 'https://i0.wp.com/shop.example/jubilaeum.jpg?fit=800%2C800';

function tabs(bilder) {
  return {
    Bestellseiten: [[...ZUGANG_SPALTEN, ...ZUGANG_OPTIONAL]],
    Bestell_Termine: [TERMIN_SPALTEN],
    Bestell_Eintraege: [[...EINTRAG_SPALTEN, ...EINTRAG_OPTIONAL]],
    Bestell_Bilder: [[...BILD_SPALTEN, ...BILD_OPTIONAL], ...bilder],
    Struktur_Kategorien: [['Kategorienummer', 'Kategorien', 'Kategoriename'], ['549', 'Club', 'Club']],
    Erfassungsmaske: [['ID', 'Status Shop', 'Produkt-ID', 'Produktname', 'Kategorien'], ['A1', 'Veröffentlicht', '50', 'Babybody Test', 'Club']],
    Varianten: [['SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'Preis', 'Aktiv', 'WC_Variation_ID', 'Google_Farbe', 'LShop_ArticleNr'],
      ['A1', '1', 'Farbe', 'Black', 'Größe', '0-3', 'Design', 'Jubiläum', '', 'TRUE', '501', '', ''],
      ['A1', '2', 'Farbe', 'Black', 'Größe', '3-6', 'Design', 'Jubiläum', '', 'TRUE', '502', '', ''],
      ['A1', '3', 'Farbe', 'Black', 'Größe', '0-3', 'Design', 'Standard', '', 'TRUE', '511', '', '']],
    Trikot_Artikel: [['Produkt-ID', 'Produktname', 'Aktiv']],
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage']],
  };
}
const zeileBild = (id, art, url, stand = 's1') => [id, art, url, art === 'produkt' ? 'publish' : '', stand, ''];

beforeEach(() => { _bestellseiteCacheLeeren(); jest.spyOn(console, 'warn').mockImplementation(() => {}); jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe('Bild je Farbkarte', () => {
  const kat = [{ nr: '549', pfad: 'Club', name: 'Club' }];
  const maske = [{ id: 'A1', status: 'Veröffentlicht', produktId: '50', name: 'Babybody Test', kategorien: 'Club' }];
  const v = (wc, gr, design) => ({ ssotId: 'A1', E1: 'Farbe', V1: 'Black', E2: 'Größe', V2: gr, E3: 'Design', V3: design, aktiv: 'TRUE', wcId: wc });
  const varianten = [v('501', '0-3', 'Jubiläum'), v('502', '3-6', 'Jubiläum'), v('511', '0-3', 'Standard')];
  test('erstes EIGENES Variationsbild, auch wenn die erste Groesse noch das Hauptbild traegt; ohne eigenes -> Hauptbild', () => {
    const bilder = new Map([['50', { url: H, status: 'publish' }], ['501', { url: H }], ['502', { url: E2 }], ['511', { url: H }]]);
    const k = katalogDauer({ sortiment: '549', kategorien: kat, maske, varianten, bilder });
    const bild = d => k.find(x => x.design === d).bild;
    expect(bild('Jubiläum')).toContain('jubilaeum.jpg');
    expect(bild('Standard')).toContain('haupt.jpg');
    expect(katalogDauer({ sortiment: '549', kategorien: kat, maske, varianten, bilder: new Map() }).every(x => x.bild === '')).toBe(true);
  });
});

describe('Artikelliste aktualisieren', () => {
  test('Rueckmeldung zaehlt neu / unveraendert / ohne Bild; die Seite zeigt das neue Bild sofort', async () => {
    const t = tabs([zeileBild('50', 'produkt', H), zeileBild('501', 'variante', H), zeileBild('502', 'variante', E1), zeileBild('511', 'variante', H)]);
    const { sheets } = machSheets(t);
    const { token } = await legeZugangAn({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', vorgang: 'vorgang-ks21-a' }, sheets, jetzt: JETZT, kundenLesen: kunden, zufall });
    const vorher = await leseSeite({ token, sheets, jetzt: JETZT });
    expect(vorher.artikel.find(a => a.design === 'Jubiläum').bild).toContain('regenbogen.jpg');
    const get = jest.fn(async (pfad) => {
      if (pfad === 'products') return { data: [{ id: 50, status: 'publish', images: [{ src: H }], categories: [{ id: 549 }] }] };
      return { data: [{ id: 501, image: { src: E2 } }, { id: 502, image: { src: E2 } }, { id: 511, image: { src: '' } }] };
    });
    const r = await aktualisiereBilder({ sheets, wc: { get }, jetzt: () => new Date('2026-11-07T11:00:00Z'), takt: 0 });
    expect(r).toMatchObject({ bilderNeu: 2, bilderUnveraendert: 1, ohneBild: 1 });   // 501, 502 neu; 50 gleich; 511 leer
    // andere Instanz: Katalog-Cache bleibt, aber der Bilder-Stand im Schluessel ist neu -> neues Bild sofort
    const nachher = await leseSeite({ token, sheets, jetzt: JETZT });
    expect(nachher.artikel.find(a => a.design === 'Jubiläum').bild).toContain('jubilaeum.jpg');
  });
  test('Kundenseite fragt nie den Shop (nur die eigene API)', () => {
    const seite = readFileSync(resolve(hier, '../../frontend/bestellen.html'), 'utf8');
    const skript = seite.slice(seite.indexOf('<script>', seite.indexOf('</head>')));
    expect([...skript.matchAll(/fetch\(([^,)]+)/g)].map(m => m[1].trim())).toEqual(['`${API_BASE}/api/bestellseite/${pfad}`']);
    expect(skript).not.toMatch(/wp-json|wc\/v3/);
  });
  test('MC-Text der Rueckmeldung', () => {
    const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
    const block = html.slice(html.indexOf('// ── Bestellseiten-MC: Anfang'), html.indexOf('// ── Bestellseiten-MC: Ende ──'));
    const F = new Function('kuEsc', `${block}\nreturn { bsmBilderText };`)(x => String(x));
    expect(F.bsmBilderText({ bilderNeu: 3, bilderUnveraendert: 590, ohneBild: 8, produkte: 61, trikots: 2 }))
      .toBe('Artikelliste aktualisiert: 3 Bilder neu, 590 unverändert, 8 ohne Bild (61 Artikel, 2 Trikots). Die Bestellseite zeigt das sofort.');
    expect(html).toContain("'bsm-bilder':           { name: 'Artikelliste aktualisieren', text: 'Nach Bildänderungen im Shop hier klicken; die Seite zeigt sie danach sofort.");
  });
});

describe('Notiz je Position', () => {
  async function mitTermin() {
    const t = tabs([zeileBild('50', 'produkt', H)]);
    const { sheets } = machSheets(t);
    const { token } = await legeZugangAn({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', vorgang: 'vorgang-ks21-b' }, sheets, jetzt: JETZT, kundenLesen: kunden, zufall });
    await legeTerminAn({ token, eingabe: { datum: '2026-11-21' }, sheets, jetzt: JETZT });
    return { t, sheets, token };
  }
  test('alle Arten, gespeichert in Spalte Notiz, aenderbar mit "geändert von", nie in Log oder Chat', async () => {
    const { t, sheets, token } = await mitTermin();
    const melden = jest.fn(async () => true);
    await sendeAb({ token, eingabe: { termin: 'BT-0001', kuerzel: 'Anna', vorgang: 'vorgang-ks21-c', positionen: [
      { art: 'artikel', id: '501', menge: 1, notiz: 'für Testkind Mia' }, { art: 'extra', freitext: 'Fahne', menge: 1, notiz: 'Notiz Zwei' }] }, sheets, jetzt: JETZT, melden });
    const k = t.Bestell_Eintraege[0];
    expect(t.Bestell_Eintraege.slice(1).map(r => r[k.indexOf('Notiz')])).toEqual(['für Testkind Mia', 'Notiz Zwei']);
    const { eintraege } = await leseEintraege({ token, termin: 'BT-0001', sheets, jetzt: JETZT });
    expect(eintraege[0].notiz).toBe('für Testkind Mia');
    const r = await aendereEintragSeite({ token, eingabe: { eintrag: eintraege[0].id, stand: eintraege[0].stand, kuerzel: 'Ben', notiz: 'neu' }, sheets, jetzt: JETZT });
    expect(r.eintrag).toMatchObject({ notiz: 'neu', geaendertVon: 'Ben' });
    const ausgaben = JSON.stringify([...melden.mock.calls, ...console.log.mock.calls]);
    expect(ausgaben).not.toMatch(/Testkind|Notiz Zwei|Mia/);
  });
  test('hoechstens 100 Zeichen', async () => {
    const { sheets, token } = await mitTermin();
    await expect(sendeAb({ token, eingabe: { termin: 'BT-0001', kuerzel: 'Anna', vorgang: 'vorgang-ks21-d', positionen: [{ art: 'artikel', id: '501', menge: 1, notiz: 'x'.repeat(101) }] }, sheets, jetzt: JETZT, melden: async () => true }))
      .rejects.toMatchObject({ status: 422 });
  });
  test('Seite: Raster-Notiz gilt fuer alle Groessen der Karte, sichtbar im Korb und in der Liste; MC zeigt sie', () => {
    const seite = readFileSync(resolve(hier, '../../frontend/bestellen.html'), 'utf8');
    const block = seite.slice(seite.indexOf('// ── Bestellseite-Anzeige: Anfang'), seite.indexOf('// ── Bestellseite-Anzeige: Ende ──'));
    const F = new Function(`${block}\nreturn { bsPositionenAusRaster, bsKorbHtml, bsEintragHtml };`)();
    const pos = F.bsPositionenAusRaster({ name: 'Body', groessen: [{ id: '1', groesse: '0-3' }, { id: '2', groesse: '3-6' }] }, { 1: '1', 2: '2' }, ' für Lena ');
    expect(pos.map(p => p.notiz)).toEqual(['für Lena', 'für Lena']);
    expect(F.bsKorbHtml(pos, 'TK', true)).toContain('Notiz: für Lena');
    expect(F.bsEintragHtml({ id: 'BE-1', art: 'artikel', menge: 1, bezeichnung: 'Body', notiz: 'für <b>', kuerzel: 'TK', zeit: '', status: 'eingegangen' }, true)).toContain('Notiz: für &lt;b&gt;');
    expect(seite).toContain('Nur Kürzel oder Vorname, keine Telefonnummern o. Ä.');
    const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
    const mc = html.slice(html.indexOf('// ── Bestellseiten-MC: Anfang'), html.indexOf('// ── Bestellseiten-MC: Ende ──'));
    const kuEsc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const M = new Function('kuEsc', `${mc}\nreturn { bsmEintraegeHtml };`)(kuEsc);
    expect(M.bsmEintraegeHtml([{ id: 'BE-1', termin: 'BT-1', art: 'artikel', menge: 1, bezeichnung: 'Body', notiz: 'für Lena', kuerzel: 'TK', zeit: '2026-11-07T10:00:00Z', status: 'eingegangen' }], [], '')).toContain('Notiz: für Lena');
  });
});
