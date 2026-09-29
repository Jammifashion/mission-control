// Befehl SS1: "Status Shop" im Aendern-Modus nur senden, wenn umgestellt.
//
// Befund UCS1-2: Die Maske kannte beim Oeffnen nur publish - jeder andere
// Shop-Status (private, pending, future) wurde im Feld zu "Entwurf" und beim
// Speichern als status: 'draft' an WooCommerce geschickt.
//
// Zwei Ebenen:
//  1. Block "Shop-Status" in index.html (ausgefuehrt, gegen Attrappe)
//  2. PUT /api/woocommerce/products/:id - was an WooCommerce geht, was zurueckkommt

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: () => ({ spreadsheets: { values: { get: async () => ({ data: { values: [] } }) } } }) },
}));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));

// WooCommerce-Attrappe: ein Produkt mit einstellbarem Status. PUT uebernimmt
// status nur, wenn er im Body steht - wie echt.
const wc = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient:   jest.fn(() => wc),
}));

let request, app, shopStatus;
beforeAll(async () => {
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  app = express();
  app.use(express.json());
  app.use('/api/woocommerce', (await import('../routes/woocommerce.js')).default);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  wc.get.mockReset(); wc.post.mockReset(); wc.put.mockReset();
  wc.get.mockImplementation(async pfad => ({ data: pfad.endsWith('/variations') ? [] : { id: 100, status: shopStatus } }));
  wc.post.mockImplementation(async () => ({ data: {} }));
  wc.put.mockImplementation(async (_pfad, body) => {
    if (body.status !== undefined) shopStatus = body.status;
    return { data: { id: 100, status: shopStatus, meta_data: [] } };
  });
});
afterEach(() => jest.restoreAllMocks());

// ── Frontend-Block herausschneiden und AUSFUEHREN ───────────────────────────
const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von  = html.indexOf('// ── Shop-Status: Anfang');
const bis  = html.indexOf('// ── Shop-Status: Ende ──');
const fe   = new Function(`${html.slice(von, bis)}
  return { SS_UNVERAENDERT, ssLabel, ssOptionen, ssZuSenden };`)();

// Wie der Aendern-Pfad: Feld aus dem geladenen Status befuellen, Nutzer waehlt
// (oder nicht), dann PUT mit status nur bei Umstellung.
async function speichern(geladen, gewaehlt) {
  const opts = fe.ssOptionen(geladen);
  const wahl = gewaehlt ?? opts.find(o => o.selected).value;
  const neu  = fe.ssZuSenden(geladen, wahl);
  const res  = await request(app).put('/api/woocommerce/products/100')
    .send({ name: 'Shirt', ...(neu !== undefined ? { status: neu } : {}) });
  return { res, body: wc.put.mock.calls[0][1] };
}

// ════════════════════════════════════════════════════════════════════════════
describe('Feld "Status Shop" beim Oeffnen', () => {
  test.each(['draft', 'publish'])('%s -> normale Auswahl, keine Zusatzzeile', s => {
    const opts = fe.ssOptionen(s);
    expect(opts.map(o => o.value)).toEqual(['draft', 'publish']);
    expect(opts.find(o => o.selected).value).toBe(s);
  });

  test.each([['private', 'Privat (unverändert)'], ['pending', 'Ausstehend (unverändert)'],
             ['future', 'Geplant (unverändert)'], [null, 'unbekannt (unverändert)'], ['trash', 'trash (unverändert)']])(
    '%s -> "%s" ausgewaehlt, nicht mehr "Entwurf"', (s, text) => {
      const opts = fe.ssOptionen(s);
      expect(opts[0]).toEqual({ value: fe.SS_UNVERAENDERT, text, selected: true });
      expect(opts.filter(o => o.selected)).toHaveLength(1);
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Speichern im Aendern-Modus (Attrappe)', () => {
  test.each(['private', 'pending', 'future'])('%s, nichts umgestellt -> kein status im PUT, Shop bleibt %s', async s => {
    shopStatus = s;
    const { res, body } = await speichern(s);
    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty('status');
    expect(shopStatus).toBe(s);
    expect(res.body.status).toBe(s);
    expect(fe.ssLabel(res.body.status)).toBe({ private: 'Privat', pending: 'Ausstehend', future: 'Geplant' }[s]);
  });

  test('publish, nichts umgestellt -> kein status im PUT', async () => {
    shopStatus = 'publish';
    const { body, res } = await speichern('publish');
    expect(body).not.toHaveProperty('status');
    expect(res.body.status).toBe('publish');
    expect(fe.ssLabel(res.body.status)).toBe('Veröffentlicht');
  });

  test('Umstellen draft -> publish -> status: publish', async () => {
    shopStatus = 'draft';
    const { body, res } = await speichern('draft', 'publish');
    expect(body.status).toBe('publish');
    expect(res.body.status).toBe('publish');
  });

  test('Umstellen private -> draft ist bewusst moeglich', async () => {
    shopStatus = 'private';
    const { body } = await speichern('private', 'draft');
    expect(body.status).toBe('draft');
  });

  test('ssZuSenden: unveraendert / Platzhalter / leer -> nichts', () => {
    expect(fe.ssZuSenden('publish', 'publish')).toBeUndefined();
    expect(fe.ssZuSenden('private', fe.SS_UNVERAENDERT)).toBeUndefined();
    expect(fe.ssZuSenden('draft', '')).toBeUndefined();
    expect(fe.ssZuSenden('publish', 'draft')).toBe('draft');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Anbindung in index.html', () => {
  test('Laden: Shop-Status 1:1 gemerkt, keine publish/draft-Zuordnung mehr', () => {
    expect(html).not.toContain("statusShopSel.value = (p.status === 'publish') ? 'publish' : 'draft';");
    expect(html).toContain('shopStatusGeladen = p.status ?? null;');
    expect(html).toContain('populateShopStatus(shopStatusGeladen);');
  });

  test('PUT: status nur ueber ssZuSenden', () => {
    expect(html).toContain('const statusNeu = ssZuSenden(shopStatusGeladen, statusShopSel.value);');
    expect(html).toContain('...(statusNeu !== undefined ? { status: statusNeu } : {}),');
    expect(html).not.toMatch(/status:\s+selectedShopStatus/);
    expect(html).not.toContain('selectedShopStatus');
  });

  test('Erfassungsmaske: "Status Shop" aus dem tatsaechlichen Shop-Status der Antwort', () => {
    expect(html).toContain('const statusIst = data.status ?? statusNeu ?? shopStatusGeladen;');
    expect(html).toContain('statusShop: ssLabel(statusIst),');
    expect(html).toContain("'Status Shop': ssLabel(statusIst),");
  });
});
