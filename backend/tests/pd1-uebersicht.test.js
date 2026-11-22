// PD1: Partner-Dashboard Stufe 1 - Stueck je Monat mit Vorjahr, Top 5, Stand, Auszahlung aus der bestehenden Saldo-Rechnung.
// Nur ERFUNDENE Partner, Artikel und Zahlen.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

jest.unstable_mockModule('googleapis', () => ({ google: { sheets: jest.fn() } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: jest.fn().mockResolvedValue({}) }));
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: jest.fn(),
  getShopConfig: jest.fn(shop => shop === 'honk'
    ? { shop: 'honk', tabVerkaeufe: 'HK_Partner_Verkäufe', tabAbrechnungen: 'HK_Partner_Abrechnungen' }
    : { shop: 'jfn', tabVerkaeufe: 'Partner_Verkäufe', tabAbrechnungen: 'Partner_Abrechnungen' }),
  normalizeShop: jest.fn(s => s ?? 'jfn'),
}));
jest.unstable_mockModule('../lib/chatNotify.js', () => ({ notify: jest.fn(), buildPartnerNachricht: jest.fn() }));

const { verkaufsUebersicht, uebersichtAntwort, jahrMonat, bauZwischenspeicher } = await import('../utils/partner-uebersicht.js');
const hier = dirname(fileURLToPath(import.meta.url));
const SP = { order: 'Order-ID', artikel: 'Artikelnummer', status: 'Status', storno: 'Storno-Status' };
const VH = ['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status', 'Produkt-ID', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status'];
const v = (pid, datum, order, artikel, stueck, lizenz, status, storno = '') => [pid, datum, order, artikel, '0', String(stueck), '20', lizenz, status, '1', '', '', '', '', storno];

describe('verkaufsUebersicht (reine Logik)', () => {
  const rows = [
    v('P-901', '15.03.2025', '1001', 'Muster-Hoodie', 2, '4', 'abgerechnet'),        // Vorjahr ab Maerz
    v('P-901', '20.11.2025', '1002', 'Muster-Shirt', 3, '6', 'abgerechnet'),
    v('P-901', '30.12.2025', '1003', 'Muster-Shirt', 2, '4', 'abgerechnet'),
    v('P-901', '05.01.2026', '1003', 'Muster-Shirt', -2, '-4', 'offen', 'Storniert/Rückerstattet'),   // Storno im Januar -> Dezember 2025
    v('P-901', '10.02.2026', '2001', 'Muster-Hoodie', 4, '8', 'abgerechnet'),
    v('P-901', '12.02.2026', '2001', 'Muster-Hoodie', -1, '-2', 'offen', 'Erstattung #77'),   // Teilerstattung mindert
    v('P-901', '12.02.2026', '2001', 'Muster-Hoodie', 0, '-1', 'offen', 'Versanderstattung #78'),   // zaehlt nicht
    v('P-901', '01.11.2026', '3001', 'Muster-Tasse', 5, '5', 'offen'),
    v('P-901', '02.11.2026', '3002', 'Muster-Mütze', 1, '', 'gesperrt'),   // in Pruefung zaehlt als Stueck
    v('P-901', '03.11.2026', '3003', 'Muster-Shirt', 1, '2', 'offen'),
    v('P-902', '01.11.2026', '9999', 'Fremder Artikel', 50, '50', 'offen'),   // fremder Partner
  ];
  const r = verkaufsUebersicht({ header: VH, rows, partnerId: 'P-901', spalten: SP, heute: '2026-11-21' });

  test('Monatsreihe laufendes Jahr: Zukunft null, Storno/Teilerstattung im Bestellmonat', () => {
    expect(r.jahr).toBe(2026); expect(r.monat).toBe(10);
    expect(r.reihe.jahr).toEqual([0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 7, null]);   // Feb 4-1, Nov 5+1+1
    expect(r.stueckJahr).toBe(10);
  });
  test('Vorjahr: vor dem ersten Datenmonat null, Storno vom Januar mindert den Dezember (Jahreswechsel)', () => {
    expect(r.reihe.vorjahr).toEqual([null, null, 2, 0, 0, 0, 0, 0, 0, 0, 3, 0]);
    expect(r.vorjahrDaten).toBe(true);
    expect(r.vorjahrAb).toBe(2);
    expect(r.stueckVorjahr).toBeNull();   // Vorjahr deckt Januar..November nicht ganz ab -> kein Vergleich
  });
  test('Top 5 laufendes Jahr nach Stueck (netto), Stand offen / in Pruefung', () => {
    expect(r.top5).toEqual([{ name: 'Muster-Tasse', stueck: 5 }, { name: 'Muster-Hoodie', stueck: 3 }, { name: 'Muster-Mütze', stueck: 1 }, { name: 'Muster-Shirt', stueck: 1 }]);
    expect(r.stand).toEqual({ offen: 3, inPruefung: 1 });   // offen: -2 -1 +0 +5 +1 = 3
  });
  test('Vorjahr vollstaendig -> Vergleich; ohne Vorjahr -> null; ohne Verkaeufe', () => {
    const voll = verkaufsUebersicht({ header: VH, partnerId: 'P-1', spalten: SP, heute: '2026-03-05',
      rows: [v('P-1', '10.01.2025', 'a', 'X', 2, '1', 'abgerechnet'), v('P-1', '10.03.2026', 'b', 'X', 4, '1', 'offen')] });
    expect(voll.stueckVorjahr).toBe(2); expect(voll.stueckJahr).toBe(4);
    const neu = verkaufsUebersicht({ header: VH, partnerId: 'P-1', spalten: SP, heute: '2026-03-05', rows: [v('P-1', '10.03.2026', 'b', 'X', 4, '1', 'offen')] });
    expect(neu.vorjahrDaten).toBe(false); expect(neu.reihe.vorjahr.every(x => x === null)).toBe(true); expect(neu.vorjahrAb).toBeNull();
    const leer = verkaufsUebersicht({ header: VH, partnerId: 'P-1', spalten: SP, heute: '2026-03-05', rows: [] });
    expect(leer).toMatchObject({ ohneVerkaeufe: true, stueckJahr: 0, top5: [], vorjahrDaten: false });
  });
  test('Datum TT.MM.JJJJ und ISO', () => {
    expect(jahrMonat('5.1.2026')).toEqual({ jahr: 2026, monat: 0 });
    expect(jahrMonat('2026-12-31')).toEqual({ jahr: 2026, monat: 11 });
    expect(jahrMonat('kaputt')).toBeNull();
  });
  test('Antwort: feste Felder, keine Bestellnummern', () => {
    const a = uebersichtAntwort({ auszahlung: { saldo: 1.5, seit: '01.10.2026', saldoKachel: true, intern: 1, internOhneBetrag: 0, bestellungen: 9, partnerId: 'P-901' }, statistik: r });
    expect(Object.keys(a).sort()).toEqual(['auszahlung', 'jahr', 'monat', 'ohneVerkaeufe', 'reihe', 'stand', 'stueckJahr', 'stueckVorjahr', 'top5', 'vorjahrAb', 'vorjahrDaten']);
    expect(Object.keys(a.auszahlung).sort()).toEqual(['abgerechnetBis', 'ausstehend', 'ausstehendAnzahl', 'inPruefung', 'intern', 'internOhneBetrag', 'laufend', 'saldo', 'saldoKachel', 'seit']);
    expect(a.auszahlung).toMatchObject({ ausstehend: 0, laufend: 1.5, abgerechnetBis: '' });   // GS2: ohne Aufteilung = alles laufend
    for (const nr of ['1001', '1002', '1003', '2001', '3001', 'P-901']) expect(JSON.stringify(a)).not.toContain(nr);
  });
  test('Zwischenspeicher: zweiter Aufruf laedt nicht, nach Ablauf wieder', async () => {
    let jetzt = 0; const laden = jest.fn(async () => ({ n: 1 }));
    const z = bauZwischenspeicher(600000, () => jetzt);
    await z.hole('a', laden); await z.hole('a', laden);
    expect(laden).toHaveBeenCalledTimes(1);
    jetzt = 600001; await z.hole('a', laden);
    expect(laden).toHaveBeenCalledTimes(2);
  });
});

// ── Routen mit In-Memory-Sheet: Lesungen zaehlen ──
const IH = ['Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Einzelpreis', 'Summe', 'Status', 'Kanal', 'Fulfillment'];
const AH = ['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Verkaufs-Guthaben', 'Saldo', 'Status', 'Erstellt-Am', 'Notiz', 'Positionen'];
const PH = ['Partner-ID', 'Name', 'Hauptkategorie', 'Token', 'Aktiv', 'Lizenz-%', 'Versand-Modell', 'PayPal-Modell', 'Notiz', 'Porto-Modell', 'Shop', 'Vertrag-ab'];
const FIX = [['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis'], ['MwSt', '19', '%', '01.01.2022', '']];
const FVH = ['Datum', 'WC-Bestellnummer', 'Partner-ID', 'Artikelname', 'Artikelkategorie', 'Stückzahl', 'VK-Netto', 'PayPal-Gebühren', 'Porto-Einnahme',
  'Porto-Kosten', 'Versandnebenkosten', 'Festpreis', 'Handlingskosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto', 'Storno-Status', 'Status Abrechnung', 'Produkt-ID'];
const fv = (datum, nr, art, stueck, netto, status) => [datum, nr, 'FP-901', art, 'Shirt', String(stueck), '20', '0', '0', '0', '0', '10', '1', netto, '', '', status];

function tabsNeu() {
  return {
    'Partner_Verkäufe': [VH, v('P-901', '05.10.2026', '5002', 'Muster-Shirt', 2, '4', 'offen'), v('P-901', '07.10.2026', '5003', 'Muster-Tasse', 1, '', 'gesperrt'),
      v('P-902', '05.10.2026', '6001', 'Fremd', 3, '50', 'offen')],
    Partner_Interne_Bestellungen: [IH, ['P-901', '10.10.2026', 'Muster', '1', '1', '1', 'offen', 'Portal', ''], ['FP-901', '10.10.2026', 'Muster', '1', '', '', 'offen', 'Portal', '']],
    Partner_Abrechnungen: [AH, ['A-1', 'P-901', '01.08.2026', '30.09.2026', '3', '3', 'bezahlt', '01.10.2026', '', '{}']],
    Partner: [PH, ['P-901', 'Testpartner', 'K', 'tok901', 'Ja', '20', '', '', '', 'geteilt-50-50', 'jfn', '01.01.2026']],
    Kalkulation_Fixkosten: FIX,
    FP_Partner: [['Partner-ID', 'Name', 'Token', 'Aktiv', 'Vertrag-ab'], ['FP-901', 'FP Test', 'fptok', 'ja', '01.02.2026']],
    'FP_Verkäufe': [FVH, fv('03.11.2026', '7001', 'Muster-Becher', 3, '27', 'offen'), fv('04.11.2026', '7002', 'Muster-Becher', 1, '9', 'gesperrt')],
    FP_Abrechnungen: [['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Gesamt-Netto', 'Gesamt-Brutto', 'Status'], ['FA-1', 'FP-901', '01.08.2026', '31.10.2026', '0', '0', 'bezahlt']],
  };
}

let tabs, request, portalApp, fpApp, values, partnerPortal, fpPublic;
beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'biz';
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  const tab = range => String(range).split('!')[0].replace(/^'(.*)'$/, '$1');
  values = {
    get: jest.fn(async ({ range }) => ({ data: { values: (tabs[tab(range)] ?? []).map(r => [...r]) } })),
    batchGet: jest.fn(async ({ ranges }) => ({ data: { valueRanges: ranges.map(r => ({ values: (tabs[tab(r)] ?? []).map(x => [...x]) })) } })),
    batchUpdate: jest.fn(), append: jest.fn(), update: jest.fn(),
  };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values, get: jest.fn(async () => ({ data: { sheets: [] } })), batchUpdate: jest.fn() } });
  partnerPortal = await import('../routes/partnerPortal.js');
  fpPublic = await import('../routes/festpreis-public.js');
  portalApp = express(); portalApp.use('/api/partner', partnerPortal.default);
  portalApp.use((err, _q, res, _n) => res.status(err.status ?? 500).json({ error: err.message }));
  fpApp = express(); fpApp.use('/api/festpreis-public', fpPublic.default);
  fpApp.use((err, _q, res, _n) => res.status(err.status ?? 500).json({ error: err.message }));
});
beforeEach(() => {
  tabs = tabsNeu();
  values.get.mockClear(); values.batchGet.mockClear();
  partnerPortal._uebersichtSpeicherLeeren(); fpPublic._fpUebersichtSpeicherLeeren();
});

