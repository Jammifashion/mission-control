// NB2: Teilerstattungen im Festpreis-Sync (FP_Verkäufe), Porto je Bestellung (PO1), Verpackung, Ganz-Storno,
// Hinweise in der Abrechnungsvorschau, AUD1-Reste (Zahl-Leser, Wartungslauf). Nur erfundene Daten.
import { buildFpErstattungRows, erstattungHinweisText, MARKE_ERSTATTUNG, MARKE_VERSAND } from '../utils/teilerstattung.js';
import { berechnePorto, PORTO_BESTELLUNG, PORTO_VERSANDART } from '../utils/festpreis-porto.js';
import { berechneVerpackung, verpackungsKondition } from '../utils/festpreis-verpackung.js';
import { aggregateFpVerkaeufe } from '../utils/fp-abrechnung.js';
import { buildFpStornoRows } from '../routes/festpreis-portal.js';
import { vorschauErstattungsHinweise } from '../lib/erstattungen.js';
import { lizenzSatzAusZeile } from '../utils/partner-kalkulation.js';
import { neuZeilen } from '../scripts/wartung-interne-neu.js';

const KOPF = ['Partner-ID', 'Datum', 'WC-Bestellnummer', 'Artikelname', 'Variante', 'Stückzahl', 'Festpreis-EK', 'Handling', 'Porto-Einnahme', 'Porto-Kosten',
  'Versandnebenkosten', 'PayPal-Kosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto', 'Status Abrechnung', 'Produkt-ID', 'Storno-Status',
  'Artikelkategorie', 'Festpreis', 'Mehrkosten', 'VK-Netto', 'Handlingskosten', 'Versandmethode', 'Sperre', PORTO_BESTELLUNG, PORTO_VERSANDART, 'Positions-ID'];
const vh = c => KOPF.indexOf(c);
const zeile = o => KOPF.map(k => (o[k] ?? ''));
const STORNO = 'Storniert/Rückerstattet';
const satzAm = () => ({ portoB: 1.5, portoP: 4, versandnebenkostenB: 0.5, versandnebenkostenP: 1, fehlt: [] });
const mwstFuer = () => 19;

// Bestellung 900 (PO1, nach 01.07.2026): 3 Stück Pos. 11, Versand 5,00 netto
const ORDER = { id: 900, date_created: '2026-08-10T10:00:00', status: 'completed', shipping_total: '5.00',
  line_items: [{ id: 11, product_id: 501, variation_id: 0, quantity: 3, total: '60.00', name: 'Hoodie Probe' }] };
const ORIG = zeile({ 'Partner-ID': 'FP-001', Datum: '10.08.2026', 'WC-Bestellnummer': 900, Artikelname: 'Hoodie Probe', Variante: 0,
  'Stückzahl': 3, 'Festpreis-EK': 8, Handling: 1, 'Porto-Einnahme': 0, 'Porto-Kosten': 0, Versandnebenkosten: 0, 'PayPal-Kosten': 3,
  'Gesamt-Partner-Netto': 27, 'Gesamt-Partner-Brutto': 32.13, 'Status Abrechnung': 'offen', 'Produkt-ID': 501, Artikelkategorie: 'A',
  Festpreis: 8, Mehrkosten: 0, 'VK-Netto': 60, Handlingskosten: 2, Versandmethode: 'flat_rate', [PORTO_BESTELLUNG]: 5, [PORTO_VERSANDART]: 'P', 'Positions-ID': 11 });
const refund = (id, { menge = 0, versand = 0, item = 11 } = {}) => ({ id, date_created: '2026-08-20T09:00:00',
  line_items: menge ? [{ product_id: 501, variation_id: 0, quantity: -menge, total: String(-20 * menge), meta_data: [{ key: '_refunded_item_id', value: String(item) }] }] : [],
  shipping_lines: versand ? [{ total: String(-versand) }] : [] });
const bauen = (vRows, refunds) => buildFpErstattungRows({ vRows, vh, bestellungen: [{ order: ORDER, refunds }], mwstFuer, stornoMarker: STORNO });

