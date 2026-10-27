// BO4d: Unterreiter "L-Shop-Bestellungen" - Logik (utils/lshop-bestellungen.js), Lesen (lib/lshopBestellungen.js),
// Route, Korb ohne Bestelltes und der Anzeige-Block im Frontend. Nachgebildete Daten: eine Bestellung gesendet,
// eine bestaetigt, eine versandt mit 2 Paketen in 2 Lieferscheinen, eine teilweise geliefert, eine geliefert,
// dazu Entwurf/Testdatei (nie sichtbar) und Portal-Sendungen. Keine echten Kunden- oder Adressdaten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BESTELL_STATUS, STATUS_FOLGE, ediBestellZeilen, bestellStatus, baueBestellungen, lieferscheine, datumAusDatei } from '../utils/lshop-bestellungen.js';
import { leseLShopBestellungen } from '../lib/lshopBestellungen.js';
import { leseKorb } from '../lib/lshopKorb.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { KORB_SPALTEN, TAB_KORB, korbZeilen } from '../utils/korb-logic.js';
import { EDI_TAB, EDI_SPALTEN } from '../utils/edi-bestellung.js';
import { SENDUNGEN_TAB, SENDUNGEN_SPALTEN, sendungenZeilen, TRACKING_HOSTS } from '../utils/lshop-belege.js';
import { machSheets, grundTabs, NR, NR2 } from './hilfen/korb-sheet.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const JETZT = new Date('2026-11-10T12:00:00Z');
const URL1 = 'https://textilelogistics.eu/tracking/de/1/00000/VA1';

const korbZeile = o => KORB_SPALTEN.map(s => ({ Shop: 'JFN', Herkunft: 'shop', Status: 'bestellt', Menge: '1', LShop_ArticleNr: NR, ...o }[s] ?? ''));
const ediZeile = (id, status, schluessel = '') => EDI_SPALTEN.map(n => ({ order_id: id, Erzeugt: '2026-11-0' + id.slice(-1) + 'T08:00:00.000Z', Status: status, Positionen: '1', Stueck: '1', Commission: `KW45 ${id.slice(-1)}`, Korb_Schluessel: schluessel }[n] ?? ''));
const sendung = o => SENDUNGEN_SPALTEN.map(n => ({ Frachtfuehrer: 'DHL', Datei: 'DeliveryConfirmation_20261105204000.xml', ...o }[n] ?? ''));

