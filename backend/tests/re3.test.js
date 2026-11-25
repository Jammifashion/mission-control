// RE3 (antwort-RE3-3, S2): "Abrechnen …" aus dem Auftrag mit konkreten Gruenden (A), Vorkasse als Markierung (B), Versand als
// Rechnungszeile (C). Keine Statusregel. Nur ERFUNDENE Kunden/Betraege; Lexware nur als Attrappe. Im Test nur AU-Nummern.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import { nettoAusBrutto } from '../utils/auftrag-preise.js';
import { TAB_AUFTRAEGE, TAB_POSITIONEN, AUFTRAG_SPALTEN, POSITION_SPALTEN, POSITION_OPTIONAL, AUFTRAG_OPTIONAL } from '../utils/auftraege.js';
import { TAB_AUFGABEN, AUFGABE_SPALTEN, TAB_TODOS, TODO_SPALTEN } from '../utils/aufgaben.js';
import { KUNDEN_SPALTEN, TAB_KUNDEN } from '../utils/kunden.js';
import {
  abrechnenListe, rechnungsPlan, auftragGruende, versandAus, rechnungPruef, nachRechnungGeaendert, abrechnungsFelderPlan, euroWert,
  GEAENDERT_TEXT, RE3_SPALTEN,
} from '../utils/rechnung.js';
import { rechnungAnlegen, rechnungPruefen, vorkasseStaende, setzeAbrechnungsFelder, richteVersandConfigEin, _vorkasseSpeicherLeeren } from '../lib/rechnung.js';
import { _auftraegeCacheLeeren } from '../lib/auftraege.js';
import { _kundenCacheLeeren } from '../lib/kunden.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { _lieferbarkeitCacheLeeren } from '../lib/lieferbarkeitLesen.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const ID = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const KONTAKT = '11111111-2222-4333-8444-555555555555';
const jetzt = () => new Date('2026-11-25T10:00:00.000Z');
const au = (nr, extra = {}) => ({ Auftrag_Nr: nr, Kunden_Nr: 'K-00900', Kurztitel: `Test ${nr}`, Status: 'Design', Termin: '2026-12-02', Stand: `S-${nr}`, Preis_Eingabe: 'brutto', ...extra });
const pos = (id, nr, extra = {}) => ({ Position_ID: id, Auftrag_Nr: nr, Art: 'frei', Freitext: `Muster ${id}`, Menge: 2, Preis_Netto: nettoAusBrutto(34.5), ...extra });
const kontakt = KONTAKT;

describe('Teil A: Gruende - eine Stelle, keine Statusregel', () => {
  test('Status "Design" mit allen Preisen ist abrechenbar (RE1: Kennzeichen, nicht Status)', () => {
    expect(auftragGruende({ auftrag: au('AU-2026-0101'), positionen: [pos('AU-2026-0101-01', 'AU-2026-0101')], kontaktId: kontakt })).toEqual([]);
  });
  test('konkret: jede Position ohne Preis mit Nummer, Rabatt, Versand, Lexoffice', () => {
    const g = auftragGruende({ auftrag: au('AU-2026-0102', { Rabatt: '10%', Versand_Art: 'individuell' }),
      positionen: [pos('AU-2026-0102-01', 'AU-2026-0102', { Preis_Netto: '' }), pos('AU-2026-0102-02', 'AU-2026-0102', { Preis_Netto: '' })], kontaktId: '' });
    expect(g.map(x => x.code)).toEqual(['ohne_preis', 'ohne_preis', 'rabatt', 'versand', 'kein_lexoffice']);
    expect(g[0]).toMatchObject({ positionId: 'AU-2026-0102-01', text: 'AU-2026-0102-01 ohne Preis (Muster AU-2026-0102-01)' });
    expect(g[3].text).toBe('Versand „individuell“ ohne Betrag');
  });
  test('schon abgerechnet: "abgerechnet am … (Entwurf in Lexware)"; storniert', () => {
    expect(auftragGruende({ auftrag: au('AU-2026-0103', { Rechnung_Status: 'entwurf', Rechnung_Lexware_ID: ID, Rechnung_Am: '2026-11-20' }), positionen: [] }))
      .toEqual([{ code: 'abgerechnet', text: 'abgerechnet am 20.11.2026 (Entwurf in Lexware)' }]);
    expect(auftragGruende({ auftrag: au('AU-2026-0104', { Status: 'storniert' }), positionen: [] })[0].code).toBe('storniert');
  });
  test('Liste: Lexoffice-Verknuepfung und brutto/netto gemischt schon in der Liste', () => {
    const l = abrechnenListe({ auftraege: [au('AU-2026-0105'), au('AU-2026-0106', { Preis_Eingabe: '' })],
      positionen: [pos('AU-2026-0105-01', 'AU-2026-0105'), pos('AU-2026-0106-01', 'AU-2026-0106')], kundenNr: 'K-00900', kontaktId: kontakt });
    expect(l.hinweise[0]).toMatch(/gemischt/);
    const ohne = abrechnenListe({ auftraege: [au('AU-2026-0105')], positionen: [pos('AU-2026-0105-01', 'AU-2026-0105')], kundenNr: 'K-00900', kontaktId: '' });
    expect(ohne.offen[0].grund).toBe('Kunde ist nicht mit Lexoffice verknüpft');
  });
});

