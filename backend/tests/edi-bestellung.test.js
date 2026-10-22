// BO4a: L-Shop-EDI-Bestelldatei - reine Logik (utils/edi-bestellung.js).
// Aufbau, Pflichtfelder, CDATA/Sonderzeichen, Feldlaengen an der Grenze, keine Adressbloecke,
// Pruefbericht je Regel rot/gruen, order_id-Zaehler, Datum/Dateiname/KW in Europe/Berlin,
// strenger Rueckleser. Alle Nummern sind Platzhalter.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  baueBestellXml, leseBestellXml, pruefeBestellXml, xmlText, ediPruefung, naechsteOrderId, platzhalterOrderId,
  ediDatum, ediDateiname, kalenderwoche, standardCommission, nachBestellschluss, referenzFuer, ediSpalten,
  EDI_REGELN, EDI_SPALTEN, EDI_KOPF_FEST,
} from '../utils/edi-bestellung.js';

const hier = dirname(fileURLToPath(import.meta.url));
const NR = '1000000001', NR2 = '1000000002', NR_AUS = '1000000003', NR_DISC = '1000000006';
const VORMITTAG = new Date('2026-10-22T08:00:00Z');   // 10:00 Berlin
const NACHMITTAG = new Date('2026-10-22T13:30:00Z');  // 15:30 Berlin

const kopf = (o = {}) => ({ customer_id: '00000000', order_date: '22.10.2026', delivery_date: '22.10.2026', order_id: 'JFN-2026-0002', commission: 'JFN Sammelbestellung KW43', ...o });
const item = (o = {}) => ({ itemnumber: NR, reference: 'JFN-10001-1', quantity: '1', ...o });

const modelle = new Map([
  [NR, { articleNr: NR, catalogNr: 'E3000', color1: 'Black', size: 'XXL', status: 'aktiv', discontinued: '0' }],
  [NR2, { articleNr: NR2, catalogNr: 'MRS5004', color1: 'White', color2: 'Green', size: '32/36', status: 'aktiv', discontinued: '' }],
  [NR_AUS, { articleNr: NR_AUS, catalogNr: 'X', status: 'ausgelaufen', discontinued: '0' }],
  [NR_DISC, { articleNr: NR_DISC, catalogNr: 'Y', status: 'aktiv', discontinued: '6' }],
]);
let n = 0;
const zeile = (o = {}) => ({ Schluessel: `JFN:${10000 + ++n}:1`, Shop: 'JFN', Herkunft: 'shop', Bestellnummer: String(10000 + n), Position: '1',
  Referenz: '', LShop_ArticleNr: NR, Menge: '1', Status: 'offen', Hinweis: '', ...o });
const pruefe = (zeilen, o = {}) => ediPruefung({
  auswahl: zeilen.map(z => ({ schluessel: z.Schluessel, status: z.Status })), zeilen, modelle,
  customerId: '00000000', commission: 'JFN Sammelbestellung KW43', orderId: 'JFN-2026-0002', jetzt: VORMITTAG, ...o,
});
const rot = (r, regel) => r.punkte.find(p => p.regel === regel);