function aufbau() {
  const tabs = grundTabs();
  tabs[TAB_KORB].push(
    korbZeile({ Schluessel: 'JFN:1:1', Bestellnummer: '1', Position: '1', Bestell_ID: 'JFN-2026-0003', Menge: '2' }),   // gesendet
    korbZeile({ Schluessel: 'JFN:2:1', Bestellnummer: '2', Position: '1', Bestell_ID: 'JFN-2026-0004' }),               // bestaetigt
    korbZeile({ Schluessel: 'JFN:3:1', Bestellnummer: '3', Position: '1', Bestell_ID: 'JFN-2026-0005', LShop_ArticleNr: NR2 }), // versandt
    korbZeile({ Schluessel: 'JFN:4:1', Bestellnummer: '4', Position: '1', Bestell_ID: 'JFN-2026-0006', Status: 'geliefert', Status_Datum: '2026-11-08T10:00:00.000Z' }),
    korbZeile({ Schluessel: 'JFN:4:2', Bestellnummer: '4', Position: '2', Bestell_ID: 'JFN-2026-0006' }),               // teilweise
    korbZeile({ Schluessel: 'JFN:5:1', Bestellnummer: '5', Position: '1', Bestell_ID: 'JFN-2026-0007', Status: 'geliefert', Status_Datum: '2026-11-09T10:00:00.000Z' }),
    korbZeile({ Schluessel: 'JFN:6:1', Bestellnummer: '6', Position: '1', Bestell_ID: 'JFN-2026-0008', Status: 'geliefert', Status_Datum: '2026-10-01T10:00:00.000Z' }), // geliefert, alt
    korbZeile({ Schluessel: 'EIGEN:2026-0001', Herkunft: 'eigen', Referenz: 'Muster', Status: 'bestellt' }),            // nur ueber Korb_Schluessel
    korbZeile({ Schluessel: 'JFN:9:1', Bestellnummer: '9', Position: '1', Status: 'offen' }),
    korbZeile({ Schluessel: 'JFN:9:2', Bestellnummer: '9', Position: '2', Status: 'abgewählt', Status_Datum: '2026-11-09T10:00:00.000Z' }),
    korbZeile({ Schluessel: 'JFN:9:3', Bestellnummer: '9', Position: '3', Status: 'Lager' }),
  );
  tabs[EDI_TAB] = [EDI_SPALTEN,
    ediZeile('JFN-2026-0001', 'Testdatei'), ediZeile('JFN-2026-0002', 'Entwurf'),
    ediZeile('JFN-2026-0003', 'gesendet'), ediZeile('JFN-2026-0004', 'bestätigt'), ediZeile('JFN-2026-0005', 'versandt'),
    ediZeile('JFN-2026-0006', 'versandt'), ediZeile('JFN-2026-0007', 'versandt'), ediZeile('JFN-2026-0008', 'versandt'),
    ediZeile('JFN-2026-0009', 'gesendet', 'EIGEN:2026-0001'),
  ];
  tabs[SENDUNGEN_TAB] = [SENDUNGEN_SPALTEN,
    sendung({ Paketnummer: '1', VA: 'VA00000005', LA: 'LA00000051', order_id: 'JFN-2026-0005', Tracking_URL: URL1 }),
    sendung({ Paketnummer: '2', VA: 'VA00000005', LA: 'LA00000052', order_id: 'JFN-2026-0005', Tracking_URL: 'javascript:alert(1)', Datei: 'DeliveryConfirmation_20261106204000.xml' }),
    sendung({ Paketnummer: '3', VA: 'VA00000006', LA: 'LA00000061', order_id: 'JFN-2026-0006', Wareneingang: '08.11.2026' }),
    sendung({ Paketnummer: '8', VA: 'VA00000090', LA: 'LA00000091', order_id: '', Tracking_URL: URL1, Datei: 'DeliveryConfirmation_20261101204000.xml' }),
    sendung({ Paketnummer: '9', VA: 'VA00000090', LA: 'LA00000092', order_id: '', Datei: 'DeliveryConfirmation_20261102204000.xml' }),
    sendung({ Paketnummer: '7', VA: 'VA00000080', LA: 'LA00000081', order_id: '', Datei: 'DeliveryConfirmation_20260901204000.xml' }),
  ];
  return { tabs, ...machSheets(tabs) };
}

beforeEach(() => { process.env.GOOGLE_SHEET_ID = 'ssot'; _resetLShopCache(); });

