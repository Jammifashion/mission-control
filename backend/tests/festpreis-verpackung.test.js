import {
  berechneVerpackung, verpackungsKondition, versandArt, versandmethodeAus, verpackungsZeile,
  VERPACKUNG_BETRAG, VERPACKUNG_AB, OHNE_VERSAND,
} from '../utils/festpreis-verpackung.js';

// Testbetrag frei gewählt, keine Partnerkondition
const KOPF = ['Partner-ID', 'Datum', 'WC-Bestellnummer', 'Artikelname', 'Stückzahl', 'Status Abrechnung', 'Storno-Status', 'Versandmethode'];
const vh = col => KOPF.indexOf(col);
const z = (datum, oid, methode, storno = '') => ['FP-001', datum, oid, 'Artikel', storno ? -1 : 1, 'offen', storno, methode];
const OK = verpackungsKondition({ [VERPACKUNG_BETRAG]: '2,50', [VERPACKUNG_AB]: '01.04.2026' });

describe('verpackungsKondition', () => {
  test('Betrag + Datum -> ok', () => {
    expect(OK.status).toBe('ok');
    expect(OK.betrag).toBe(2.5);
  });
  test('leerer Betrag -> fehlt (nie 0 annehmen)', () => {
    expect(verpackungsKondition({ [VERPACKUNG_AB]: '01.04.2026' }).status).toBe('fehlt');
    expect(verpackungsKondition({}).status).toBe('fehlt');
  });
  test('Betrag ohne Datum oder kaputt -> fehlt', () => {
    expect(verpackungsKondition({ [VERPACKUNG_BETRAG]: '2' }).status).toBe('fehlt');
    expect(verpackungsKondition({ [VERPACKUNG_BETRAG]: '2', [VERPACKUNG_AB]: '2026-04-01' }).status).toBe('fehlt');
    expect(verpackungsKondition({ [VERPACKUNG_BETRAG]: 'zwei', [VERPACKUNG_AB]: '01.04.2026' }).status).toBe('fehlt');
    expect(verpackungsKondition({ [VERPACKUNG_BETRAG]: '-1', [VERPACKUNG_AB]: '01.04.2026' }).status).toBe('fehlt');
  });
  test('"nein" = bewusst keine, 0 = bewusst 0', () => {
    expect(verpackungsKondition({ [VERPACKUNG_BETRAG]: 'Nein' }).status).toBe('keine');
    const null0 = verpackungsKondition({ [VERPACKUNG_BETRAG]: '0', [VERPACKUNG_AB]: '01.04.2026' });
    expect(null0.status).toBe('ok');
    expect(null0.betrag).toBe(0);
  });
});

describe('versandArt / versandmethodeAus', () => {
  test('local_pickup (Stadion, Wrist) = Abholung, sonst versendet', () => {
    expect(versandArt('local_pickup')).toBe('abholung');
    expect(versandArt('pickup_location')).toBe('abholung');
    expect(versandArt('flat_rate')).toBe('versendet');
    expect(versandArt('free_shipping')).toBe('versendet');
    expect(versandArt(OHNE_VERSAND)).toBe('ohne_versand');
    expect(versandArt('')).toBe('unbekannt');
  });
  test('method_id der ersten Versandzeile', () => {
    expect(versandmethodeAus({ shipping_lines: [{ method_id: 'local_pickup', instance_id: '6' }] })).toBe('local_pickup');
    expect(versandmethodeAus({ shipping_lines: [] })).toBe(OHNE_VERSAND);
  });
});

describe('berechneVerpackung', () => {
  test('je Bestellung einmal, nicht je Artikel (gemischte Bestellung = 1)', () => {
    const zeilen = [z('02.04.2026', 100, 'flat_rate'), z('02.04.2026', 100, 'flat_rate'), z('03.04.2026', 101, 'free_shipping')];
    const v = berechneVerpackung(zeilen, vh, OK);
    expect(v.status).toBe('ok');
    expect(v.anzahl).toBe(2);
    expect(v.summe).toBe(5);
  });
  test('Abholung zählt nicht', () => {
    const v = berechneVerpackung([z('02.04.2026', 100, 'local_pickup'), z('02.04.2026', 101, 'flat_rate')], vh, OK);
    expect(v.anzahl).toBe(1);
    expect(v.abholung).toBe(1);
  });
  test('storniert im selben Zeitraum = 0', () => {
    const zeilen = [z('02.04.2026', 100, 'flat_rate'), z('05.04.2026', 100, 'flat_rate', 'Storniert/Rückerstattet')];
    expect(berechneVerpackung(zeilen, vh, OK).anzahl).toBe(0);
  });
  test('Storno in späterer Abrechnung = −1, Methode/Datum aus der Originalzeile', () => {
    const orig = z('02.04.2026', 100, 'flat_rate');
    const storno = z('05.05.2026', 100, '', 'Storniert/Rückerstattet');
    const v = berechneVerpackung([storno], vh, OK, [orig, storno]);
    expect(v.status).toBe('ok');
    expect(v.anzahl).toBe(-1);
  });
  test('vor "gültig ab" zählt nicht, Grenze inklusive', () => {
    const v = berechneVerpackung([z('31.03.2026', 99, 'flat_rate'), z('01.04.2026', 100, 'flat_rate')], vh, OK);
    expect(v.anzahl).toBe(1);
    expect(v.vorAb).toBe(1);
  });
  test('fehlender Wert -> nicht berechnet + Hinweis', () => {
    const v = berechneVerpackung([z('02.04.2026', 100, 'flat_rate')], vh, verpackungsKondition({}));
    expect(v.status).toBe('fehlt');
    expect(v.summe).toBeNull();
    expect(v.hinweise[0]).toMatch(/nicht berechnet/);
  });
  test('fehlende Versandmethode -> nicht berechnet + Hinweis', () => {
    const v = berechneVerpackung([z('02.04.2026', 100, ''), z('02.04.2026', 101, 'flat_rate')], vh, OK);
    expect(v.status).toBe('fehlt');
    expect(v.unbekannt).toEqual(['100']);
  });
  test('ohne Versandzeile zählt nicht, mit Hinweis', () => {
    const v = berechneVerpackung([z('02.04.2026', 100, OHNE_VERSAND)], vh, OK);
    expect(v.anzahl).toBe(0);
    expect(v.hinweise.length).toBe(1);
  });
  test('Kondition "keine" -> keine Zeile', () => {
    const v = berechneVerpackung([z('02.04.2026', 100, 'flat_rate')], vh, { status: 'keine' });
    expect(v.status).toBe('keine');
    expect(verpackungsZeile(v)).toBe('');
  });
  test('Zeilentext', () => {
    const v = berechneVerpackung([z('02.04.2026', 100, 'flat_rate')], vh, OK);
    expect(verpackungsZeile(v)).toBe('Verpackungspauschale: 1 Bestellungen × 2,50 € = 2,50 € (brutto)');
  });
});
