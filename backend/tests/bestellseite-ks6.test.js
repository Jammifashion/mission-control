// KS6: Bestellseite fuer einen normalen Auftrag (Art auftrag) praxistauglich - Auswahl ohne Mengen, festes "bestellen bis", Wortlaut je
// Art, Name/Nummer auf dem Textil, "Bestellung abschließen". Fanshop (Art dauer) unveraendert. Nur erfundene Werte.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import { legeZugangAn, bearbeiteZugang, leseSeite, leseZugaenge, schliesseAb, _bestellseiteCacheLeeren } from '../lib/bestellseite.js';
import { sendeAb, aendereEintragSeite, leseEintraegeMc } from '../lib/bestellEintraege.js';
import { pruefeEintraege, uebernehmen } from '../lib/bestellUebernahme.js';
import {
  ZUGANG_SPALTEN, ZUGANG_OPTIONAL, ZUGANG_KS6, TERMIN_SPALTEN, EINTRAG_SPALTEN, BILD_SPALTEN, BILD_OPTIONAL, auswahlAus, auswahlLesen,
  terminFristen, bestellschlussVorschlag, seitenAntwort, abschlussNachricht,
} from '../utils/bestellseite.js';
import { EINTRAG_OPTIONAL } from '../utils/bestell-eintraege.js';
import { AUFTRAG_SPALTEN, AUFTRAG_OPTIONAL, POSITION_SPALTEN, POSITION_OPTIONAL } from '../utils/auftraege.js';
import { _auftraegeCacheLeeren } from '../lib/auftraege.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { _lieferbarkeitCacheLeeren } from '../lib/lieferbarkeitLesen.js';

const hier = dirname(fileURLToPath(import.meta.url));
process.env.GOOGLE_SHEET_ID = 'test-sheet';
process.env.BUSINESS_SHEET_ID = 'test-business';
const JETZT = () => new Date('2026-11-08T10:00:00Z');
const SPAETER = () => new Date('2026-11-08T11:00:00Z');
const kunden = async () => ({ kunden: [{ Kunden_Nr: 'K-00001', Status: 'aktiv' }] });
let zz = 600; const zufall = () => Buffer.alloc(32, ++zz);
const V = n => `vorgang-ks6-${String(n).padStart(4, '0')}`;
const zeile = (spalten, o) => spalten.map(s => o[s] ?? '');
const NR = { BM: '2000000001', BL: '2000000002', WM: '2000000003', HM: '2000000011', AUS: '2000000009' };
const KUERZEL = 'Testi', TEXTIL = 'ERFUNDENA';

function tabs({ ohneKs6 = false } = {}) {
  const LS = (nr, cat, farbe, size, disc = '0') => [nr, cat, farbe, '', size, '', '', 'Erfunden', '', disc, 'aktiv', 'Muster-Lieferantenname'];
  const zOpt = ohneKs6 ? ZUGANG_OPTIONAL.filter(x => !ZUGANG_KS6.includes(x)) : ZUGANG_OPTIONAL;
  return {
    Bestellseiten: [[...ZUGANG_SPALTEN, ...zOpt]],
    Bestell_Termine: [TERMIN_SPALTEN],
    Bestell_Eintraege: [[...EINTRAG_SPALTEN, ...EINTRAG_OPTIONAL]],
    Bestell_Bilder: [[...BILD_SPALTEN, ...BILD_OPTIONAL]],
    Auftraege: [[...AUFTRAG_SPALTEN, ...AUFTRAG_OPTIONAL], zeile([...AUFTRAG_SPALTEN, ...AUFTRAG_OPTIONAL],
      { Auftrag_Nr: 'AU-2026-0099', Kunden_Nr: 'K-00001', Kurztitel: 'Testverein Saison', Status: 'Angebot', Termin: '2026-12-04', Stand: 's1' })],
    // Eine alte "Angebots"-Position (frueher noetig, damit die Seite Artikel zeigt) - darf nach KS6 nicht mehr als Katalog dienen
    Auftrag_Positionen: [[...POSITION_SPALTEN, ...POSITION_OPTIONAL], zeile([...POSITION_SPALTEN, ...POSITION_OPTIONAL],
      { Position_ID: 'AU-2026-0099-01', Auftrag_Nr: 'AU-2026-0099', Art: 'lshop', LShop_ArticleNr: NR.HM, Menge: '1', Stand: 's1' })],
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Brand', 'CatNrManufacturer', 'Discontinued', 'Status', 'Description'],
      LS(NR.BM, 'X100', 'Black', 'M'), LS(NR.BL, 'X100', 'Black', 'L'), LS(NR.WM, 'X100', 'White', 'M'), LS(NR.AUS, 'X100', 'Red', 'M', '3'),
      LS(NR.HM, 'H200', 'Navy', 'M')],
  };
}

