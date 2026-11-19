// PO1: Festpreis-Porto je Bestellung als eigene Positionen. Nur erfundene Bestellungen und erfundene Saetze.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { berechnePorto, satzAus, portoFuerSyncZeile, portoNeu, umstellungsPlan, PORTO_BESTELLUNG, PORTO_VERSANDART, PORTO_AB } from '../utils/festpreis-porto.js';
import { berechneFestpreisAnteil } from '../utils/festpreis-kalkulation.js';
import { parseKonfiguration } from '../utils/partner-kalkulation.js';

const hier = dirname(fileURLToPath(import.meta.url));
const KOPF = ['Partner-ID', 'Datum', 'WC-Bestellnummer', 'Artikelname', 'Variante', 'Stückzahl', 'Festpreis-EK', 'Handling', 'Porto-Einnahme', 'Porto-Kosten',
  'Versandnebenkosten', 'PayPal-Kosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto', 'Status Abrechnung', 'Produkt-ID', 'Storno-Status',
  'Artikelkategorie', 'Festpreis', 'Mehrkosten', 'VK-Netto', 'Handlingskosten', 'Versandmethode', 'Sperre', PORTO_BESTELLUNG, PORTO_VERSANDART];
const vh = c => KOPF.indexOf(c);
let n = 0;
const z = (o = {}) => {
  const r = KOPF.map(() => '');
  const w = { 'Partner-ID': 'FP-001', Datum: '05.07.2026', 'Status Abrechnung': 'offen', Versandmethode: 'flat_rate', Artikelname: `Artikel ${++n}`, ...o };
  for (const [k, v] of Object.entries(w)) r[vh(k)] = v;
  return r;
};
// erfundene Saetze (netto): B = 1 + 0,5, P = 5 + 1
const SATZ = { portoB: 1, portoP: 5, versandnebenkostenB: 0.5, versandnebenkostenP: 1 };
const satz = () => SATZ;
const P = (zeilen, alle = zeilen, o = {}) => berechnePorto(zeilen, vh, satz, alle, o);

