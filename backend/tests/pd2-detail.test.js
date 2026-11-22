// PD2: Detailansicht fuer ausgewaehlte Festpreis-Partner - Umsatz und Erloes je Monat, Top 10. Nur bei Schalter "ja".
// Erloes (Inhaber 21.11., A) = VK-Netto − (Festpreis + Handlingskosten) × Stueck − Mehrkosten, brutto. Nur ERFUNDENE Daten.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

jest.unstable_mockModule('googleapis', () => ({ google: { sheets: jest.fn() } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: jest.fn().mockResolvedValue({}) }));
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: jest.fn(),
  getShopConfig: jest.fn(() => ({ shop: 'jfn', tabVerkaeufe: 'Partner_Verkäufe', tabAbrechnungen: 'Partner_Abrechnungen' })),
  normalizeShop: jest.fn(s => s ?? 'jfn'),
}));
jest.unstable_mockModule('../lib/chatNotify.js', () => ({ notify: jest.fn(), buildPartnerNachricht: jest.fn() }));

const { fpBetragsUebersicht, detailAn, uebersichtAntwort, verkaufsUebersicht } = await import('../utils/partner-uebersicht.js');
const hier = dirname(fileURLToPath(import.meta.url));

const H = ['Datum', 'WC-Bestellnummer', 'Partner-ID', 'Artikelname', 'Stückzahl', 'Festpreis', 'Handlingskosten', 'Mehrkosten', 'VK-Netto', 'Storno-Status', 'Status Abrechnung', 'Porto_Bestellung'];
const z = (datum, nr, art, q, f, hk, m, vk, storno = '', status = 'offen', porto = '') => [datum, nr, 'FP-901', art, String(q), String(f), String(hk), String(m), String(vk), storno, status, String(porto)];
const ROWS = [
  z('10.12.2025', 'A', 'Muster-Shirt', 2, 9, 1, 0, 40, '', 'abgerechnet', 6),
  z('05.01.2026', 'A', 'Muster-Shirt', -2, -9, -1, 0, -40, 'Storniert/Rückerstattet', 'offen', -6),   // Storno im Januar -> Dezember 2025
  z('03.02.2026', 'B', 'Muster-Hoodie', 1, 12, 1, 2, 30),                                      // VK nach Gutschein, Mehrkosten 2
  z('10.03.2026', 'C', 'Muster-Becher', 3, 4, 0.5, 0, 27),
  z('15.03.2026', 'C', 'Muster-Becher', -1, -4, -0.5, 0, -9, 'Erstattung #9'),                  // Teilerstattung 1 Stueck
  z('16.03.2026', 'C', 'Muster-Becher', 0, 0, 0, 0, 0, 'Versanderstattung #10', 'offen', -4.2),  // Porto zaehlt nie
  z('01.11.2026', 'D', 'Muster-Shirt', 1, '', '', 0, 20, '', 'gesperrt'),                        // Festpreis fehlt: nur Umsatz
  [...z('01.11.2026', 'E', 'Fremd', 5, 1, 1, 0, 99), ''].map((v, i) => (i === 2 ? 'FP-902' : v)),
];

