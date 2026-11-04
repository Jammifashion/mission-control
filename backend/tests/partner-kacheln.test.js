// PP1: Startkacheln im Partnerportal und in MC; gemeinsame Saldo-Rechnung (utils/partner-saldo.js). Nur ERFUNDENE Partner/Betraege.

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

const { saldoRechnung, partnerKacheln, round2 } = await import('../utils/partner-saldo.js');
const hier = dirname(fileURLToPath(import.meta.url));
const API_KEY = 'test-mc-key';

const VH = ['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Status', 'Produkt-ID', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status'];
const IH = ['Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Einzelpreis', 'Summe', 'Status', 'Kanal', 'Fulfillment'];
const AH = ['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Verkaufs-Guthaben', 'Saldo', 'Status', 'Erstellt-Am', 'Notiz', 'Positionen'];
const PH = ['Partner-ID', 'Name', 'Hauptkategorie', 'Token', 'Aktiv', 'Lizenz-%', 'Versand-Modell', 'PayPal-Modell', 'Notiz', 'Porto-Modell', 'Shop', 'Vertrag-ab'];
const FIX = [['Position', 'Wert', 'Einheit', 'Gültig_ab', 'Gültig_bis'], ['MwSt', '19', '%', '01.01.2022', '']];
const v = (pid, datum, order, stueck, lizenz, status) => [pid, datum, order, 'X', '0', stueck, '20', lizenz, status, '1', '', '', '', '', ''];
const i = (pid, datum, summe, status) => [pid, datum, 'Muster', '1', summe, summe, status, 'Portal', ''];

function frischeTabs({ saldoSpalte = true } = {}) {
  return {
    'Partner_Verkäufe': [VH,
      v('P-901', '01.09.2026', '5001', 1, '3', 'abgerechnet'),   // vor der letzten Abrechnung, abgerechnet -> zaehlt nicht
      v('P-901', '05.10.2026', '5002', 2, '4', 'offen'),
      v('P-901', '06.10.2026', '5002', 1, '2', 'offen'),         // gleiche Bestellung -> 1
      v('P-901', '07.10.2026', '5003', 1, '', 'gesperrt'),       // in Pruefung: zaehlt als Bestellung, nicht im Saldo
      v('P-901', '08.10.2026', '5004', 1, '2', 'offen'),
      v('P-901', '09.10.2026', '5004', -1, '-2', 'offen'),       // Storno-Gegenbuchung -> 5004 faellt raus
      v('P-902', '05.10.2026', '6001', 3, '50', 'offen'),        // fremder Partner
    ],
    Partner_Interne_Bestellungen: [IH,
      i('P-901', '10.10.2026', '5', 'offen'), i('P-901', '11.10.2026', '', 'Neu'), i('P-901', '01.09.2026', '7', 'abgerechnet'), i('P-902', '10.10.2026', '99', 'offen')],
    Partner_Abrechnungen: [AH, ['A-1', 'P-901', '01.08.2026', '30.09.2026', '3', '3', 'bezahlt', '01.10.2026', '', '{}'], ['A-2', 'P-902', '01.08.2026', '31.10.2026', '1', '1', 'freigegeben', '', '', '{}']],
    Partner: [saldoSpalte ? [...PH, 'Saldo_Kachel'] : PH,
      ['P-901', 'Testpartner', 'K', 'tok901', 'Ja', '20', '', '', '', 'geteilt-50-50', 'jfn', '01.01.2026', ...(saldoSpalte ? [''] : [])],
      ['P-902', 'Anderer', 'K', 'tok902', 'Ja', '20', '', '', '', 'geteilt-50-50', 'jfn', '01.01.2026', ...(saldoSpalte ? ['nein'] : [])],
      ['P-903', 'Neu ohne Abrechnung', 'K', 'tok903', 'Ja', '20', '', '', '', 'geteilt-50-50', 'jfn', '15.03.2026', ...(saldoSpalte ? [''] : [])]],
    Kalkulation_Fixkosten: FIX,
    'HK_Partner_Verkäufe': [VH], HK_Partner_Abrechnungen: [AH],
  };
}

let tabs, request, portalApp, kalkApp;
beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'biz';
  process.env.MC_API_KEY = API_KEY;
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  const values = {
    get: jest.fn(async ({ range }) => ({ data: { values: (tabs[range.split('!')[0]] ?? []).map(r => [...r]) } })),
    batchUpdate: jest.fn(async () => ({ data: {} })), append: jest.fn(), update: jest.fn(), batchGet: jest.fn(),
  };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values, get: jest.fn(async () => ({ data: { sheets: [] } })), batchUpdate: jest.fn() } });
  portalApp = express(); portalApp.use(express.json());
  portalApp.use('/api/partner', (await import('../routes/partnerPortal.js')).default);
  portalApp.use((err, _q, res, _n) => res.status(err.status ?? 500).json({ error: err.message }));
  kalkApp = express(); kalkApp.use(express.json());
  kalkApp.use('/api/kalkulation', (await import('../routes/kalkulation.js')).default);
  kalkApp.use((err, _q, res, _n) => res.status(err.status ?? 500).json({ error: err.message }));
});
beforeEach(() => { tabs = frischeTabs(); });

