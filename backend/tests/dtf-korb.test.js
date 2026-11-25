// DT1: DTF-Warenkorb - reine Logik (utils/dtf-korb.js). Nur erfundene Werte.
import {
  dtfSchluessel, dtfAbgleichPlan, quellSchluessel, shopEinstufung, farbeGroesse, dateiFuer, hoeheAusVerhaeltnis, breiteAusVerhaeltnis,
  pixelMasse, meterSchaetzung, baueDtfXml, naechsteBestellId, druckIdFuer, bestellAuswahl, zeileAnsicht, sichtbareZeilen, zuordnenPlan,
  statusPlan, hinweisFuer, hinweisSperrt, scanAdresse, nachrichtAnNico, chatText, wasFehlt, bestellEingabe, sichererDateiname, STATUS,
  NAMENSDRUCK, PLATZHALTER, druckpositionenFuer, shopZustand, auZustand, haengt, BESTELL_STATUS, reiterZeilen,
} from '../utils/dtf-korb.js';

const quellen = eintraege => new Map(eintraege.map(([k, zustand, pos]) => [k, { zustand, positionen: new Map(pos ?? []) }]));
const kand = (x = {}) => ({ quelle: 'JFN', nummer: '9001', position: '11', datum: '2026-11-26', kuerzel: 'XY-Test', modell: 'M100', farbe: 'Schwarz',
  groesse: 'L', menge: 2, express: false, druckname: false, druckpositionen: ['Brust'], ...x });
const zeile = (x = {}) => ({ Schluessel: 'JFN:9001:11:Brust', Quelle: 'JFN', Nummer: '9001', Position: '11', Druckposition: 'Brust', Kuerzel: 'XY-Test',
  Modell: 'M100', Textilfarbe: 'Schwarz', Groesse: 'L', Menge: 2, Express: '', Status: STATUS.OFFEN, Hinweis: '', Stand: 's1', _zeile: 2, ...x });

