// Befehl PA2, Teil B: Verkaeufe mit fehlendem EK/Druck sperren, spaeter
// genau einmal rechnen (routes/partnerPortal.js), Abrechnung ueberspringt und
// meldet (routes/kalkulation.js), Partnerportal zeigt "in Prüfung".
//
// In-Memory-Sheet (get A1:Z, append, update, batchGet, batchUpdate) und WC-Mock.
// Fixkosten und Order wie partner-sync.test.js (Platzhalter).

import { jest } from '@jest/globals';

jest.unstable_mockModule('googleapis', () => ({ google: { sheets: jest.fn() } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: jest.fn().mockResolvedValue({}) }));
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: jest.fn(),
  getShopConfig: jest.fn(shop => shop === 'honk'
    ? { shop: 'honk', tabVerkaeufe: 'HK_Partner_Verkäufe', tabAbrechnungen: 'HK_Partner_Abrechnungen' }
    : { shop: 'jfn',  tabVerkaeufe: 'Partner_Verkäufe',    tabAbrechnungen: 'Partner_Abrechnungen' }),
  normalizeShop: jest.fn(s => s ?? 'jfn'),
}));
jest.unstable_mockModule('../lib/chatNotify.js', () => ({
  notify: jest.fn().mockResolvedValue(true), buildPartnerNachricht: jest.fn(() => 'partner'),
}));

const API_KEY = 'test-mc-key';
const VH = ['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr',
  'Status', 'Produkt-ID', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status'];
const PA_H = ['Partner-ID', 'Artikelnummer', 'Produkt-ID', 'Artikelname', 'EK-Preis-Netto', 'Druckkosten', 'Versandart', 'Lizenz-%', 'Letzte-Synchro'];
const FIXKOSTEN = [
  ['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis'],
  ['Herstellungsnebenkosten', '0,8', 'EUR/Artikel', '01.01.2022', ''],
  ['Versandnebenkosten B', '1', 'EUR/Bestellung', '01.01.2022', ''],
  ['Versandnebenkosten P', '1,41', 'EUR/Bestellung', '01.01.2022', ''],
  ['Porto B', '2,51', 'EUR/Bestellung', '01.01.2022', ''],
  ['Porto P', '6', 'EUR/Bestellung', '01.01.2022', ''],
  ['PayPal Prozent', '2,49', '%', '01.01.2022', ''],
  ['PayPal Pauschale', '0,35', 'EUR/Bestellung', '01.01.2022', ''],
  ['MwSt', '19', '%', '01.01.2022', ''],
];
const ORDER = {
  id: 16941, status: 'processing', date_created: '2026-08-20T10:00:00', shipping_total: '4.20',
  line_items: [
    { name: 'Dorflove Shirt - M', product_id: 5420, variation_id: 5431, quantity: 2, total: '42.00' },
    { name: 'Cap', product_id: 7106, variation_id: 0, quantity: 1, total: '15.00' },
  ],
};

let tabs, request, portalApp, kalkApp, values, wcGet, stornoOrders;
const colIdx = b => [...b].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
const kopie = t => (tabs[t] ?? []).map(r => [...r]);

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'biz';
  process.env.MC_API_KEY = API_KEY;
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  values = {
    get: jest.fn(async ({ range }) => ({ data: { values: kopie(range.slice(0, range.includes('!') ? range.indexOf('!') : undefined)) } })),
    append: jest.fn(async ({ range, requestBody }) => { tabs[range.split('!')[0]].push(...requestBody.values.map(r => r.map(c => c))); return { data: {} }; }),
    update: jest.fn(async ({ range, requestBody }) => {
      const [tab, z] = range.split('!'); const [, sp, nr] = /^([A-Z]+)(\d+)$/.exec(z);
      tabs[tab][Number(nr) - 1][colIdx(sp)] = requestBody.values[0][0]; return { data: {} };
    }),
    batchGet: jest.fn(async ({ ranges }) => ({ data: { valueRanges: ranges.map(r => {
      const [tab, z] = r.split('!'); const nr = Number(/^A(\d+):/.exec(z)[1]);
      return { values: tabs[tab][nr - 1] ? [[...tabs[tab][nr - 1]]] : [] };
    }) } })),
    batchUpdate: jest.fn(async ({ requestBody }) => {
      for (const d of requestBody.data) {
        const [tab, z] = d.range.split('!'); const [, sp, nr] = /^([A-Z]+)(\d+)$/.exec(z);
        const row = tabs[tab][Number(nr) - 1]; while (row.length <= colIdx(sp)) row.push('');
        row[colIdx(sp)] = d.values[0][0];
      }
      return { data: {} };
    }),
  };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values, get: jest.fn(async () => ({ data: { sheets: [] } })), batchUpdate: jest.fn() } });
  wcGet = jest.fn(async (pfad, params = {}) => {
    if (pfad === `orders/${ORDER.id}`) return { data: ORDER };
    if (pfad === 'orders') {
      if (params.page > 1) return { data: [] };
      if (params.status === 'processing') return { data: [ORDER] };
      if (params.status === 'refunded') return { data: stornoOrders };
      return { data: [] };
    }
    throw new Error(pfad);
  });
  const { getWcClient } = await import('../lib/shopConfig.js');
  getWcClient.mockReturnValue({ get: wcGet });

  portalApp = express(); portalApp.use(express.json());
  portalApp.use('/api/partner', (await import('../routes/partnerPortal.js')).default);
  portalApp.use((err, _q, res, _n) => res.status(err.status ?? 500).json({ error: err.message }));
  kalkApp = express(); kalkApp.use(express.json());
  kalkApp.use('/api/kalkulation', (await import('../routes/kalkulation.js')).default);
  kalkApp.use((err, _q, res, _n) => res.status(err.status ?? 500).json({ error: err.message }));
});

