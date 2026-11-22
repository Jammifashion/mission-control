// GS2: "Offene Auszahlung" = noch nicht abgerechnet + freigegebene, noch nicht bezahlte Abrechnungen. Nur ERFUNDENE Partner und Zahlen.

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

const { offeneAuszahlung, round2 } = await import('../utils/partner-saldo.js');
const hier = dirname(fileURLToPath(import.meta.url));
const d = s => { const [t, m, j] = s.split('.'); return new Date(+j, +m - 1, +t); };

describe('offeneAuszahlung (reine Logik)', () => {
  const abr = [
    { status: 'bezahlt', brutto: 500, bis: d('31.03.2026') },
    { status: 'freigegeben', brutto: 100, bis: d('30.06.2026') },
    { status: 'freigegeben', brutto: 50.5, bis: d('30.09.2026') },
    { status: 'entwurf', brutto: 20, bis: d('22.11.2026') },
  ];
  test('bezahlt zaehlt nie, mehrere freigegebene addieren sich, abgerechnet bis = letzte freigegebene/bezahlte', () => {
    const o = offeneAuszahlung({ laufend: 10, abrechnungen: abr, entwurfZaehlt: false });
    expect(o).toMatchObject({ ausstehend: 150.5, ausstehendAnzahl: 2, laufend: 10, saldo: 160.5 });
    expect(o.abgerechnetBis).toEqual(d('30.09.2026'));   // der Entwurf zaehlt nicht fuer "abgerechnet bis"
  });
  test('Festpreis: Entwurf zaehlt zu "noch nicht abgerechnet" (seine Zeilen sind schon markiert), Lizenz nicht (sonst doppelt)', () => {
    expect(offeneAuszahlung({ laufend: 10, abrechnungen: abr, entwurfZaehlt: true })).toMatchObject({ laufend: 30, ausstehend: 150.5, saldo: 180.5 });
  });
  test('ohne Abrechnungen = laufend; leerer Status = Entwurf; Rundung auf Cent', () => {
    expect(offeneAuszahlung({ laufend: 0.1 + 0.2, abrechnungen: [] })).toMatchObject({ saldo: 0.3, ausstehend: 0, ausstehendAnzahl: 0, abgerechnetBis: null });
    expect(offeneAuszahlung({ laufend: 1, abrechnungen: [{ status: '', brutto: 5 }] }).saldo).toBe(1);
  });
});

