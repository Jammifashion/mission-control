// GET /api/woocommerce/stats - Dashboard-Kacheln (NAV2).
// Storniert/erstattet/fehlgeschlagen zaehlen weder als "Bestellungen heute"
// noch als Umsatz; "offen" = processing + on-hold.
// NAV3: "heute" und die 7 Tage nach Europe/Berlin (feste Uhr, utils/berlin-tag.js).

import { jest } from '@jest/globals';

const wc = { get: jest.fn() };

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient: jest.fn(() => wc),
}));

let request, app, uhr;

beforeAll(async () => {
  ({ default: request } = await import('supertest'));
  const { default: express } = await import('express');
  ({ uhr } = await import('../utils/berlin-tag.js'));
  const { default: router } = await import('../routes/woocommerce.js');
  app = express();
  app.use('/api/woocommerce', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
});

// Feste Uhr: 20.10.2026 12:00 Berlin; date_created in Ortszeit des Shops.
const JETZT = new Date('2026-10-20T10:00:00Z');
const jetzt = '2026-10-20T11:30:00';
const HEUTE = [
  { status: 'processing', total: '30.00', date_created: jetzt },
  { status: 'on-hold',    total: '20.00', date_created: jetzt },
  { status: 'completed',  total: '10.00', date_created: jetzt },
  { status: 'cancelled',  total: '99.00', date_created: jetzt },
  { status: 'refunded',   total: '99.00', date_created: jetzt },
  { status: 'failed',     total: '99.00', date_created: jetzt },
];

beforeEach(() => {
  uhr.jetzt = () => JETZT;
  wc.get.mockReset().mockImplementation(async (pfad, params) => {
    if (pfad === 'products') return { data: [], headers: { 'x-wp-total': '7' } };
    if (params?.status === 'on-hold')    return { data: [], headers: { 'x-wp-total': '2' } };
    if (params?.status === 'processing') return { data: [], headers: { 'x-wp-total': '5' } };
    return { data: HEUTE, headers: {} };
  });
});

test('Bestellungen heute und Umsatz ohne Storno/Erstattung/fehlgeschlagen', async () => {
  const res = await request(app).get('/api/woocommerce/stats');
  expect(res.status).toBe(200);
  expect(res.body.orders_today).toBe(3);
  expect(res.body.revenue_today).toBe('60.00');
});

test('offen = processing + on-hold, pending bleibt on-hold (Donut)', async () => {
  const res = await request(app).get('/api/woocommerce/stats');
  expect(res.body.offen).toBe(7);
  expect(res.body.processing).toBe(5);
  expect(res.body.pending).toBe(2);
});

test('7-Tage-Umsatz nutzt dieselbe Filterung', async () => {
  const res = await request(app).get('/api/woocommerce/stats');
  const summe = res.body.revenue_7days.reduce((s, d) => s + d.revenue, 0);
  expect(summe).toBeCloseTo(60, 2);
});

// ── Tagesgrenze Europe/Berlin ───────────────────────────────────────────────
describe('Tagesgrenze nach Berliner Zeit', () => {
  // 00:30 Berlin am 21.10. = 22:30 UTC am 20.10. (Sommerzeit)
  const KURZ_NACH_MITTERNACHT = new Date('2026-10-20T22:30:00Z');
  const ORDERS = [
    { status: 'processing', total: '40.00', date_created: '2026-10-21T00:10:00' }, // Berlin: heute
    { status: 'processing', total: '15.00', date_created: '2026-10-20T23:50:00' }, // Berlin: gestern
  ];

  beforeEach(() => {
    uhr.jetzt = () => KURZ_NACH_MITTERNACHT;
    wc.get.mockImplementation(async (pfad, params) => {
      if (pfad === 'products' || params?.status) return { data: [], headers: { 'x-wp-total': '0' } };
      return { data: ORDERS, headers: {} };
    });
  });

  test('after ist Mitternacht Berlin des neuen Tages, nicht UTC', async () => {
    await request(app).get('/api/woocommerce/stats');
    const afters = wc.get.mock.calls.map(c => c[1]?.after).filter(Boolean);
    expect(afters).toEqual(['2026-10-21T00:00:00', '2026-10-15T00:00:00']);
  });

  test('Bestellung von 00:10 zaehlt zu heute, 23:50 zum Vortag', async () => {
    const res = await request(app).get('/api/woocommerce/stats');
    expect(res.body.orders_today).toBe(1);
    expect(res.body.revenue_today).toBe('40.00');
    const tage = res.body.revenue_7days;
    expect(tage).toHaveLength(7);
    expect(tage[6].revenue).toBe(40); expect(tage[6].date).toMatch(/^Mi/);
    expect(tage[5].revenue).toBe(15); expect(tage[5].date).toMatch(/^Di/);
  });
});