describe('Schluessel und Abgleich', () => {
  test('Schluessel Quelle:Nummer:Position:Druckposition, unbekannte Position = "-"', () => {
    expect(dtfSchluessel('JFN', '9001', '11', 'Brust')).toBe('JFN:9001:11:Brust');
    expect(dtfSchluessel('AU', 'AU-2026-0001', 'AU-2026-0001-01', '')).toBe('AU:AU-2026-0001:AU-2026-0001-01:-');
  });

  test('neu: je Druckposition eine Zeile, Status offen; doppelt: nichts', () => {
    const p = dtfAbgleichPlan({ kandidaten: [kand({ druckpositionen: ['Brust', 'Rücken'] })], start: '2026-11-25' });
    expect(p.neu.map(z => z.Schluessel)).toEqual(['JFN:9001:11:Brust', 'JFN:9001:11:Rücken']);
    expect(p.neu.every(z => z.Status === STATUS.OFFEN)).toBe(true);
    const p2 = dtfAbgleichPlan({ vorhanden: [zeile()], kandidaten: [kand(), kand()] });
    expect(p2.neu).toEqual([]);
  });

  test('ohne Mass: Platzhalter "-"; spaeter echte Positionen dazu, Platzhalter bleibt (wird ausgeblendet)', () => {
    const p = dtfAbgleichPlan({ kandidaten: [kand({ druckpositionen: [] })] });
    expect(p.neu[0].Druckposition).toBe(PLATZHALTER);
    const platz = zeile({ Schluessel: 'JFN:9001:11:-', Druckposition: '-' });
    const p2 = dtfAbgleichPlan({ vorhanden: [platz], kandidaten: [kand()] });
    expect(p2.neu.map(z => z.Schluessel)).toEqual(['JFN:9001:11:Brust']);
    expect(sichtbareZeilen([platz, zeile()]).map(z => z.Schluessel)).toEqual(['JFN:9001:11:Brust']);
    // Platzhalter nicht doppelt, wenn schon eine echte Zeile da ist
    expect(dtfAbgleichPlan({ vorhanden: [zeile()], kandidaten: [kand({ druckpositionen: [] })] }).neu).toEqual([]);
  });

  test('vor dem Startdatum: nur in "aelter"; bekannte Bestellung oder "trotzdem aufnehmen" kommt dazu', () => {
    const alt = kand({ datum: '2026-11-20', nummer: '8000' });
    const p = dtfAbgleichPlan({ kandidaten: [alt], start: '2026-11-25' });
    expect(p.neu).toEqual([]);
    expect(p.aelter).toEqual([{ quelle: 'JFN', nummer: '8000', datum: '2026-11-20', positionen: 1 }]);
    expect(dtfAbgleichPlan({ kandidaten: [alt], start: '2026-11-25', zwang: new Set([quellSchluessel('JFN', '8000')]) }).neu).toHaveLength(1);
    const bekannt = zeile({ Nummer: '8000', Schluessel: 'JFN:8000:99:Brust', Position: '99' });
    expect(dtfAbgleichPlan({ vorhanden: [bekannt], kandidaten: [alt], start: '2026-11-25' }).neu).toHaveLength(1);
  });

  test('storniert / Position weg / Menge / Namensdruck: nur Hinweis, nie Status', () => {
    const z = zeile();
    const p = dtfAbgleichPlan({ vorhanden: [z], quellen: quellen([['JFN:9001', 'storniert']]) });
    expect(p.hinweise).toEqual([{ zeile: 2, schluessel: z.Schluessel, alt: '', neu: 'Bestellung storniert' }]);
    expect(p.neu).toEqual([]);
    expect(hinweisFuer(z, quellen([['JFN:9001', 'offen', [['12', { menge: 1, dtf: true }]]]]))).toBe('Position weg');
    expect(hinweisFuer(z, quellen([['JFN:9001', 'offen', [['11', { menge: 3, dtf: true }]]]]))).toBe('Menge jetzt 3');
    expect(hinweisFuer(zeile({ Quelle: 'AU', Nummer: 'AU-2026-0001' }), quellen([['AU:AU-2026-0001', 'offen', [['11', { menge: 2, dtf: true, druckname: true }]]]])))
      .toBe(NAMENSDRUCK);
    expect(hinweisFuer(zeile({ Quelle: 'AU', Nummer: 'AU-2026-0001' }), quellen([['AU:AU-2026-0001', 'offen', []]]))).toBe('Position entfernt');
    expect(hinweisFuer(z, new Map())).toBeUndefined();   // Quelle nicht gelesen -> nichts aendern
    expect(hinweisSperrt('Bestellung storniert')).toBe(true);
    expect(hinweisSperrt(`Menge jetzt 3 · ${NAMENSDRUCK}`)).toBe(false);
    // geliefert/abgeschlossene Korb-Zeilen bekommen keinen Hinweis mehr
    expect(dtfAbgleichPlan({ vorhanden: [zeile({ Status: STATUS.GELIEFERT })], quellen: quellen([['JFN:9001', 'storniert']]) }).hinweise).toEqual([]);
  });

  test('Zustaende', () => {
    expect(shopZustand({ status: 'cancelled' })).toBe('storniert');
    expect(shopZustand({ status: 'refunded' })).toBe('erstattet');
    expect(shopZustand({ status: 'completed' })).toBe('abgeschlossen');
    expect(shopZustand(null)).toBe('weg');
    expect(shopZustand({ status: 'on-hold' })).toBe('offen');
    expect(auZustand({ Status: 'storniert' })).toBe('au_storniert');
    expect(auZustand({ Status: 'fertig' })).toBe('au_fertig');
    expect(auZustand({ Status: 'bestellt' })).toBe('offen');
  });
});

describe('Shop-Einstufung', () => {
  const ctx = {
    trikotIds: new Set(['500']), maskeJeProdukt: new Map([['111', { kurz: 'XY-Test', artikelnummer: 'M100/XY-Test' }], ['222', { kurz: 'ST-Stick', artikelnummer: 'M200/ST-Stick' }]]),
    motivDruckart: new Map([['st-stick', 'Stick']]),
    variante: { e1: 'Farbe', v1: 'Schwarz', e2: 'Größe', v2: 'L' },
  };
  test('Trikot und Nicht-DTF fallen raus, DTF liefert Kuerzel/Modell/Farbe/Groesse', () => {
    expect(shopEinstufung({ product_id: 500 }, ctx).dtf).toBe(false);
    expect(shopEinstufung({ product_id: 222 }, ctx)).toMatchObject({ dtf: false, grund: 'druckart' });
    expect(shopEinstufung({ product_id: 111 }, ctx)).toEqual({ dtf: true, kuerzel: 'XY-Test', modell: 'M100', farbe: 'Schwarz', groesse: 'L' });
  });
  test('Farbe/Groesse aus den Metadaten, wenn die Variante fehlt', () => {
    expect(farbeGroesse(null, [{ key: 'pa_farbe', display_value: 'Rot' }, { key: 'pa_groesse', display_value: 'XL' }])).toEqual({ farbe: 'Rot', groesse: 'XL' });
  });
  test('Druckpositionen: Hand-Masse vor Tabelle', () => {
    const masse = [{ Druckmass_ID: 'DM-0001', Bezug: 'XY-Test', Position: 'Brust', Groesse: 'alle', Breite_cm: 10, Hoehe_cm: 8, Aktiv: 'ja' }];
    expect(druckpositionenFuer({ bezug: 'XY-Test', groesse: 'L', modell: 'M100' }, masse)).toEqual(['Brust']);
    expect(druckpositionenFuer({ hand: 'Rücken 28x30', bezug: 'XY-Test', groesse: 'L' }, masse)).toEqual(['Rücken']);
  });
});