// ── Routen mit In-Memory-Sheet ──
const IH = ['Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Einzelpreis', 'Summe', 'Status', 'Kanal', 'Fulfillment'];
const AH = ['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Verkaufs-Guthaben', 'Saldo', 'Status', 'Erstellt-Am', 'Notiz', 'Positionen'];
const PH = ['Partner-ID', 'Name', 'Hauptkategorie', 'Token', 'Aktiv', 'Lizenz-%', 'Versand-Modell', 'PayPal-Modell', 'Notiz', 'Porto-Modell', 'Shop', 'Vertrag-ab'];
const FIX = [['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis'], ['MwSt', '19', '%', '01.01.2022', '']];
const VH = ['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status', 'Produkt-ID', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status'];
const v = (datum, order, lizenz, status) => ['P-911', datum, order, 'Muster-Shirt', '0', '1', '20', lizenz, status, '1', '', '', '', '', ''];
const FVH = ['Datum', 'WC-Bestellnummer', 'Partner-ID', 'Artikelname', 'Artikelkategorie', 'Stückzahl', 'VK-Netto', 'PayPal-Gebühren', 'Porto-Einnahme',
  'Porto-Kosten', 'Versandnebenkosten', 'Festpreis', 'Handlingskosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto', 'Storno-Status', 'Status Abrechnung'];
const fv = (datum, nr, netto, status) => [datum, nr, 'FP-911', 'Muster-Becher', 'Becher', '1', '20', '0', '0', '0', '0', '10', '1', netto, '', '', status];
const FAH = ['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Gesamt-Netto', 'Gesamt-Brutto', 'Status', 'Erstellt-Am', 'Positionen'];

function tabsNeu() {
  return {
    'Partner_Verkäufe': [VH, v('05.10.2026', '5001', '10', 'offen'), v('06.10.2026', '5002', '30', 'abgerechnet')],
    Partner_Interne_Bestellungen: [IH],
    Partner_Abrechnungen: [AH,
      ['A-1', 'P-911', '01.07.2026', '30.09.2026', '25', '29,75', 'bezahlt', '01.10.2026', '', '{}'],
      ['A-2', 'P-911', '01.10.2026', '31.10.2026', '30', '35,70', 'freigegeben', '01.11.2026', '', '{}'],
      ['A-3', 'P-911', '01.11.2026', '22.11.2026', '10', '11,90', 'entwurf', '22.11.2026', '', '{}']],   // Lizenz-Entwurf: Zeile 5001 ist noch offen
    Partner: [PH, ['P-911', 'Testpartner', 'K', 'tok911', 'Ja', '20', '', '', '', 'geteilt-50-50', 'jfn', '01.01.2026']],
    Kalkulation_Fixkosten: FIX,
    FP_Partner: [['Partner-ID', 'Name', 'Token', 'Aktiv', 'Vertrag-ab'], ['FP-911', 'FP Test', 'fptok911', 'ja', '01.02.2026']],
    'FP_Verkäufe': [FVH, fv('20.11.2026', '7001', '10', 'offen'), fv('05.10.2026', '7000', '30', 'abgerechnet')],
    FP_Abrechnungen: [FAH,
      ['FPA-0001', 'FP-911', '01.01.2026', '31.03.2026', '100', '119', 'bezahlt', '01.04.2026', '{}'],
      ['FPA-0002', 'FP-911', '01.04.2026', '30.06.2026', '10', '11,90', 'freigegeben', '01.07.2026', '{}'],
      ['FPA-0003', 'FP-911', '01.07.2026', '30.09.2026', '20', '23,80', 'freigegeben', '01.10.2026', '{}'],
      ['FPA-0004', 'FP-911', '01.10.2026', '31.10.2026', '30', '35,70', 'entwurf', '01.11.2026', '{}']],   // FP-Entwurf: Zeile 7000 schon "abgerechnet"
    Partner_Interne_Bestellungen_: [],
  };
}

let tabs, request, portalApp, fpApp, fpAdmin, partnerPortal, fpPublic;
const tab = range => String(range).split('!')[0].replace(/^'(.*)'$/, '$1');
beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'biz';
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  const values = {
    get: jest.fn(async ({ range }) => ({ data: { values: (tabs[tab(range)] ?? []).map(r => [...r]) } })),
    batchGet: jest.fn(async ({ ranges }) => ({ data: { valueRanges: ranges.map(r => ({ values: (tabs[tab(r)] ?? []).map(x => [...x]) })) } })),
    update: jest.fn(async ({ range, requestBody }) => {   // nur Einzelzelle "Tab!G3"
      const m = /!([A-Z]+)(\d+)$/.exec(range);
      tabs[tab(range)][+m[2] - 1][m[1].charCodeAt(0) - 65] = requestBody.values[0][0];
      return {};
    }),
    batchUpdate: jest.fn(), append: jest.fn(),
  };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values, get: jest.fn(async () => ({ data: { sheets: [] } })), batchUpdate: jest.fn() } });
  partnerPortal = await import('../routes/partnerPortal.js');
  fpPublic = await import('../routes/festpreis-public.js');
  const fpPortal = await import('../routes/festpreis-portal.js');
  const fehler = (err, _q, res, _n) => res.status(err.status ?? 500).json({ error: err.message });
  portalApp = express(); portalApp.use('/api/partner', partnerPortal.default); portalApp.use(fehler);
  fpApp = express(); fpApp.use('/api/festpreis-public', fpPublic.default); fpApp.use(fehler);
  fpAdmin = express(); fpAdmin.use(express.json()); fpAdmin.use('/api/festpreis', fpPortal.default); fpAdmin.use(fehler);
});
beforeEach(() => { tabs = tabsNeu(); partnerPortal._uebersichtSpeicherLeeren(); fpPublic._fpUebersichtSpeicherLeeren(); });