describe('FP-Teilerstattung (Position)', () => {
  test('1 von 3 Stück: Stückzahl -1, Beträge anteilig negiert, Stückpreise nur im Vorzeichen', () => {
    const { rows, hinweise } = bauen([ORIG], [refund(70, { menge: 1 })]);
    expect(hinweise).toEqual([]);
    expect(rows).toHaveLength(1);
    const z = rows[0];
    expect(z[vh('Storno-Status')]).toBe(`${MARKE_ERSTATTUNG}70`);
    expect(z[vh('Stückzahl')]).toBe(-1);
    expect(z[vh('VK-Netto')]).toBe(-20);
    expect(z[vh('Gesamt-Partner-Netto')]).toBe(-9);
    expect(z[vh('PayPal-Kosten')]).toBe(-1);
    expect(z[vh('Festpreis')]).toBe(-8);          // Stückpreis, nicht /3
    expect(z[vh('Handlingskosten')]).toBe(-2);
    expect(z[vh('Datum')]).toBe('20.08.2026');
    expect(z[vh('Status Abrechnung')]).toBe('offen');
    expect(z[vh('Positions-ID')]).toBe(11);
    // Abrechnung: Original + Erstattung = 2/3 der Auszahlung
    const ein = aggregateFpVerkaeufe([ORIG], vh).summen.auszahlung;
    const beide = aggregateFpVerkaeufe([ORIG, z], vh).summen.auszahlung;
    expect(beide).toBeCloseTo(ein * 2 / 3, 2);
  });
  test('Wiederholungslauf bucht nichts doppelt', () => {
    const erst = bauen([ORIG], [refund(70, { menge: 1 })]).rows;
    expect(bauen([ORIG, ...erst], [refund(70, { menge: 1 })]).rows).toEqual([]);
  });
  test('Ganz-Storno nach Teilerstattung negiert nur den Rest - Summe 0', () => {
    const erst = bauen([ORIG], [refund(70, { menge: 1 })]).rows;
    const storno = buildFpStornoRows([ORIG, ...erst], [{ id: 900, date_modified: '2026-09-01T10:00:00' }]);
    expect(storno).toHaveLength(1);
    expect(storno[0][vh('Stückzahl')]).toBe(-2);
    expect(storno[0][vh('VK-Netto')]).toBe(-40);
    expect(storno[0][vh('Festpreis')]).toBe(-8);   // Stückpreis bleibt
    expect(storno[0][vh('Storno-Status')]).toBe(STORNO);
    expect(aggregateFpVerkaeufe([ORIG, ...erst, ...storno], vh).summen.auszahlung).toBeCloseTo(0, 2);
  });
  test('alles schon erstattet: kein leeres Ganz-Storno', () => {
    const erst = bauen([ORIG], [refund(70, { menge: 3 })]).rows;
    expect(buildFpStornoRows([ORIG, ...erst], [{ id: 900, date_created: '2026-09-01T10:00:00' }])).toEqual([]);
  });
  test('gesperrte Ursprungszeile: nichts gebucht, Hinweis', () => {
    const gesperrt = [...ORIG]; gesperrt[vh('Status Abrechnung')] = 'gesperrt';
    const { rows, hinweise } = bauen([gesperrt], [refund(70, { menge: 1 })]);
    expect(rows).toEqual([]);
    expect(hinweise.map(h => h.grund)).toEqual(['gesperrt']);
  });
  test('Partner-Filter: Zeilen anderer Partner bleiben unberührt', () => {
    const r = buildFpErstattungRows({ vRows: [ORIG], vh, bestellungen: [{ order: ORDER, refunds: [refund(70, { menge: 1 })] }], mwstFuer,
      stornoMarker: STORNO, partnerFilter: new Set(['FP-009']) });
    expect(r.rows).toEqual([]);
  });
});

