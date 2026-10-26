// BO4a/BO4e: L-Shop-EDI-Bestelldatei - reine Logik (utils/edi-bestellung.js). BO4e: Versandart, CDATA immer,
// kein delivery_date, Plan fuer "Als gesendet markieren", Entwuerfe.
// Aufbau, Pflichtfelder, CDATA/Sonderzeichen, Feldlaengen an der Grenze, keine Adressbloecke,
// Pruefbericht je Regel rot/gruen, order_id-Zaehler, Datum/Dateiname/KW in Europe/Berlin,
// strenger Rueckleser. Alle Nummern sind Platzhalter.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  baueBestellXml, leseBestellXml, pruefeBestellXml, xmlText, ediPruefung, naechsteOrderId, platzhalterOrderId,
  ediDatum, ediDateiname, kalenderwoche, standardCommission, nachBestellschluss, referenzFuer, ediSpalten,
  EDI_REGELN, EDI_SPALTEN, EDI_KOPF_FEST, VERSANDARTEN, versandartVorgabe, nachExpressSchluss, cdata, gesendetPlan, entwuerfeAus,
} from '../utils/edi-bestellung.js';

const hier = dirname(fileURLToPath(import.meta.url));
const NR = '1000000001', NR2 = '1000000002', NR_AUS = '1000000003', NR_DISC = '1000000006';
const VORMITTAG = new Date('2026-10-22T08:00:00Z');   // 10:00 Berlin
const NACHMITTAG = new Date('2026-10-22T13:30:00Z');  // 15:30 Berlin

const kopf = (o = {}) => ({ customer_id: '00000000', order_date: '22.10.2026', order_id: 'JFN-2026-0002', commission: 'JFN Sammelbestellung KW43', shipping_method: 'Standard', ...o });
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
  customerId: '00000000', commission: 'JFN Sammelbestellung KW43', orderId: 'JFN-2026-0002', versandart: 'Standard', jetzt: VORMITTAG, ...o,
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
      ['customer_id', 'order_date', 'order_id', 'commission', 'shipping_method', 'partial_delivery', 'mail', 'printmode']);   // BO4e: ohne delivery_date
    const wert = name => w.kinder[0].kinder.find(k => k.name === name).text;
    expect([wert('shipping_method'), wert('partial_delivery'), wert('mail'), wert('printmode')]).toEqual(['Standard', '-1', 'info@jammifashion.de', '0']);
    expect(wert('order_date')).toBe('22.10.2026');
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
    ['unmaskiertes &', x => x.replace('<printmode>0', '<printmode>A & B')],
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
    expect(EDI_KOPF_FEST).toEqual({ partial_delivery: '-1', mail: 'info@jammifashion.de', printmode: '0' });   // BO4e: Versandart waehlbar
  });
});

// ── BO4e ─────────────────────────────────────────────────────────────────────

