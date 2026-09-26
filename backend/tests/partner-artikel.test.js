// Befehl PA2, Teil A: Partnerartikel-Import und taeglicher Abgleich
// (lib/partnerArtikel.js, POST /:id/artikel/import, POST /artikel/abgleich,
// buildArtikelAbgleichNachricht, sync-partner-daily.yml).
//
// In-Memory-Sheet fuer Business- und SSOT-Reiter (Namen sind eindeutig),
// WC-Mock je Shop. Alle Werte sind Platzhalter.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

let tabs;
const colIdx = b => [...b].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
const values = {
  get: jest.fn(async ({ range }) => {
    const [tab, teil] = range.split('!');
    if (!tabs[tab]) throw Object.assign(new Error(`Unable to parse range: ${range}`), { status: 400 });
    if (teil === '1:1') return { data: { values: [[...tabs[tab][0]]] } };
    return { data: { values: tabs[tab].map(r => [...r]) } };
  }),
  batchGet: jest.fn(async ({ ranges }) => ({ data: { valueRanges: ranges.map(r => {
    const [tab, teil] = r.split('!');
    const c = colIdx(/^([A-Z]+)2:/.exec(teil)[1]);
    return { values: [tabs[tab].slice(1).map(z => z[c] ?? '')] };
  }) } })),
  update: jest.fn(async ({ range, requestBody }) => {
    const [tab, zelle] = range.split('!');
    const [, sp, nr] = /^([A-Z]+)(\d+)$/.exec(zelle);
    tabs[tab][Number(nr) - 1][colIdx(sp)] = requestBody.values[0][0];
    return { data: {} };
  }),
  append: jest.fn(async ({ range, requestBody }) => {
    const tab = range.split('!')[0];
    tabs[tab].push(...requestBody.values.map(r => [...r]));
    return { data: {} };
  }),
  batchUpdate: jest.fn(async () => ({ data: {} })),
};
jest.unstable_mockModule('googleapis', () => ({ google: { sheets: () => ({ spreadsheets: { values } }) } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));
jest.unstable_mockModule('../utils/secrets.js', () => ({
  SECRET_KEYS: [], getSecret: jest.fn(async () => ''), loadAllSecrets: jest.fn(),
}));

const KATEGORIEN = [
  { id: 67, name: 'Künstler und Marken', parent: 0 },
  { id: 670, name: 'Malle Prinz', parent: 67 },
  { id: 671, name: 'Malle Prinz Unter', parent: 670 },
  { id: 700, name: 'Kati Zucker', parent: 67 },
];
let jfnProdukte, honkProdukte;
const wcCalls = [];
const wcFuer = shop => ({
  get: jest.fn(async (pfad, params = {}) => {
    wcCalls.push({ shop, pfad, params });
    if (pfad === 'products/categories') return { data: params.page > 1 ? [] : KATEGORIEN };
    if (pfad === 'products') {
      if (params.page > 1) return { data: [] };
      if (shop === 'honk') return { data: honkProdukte.filter(p => !params.status || params.status === 'any' || p.status === params.status) };
      return { data: jfnProdukte.filter(p => p.kat.includes(Number(params.category))) };
    }
    throw new Error(pfad);
  }),
  put: jest.fn(), post: jest.fn(),
});
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: s => wcFuer(String(s ?? 'jfn').toLowerCase() === 'honk' ? 'honk' : 'jfn'),
  getShopConfig: () => ({ shop: 'jfn' }),
}));

process.env.GOOGLE_SHEET_ID = 'ssot';
process.env.BUSINESS_SHEET_ID = 'business';
const pa = await import('../lib/partnerArtikel.js');
const { buildArtikelAbgleichNachricht } = await import('../lib/chatNotify.js');

const PA_KOPF = ['Partner-ID', 'Artikelnummer', 'Produkt-ID', 'Artikelname', 'EK-Preis-Netto', 'Druckkosten', 'Versandart', 'Lizenz-%', 'Letzte-Synchro'];
const HK_KOPF = ['Produkt-ID', 'Artikelname', 'EK-Preis-Netto', 'Druckkosten', 'Versandart'];
const JETZT = new Date('2026-09-26T08:00:00Z');