describe('Regel je Bestellung', () => {
  test('nur B: Grossbrief-Satz einmal, volle Porto-Einnahme einmal (auch bei zwei Zeilen)', () => {
    const r = P([z({ 'WC-Bestellnummer': '101', [PORTO_BESTELLUNG]: '4,9', [PORTO_VERSANDART]: 'B' }), z({ 'WC-Bestellnummer': '101', [PORTO_BESTELLUNG]: '4,9', [PORTO_VERSANDART]: 'B' })]);
    expect(r).toMatchObject({ status: 'ok', einnahmen: { anzahl: 1, summe: 4.9 }, kosten: { anzahl: 1, summe: 1.5, paket: 0, grossbrief: 1 }, saldo: 3.4 });
  });
  test('nur P und B+P gemischt: Paket-Satz (hoeherer Satz) je Bestellung', () => {
    const r = P([z({ 'WC-Bestellnummer': '102', [PORTO_BESTELLUNG]: 6, [PORTO_VERSANDART]: 'P' }),
      z({ 'WC-Bestellnummer': '103', [PORTO_BESTELLUNG]: 6, [PORTO_VERSANDART]: 'B' }), z({ 'WC-Bestellnummer': '103', [PORTO_BESTELLUNG]: 6, [PORTO_VERSANDART]: 'P' })]);
    expect(r.kosten).toEqual({ anzahl: 2, summe: 12, paket: 2, grossbrief: 0 });
    expect(r.einnahmen).toEqual({ anzahl: 2, summe: 12 });
  });
  test('Partner + fremder Artikel: Partner bekommt die VOLLE Porto-Einnahme und traegt den vollen Satz', () => {
    // Porto_Bestellung = shipping_total der ganzen Bestellung, nicht der Anteil
    const r = P([z({ 'WC-Bestellnummer': '104', [PORTO_BESTELLUNG]: 7, [PORTO_VERSANDART]: 'B', 'Porto-Einnahme': 0 })]);
    expect(r).toMatchObject({ einnahmen: { summe: 7 }, kosten: { summe: 1.5 } });
  });
  test('Abholung und ohne Versand: keine Porto-Kosten, Einnahme zaehlt; Versandmethode fehlt -> Hinweis, status fehlt', () => {
    const r = P([z({ 'WC-Bestellnummer': '105', Versandmethode: 'local_pickup:6', [PORTO_BESTELLUNG]: 0, [PORTO_VERSANDART]: 'P' }),
      z({ 'WC-Bestellnummer': '106', Versandmethode: '-', [PORTO_BESTELLUNG]: 0, [PORTO_VERSANDART]: 'B' })]);
    expect(r).toMatchObject({ status: 'ok', kosten: { anzahl: 0, summe: 0 }, einnahmen: { anzahl: 2, summe: 0 }, abholung: 1, ohneVersand: 1 });
    const u = P([z({ 'WC-Bestellnummer': '107', Versandmethode: '', [PORTO_BESTELLUNG]: 3, [PORTO_VERSANDART]: 'B' })]);
    expect(u.status).toBe('fehlt');
    expect(u.hinweise[0]).toMatch(/107/);
    // ohne Versandmethode zaehlen Einnahme UND Kosten nicht - der Saldo nimmt nichts still mit
    expect(u).toMatchObject({ einnahmen: { anzahl: 0, summe: 0 }, kosten: { anzahl: 0, summe: 0 }, saldo: 0 });
    const mit = P([z({ 'WC-Bestellnummer': '107', Versandmethode: '', [PORTO_BESTELLUNG]: 3, [PORTO_VERSANDART]: 'B' }),
      z({ 'WC-Bestellnummer': '109', [PORTO_BESTELLUNG]: 4, [PORTO_VERSANDART]: 'B' })]);
    expect(mit).toMatchObject({ status: 'fehlt', einnahmen: { anzahl: 1, summe: 4 }, kosten: { anzahl: 1, summe: 1.5 }, saldo: 2.5 });
  });
  test('Bestellung ueber zwei Abrechnungen: zaehlt nur in der ersten', () => {
    const erste = z({ 'WC-Bestellnummer': '108', [PORTO_BESTELLUNG]: 5, [PORTO_VERSANDART]: 'B', 'Status Abrechnung': 'abgerechnet' });
    const zweite = z({ 'WC-Bestellnummer': '108', [PORTO_BESTELLUNG]: 5, [PORTO_VERSANDART]: 'B' });
    expect(P([zweite], [erste, zweite]).status).toBe('keine');
    expect(P([erste, zweite].map(r => { const c = [...r]; c[vh('Status Abrechnung')] = 'offen'; return c; })).einnahmen.anzahl).toBe(1);
  });
  test('Datum 30.06. (altes Modell, ohne Porto_Bestellung) zaehlt nie; 01.07. zaehlt', () => {
    expect(portoNeu('30.06.2026')).toBe(false);
    expect(portoNeu('01.07.2026')).toBe(true);
    expect(PORTO_AB).toBe('2026-07-01');
    const alt = z({ Datum: '30.06.2026', 'WC-Bestellnummer': '109', 'Porto-Einnahme': 2 });
    const neu = z({ Datum: '01.07.2026', 'WC-Bestellnummer': '110', [PORTO_BESTELLUNG]: 2, [PORTO_VERSANDART]: 'B' });
    expect(P([alt, neu]).einnahmen.anzahl).toBe(1);
    expect(portoFuerSyncZeile({ bestelldatumDE: '30.06.2026', shippingNetto: 5, versandart: 'B' })).toBeNull();
    expect(portoFuerSyncZeile({ bestelldatumDE: '01.07.2026', shippingNetto: 5, versandart: 'B' }))
      .toEqual({ portoEinnahmeAnteil: 0, portoKostenAnteil: 0, versandnkAnteil: 0, portoBestellung: 5, versandart: 'B' });
  });
  test('zwei FP-Partner in einer Bestellung: genau einer traegt das Porto (Paket vor Grossbrief, sonst kleinere ID)', () => {
    const a = z({ 'Partner-ID': 'FP-001', 'WC-Bestellnummer': '111', [PORTO_BESTELLUNG]: 6, [PORTO_VERSANDART]: 'B' });
    const b = z({ 'Partner-ID': 'FP-002', 'WC-Bestellnummer': '111', [PORTO_BESTELLUNG]: 6, [PORTO_VERSANDART]: 'P' });
    expect(P([a], [a, b], { partnerId: 'FP-001' })).toMatchObject({ status: 'keine', anderePartner: 1 });
    expect(P([b], [a, b], { partnerId: 'FP-002' }).kosten).toMatchObject({ anzahl: 1, paket: 1 });
    const c = z({ 'Partner-ID': 'FP-002', 'WC-Bestellnummer': '112', [PORTO_BESTELLUNG]: 3, [PORTO_VERSANDART]: 'B' });
    const d = z({ 'Partner-ID': 'FP-001', 'WC-Bestellnummer': '112', [PORTO_BESTELLUNG]: 3, [PORTO_VERSANDART]: 'B' });
    expect(P([d], [c, d], { partnerId: 'FP-001' }).einnahmen.anzahl).toBe(1);
    expect(P([c], [c, d], { partnerId: 'FP-002' }).status).toBe('keine');
  });
  test('Storno-Gegenbuchung = Gegenposition (wie VP1); im selben Zeitraum 0', () => {
    const o = z({ 'WC-Bestellnummer': '113', [PORTO_BESTELLUNG]: 4, [PORTO_VERSANDART]: 'B', 'Status Abrechnung': 'abgerechnet' });
    const s = z({ 'WC-Bestellnummer': '113', 'Storno-Status': 'storniert' });
    expect(P([s], [o, s])).toMatchObject({ einnahmen: { anzahl: -1, summe: -4 }, kosten: { anzahl: -1, summe: -1.5 } });
    const o2 = [...o]; o2[vh('Status Abrechnung')] = 'offen';
    expect(P([o2, s], [o2, s]).status).toBe('keine');
  });
  test('Spalten fehlen (altes Modell) -> keine Positionen', () => {
    const vhAlt = c => (c === PORTO_BESTELLUNG || c === PORTO_VERSANDART ? -1 : vh(c));
    expect(berechnePorto([z()], vhAlt, satz).status).toBe('keine');
  });
});