describe('BO4e: Versandart', () => {
  test('nur Codes der Guideline, max. 15 Zeichen; Vorgabe aus Config: leer -> Standard, unbekannt -> Standard + Hinweis', () => {
    expect(VERSANDARTEN.map(v => v.code)).toEqual(['Standard', 'Abholung', 'DHL', 'GLS', 'DPD', 'UPS', 'EX007', 'EX011', 'EX008', 'EX009', 'EX010']);
    expect(VERSANDARTEN.every(v => v.code.length <= 15 && v.name)).toBe(true);
    expect(versandartVorgabe('')).toEqual({ code: 'Standard', hinweis: '' });
    expect(versandartVorgabe(' GLS ')).toEqual({ code: 'GLS', hinweis: '' });
    expect(versandartVorgabe('gls').code).toBe('Standard');
    expect(versandartVorgabe('Hermes').hinweis).toMatch(/lshop\.shipping_method = "Hermes" ist unbekannt/);
  });

  test('unbekannter Code -> rot; Vorgabe-Hinweis -> gelb, sperrt nicht', () => {
    for (const va of ['Hermes', '', 'standard', 'EX012']) {
      const r = pruefe([zeile()], { versandart: va });
      expect(rot(r, 'versandart')).toMatchObject({ ok: false, stufe: 'rot' });
      expect(r.gruen).toBe(false);
    }
    const g = pruefe([zeile()], { versandartHinweis: 'Config lshop.shipping_method = "x" ist unbekannt' });
    expect(rot(g, 'versandart_config')).toMatchObject({ ok: false, stufe: 'gelb' });
    expect(g.gruen).toBe(true);
  });

  test('Express: vor 13:30 Berlin Hinweis, ab 13:30 gelb (Sommer- und Winterzeit); Abholung gelb', () => {
    const um = iso => pruefe([zeile()], { versandart: 'EX007', jetzt: new Date(iso) });
    expect(rot(um('2026-10-22T11:29:00Z'), 'express')).toMatchObject({ ok: false, stufe: 'info' });   // 13:29 MESZ
    expect(rot(um('2026-10-22T11:29:00Z'), 'express_spaet').ok).toBe(true);
    expect(rot(um('2026-10-22T11:30:00Z'), 'express_spaet')).toMatchObject({ ok: false, stufe: 'gelb' }); // 13:30 MESZ
    expect(rot(um('2026-11-02T12:29:00Z'), 'express_spaet').ok).toBe(true);                            // 13:29 MEZ
    expect(rot(um('2026-11-02T12:30:00Z'), 'express_spaet').ok).toBe(false);
    expect(um('2026-11-02T12:30:00Z').gruen).toBe(true);
    expect(nachExpressSchluss(new Date('2026-10-22T11:30:00Z'))).toBe(true);
    const a = pruefe([zeile()], { versandart: 'Abholung' });
    expect(rot(a, 'abholung')).toMatchObject({ ok: false, stufe: 'gelb' });
    expect(a.gruen).toBe(true);
    expect(rot(pruefe([zeile()], { versandart: 'DHL' }), 'express').ok).toBe(true);
  });

  test('Code in die Datei, ohne CDATA; ungueltiger Code wirft', () => {
    const xml = baueBestellXml({ kopf: kopf({ shipping_method: 'EX009' }), items: [item()] });
    expect(xml).toContain('<shipping_method>EX009</shipping_method>');
    expect(() => baueBestellXml({ kopf: kopf({ shipping_method: 'UPS Express' }), items: [item()] })).toThrow(/shipping_method/);
    expect(pruefeBestellXml(xml.replace('EX009', 'Hermes'))).toEqual(expect.arrayContaining(['shipping_method "Hermes" nicht erlaubt']));
  });
});