describe('FP-Versanderstattung', () => {
  test('PO1: eine Zeile je Erstattung und Partner, Porto_Bestellung = -Versand netto, Beträge 0', () => {
    const { rows } = bauen([ORIG], [refund(71, { versand: 5 })]);
    expect(rows).toHaveLength(1);
    const z = rows[0];
    expect(z[vh('Storno-Status')]).toBe(`${MARKE_VERSAND}71`);
    expect(z[vh(PORTO_BESTELLUNG)]).toBe(-5);
    expect(z[vh('Stückzahl')]).toBe(0);
    expect(z[vh('Gesamt-Partner-Netto')]).toBe(0);
    expect(aggregateFpVerkaeufe([z], vh).summen.auszahlung).toBe(0);
    expect(bauen([ORIG, z], [refund(71, { versand: 5 })]).rows).toEqual([]);   // keine Dublette
  });
  test('PO1: Porto-Einnahme sinkt um den erstatteten Versand, Kosten bleiben', () => {
    const vorher = berechnePorto([ORIG], vh, satzAm, [ORIG], { partnerId: 'FP-001' });
    expect(vorher.einnahmen.summe).toBe(5);
    expect(vorher.kosten.summe).toBe(5);   // Paket 4 + 1
    const z = bauen([ORIG], [refund(71, { versand: 5 })]).rows[0];
    const nachher = berechnePorto([ORIG, z], vh, satzAm, [ORIG, z], { partnerId: 'FP-001' });
    expect(nachher.einnahmen.summe).toBe(0);
    expect(nachher.einnahmen.anzahl).toBe(1);
    expect(nachher.kosten.summe).toBe(5);
    expect(nachher.versandErstattet).toBe(-5);
  });
  test('PO1: Versanderstattung in einer späteren Abrechnung mindert dort, ohne Bestellung oder Kosten', () => {
    const abgerechnet = [...ORIG]; abgerechnet[vh('Status Abrechnung')] = 'abgerechnet';
    const z = bauen([abgerechnet], [refund(71, { versand: 2 })]).rows[0];
    const p = berechnePorto([z], vh, satzAm, [abgerechnet, z], { partnerId: 'FP-001' });
    expect(p.status).toBe('ok');
    expect(p.einnahmen).toEqual({ anzahl: 0, summe: -2 });
    expect(p.kosten.summe).toBe(0);
  });
  test('PO1: Ganz-Storno nach Versanderstattung - über alle Abrechnungen Einnahme 0', () => {
    const abgerechnet = [...ORIG]; abgerechnet[vh('Status Abrechnung')] = 'abgerechnet';
    const v = bauen([abgerechnet], [refund(71, { versand: 2 })]).rows[0];
    const storno = buildFpStornoRows([abgerechnet, v], [{ id: 900, date_modified: '2026-09-01T10:00:00' }]);
    const alle = [abgerechnet, v, ...storno];
    const erste = berechnePorto([ORIG], vh, satzAm, [ORIG], { partnerId: 'FP-001' }).einnahmen.summe;   // +5
    const spaeter = berechnePorto([v, ...storno], vh, satzAm, alle, { partnerId: 'FP-001' }).einnahmen.summe;   // -2 -3
    expect(erste + spaeter).toBeCloseTo(0, 2);
  });
  test('Position erstattet: Porto der Bestellung unverändert (kein Storno)', () => {
    const z = bauen([ORIG], [refund(70, { menge: 1 })]).rows[0];
    const p = berechnePorto([ORIG, z], vh, satzAm, [ORIG, z], { partnerId: 'FP-001' });
    expect(p.einnahmen).toEqual({ anzahl: 1, summe: 5 });
    expect(p.kosten.anzahl).toBe(1);
  });
  test('altes Modell (vor PO1): je Ursprungszeile Porto-Einnahme = Netto = -Versand x Wertanteil, Brutto mit MwSt', () => {
    const alt = [...ORIG]; alt[vh(PORTO_BESTELLUNG)] = ''; alt[vh(PORTO_VERSANDART)] = ''; alt[vh('Datum')] = '10.05.2026';
    const order = { ...ORDER, date_created: '2026-05-10T10:00:00' };
    const { rows } = buildFpErstattungRows({ vRows: [alt], vh, bestellungen: [{ order, refunds: [refund(72, { versand: 4 })] }], mwstFuer, stornoMarker: STORNO });
    expect(rows).toHaveLength(1);
    expect(rows[0][vh('Porto-Einnahme')]).toBe(-4);
    expect(rows[0][vh('Gesamt-Partner-Netto')]).toBe(-4);
    expect(rows[0][vh('Gesamt-Partner-Brutto')]).toBe(-4.76);
    expect(aggregateFpVerkaeufe(rows, vh).summen.auszahlung).toBe(-4);
  });
});

