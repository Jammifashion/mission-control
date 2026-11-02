// BO7-3: Route GET /api/lieferbarkeit-shop - hinter dem API-Key, shopStatus nur bei "1".

import { jest } from '@jest/globals';

const leseProblemliste = jest.fn(async () => ({ artikel: [], zaehler: { artikel: 0 } }));
jest.unstable_mockModule('../lib/lieferbarkeitShop.js', () => ({ leseProblemliste }));

let request;
beforeAll(async () => {
  process.env.MC_API_KEY = 'test-api-key';
  const { default: supertest } = await import('supertest');
  const { default: express } = await import('express');
  const { requireApiKey } = await import('../middleware/auth.js');
  const { default: router } = await import('../routes/lieferbarkeitShop.js');
  const app = express();
  app.use(requireApiKey);
  app.use('/api/lieferbarkeit-shop', router);
  request = () => supertest(app);
});

test('ohne API-Key 401; shopStatus nur bei "1"', async () => {
  expect((await request().get('/api/lieferbarkeit-shop')).status).toBe(401);
  await request().get('/api/lieferbarkeit-shop').set('X-API-Key', 'test-api-key');
  await request().get('/api/lieferbarkeit-shop?shopStatus=1').set('X-API-Key', 'test-api-key');
  await request().get('/api/lieferbarkeit-shop?shopStatus=ja').set('X-API-Key', 'test-api-key');
  expect(leseProblemliste.mock.calls.map(c => c[0])).toEqual([{ shopStatus: false }, { shopStatus: true }, { shopStatus: false }]);
});