describe('Datei-Zuordnung', () => {
  const D = (x) => ({ Bezug: 'XY-Test', Position: 'Brust', Modell: 'alle', Textilfarbe: 'alle', Groesse: 'alle', Datei_ID: 'f0', Datei_Name: 'a.png', Aktiv: 'ja', ...x });
  test('genau vor "alle" je Feld, abweichender Wert schliesst aus', () => {
    const zeilen = [
      D({ Datei_ID: 'allg' }),
      D({ Textilfarbe: 'Schwarz', Datei_ID: 'weiss' }),
      D({ Textilfarbe: 'Pink', Datei_ID: 'schwarz' }),
      D({ Modell: 'M100', Textilfarbe: 'Schwarz', Groesse: 'XL', Datei_ID: 'xl' }),
    ];
    const f = x => dateiFuer(zeilen, { bezug: 'XY-Test', position: 'Brust', modell: 'M100', ...x })?.id;
    expect(f({ farbe: 'Schwarz', groesse: 'L' })).toBe('weiss');
    expect(f({ farbe: 'Pink', groesse: 'L' })).toBe('schwarz');
    expect(f({ farbe: 'Grau', groesse: 'L' })).toBe('allg');
    expect(f({ farbe: 'Schwarz', groesse: 'XXL' })).toBe('weiss');
    expect(f({ farbe: 'Schwarz', groesse: 'XL' })).toBe('xl');
    expect(dateiFuer([D({ Aktiv: 'nein' })], { bezug: 'XY-Test', position: 'Brust' })).toBeNull();
    expect(dateiFuer(zeilen, { bezug: 'XY-Test', position: 'Rücken' })).toBeNull();
  });
  test('Hoehe/Breite aus dem Seitenverhaeltnis', () => {
    expect(hoeheAusVerhaeltnis(22, 2000, 1000)).toBe(11);
    expect(hoeheAusVerhaeltnis(21, 3000, 1234)).toBe(8.6);
    expect(breiteAusVerhaeltnis(30, 1000, 2000)).toBe(15);
    expect(hoeheAusVerhaeltnis(22, 0, 100)).toBeNull();
  });
  test('Pixelmasse aus PNG- und JPEG-Kopf', () => {
    const png = Buffer.alloc(32);
    Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png, 0);
    png.writeUInt32BE(1234, 16); png.writeUInt32BE(567, 20);
    expect(pixelMasse(png)).toEqual({ breite: 1234, hoehe: 567 });
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(pixelMasse(jpg)).toEqual({ breite: 600, hoehe: 300 });
    expect(pixelMasse(Buffer.from('%PDF-1.7 aaaaaaaaaaaaaaaaaaaaaa'))).toBeNull();
  });
  test('"Auch übernehmen für": Datei je SKU, Mass je Modell+Groesse mit eigenem Wert', () => {
    const p = zuordnenPlan({
      bezug: 'XY-Test', position: 'brust', modell: 'M100', farbe: 'Schwarz', groesse: 'L', datei: { id: 'f1', name: 'x.png' }, mass: { breite: 22, hoehe: 11, fuehrend: 'breite' },
      auch: [{ modell: 'M100', farbe: 'Schwarz', groesse: 'XL', datei: true, mass: true, breite: 23 }, { modell: 'M100', farbe: 'Schwarz', groesse: 'M', datei: true, mass: true, breite: 21 },
        { modell: 'M100', farbe: 'Pink', groesse: 'L', datei: false, mass: true }],
    });
    expect(p.position).toBe('Brust');
    expect(p.dateiZeilen.map(z => `${z.Textilfarbe}/${z.Groesse}`)).toEqual(['Schwarz/L', 'Schwarz/XL', 'Schwarz/M']);
    expect(p.massGruppen.map(g => `${g.groesse}:${g.breite}`)).toEqual(['L:22', 'XL:23', 'M:21']);   // Pink L = gleiche Gruppe wie L
    const alle = zuordnenPlan({ bezug: 'XY-Test', position: 'Brust', modell: 'M100', farbe: 'Schwarz', groesse: 'L', datei: { id: 'f1' }, dateiAlleGroessen: true });
    expect(alle.dateiZeilen).toEqual([expect.objectContaining({ Textilfarbe: 'Schwarz', Groesse: 'alle' })]);
    expect(() => zuordnenPlan({ bezug: 'XY-Test', position: 'Bauch', datei: { id: 'f' } })).toThrow(/gibt es nicht/);
    expect(() => zuordnenPlan({ bezug: 'XY-Test', position: 'Brust' })).toThrow(/Datei und\/oder ein Maß/);
  });
  test('Dateiname: Originalname, ohne Pfad', () => {
    expect(sichererDateiname('C:\\x\\Crocodiles_SW_White.png')).toBe('Crocodiles_SW_White.png');
    expect(() => sichererDateiname('..')).toThrow();
  });
});