describe('Verpackung (VP1) mit Teilerstattungen', () => {
  test('Erstattungs-Zeilen zählen weder als Bestellung noch als Storno', () => {
    const kondition = { status: 'ok', betrag: 1.5, ab: new Date('2026-01-01T00:00:00Z'), abText: '01.01.2026' };
    const pos = bauen([ORIG], [refund(70, { menge: 1 })]).rows[0];
    const vers = bauen([ORIG], [refund(71, { versand: 5 })]).rows[0];
    expect(berechneVerpackung([ORIG, pos, vers], vh, kondition).anzahl).toBe(1);
    expect(berechneVerpackung([pos, vers], vh, kondition, [ORIG, pos, vers]).anzahl).toBe(0);
  });
});

describe('Hinweise (Sync und Vorschau)', () => {
  test('Hinweistext nur mit Bestell- und Erstattungsnummer', () => {
    expect(erstattungHinweisText({ orderId: '900', refundId: '73', grund: 'ohne_position' }))
      .toBe('Bestellung 900 (Erstattung #73): Erstattung nur mit Betrag, ohne Position – bitte prüfen.');
    const { hinweise } = bauen([ORIG], [{ id: 73, date_created: '2026-08-20T09:00:00', line_items: [], shipping_lines: [] }]);
    expect(hinweise.map(h => h.grund)).toEqual(['ohne_position']);
  });
  test('Vorschau: Hinweise und noch nicht gebuchte Gegenbuchungen, nie sperrend', async () => {
    const laden = async () => ({ bestellungen: [{ order: ORDER, refunds: [refund(70, { menge: 1 }), { id: 73, date_created: '2026-08-20T09:00:00', line_items: [], shipping_lines: [] }] }] });
    const texte = await vorschauErstattungsHinweise({ wc: {}, orderIds: ['900'], verkaufStati: ['completed'], laden,
      orderVon: r => r[vh('WC-Bestellnummer')], rechne: b => buildFpErstattungRows({ vRows: [ORIG], vh, bestellungen: b, mwstFuer, stornoMarker: STORNO }) });
    expect(texte[0]).toMatch(/^1 Erstattungs-Gegenbuchung\(en\) noch nicht gebucht \(Bestellung 900\)/);
    expect(texte[1]).toMatch(/Erstattung #73/);
  });
  test('Vorschau: Shop nicht erreichbar oder Zugang fehlt = Hinweis statt Fehler', async () => {
    const laden = async () => ({ bestellungen: [], fehler: 'Shop zeigt die Hoster-Prüfseite' });
    expect(await vorschauErstattungsHinweise({ wc: {}, orderIds: ['1'], verkaufStati: [], laden, orderVon: () => '', rechne: () => ({ rows: [], hinweise: [] }) }))
      .toEqual(['Erstattungen nicht geprüft (Shop zeigt die Hoster-Prüfseite).']);
    expect(await vorschauErstattungsHinweise({ wc: () => { throw new Error('WC_KEY fehlt'); }, orderIds: ['1'], verkaufStati: [], orderVon: () => '', rechne: () => ({ rows: [], hinweise: [] }) }))
      .toEqual(['Erstattungen nicht geprüft (Shop-Zugang fehlt).']);
    expect(await vorschauErstattungsHinweise({ wc: {}, orderIds: [], verkaufStati: [], orderVon: () => '', rechne: () => ({ rows: [], hinweise: [] }) })).toEqual([]);
  });
});

describe('AUD1-Reste', () => {
  test('Zahl-Leser mit Tausenderpunkt', () => {
    expect(lizenzSatzAusZeile('1.234,50', '123,45')).toBe(10);
    expect(lizenzSatzAusZeile('', '5')).toBeNull();
    expect(verpackungsKondition({ Verpackung_je_Bestellung: '1.234,50', Verpackung_ab: '01.01.2026' }).betrag).toBe(1234.5);
    expect(verpackungsKondition({ Verpackung_je_Bestellung: '1,5', Verpackung_ab: '01.01.2026' }).betrag).toBe(1.5);
    expect(verpackungsKondition({ Verpackung_je_Bestellung: 'abc', Verpackung_ab: '01.01.2026' }).status).toBe('fehlt');
  });
  test('Wartungslauf findet nur Status "Neu"', () => {
    expect(neuZeilen([['Partner-ID', 'Status'], ['P-001', 'Neu'], ['P-002', 'offen'], ['P-003', 'Neu']]).zeilen)
      .toEqual([{ zeile: 2, partnerId: 'P-001' }, { zeile: 4, partnerId: 'P-003' }]);
  });
});
