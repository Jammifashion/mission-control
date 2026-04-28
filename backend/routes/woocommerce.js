import { Router } from 'express';
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';

const router = Router();

function getClient() {
  if (!process.env.WC_URL || !process.env.WC_KEY || !process.env.WC_SECRET) {
    throw new Error('WooCommerce-Zugangsdaten fehlen (WC_URL, WC_KEY, WC_SECRET).');
  }
  return new WooCommerceRestApi.default({
    url: process.env.WC_URL,
    consumerKey: process.env.WC_KEY,
    consumerSecret: process.env.WC_SECRET,
    version: 'wc/v3',
  });
}

// GET /api/woocommerce/orders
router.get('/orders', async (req, res, next) => {
  try {
    const wc = getClient();
    const { per_page = 20, page = 1, status } = req.query;
    const params = { per_page: Math.min(Number(per_page), 100), page: Number(page) };
    if (status) params.status = status;
    const { data } = await wc.get('orders', params);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/woocommerce/orders/:id
router.get('/orders/:id', async (req, res, next) => {
  try {
    const wc = getClient();
    const { data } = await wc.get(`orders/${req.params.id}`);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/woocommerce/products
router.get('/products', async (req, res, next) => {
  try {
    const wc = getClient();
    const { per_page = 20, page = 1, status = 'publish' } = req.query;
    const { data } = await wc.get('products', {
      per_page: Math.min(Number(per_page), 100),
      page: Number(page),
      status,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/woocommerce/stats  – today's summary
router.get('/stats', async (req, res, next) => {
  try {
    const wc = getClient();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [ordersToday, pendingOrders, activeProducts] = await Promise.all([
      wc.get('orders', { after: todayStart.toISOString(), per_page: 100 }),
      wc.get('orders', { status: 'processing', per_page: 1 }),
      wc.get('products', { status: 'publish', per_page: 1 }),
    ]);

    const revenueToday = ordersToday.data
      .filter(o => o.status !== 'cancelled' && o.status !== 'refunded')
      .reduce((sum, o) => sum + parseFloat(o.total), 0);

    res.json({
      orders_today: ordersToday.data.length,
      revenue_today: revenueToday.toFixed(2),
      pending: parseInt(pendingOrders.headers['x-wp-total'] ?? '0', 10),
      products_active: parseInt(activeProducts.headers['x-wp-total'] ?? '0', 10),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