describe('Festpreis-Portal', () => {
  test('freigegebene zaehlen, bezahlte nicht, Entwurf als "noch nicht abgerechnet", nichts doppelt; /saldo = /uebersicht', async () => {
    const s = (await request(fpApp).get('/api/festpreis-public/saldo').set('Authorization', 'Bearer fptok911')).body;
    // laufend = offene Zeile 7001 (Gesamt-Partner-Netto 10 -> 11,90 brutto); Zeile 7000 steckt nur im Entwurf FPA-0004 (35,70)
    const L = s.laufendBrutto;   // wie bisher gerechnet (Zeile 7001)
    expect(L).toBeGreaterThan(0);
    expect(s).toMatchObject({ entwurfBrutto: 35.7, ausstehendBrutto: 35.7, ausstehendAnzahl: 2, abgerechnetBis: '30.09.2026' });
    expect(s.saldoBrutto).toBe(round2(L + 35.7 + 11.9 + 23.8));
    const u = (await request(fpApp).get('/api/festpreis-public/uebersicht').set('Authorization', 'Bearer fptok911')).body;
    expect(u.auszahlung).toMatchObject({ saldo: s.saldoBrutto, ausstehend: 35.7, ausstehendAnzahl: 2, laufend: round2(L + 35.7), abgerechnetBis: '30.09.2026' });
    expect(round2(u.auszahlung.ausstehend + u.auszahlung.laufend)).toBe(u.auszahlung.saldo);
    for (const n of ['FPA-', '7001', 'FP-911']) expect(JSON.stringify(u)).not.toContain(n);
  });
  test('Statuswechsel auf bezahlt leert den Zwischenspeicher: die Abrechnung faellt sofort heraus', async () => {
    const vorher = (await request(fpApp).get('/api/festpreis-public/uebersicht').set('Authorization', 'Bearer fptok911')).body.auszahlung;
    const r = await request(fpAdmin).patch('/api/festpreis/abrechnungen/FPA-0002/status').send({ status: 'bezahlt' });
    expect(r.status).toBe(200);
    const nachher = (await request(fpApp).get('/api/festpreis-public/uebersicht').set('Authorization', 'Bearer fptok911')).body.auszahlung;
    expect(nachher).toMatchObject({ ausstehend: 23.8, ausstehendAnzahl: 1 });
    expect(nachher.saldo).toBe(round2(vorher.saldo - 11.9));
  });
});

describe('Lizenz-Portal', () => {
  test('freigegebene zaehlen, Entwurf nicht (seine Zeilen sind noch offen), bezahlte nicht; /saldo = /kacheln = /uebersicht', async () => {
    const k = (await request(portalApp).get('/api/partner/kacheln?shop=jfn').set('Authorization', 'Bearer tok911')).body;
    // laufend: Zeile 5001 offen (10 netto -> 11,90); A-2 freigegeben 35,70; A-3 Entwurf zaehlt nicht (5001 ist dieselbe Zeile)
    expect(k).toMatchObject({ laufend: 11.9, ausstehend: 35.7, ausstehendAnzahl: 1, saldo: 47.6, abgerechnetBis: '31.10.2026' });
    const s = (await request(portalApp).get('/api/partner/saldo?shop=jfn').set('Authorization', 'Bearer tok911')).body;
    expect(s).toMatchObject({ saldo: 47.6, laufend: 11.9, ausstehend: 35.7, lizenzNetto: 10 });
    const u = (await request(portalApp).get('/api/partner/uebersicht?shop=jfn').set('Authorization', 'Bearer tok911')).body;
    expect(u.auszahlung).toMatchObject({ saldo: 47.6, laufend: 11.9, ausstehend: 35.7, abgerechnetBis: '31.10.2026' });
  });
});

