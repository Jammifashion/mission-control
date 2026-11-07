// KS2-2: "Artikelliste aktualisieren" in Stuecken (kein Browser-Abbruch), Artikel ohne Termin ansehen, Legende oben.
// Nur erfundene Werte.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import { legeZugangAn, leseSeite, bilderPlan, bilderStueck, bilderSchreiben, bilderZeilenPruefen, STUECK_MAX, _bestellseiteCacheLeeren } from '../lib/bestellseite.js';
import { ZUGANG_SPALTEN, ZUGANG_OPTIONAL, TERMIN_SPALTEN, EINTRAG_SPALTEN, BILD_SPALTEN, BILD_OPTIONAL } from '../utils/bestellseite.js';
import { EINTRAG_OPTIONAL } from '../utils/bestell-eintraege.js';

const hier = dirname(fileURLToPath(import.meta.url));
process.env.GOOGLE_SHEET_ID = 'test-sheet';
process.env.BUSINESS_SHEET_ID = 'test-business';
const JETZT = () => new Date('2026-11-07T10:00:00Z');
const kunden = async () => ({ kunden: [{ Kunden_Nr: 'K-00063', Status: 'aktiv' }] });
let z = 200; const zufall = () => Buffer.alloc(32, ++z);
const ALT = 'https://i0.wp.com/shop.example/alt.jpg?fit=800%2C800';
const NEU = 'https://i0.wp.com/shop.example/neu.jpg?fit=800%2C800';

