// GET /api/woocommerce/stats - Dashboard-Kacheln (NAV2).
// Storniert/erstattet/fehlgeschlagen zaehlen weder als "Bestellungen heute"
// noch als Umsatz; "offen" = processing + on-hold.

import { jest } from '@jest/globals';

const wc = { get: jest.fn() };

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(() => ({ shop: 'jfn', label: 'JammiFashion', markenSlug: null })),
  getWcClient: jest.fn(() => wc),
}));

let request, app;

beforeAll(async () => {
  ({ default: request } = await import('supertest'));
  const { default: express } = await import('express');
  const { default: router } = await import('../routes/woocommerce.js');
  app = express();
  app.use('/api/woocommerce', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
});

const jetzt = new Date().toISOString();
const HEUTE = [
  { status: 'processing', total: '30.00', date_created: jetzt },
  { status: 'on-hold',    total: '20.00', date_created: jetzt },
  { status: 'completed',  total: '10.00', date_created: jetzt },
  { status: 'cancelled',  total: '99.00', date_created: jetzt },
  { status: 'refunded',   total: '99.00', date_created: jetzt },
  { status: 'failed',     total: '99.00', date_created: jetzt },
];

beforeEach(() => {
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