beforeEach(() => {
  stornoOrders = [];
  tabs = {
    Partner: [
      ['Partner-ID', 'Name', 'Token', 'Aktiv', 'Lizenz-%', 'Porto-Modell', 'Shop', 'Vertrag-ab'],
      ['P-003', 'Partner', 'tok3', 'Ja', '40', 'geteilt-50-50', 'jfn', ''],
    ],
    Partner_Artikel: [
      PA_H,
      ['P-003', 'E3000 Dorflove', '5420', 'Dorflove Shirt', '3', '', 'B', '', '01.08.2026'],   // Druck LEER -> gesperrt
      ['P-003', 'Cap', '7106', 'Cap', '5,5', '0', 'B', '', '01.08.2026'],                     // Druck 0 -> rechnen
    ],
    Kalkulation_Fixkosten: FIXKOSTEN,
    'Partner_Verkäufe': [[...VH]],
    Partner_Interne_Bestellungen: [['Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Einzelpreis', 'Summe', 'Status']],
    Partner_Abrechnungen: [['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Verkaufs-Guthaben', 'Saldo', 'Status', 'Erstellt-Am', 'Notiz', 'Positionen']],
  };
  for (const f of Object.values(values)) f.mockClear();
  wcGet.mockClear();
});

const sync = () => request(portalApp).get('/api/partner/verkaeufe/sync').set('x-api-key', API_KEY);
const V = () => tabs['Partner_Verkäufe'];
const h = n => V()[0].indexOf(n);
const zeileFuer = (pid, storno = false) => V().slice(1).filter(r => String(r[h('Produkt-ID')]) === pid && (!!(r[h('Storno-Status')] ?? '') === storno));

