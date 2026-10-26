// BO4a: EDI-Bestelldatei - Ein-/Ausgabe (lib/lshopEdi.js) gegen ein In-Memory-Sheet.
// Vorschau schreibt nichts; Erzeugen vergibt die order_id und schreibt genau eine Protokollzeile,
// der Korb bleibt unveraendert; rot -> 422 ohne Schreiben; Reiter fehlt -> 409; Sperre; kein Netz
// ausser Sheets; Einrichtung (Reiter + Config-Zeile) idempotent, customer_id nie ausgegeben.
// BO4e: Versandart (Vorgabe/Wahl/Protokoll), "Als gesendet markieren" (ein Schreibaufruf), neue Spalten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KORB_SPALTEN, TAB_KORB } from '../utils/korb-logic.js';
import { EDI_TAB, EDI_SPALTEN, leseBestellXml } from '../utils/edi-bestellung.js';
import { ediVorschau, ediErzeugen, ediAlsGesendet, richteEdiEin, _customerIdCacheLeeren } from '../lib/lshopEdi.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { machSheets, grundTabs, NR, NR2, NR_AUS } from './hilfen/korb-sheet.js';

const hier = dirname(fileURLToPath(import.meta.url));
const JETZT = () => new Date('2026-10-22T08:00:00Z');   // 10:00 Berlin, KW43
const CID = '00000000';                                    // Platzhalter
const CONFIG_KOPF = ['Schlüssel', 'Wert', 'Anbieter', 'Beschreibung', 'Geändert-Am'];

const korbZeile = o => KORB_SPALTEN.map(s => ({ Shop: 'JFN', Herkunft: 'shop', Status: 'offen', Menge: '1', LShop_ArticleNr: NR, ...o }[s] ?? ''));
function aufbau({ cid = CID, mitProtokoll = true, korb } = {}) {
  const tabs = grundTabs();
  tabs[TAB_KORB].push(
    ...(korb ?? [
      korbZeile({ Schluessel: 'JFN:10001:1', Bestellnummer: '10001', Position: '1' }),
      korbZeile({ Schluessel: 'JFN:10002:7', Bestellnummer: '10002', Position: '7', LShop_ArticleNr: NR2, Menge: '3' }),
      korbZeile({ Schluessel: 'EIGEN:2026-0001', Herkunft: 'eigen', Referenz: 'Lager & Muster', Menge: '2' }),
    ]),
  );
  tabs.Config = [CONFIG_KOPF, ['modell.seo-text', 'claude-x', '', '', ''], ...(cid === null ? [] : [['lshop.customer_id', cid, '', '', '']])];
  if (mitProtokoll) tabs[EDI_TAB] = [EDI_SPALTEN, ['JFN-2026-0001', '2026-09-21', 'Testdatei']];
  const m = machSheets(tabs);
  // addSheet fuer die Einrichtung nachbilden
  m.sheets.spreadsheets.batchUpdate = async ({ requestBody }) => {
    m.aufrufe.struktur.push(requestBody.requests);
    const add = requestBody.requests.find(r => r.addSheet);
    if (add) { tabs[add.addSheet.properties.title] = []; return { data: { replies: [{ addSheet: { properties: { sheetId: 99 } } }] } }; }
    return { data: {} };
  };
  return { tabs, ...m };
}
const auswahl = tabs => tabs[TAB_KORB].slice(1).map(r => ({ schluessel: r[0], status: r[KORB_SPALTEN.indexOf('Status')] }));

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot';
  process.env.BUSINESS_SHEET_ID = 'ssot';
  _resetLShopCache();
  _customerIdCacheLeeren();
});