describe('Quelltext', () => {
  test('schreibende Abrechnungs-Anfragen leeren die Portal-Uebersicht (Lizenz + Festpreis)', () => {
    const kalk = readFileSync(resolve(hier, '../routes/kalkulation.js'), 'utf8');
    const fp = readFileSync(resolve(hier, '../routes/festpreis-portal.js'), 'utf8');
    expect(kalk).toMatch(/req\.path\.startsWith\('\/abrechnung'\)\) res\.on\('finish', \(\) => _uebersichtSpeicherLeeren\(\)\)/);
    expect(fp).toMatch(/req\.path\.startsWith\('\/abrechnungen'\)\) res\.on\('finish', \(\) => \{\s*_fpUebersichtSpeicherLeeren\(\);[^}]*_fanshopKontoLeeren\(\)/);
  });
  test('eine Formel: offeneAuszahlung nur in partner-saldo.js definiert, Festpreis und Lizenz rufen sie', () => {
    const fp = readFileSync(resolve(hier, '../routes/festpreis-public.js'), 'utf8');
    const ps = readFileSync(resolve(hier, '../utils/partner-saldo.js'), 'utf8');
    expect(fp).toMatch(/offeneAuszahlung\(\{/);
    expect(ps.match(/offeneAuszahlung\(\{/g)).toHaveLength(2);   // Definition + partnerKacheln
  });
});

describe('Anzeige', () => {
  const html = f => readFileSync(resolve(hier, `../../frontend/${f}`), 'utf8');
  const block = f => { const h = html(f); return h.slice(h.indexOf('// ── Partner-Kacheln: Anfang'), h.indexOf('// ── Partner-Kacheln: Ende')); };
  const F = new Function(`${block('index.html')}\nreturn { pkKachelnHtml };`)();
  test('MC/Portal-Kachel: "abgerechnet bis" und Aufteilung nur, wenn etwas aussteht', () => {
    const mit = F.pkKachelnHtml({ bestellungen: 1, intern: 0, seit: '01.11.2026', saldo: 47.6, laufend: 11.9, ausstehend: 35.7, abgerechnetBis: '31.10.2026', saldoKachel: true });
    expect(mit).toContain('abgerechnet bis 31.10.2026');
    expect(mit).toMatch(/davon abgerechnet, Auszahlung ausstehend: 35,70\s€ · noch nicht abgerechnet: 11,90\s€/);
    expect(mit).toContain('Was du noch bekommst: abgerechnete, noch nicht ausgezahlte Beträge plus Verkäufe seit der letzten Abrechnung');
    const ohne = F.pkKachelnHtml({ bestellungen: 1, intern: 0, seit: '01.11.2026', saldo: 5, laufend: 5, ausstehend: 0, abgerechnetBis: '', saldoKachel: true });
    expect(ohne).not.toContain('davon abgerechnet');
    expect(ohne).toContain('seit 01.11.2026');
  });
  test('Portal-Startseite (beide Portale): Aufteilung, "abgerechnet bis", neuer ⓘ-Text', () => {
    for (const f of ['partner.html', 'partner-festpreis.html']) {
      const h = html(f);
      expect(h).toContain('davon abgerechnet, Auszahlung ausstehend:');
      expect(h).toContain('`abgerechnet bis ${dgEsc(a.abgerechnetBis)}`');
      expect(h).toContain('Was du noch bekommst: abgerechnete, noch nicht ausgezahlte Beträge plus Verkäufe seit der letzten Abrechnung');
      expect(h).toContain('Abgerechnet, Auszahlung ausstehend (');
      expect(h).not.toContain('Nur offene, noch nicht abgerechnete Positionen');
    }
  });
});