describe('Logik', () => {
  test('nur Bestellungen ab "gesendet" (Entwurf/Testdatei nie)', () => {
    const { tabs } = aufbau();
    expect(ediBestellZeilen(tabs[EDI_TAB]).map(b => b.orderId)).toEqual(['JFN-2026-0003', 'JFN-2026-0004', 'JFN-2026-0005', 'JFN-2026-0006', 'JFN-2026-0007', 'JFN-2026-0008', 'JFN-2026-0009']);
    expect(() => ediBestellZeilen([['x']])).toThrow(/order_id\/Status/);
  });

  test('Statusfolge aus den Daten', () => {
    expect(STATUS_FOLGE).toEqual(['gesendet', 'bestätigt', 'versandt', 'teilweise geliefert', 'geliefert']);
    const p = s => ({ status: s });
    expect(bestellStatus({ ediStatus: 'gesendet', positionen: [p('bestellt')] })).toBe(BESTELL_STATUS.GESENDET);
    expect(bestellStatus({ ediStatus: 'bestätigt', positionen: [p('bestellt')] })).toBe(BESTELL_STATUS.BESTAETIGT);
    expect(bestellStatus({ ediStatus: 'versandt', positionen: [p('bestellt')], pakete: [{}] })).toBe(BESTELL_STATUS.VERSANDT);
    expect(bestellStatus({ ediStatus: 'versandt', positionen: [p('bestellt')], pakete: [{ wareneingang: '08.11.2026' }] })).toBe(BESTELL_STATUS.TEILWEISE);
    expect(bestellStatus({ ediStatus: 'versandt', positionen: [p('geliefert'), p('bestellt')] })).toBe(BESTELL_STATUS.TEILWEISE);
    expect(bestellStatus({ ediStatus: 'versandt', positionen: [p('geliefert'), p('geliefert')] })).toBe(BESTELL_STATUS.GELIEFERT);
    expect(bestellStatus({ ediStatus: 'versandt', positionen: [p('bestellt')] })).toBe(BESTELL_STATUS.BESTAETIGT);   // Daten unvollstaendig
  });

  test('Lieferscheine nach LA, Datum aus dem Dateinamen, nur textilelogistics-Links', () => {
    const z = sendungenZeilen(aufbau().tabs[SENDUNGEN_TAB]).filter(s => s.order_id === 'JFN-2026-0005');
    expect(lieferscheine(z)).toEqual([
      { la: 'LA00000051', va: 'VA00000005', datum: '2026-11-05', pakete: [{ paketnummer: '1', frachtfuehrer: 'DHL', url: URL1, wareneingang: '' }] },
      { la: 'LA00000052', va: 'VA00000005', datum: '2026-11-06', pakete: [{ paketnummer: '2', frachtfuehrer: 'DHL', url: '', wareneingang: '' }] },
    ]);
    expect(datumAusDatei('rechnung.pdf')).toBe('');
  });
});

describe('leseLShopBestellungen (nur lesen)', () => {
  test('gruppiert je Bestellung mit Status, Positionen, Lieferscheinen, Filter-Kennzeichen; Portal getrennt', async () => {
    const { sheets, aufrufe } = aufbau();
    const r = await leseLShopBestellungen({ shop: 'jfn', sheets, jetzt: () => JETZT });
    expect(r.nurJfn).toBe(false);
    const nach = Object.fromEntries(r.bestellungen.map(b => [b.orderId, b]));
    expect(r.bestellungen.map(b => [b.orderId, b.status])).toEqual([
      ['JFN-2026-0009', 'gesendet'], ['JFN-2026-0008', 'geliefert'], ['JFN-2026-0007', 'geliefert'], ['JFN-2026-0006', 'teilweise geliefert'],
      ['JFN-2026-0005', 'versandt'], ['JFN-2026-0004', 'bestätigt'], ['JFN-2026-0003', 'gesendet'],
    ]);
    expect(nach['JFN-2026-0005']).toMatchObject({ pakete: 2, va: ['VA00000005'], positionenZahl: 1, stueck: 1, gesendet: '' });
    expect(nach['JFN-2026-0005'].positionen[0]).toEqual({
      schluessel: 'JFN:3:1', articleNr: NR2, catalogNr: 'JH030F', bezeichnung: '', farbe: 'Deep Black', groesse: 'XL', menge: 1,
      reference: 'JFN-3-1', status: 'bestellt', statusDatum: '', liefertermin: '',
    });
    expect(nach['JFN-2026-0003']).toMatchObject({ stueck: 2, commission: 'KW45 3', erzeugt: '2026-11-03T08:00:00.000Z' });
    expect(nach['JFN-2026-0009'].positionen.map(p => [p.schluessel, p.reference])).toEqual([['EIGEN:2026-0001', 'Muster']]);   // ueber Korb_Schluessel
    expect(nach['JFN-2026-0007'].filter).toEqual({ unterwegs: false, geliefert: true });
    expect(nach['JFN-2026-0008'].filter).toEqual({ unterwegs: false, geliefert: false });   // aelter als 14 Tage
    expect(nach['JFN-2026-0006'].filter).toEqual({ unterwegs: true, geliefert: false });
    expect(r.portal.map(p => [p.va, p.datum, p.pakete, p.aelter, p.lieferscheine.length])).toEqual([
      ['VA00000090', '2026-11-02', 2, false, 2], ['VA00000080', '2026-09-01', 1, true, 1],
    ]);
    expect(aufrufe.update).toEqual([]);
    expect(aufrufe.batchUpdate).toEqual([]);
    expect(aufrufe.append).toBe(0);
  });

  test('HONK: nur JFN, nichts gelesen; fehlende Reiter: leer, kein Fehler', async () => {
    const { sheets } = aufbau();
    expect(await leseLShopBestellungen({ shop: 'honk', sheets })).toEqual({ nurJfn: true, bestellungen: [], portal: [], entwuerfe: [] });
    const leer = machSheets({ LShop_Modelle: grundTabs().LShop_Modelle });
    expect(await leseLShopBestellungen({ shop: 'jfn', sheets: leer.sheets, jetzt: () => JETZT })).toEqual({ nurJfn: false, bestellungen: [], portal: [], entwuerfe: [] });
  });

  test('Quelltext: nur Sheets lesen, kein Schreiben, kein FTP, kein Shop', () => {
    for (const f of ['../lib/lshopBestellungen.js', '../utils/lshop-bestellungen.js']) {
      const code = readFileSync(resolve(hier, f), 'utf8').replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/values\.(update|append|batchUpdate)|spreadsheets\.batchUpdate|lshopFtp|basic-ftp|getWcClient|fetch\(/);
    }
  });
});

