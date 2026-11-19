// Abrechnung und Syncs ohne stille Luecken: Zahlen im deutschen Format, fehlende Fixkosten, Startpunkt mit
// Ueberlappung, Schluessel mit Positions-ID, Porto-Satz, "erst klaeren". Nur erfundene Werte.
import { parseDeZahl } from '../utils/zahl-de.js';
import { toFloat, verkaufsBestand, schonErfasst, syncStart, konfigJeTag, fixkostenLuecken, fixkostenFehler, buildStornoRows } from '../utils/sync-logic.js';
import { parseKonfiguration } from '../utils/partner-kalkulation.js';
import { berechnePorto, satzAus, PORTO_BESTELLUNG, PORTO_VERSANDART } from '../utils/festpreis-porto.js';
import { abrechnungKlaeren, klaerenAntwort } from '../utils/fp-abrechnung.js';
import { FIXKOSTEN_VOLL } from './hilfen/sheets-attrappe.js';

const parseDE = s => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s)); return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`) : null; };

describe('Zahlen im deutschen Format', () => {
  test.each([
    ['1.234,50', 1234.5], ['12,34 €', 12.34], ['-1.234,5', -1234.5], ['16.81', 16.81], ['0,8', 0.8], ['19', 19], [7.5, 7.5],
  ])('%p -> %p', (ein, aus) => expect(parseDeZahl(ein)).toBe(aus));
  test('leer/Text -> NaN; toFloat mit Rueckfall', () => {
    expect(parseDeZahl('')).toBeNaN();
    expect(toFloat('1.234,50')).toBe(1234.5);
    expect(toFloat('', 0)).toBe(0);
  });
});

describe('Fixkosten: fehlende Position wird gemeldet, Vergleich mit trim', () => {
  const kopf = FIXKOSTEN_VOLL[0];
  test('alle da -> fehlend leer; Feld nicht aufzaehlbar', () => {
    const k = parseKonfiguration(FIXKOSTEN_VOLL.slice(1), kopf, new Date('2026-05-01'));
    expect(k.fehlend).toEqual([]);
    expect(Object.keys(k)).not.toContain('fehlend');
  });
  test('Leerzeichen im Positionsnamen zaehlt', () => {
    const rows = FIXKOSTEN_VOLL.slice(1).map(r => (r[0] === 'Porto B' ? [' Porto B ', ...r.slice(1)] : r));
    expect(parseKonfiguration(rows, kopf, new Date('2026-05-01')).fehlend).toEqual([]);
  });
  test('Position fehlt bzw. erst spaeter gueltig -> in fehlend', () => {
    const rows = FIXKOSTEN_VOLL.slice(1).filter(r => r[0] !== 'Porto P').map(r => (r[0] === 'MwSt' ? ['MwSt', '19', '%', '01.07.2026', ''] : r));
    expect(parseKonfiguration(rows, kopf, new Date('2026-05-01')).fehlend).toEqual(['Porto P', 'MwSt']);
    expect(parseKonfiguration(rows, kopf, new Date('2026-08-01')).fehlend).toEqual(['Porto P']);
  });
  test('Luecken je Bestelltag -> 409 mit Position und Tag', () => {
    const rows = FIXKOSTEN_VOLL.slice(1).filter(r => r[0] !== 'PayPal Pauschale');
    const konfigFuer = konfigJeTag(d => parseKonfiguration(rows, kopf, d));
    const l = fixkostenLuecken(['2026-05-02', '2026-05-01', '2026-05-02'], konfigFuer);
    expect(l).toEqual([{ tag: '2026-05-01', fehlend: ['PayPal Pauschale'] }, { tag: '2026-05-02', fehlend: ['PayPal Pauschale'] }]);
    const e = fixkostenFehler(l);
    expect(e.status).toBe(409);
    expect(e.message).toMatch(/2026-05-01: PayPal Pauschale/);
  });
});

describe('Startpunkt und Schluessel', () => {
  test('neuestes Bestelldatum minus 14 Tage; leer -> null', () => {
    expect(syncStart([['01.11.2026'], ['18.11.2026'], ['x']], 0, parseDE)).toBe('2026-11-04T00:00:00');
    expect(syncStart([], 0, parseDE)).toBeNull();
  });

  const KOPF = ['Partner-ID', 'Order-ID', 'Artikelnummer', 'Variante', 'Storno-Status', 'Positions-ID'];
  const vh = c => KOPF.indexOf(c);
  const spalten = { bestellung: 'Order-ID', artikel: 'Artikelnummer' };
  const pos = (positionId, o = {}) => ({ orderId: '100', positionId, artikel: 'Shirt', variante: '7', partnerId: 'P-1', ...o });

  test('neue Zeilen: je Positions-ID, zwei gleiche Positionen = zwei', () => {
    const b = verkaufsBestand([KOPF], vh, spalten);
    expect(schonErfasst(b, pos(1))).toBe(false);
    expect(schonErfasst(b, pos(2))).toBe(false);
    expect(schonErfasst(b, pos(1))).toBe(true);
  });
  test('Altzeile ohne Positions-ID deckt die Position ab (kein automatisches Nachtragen)', () => {
    const b = verkaufsBestand([KOPF, ['P-1', '100', 'Shirt', '7', '', '']], vh, spalten);
    expect(schonErfasst(b, pos(1))).toBe(true);
    expect(schonErfasst(b, pos(2))).toBe(true);
    expect(schonErfasst(b, pos(3, { orderId: '101' }))).toBe(false);
  });
  test('Storno-Gegenbuchungen zaehlen nicht zum Bestand', () => {
    const b = verkaufsBestand([KOPF, ['P-1', '100', 'Shirt', '7', 'Storniert/Rückerstattet', '1']], vh, spalten);
    expect(schonErfasst(b, pos(1), false)).toBe(false);
  });
  test('ohne Positions-ID vom Shop: alter Schluessel', () => {
    const b = verkaufsBestand([KOPF], vh, spalten);
    expect(schonErfasst(b, pos(undefined))).toBe(false);
    expect(schonErfasst(b, pos(undefined))).toBe(true);
  });

  test('Gegenbuchung je Position', () => {
    const VK = ['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status',
      'Produkt-ID', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status', 'Positions-ID'];
    const z = p => ['P-1', '01.10.2026', '100', 'Shirt', '7', 1, 21, 3, 'offen', '5', 9, 3, 0, 3.57, '', p];
    const out = buildStornoRows([VK, z('801'), z('802')].slice(1), c => VK.indexOf(c), [{ id: 100, date_created: '2026-10-01' }], null);
    expect(out.map(r => r[VK.indexOf('Positions-ID')])).toEqual(['801', '802']);
    expect(buildStornoRows([z('801'), z('802'), ...out], c => VK.indexOf(c), [{ id: 100, date_created: '2026-10-01' }], null)).toEqual([]);
  });
});

describe('Porto: fehlender Satz zum Bestelldatum = nicht berechnet, Status fehlt', () => {
  const KOPF = ['Partner-ID', 'Datum', 'WC-Bestellnummer', 'Artikelname', 'Status Abrechnung', 'Storno-Status', 'Versandmethode', PORTO_BESTELLUNG, PORTO_VERSANDART];
  const vh = c => KOPF.indexOf(c);
  const z = (oid, datum) => ['FP-001', datum, oid, 'A', 'offen', '', 'flat_rate', 4, 'B'];
  test('Satz fehlt -> weder Einnahme noch Kosten, Hinweis', () => {
    const rows = FIXKOSTEN_VOLL.slice(1).filter(r => r[0] !== 'Porto B');
    const satz = satzAus(parseKonfiguration, rows, FIXKOSTEN_VOLL[0]);
    const r = berechnePorto([z('900', '05.08.2026')], vh, satz, [z('900', '05.08.2026')], { partnerId: 'FP-001' });
    expect(r).toMatchObject({ status: 'fehlt', fixkostenFehlen: ['900'], einnahmen: { anzahl: 0 }, kosten: { anzahl: 0 }, saldo: 0 });
    expect(r.hinweise.join(' ')).toMatch(/Porto-Satz fehlt/);
  });
});

describe('Erst klaeren', () => {
  test('Punkte je Art, 409-Antwort', () => {
    const p = abrechnungKlaeren({
      porto: { unbekannt: ['901'], fixkostenFehlen: [] }, verpackung: { status: 'fehlt', hinweise: ['Wert fehlt.'] },
      interneOhneSumme: [{ datum: '01.10.2026', bezeichnung: 'Eigenauftrag' }], fixkostenFehlen: ['MwSt'],
      bestellLink: id => `https://shop.example.test/wp-admin/post.php?post=${id}&action=edit`,
    });
    expect(p.map(x => x.art)).toEqual(['porto_versandart', 'verpackung', 'intern_ohne_preis', 'fixkosten']);
    expect(p[0].text).toMatch(/Versandart fehlt – erst klären/);
    expect(p[0].eintraege[0]).toEqual({ bestellung: '901', link: 'https://shop.example.test/wp-admin/post.php?post=901&action=edit' });
    expect(klaerenAntwort(p)).toMatchObject({ status: 409, body: { code: 'erst_klaeren' } });
  });
  test('nichts offen -> leer', () => {
    expect(abrechnungKlaeren({ porto: { status: 'ok', unbekannt: [], fixkostenFehlen: [] }, verpackung: { status: 'ok' } })).toEqual([]);
  });
});
