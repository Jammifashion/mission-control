// KS2: Bestellseite - Termine, Absenden, Aendern, Stornieren (Logik + Lesen/Schreiben gegen In-Memory-Sheet), Seite, MC.
// Nur erfundene Werte (Kürzel, Namen, Texte sind ausgedacht).
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import { legeZugangAn, bearbeiteZugang, leseZugaenge, _bestellseiteCacheLeeren, leseSeite } from '../lib/bestellseite.js';
import { leseEintraege, legeTerminAn, sendeAb, aendereEintragSeite, storniereEintragSeite, leseEintraegeMc } from '../lib/bestellEintraege.js';
import { ZUGANG_SPALTEN, ZUGANG_OPTIONAL, TERMIN_SPALTEN, EINTRAG_SPALTEN, BILD_SPALTEN, BILD_OPTIONAL, bildGroesse, trikotsDauer, sortimentNummern } from '../utils/bestellseite.js';
import { EINTRAG_OPTIONAL, terminPlan, absendenPlan, auswahlIndex, kuerzelAus, absendenNachricht, MAX } from '../utils/bestell-eintraege.js';
import { AUFTRAG_SPALTEN, POSITION_SPALTEN } from '../utils/auftraege.js';

const hier = dirname(fileURLToPath(import.meta.url));
process.env.GOOGLE_SHEET_ID = 'test-sheet';
process.env.BUSINESS_SHEET_ID = 'test-business';
const JETZT = () => new Date('2026-11-07T10:00:00Z');
const NACH_SCHLUSS = () => new Date('2026-11-19T10:00:00Z');   // Termin 21.11., Schluss 17.11.
const kunden = async () => ({ kunden: [{ Kunden_Nr: 'K-00063', Status: 'aktiv' }, { Kunden_Nr: 'K-00001', Status: 'aktiv' }] });
const zeile = (spalten, o) => spalten.map(s => o[s] ?? '');
let z = 0; const zufall = () => Buffer.alloc(32, ++z);
const KAT = [['Kategorienummer', 'Kategorien', 'Kategoriename'], ['549', 'Club', 'Club'], ['554', 'Club > Basics', 'Basics'], ['561', 'Club > Trikots', 'Trikots']];