describe('Warenkorb ohne Bestelltes (BO4d)', () => {
  test('GET Korb zeigt nur offen + herausgenommen, Zaehler "Alle" = beide, keine sendungen mehr; Zeilen unveraendert', async () => {
    const { tabs, sheets, aufrufe } = aufbau();
    const vorher = JSON.stringify(tabs[TAB_KORB]);
    const r = await leseKorb({ shop: 'jfn', sheets, jetzt: () => JETZT });
    const status = r.buendel.flatMap(b => b.positionen.map(p => p.status)).sort();
    expect(status).toEqual(['abgewählt', 'offen']);
    expect(r.summen.positionen).toBe(2);
    expect(r).not.toHaveProperty('sendungen');
    expect(JSON.stringify(tabs[TAB_KORB])).toBe(vorher);
    expect(aufrufe.update).toEqual([]);
    expect(korbZeilen(tabs[TAB_KORB]).zeilen).toHaveLength(11);
  });

  test('Frontend: Filter "Bestellt" und Block "Unterwegs von L-Shop" sind weg', () => {
    expect(html).not.toContain('data-filter="bestellt"');
    expect(html).not.toContain('uebersicht-unterwegs');
    expect(html).not.toMatch(/function (sendungHtml|unterwegsHtml)\b/);
    expect(html).not.toContain("'filter-bestellt'");
  });
});