describe('Lizenz: GET /api/partner/uebersicht', () => {
  test('Zahlen wie die Kacheln, Stand, Top 5; nur eigene; keine Bestellnummer', async () => {
    const r = await request(portalApp).get('/api/partner/uebersicht?shop=jfn').set('Authorization', 'Bearer tok901');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const k = await request(portalApp).get('/api/partner/kacheln?shop=jfn').set('Authorization', 'Bearer tok901');
    expect(r.body.auszahlung).toMatchObject({ saldo: k.body.saldo, seit: k.body.seit, intern: 1, saldoKachel: true });
    expect(r.body.stand).toEqual({ offen: 2, inPruefung: 1 });
    expect(r.body.top5.map(x => x.name)).toEqual(['Muster-Shirt', 'Muster-Tasse']);
    for (const s of ['5002', '5003', '6001', 'Fremd', 'P-902', 'tok901']) expect(JSON.stringify(r.body)).not.toContain(s);
    expect((await request(portalApp).get('/api/partner/uebersicht')).status).toBe(401);
  });
  test('Lesungen: 1 (Token) + 1 Sammelabruf; zweiter Aufruf nur noch der Token-Abruf', async () => {
    await request(portalApp).get('/api/partner/uebersicht?shop=jfn').set('Authorization', 'Bearer tok901');
    expect(values.get).toHaveBeenCalledTimes(1);
    expect(values.batchGet).toHaveBeenCalledTimes(1);
    expect(values.batchGet.mock.calls[0][0].ranges).toHaveLength(5);
    values.get.mockClear(); values.batchGet.mockClear();
    tabs['Partner_Verkäufe'].push(v('P-901', '08.10.2026', '5004', 'Neu', 9, '1', 'offen'));
    const r2 = await request(portalApp).get('/api/partner/uebersicht?shop=jfn').set('Authorization', 'Bearer tok901');
    expect(values.get).toHaveBeenCalledTimes(1);   // nur der Token
    expect(values.batchGet).not.toHaveBeenCalled();
    expect(r2.body.stand.offen).toBe(2);   // aus dem Zwischenspeicher
  });
});