describe('Teil B: Vorkasse = Markierung', () => {
  test('Haken aendert die Abrechenbarkeit nicht; mit Kennzeichen spaeter (geliefert) nicht wieder abrechenbar', () => {
    const vk = au('AU-2026-0110', { Vorkasse: 'ja' });
    const p = [pos('AU-2026-0110-01', 'AU-2026-0110')];
    expect(auftragGruende({ auftrag: vk, positionen: p, kontaktId: kontakt })).toEqual([]);
    const spaeter = { ...vk, Status: 'übergeben', Rechnung_Status: 'entwurf', Rechnung_Lexware_ID: ID, Rechnung_Am: '2026-11-25' };
    const l = abrechnenListe({ auftraege: [spaeter], positionen: p, kundenNr: 'K-00900', kontaktId: kontakt });
    expect(l.offen).toEqual([]);
    expect(l.abgerechnet.map(x => x.auftragNr)).toEqual(['AU-2026-0110']);
  });
  test('Pruefsumme: Preis-/Positions-/Versand-Aenderung nach der Rechnung -> Hinweis', () => {
    const a = au('AU-2026-0111');
    const p = [pos('AU-2026-0111-01', 'AU-2026-0111')];
    const fest = { ...a, Rechnung_Status: 'entwurf', Rechnung_Pruef: rechnungPruef({ auftrag: a, positionen: p }) };
    expect(nachRechnungGeaendert({ auftrag: fest, positionen: p })).toBe(false);
    expect(nachRechnungGeaendert({ auftrag: fest, positionen: [pos('AU-2026-0111-01', 'AU-2026-0111', { Preis_Netto: nettoAusBrutto(39) })] })).toBe(true);
    expect(nachRechnungGeaendert({ auftrag: fest, positionen: [...p, pos('AU-2026-0111-02', 'AU-2026-0111')] })).toBe(true);
    expect(nachRechnungGeaendert({ auftrag: { ...fest, Versand_Art: 'individuell', Versand_Betrag: 5 }, positionen: p })).toBe(true);
    expect(nachRechnungGeaendert({ auftrag: { ...a, Rechnung_Status: 'entwurf' }, positionen: p })).toBe(false);   // ohne Pruefsumme: unbekannt
  });
});