describe('Sync: fehlender Druck -> gesperrt, 0 ist erlaubt', () => {
  test('gesperrte Zeile mit leeren Betraegen, Spalte "Sperre" additiv am Ende', async () => {
    const res = await sync();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ synced: 2, gesperrt: 1 });
    expect(V()[0]).toEqual([...VH, 'Sperre']);
    const [g] = zeileFuer('5420');
    expect(g[h('Status')]).toBe('gesperrt');
    expect(g[h('Sperre')]).toBe('Druck fehlt');
    for (const s of ['Lizenzgebühr', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto']) expect(g[h(s)]).toBe('');
    expect(g[h('Stückzahl')]).toBe(2);
    expect(g[h('VK-Preis-Brutto')]).toBe(42);
  });

  test('Druck 0 wird normal gerechnet (Status offen, Betraege gesetzt)', async () => {
    await sync();
    const [c] = zeileFuer('7106');
    expect(c[h('Status')]).toBe('offen');
    expect(typeof c[h('Lizenzgebühr')]).toBe('number');
    expect(c[h('Sperre')] ?? '').toBe('');
  });

  test('zweiter Lauf ohne neuen EK/Druck: keine Doppelzeile, bleibt gesperrt', async () => {
    await sync();
    const n = V().length;
    const res = await sync();
    expect(V().length).toBe(n);
    expect(res.body).toMatchObject({ synced: 0, entsperrt: 0, nochGesperrt: 1 });
  });
});