describe('Festpreis: GET /api/festpreis-public/uebersicht', () => {
  test('Auszahlung = /saldo, Stand, seit, interne ohne Betrag; keine Bestellnummer', async () => {
    const r = await request(fpApp).get('/api/festpreis-public/uebersicht').set('Authorization', 'Bearer fptok');
    expect(r.status).toBe(200);
    const s = await request(fpApp).get('/api/festpreis-public/saldo').set('Authorization', 'Bearer fptok');
    expect(s.body._intern).toBeUndefined();
    expect(r.body.auszahlung).toMatchObject({ saldo: s.body.saldoBrutto, seit: '01.11.2026', intern: 1, internOhneBetrag: 1 });
    expect(r.body.stand).toEqual({ offen: 3, inPruefung: 1 });
    expect(r.body.top5).toEqual([{ name: 'Muster-Becher', stueck: 4 }]);
    for (const n of ['7001', '7002', 'FP-901', 'fptok']) expect(JSON.stringify(r.body)).not.toContain(n);
  });
  test('Lesungen: Token + 1 Sammelabruf, danach aus dem Zwischenspeicher', async () => {
    await request(fpApp).get('/api/festpreis-public/uebersicht').set('Authorization', 'Bearer fptok');
    expect(values.get).toHaveBeenCalledTimes(1);
    expect(values.batchGet).toHaveBeenCalledTimes(1);
    values.get.mockClear(); values.batchGet.mockClear();
    await request(fpApp).get('/api/festpreis-public/uebersicht').set('Authorization', 'Bearer fptok');
    expect(values.get).toHaveBeenCalledTimes(1);
    expect(values.batchGet).not.toHaveBeenCalled();
  });
});

describe('Quelltext', () => {
  test('keine zweite Saldo-Formel: Lizenz ueber leseKacheln, Festpreis ueber fpSaldo', () => {
    const pp = readFileSync(resolve(hier, '../routes/partnerPortal.js'), 'utf8');
    const fp = readFileSync(resolve(hier, '../routes/festpreis-public.js'), 'utf8');
    expect(pp.slice(pp.indexOf('export async function leseUebersicht'))).toMatch(/await leseKacheln\(/);
    expect(fp).toMatch(/res\.json\(saldo\);/);
    expect((fp.match(/auszahlungBrutto - interne\.summe/g) ?? []).length).toBe(1);
  });
});