function tabs() {
  return {
    Bestellseiten: [[...ZUGANG_SPALTEN, ...ZUGANG_OPTIONAL]],
    Bestell_Termine: [TERMIN_SPALTEN],
    Bestell_Eintraege: [[...EINTRAG_SPALTEN, ...EINTRAG_OPTIONAL]],
    Bestell_Bilder: [[...BILD_SPALTEN, ...BILD_OPTIONAL], ['901', 'produkt', 'https://i0.wp.com/shop.example/t.jpg?fit=800%2C800', 'publish', 's', '561']],
    Struktur_Kategorien: KAT,
    Erfassungsmaske: [['ID', 'Status Shop', 'Produkt-ID', 'Produktname', 'Kategorien'], ['A1', 'Veröffentlicht', '11', 'Hoodie Club', 'Club, Basics']],
    Varianten: [['SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'Preis', 'Aktiv', 'WC_Variation_ID', 'Google_Farbe', 'LShop_ArticleNr'],
      ['A1', '1', 'Farbe', 'Black', 'Größe', 'M', '', '', '49,95', 'TRUE', '101', '', '1000000001'],
      ['A1', '2', 'Farbe', 'Black', 'Größe', 'L', '', '', '49,95', 'TRUE', '102', '', '1000000002'],
      ['A1', '3', 'Farbe', 'Red', 'Größe', 'M', '', '', '49,95', 'TRUE', '103', '', '']],
    Trikot_Artikel: [['Artikelnummer', 'Produkt-ID', 'Produktname', 'Aktiv'], ['TR-H', '901', 'Heimtrikot Test', 'TRUE'], ['TR-X', '902', 'Fremdtrikot', 'TRUE']],
    Auftraege: [AUFTRAG_SPALTEN, zeile(AUFTRAG_SPALTEN, { Auftrag_Nr: 'AU-2026-0007', Kunden_Nr: 'K-00001', Kurztitel: 'Turnier', Status: 'Angebot', Termin: '2026-12-01', Stand: 's' })],
    Auftrag_Positionen: [POSITION_SPALTEN, zeile(POSITION_SPALTEN, { Position_ID: 'AU-2026-0007-01', Auftrag_Nr: 'AU-2026-0007', Art: 'frei', Freitext: 'Tasse', Menge: 3 })],
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage']],
  };
}
async function dauerZugang(t, jetzt = JETZT) {
  const { sheets } = machSheets(t);
  const { token } = await legeZugangAn({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', vorgang: `vorgang-${z}-dauer` }, sheets, jetzt, kundenLesen: kunden, zufall });
  return { sheets, token };
}
const VG = n => `vorgang-test-${n}-xyz`;

let log;
beforeEach(() => { _bestellseiteCacheLeeren(); jest.spyOn(console, 'warn').mockImplementation(() => {}); log = jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe('Termine', () => {
  test('anlegen, gleiches Datum = vorhandener, vergangen abgelehnt', async () => {
    const t = tabs(); const { sheets, token } = await dauerZugang(t);
    const a = await legeTerminAn({ token, eingabe: { datum: '2026-11-21', notiz: 'Gegner Test' }, sheets, jetzt: JETZT });
    expect(a).toEqual({ ok: true, schon: false, termin: 'BT-0001' });
    expect(t.Bestell_Termine[1].slice(0, 5)).toEqual(['BT-0001', 'BS-001', '2026-11-21', 'Gegner Test', '2026-11-17']);
    expect(await legeTerminAn({ token, eingabe: { datum: '2026-11-21' }, sheets, jetzt: JETZT })).toEqual({ ok: true, schon: true, termin: 'BT-0001' });
    await expect(legeTerminAn({ token, eingabe: { datum: '2026-11-01' }, sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 422 });
    await expect(legeTerminAn({ token, eingabe: { datum: '2026-11-25', notiz: 'x'.repeat(61) }, sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 422 });
  });
  test('Art auftrag: genau ein Termin, kein Anlegen', () => {
    expect(() => terminPlan({ zugang: { Art: 'auftrag', Zugang_ID: 'BS-002' }, termine: [], eingabe: { datum: '2026-12-01' }, jetzt: JETZT().toISOString() })).toThrow(/kein Anlegen/);
  });
});

describe('Absenden', () => {
  async function mitTermin(jetzt = JETZT) {
    const t = tabs(); const { sheets, token } = await dauerZugang(t);
    await legeTerminAn({ token, eingabe: { datum: '2026-11-21' }, sheets, jetzt: JETZT });
    return { t, sheets, token };
  }
  test('drei Arten in EINEM Schreibvorgang, Chat nur mit Zugang/Anzahl/Datum, Doppelklick = nichts doppelt', async () => {
    const { t, sheets, token } = await mitTermin();
    const melden = jest.fn(async () => true);
    const eingabe = { termin: 'BT-0001', kuerzel: 'Testkü', vorgang: VG(1), positionen: [
      { art: 'artikel', id: '101', menge: 3 }, { art: 'extra', freitext: 'Fahnen für Testtribüne', menge: 2, fuer: 'Trainer' },
      { art: 'trikot', produktId: '901', groesse: 'L', name: 'TESTNAME', nummer: '7', wunsch: 'Torwart bitte' }] };
    const r = await sendeAb({ token, eingabe, sheets, jetzt: JETZT, melden });
    expect(r).toEqual({ ok: true, schon: false, anzahl: 3 });
    const zeilen = t.Bestell_Eintraege.slice(1);
    expect(zeilen).toHaveLength(3);
    const k = t.Bestell_Eintraege[0]; const w = (r2, s) => r2[k.indexOf(s)];
    expect(zeilen.map(x => [w(x, 'Eintrag_ID'), w(x, 'Art'), w(x, 'Menge'), w(x, 'Groesse'), w(x, 'Status'), w(x, 'Nach_Schluss')])).toEqual([
      ['BE-00001', 'artikel', 3, 'M', 'eingegangen', ''], ['BE-00002', 'extra', 2, '', 'eingegangen', ''], ['BE-00003', 'trikot', 1, 'L', 'eingegangen', '']]);
    expect(w(zeilen[0], 'WC_Variation_ID')).toBe('101');
    expect(w(zeilen[0], 'LShop_ArticleNr')).toBe('1000000001');
    expect(melden).toHaveBeenCalledWith('🛍️ Bestellseite BS-001: 3 neue Positionen für Termin 21.11.');
    const ausgaben = JSON.stringify([...melden.mock.calls, ...log.mock.calls]);
    for (const geheim of ['Testkü', 'TESTNAME', 'Testtribüne', 'Trainer', 'Torwart', token]) expect(ausgaben).not.toContain(geheim);
    // Doppelklick
    expect(await sendeAb({ token, eingabe, sheets, jetzt: JETZT, melden })).toEqual({ ok: true, schon: true, anzahl: 3 });
    expect(t.Bestell_Eintraege).toHaveLength(4);
    expect(melden).toHaveBeenCalledTimes(1);
  });
  test('nur Varianten/Trikots aus dem Sortiment, Grenzen', async () => {
    const { sheets, token } = await mitTermin();
    const ab = (positionen, extra = {}) => sendeAb({ token, eingabe: { termin: 'BT-0001', kuerzel: 'TK', vorgang: VG(Math.random().toString(36).slice(2, 10)), positionen, ...extra }, sheets, jetzt: JETZT, melden: async () => true });
    await expect(ab([{ art: 'artikel', id: '999', menge: 1 }])).rejects.toMatchObject({ status: 422 });
    await expect(ab([{ art: 'trikot', produktId: '902', groesse: 'L' }])).rejects.toMatchObject({ status: 422 });   // nicht im Sortiment
    await expect(ab([{ art: 'trikot', produktId: '901', groesse: 'XXXXL' }])).rejects.toMatchObject({ status: 422 });
    await expect(ab([{ art: 'trikot', produktId: '901', groesse: 'L', nummer: '1234' }])).rejects.toMatchObject({ status: 422 });
    await expect(ab([{ art: 'artikel', id: '101', menge: 0 }])).rejects.toMatchObject({ status: 422 });
    await expect(ab([{ art: 'artikel', id: '101', menge: 1000 }])).rejects.toMatchObject({ status: 422 });
    await expect(ab(Array.from({ length: 61 }, () => ({ art: 'artikel', id: '101', menge: 1 })))).rejects.toMatchObject({ status: 422 });
    await expect(ab([{ art: 'artikel', id: '101', menge: 1 }], { kuerzel: '' })).rejects.toMatchObject({ status: 422 });
    await expect(ab([{ art: 'artikel', id: '101', menge: 1 }], { kuerzel: 'x'.repeat(13) })).rejects.toMatchObject({ status: 422 });
    await expect(ab([{ art: 'extra', freitext: '', menge: 1 }])).rejects.toMatchObject({ status: 422 });
  });
  test('hoechstens 500 offene je Termin', () => {
    const zugang = { Zugang_ID: 'BS-001', Art: 'dauer', Bestellschluss_Tage: 4, Empfohlen_Tage: 7 };
    const termin = { Termin_ID: 'BT-0001', Zugang_ID: 'BS-001', Datum: '2026-11-21' };
    const eintraege = Array.from({ length: MAX.offenJeTermin }, (_, i) => ({ Eintrag_ID: `BE-${i}`, Termin_ID: 'BT-0001', Status: 'eingegangen' }));
    const idx = auswahlIndex({ artikel: [{ key: 'k', name: 'X', groessen: [{ id: '101', groesse: 'M' }] }], trikots: [], art: 'dauer' });
    expect(() => absendenPlan({ zugang, termin, eintraege, idx, eingabe: { kuerzel: 'TK', positionen: [{ art: 'artikel', id: '101', menge: 1 }] }, jetzt: JETZT().toISOString() })).toThrow(/500/);
  });
  test('nach Bestellschluss: erlaubt, Nach_Schluss = ja; vergangener Termin: nur lesen', async () => {
    const { t, sheets, token } = await mitTermin();
    const r = await sendeAb({ token, eingabe: { termin: 'BT-0001', kuerzel: 'TK', vorgang: VG(2), positionen: [{ art: 'artikel', id: '102', menge: 1 }] }, sheets, jetzt: NACH_SCHLUSS, melden: async () => true });
    expect(r.nachSchluss).toBe(true);
    const k = t.Bestell_Eintraege[0];
    expect(t.Bestell_Eintraege[1][k.indexOf('Nach_Schluss')]).toBe('ja');
    await expect(sendeAb({ token, eingabe: { termin: 'BT-0001', kuerzel: 'TK', vorgang: VG(3), positionen: [{ art: 'artikel', id: '102', menge: 1 }] }, sheets, jetzt: () => new Date('2026-11-22T10:00:00Z'), melden: async () => true }))
      .rejects.toMatchObject({ status: 422 });
  });
});

describe('Aendern und Stornieren', () => {
  async function mitEintrag() {
    const t = tabs(); const { sheets, token } = await dauerZugang(t);
    await legeTerminAn({ token, eingabe: { datum: '2026-11-21' }, sheets, jetzt: JETZT });
    await sendeAb({ token, eingabe: { termin: 'BT-0001', kuerzel: 'AnnaT', vorgang: VG(4), positionen: [{ art: 'artikel', id: '101', menge: 2 }] }, sheets, jetzt: JETZT, melden: async () => true });
    const { eintraege } = await leseEintraege({ token, termin: 'BT-0001', sheets, jetzt: JETZT });
    return { t, sheets, token, e: eintraege[0] };
  }
  test('anderes Kürzel aendert Menge und Groesse (gleiche Karte), Vermerk "geändert von"; 409 bei altem Stand', async () => {
    const { sheets, token, e } = await mitEintrag();
    expect(e).toMatchObject({ art: 'artikel', menge: 2, groesse: 'M', kuerzel: 'AnnaT', status: 'eingegangen' });
    expect(JSON.stringify(e)).not.toMatch(/49,95|49\.95|preis/i);
    const r = await aendereEintragSeite({ token, eingabe: { eintrag: e.id, stand: e.stand, kuerzel: 'BenT', menge: 3, id: '102' }, sheets, jetzt: () => new Date('2026-11-08T10:00:00Z') });
    expect(r.eintrag).toMatchObject({ menge: 3, groesse: 'L', kuerzel: 'AnnaT', geaendertVon: 'BenT' });
    await expect(aendereEintragSeite({ token, eingabe: { eintrag: e.id, stand: e.stand, kuerzel: 'BenT', menge: 4 }, sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 409 });
    await expect(aendereEintragSeite({ token, eingabe: { eintrag: e.id, stand: r.eintrag.stand, kuerzel: 'BenT', id: '103' }, sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 422 });   // andere Karte (Red)
  });
  test('stornieren (nie loeschen), danach und bei "übernommen" gesperrt', async () => {
    const { t, sheets, token, e } = await mitEintrag();
    const r = await storniereEintragSeite({ token, eingabe: { eintrag: e.id, stand: e.stand, kuerzel: 'BenT' }, sheets, jetzt: JETZT });
    expect(r.eintrag).toMatchObject({ status: 'storniert', geaendertVon: 'BenT' });
    expect(t.Bestell_Eintraege).toHaveLength(2);
    await expect(storniereEintragSeite({ token, eingabe: { eintrag: e.id, stand: r.eintrag.stand, kuerzel: 'BenT' }, sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 422 });
    const k = t.Bestell_Eintraege[0];
    t.Bestell_Eintraege[1][k.indexOf('Status')] = 'übernommen';
    await expect(aendereEintragSeite({ token, eingabe: { eintrag: e.id, stand: r.eintrag.stand, kuerzel: 'BenT', menge: 1 }, sheets, jetzt: JETZT })).rejects.toThrow(/übernommen/);
  });
  test('gesperrt/abgelaufen -> 403 auch beim Schreiben; MC sieht die Eintraege (nur lesen)', async () => {
    const { sheets, token, e } = await mitEintrag();
    const mc = await leseEintraegeMc({ zugangId: 'BS-001', sheets });
    expect(mc.eintraege.map(x => x.id)).toEqual([e.id]);
    const stand = (await leseZugaenge({ sheets, jetzt: JETZT })).zugaenge[0].Stand;
    await bearbeiteZugang({ eingabe: { zugangId: 'BS-001', stand, aktiv: false }, sheets, jetzt: JETZT });
    await expect(sendeAb({ token, eingabe: { termin: 'BT-0001', kuerzel: 'TK', vorgang: VG(5), positionen: [{ art: 'artikel', id: '101', menge: 1 }] }, sheets, jetzt: JETZT, melden: async () => true })).rejects.toMatchObject({ status: 403 });
    await expect(legeTerminAn({ token, eingabe: { datum: '2026-12-05' }, sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 403 });
  });
});

describe('Katalog: kleine Bilder, Filter, Trikots', () => {
  test('Bild-CDN: kleine und grosse Variante, andere Hosts unveraendert', () => {
    expect(bildGroesse('https://i0.wp.com/x.example/a.jpg?fit=800%2C1029&quality=89&ssl=1', 120)).toBe('https://i0.wp.com/x.example/a.jpg?fit=120%2C120&quality=80&ssl=1');
    expect(bildGroesse('https://shop.example/a.jpg', 120)).toBe('https://shop.example/a.jpg');
    expect(bildGroesse('http://x.example/a.jpg', 120)).toBe('');
  });
  test('Seite: Filter nach Unterkategorie, Trikots nur aus dem Sortiment, Termine mit Zahl der Eintraege', async () => {
    const t = tabs(); const { sheets, token } = await dauerZugang(t);
    const s = await leseSeite({ token, sheets, jetzt: JETZT });
    expect(s.filter).toEqual([{ name: 'Basics', anzahl: 2 }]);
    expect(s.artikel.every(a => a.gruppen.includes('Basics'))).toBe(true);
    expect(s.trikots.map(x => x.produktId)).toEqual(['901']);
    expect(s.trikots[0].bild).toContain('fit=120%2C120');
    expect(s.termineAnlegen).toBe(true);
    expect(sortimentNummern('549', KAT.slice(1).map(([nr, pfad, name]) => ({ nr, pfad, name })))).toEqual(new Set(['549', '554', '561']));
    expect(trikotsDauer({ sortiment: '549', kategorien: [], trikotArtikel: [{ produktId: '901', aktiv: 'FALSE' }], bilder: new Map(), groessen: ['L'] })).toEqual([]);
  });
});

describe('Quelltext und Texte', () => {
  const lies = p => readFileSync(resolve(hier, '..', p), 'utf8');
  test('KS2-Dateien schreiben nur Bestell_Termine/Bestell_Eintraege, nie Korb/Auftrag/Trikots/Partner', () => {
    for (const p of ['lib/bestellEintraege.js', 'utils/bestell-eintraege.js']) {
      const x = lies(p);
      expect(x).not.toMatch(/Warenkorb_LShop|TAB_KORB|TAB_AUFTRAEGE|TAB_POSITIONEN|'Trikots'|Partner_Interne_Bestellungen|FP_Verk|Partner_Verk|FP_Artikel/);
      expect(x).not.toMatch(/values\.append\(/);
    }
    expect(lies('lib/bestellEintraege.js').match(/tab: (\w+)/g)).toEqual(['tab: TAB_TERMINE', 'tab: TAB_EINTRAEGE']);
  });
  test('Log/Chat ohne Kürzel, Namen, Texte; Chat-Text fest', () => {
    for (const p of ['lib/bestellEintraege.js', 'utils/bestell-eintraege.js', 'routes/bestellseite.js']) {
      expect(lies(p)).not.toMatch(/console\.\w+\([^)]*(kuerzel|Kuerzel|name|Trikot_Name|freitext|Freitext|wunsch|token)/);
    }
    expect(absendenNachricht({ zugangId: 'BS-001', anzahl: 1, datum: '2026-11-21' })).toBe('🛍️ Bestellseite BS-001: 1 neue Position für Termin 21.11.');
    expect(() => kuerzelAus('Ab<script>')).toThrow(/Kürzel/);
  });
  test('Seite: Raster -> Korb, Eintrag-Liste mit "nach Bestellschluss", Knoepfe bis "übernommen", Kürzel nur sessionStorage', () => {
    const seite = readFileSync(resolve(hier, '../../frontend/bestellen.html'), 'utf8');
    const block = seite.slice(seite.indexOf('// ── Bestellseite-Anzeige: Anfang'), seite.indexOf('// ── Bestellseite-Anzeige: Ende ──'));
    const F = new Function(`${block}\nreturn { bsPositionenAusRaster, bsEintragHtml, bsArtikelFiltern, bsKorbHtml, bsArtikelZeileHtml };`)();
    const a = { name: 'Hoodie', farbe: 'Black', groessen: [{ id: '101', groesse: 'M' }, { id: '102', groesse: 'L', nochZuBesorgen: true }] };
    expect(F.bsPositionenAusRaster(a, { 101: '2', 102: '0' })).toEqual([{ art: 'artikel', id: '101', menge: 2, text: 'Hoodie · Black · M', besorgen: false }]);
    const e = { id: 'BE-1', art: 'trikot', bezeichnung: 'Heim', groesse: 'L', trikotName: 'TESTNAME', trikotNummer: '7', kuerzel: 'TK', zeit: '2026-11-07T10:00:00Z', nachSchluss: true, status: 'eingegangen', geaendertVon: 'BT' };
    const h = F.bsEintragHtml(e, true);
    expect(h).toContain('nach Bestellschluss – ohne Garantie');
    expect(h).toContain('geändert von BT');
    expect(h).toContain('data-storno="BE-1"');
    expect(F.bsEintragHtml({ ...e, status: 'übernommen' }, true)).not.toContain('data-storno');
    expect(F.bsArtikelFiltern([{ name: 'Hoodie', farbe: 'Black', gruppen: ['Basics'] }, { name: 'Schal', farbe: 'Red', gruppen: [] }], 'Basics', '')).toHaveLength(1);
    expect(F.bsArtikelFiltern([{ name: 'Hoodie', farbe: 'Black', gruppen: [] }], '', 'hoodie black')).toHaveLength(1);
    expect(F.bsKorbHtml([{ menge: 1, text: 'X' }], '', true)).toMatch(/id="bs-absenden" disabled/);
    expect(F.bsArtikelZeileHtml({ name: 'Ohne Bild', groessen: [] }, 0, false, true)).not.toContain('<img');
    expect(F.bsArtikelZeileHtml({ name: 'Mit', bild: 'https://x.example/a.jpg', groessen: [] }, 0, false, true)).toMatch(/width="60" height="60" loading="lazy"/);
    expect(seite).toContain("sp?.setItem('bs_kuerzel', k)");
    expect(seite).not.toMatch(/localStorage\.setItem\(['"]bs_kuerzel/);
  });
  test('MC: Eintraege nur ansehen (kein Pruefen/Uebernehmen), "neu" und "nach Schluss"', () => {
    const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
    const block = html.slice(html.indexOf('// ── Bestellseiten-MC: Anfang'), html.indexOf('// ── Bestellseiten-MC: Ende ──'));
    const kuEsc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const F = new Function('kuEsc', `${block}\nreturn { bsmEintraegeHtml };`)(kuEsc);
    const jetzt = new Date('2026-11-08T10:00:00Z').getTime();
    const h = F.bsmEintraegeHtml([
      { id: 'BE-1', termin: 'BT-0001', art: 'artikel', menge: 2, bezeichnung: 'Hoodie', groesse: 'M', kuerzel: 'TK', zeit: '2026-11-08T08:00:00Z', nachSchluss: true, status: 'eingegangen' },
      { id: 'BE-2', termin: 'BT-0002', art: 'extra', menge: 1, freitext: 'Fahne <b>', kuerzel: 'TK', zeit: '2026-11-01T08:00:00Z', status: 'storniert' }],
    [{ Termin_ID: 'BT-0001', Datum: '2026-11-21' }, { Termin_ID: 'BT-0002', Datum: '2026-12-05' }], 'BT-0001', jetzt);
    expect(h).toContain('2 × Hoodie · M');
    expect(h).toContain('data-hilfe="bsm-neu"');
    expect(h).toContain('data-hilfe="bsm-spaet"');
    expect(h).not.toContain('Fahne');
    expect(F.bsmEintraegeHtml([{ id: 'BE-2', termin: 'BT-0002', art: 'extra', menge: 1, freitext: 'Fahne <b>', kuerzel: 'TK', zeit: '2026-11-01T08:00:00Z', status: 'storniert' }], [], '', jetzt)).toContain('Fahne &lt;b&gt;');
    expect(block).not.toMatch(/data-bsm-(uebernehmen|pruefen)|>\s*(Übernehmen|Prüfen)\s*</i);   // Knoepfe kommen erst mit KS3
  });
});