describe('Gemeinsame Saldo-Rechnung', () => {
  // Die bisherige Formel (vor PP1 je inline in Portal und Abrechnung) - zum Vergleich.
  const alt = (lizenzNetto, interneSumme, mwst) => {
    const lizenzBrutto = round2(lizenzNetto * (1 + mwst / 100));
    const saldoBrutto = round2(lizenzBrutto - interneSumme);
    return { lizenzBrutto, saldo: saldoBrutto, saldoNetto: round2(saldoBrutto / (1 + mwst / 100)), lizenzNetto: round2(lizenzNetto), interneSumme: round2(interneSumme) };
  };
  test('identisch mit der alten Rechnung (erfundene Werte, positiv/negativ/null)', () => {
    let x = 7;
    const zufall = () => { x = (x * 9301 + 49297) % 233280; return Math.round((x / 233280) * 50000) / 100; };
    const faelle = [[0, 0, 19], [10, 10, 19], [12.3, 30, 19], [100, 0, 7], [0.01, 0.02, 19]];
    for (let n = 0; n < 200; n++) faelle.push([zufall(), zufall(), n % 2 ? 19 : 7]);
    for (const [l, s, m] of faelle) expect(saldoRechnung({ lizenzNetto: l, interneSumme: s, mwstProzent: m })).toMatchObject(alt(l, s, m));
  });
  test('Quelltext: Portal und Abrechnung rechnen nur noch ueber saldoRechnung', () => {
    const portal = readFileSync(resolve(hier, '../routes/partnerPortal.js'), 'utf8');
    const kalk = readFileSync(resolve(hier, '../routes/kalkulation.js'), 'utf8');
    for (const q of [portal, kalk]) expect(q).not.toMatch(/\* \(1 \+ mwstProzent \/ 100\)\)/);
    expect(kalk.match(/saldoRechnung\(/g)).toHaveLength(2);   // vorschau + erstellen
    expect(portal).toMatch(/saldoRechnung\(\{ lizenzNetto, interneSumme, mwstProzent \}\)/);
  });
});