describe('Frontend-Block L-Shop-Bestellungen', () => {
  const von = html.indexOf('// ── L-Shop-Bestellungen: Anfang');
  const bis = html.indexOf('// ── L-Shop-Bestellungen: Ende ──');
  const { lbListeHtml, lbZaehler, lbKarteHtml, LB_FILTER } = new Function(`${html.slice(von, bis)}\nreturn { lbListeHtml, lbZaehler, lbKarteHtml, LB_FILTER };`)();
  let daten;
  beforeAll(async () => {
    process.env.GOOGLE_SHEET_ID = 'ssot';
    _resetLShopCache();
    daten = await leseLShopBestellungen({ shop: 'jfn', sheets: aufbau().sheets, jetzt: () => JETZT });
  });

  test('Filter Unterwegs / Geliefert (14 Tage) / Alle', () => {
    expect(LB_FILTER).toEqual(['unterwegs', 'geliefert', 'alle']);
    expect(lbZaehler(daten)).toEqual({ unterwegs: 5, geliefert: 1, alle: 7 });
    const ids = f => [...lbListeHtml(daten, f).matchAll(/data-order="([^"]+)"/g)].map(m => m[1]);
    expect(ids('unterwegs')).toEqual(['JFN-2026-0009', 'JFN-2026-0006', 'JFN-2026-0005', 'JFN-2026-0004', 'JFN-2026-0003']);
    expect(ids('geliefert')).toEqual(['JFN-2026-0007']);
    expect(ids('alle')).toHaveLength(7);
  });

  test('Karte: Kopf, Status-Etikett, Positionen, Lieferscheine mit Paket-Links, "folgt"-Hinweise ohne Knoepfe', () => {
    const b = daten.bestellungen.find(x => x.orderId === 'JFN-2026-0005');
    const h = lbKarteHtml(b, true);
    expect(h).toMatch(/^<details class="lb-karte" data-order="JFN-2026-0005" open>/);
    expect(h).toContain('<strong>JFN-2026-0005</strong> · VA00000005 · erstellt am 5.11.2026 · 1 Pos. / 1 Stk · KW45 5');
    expect(h).toContain('<span class="lb-status lb-st-versandt">versandt · 2 Pakete</span>');
    expect(h).toContain('JH030F · Deep Black · XL <strong>×1</strong>');
    expect(h).toContain(`LA00000051 · 5.11.2026 · 1 Paket · DHL · <a href="${URL1}" target="_blank" rel="noopener noreferrer" data-hilfe="tracking">Paket 1</a>`);
    expect(h).toContain('LA00000052 · 6.11.2026 · 1 Paket · DHL · Paket 1');   // kein Link fuer fremde URL; BO4g: Frachtfuehrer aus den Daten
    expect(h).not.toContain('javascript:');
    expect(h).toContain('<span class="lb-folgt">Liefertermin folgt</span>');
    expect(h).toContain('<span class="lb-folgt">Wareneingang folgt</span>');
    // BO4b-5: einziger Knopf auf der Karte ist "Ware angekommen …"
    expect(h.match(/<button[^>]*>/g)).toEqual([expect.stringContaining('data-eingang="JFN-2026-0005"')]);
    const teil = lbKarteHtml(daten.bestellungen.find(x => x.orderId === 'JFN-2026-0006'), false);
    expect(teil).toMatch(/^<details class="lb-karte" data-order="JFN-2026-0006">/);
    expect(teil).toContain('lb-st-teilweise');
    expect(teil).toContain('<strong>eingegangen</strong>');
    expect(lbKarteHtml(daten.bestellungen.find(x => x.orderId === 'JFN-2026-0003'), true)).toContain('noch keine Lieferung');
  });

  test('Portalbestellungen eingeklappt, 30 Tage, "ältere anzeigen"', () => {
    const h = lbListeHtml(daten, 'unterwegs');
    expect(h).toMatch(/<details class="lb-portal"><summary data-hilfe="portal">Portalbestellungen \(letzte 30 Tage: 1 Lieferung, 2 Pakete\)<\/summary>/);
    expect(h).toContain('VA00000090');
    expect(h).not.toContain('VA00000080');
    expect(h).toContain('data-portal-aeltere="1" data-hilfe="portal-aeltere">ältere anzeigen (1)</button>');
    const alle = lbListeHtml(daten, 'unterwegs', true);
    expect(alle).toContain('VA00000080');
    expect(alle).toContain('Portalbestellungen (alle: 2 Lieferungen, 3 Pakete)');
    expect(alle).not.toContain('ältere anzeigen');
  });

  test('leer, nur JFN, maskiert', () => {
    expect(lbListeHtml({ nurJfn: true }, 'alle')).toContain('nur für JammiFashion (JFN)');
    expect(lbListeHtml({ bestellungen: [], portal: [] }, 'unterwegs')).toContain('Keine Bestellung unterwegs.');
    const boese = { ...daten.bestellungen[0], orderId: '<img src=x>', commission: '"><b>x</b>' };
    const h = lbKarteHtml(boese, true);
    expect(h).not.toContain('<img');
    expect(h).not.toContain('<b>x');
  });

  test('Unterreiter, Panel, Laden nur beim Oeffnen, Hilfetexte', () => {
    expect(html).toContain('<div id="tab-lshop-bestellungen" class="sub-tab-panel">');
    expect(html).toMatch(/if \(btn\.dataset\.subtab === 'tab-lshop-bestellungen'\) loadLShopBestellungen\(\);/);
    expect(html).toContain("sub('tab-lshop-bestellungen', `L-Shop-Bestellungen (${kurz})`);");
    expect(html).toMatch(/\/api\/bestellen\/lshop-bestellungen`/);
    expect(html).toMatch(/bestellungen: \['entwuerfe', 'an-lshop-senden', 'als-gesendet', 'zurueck-entwurf', 'ware-angekommen', 'we-buchen', 'we-zurueck', 'lb-unterwegs', 'lb-geliefert', 'lb-alle', 'tracking', 'portal', 'portal-aeltere'\]/);
    expect(html).toContain("'filter-alle':          { name: 'Alle', text: 'Alles, was noch nicht bestellt ist: offen und herausgenommen.' }");
  });
});

// ── BO4e ─────────────────────────────────────────────────────────────────────

describe('BO4e: Entwuerfe, Tracking-Liste, Versandart im Dialog', () => {
  const von = html.indexOf('// ── L-Shop-Bestellungen: Anfang');
  const bis = html.indexOf('// ── L-Shop-Bestellungen: Ende ──');
  const { lbListeHtml, lbEntwuerfeHtml, LB_TRACKING } = new Function(`${html.slice(von, bis)}\nreturn { lbListeHtml, lbEntwuerfeHtml, LB_TRACKING };`)();
  const e = o => ({ orderId: 'JFN-2026-0004', erzeugt: '2026-10-26T10:00:00Z', positionen: 2, stueck: 3, commission: 'KW44', versandart: 'GLS',
    offen: 2, ueberholt: false, ganzUeberholt: false, ...o });

  test('Knopf nur, wenn jede Position offen ist; ueberholt ohne Knopf; Abschnitt nur mit Entwuerfen', () => {
    const h = lbEntwuerfeHtml([e(), e({ orderId: 'JFN-2026-0002', offen: 0, ueberholt: true, ganzUeberholt: true }), e({ orderId: 'JFN-2026-0003', offen: 1, ueberholt: true })]);
    expect(h).toContain('Entwürfe – noch nicht gesendet');
    expect(h.match(/data-gesendet=/g)).toHaveLength(1);
    expect(h).toContain('data-gesendet="JFN-2026-0004" data-hilfe="als-gesendet">Als gesendet markieren</button>');
    expect(h).toContain('überholt – keine offene Position');
    expect(h).toContain('teilweise überholt: 1 von 2 Positionen offen – nicht markierbar');
    expect(h).toContain('Versand GLS');
    expect(lbEntwuerfeHtml([])).toBe('');
    expect(lbListeHtml({ bestellungen: [], portal: [], entwuerfe: [e()] }, 'unterwegs')).toMatch(/^<div class="lb-entwuerfe">/);
    expect(lbEntwuerfeHtml([e({ orderId: '<b>x</b>' })])).not.toContain('<b>x');
  });

  test('Tracking-Liste im Browser = TRACKING_HOSTS im Backend (kein Host ohne Messung)', () => {
    expect(LB_TRACKING).toEqual(TRACKING_HOSTS);
    expect(TRACKING_HOSTS).toEqual(['https://textilelogistics.eu/']);
  });

  test('EDI-Dialog: Auswahl Versandart, Liste vom Server, Wechsel prueft neu; Knopf ruft .../edi/gesendet mit Bestaetigung', () => {
    expect(html).toContain('<select id="edi-versandart" class="form-select" data-hilfe="versandart"></select>');
    expect(html).toMatch(/versandart: ediZustand\.vorschau \? va : undefined/);
    expect(html).toMatch(/getElementById\('edi-versandart'\)\?\.addEventListener\('change'/);
    expect(html).toMatch(/\/api\/bestellen\/lshop-korb\/edi\/gesendet`/);
    expect(html).toMatch(/const ok = await showConfirm\(/);
  });
});