function basis() {
  return {
    Partner: [
      ['Partner-ID', 'Name', 'Hauptkategorie', 'Aktiv', 'Shop', 'Vertrag-ab'],
      ['P-006', 'Partner A', 'Malle Prinz', 'Ja', 'jfn', '01.04.2026'],
      ['P-007', 'Partner B', 'Kati Zucker', 'Ja', 'jfn', ''],
      ['P-099', 'Inaktiv', 'Kati Zucker', 'Nein', 'jfn', ''],
      ['P-004', 'Honk', '', 'Ja', 'honk', '01.01.2025'],
    ],
    FP_Partner: [['Partner-ID', 'Name', 'Shop', 'Aktiv', 'Kategorien'], ['FP-001', 'FP', 'jfn', 'Ja', '700']],
    FP_Artikel: [['Partner-ID', 'Produkt-ID', 'Artikelname']],
    Partner_Artikel: [
      [...PA_KOPF],
      // SKU spaeter geaendert (Befund MP1): gleiche Produkt-ID, alte SKU
      ['P-006', 'E3005/Alt-Samenshirt', '17775', 'Damenshirt', 4.2, 1.5, 'B', '40', '26.05.2026'],
      ['P-007', 'JC092/Badelatschen', '18636', 'Badelatschen', 3.1, 0, 'P', '', '28.07.2026'],   // Druck bewusst 0
      ['P-007', 'X/Leer', '18640', 'Leer', '', '', 'P', '', '28.07.2026'],                     // EK/Druck fehlen
    ],
    HK_Partner_Artikel: [[...HK_KOPF], ['1460', 'Honk! 3D Cap', 5.5, 0, 'B']],
    'Partner_Verkäufe': [['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Status', 'Produkt-ID']],
    'HK_Partner_Verkäufe': [['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Status', 'Produkt-ID']],
    Erfassungsmaske: [['ID', 'Produkt-ID'], ['JFN-2026-0132', '21126']],
    Varianten: [
      ['SSOT-ID', 'Varianten-Nr', 'Aktiv', 'LShop_ArticleNr'],
      ['JFN-2026-0132', '1', 'TRUE', '1000030393'],
      ['JFN-2026-0132', '2', 'TRUE', '1000030398'],
      ['JFN-2026-0132', '3', 'TRUE', '1000030402'],
    ],
    SKU_LShop: [
      ['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', '10CartonsPrice'],
      ['1000030393', 'BG42', 'Black', '', 'One', '2,10'],
      ['1000030398', 'BG42', 'Fuchsia', '', 'One', '2,40'],
      ['1000030402', 'BG42', 'White', '', 'One', '2,10'],
    ],
  };
}

beforeEach(() => {
  tabs = basis();
  jfnProdukte = [
    { id: 17775, name: 'Malle Prinz Ultras Damenshirt', sku: 'E3005/Malle-Prinz-Ultras-Damenshirt', status: 'publish', kat: [670] },
    { id: 21126, name: 'Malle Prinz Ultras Bauchtasche', sku: 'BG42/MPU-Bauchtasche', status: 'publish', kat: [670] },
    { id: 21200, name: 'Malle Prinz Entwurf', sku: 'X/Entwurf', status: 'draft', kat: [671] },
    { id: 18636, name: 'Badelatschen', sku: 'JC092/Badelatschen', status: 'publish', kat: [700] },
    { id: 18640, name: 'Leer', sku: 'X/Leer', status: 'publish', kat: [700] },
  ];
  honkProdukte = [
    { id: 1460, name: 'Honk! 3D Cap', sku: 'FX6089M Honk', status: 'publish' },
    { id: 1999, name: 'Honk Neu', sku: 'HONK-NEU', status: 'publish' },
    { id: 2000, name: 'Honk Entwurf', sku: 'HONK-E', status: 'draft' },
  ];
  wcCalls.length = 0;
  for (const f of Object.values(values)) f.mockClear();
});

const sheets = { spreadsheets: { values } };
const zeileVon = (tab, pid) => {
  const h = tabs[tab][0], i = h.indexOf('Produkt-ID');
  return tabs[tab].filter(r => String(r[i]) === pid).map(r => Object.fromEntries(h.map((k, j) => [k, r[j] ?? ''])));
};

// ── Reine Logik ─────────────────────────────────────────────────────────────