describe('Kacheln (reine Logik)', () => {
  const hilfen = {
    toFloat: x => (x === '' || x === undefined ? 0 : Number(String(x).replace(',', '.'))),
    parseDate: s => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s ?? '')); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; },
    toDE: d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`,
  };
  const k = (pid, t = frischeTabs()) => partnerKacheln({ partnerId: pid, mwstProzent: 19, hilfen,
    tabs: { verkaeufe: hs(t['Partner_Verkäufe']), intern: hs(t.Partner_Interne_Bestellungen), abrechnungen: hs(t.Partner_Abrechnungen), partner: hs(t.Partner) } });
  const hs = w => ({ header: w[0], rows: w.slice(1) });
  test('Zeitraum = Status offen; Bestellungen ohne Storno, gesperrt zaehlt mit; nur eigene Zeilen', () => {
    const r = k('P-901');
    expect(r).toMatchObject({ bestellungen: 2, intern: 2, internOhneBetrag: 1, seit: '01.10.2026', letzteAbrechnung: true, saldoKachel: true });
    // offen: 4 + 2 + 2 - 2 = 6 netto -> 7,14 brutto - 5 intern = 2,14 (bekommt noch)
    expect(r).toMatchObject({ lizenzNetto: 6, lizenzBrutto: 7.14, interneSumme: 5, saldo: 2.14 });
  });
  test('negativer Saldo (schuldet), Saldo_Kachel = nein blendet nur die Kachel aus', () => {
    const r = k('P-902');
    expect(r.saldoKachel).toBe(false);
    expect(r.saldo).toBe(round2(50 * 1.19 - 99));
    expect(r.saldo).toBeLessThan(0);
    expect(r.seit).toBe('01.11.2026');
  });
  test('ohne Abrechnung: seit Vertrag-ab; Saldo null; ohne Spalte Saldo_Kachel -> Kachel da', () => {
    expect(k('P-903')).toMatchObject({ bestellungen: 0, intern: 0, saldo: 0, seit: '15.03.2026', letzteAbrechnung: false, saldoKachel: true });
    const ohne = frischeTabs({ saldoSpalte: false });
    expect(k('P-902', ohne).saldoKachel).toBe(true);
  });
});

describe('Routen (In-Memory-Sheet)', () => {
  test('Portal: nur eigene Zahlen ueber das Token; gleiche Zahl wie /saldo', async () => {
    const a = await request(portalApp).get('/api/partner/kacheln').set('Authorization', 'Bearer tok901');
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ partnerId: 'P-901', bestellungen: 2, saldo: 2.14 });
    const s = await request(portalApp).get('/api/partner/saldo').set('Authorization', 'Bearer tok901');
    expect(s.body.saldo).toBe(a.body.saldo + 0);   // Neu-Zeile ohne Summe = 0, gleiche Rechnung
    const b = await request(portalApp).get('/api/partner/kacheln').set('Authorization', 'Bearer tok902');
    expect(b.body.partnerId).toBe('P-902');
    expect(b.body.bestellungen).toBe(1);
    expect(JSON.stringify(b.body)).not.toMatch(/P-901/);
    expect((await request(portalApp).get('/api/partner/kacheln')).status).toBe(401);
    expect((await request(portalApp).get('/api/partner/kacheln').set('Authorization', 'Bearer falsch')).status).toBe(401);
  });
  test('MC: Admin-Route mit Partner-ID liefert dasselbe wie das Portal', async () => {
    const mc = await request(kalkApp).get('/api/kalkulation/partner/P-901/kacheln');
    const portal = await request(portalApp).get('/api/partner/kacheln').set('Authorization', 'Bearer tok901');
    expect(mc.status).toBe(200);
    expect(mc.body).toEqual(portal.body);
    expect((await request(kalkApp).get('/api/kalkulation/partner/xyz/kacheln')).status).toBe(400);
  });
  test('Abrechnungs-Vorschau unveraendert und gleich wie die Kachel-Rechnung', async () => {
    const r = await request(kalkApp).post('/api/kalkulation/abrechnung/vorschau').send({ partnerId: 'P-901', zeitraumVon: '01.10.2026', zeitraumBis: '31.10.2026' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ lizenzNetto: 6, lizenzBrutto: 7.14, saldo: 2.14, saldoNetto: round2(2.14 / 1.19) });
  });
});

describe('Frontend: Baustein in Portal und MC wortgleich', () => {
  const block = f => { const h = readFileSync(resolve(hier, `../../frontend/${f}`), 'utf8'); return h.slice(h.indexOf('// ── Partner-Kacheln: Anfang'), h.indexOf('// ── Partner-Kacheln: Ende')); };
  const norm = b => b.split('\n').map(l => l.trim()).join('\n');
  test('identisch', () => {
    expect(block('index.html').length).toBeGreaterThan(1000);
    expect(norm(block('partner.html'))).toBe(norm(block('index.html')));
  });
  const F = new Function(`${block('index.html')}\nreturn { pkKachelnHtml, pkSaldoText };`)();
  test('Kacheln: Saldo gruen/rot, ohne Saldo-Kachel, "ohne Betrag", Zeitraum, Details', () => {
    const basis = { bestellungen: 3, intern: 2, internOhneBetrag: 1, seit: '01.10.2026', saldo: -12.3, saldoKachel: true };
    const h = F.pkKachelnHtml(basis);
    expect(h).toContain('<span class="pk-zahl">3</span><span class="pk-label">Bestellungen</span>');
    expect(h).toContain('pk-saldo pk-minus');
    expect(h).toContain('schuldest du noch');
    expect(h).toContain('1 ohne Betrag');
    expect(h).toContain('seit 01.10.2026');
    expect(h).toContain('data-pk-ziel="details"');
    expect(F.pkSaldoText(5).klasse).toBe('pk-plus');
    expect(F.pkSaldoText(0).wort).toBe('ausgeglichen');
    const ohne = F.pkKachelnHtml({ ...basis, saldoKachel: false });
    expect(ohne).not.toContain('pk-saldo');
    expect(ohne).not.toContain('data-pk-info');
    expect(h).not.toMatch(/title=/);
  });
  test('Portal: Kacheln zuerst, bisherige Karten unter Details (unveraendert)', () => {
    const p = readFileSync(resolve(hier, '../../frontend/partner.html'), 'utf8');
    expect(p).toMatch(/id="pv-kacheln-karte"[\s\S]*<div id="pv-details" hidden>[\s\S]*Meine Verkäufe[\s\S]*Meine Abrechnungen/);
    expect(p).toContain("apiGet('/api/partner/kacheln')");
  });
});