describe('Live-Ampeln: nach dem Zuordnen sind alle passenden Zeilen gruen', () => {
  const zeilen = [zeile(), zeile({ Schluessel: 'JFN:9002:21:Brust', Nummer: '9002', Position: '21', Groesse: 'XL' }), zeile({ Schluessel: 'JFN:9003:31:Brust', Nummer: '9003', Position: '31', Textilfarbe: 'Pink' })];
  test('vorher fehlt Mass und Datei, nachher bereit', () => {
    const leer = { masse: [], dateien: [], dateiInfo: new Map() };
    expect(zeilen.map(z => zeileAnsicht(z, leer).grundNicht)).toEqual(['mass', 'mass', 'mass']);
    const ctx = {
      masse: [{ Druckmass_ID: 'DM-0001', Bezug: 'XY-Test', Position: 'Brust', Groesse: 'alle', Modell: 'M100', Breite_cm: 22, Hoehe_cm: 11, Aktiv: 'ja' }],
      dateien: [{ Bezug: 'XY-Test', Position: 'Brust', Modell: 'M100', Textilfarbe: 'Schwarz', Groesse: 'alle', Datei_ID: 'f1', Datei_Name: 'w.png', Aktiv: 'ja' }],
      dateiInfo: new Map([['f1', { da: true, name: 'w.png', pfad: 'Motive/XY-Test/w.png' }]]),
    };
    const a = zeilen.map(z => zeileAnsicht(z, ctx));
    expect(a.map(x => x.bereit)).toEqual([true, true, false]);
    expect(a[2].grundNicht).toBe('datei');
    expect(a[0].datei.pfad).toBe('Motive/XY-Test/w.png');
    // Datei in Drive geloescht -> "weg"
    expect(zeileAnsicht(zeilen[0], { ...ctx, dateiInfo: new Map([['f1', { da: false }]]) }).dateiAmpel).toBe('weg');
  });
  test('Hand-Masse eines Auftrags gehen vor', () => {
    const au = zeile({ Quelle: 'AU', Nummer: 'AU-2026-0001', Position: 'AU-2026-0001-01', Kuerzel: 'Vereinslogo', Druckposition: 'Rücken' });
    const v = zeileAnsicht(au, { masse: [], dateien: [], handJe: new Map([['AU-2026-0001-01', 'Rücken 28x30,5 H']]) });
    expect(v.mass).toEqual({ breite: 28, hoehe: 30.5, fuehrend: 'hoehe', quelle: 'hand' });
  });
});