describe('Saetze zum Bestelldatum (Kalkulation_Fixkosten, gueltig ab/bis)', () => {
  test('satzAus nimmt den Satz, der am Bestelldatum gilt', () => {
    const kopf = ['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis'];
    const rows = [['Porto B', '1,00', '€', '01.01.2026', '30.09.2026'], ['Porto B', '2,00', '€', '01.10.2026', '']];
    const s = satzAus(parseKonfiguration, rows, kopf);
    expect(s('2026-07-15').portoB).toBe(1);
    expect(s('2026-10-15').portoB).toBe(2);
  });
});

describe('Umstellung offener Bestandszeilen', () => {
  const alt = (o = {}) => z({ Datum: '10.07.2026', 'WC-Bestellnummer': '201', 'Produkt-ID': '7', 'VK-Netto': '20', Festpreis: '8', Handlingskosten: '1', 'Stückzahl': '1',
    Mehrkosten: '0', 'PayPal-Kosten': '0,5', 'Porto-Einnahme': '2', 'Porto-Kosten': '1', Versandnebenkosten: '0,25', [PORTO_BESTELLUNG]: '', [PORTO_VERSANDART]: '', ...o });
  const plan = zeilen => umstellungsPlan({ kopf: KOPF, zeilen: zeilen.map((r, i) => Object.assign(r, { _sheetRow: i + 2 })), partnerId: 'FP-001',
    portoJe: new Map([['201', 4], ['202', 0]]), versandartJe: p => (p === '7' ? 'P' : null), satzAm: satz, berechne: berechneFestpreisAnteil, mwstProzent: 19 });
  test('nur offen, ab 01.07., keine Storno, noch nicht umgestellt; I/J/K = 0, M/N ohne Porto neu, Y/Z gesetzt', () => {
    const p = plan([alt(), alt({ 'Status Abrechnung': 'abgerechnet' }), alt({ Datum: '30.06.2026' }), alt({ 'Storno-Status': 'storniert' }),
      alt({ [PORTO_BESTELLUNG]: '4' }), alt({ 'Status Abrechnung': 'gesperrt' })]);
    expect(p.aenderungen).toHaveLength(1);
    expect(p.aenderungen[0].werte).toEqual({ 'Porto-Einnahme': 0, 'Porto-Kosten': 0, Versandnebenkosten: 0,
      'Gesamt-Partner-Netto': 10.5, 'Gesamt-Partner-Brutto': 12.5, [PORTO_BESTELLUNG]: 4, [PORTO_VERSANDART]: 'P' });
  });
  test('Vergleich je Bestellung: alt (anteilig) gegen neu (je Bestellung), nur als Zaehler; ohne Porto/Versandart -> nicht umgestellt', () => {
    const p = plan([alt(), alt({ 'WC-Bestellnummer': '203' }), alt({ 'WC-Bestellnummer': '202', 'Produkt-ID': '9' })]);
    expect(p.fehlt).toEqual(['203']);
    expect(p.ohneVersandart).toEqual(['9']);
    expect(p).toMatchObject({ bestellungen: 1, weniger: 1, mehr: 0, gleich: 0 });   // alt 2-1-0,25=0,75 · neu 4-(5+1)=-2
  });
});