describe('ekAusLShop (V1)', () => {
  const L = [
    { articleNr: '1', catalogNr: 'E3000', color1: 'Black', size: 'S', preis: '3,10' },
    { articleNr: '2', catalogNr: 'E3000', color1: 'Black', size: 'XXL', preis: '3,90' },
    { articleNr: '3', catalogNr: 'E3000', color1: 'White', size: 'S', preis: '2,80' },
    { articleNr: '4', catalogNr: 'E3000', color1: 'White', size: 'XXL', preis: '3,50' },
  ];
  test('kleinster Preis ueber alle Groessen der angebotenen Farben', () => {
    expect(pa.ekAusLShop(['2'], L)).toEqual({ ek: 3.1, grund: null, farbenVerschieden: false });
  });
  test('zwei Farben mit verschiedenem Minimum -> kleinstes, markiert', () => {
    expect(pa.ekAusLShop(['1', '4'], L)).toEqual({ ek: 2.8, grund: null, farbenVerschieden: true });
  });
  test('fehlende LShop_ArticleNr oder unbekannte Nummer -> kein EK, Grund', () => {
    expect(pa.ekAusLShop([], L).ek).toBeNull();
    expect(pa.ekAusLShop(['1', ''], L)).toMatchObject({ ek: null, grund: 'nicht jede Variante hat eine LShop_ArticleNr' });
    expect(pa.ekAusLShop(['9'], L)).toMatchObject({ ek: null, grund: 'ArticleNr 9 steht nicht in SKU_LShop' });
    expect(pa.ekAusLShop(['1'], [{ ...L[0], preis: '' }])).toMatchObject({ ek: null });
  });
  test('preisZahl: deutsches Format', () => {
    expect(pa.preisZahl('3,45')).toBe(3.45);
    expect(pa.preisZahl('1.234,5')).toBe(1234.5);
    expect(pa.preisZahl(2.1)).toBe(2.1);
    expect(Number.isNaN(pa.preisZahl(''))).toBe(true);
  });
});

describe('offenePunkte: leer = fehlt, 0 = bewusst 0', () => {
  test('Druck 0 zaehlt nicht, leer schon', () => {
    const rows = tabs.Partner_Artikel.slice(1).filter(r => r[0] === 'P-007');
    expect(pa.offenePunkte(PA_KOPF, rows)).toEqual({ ekFehlt: 1, druckFehlt: 1 });
  });
});

// ── Import ──────────────────────────────────────────────────────────────────

describe('importiereFuerPartner (JFN)', () => {
  const imp = () => pa.importiereFuerPartner({ sheets, sheetId: 'business', partner: { id: 'P-006', hauptkategorie: 'Malle Prinz', shop: 'jfn' }, jetzt: JETZT });

  test('Dubletten ueber Produkt-ID: nach SKU-Aenderung keine zweite Zeile', async () => {
    const r = await imp();
    expect(r.neu.map(n => n.produktId)).toEqual(['21126', '21200']);
    expect(zeileVon('Partner_Artikel', '17775')).toHaveLength(1);
  });

  test('Unterkategorien und Entwuerfe kommen mit, Entwurf markiert', async () => {
    const r = await imp();
    expect(r.kategorien).toBe(2);
    expect(r.neu.find(n => n.produktId === '21200')).toMatchObject({ entwurf: true, ekFehlt: true });
  });

  test('EK aus L-Shop (kleinster ueber die angebotenen Farben), EK_Quelle, Druck leer, kein Lizenz-%', async () => {
    const r = await imp();
    const z = zeileVon('Partner_Artikel', '21126')[0];
    expect(z['EK-Preis-Netto']).toBe(2.1);
    expect(z['Druckkosten']).toBe('');
    expect(z['Lizenz-%']).toBe('');
    expect(z['EK_Quelle']).toBe('L-Shop 2026-09-26');
    expect(z['Letzte-Synchro']).toBe('26.09.2026');
    expect(z['Artikelnummer']).toBe('BG42/MPU-Bauchtasche');
    expect(r.neu.find(n => n.produktId === '21126')).toMatchObject({ ekFehlt: false, farbenVerschieden: true });
  });

  test('ohne LShop_ArticleNr: EK LEER (nicht 0), EK_Quelle leer', async () => {
    await imp();
    const z = zeileVon('Partner_Artikel', '21200')[0];
    expect(z['EK-Preis-Netto']).toBe('');
    expect(z['EK_Quelle']).toBe('');
  });

  test('EK_Quelle additiv am Ende, Kopfzeile sonst unveraendert; vorhandene Zeilen unberuehrt', async () => {
    const vorher = tabs.Partner_Artikel.map(r => [...r]);
    await imp();
    expect(tabs.Partner_Artikel[0]).toEqual([...PA_KOPF, 'EK_Quelle']);
    for (let i = 1; i < vorher.length; i++) expect(tabs.Partner_Artikel[i]).toEqual(vorher[i]);
    expect(values.update).toHaveBeenCalledTimes(1);          // nur die neue Kopfzelle
    expect(values.update.mock.calls[0][0].range).toBe('Partner_Artikel!J1');
    expect(values.batchUpdate).not.toHaveBeenCalled();
  });

  test('zweiter Lauf: nichts Neues, keine Schreibvorgaenge', async () => {
    await imp();
    values.append.mockClear(); values.update.mockClear();
    const r = await imp();
    expect(r.neu).toEqual([]);
    expect(values.append).not.toHaveBeenCalled();
    expect(values.update).not.toHaveBeenCalled();
  });
});