describe('Meter-Schaetzung', () => {
  test('Flaeche x Menge x (1 + Verschnitt) / Breite, aufgerundet auf 10 cm', () => {
    // 10 x 10 x 57 Stueck = 5700 cm² x 1,15 / 57 = 115 cm -> 120
    const m = meterSchaetzung([{ breite: 10, hoehe: 10, menge: 57 }], { breiteCm: 57, verschnitt: 15 });
    expect(m.laengeCm).toBe(120);
    expect(meterSchaetzung([{ breite: 10, hoehe: 10, menge: 57 }], { breiteCm: 57, verschnitt: 0 }).laengeCm).toBe(100);   // genau 100 bleibt 100
    expect(meterSchaetzung([{ breite: 10, hoehe: 10, menge: 1 }], { verschnitt: 0 }).laengeCm).toBe(10);
    expect(meterSchaetzung([], {}).laengeCm).toBe(0);
  });
  test('Kosten aus dem Preis je m², Schwelle', () => {
    const m = meterSchaetzung([{ breite: 10, hoehe: 10, menge: 57 }], { breiteCm: 57, verschnitt: 15, tarif: { qmBruttoCent: 2000 }, mindestCm: 200 });
    expect(m.kostenBruttoCent).toBe(Math.round(1.2 * 0.57 * 2000));
    expect(m.lohnt).toBe(false);
    expect(m.fehltCm).toBe(80);
    expect(meterSchaetzung([{ breite: 10, hoehe: 10, menge: 1 }], { tarif: { fehlt: ['x'] } }).kostenBruttoCent).toBeNull();
    expect(meterSchaetzung([{ breite: 10, hoehe: null, menge: 1 }]).ohneMass).toBe(1);
  });
  test('Express getrennt: Auswahl mit beiden Arten wird abgelehnt', () => {
    const v = (s, express) => ({ schluessel: s, stand: 's', bereit: true, express, menge: 1 });
    const r = bestellAuswahl([{ schluessel: 'a' }, { schluessel: 'b' }], new Map([['a', v('a', false)], ['b', v('b', true)]]));
    expect(r.probleme.map(p => p.text)).toContain('Express- und normale Zeilen getrennt bestellen');
    const nur = bestellAuswahl([{ schluessel: 'b' }], new Map([['b', v('b', true)]]));
    expect(nur.express).toBe(true);
    expect(nur.probleme).toEqual([]);
  });
});

describe('Bestellung und XML', () => {
  test('naechste Bestell-ID je Jahr, Druck-ID je Position', () => {
    expect(naechsteBestellId(['DTF-2026-0002', 'DTF-2025-0009', 'x'], 2026)).toBe('DTF-2026-0003');
    expect(naechsteBestellId([], 2027)).toBe('DTF-2027-0001');
    expect(druckIdFuer('DTF-2026-0003', 6)).toBe('DTF-2026-0003-07');
  });
  test('Auswahl: nicht bereit / geaendert -> Probleme', () => {
    const r = bestellAuswahl([{ schluessel: 'a', stand: 'alt' }, { schluessel: 'b' }, { schluessel: 'c' }],
      new Map([['a', { stand: 'neu', bereit: true }], ['b', { stand: 's', bereit: false, grundNicht: 'datei' }]]));
    expect(r.probleme.map(p => p.text)).toEqual(['inzwischen geändert – neu laden', 'Datei fehlt – „Zuordnen …“', 'Zeile gibt es nicht mehr']);
  });
  test('XML: Pfad, mm, fuehrend, QR - keine Namen, Preise, Adressen', () => {
    const xml = baueDtfXml({
      id: 'DTF-2026-0003', datum: '2026-11-27', lieferart: 'versand_dhl', express: false, notiz: 'Bitte bis Freitag ]]> ok', laengeCm: 140, breiteCm: 57,
      scanBasis: 'https://mc.example.test/app', posten: [
        { druckId: 'DTF-2026-0003-01', pfad: 'Motive/XY-Test/a&b.png', breite: 10, hoehe: 8.5, fuehrend: 'breite', menge: 12, referenz: 'JFN-9001', kuerzel: 'XY-Test', druckposition: 'Brust' },
      ],
    });
    expect(xml).toContain('<dtfBestellung id="DTF-2026-0003" datum="2026-11-27" lieferart="versand-dhl" express="nein" qrBestellung="https://mc.example.test/app/#dtf/scan/DTF-2026-0003">');
    expect(xml).toContain('datei="Motive/XY-Test/a&amp;b.png" breite_mm="100" hoehe_mm="85" fuehrend="breite" anzahl="12" referenz="JFN-9001"');
    expect(xml).toContain('qr="https://mc.example.test/app/#dtf/scan/DTF-2026-0003-01"');
    expect(xml).toContain('<summe geschaetzteLaengeCm="140" breiteCm="57"/>');
    expect(xml).toContain('<![CDATA[Bitte bis Freitag ]]]]><![CDATA[> ok]]>');
    expect(xml).not.toMatch(/preis|€|kunde|adresse|name=/i);
    // ohne gueltige Scan-Adresse keine QR-Inhalte
    expect(baueDtfXml({ id: 'DTF-2026-0003', posten: [], scanBasis: 'http://unsicher' })).not.toContain('qr');
  });
  test('Scan-Adresse nur https', () => {
    expect(scanAdresse('https://x.test/', 'DTF-2026-0001-01')).toBe('https://x.test/#dtf/scan/DTF-2026-0001-01');
    expect(scanAdresse('javascript:alert(1)', 'x')).toBe('');
    expect(scanAdresse('', 'x')).toBe('');
  });
  test('Texte an Nico und an uns', () => {
    expect(nachrichtAnNico({ id: 'DTF-2026-0003', anzahl: 3, laengeCm: 140, lieferart: 'abholung', express: false, notiz: '' }))
      .toBe('Hallo Nico, neue DTF-Bestellung DTF-2026-0003 liegt im Ordner „Bestellungen“ (3 Motive, ≈ 1,4 m, Abholung). Danke!');
    expect(chatText({ id: 'DTF-2026-0003', laengeCm: 140, lieferart: 'abholung' })).toBe('🖨️ DTF-2026-0003 abgelegt · ≈ 1,4 m · Abholung');
  });
  test('Eingabe: Lieferart Abholung vorgewaehlt, DHL, sonst Fehler', () => {
    expect(bestellEingabe({}).lieferart).toBe('abholung');
    expect(bestellEingabe({ lieferart: 'versand_dhl', notiz: ' a  b ' })).toEqual({ lieferart: 'versand_dhl', notiz: 'a b', ersetzt: '' });
    expect(bestellEingabe({ ersetzt: 'dtf-2026-0003' }).ersetzt).toBe('DTF-2026-0003');
    expect(() => bestellEingabe({ ersetzt: 'AU-1' })).toThrow();
    expect(() => bestellEingabe({ lieferart: 'ups' })).toThrow();
    expect(() => bestellEingabe({ notiz: 'x'.repeat(301) })).toThrow();
  });
  test('haengt erst nach 10 min', () => {
    const jetzt = new Date('2026-11-27T10:00:00Z');
    expect(haengt({ Status: BESTELL_STATUS.WIRD, Stand: '2026-11-27T09:55:00Z' }, jetzt)).toBe(false);
    expect(haengt({ Status: BESTELL_STATUS.WIRD, Stand: '2026-11-27T09:45:00Z' }, jetzt)).toBe(true);
  });
});