function tabs(nProdukte = 8) {
  const maske = [['ID', 'Status Shop', 'Produkt-ID', 'Produktname', 'Kategorien']];
  const var_ = [['SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'Preis', 'Aktiv', 'WC_Variation_ID', 'Google_Farbe', 'LShop_ArticleNr']];
  for (let i = 1; i <= nProdukte; i++) {
    maske.push([`A${i}`, 'Veröffentlicht', String(100 + i), `Testartikel ${i}`, 'Club, Basics']);
    var_.push([`A${i}`, '1', 'Farbe', 'Black', 'Größe', 'M', '', '', '', 'TRUE', String(1000 + i), '', '']);
  }
  return {
    Bestellseiten: [[...ZUGANG_SPALTEN, ...ZUGANG_OPTIONAL]],
    Bestell_Termine: [TERMIN_SPALTEN],
    Bestell_Eintraege: [[...EINTRAG_SPALTEN, ...EINTRAG_OPTIONAL]],
    Bestell_Bilder: [[...BILD_SPALTEN, ...BILD_OPTIONAL], ['101', 'produkt', ALT, 'publish', 'stand-alt', '549']],
    Struktur_Kategorien: [['Kategorienummer', 'Kategorien', 'Kategoriename'], ['549', 'Club', 'Club'], ['554', 'Club > Basics', 'Basics'], ['561', 'Club > Trikots', 'Trikots']],
    Erfassungsmaske: maske, Varianten: var_,
    Trikot_Artikel: [['Produkt-ID', 'Produktname', 'Aktiv'], ['901', 'Heimtrikot Test', 'TRUE']],
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage']],
  };
}
const wcMock = () => ({ get: jest.fn(async (pfad, q) => {
  if (pfad === 'products') return { data: q.include.split(',').map(id => ({ id: Number(id), status: 'publish', images: [{ src: id === '101' ? NEU : ALT }], categories: [{ id: id === '901' ? 561 : 554 }] })) };
  const id = pfad.split('/')[1];
  return { data: [{ id: 1000 + (Number(id) - 100), image: { src: NEU } }] };
}) });

beforeEach(() => { _bestellseiteCacheLeeren(); jest.spyOn(console, 'warn').mockImplementation(() => {}); jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe('Lauf in Stuecken', () => {
  test('Plan liest nur das Sheet: Stuecke zu hoechstens 6, Trikots ohne Variationen, Stand vorher', async () => {
    const t = tabs(8); const { sheets } = machSheets(t);
    await legeZugangAn({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', vorgang: 'vorgang-ks22-a' }, sheets, jetzt: JETZT, kundenLesen: kunden, zufall });
    const p = await bilderPlan({ sheets, jetzt: JETZT });
    expect(p).toMatchObject({ produkte: 8, trikots: 1, vorherStand: 'stand-alt' });
    expect(p.stuecke.map(s => [s.ids.length, s.ohneVariationen.length])).toEqual([[6, 0], [2, 1]]);
    expect(Math.max(...p.stuecke.map(s => s.ids.length + s.ohneVariationen.length))).toBeLessThanOrEqual(STUECK_MAX);
  });
  test('Stueck: schreibt nichts, holt Produkte + Variationen, nie mehr als 6', async () => {
    const wc = wcMock();
    const r = await bilderStueck({ ids: ['101', '102'], ohneVariationen: ['901'], wc, takt: 0 });
    expect(r.zeilen.map(x => [x[0], x[1]])).toEqual([['101', 'produkt'], ['102', 'produkt'], ['901', 'produkt'], ['1001', 'variante'], ['1002', 'variante']]);
    expect(r.abrufe).toBe(3);
    expect(wc.get.mock.calls.every(([, q]) => q._fields)).toBe(true);
    await expect(bilderStueck({ ids: ['1', '2', '3', '4', '5', '6', '7'], wc, takt: 0 })).rejects.toMatchObject({ status: 422 });
  });
  test('ganzer Ablauf: Rueckmeldung, Katalog danach sofort neu (Bilder, Trikots, Filter)', async () => {
    const t = tabs(3); const { sheets } = machSheets(t);
    const { token } = await legeZugangAn({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', vorgang: 'vorgang-ks22-b' }, sheets, jetzt: JETZT, kundenLesen: kunden, zufall });
    const vorher = await leseSeite({ token, sheets, jetzt: JETZT });
    expect(vorher.trikots).toEqual([]);
    const p = await bilderPlan({ sheets, jetzt: () => new Date('2026-11-07T11:00:00Z') });
    const wc = wcMock(); const zeilen = [];
    for (const st of p.stuecke) zeilen.push(...(await bilderStueck({ ...st, wc, takt: 0 })).zeilen);
    const r = await bilderSchreiben({ zeilen, vorherStand: p.vorherStand, stand: p.stand, produkte: p.produkte, trikots: p.trikots, sheets });
    expect(r).toMatchObject({ ok: true, bilderNeu: 7, bilderUnveraendert: 0, ohneBild: 0, produkte: 3, trikots: 1 });   // 101 neu, 102/103/901 neu (vorher fehlend), 3 Variationen
    const nachher = await leseSeite({ token, sheets, jetzt: JETZT });
    expect(nachher.trikots.map(x => x.produktId)).toEqual(['901']);
    expect(nachher.artikel.find(a => a.key.startsWith('101|')).bild).toContain('neu.jpg');
    expect(nachher.filter).toEqual([{ name: 'Basics', anzahl: 3 }]);
  });
  test('anderer Lauf dazwischen -> 409, nichts geschrieben; Sperre nach Fehler wieder frei', async () => {
    const t = tabs(1); const { sheets } = machSheets(t);
    await legeZugangAn({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', vorgang: 'vorgang-ks22-c' }, sheets, jetzt: JETZT, kundenLesen: kunden, zufall });
    const vorher = JSON.stringify(t.Bestell_Bilder);
    await expect(bilderSchreiben({ zeilen: [['101', 'produkt', NEU, 'publish', '549']], vorherStand: 'anderer-stand', sheets })).rejects.toMatchObject({ status: 409 });
    expect(JSON.stringify(t.Bestell_Bilder)).toBe(vorher);
    // Sperre frei: der naechste Schreibvorgang laeuft (nicht "gerade gespeichert")
    const r = await bilderSchreiben({ zeilen: [['101', 'produkt', NEU, 'publish', '549']], vorherStand: 'stand-alt', sheets });
    expect(r.ok).toBe(true);
  });
  test('Zeilen aus MC werden geprueft (nur https, Zahlen-IDs, keine Doppel)', () => {
    expect(() => bilderZeilenPruefen([['abc', 'produkt', NEU, 'publish', '']])).toThrow(/ungültig/);
    expect(() => bilderZeilenPruefen([['1', 'produkt', 'javascript:x', '', '']])).toThrow(/ungültig/);
    expect(() => bilderZeilenPruefen([['1', 'produkt', NEU, '', ''], ['1', 'variante', NEU, '', '']])).toThrow(/doppelt/);
    expect(bilderZeilenPruefen([['1', 'variante', '', '', '']])).toEqual([['1', 'variante', '', '', '']]);
  });
});

describe('MC-Knopf', () => {
  const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
  test('Ablauf Plan -> Stuecke -> Schreiben, zweiter Klick "läuft schon", Fortschritt', () => {
    const h = html.slice(html.indexOf("bsmEl('bsm-bilder').addEventListener"), html.indexOf("auEl('au-bestellseite').addEventListener"));
    expect(h).toMatch(/bsmApi\('\/bilder\/plan'[\s\S]*bsmApi\('\/bilder\/stueck'[\s\S]*bsmApi\('\/bilder\/schreiben'/);
    expect(h).toContain('if (bsmZ.bilderLauf) { showToast(bsmBilderLaeuft(bsmZ.bilderLauf)); return; }');
    expect(h).toContain('finally { bsmZ.bilderLauf = null;');
    expect(h).not.toContain("bsmApi('/bilder', ");
    const block = html.slice(html.indexOf('// ── Bestellseiten-MC: Anfang'), html.indexOf('// ── Bestellseiten-MC: Ende ──'));
    const F = new Function('kuEsc', `${block}\nreturn { bsmBilderFortschritt, bsmBilderLaeuft };`)(x => String(x));
    expect(F.bsmBilderFortschritt({ stueck: 3, von: 11 })).toBe('läuft: Stück 3 von 11 …');
    expect(F.bsmBilderLaeuft({ seit: new Date('2026-11-07T15:00:00Z').getTime(), stueck: 3, von: 11 })).toMatch(/^Artikelliste wird schon aktualisiert \(seit \d{2}:\d{2}, Stück 3 von 11\) – bitte warten\.$/);
  });
});

describe('Seite: Artikel ohne Termin, Legende oben', () => {
  const seite = readFileSync(resolve(hier, '../../frontend/bestellen.html'), 'utf8');
  const block = seite.slice(seite.indexOf('// ── Bestellseite-Anzeige: Anfang'), seite.indexOf('// ── Bestellseite-Anzeige: Ende ──'));
  const F = new Function(`${block}\nreturn { bsNurAnsehenText, bsLegendeHtml, bsArtikelZeileHtml };`)();
  test('Hinweis ohne Termin / vorbei; Raster gesperrt ohne Termin', () => {
    expect(F.bsNurAnsehenText({ termineAnlegen: true }, null)).toBe('Erst Termin wählen oder „+ Termin“ anlegen – dann kannst du eintragen. Die Artikel kannst du schon ansehen.');
    expect(F.bsNurAnsehenText({ termineAnlegen: false }, null)).toMatch(/^Erst Termin wählen – dann/);
    expect(F.bsNurAnsehenText({}, { vergangen: true })).toMatch(/vorbei/);
    const a = { name: 'X', groessen: [{ id: '1', groesse: 'M' }] };
    expect(F.bsArtikelZeileHtml(a, 0, true, false)).not.toContain('data-raster');
    expect(F.bsArtikelZeileHtml(a, 0, true, true)).toContain('data-raster');
  });
  test('Artikelliste wird auch ohne Termin gezeigt; Legende genau einmal, ueber der Liste', () => {
    const zeichnen = seite.slice(seite.indexOf('    function zeichnen() {'), seite.indexOf('    async function eintraegeLaden()'));
    expect(zeichnen).toContain("${!schreibbar() || BS.tab === 'artikel' ? `${bsFilterHtml(");
    expect(zeichnen.indexOf('${bsLegendeHtml()}')).toBeLessThan(zeichnen.indexOf('<div class="bs-liste">${artikel.map'));
    expect(zeichnen.match(/bsLegendeHtml\(\)/g)).toHaveLength(1);
    expect(F.bsLegendeHtml()).toContain('lieferbar');
    expect(F.bsLegendeHtml()).toContain('noch zu besorgen</span> = besorgen wir gesondert');
    expect(seite).toContain("if (b.dataset.artikel !== undefined && !schreibbar()) { meldung(bsNurAnsehenText(BS.d, terminAkt())); return; }");
  });
});