describe('Teil C: Versand als Rechnungszeile', () => {
  const p = nr => [pos(`${nr}-01`, nr)];
  test('Paket (brutto-Rechnung): eigene Zeile 19 %, Summe auf den Cent', () => {
    const a = au('AU-2026-0120', { Versand_Art: 'paket', Versand_Betrag: 6.49 });
    const r = rechnungsPlan({ auftraege: [a], positionen: p('AU-2026-0120'), kontaktId: kontakt, jetzt: jetzt() });
    expect(r.probleme).toEqual([]);
    const v = r.payload.lineItems.at(-1);
    expect(v).toMatchObject({ type: 'custom', name: 'Versandkosten (Paket)', quantity: 1, unitPrice: { grossAmount: 6.49, taxRatePercentage: 19 } });
    expect(r.summen.brutto).toBe(2 * 3450 + 649);
    expect(r.positionen.at(-1)).toMatchObject({ art: 'versand', summe: 649 });
  });
  test('Netto-Rechnung: netAmount aus dem Brutto (4 Stellen)', () => {
    const a = au('AU-2026-0121', { Preis_Eingabe: '', Versand_Art: 'brief', Versand_Betrag: '1,95' });
    const r = rechnungsPlan({ auftraege: [a], positionen: p('AU-2026-0121'), kontaktId: kontakt, jetzt: jetzt() });
    expect(r.payload.lineItems.at(-1)).toMatchObject({ name: 'Versandkosten (Brief/Warensendung)', unitPrice: { netAmount: nettoAusBrutto(1.95, 19) } });
  });
  test('Abholung: keine Zeile; individuell mit Text; ohne Betrag bzw. Config fehlt: Grund, nicht abrechenbar', () => {
    expect(rechnungsPlan({ auftraege: [au('AU-2026-0122')], positionen: p('AU-2026-0122'), kontaktId: kontakt, jetzt: jetzt() }).payload.lineItems.some(x => /Versand/.test(x.name))).toBe(false);
    expect(versandAus({ Versand_Art: 'individuell', Versand_Betrag: 12, Versand_Text: 'Spedition' })).toMatchObject({ zeile: true, text: 'Spedition', betrag: 12 });
    expect(versandAus({ Versand_Art: 'individuell', Versand_Betrag: 12 }).text).toBe('Versandkosten');
    const ohne = rechnungsPlan({ auftraege: [au('AU-2026-0123', { Versand_Art: 'individuell' })], positionen: p('AU-2026-0123'), kontaktId: kontakt, jetzt: jetzt() });
    expect(ohne.probleme.join(' ')).toMatch(/individuell“ ohne Betrag/);
    expect(versandAus({ Versand_Art: 'paket' }).grund).toMatch(/fehlt in Config \(versand\.paket_brutto\)/);
  });
  test('Betrag beim Waehlen aus Config, eingefroren; individuell von Hand; Abholung leert; storniert nie', () => {
    const cfg = { brief: 1.95, paket: 6.49 };
    expect(abrechnungsFelderPlan(au('AU-2026-0124'), { versandArt: 'paket' }, cfg)).toEqual({ Versand_Art: 'paket', Versand_Betrag: 6.49 });
    // gleiche Art, Config spaeter anders -> Betrag bleibt
    expect(abrechnungsFelderPlan(au('AU-2026-0124', { Versand_Art: 'paket', Versand_Betrag: 5.99 }), { versandArt: 'paket' }, cfg)).toEqual({});
    expect(abrechnungsFelderPlan(au('AU-2026-0124'), { versandArt: 'paket' }, {})).toEqual({ Versand_Art: 'paket' });   // Config leer -> ohne Betrag (Grund)
    expect(abrechnungsFelderPlan(au('AU-2026-0124'), { versandArt: 'individuell', versandBetrag: '12,50', versandText: 'Kurier' }, cfg))
      .toEqual({ Versand_Art: 'individuell', Versand_Betrag: 12.5, Versand_Text: 'Kurier' });
    expect(abrechnungsFelderPlan(au('AU-2026-0124', { Versand_Art: 'paket', Versand_Betrag: 6.49 }), { versandArt: 'abholung' }, cfg)).toEqual({ Versand_Art: '', Versand_Betrag: '' });
    expect(abrechnungsFelderPlan(au('AU-2026-0124'), { vorkasse: true }, cfg)).toEqual({ Vorkasse: 'ja' });
    expect(() => abrechnungsFelderPlan(au('AU-2026-0124', { Status: 'storniert' }), { vorkasse: true }, cfg)).toThrow(/storniert/);
    expect(() => abrechnungsFelderPlan(au('AU-2026-0124'), { versandArt: 'individuell', versandBetrag: 'viel' }, cfg)).toThrow(/Euro-Betrag/);
    expect(euroWert('0')).toBeNull();
  });
});