describe('ediVorschau', () => {
  test('gruen, Platzhalter-order_id, Standard-Commission, schreibt nichts', async () => {
    const { tabs, sheets, aufrufe } = aufbau();
    const r = await ediVorschau({ auswahl: auswahl(tabs), sheets, jetzt: JETZT });
    expect(r.gruen).toBe(true);
    expect(r.orderId).toBe('JFN-2026-____');
    expect(r.commission).toBe('JFN Sammelbestellung KW43');
    expect(r.items.map(i => [i.itemnumber, i.reference, i.quantity])).toEqual([
      [NR, 'JFN-10001-1', '1'], [NR2, 'JFN-10002-7', '3'], [NR, 'Lager & Muster', '2'],
    ]);
    expect(r.stueck).toBe(6);
    const w = leseBestellXml(r.xml);
    expect(w.kinder[1].kinder).toHaveLength(3);
    expect(r.xml).toContain('<![CDATA[Lager & Muster]]>');
    expect(aufrufe.update).toEqual([]);
    expect(aufrufe.struktur).toEqual([]);
  });

  test('customer_id fehlt (keine Zeile oder leer) -> rot, eigene Regel, XML-Punkt nicht doppelt', async () => {
    for (const cid of [null, '']) {
      _customerIdCacheLeeren();
      const { tabs, sheets } = aufbau({ cid });
      const r = await ediVorschau({ auswahl: auswahl(tabs), sheets, jetzt: JETZT });
      expect(r.gruen).toBe(false);
      expect(r.punkte.find(p => p.regel === 'customer_id').ok).toBe(false);
      expect(r.punkte.find(p => p.regel === 'xml').ok).toBe(true);
    }
  });

  test('ausgelaufene ArticleNr -> rot; eigene Commission wird uebernommen', async () => {
    const { tabs, sheets } = aufbau({ korb: [korbZeile({ Schluessel: 'JFN:1:1', Bestellnummer: '1', Position: '1', LShop_ArticleNr: NR_AUS })] });
    const r = await ediVorschau({ auswahl: auswahl(tabs), commission: 'Crocodiles Fluffy Nachbestellung', sheets, jetzt: JETZT });
    expect(r.gruen).toBe(false);
    expect(r.punkte.find(p => p.regel === 'artikel').ok).toBe(false);
    expect(r.commission).toBe('Crocodiles Fluffy Nachbestellung');
  });
});