describe('Status von Hand, Was fehlt', () => {
  test('abwaehlen mit Grund, zurueckholen; Stand muss passen', () => {
    expect(statusPlan(zeile(), { ziel: STATUS.ABGEWAEHLT, grund: 'schon gedruckt', stand: 's1' })).toEqual({ Status: STATUS.ABGEWAEHLT, Grund: 'schon gedruckt', Notiz: '' });
    expect(() => statusPlan(zeile(), { ziel: STATUS.ABGEWAEHLT, grund: 'egal', stand: 's1' })).toThrow(/Grund/);
    expect(() => statusPlan(zeile(), { ziel: STATUS.ABGEWAEHLT, grund: 'schon gedruckt', stand: 'alt' })).toThrow(/geändert/);
    expect(statusPlan(zeile({ Status: STATUS.ABGEWAEHLT }), { ziel: STATUS.OFFEN, stand: 's1' }).Status).toBe(STATUS.OFFEN);
    expect(() => statusPlan(zeile({ Status: STATUS.BESTELLT }), { ziel: STATUS.OFFEN, stand: 's1' })).toThrow();
  });
  test('Was fehlt: je Kuerzel/Position/SKU, Stueck offen, Verkauf 90 Tage', () => {
    const a = [zeile(), zeile({ Nummer: '9002', Schluessel: 'JFN:9002:21:Brust', Menge: 3 })].map(z => zeileAnsicht(z, { masse: [], dateien: [] }));
    const l = wasFehlt(a, new Map([['xy-test|m100|schwarz|l', 7]]));
    expect(l).toEqual([expect.objectContaining({ kuerzel: 'XY-Test', offen: 5, verkauft90: 7, massFehlt: true, dateiFehlt: true })]);
  });
  test('reiterZeilen: Spalten ueber den Namen', () => {
    const r = reiterZeilen([['Status', 'Schluessel'], ['offen', 'k1']], ['Schluessel', 'Status']);
    expect(r.zeilen[0]).toMatchObject({ Schluessel: 'k1', Status: 'offen', _zeile: 2 });
  });
});