describe('baueBestellXml', () => {
  test('Aufbau order -> orderheader -> orderitems -> item, erste Zeile Deklaration, Kopf in fester Reihenfolge', () => {
    const xml = baueBestellXml({ kopf: kopf(), items: [item(), item({ itemnumber: NR2, reference: 'JFN-10002-1', quantity: '3' })] });
    expect(xml.split('\n')[0]).toBe('<?xml version="1.0" encoding="UTF-8"?>');
    const w = leseBestellXml(xml);
    expect(w.name).toBe('order');
    expect(w.kinder.map(k => k.name)).toEqual(['orderheader', 'orderitems']);
    expect(w.kinder[0].kinder.map(k => k.name)).toEqual(
      ['customer_id', 'order_date', 'delivery_date', 'order_id', 'commission', 'shipping_method', 'partial_delivery', 'mail', 'printmode']);
    const wert = name => w.kinder[0].kinder.find(k => k.name === name).text;
    expect([wert('shipping_method'), wert('partial_delivery'), wert('mail'), wert('printmode')]).toEqual(['Standard', '-1', 'info@jammifashion.de', '0']);
    expect(wert('order_date')).toBe(wert('delivery_date'));
    expect(w.kinder[1].kinder.map(i => i.kinder.map(k => `${k.name}=${k.text}`))).toEqual([
      [`itemnumber=${NR}`, 'reference=JFN-10001-1', 'quantity=1'], [`itemnumber=${NR2}`, 'reference=JFN-10002-1', 'quantity=3'],
    ]);
    expect(pruefeBestellXml(xml)).toEqual([]);
  });

  test('gleiche itemnumber darf mehrfach vorkommen (eine Zeile je Korb-Position)', () => {
    const xml = baueBestellXml({ kopf: kopf(), items: [item(), item({ reference: 'JFN-10009-2' })] });
    expect(leseBestellXml(xml).kinder[1].kinder).toHaveLength(2);
  });

  test('additional_information und Adressbloecke kommen nie vor; commission leer -> weggelassen', () => {
    const xml = baueBestellXml({ kopf: kopf({ commission: '' }), items: [item()] });
    expect(xml).not.toMatch(/additional_information|shippingaddress|senderaddress/);
    expect(xml).not.toMatch(/<commission>/);
    expect(pruefeBestellXml(xml)).toEqual([]);
  });

  test('Quelltext des Moduls kennt keine Adressbloecke, kein Netz, kein FTP (Code ohne Kommentare)', () => {
    const code = readFileSync(resolve(hier, '../utils/edi-bestellung.js'), 'utf8')
      .split('\n').filter(z => !z.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/<shippingaddress|<senderaddress|'shippingaddress'|'senderaddress'/);
    expect(code).not.toMatch(/fetch\(|ftp|getWcClient|https?:\/\/|import .*(http|net|ssh)/i);
  });

  test('Sonderzeichen in CDATA, "]]>" sicher geteilt, einfacher Text roh', () => {
    expect(xmlText('JFN-10001-1')).toBe('JFN-10001-1');
    expect(xmlText('Crocodiles Fluffy & Co <1>')).toBe('<![CDATA[Crocodiles Fluffy & Co <1>]]>');
    expect(xmlText('Größe')).toBe('<![CDATA[Größe]]>');
    const xml = baueBestellXml({ kopf: kopf({ commission: 'A]]>B & Ü' }), items: [item({ reference: 'Lager <Regal 3>' })] });
    const w = leseBestellXml(xml);
    expect(w.kinder[0].kinder.find(k => k.name === 'commission').text).toBe('A]]>B & Ü');
    expect(w.kinder[1].kinder[0].kinder.find(k => k.name === 'reference').text).toBe('Lager <Regal 3>');
    expect(() => xmlText('a\nb')).toThrow(/Steuerzeichen/);
  });

  test('ungueltige Zahlen werfen statt still zu schreiben', () => {
    expect(() => baueBestellXml({ kopf: kopf(), items: [item({ itemnumber: '123' })] })).toThrow(/itemnumber/);
    expect(() => baueBestellXml({ kopf: kopf(), items: [item({ quantity: '0' })] })).toThrow(/quantity/);
    expect(() => baueBestellXml({ kopf: kopf(), items: [item({ quantity: '1.5' })] })).toThrow(/quantity/);
    expect(() => baueBestellXml({ kopf: kopf({ order_date: '2026-10-22' }), items: [item()] })).toThrow(/order_date/);
  });
});

describe('leseBestellXml / pruefeBestellXml (strenger Rueckleser)', () => {
  const gut = () => baueBestellXml({ kopf: kopf(), items: [item()] });
  test.each([
    ['ohne Deklaration', x => x.replace(/^<\?xml[^\n]*\n/, '')],
    ['falsches End-Tag', x => x.replace('</order>', '</orders>')],
    ['offenes Tag', x => x.replace('</orderitems>', '')],
    ['unmaskiertes &', x => x.replace('JFN-10001-1', 'A & B')],
    ['Inhalt nach der Wurzel', x => `${x}<x></x>`],
    ['Attribut', x => x.replace('<order>', '<order a="1">')],
  ])('%s -> Fehler', (_n, kaputt) => {
    expect(pruefeBestellXml(kaputt(gut())).length).toBeGreaterThan(0);
  });
  test('Adressblock wird erkannt', () => {
    expect(pruefeBestellXml(gut().replace('  <orderitems>', '  <shippingaddress></shippingaddress>\n  <orderitems>'))).toEqual(
      expect.arrayContaining(['Adressblock enthalten']));
  });
});

describe('ediPruefung', () => {
  test('alles gut -> gruen, Positionen mit Referenz <Shop>-<Bestellnr>-<Pos>', () => {
    const z = [zeile(), zeile({ LShop_ArticleNr: NR2, Menge: '3' })];
    const r = pruefe(z);
    expect(r.gruen).toBe(true);
    expect(r.punkte.filter(p => p.stufe !== 'info').every(p => p.ok)).toBe(true);
    expect(r.items.map(i => [i.itemnumber, i.reference, i.quantity])).toEqual([[NR, `JFN-${z[0].Bestellnummer}-1`, '1'], [NR2, `JFN-${z[1].Bestellnummer}-1`, '3']]);
    expect(r.items[1]).toMatchObject({ modell: 'MRS5004', farbe: 'White/Green', groesse: '32/36' });
    expect(r.stueck).toBe(4);
    expect(r.punkte.map(p => p.regel)).toEqual(EDI_REGELN.map(x => x.id));
  });

  test.each([
    ['customer_id fehlt', [zeile()], { customerId: '' }, 'customer_id'],
    ['customer_id 9 Zeichen', [zeile()], { customerId: '123456789' }, 'customer_id'],
    ['keine Auswahl', [], {}, 'auswahl'],
    ['Status abgewaehlt', [zeile({ Status: 'abgewählt' })], {}, 'vorhanden'],
    ['Shop HONK', [zeile({ Shop: 'HONK' })], {}, 'shop'],
    ['Shop unbekannt', [zeile({ Shop: 'XYZ' })], {}, 'shop'],
    ['storniert', [zeile({ Hinweis: 'Bestellung storniert' })], {}, 'hinweis'],
    ['ArticleNr 9-stellig', [zeile({ LShop_ArticleNr: '100000001' })], {}, 'artikel'],
    ['ArticleNr unbekannt', [zeile({ LShop_ArticleNr: '1000999999' })], {}, 'artikel'],
    ['ausgelaufen', [zeile({ LShop_ArticleNr: NR_AUS })], {}, 'artikel'],
    ['Discontinued 6', [zeile({ LShop_ArticleNr: NR_DISC })], {}, 'artikel'],
    ['Menge 0', [zeile({ Menge: '0' })], {}, 'menge'],
    ['Menge 1,5', [zeile({ Menge: '1,5' })], {}, 'menge'],
    ['Menge 9 Stellen', [zeile({ Menge: '123456789' })], {}, 'menge'],
    ['eigene Referenz leer', [zeile({ Herkunft: 'eigen', Referenz: '' })], {}, 'reference'],
    ['eigene Referenz 66 Zeichen', [zeile({ Herkunft: 'eigen', Referenz: 'R'.repeat(66) })], {}, 'reference'],
    ['commission 31 Zeichen', [zeile()], { commission: 'C'.repeat(31) }, 'commission'],
    ['commission mit @', [zeile()], { commission: 'an x@y' }, 'commission'],
    ['commission mit Umbruch', [zeile()], { commission: 'a\nb' }, 'commission'],
    ['order_id leer', [zeile()], { orderId: '' }, 'order_id'],
    ['order_id nicht ASCII', [zeile()], { orderId: 'JFN-2026-000ä' }, 'order_id'],
  ])('%s -> rot, nicht gruen', (_n, zeilen, o, regel) => {
    const r = pruefe(zeilen, o);
    expect(rot(r, regel)).toMatchObject({ ok: false, stufe: 'rot' });
    expect(r.gruen).toBe(false);
  });

  test('Grenzen genau: customer_id 8, commission 30, reference 65, Menge 8 Stellen -> gruen', () => {
    const r = pruefe([zeile({ Herkunft: 'eigen', Referenz: 'R'.repeat(65), Menge: '12345678' })], { customerId: '12345678', commission: 'C'.repeat(30) });
    expect(r.gruen).toBe(true);
  });

  test('Status geaendert seit dem Lesen -> rot mit Hinweis neu laden; doppelt gewaehlt -> rot', () => {
    const z = zeile();
    const r = ediPruefung({ auswahl: [{ schluessel: z.Schluessel, status: 'abgewählt' }], zeilen: [z], modelle, customerId: '1', commission: '', orderId: 'JFN-2026-0002', jetzt: VORMITTAG });
    expect(rot(r, 'vorhanden').treffer[0].text).toMatch(/neu laden/);
    const d = ediPruefung({ auswahl: [{ schluessel: z.Schluessel, status: 'offen' }, { schluessel: z.Schluessel, status: 'offen' }], zeilen: [z], modelle, customerId: '1', commission: '', orderId: 'JFN-2026-0002', jetzt: VORMITTAG });
    expect(rot(d, 'auswahl').ok).toBe(false);
    expect(d.items).toHaveLength(1);
  });

  test('unbezahlt -> gelb, sperrt nicht; nach 14 Uhr -> nur Hinweis', () => {
    const r = pruefe([zeile({ Hinweis: 'Menge im Shop geändert · noch nicht bezahlt' })], { jetzt: NACHMITTAG });
    expect(rot(r, 'unbezahlt')).toMatchObject({ ok: false, stufe: 'gelb' });
    expect(rot(r, 'bestellschluss')).toMatchObject({ ok: false, stufe: 'info' });
    expect(r.gruen).toBe(true);
    expect(rot(pruefe([zeile()]), 'bestellschluss').ok).toBe(true);
  });

  test('eigene Position: Referenz ist ihre Referenz; leere Shop-Zelle zaehlt als JFN', () => {
    const r = pruefe([zeile({ Herkunft: 'eigen', Referenz: 'Lager Nachkauf', Shop: '' })]);
    expect(r.gruen).toBe(true);
    expect(r.items[0].reference).toBe('Lager Nachkauf');
    expect(referenzFuer({ Herkunft: 'shop', Shop: 'JFN', Bestellnummer: '21634', Position: '4333' })).toBe('JFN-21634-4333');
  });

  test('Pruefbericht und Positionen enthalten keine Kundenfelder', () => {
    const r = pruefe([zeile({ Kunde: 'Max Muster' })]);
    expect(JSON.stringify(r)).not.toMatch(/Muster/);
  });
});

describe('order_id, Datum, Dateiname, Kalenderwoche', () => {
  test('naechsteOrderId: 0001 -> 0002, Luecken, anderes Jahr, fremde Werte', () => {
    expect(naechsteOrderId(['JFN-2026-0001'], 2026)).toBe('JFN-2026-0002');
    expect(naechsteOrderId(['JFN-2026-0001', 'JFN-2026-0007', 'JFN-2026-0003'], 2026)).toBe('JFN-2026-0008');
    expect(naechsteOrderId(['JFN-2026-0009'], 2027)).toBe('JFN-2027-0001');
    expect(naechsteOrderId(['', 'Notiz', 'JFN-2026-12', 'HONK-2026-0005'], 2026)).toBe('JFN-2026-0001');
    expect(() => naechsteOrderId(['JFN-2026-9999'], 2026)).toThrow(/erschoepft/);
    expect(platzhalterOrderId(2026)).toBe('JFN-2026-____');
  });

  test('Datum und Dateiname in Europe/Berlin (auch ueber Mitternacht UTC)', () => {
    expect(ediDatum(VORMITTAG)).toBe('22.10.2026');
    expect(ediDatum(new Date('2026-10-21T22:30:00Z'))).toBe('22.10.2026');
    expect(ediDateiname('JFN-2026-0002', new Date('2026-10-22T12:00:00Z'))).toBe('JFN-2026-0002_20261022-1400.xml');
  });

  test('Kalenderwoche ISO (Berlin) und Standard-Commission', () => {
    expect(kalenderwoche(VORMITTAG)).toBe(43);
    expect(kalenderwoche(new Date('2026-01-01T12:00:00Z'))).toBe(1);
    expect(kalenderwoche(new Date('2027-01-01T12:00:00Z'))).toBe(53);
    expect(standardCommission(VORMITTAG)).toBe('JFN Sammelbestellung KW43');
    expect(standardCommission(VORMITTAG).length).toBeLessThanOrEqual(30);
    expect(nachBestellschluss(new Date('2026-10-22T11:59:00Z'))).toBe(false);   // 13:59 Berlin
    expect(nachBestellschluss(new Date('2026-10-22T12:00:00Z'))).toBe(true);    // 14:00 Berlin
  });

  test('Protokoll-Spalten nur ueber den Namen; fehlende -> 422', () => {
    expect(ediSpalten([...EDI_SPALTEN].reverse()).order_id).toBe(EDI_SPALTEN.length - 1);
    expect(() => ediSpalten(['order_id'])).toThrow(expect.objectContaining({ status: 422 }));
    expect(EDI_KOPF_FEST).toEqual({ shipping_method: 'Standard', partial_delivery: '-1', mail: 'info@jammifashion.de', printmode: '0' });
  });
});