describe('ediErzeugen', () => {
  test('vergibt JFN-2026-0002, schreibt genau eine Protokollzeile, Korb unveraendert', async () => {
    const { tabs, sheets, aufrufe } = aufbau();
    const korbVorher = JSON.stringify(tabs[TAB_KORB]);
    const r = await ediErzeugen({ auswahl: auswahl(tabs), sheets, jetzt: JETZT });
    expect(r.orderId).toBe('JFN-2026-0002');
    expect(r.dateiname).toBe('JFN-2026-0002_20261022-1000.xml');
    expect(leseBestellXml(r.xml).kinder[0].kinder.find(k => k.name === 'order_id').text).toBe('JFN-2026-0002');
    expect(aufrufe.update).toEqual([`'${EDI_TAB}'!A3:K3`]);   // BO4e: + Versandart, Gesendet
    expect(JSON.stringify(tabs[TAB_KORB])).toBe(korbVorher);
    const z = Object.fromEntries(EDI_SPALTEN.map((n, i) => [n, tabs[EDI_TAB][2][i]]));
    expect(z).toMatchObject({ order_id: 'JFN-2026-0002', Status: 'Entwurf', Positionen: '3', Stueck: '6', Commission: 'JFN Sammelbestellung KW43',
      Dateiname: 'JFN-2026-0002_20261022-1000.xml', Korb_Schluessel: 'JFN:10001:1 JFN:10002:7 EIGEN:2026-0001', Versandart: 'Standard', Gesendet: '' });
    expect(JSON.stringify(z)).not.toContain(CID);
    const r2 = await ediErzeugen({ auswahl: auswahl(tabs), sheets, jetzt: JETZT });
    expect(r2.orderId).toBe('JFN-2026-0003');
  });

  test('rot -> 422 mit Pruefbericht, nichts geschrieben', async () => {
    const { tabs, sheets, aufrufe } = aufbau({ cid: '' });
    await expect(ediErzeugen({ auswahl: auswahl(tabs), sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 422, pruefung: { gruen: false } });
    expect(aufrufe.update).toEqual([]);
  });

  test('Reiter fehlt -> 409, nichts geschrieben', async () => {
    const { tabs, sheets, aufrufe } = aufbau({ mitProtokoll: false });
    await expect(ediErzeugen({ auswahl: auswahl(tabs), sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 409 });
    expect(aufrufe.update).toEqual([]);
  });

  test('gleichzeitig zweimal -> der zweite bekommt 409 (Korb-Sperre), nur eine Zeile', async () => {
    const { tabs, sheets } = aufbau();
    const [a, b] = await Promise.allSettled([
      ediErzeugen({ auswahl: auswahl(tabs), sheets, jetzt: JETZT }),
      ediErzeugen({ auswahl: auswahl(tabs), sheets, jetzt: JETZT }),
    ]);
    expect(a.status).toBe('fulfilled');
    expect(b).toMatchObject({ status: 'rejected', reason: { status: 409 } });
    expect(tabs[EDI_TAB]).toHaveLength(3);
  });

  test('Jahreswechsel: 2027 beginnt bei 0001', async () => {
    const { tabs, sheets } = aufbau();
    const r = await ediErzeugen({ auswahl: auswahl(tabs), sheets, jetzt: () => new Date('2027-01-04T08:00:00Z') });
    expect(r.orderId).toBe('JFN-2027-0001');
  });
});

describe('Quelltext: nur Sheets, kein Versand', () => {
  test('lib/lshopEdi.js und die Routen nutzen weder Shop noch Netz noch FTP', () => {
    const code = f => readFileSync(resolve(hier, f), 'utf8').split('\n').filter(z => !z.trim().startsWith('//')).join('\n');
    expect(code('../lib/lshopEdi.js')).not.toMatch(/getWcClient|fetch\(|ftp|https?:\/\/|import .*(http|net|ssh)/i);
    expect(code('../routes/bestellen.js')).not.toMatch(/ftp|senden|upload/i);
  });
});

describe('richteEdiEin', () => {
  test('Trockenlauf schreibt nichts; --write legt Reiter + Testzeile + Config-Zeile an; zweiter Lauf aendert nichts', async () => {
    const { tabs, sheets, aufrufe } = aufbau({ cid: null, mitProtokoll: false });
    const t = await richteEdiEin({ write: false, sheets, jetzt: JETZT() });
    expect(t.log.join('\n')).toMatch(/wuerde angelegt/);
    expect(aufrufe.update).toEqual([]);
    expect(tabs[EDI_TAB]).toBeUndefined();

    const w = await richteEdiEin({ write: true, sheets, jetzt: JETZT() });
    expect(w.log.join('\n')).toMatch(/✓ Reiter angelegt[\s\S]*✓ Config-Zeile 3 angelegt[\s\S]*✓ Config-Zeile 4 angelegt/);
    expect(tabs[EDI_TAB][0]).toEqual(EDI_SPALTEN);
    expect(tabs[EDI_TAB][1][0]).toBe('JFN-2026-0001');
    expect(tabs.Config[2]).toEqual(['lshop.customer_id', '', '', expect.stringMatching(/Debitorennummer/), '2026-10-22']);
    expect(tabs.Config[3]).toEqual(['lshop.shipping_method', '', '', expect.stringMatching(/Versandart/), '2026-10-22']);   // BO4e

    const n = aufrufe.update.length;
    const nochmal = await richteEdiEin({ write: true, sheets, jetzt: JETZT() });
    expect(aufrufe.update).toHaveLength(n);
    expect(nochmal.log.join('\n')).toMatch(/vorhanden.*JFN-2026-0001 vorhanden[\s\S]*Wert leer - nicht angefasst/);
  });

  test('gesetzter customer_id-Wert wird nie angefasst und nie ausgegeben', async () => {
    const { tabs, sheets, aufrufe } = aufbau({ cid: '12345678' });
    const r = await richteEdiEin({ write: true, sheets, jetzt: JETZT() });
    expect(aufrufe.update).toEqual(["'Config'!A4:E4"]);   // nur die neue Zeile lshop.shipping_method (BO4e)
    expect(tabs.Config[2][1]).toBe('12345678');
    expect(r.log.join('\n')).toMatch(/Wert gesetzt - nicht angefasst/);
    expect(r.log.join('\n')).not.toContain('12345678');
  });
});

// ── BO4e ─────────────────────────────────────────────────────────────────────

describe('BO4e: Versandart in Vorschau und Erzeugen', () => {
  test('ohne Wahl gilt die Vorgabe aus Config; leer -> Standard; unbekannt -> Standard + gelb', async () => {
    const { tabs, sheets } = aufbau();
    let v = await ediVorschau({ auswahl: auswahl(tabs), sheets, jetzt: JETZT });
    expect(v).toMatchObject({ versandart: 'Standard', versandartVorgabe: 'Standard', gruen: true });
    expect(v.versandarten.map(a => a.code)).toContain('EX007');
    expect(v.xml).toContain('<shipping_method>Standard</shipping_method>');

    tabs.Config.push(['lshop.shipping_method', 'GLS', '', '', '']);
    _customerIdCacheLeeren();
    v = await ediVorschau({ auswahl: auswahl(tabs), sheets, jetzt: JETZT });
    expect(v).toMatchObject({ versandart: 'GLS', versandartVorgabe: 'GLS' });

    tabs.Config[tabs.Config.length - 1][1] = 'Hermes';
    _customerIdCacheLeeren();
    v = await ediVorschau({ auswahl: auswahl(tabs), sheets, jetzt: JETZT });
    expect(v.versandart).toBe('Standard');
    expect(v.punkte.find(p => p.regel === 'versandart_config')).toMatchObject({ ok: false, stufe: 'gelb' });
    expect(v.gruen).toBe(true);
  });

  test('gewaehlte Versandart kommt in Datei und Protokoll; ungueltige -> 422, nichts geschrieben', async () => {
    const { tabs, sheets, aufrufe } = aufbau();
    const r = await ediErzeugen({ auswahl: auswahl(tabs), versandart: 'DHL', sheets, jetzt: JETZT });
    expect(r.xml).toContain('<shipping_method>DHL</shipping_method>');
    expect(r.xml).not.toContain('delivery_date');
    expect(tabs[EDI_TAB][2][EDI_SPALTEN.indexOf('Versandart')]).toBe('DHL');
    const n = aufrufe.update.length;
    await expect(ediErzeugen({ auswahl: auswahl(tabs), versandart: 'UPS Express', sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 422 });
    expect(aufrufe.update).toHaveLength(n);
  });
});

describe('BO4e: Als gesendet markieren', () => {
  async function mitEntwurf() {
    const a = aufbau();
    await ediErzeugen({ auswahl: auswahl(a.tabs), versandart: 'GLS', sheets: a.sheets, jetzt: JETZT });
    a.aufrufe.update.length = 0;
    a.aufrufe.batchUpdate.length = 0;
    return a;
  }
  const SPAETER = () => new Date('2026-10-22T09:15:00Z');

  test('Entwurf -> gesendet + Zeitpunkt; jede Position bestellt mit Bestell_ID; genau diese Zellen, ein Aufruf', async () => {
    const { tabs, sheets, aufrufe } = await mitEntwurf();
    const korbVorher = tabs[TAB_KORB].map(z => [...z]);
    const r = await ediAlsGesendet({ orderId: 'JFN-2026-0002', sheets, jetzt: SPAETER });
    expect(r).toMatchObject({ ok: true, orderId: 'JFN-2026-0002', positionen: 3 });
    const sp = n => KORB_SPALTEN.indexOf(n);
    const col = i => String.fromCharCode(65 + i);
    const erwartet = [
      `'${EDI_TAB}'!${col(EDI_SPALTEN.indexOf('Status'))}3`, `'${EDI_TAB}'!${col(EDI_SPALTEN.indexOf('Gesendet'))}3`,
      ...[2, 3, 4].flatMap(z => ['Status', 'Bestell_ID', 'Status_Datum', 'Stand'].map(n => `'${TAB_KORB}'!${col(sp(n))}${z}`)),
    ];
    expect(r.zellen).toEqual(erwartet);
    expect(aufrufe.batchUpdate).toEqual(erwartet);   // ein values.batchUpdate, sonst nichts
    expect(aufrufe.update).toEqual([]);
    const e = tabs[EDI_TAB][2];
    expect([e[EDI_SPALTEN.indexOf('Status')], e[EDI_SPALTEN.indexOf('Gesendet')]]).toEqual(['gesendet', '2026-10-22T09:15:00.000Z']);
    for (const z of tabs[TAB_KORB].slice(1)) {
      expect([z[sp('Status')], z[sp('Bestell_ID')], z[sp('Status_Datum')], z[sp('Stand')]]).toEqual(['bestellt', 'JFN-2026-0002', '2026-10-22T09:15:00.000Z', '2026-10-22T09:15:00.000Z']);
    }
    // alle anderen Zellen unveraendert
    tabs[TAB_KORB].forEach((z, i) => z.forEach((w, j) => {
      if (i && ['Status', 'Bestell_ID', 'Status_Datum', 'Stand'].includes(KORB_SPALTEN[j])) return;
      expect(w ?? '').toBe(korbVorher[i][j] ?? '');
    }));
  });

  test('zweimal -> 409 (kein Entwurf mehr); Position nicht offen -> 422 mit Liste, nichts geschrieben', async () => {
    const a = await mitEntwurf();
    await ediAlsGesendet({ orderId: 'JFN-2026-0002', sheets: a.sheets, jetzt: SPAETER });
    await expect(ediAlsGesendet({ orderId: 'JFN-2026-0002', sheets: a.sheets, jetzt: SPAETER })).rejects.toMatchObject({ status: 409 });

    const b = await mitEntwurf();
    b.tabs[TAB_KORB][2][KORB_SPALTEN.indexOf('Status')] = 'abgewählt';
    const vorher = JSON.stringify([b.tabs[TAB_KORB], b.tabs[EDI_TAB]]);
    await expect(ediAlsGesendet({ orderId: 'JFN-2026-0002', sheets: b.sheets, jetzt: SPAETER }))
      .rejects.toMatchObject({ status: 422, probleme: [{ schluessel: 'JFN:10002:7', text: 'Status "abgewählt" statt offen' }] });
    expect(JSON.stringify([b.tabs[TAB_KORB], b.tabs[EDI_TAB]])).toBe(vorher);
    expect(b.aufrufe.batchUpdate).toEqual([]);

    const c = await mitEntwurf();
    await expect(ediAlsGesendet({ orderId: 'JFN-2026-0001', sheets: c.sheets, jetzt: SPAETER })).rejects.toThrow(/Testdatei/);
  });

  test('Ruecklesen weicht ab -> 500', async () => {
    const { sheets } = await mitEntwurf();
    const orig = sheets.spreadsheets.values.batchGet;
    sheets.spreadsheets.values.batchGet = async o => { const r = await orig(o); r.data.valueRanges[1].values[0][0] = 'anders'; return r; };
    await expect(ediAlsGesendet({ orderId: 'JFN-2026-0002', sheets, jetzt: SPAETER })).rejects.toMatchObject({ status: 500 });
  });
});

describe('BO4e: Einrichtung haengt Versandart/Gesendet an', () => {
  test('alter Kopf (9 Spalten): Trockenlauf zeigt, --write haengt an (Raster verbreitert), Zeilen unveraendert', async () => {
    const { tabs, sheets, aufrufe } = aufbau({ cid: '12345678' });
    tabs[EDI_TAB] = [EDI_SPALTEN.slice(0, 9), ['JFN-2026-0001', '2026-09-21', 'Testdatei']];
    tabs.Config.push(['lshop.shipping_method', '', '', 'x', '']);
    const struktur = [];
    sheets.spreadsheets.batchUpdate = async ({ requestBody }) => { struktur.push(...requestBody.requests); return { data: {} }; };
    const getAlt = sheets.spreadsheets.get;
    sheets.spreadsheets.get = async o => { const r = await getAlt(o); r.data.sheets.forEach(s => { if (s.properties.title === EDI_TAB) s.properties.gridProperties.columnCount = 9; }); return r; };
    const t = await richteEdiEin({ write: false, sheets, jetzt: JETZT() });
    expect(t.log.join('\n')).toMatch(/Versandart, Gesendet fehlen -> wuerden angehaengt \(J1:K1\)/);
    expect(aufrufe.update).toEqual([]);
    const w = await richteEdiEin({ write: true, sheets, jetzt: JETZT() });
    expect(w.log.join('\n')).toMatch(/✓ Versandart, Gesendet angehaengt/);
    expect(struktur).toEqual([{ appendDimension: { sheetId: expect.any(Number), dimension: 'COLUMNS', length: 2 } }]);
    expect(tabs[EDI_TAB][0]).toEqual(EDI_SPALTEN);
    expect(tabs[EDI_TAB][1]).toEqual(['JFN-2026-0001', '2026-09-21', 'Testdatei']);
    expect(aufrufe.update).toEqual([`'${EDI_TAB}'!J1:K1`]);
  });
});