describe('eine Funktion fuer Vorschau, Abrechnung und Portal', () => {
  test('Summary, POST /abrechnungen und Portal-Saldo rechnen ueber ladePorto + portoSaldo', () => {
    const portal = readFileSync(resolve(hier, '../routes/festpreis-portal.js'), 'utf8');
    const pub = readFileSync(resolve(hier, '../routes/festpreis-public.js'), 'utf8');
    expect(portal.match(/await ladePorto\(/g)).toHaveLength(2);
    expect(portal).toContain('const auszahlungNetto = Math.round((summen.auszahlung + portoSaldo(porto)) * 100) / 100;');
    expect(portal).toContain('Math.round((summen.auszahlung + portoSaldo(porto)) * (1 + mwstProzent / 100) * 100) / 100;');
    expect(pub).toContain('await ladePorto(sheets, sheetId, partnerId, offeneMitStorno, rows, vh)');
    expect(pub).toContain('round2(summen.auszahlung + portoSaldo(p))');
  });
  test('Sync: ab 01.07. I/J/K = 0, Y/Z gesetzt; Mouse-over in MC, kein title', () => {
    const portal = readFileSync(resolve(hier, '../routes/festpreis-portal.js'), 'utf8');
    expect(portal).toContain('const po = portoFuerSyncZeile({ bestelldatumDE: orderDate, shippingNetto, versandart: va });');
    expect(portal).toContain('zeile[PORTO_INDEX] = po.portoBestellung; zeile[PORTO_INDEX + 1] = po.versandart;');
    const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
    const block = html.slice(html.indexOf('function fpPortoHTML('), html.indexOf('function fpVerpackungHTML('));
    expect(block).toContain('data-hilfe="fp-porto-einnahmen"');
    expect(block).toContain('data-hilfe="fp-porto-kosten"');
    expect(block).not.toMatch(/\stitle=|#[0-9a-f]{3,6}\b/i);
  });
});
