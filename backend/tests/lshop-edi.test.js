// BO4a: EDI-Bestelldatei - Ein-/Ausgabe (lib/lshopEdi.js) gegen ein In-Memory-Sheet.
// Vorschau schreibt nichts; Erzeugen vergibt die order_id und schreibt genau eine Protokollzeile,
// der Korb bleibt unveraendert; rot -> 422 ohne Schreiben; Reiter fehlt -> 409; Sperre; kein Netz
// ausser Sheets; Einrichtung (Reiter + Config-Zeile) idempotent, customer_id nie ausgegeben.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KORB_SPALTEN, TAB_KORB } from '../utils/korb-logic.js';
import { EDI_TAB, EDI_SPALTEN, leseBestellXml } from '../utils/edi-bestellung.js';
import { ediVorschau, ediErzeugen, richteEdiEin, _customerIdCacheLeeren } from '../lib/lshopEdi.js';
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
    expect(aufrufe.update).toEqual([`'${EDI_TAB}'!A3:I3`]);
    expect(JSON.stringify(tabs[TAB_KORB])).toBe(korbVorher);
    const z = Object.fromEntries(EDI_SPALTEN.map((n, i) => [n, tabs[EDI_TAB][2][i]]));
    expect(z).toMatchObject({ order_id: 'JFN-2026-0002', Status: 'Entwurf', Positionen: '3', Stueck: '6', Commission: 'JFN Sammelbestellung KW43',
      Dateiname: 'JFN-2026-0002_20261022-1000.xml', Korb_Schluessel: 'JFN:10001:1 JFN:10002:7 EIGEN:2026-0001' });
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
    expect(w.log.join('\n')).toMatch(/✓ Reiter angelegt[\s\S]*✓ Config-Zeile 3 angelegt/);
    expect(tabs[EDI_TAB][0]).toEqual(EDI_SPALTEN);
    expect(tabs[EDI_TAB][1][0]).toBe('JFN-2026-0001');
    expect(tabs.Config[2]).toEqual(['lshop.customer_id', '', '', expect.stringMatching(/Debitorennummer/), '2026-10-22']);

    const n = aufrufe.update.length;
    const nochmal = await richteEdiEin({ write: true, sheets, jetzt: JETZT() });
    expect(aufrufe.update).toHaveLength(n);
    expect(nochmal.log.join('\n')).toMatch(/vorhanden.*JFN-2026-0001 vorhanden[\s\S]*Wert leer - nicht angefasst/);
  });

  test('gesetzter customer_id-Wert wird nie angefasst und nie ausgegeben', async () => {
    const { tabs, sheets, aufrufe } = aufbau({ cid: '12345678' });
    const r = await richteEdiEin({ write: true, sheets, jetzt: JETZT() });
    expect(aufrufe.update).toEqual([]);
    expect(tabs.Config[2][1]).toBe('12345678');
    expect(r.log.join('\n')).toMatch(/Wert gesetzt - nicht angefasst/);
    expect(r.log.join('\n')).not.toContain('12345678');
  });
});