describe('fpBetragsUebersicht (reine Logik)', () => {
  const d = fpBetragsUebersicht({ header: H, rows: ROWS, partnerId: 'FP-901', heute: '2026-11-21', mwstProzent: 19 });
  test('Umsatz brutto je Monat: Gutschein steckt im VK, Teilerstattung mindert, Porto nie, gesperrt zaehlt', () => {
    expect(d.reihe.umsatz.jahr).toEqual([0, 35.7, 21.42, 0, 0, 0, 0, 0, 0, 0, 23.8, null]);
    expect(d.umsatzJahr).toBe(80.92);
  });
  test('Erloes = VK − (Festpreis + Handling) × Stueck − Mehrkosten, brutto; gesperrt ohne Erloes', () => {
    expect(d.reihe.erloes.jahr).toEqual([0, 17.85, 10.71, 0, 0, 0, 0, 0, 0, 0, 0, null]);   // (30-13-2), (27-13.5) + (-9+4.5)
    expect(d.erloesJahr).toBe(28.56);
  });
  test('Jahreswechsel: Storno vom Januar hebt den Dezember auf; Vorjahr erst ab Dezember -> kein Vergleich', () => {
    expect(d.reihe.umsatz.vorjahr).toEqual([...Array(11).fill(null), 0]);
    expect(d.reihe.erloes.vorjahr[11]).toBe(0);
    expect(d.umsatzVorjahr).toBeNull(); expect(d.erloesVorjahr).toBeNull();
  });
  test('Top 10 nach Stueck: Artikel · Stueck · Umsatz · Erloes (laufendes Jahr, nur eigener Partner)', () => {
    expect(d.top10).toEqual([
      { name: 'Muster-Becher', stueck: 2, umsatz: 21.42, erloes: 10.71 },
      { name: 'Muster-Hoodie', stueck: 1, umsatz: 35.7, erloes: 17.85 },
      { name: 'Muster-Shirt', stueck: 1, umsatz: 23.8, erloes: 0 },
    ]);
  });
  test('Stueck-Reihe bleibt dieselbe wie in PD1', () => {
    const s = verkaufsUebersicht({ header: H, rows: ROWS, partnerId: 'FP-901', heute: '2026-11-21',
      spalten: { order: 'WC-Bestellnummer', artikel: 'Artikelname', status: 'Status Abrechnung', storno: 'Storno-Status' } });
    expect(s.reihe.jahr).toEqual([0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 1, null]);
  });
  test('Schalter: nur "ja" (Gross/Klein egal), leer/fehlt = aus', () => {
    const kopf = ['Partner-ID', 'Detailansicht'];
    expect(detailAn(kopf, ['FP-1', 'ja'])).toBe(true);
    expect(detailAn(kopf, ['FP-1', ' JA '])).toBe(true);
    expect(detailAn(kopf, ['FP-1', ''])).toBe(false);
    expect(detailAn(kopf, ['FP-1', 'nein'])).toBe(false);
    expect(detailAn(['Partner-ID'], ['FP-1'])).toBe(false);
    expect(detailAn(kopf, undefined)).toBe(false);
  });
  test('Antwort ohne Schalter hat KEINEN Schluessel detail', () => {
    const stat = { stand: { offen: 0, inPruefung: 0 }, jahr: 2026, monat: 10, reihe: { jahr: [], vorjahr: [] }, vorjahrDaten: false, vorjahrAb: null,
      stueckJahr: 0, stueckVorjahr: null, top5: [], ohneVerkaeufe: true };
    expect(uebersichtAntwort({ auszahlung: {}, statistik: stat })).not.toHaveProperty('detail');
    expect(Object.keys(uebersichtAntwort({ auszahlung: {}, statistik: stat, detail: d }).detail).sort())
      .toEqual(['erloesJahr', 'erloesVorjahr', 'reihe', 'top10', 'umsatzJahr', 'umsatzVorjahr']);
  });
});

// ── Route mit In-Memory-Sheet ──
const FVH = ['Datum', 'WC-Bestellnummer', 'Partner-ID', 'Artikelname', 'Artikelkategorie', 'Stückzahl', 'VK-Netto', 'PayPal-Gebühren', 'Porto-Einnahme',
  'Porto-Kosten', 'Versandnebenkosten', 'Festpreis', 'Handlingskosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto', 'Storno-Status', 'Status Abrechnung', 'Mehrkosten', 'Produkt-ID'];