let t, s, token;
const melden = jest.fn(async () => {});
async function aufbau(o = {}) {
  t = tabs(o);
  s = machSheets(t);
}
async function anlegen(eingabe = {}) {
  const r = await legeZugangAn({ eingabe: { art: 'auftrag', auftragNr: 'AU-2026-0099', vorgang: V(1), ...eingabe }, sheets: s.sheets, jetzt: JETZT, kundenLesen: kunden, zufall, schluesselLaden: async () => null });
  token = r.token;
  return r;
}
const zugang = () => { const k = t.Bestellseiten[0]; const z = t.Bestellseiten[1]; return Object.fromEntries(k.map((x, i) => [x, z[i] ?? ''])); };
const AUSWAHL = [{ modell: 'X100', farben: ['Black'], name: 'T-Shirt', motiv: 'Logo vorn' }];
const auswahlSetzen = (auswahl = AUSWAHL) => bearbeiteZugang({ eingabe: { zugangId: 'BS-001', stand: zugang().Stand, auswahl }, sheets: s.sheets, jetzt: SPAETER });

beforeEach(async () => {
  _bestellseiteCacheLeeren(); _auftraegeCacheLeeren(); _resetLShopCache?.(); _lieferbarkeitCacheLeeren?.();
  melden.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await aufbau();
});
afterEach(() => jest.restoreAllMocks());

describe('Logik', () => {
  test('Auswahl pruefen: Modell da, Farben waehlbar, Bezeichnung Pflicht; JSON ohne Mengen', () => {
    const farben = new Map([['X100', new Set(['Black', 'White'])]]);
    expect(JSON.parse(auswahlAus([{ modell: 'X100', farben: ['Black', 'Black', 'White'], name: ' T-Shirt ' }], farben))).toEqual([{ modell: 'X100', farben: ['Black', 'White'], name: 'T-Shirt' }]);
    expect(() => auswahlAus([{ modell: 'Y1', farben: ['Black'], name: 'X' }], farben)).toThrow(/gibt es nicht/);
    expect(() => auswahlAus([{ modell: 'X100', farben: ['Red'], name: 'X' }], farben)).toThrow(/Red ist für dieses Modell nicht/);
    expect(() => auswahlAus([{ modell: 'X100', farben: ['Black'], name: '' }], farben)).toThrow(/Bezeichnung/);
    expect(() => auswahlAus([{ modell: 'X100', farben: [], name: 'X' }], farben)).toThrow(/mindestens eine Farbe/);
    expect(auswahlAus([], farben)).toBe('');
    expect(auswahlLesen({ Auswahl: 'kaputt{' })).toEqual([]);
  });
  test('bestellen bis: Art auftrag festes Datum (ohne "am besten bis"); Fanshop (dauer) unveraendert Termin - Tage', () => {
    expect(terminFristen({ Datum: '2026-12-04' }, { Art: 'auftrag', Bestellschluss_Datum: '2026-11-20' })).toEqual({ bestellschluss: '2026-11-20', empfohlen: '' });
    expect(terminFristen({ Datum: '' }, { Art: 'auftrag', Bestellschluss_Datum: '2026-11-20' }).bestellschluss).toBe('2026-11-20');   // auch ohne Termin
    expect(terminFristen({ Datum: '2026-12-04' }, { Art: 'dauer', Bestellschluss_Datum: '2026-11-20' })).toEqual({ bestellschluss: '2026-11-30', empfohlen: '2026-11-27' });
    expect(bestellschlussVorschlag('2026-12-04', '2026-11-08T10:00:00Z')).toBe('2026-11-27');
    expect(bestellschlussVorschlag('2026-11-10', '2026-11-08T10:00:00Z')).toBe('2026-11-08');   // nie vor heute
    expect(bestellschlussVorschlag('', '2026-11-08T10:00:00Z')).toBe('');
  });
  test('Seitenantwort: Fanshop ohne die neuen Felder, Art auftrag mit Titel/bestellen bis/Schaltern', () => {
    const jetzt = '2026-11-08T10:00:00Z';
    const dauer = seitenAntwort({ zugang: { Art: 'dauer', Titel: 'X', Bestellschluss_Datum: '2026-11-20', Personalisierung: 'ja', Abschliessen: 'ja' }, termine: [{ Termin_ID: 'BT-0001', Datum: '2026-11-22' }], artikel: [], jetzt });
    for (const k of ['titel', 'bestellenBis', 'personalisierung', 'abschliessen', 'abgeschlossen']) expect(dauer).not.toHaveProperty(k);
    expect(dauer.termine[0]).toMatchObject({ bestellschluss: '2026-11-18', empfohlen: '2026-11-15' });
    const a = seitenAntwort({ zugang: { Art: 'auftrag', Titel: 'Testverein', Bestellschluss_Datum: '2026-11-20', Personalisierung: 'ja', Abschliessen: '' }, termine: [{ Termin_ID: 'BT-0001', Datum: '2026-12-04' }], artikel: [], jetzt });
    expect(a).toMatchObject({ titel: 'Testverein', bestellenBis: '2026-11-20', personalisierung: true, abschliessen: false, abgeschlossen: '', termineAnlegen: false });
    expect(a.termine[0]).toMatchObject({ bestellschluss: '2026-11-20', empfohlen: '' });
    expect(abschlussNachricht({ zugangId: 'BS-001', anzahl: 4 })).toBe('✅ Bestellseite BS-001 abgeschlossen (4 Einträge) – bitte prüfen und übernehmen.');
  });
});