describe('BO4e: CDATA und delivery_date', () => {
  test('order_id, commission, reference, mail immer in CDATA - auch ohne Sonderzeichen', () => {
    const xml = baueBestellXml({ kopf: kopf(), items: [item()] });
    expect(xml).toContain('<order_id><![CDATA[JFN-2026-0002]]></order_id>');
    expect(xml).toContain('<commission><![CDATA[JFN Sammelbestellung KW43]]></commission>');
    expect(xml).toContain('<reference><![CDATA[JFN-10001-1]]></reference>');
    expect(xml).toContain('<mail><![CDATA[info@jammifashion.de]]></mail>');
    for (const roh of ['<customer_id>00000000<', '<order_date>22.10.2026<', '<shipping_method>Standard<', '<partial_delivery>-1<', '<printmode>0<', `<itemnumber>${NR}<`, '<quantity>1<']) {
      expect(xml).toContain(roh);
    }
  });

  test('&, <, ä und ]]> in allen vier Textfeldern; Rueckleser liefert den Text unveraendert', () => {
    const txt = 'A]]>B & <ä>';
    const xml = baueBestellXml({ kopf: kopf({ order_id: txt, commission: txt }), items: [item({ reference: txt })] });
    expect(xml).toContain('<![CDATA[A]]]]><![CDATA[>B & <ä>]]>');
    const w = leseBestellXml(xml);
    const k = name => w.kinder[0].kinder.find(x => x.name === name).text;
    expect([k('order_id'), k('commission'), w.kinder[1].kinder[0].kinder.find(x => x.name === 'reference').text]).toEqual([txt, txt, txt]);
    expect(cdata('x')).toBe('<![CDATA[x]]>');
    expect(() => cdata('a\nb')).toThrow(/Steuerzeichen/);
  });

  test('kein delivery_date: nicht in der Datei, nicht im Builder, Rueckleser meldet es', () => {
    const xml = baueBestellXml({ kopf: kopf({ delivery_date: '22.10.2026' }), items: [item()] });
    expect(xml).not.toContain('delivery_date');
    const code = readFileSync(resolve(hier, '../utils/edi-bestellung.js'), 'utf8');
    const builder = code.slice(code.indexOf('export function baueBestellXml'), code.indexOf('export function leseBestellXml'));
    expect(builder.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain("'delivery_date'");
    expect(pruefeBestellXml(xml.replace('<order_id>', '<delivery_date>22.10.2026</delivery_date>\n    <order_id>'))).toEqual(
      expect.arrayContaining(['delivery_date enthalten (seit BO4e weggelassen)']));
  });
});

describe('BO4e: Als gesendet markieren (Plan)', () => {
  const kopfEdi = EDI_SPALTEN;
  const ediZ = (id, status, schluessel) => kopfEdi.map(n => ({ order_id: id, Status: status, Korb_Schluessel: schluessel, Positionen: '2', Stueck: '3', Erzeugt: '2026-10-26T10:00:00Z', Versandart: 'GLS' }[n] ?? ''));
  const ediWerte = [kopfEdi, ediZ('JFN-2026-0001', 'Testdatei', ''), ediZ('JFN-2026-0002', 'Entwurf', 'JFN:1:1 JFN:2:1'), ediZ('JFN-2026-0003', 'gesendet', 'JFN:3:1')];
  const kz = (s, st, z) => ({ Schluessel: s, Status: st, _zeile: z });
  const JETZT = '2026-10-26T12:00:00.000Z';

  test('Entwurf mit offenen Positionen -> genau EDI Status/Gesendet + je Position Status/Bestell_ID/Status_Datum/Stand', () => {
    const p = gesendetPlan({ ediWerte, korbZeilen: [kz('JFN:1:1', 'offen', 5), kz('JFN:2:1', 'offen', 9), kz('JFN:9:9', 'offen', 12)], orderId: 'JFN-2026-0002', jetzt: JETZT });
    expect(p.ediZeile).toBe(3);
    expect(p.edi).toEqual({ Status: 'gesendet', Gesendet: JETZT });
    expect(p.korb).toEqual([
      { zeile: 5, schluessel: 'JFN:1:1', werte: { Status: 'bestellt', Bestell_ID: 'JFN-2026-0002', Status_Datum: JETZT, Stand: JETZT } },
      { zeile: 9, schluessel: 'JFN:2:1', werte: { Status: 'bestellt', Bestell_ID: 'JFN-2026-0002', Status_Datum: JETZT, Stand: JETZT } },
    ]);
  });

  test('nur Entwurf; Position nicht offen oder weg -> Fehler mit Liste, kein Plan', () => {
    const korb = [kz('JFN:1:1', 'offen', 5), kz('JFN:2:1', 'abgewählt', 9)];
    expect(() => gesendetPlan({ ediWerte, korbZeilen: korb, orderId: 'JFN-2026-0003', jetzt: JETZT })).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => gesendetPlan({ ediWerte, korbZeilen: korb, orderId: 'JFN-2026-0001', jetzt: JETZT })).toThrow(/Testdatei/);
    expect(() => gesendetPlan({ ediWerte, korbZeilen: korb, orderId: 'JFN-2026-0099', jetzt: JETZT })).toThrow(expect.objectContaining({ status: 404 }));
    let e;
    try { gesendetPlan({ ediWerte, korbZeilen: korb, orderId: 'JFN-2026-0002', jetzt: JETZT }); } catch (x) { e = x; }
    expect(e).toMatchObject({ status: 422, probleme: [{ schluessel: 'JFN:2:1', text: 'Status "abgewählt" statt offen' }] });
    try { gesendetPlan({ ediWerte, korbZeilen: [korb[0]], orderId: 'JFN-2026-0002', jetzt: JETZT }); } catch (x) { e = x; }
    expect(e.probleme).toEqual([{ schluessel: 'JFN:2:1', text: 'nicht mehr im Korb' }]);
    const doppelt = [...ediWerte, ediZ('JFN-2026-0002', 'Entwurf', 'JFN:1:1')];
    expect(() => gesendetPlan({ ediWerte: doppelt, korbZeilen: korb, orderId: 'JFN-2026-0002', jetzt: JETZT })).toThrow(/mehrfach/);
  });

  test('Entwuerfe fuer die Anzeige: offen, teilweise und ganz ueberholt; Testdatei und gesendete nie', () => {
    const w = [...ediWerte, ediZ('JFN-2026-0004', 'Entwurf', 'JFN:1:1'), ediZ('JFN-2026-0005', 'Entwurf', 'JFN:4:1 JFN:5:1')];
    const korb = [kz('JFN:1:1', 'offen'), kz('JFN:2:1', 'bestellt'), kz('JFN:4:1', 'abgewählt'), kz('JFN:5:1', 'bestellt')];
    expect(entwuerfeAus(w, korb).map(e => [e.orderId, e.offen, e.ueberholt, e.ganzUeberholt, e.versandart])).toEqual([
      ['JFN-2026-0005', 0, true, true, 'GLS'], ['JFN-2026-0004', 1, false, false, 'GLS'], ['JFN-2026-0002', 1, true, false, 'GLS'],
    ]);
    expect(entwuerfeAus([], korb)).toEqual([]);
  });
});