describe('Ablaeufe mit In-Memory-Sheet', () => {
  const AS = [...AUFTRAG_SPALTEN, ...AUFTRAG_OPTIONAL], PS = [...POSITION_SPALTEN, ...POSITION_OPTIONAL];
  function tabs(auftraege, positionen, { lexoffice = KONTAKT } = {}) {
    return {
      LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Brand', 'CatNrManufacturer', 'Discontinued', 'Status', 'Description', '10CartonsPrice', 'Quelle_Datum']],
      [TAB_AUFTRAEGE]: [AS, ...auftraege.map(o => AS.map(s => o[s] ?? ''))],
      [TAB_POSITIONEN]: [PS, ...positionen.map(o => PS.map(s => o[s] ?? ''))],
      [TAB_AUFGABEN]: [AUFGABE_SPALTEN], [TAB_TODOS]: [TODO_SPALTEN],
      [TAB_KUNDEN]: [KUNDEN_SPALTEN, KUNDEN_SPALTEN.map(s => ({ Kunden_Nr: 'K-00900', Lexoffice_ID: lexoffice, Name: 'Testverein', Status: 'aktiv', Art: 'Verein' })[s] ?? '')],
      Config: [['Schlüssel', 'Wert'], ['versand.paket_brutto', 6.49]],
    };
  }
  beforeEach(() => {
    process.env.GOOGLE_SHEET_ID = 'ssot-test'; process.env.KUNDEN_SHEET_ID = 'kunden-test'; process.env.BUSINESS_SHEET_ID = 'biz-test';
    _auftraegeCacheLeeren(); _kundenCacheLeeren(); _resetLShopCache(); _lieferbarkeitCacheLeeren(); _vorkasseSpeicherLeeren();
  });
  const sp = (t, s) => t[TAB_AUFTRAEGE][0].indexOf(s);
  const opts = senden => ({ jetzt, senden, melden: async () => {}, schluesselLesen: async () => 's' });

  test('Vorkasse in "Design" + Paket: anlegen setzt Kennzeichen + Pruefsumme; danach nicht abrechenbar, Aenderung -> Hinweis', async () => {
    const t = tabs([au('AU-2026-0130')], [pos('AU-2026-0130-01', 'AU-2026-0130')]);
    const { sheets } = machSheets(t);
    await setzeAbrechnungsFelder({ eingabe: { auftragNr: 'AU-2026-0130', vorkasse: true, versandArt: 'paket' }, sheets });
    expect(t[TAB_AUFTRAEGE][1][sp(t, 'Vorkasse')]).toBe('ja');
    expect(t[TAB_AUFTRAEGE][1][sp(t, 'Versand_Betrag')]).toBe(6.49);
    _auftraegeCacheLeeren();
    const vor = await rechnungPruefen({ nr: 'AU-2026-0130', sheets, belegeLesen: async () => ({ belege: [] }) });
    expect(vor).toMatchObject({ abrechenbar: true, gruende: [], vorkasse: { ja: true, stand: 'keine' } });
    let payload;
    await rechnungAnlegen({ eingabe: { kundenNr: 'K-00900', auftraege: [{ nr: 'AU-2026-0130', stand: t[TAB_AUFTRAEGE][1][sp(t, 'Stand')] }] }, sheets,
      ...opts(async o => { payload = o.payload; return { ergebnis: 'angelegt', id: ID }; }) });
    expect(payload.lineItems.at(-1).name).toBe('Versandkosten (Paket)');
    expect(t[TAB_AUFTRAEGE][1][sp(t, 'Rechnung_Pruef')]).toMatch(/^[0-9a-f]{16}$/);
    // Lexware: Rechnung offen -> "Vorkasse offen"
    const belegeLesen = async () => ({ belege: [{ id: ID, voucherStatus: 'open', voucherNumber: 'RE-TEST-1' }] });
    const nach = await rechnungPruefen({ nr: 'AU-2026-0130', sheets, belegeLesen });
    expect(nach).toMatchObject({ abrechenbar: false, geaendert: '', vorkasse: { ja: true, stand: 'offen', nummer: 'RE-TEST-1' } });
    expect((await vorkasseStaende({ sheets, belegeLesen })).je).toEqual({ 'AU-2026-0130': 'offen' });
    // Versand danach geaendert -> Hinweis (nichts nachberechnet)
    const r = await setzeAbrechnungsFelder({ eingabe: { auftragNr: 'AU-2026-0130', versandArt: 'individuell', versandBetrag: '9,90' }, sheets });
    expect(r.hinweis).toBe(GEAENDERT_TEXT);
    _vorkasseSpeicherLeeren();
    expect((await rechnungPruefen({ nr: 'AU-2026-0130', sheets, belegeLesen })).geaendert).toBe(GEAENDERT_TEXT);
  });
  test('Kunde ohne Lexoffice: Grund im Auftrag; Spalten fehlen: 409 einrichtung', async () => {
    const t = tabs([au('AU-2026-0131')], [pos('AU-2026-0131-01', 'AU-2026-0131')], { lexoffice: '' });
    const { sheets } = machSheets(t);
    const r = await rechnungPruefen({ nr: 'AU-2026-0131', sheets });
    expect(r.gruende.map(g => g.code)).toEqual(['kein_lexoffice']);
    const ohne = tabs([au('AU-2026-0132')], []);
    ohne[TAB_AUFTRAEGE] = ohne[TAB_AUFTRAEGE].map(z => z.slice(0, AUFTRAG_SPALTEN.length));
    const s2 = machSheets(ohne).sheets;
    _auftraegeCacheLeeren();
    await expect(setzeAbrechnungsFelder({ eingabe: { auftragNr: 'AU-2026-0132', vorkasse: true }, sheets: s2 })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
  });
  test('Setup Config: Trockenlauf zeigt nur fehlende versand.* (Wert leer), schreibt nichts', async () => {
    const t = tabs([], []);
    const { sheets } = machSheets(t);
    const r = await richteVersandConfigEin({ sheets });
    expect(r).toEqual({ plan: ['Config-Zeile versand.brief_brutto = (leer – Inhaber trägt den Bruttobetrag ein)'], geschrieben: false });
    expect(t.Config).toHaveLength(2);
  });
  test('neue Spalten stehen hinten in AUFTRAG_OPTIONAL', () => {
    expect(AUFTRAG_OPTIONAL.slice(-RE3_SPALTEN.length)).toEqual(RE3_SPALTEN);
  });
});

describe('Oberflaeche', () => {
  test('Knopf "Abrechnen …" im Auftrag oeffnet die bestehende Ansicht vorgewaehlt (kein zweiter Rechnungsweg)', () => {
    expect(html).toContain('data-hilfe="au-abrechnen">Abrechnen …</button>');
    expect(html).toContain("globalThis.reAbrechnenFuer = (kundenNr, nr) => { reZ.vorwahl = { kunde: kundenNr, nr }; oeffneAnsicht('auftraege', 'abrechnen'); };");
    expect(html).toContain('reZ.gewaehlt = new Set([vw.nr]); await reVorschau(); return;');
  });
  test('Gruende mit Sprung (Kundenkarte, bearbeiten), Hinweis orange, keine Regeln im Frontend', () => {
    expect(html).toContain('data-hilfe="au-re-grund">zur Kundenkarte</button>');
    expect(html).toContain('/api/auftraege/rechnung/pruefen?nr=');
    expect(html).not.toMatch(/ohne Preis\b.*Preis_Netto === ''/);
  });
  test('Dialog: Vorkasse-Haken und Versand mit Mouse-over; Liste: Chip "Vorkasse offen"', () => {
    for (const k of ['au-vorkasse', 'au-versand-art', 'au-versand-betrag', 'au-versand-text']) expect(html).toContain(`data-hilfe="${k}"`);
    expect(html).toContain('>Vorkasse offen</span>');
  });
});