describe('Anlegen, Auswahl, Seite', () => {
  test('Anlegen: Titel = Kurztitel, bestellen bis = Termin - 7, Schalter; Termin-Zeile mit demselben Datum', async () => {
    await anlegen({ personalisierung: true, abschliessen: true });
    expect(zugang()).toMatchObject({ Titel: 'Testverein Saison', Bestellschluss_Datum: '2026-11-27', Personalisierung: 'ja', Abschliessen: 'ja', Auswahl: '' });
    expect(t.Bestell_Termine[1][TERMIN_SPALTEN.indexOf('Bestellschluss')]).toBe('2026-11-27');
    await expect(bearbeiteZugang({ eingabe: { zugangId: 'BS-001', stand: zugang().Stand, bestellschluss: '2026-11-01' }, sheets: s.sheets, jetzt: SPAETER })).rejects.toMatchObject({ status: 422 });
  });

  test('ohne Auswahl: Uebergang ueber die Positionen; mit Auswahl NUR die Auswahl (alle waehlbaren Groessen, ohne Mengen, ohne Lieferant)', async () => {
    await anlegen();
    let seite = await leseSeite({ token, sheets: s.sheets, jetzt: JETZT });
    expect(seite.artikel.map(a => a.farbe)).toEqual(['Navy']);   // aus der alten Position
    await auswahlSetzen([...AUSWAHL, { modell: 'X100', farben: ['White'], name: 'Hoodie Kinder' }]);
    expect(JSON.parse(zugang().Auswahl)).toEqual([{ modell: 'X100', farben: ['Black'], name: 'T-Shirt', motiv: 'Logo vorn' }, { modell: 'X100', farben: ['White'], name: 'Hoodie Kinder' }]);
    seite = await leseSeite({ token, sheets: s.sheets, jetzt: JETZT });
    expect(seite.artikel.map(a => [a.name, a.farbe, a.motiv ?? '', a.groessen.map(g => g.groesse)])).toEqual([
      ['T-Shirt', 'Black', 'Logo vorn', ['M', 'L']], ['Hoodie Kinder', 'White', '', ['M']]]);
    const text = JSON.stringify(seite);
    for (const x of ['X100', 'H200', 'Navy', 'Muster-Lieferantenname', 'Erfunden', 'AU-2026-0099', 'K-00001', 'menge']) expect(text).not.toContain(x);
    expect(seite).toMatchObject({ titel: 'Testverein Saison', bestellenBis: '2026-11-27' });
    // gesperrte Farbe (Discontinued 3) ist nicht waehlbar -> 422, nichts geschrieben
    const vorher = zugang().Auswahl;
    await expect(auswahlSetzen([{ modell: 'X100', farben: ['Red'], name: 'X' }])).rejects.toMatchObject({ status: 422 });
    expect(zugang().Auswahl).toBe(vorher);
    // MC-Liste liefert die Auswahl gelesen
    const mc = await leseZugaenge({ sheets: s.sheets, jetzt: JETZT, schluesselLaden: async () => null });
    expect(mc.zugaenge[0].auswahl).toHaveLength(2);
  });

  test('Fanshop-Felder: Auswahl/Titel/Schalter nur bei Art auftrag', async () => {
    t.Struktur_Kategorien = [['Kategorienummer', 'Kategorien', 'Kategoriename'], ['549', 'Club', 'Club']];
    t.Erfassungsmaske = [['ID', 'Status Shop', 'Produkt-ID', 'Produktname', 'Kategorien']];
    t.Varianten = [['SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'Preis', 'Aktiv', 'WC_Variation_ID', 'Google_Farbe', 'LShop_ArticleNr']];
    await legeZugangAn({ eingabe: { art: 'dauer', kundenNr: 'K-00001', sortiment: '549', vorgang: V(9) }, sheets: s.sheets, jetzt: JETZT, kundenLesen: kunden, zufall, schluesselLaden: async () => null });
    expect(zugang()).toMatchObject({ Titel: '', Bestellschluss_Datum: '', Personalisierung: '', Abschliessen: '' });
    for (const e of [{ auswahl: AUSWAHL }, { titel: 'X' }, { personalisierung: true }, { abschliessen: true }]) {
      await expect(bearbeiteZugang({ eingabe: { zugangId: 'BS-001', stand: zugang().Stand, ...e }, sheets: s.sheets, jetzt: SPAETER })).rejects.toMatchObject({ status: 422 });
    }
  });

  test('fehlen die KS6-Spalten: 409 einrichtung, nichts geschrieben', async () => {
    await aufbau({ ohneKs6: true });
    await expect(anlegen()).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    expect(t.Bestellseiten.length).toBe(1);
  });
});

describe('Eintragen, Personalisierung, Uebernehmen', () => {
  const abs = (positionen, n = 2) => sendeAb({ token, eingabe: { termin: 'BT-0001', kuerzel: KUERZEL, vorgang: V(n), positionen }, sheets: s.sheets, jetzt: JETZT, melden });

  test('Name/Nummer auf dem Textil: nur wenn eingeschaltet, mit Name je Stueck; nie im Auftrag, nie im Log', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await anlegen();
    await auswahlSetzen();
    await expect(abs([{ art: 'artikel', id: NR.BM, menge: 1, name: TEXTIL }])).rejects.toMatchObject({ status: 422 });   // aus
    await bearbeiteZugang({ eingabe: { zugangId: 'BS-001', stand: zugang().Stand, personalisierung: true }, sheets: s.sheets, jetzt: SPAETER });
    await expect(abs([{ art: 'artikel', id: NR.BM, menge: 2, name: TEXTIL }], 3)).rejects.toThrow(/je Stück einzeln/);
    await expect(abs([{ art: 'artikel', id: NR.BM, menge: 1, nummer: '1234' }], 4)).rejects.toMatchObject({ status: 422 });
    await abs([{ art: 'artikel', id: NR.BM, menge: 1, name: TEXTIL, nummer: '7' }, { art: 'artikel', id: NR.BL, menge: 2 }], 5);
    let mc = (await leseEintraegeMc({ zugangId: 'BS-001', sheets: s.sheets })).eintraege;
    expect(mc.map(e => [e.groesse, e.menge, e.trikotName, e.trikotNummer])).toEqual([['M', 1, TEXTIL, '7'], ['L', 2, '', '']]);
    // Seite: Name aendern geht; Menge 2 mit Name nicht
    await expect(aendereEintragSeite({ token, eingabe: { eintrag: mc[0].id, stand: mc[0].stand, kuerzel: KUERZEL, menge: 2 }, sheets: s.sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 422 });
    await aendereEintragSeite({ token, eingabe: { eintrag: mc[0].id, stand: mc[0].stand, kuerzel: KUERZEL, name: 'ERFUNDENB' }, sheets: s.sheets, jetzt: JETZT });
    mc = (await leseEintraegeMc({ zugangId: 'BS-001', sheets: s.sheets })).eintraege;
    expect(mc[0].trikotName).toBe('ERFUNDENB');
    // Uebernehmen in DENSELBEN Auftrag: Positionen nur aus den Eintraegen, gleiche Groesse zusammen; alte Position bleibt + Hinweis
    await pruefeEintraege({ eingabe: { zugangId: 'BS-001', aktion: 'geprueft', auswahl: mc.map(e => ({ id: e.id, stand: e.stand })) }, sheets: s.sheets, jetzt: SPAETER });
    mc = (await leseEintraegeMc({ zugangId: 'BS-001', sheets: s.sheets })).eintraege;
    const r = await uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: 'BT-0001', auswahl: mc.map(e => ({ id: e.id, stand: e.stand })), vorgang: V(20) }, sheets: s.sheets, jetzt: SPAETER });
    expect(r).toMatchObject({ auftragNr: 'AU-2026-0099', neu: false, positionen: 2, lshop: 2 });
    expect(r.hinweise.join(' ')).toContain('AU-2026-0099 hat schon 1 Position, die nicht von der Bestellseite stammen');
    const pk = n => t.Auftrag_Positionen[0].indexOf(n);
    expect(t.Auftrag_Positionen.slice(1).map(p => [p[pk('Position_ID')], p[pk('LShop_ArticleNr')], String(p[pk('Menge')])])).toEqual([
      ['AU-2026-0099-01', NR.HM, '1'], ['AU-2026-0099-02', NR.BM, '1'], ['AU-2026-0099-03', NR.BL, '2']]);
    expect(t.Auftraege.length).toBe(2);   // kein zweiter Auftrag
    const auftragText = JSON.stringify([t.Auftraege, t.Auftrag_Positionen]);
    for (const x of [TEXTIL, 'ERFUNDENB', KUERZEL]) expect(auftragText).not.toContain(x);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/ERFUNDEN|Testi/);
  });

  test('ohne alte Positionen: kein Doppel-Hinweis', async () => {
    t.Auftrag_Positionen = [t.Auftrag_Positionen[0]];
    await anlegen();
    await auswahlSetzen();
    await abs([{ art: 'artikel', id: NR.BM, menge: 3 }]);
    let mc = (await leseEintraegeMc({ zugangId: 'BS-001', sheets: s.sheets })).eintraege;
    await pruefeEintraege({ eingabe: { zugangId: 'BS-001', aktion: 'geprueft', auswahl: mc.map(e => ({ id: e.id, stand: e.stand })) }, sheets: s.sheets, jetzt: SPAETER });
    mc = (await leseEintraegeMc({ zugangId: 'BS-001', sheets: s.sheets })).eintraege;
    const r = await uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: 'BT-0001', auswahl: mc.map(e => ({ id: e.id, stand: e.stand })), vorgang: V(21), dryRun: true }, sheets: s.sheets, jetzt: SPAETER });
    expect(r).toMatchObject({ auftragNr: 'AU-2026-0099', positionen: 1 });
    expect(r.hinweise).toEqual([]);
  });

  test('"Bestellung abschließen": nur wenn erlaubt; danach nur lesen; Chat ohne Namen; MC "wieder öffnen"', async () => {
    await anlegen();
    await auswahlSetzen();
    await expect(schliesseAb({ token, sheets: s.sheets, jetzt: JETZT, melden })).rejects.toMatchObject({ status: 422 });
    await bearbeiteZugang({ eingabe: { zugangId: 'BS-001', stand: zugang().Stand, abschliessen: true }, sheets: s.sheets, jetzt: SPAETER });
    await abs([{ art: 'artikel', id: NR.BM, menge: 1 }]);
    melden.mockClear();
    const r = await schliesseAb({ token, sheets: s.sheets, jetzt: SPAETER, melden });
    expect(r).toMatchObject({ ok: true, schon: false });
    expect(melden.mock.calls.map(c => c[0])).toEqual(['✅ Bestellseite BS-001 abgeschlossen (1 Eintrag) – bitte prüfen und übernehmen.']);
    expect((await schliesseAb({ token, sheets: s.sheets, jetzt: SPAETER, melden })).schon).toBe(true);
    expect(melden).toHaveBeenCalledTimes(1);
    const seite = await leseSeite({ token, sheets: s.sheets, jetzt: SPAETER });
    expect(seite.abgeschlossen).toMatch(/^2026-11-08T11/);
    await expect(abs([{ art: 'artikel', id: NR.BL, menge: 1 }], 7)).rejects.toMatchObject({ status: 409, code: 'abgeschlossen' });
    const e = (await leseEintraegeMc({ zugangId: 'BS-001', sheets: s.sheets })).eintraege[0];
    await expect(aendereEintragSeite({ token, eingabe: { eintrag: e.id, stand: e.stand, kuerzel: KUERZEL, menge: 2 }, sheets: s.sheets, jetzt: SPAETER })).rejects.toMatchObject({ code: 'abgeschlossen' });
    await bearbeiteZugang({ eingabe: { zugangId: 'BS-001', stand: zugang().Stand, wiederOeffnen: true }, sheets: s.sheets, jetzt: SPAETER });
    await abs([{ art: 'artikel', id: NR.BL, menge: 1 }], 8);
  });
});