describe('importiereFuerPartner (HonkShop)', () => {
  test('nur veroeffentlichte, Dubletten ueber Produkt-ID, EK/Druck leer', async () => {
    const r = await pa.importiereFuerPartner({ sheets, sheetId: 'business', partner: { id: 'P-004', shop: 'honk' }, jetzt: JETZT });
    expect(r.neu.map(n => n.produktId)).toEqual(['1999']);
    expect(zeileVon('HK_Partner_Artikel', '1999')[0]).toEqual({
      'Produkt-ID': '1999', 'Artikelname': 'Honk Neu', 'EK-Preis-Netto': '', 'Druckkosten': '', 'Versandart': 'P', 'EK_Quelle': '',
    });
    expect(zeileVon('HK_Partner_Artikel', '1460')[0]['EK-Preis-Netto']).toBe(5.5);   // vorhandener EK bleibt
  });
});

// ── Abgleich ────────────────────────────────────────────────────────────────

describe('artikelAbgleich', () => {
  const lauf = () => pa.artikelAbgleich({ sheets, sheetId: 'business', wcFuer, jetzt: JETZT });

  test('nur aktive Lizenz-Partner + HonkShop, Festpreis unberuehrt', async () => {
    const r = await lauf();
    expect(r.partner.map(e => e.id)).toEqual(['P-006', 'P-007', 'P-004']);
    expect(values.append.mock.calls.map(c => c[0].range.split('!')[0])).not.toContain('FP_Artikel');
    expect(tabs.FP_Artikel).toHaveLength(1);
  });

  test('Bericht: neu, EK/Druck fehlt, Farben, Vertrag-ab leer, Summen', async () => {
    const r = await lauf();
    const p6 = r.partner.find(e => e.id === 'P-006'), p7 = r.partner.find(e => e.id === 'P-007');
    expect(p6).toMatchObject({ ekFehlt: 1, druckFehlt: 2, farbenVerschieden: 1, vertragAbLeer: false, gesperrt: null });
    expect(p7).toMatchObject({ neu: [], ekFehlt: 1, druckFehlt: 1, vertragAbLeer: true });
    expect(r.summen).toMatchObject({ partner: 3, neu: 3, vertragAbLeer: 1, fehler: 0 });
  });

  test('vorhandener EK bleibt, vorhandene Zeile wird nie geaendert', async () => {
    const vorher = zeileVon('Partner_Artikel', '18636')[0];
    await lauf();
    const nach = zeileVon('Partner_Artikel', '18636')[0];
    for (const k of PA_KOPF) expect(nach[k]).toEqual(vorher[k]);
  });

  test('gesperrte Verkaufszeilen: nur gezaehlt, wenn die Spalte "Sperre" existiert', async () => {
    tabs['Partner_Verkäufe'][0].push('Sperre');
    tabs['Partner_Verkäufe'].push(['P-006', '01.09.2026', '1', 'A', '0', 'offen', '21126', 'EK fehlt']);
    const r = await lauf();
    expect(r.partner.find(e => e.id === 'P-006').gesperrt).toBe(1);
  });

  test('Fehler bei einem Partner bricht die anderen nicht ab', async () => {
    tabs.Partner[2][2] = 'Gibt es nicht';
    const r = await lauf();
    expect(r.partner.find(e => e.id === 'P-007').fehler).toMatch(/nicht gefunden/);
    expect(r.partner.find(e => e.id === 'P-006').neu.length).toBe(2);
    expect(r.summen.fehler).toBe(1);
  });
});