const fv = (pid, datum, nr, art, q, vk, f, hk) => [datum, nr, pid, art, 'Shirt', String(q), String(vk), '0', '0', '0', '0', String(f), String(hk), '1', '1.19', '', 'offen', '0'];
let tabs, request, fpApp, portalApp, values, fpPublic, partnerPortal;
const tabsNeu = (schalter) => ({
  FP_Partner: [['Partner-ID', 'Name', 'Token', 'Aktiv', 'Detailansicht'], ['FP-901', 'FP Test', 'fptok', 'ja', schalter], ['FP-902', 'FP Zwei', 'fptok2', 'ja', '']],
  'FP_Verkäufe': [FVH, fv('FP-901', '03.11.2026', '7001', 'Muster-Becher', 3, 27, 4, 0.5), fv('FP-902', '03.11.2026', '7002', 'Andere', 1, 10, 2, 0)],
  FP_Abrechnungen: [['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Gesamt-Netto', 'Gesamt-Brutto', 'Status']],
  Partner_Interne_Bestellungen: [['Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Einzelpreis', 'Summe', 'Status', 'Kanal', 'Fulfillment']],
  Kalkulation_Fixkosten: [['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis'], ['MwSt', '19', '%', '01.01.2022', '']],
  Partner: [['Partner-ID', 'Name', 'Hauptkategorie', 'Token', 'Aktiv', 'Lizenz-%', 'Versand-Modell', 'PayPal-Modell', 'Notiz', 'Porto-Modell', 'Shop', 'Vertrag-ab', 'Detailansicht'],
    ['P-901', 'Lizenz Test', 'K', 'tok901', 'Ja', '20', '', '', '', 'geteilt-50-50', 'jfn', '01.01.2026', 'ja']],
  'Partner_Verkäufe': [['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status', 'Produkt-ID', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status'],
    ['P-901', '05.11.2026', '5002', 'Muster-Shirt', '0', '2', '40', '4', 'offen', '1', '', '', '', '', '']],
  Partner_Abrechnungen: [['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Verkaufs-Guthaben', 'Saldo', 'Status', 'Erstellt-Am', 'Notiz', 'Positionen']],
});

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'biz';
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  const tab = range => String(range).split('!')[0].replace(/^'(.*)'$/, '$1');
  values = {
    get: jest.fn(async ({ range }) => ({ data: { values: (tabs[tab(range)] ?? []).map(r => [...r]) } })),
    batchGet: jest.fn(async ({ ranges }) => ({ data: { valueRanges: ranges.map(r => ({ values: (tabs[tab(r)] ?? []).map(x => [...x]) })) } })),
  };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values, get: jest.fn(async () => ({ data: { sheets: [] } })) } });
  fpPublic = await import('../routes/festpreis-public.js');
  partnerPortal = await import('../routes/partnerPortal.js');
  fpApp = express(); fpApp.use('/api/festpreis-public', fpPublic.default);
  fpApp.use((err, _q, res, _n) => res.status(err.status ?? 500).json({ error: err.message }));
  portalApp = express(); portalApp.use('/api/partner', partnerPortal.default);
  portalApp.use((err, _q, res, _n) => res.status(err.status ?? 500).json({ error: err.message }));
});
beforeEach(() => { fpPublic._fpUebersichtSpeicherLeeren(); partnerPortal._uebersichtSpeicherLeeren(); });

describe('GET /api/festpreis-public/uebersicht mit Schalter', () => {
  test('Schalter "ja": detail mit Umsatz/Erloes/Top 10, nur eigene Zeilen', async () => {
    tabs = tabsNeu('ja');
    const r = await request(fpApp).get('/api/festpreis-public/uebersicht').set('Authorization', 'Bearer fptok');
    expect(r.status).toBe(200);
    expect(r.body.detail.umsatzJahr).toBe(32.13);    // 27 × 1,19
    expect(r.body.detail.erloesJahr).toBe(16.07);    // (27 − 4,5 × 3) × 1,19
    expect(r.body.detail.top10).toEqual([{ name: 'Muster-Becher', stueck: 3, umsatz: 32.13, erloes: 16.07 }]);
    expect(JSON.stringify(r.body)).not.toMatch(/Andere|7001|7002|FP-90/);
  });
  test('ohne Schalter (leer) und fuer andere Partner: KEINE Betragsfelder in der Antwort', async () => {
    tabs = tabsNeu('');
    const r = await request(fpApp).get('/api/festpreis-public/uebersicht').set('Authorization', 'Bearer fptok');
    expect(r.body).not.toHaveProperty('detail');
    expect(JSON.stringify(r.body)).not.toMatch(/umsatz|erloes/i);
    tabs = tabsNeu('ja'); fpPublic._fpUebersichtSpeicherLeeren();
    const r2 = await request(fpApp).get('/api/festpreis-public/uebersicht').set('Authorization', 'Bearer fptok2');
    expect(r2.body).not.toHaveProperty('detail');
  });
  test('Lizenz-Portal: Schalter vorerst ohne Wirkung', async () => {
    tabs = tabsNeu('ja');
    const r = await request(portalApp).get('/api/partner/uebersicht').set('Authorization', 'Bearer tok901');
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty('detail');
  });
});

describe('Quelltext', () => {
  test('Setup-Skript: Trockenlauf Standard, nur Kopfzelle, Raster vorher erweitern', () => {
    const q = readFileSync(resolve(hier, '../scripts/setup-partner-detailansicht.js'), 'utf8');
    expect(q).toContain("const WRITE = process.argv.includes('--write');");
    expect(q).toMatch(/sichereSpaltenRaster\(sheets, SHEET, p\.tab, p\.index \+ 1\)/);
    expect(q).toContain("const TABS = ['FP_Partner', 'Partner'];");
    expect(q).not.toMatch(/'ja'/);   // "ja" setzt nur der Inhaber
  });
});