describe('Oberflaeche', () => {
  const seite = readFileSync(resolve(hier, '../../frontend/bestellen.html'), 'utf8');
  const mc = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
  const ab = (txt, von, bis) => txt.slice(txt.indexOf(von), txt.indexOf(bis));
  const block = ab(seite, '// ── Bestellseite-Anzeige: Anfang', '// ── Bestellseite-Anzeige: Ende ──');
  const F = new Function(`${block}\nreturn { bsTexte, bsKopfAuftragHtml, bsBannerHtml, bsAbschlussHtml, bsTextilFehler, bsPositionenAusRaster, bsEintragWas, bsArtikelZeileHtml };`)();

  test('Wortlaut je Art: Fanshop unveraendert, Auftrag ohne Termin-/Spieltag-Vokabular', () => {
    expect(F.bsTexte({ art: 'dauer' })).toEqual({ kuerzel: 'Dein Kürzel oder Vorname', kuerzelFehlt: 'Bitte oben dein Kürzel eintragen.', eingetragen: 'Eingetragen für diesen Termin' });
    const a = F.bsTexte({ art: 'auftrag' });
    expect(a.kuerzel).toBe('Dein Name oder Kürzel (Vorname reicht)');
    expect(a.eingetragen).toBe('Bisher eingetragen');
    const kopf = F.bsKopfAuftragHtml({ art: 'auftrag', titel: 'Test <Verein>' }, { datum: '2026-12-04', bestellschluss: '2026-11-27', eintraege: 3 });
    expect(kopf).toContain('Bestellung für Test &lt;Verein&gt;');
    expect(kopf).toContain('bestellen bis Fr 27.11.2026');
    expect(kopf).toContain('Lieferung geplant: Fr 04.12.2026');
    expect(kopf).not.toMatch(/Termin|Spieltag|Gegner/);
    expect(F.bsBannerHtml({ nachSchluss: true, bestellschluss: '2026-11-27' }, { art: 'auftrag' })).not.toContain('Termin');
    expect(F.bsBannerHtml({ nachSchluss: true, bestellschluss: '2026-11-18' }, { art: 'dauer' })).toContain('ohne Garantie bis zum Termin');   // Fanshop wie bisher
    expect(F.bsBannerHtml(null, { art: 'auftrag', abgeschlossen: '2026-11-08T11:00:00Z' })).toContain('Die Bestellung ist abgeschlossen');
    expect(F.bsAbschlussHtml({ art: 'auftrag', abschliessen: true })).toContain('Bestellung abschließen');
    expect(F.bsAbschlussHtml({ art: 'auftrag', abschliessen: true, abgeschlossen: 'x' })).toBe('');
    expect(F.bsAbschlussHtml({ art: 'dauer', abschliessen: true })).toBe('');
  });

  test('Name/Nummer im Raster: nur mit einer Groesse, Anzahl 1; erscheint im Korb und in der Liste', () => {
    const a = { name: 'T-Shirt', farbe: 'Black', groessen: [{ id: '1', groesse: 'M' }, { id: '2', groesse: 'L' }] };
    expect(F.bsTextilFehler(a, { 1: '2' }, { name: 'X' })).toMatch(/Anzahl 1/);
    expect(F.bsTextilFehler(a, { 1: '1', 2: '1' }, { name: 'X' })).toMatch(/genau eine Größe/);
    expect(F.bsTextilFehler(a, { 1: '1' }, { nummer: '12a' })).toMatch(/Ziffern/);
    expect(F.bsTextilFehler(a, { 1: '3', 2: '1' }, {})).toBe('');
    const p = F.bsPositionenAusRaster(a, { 1: '1' }, '', { name: 'ERFUNDEN', nummer: '7' });
    expect(p).toEqual([expect.objectContaining({ id: '1', menge: 1, name: 'ERFUNDEN', nummer: '7', text: 'T-Shirt · Black · M · Name/Nr.: ERFUNDEN 7' })]);
    expect(F.bsEintragWas({ art: 'artikel', menge: 1, bezeichnung: 'T-Shirt · Black', groesse: 'M', trikotName: 'ERFUNDEN', trikotNummer: '7' })).toBe('1 × T-Shirt · Black · M · Name/Nr.: ERFUNDEN 7');
    expect(F.bsArtikelZeileHtml(a, 0, true, true, true)).toContain('data-raster-name');
    expect(F.bsArtikelZeileHtml(a, 0, true, true, false)).not.toContain('data-raster-name');
  });

  test('Seite: schreibbar nur, wenn nicht abgeschlossen; "abschliessen" ruft die eigene Route; MC: Auswahl escaped, Mouse-over', () => {
    expect(seite).toMatch(/schreibbar = \(\) => \{[^}]*!BS\.d\?\.abgeschlossen/);
    expect(seite).toContain("api('abschliessen', {})");
    const mcBlock = ab(mc, '// ── Bestellseiten-MC: Anfang', '// ── Bestellseiten-MC: Ende ──');
    const kuEsc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const M = new Function('kuEsc', `${mcBlock}\nreturn { bsmAuswahlHtml, bsmAuswahlMit, bsmAuftragFelderHtml, bsmEintragWas };`)(kuEsc);
    const z = { Zugang_ID: 'BS-001', auswahl: [{ modell: 'X100', farben: ['Black'], name: 'Shirt <b>', motiv: '' }] };
    const h = M.bsmAuswahlHtml(z, { offen: true, modell: { catalogNr: 'X100', farben: ['Black', 'White'] }, farben: new Set(['White']), name: 'Hoodie', motiv: '' });
    expect(h).toContain('Shirt &lt;b&gt;');
    expect(h).toContain('data-bsm-aw-farbe="White" checked');
    for (const m of h.matchAll(/<button[^>]*>/g)) expect(m[0]).toMatch(/data-hilfe="/);
    expect(M.bsmAuswahlMit(z, { modell: { catalogNr: 'X100' }, farben: new Set(['White']), name: ' Hoodie ', motiv: '' }))
      .toEqual([{ modell: 'X100', farben: ['Black'], name: 'Shirt <b>' }, { modell: 'X100', farben: ['White'], name: 'Hoodie' }]);
    expect(M.bsmEintragWas({ art: 'artikel', menge: 1, bezeichnung: 'Shirt', groesse: 'M', trikotName: 'ERFUNDEN' })).toBe('1 × Shirt · M · Name/Nr.: ERFUNDEN');
    expect(M.bsmAuftragFelderHtml({ Titel: 'T', Bestellschluss_Datum: '2026-11-27', Personalisierung: 'ja' })).toContain('data-bsm-pers checked');
  });
});