// ── Chat ────────────────────────────────────────────────────────────────────

describe('buildArtikelAbgleichNachricht', () => {
  test('nichts Neues, nichts Offenes -> null (keine Nachricht)', () => {
    expect(buildArtikelAbgleichNachricht({ partner: [{ id: 'P-001', neu: [], ekFehlt: 0, druckFehlt: 0, vertragAbLeer: false }] })).toBeNull();
  });
  test('Format: Partner-ID, Namen, Entwurf, offene Punkte, Link', () => {
    const t = buildArtikelAbgleichNachricht({ partner: [
      { id: 'P-006', neu: [{ produktId: '21126', name: 'Bauchtasche' }, { produktId: '21200', name: 'Entwurf X', entwurf: true }],
        ekFehlt: 1, druckFehlt: 2, farbenVerschieden: 1, vertragAbLeer: false, gesperrt: 3 },
      { id: 'P-007', neu: [], ekFehlt: 0, druckFehlt: 0, vertragAbLeer: true },
    ] });
    expect(t.split('\n')).toEqual([
      '🧾 Partnerartikel-Abgleich',
      'P-006: 2 neu: Bauchtasche, Entwurf X (Entwurf) · EK fehlt 1 · Druck fehlt 2 · Farben mit verschiedenem EK 1 · 3 Verkaufszeile(n) gesperrt',
      'P-007: Vertrag-ab leer',
      expect.stringContaining('Mission Control'),
    ]);
  });
  test('hoechstens 5 Namen, Text durch sauber()', () => {
    const neu = Array.from({ length: 7 }, (_, i) => ({ produktId: String(i), name: i === 0 ? 'Mail a@b.de' : `A${i}` }));
    const t = buildArtikelAbgleichNachricht({ partner: [{ id: 'P-1', neu }] });
    expect(t).toMatch(/7 neu: Mail \[E-Mail entfernt\], A1, A2, A3, A4 \+2 weitere/);
  });
});

// ── Routen ──────────────────────────────────────────────────────────────────

describe('Routen', () => {
  let request, app;
  beforeAll(async () => {
    request = (await import('supertest')).default;
    const express = (await import('express')).default;
    app = express();
    app.use(express.json());
    app.use('/api/partner', (await import('../routes/partner-artikel.js')).default);
  });

  test('POST /artikel/abgleich -> Bericht + chat (Webhook lokal aus = false)', async () => {
    const res = await request(app).post('/api/partner/artikel/abgleich');
    expect(res.status).toBe(200);
    expect(res.body.summen.neu).toBe(3);
    expect(res.body.chat).toBe(false);
  });

  test('POST /:id/artikel/import nutzt die Lib (Produkt-ID-Dedup), Meldung nennt fehlende EK', async () => {
    const res = await request(app).post('/api/partner/P-006/artikel/import');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ neu: 2, kategorien: 2, ohneEk: 1 });
    expect(res.body.message).toMatch(/1 ohne EK/);
  });

  test('GET /:id/artikel: leerer EK = null, Druck 0 bleibt 0', async () => {
    const res = await request(app).get('/api/partner/P-007/artikel');
    const leer = res.body.find(a => a.produktId === '18640'), null0 = res.body.find(a => a.produktId === '18636');
    expect(leer.ekPreis).toBeNull();
    expect(leer.druckkosten).toBeNull();
    expect(null0.druckkosten).toBe(0);
  });
});

// ── Workflow ────────────────────────────────────────────────────────────────

describe('sync-partner-daily.yml', () => {
  const yml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/sync-partner-daily.yml'), 'utf8');
  test('Abgleich ist der erste Schritt, vor sync-all', () => {
    const a = yml.indexOf('/api/partner/artikel/abgleich'), s = yml.indexOf('/api/partner/verkaeufe/sync-all');
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(s);
  });
  test('Log nur Zaehler: keine ungefilterte Antwort, keine partnerIds/uebersprungen-Details', () => {
    expect(yml).not.toMatch(/jq \.\s*\|\|/);
    expect(yml).not.toMatch(/echo "\$body"/);
    expect(yml).not.toMatch(/partnerIds/);
    expect(yml).toMatch(/uebersprungen: \(\(\.uebersprungen \/\/ \[\]\) \| length\)/);
  });
});