describe('Entsperren: genau einmal, erste Berechnung', () => {
  test('Druck nachgetragen -> naechster Lauf rechnet die Zeile, dann nie wieder', async () => {
    await sync();
    const vorher = zeileFuer('7106')[0].slice();
    tabs.Partner_Artikel[1][5] = '2,1';
    const res = await sync();
    expect(res.body).toMatchObject({ entsperrt: 1, nochGesperrt: 0, synced: 0 });
    const [g] = zeileFuer('5420');
    expect(g[h('Status')]).toBe('offen');
    expect(g[h('Sperre')]).toBe('');
    expect(typeof g[h('Lizenzgebühr')]).toBe('number');
    expect(zeileFuer('7106')[0]).toEqual(vorher);             // gerechnete Zeile unberuehrt
    // Gleiche Rechnung wie ein Sofort-Sync mit vollem Eintrag
    const soll = V().slice();
    tabs['Partner_Verkäufe'] = [[...VH, 'Sperre']];
    await sync();
    const sofort = zeileFuer('5420')[0];
    for (const s of ['Lizenzgebühr', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto'])
      expect(g[h(s)]).toBeCloseTo(sofort[h(s)], 10);
    tabs['Partner_Verkäufe'] = soll;
    values.batchUpdate.mockClear();
    const dritter = await sync();
    expect(dritter.body.entsperrt).toBe(0);
    expect(values.batchUpdate).not.toHaveBeenCalled();
  });

  test('Zeile hat sich unter der Nummer geaendert -> nicht schreiben', async () => {
    await sync();
    tabs.Partner_Artikel[1][5] = '2,1';
    const echt = values.batchGet.getMockImplementation();
    values.batchGet.mockImplementationOnce(async () => ({ data: { valueRanges: [{ values: [['P-003', 'x', '999']] }] } }));
    const res = await sync();
    expect(res.body.entsperrt).toBe(0);
    expect(zeileFuer('5420')[0][h('Status')]).toBe('gesperrt');
    values.batchGet.mockImplementation(echt);
  });
});

describe('Storno einer gesperrten Zeile', () => {
  test('Gegenbuchung ebenfalls gesperrt, Betraege leer (kein -0); Entsperren rechnet beide', async () => {
    await sync();
    stornoOrders = [{ ...ORDER, status: 'refunded', date_paid: '2026-08-20T10:05:00', date_modified: '2026-08-25T10:00:00' }];
    await sync();
    const [s] = zeileFuer('5420', true);
    expect(s[h('Status')]).toBe('gesperrt');
    expect(s[h('Sperre')]).toBe('Druck fehlt');
    expect(s[h('Lizenzgebühr')]).toBe('');
    expect(s[h('Stückzahl')]).toBe(-2);
    tabs.Partner_Artikel[1][5] = '2,1';
    const res = await sync();
    expect(res.body.entsperrt).toBe(2);
    const [v] = zeileFuer('5420'), [s2] = zeileFuer('5420', true);
    expect(s2[h('Lizenzgebühr')]).toBeCloseTo(-v[h('Lizenzgebühr')], 10);
    expect(s2[h('Status')]).toBe('offen');
  });
});

describe('Abrechnung: gesperrt ueberspringen und melden, Nachzuegler', () => {
  const vorschau = (von, bis) => request(kalkApp).post('/api/kalkulation/abrechnung/vorschau').send({ partnerId: 'P-003', zeitraumVon: von, zeitraumBis: bis });
  const erstellen = (von, bis) => request(kalkApp).post('/api/kalkulation/abrechnung/erstellen').send({ partnerId: 'P-003', zeitraumVon: von, zeitraumBis: bis });

  test('Vorschau: gesperrte Zeile nicht in den Verkaeufen, Hinweis; kein 409', async () => {
    await sync();
    const res = await vorschau('01.08.2026', '31.08.2026');
    expect(res.status).toBe(200);
    expect(res.body.verkaeufe).toHaveLength(1);
    expect(res.body.gesperrtImZeitraum).toBe(1);
    expect(res.body.hinweise[0]).toBe('1 Zeile(n) im Zeitraum gesperrt (EK/Druck fehlt), nicht abgerechnet.');
  });

  test('Erstellen: nur die offene Zeile, Hinweis in der Antwort', async () => {
    await sync();
    const res = await erstellen('01.08.2026', '31.08.2026');
    expect(res.status).toBe(201);
    expect(res.body.anzahlVerkäufe).toBe(1);
    expect(res.body.hinweise).toEqual(['1 Zeile(n) im Zeitraum gesperrt (EK/Druck fehlt), nicht abgerechnet.']);
  });

  test('nur gesperrte Zeilen im Zeitraum: 404 mit Hinweis', async () => {
    tabs.Partner_Artikel[2][5] = '';                       // auch die Cap sperren
    await sync();
    const res = await erstellen('01.08.2026', '31.08.2026');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/2 Zeile\(n\) im Zeitraum gesperrt/);
  });

  test('Nachzuegler: offene Zeile vor dem Zeitraumbeginn wird gemeldet', async () => {
    await sync();
    const res = await vorschau('01.09.2026', '30.09.2026');
    expect(res.body.nachzuegler).toBe(1);
    expect(res.body.hinweise).toContain('1 offene Zeile(n) vor dem Zeitraumbeginn (früheste 20.08.2026) – nicht in dieser Abrechnung, Zeitraum früher beginnen lassen.');
  });
});

describe('Partnerportal', () => {
  test('gesperrte Zeile sichtbar als "in Prüfung", ohne Betrag und ohne Grund', async () => {
    await sync();
    const res = await request(portalApp).get('/api/partner/verkaeufe').set('Authorization', 'Bearer tok3');
    expect(res.status).toBe(200);
    const g = res.body.find(r => r.artikelname === 'Dorflove Shirt - M');
    expect(g.status).toBe('in Prüfung');
    expect(JSON.stringify(g)).not.toMatch(/Druck|EK|fehlt/);
    for (const k of Object.keys(g)) expect(['orderId', 'artikelname', 'stueckzahl', 'datum', 'status', 'storno']).toContain(k);
  });

  test('Saldo zaehlt gesperrte Zeilen nicht', async () => {
    await sync();
    const res = await request(portalApp).get('/api/partner/saldo').set('Authorization', 'Bearer tok3');
    expect(res.status).toBe(200);
    const nurOffen = V().slice(1).filter(r => r[h('Status')] === 'offen').reduce((s, r) => s + r[h('Lizenzgebühr')], 0);
    expect(res.body.lizenzNetto ?? res.body.lizenzSumme).toBeCloseTo(nurOffen, 2);
  });
});
