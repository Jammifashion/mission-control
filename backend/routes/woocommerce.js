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
    queryStringAuth: true,
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

// GET /api/woocommerce/shipping-classes
router.get('/shipping-classes', async (req, res, next) => {
  try {
    const wc = getClient();
    const { data } = await wc.get('products/shipping_classes', { per_page: 100 });
    const list = Array.isArray(data) ? data : [data];
    res.json(list.map(s => ({ id: s.id, slug: s.slug, name: s.name })));
  } catch (err) { next(err); }
});

// GET /api/woocommerce/products/search?q=&per_page=40  — must come before /:id
router.get('/products/search', async (req, res, next) => {
  try {
    const wc = getClient();
    const { q = '', per_page = 40 } = req.query;
    const { data } = await wc.get('products', {
      search:   q,
      per_page: Math.min(Number(per_page), 100),
      status:   'any',
    });
    const list = Array.isArray(data) ? data : [data];
    res.json(list.map(p => ({ id: p.id, name: p.name, sku: p.sku, status: p.status })));
  } catch (err) { next(err); }
});

// GET /api/woocommerce/products/:id/variations
router.get('/products/:id/variations', async (req, res, next) => {
  try {
    const wc = getClient();
    const { data } = await wc.get(`products/${req.params.id}/variations`, { per_page: 100 });
    res.json(Array.isArray(data) ? data : [data]);
  } catch (err) { next(err); }
});

// POST /api/woocommerce/products/:id/variations
router.post('/products/:id/variations', async (req, res, next) => {
  try {
    const wc = getClient();
    const { data: raw } = await wc.post(`products/${req.params.id}/variations`, { ...req.body, status: 'publish' });
    const v = Array.isArray(raw) ? raw[0] : raw;
    res.status(201).json({ id: v.id });
  } catch (err) { next(err); }
});

// PUT /api/woocommerce/products/:id/variations/:varId
router.put('/products/:id/variations/:varId', async (req, res, next) => {
  try {
    const wc = getClient();
    const { data: raw } = await wc.put(`products/${req.params.id}/variations/${req.params.varId}`, req.body);
    const v = Array.isArray(raw) ? raw[0] : raw;
    res.json({ id: v.id });
  } catch (err) { next(err); }
});

// DELETE /api/woocommerce/products/:id/variations/:varId
router.delete('/products/:id/variations/:varId', async (req, res, next) => {
  try {
    const wc = getClient();
    await wc.delete(`products/${req.params.id}/variations/${req.params.varId}`, { force: true });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// GET /api/woocommerce/products/:id
router.get('/products/:id', async (req, res, next) => {
  try {
    const wc = getClient();
    const { data } = await wc.get(`products/${req.params.id}`);
    const product = Array.isArray(data) ? data[0] : data;
    console.log('WC GET /products/:id meta_data:', JSON.stringify(product.meta_data ?? []));
    console.log('WC GET /products/:id shipping_class:', product.shipping_class, '| slug:', product.shipping_class_id);
    res.json(product);
  } catch (err) { next(err); }
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

// GET /api/woocommerce/stats  – today's summary + 7-day revenue
router.get('/stats', async (req, res, next) => {
  try {
    const wc = getClient();

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart  = new Date(); weekStart.setDate(weekStart.getDate() - 6); weekStart.setHours(0, 0, 0, 0);

    const [ordersToday, pendingOrders, activeProducts, ordersWeek] = await Promise.all([
      wc.get('orders', { after: todayStart.toISOString(), per_page: 100 }),
      wc.get('orders', { status: 'processing', per_page: 1 }),
      wc.get('products', { status: 'publish', per_page: 1 }),
      wc.get('orders', { after: weekStart.toISOString(), per_page: 100 }),
    ]);

    const revenueToday = ordersToday.data
      .filter(o => o.status !== 'cancelled' && o.status !== 'refunded')
      .reduce((sum, o) => sum + parseFloat(o.total), 0);

    // Build 7-day revenue map (last 7 days including today)
    const dayMap = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      const key = d.toISOString().slice(0, 10);
      dayMap[key] = { date: d.toLocaleDateString('de-DE', { weekday: 'short' }), revenue: 0 };
    }
    ordersWeek.data
      .filter(o => o.status !== 'cancelled' && o.status !== 'refunded')
      .forEach(o => {
        const key = o.date_created?.slice(0, 10);
        if (key && dayMap[key]) dayMap[key].revenue += parseFloat(o.total);
      });

    res.json({
      orders_today:    ordersToday.data.length,
      revenue_today:   revenueToday.toFixed(2),
      pending:         parseInt(pendingOrders.headers['x-wp-total'] ?? '0', 10),
      products_active: parseInt(activeProducts.headers['x-wp-total'] ?? '0', 10),
      revenue_7days:   Object.values(dayMap).map(d => ({ date: d.date, revenue: parseFloat(d.revenue.toFixed(2)) })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/woocommerce/products
// Schritt 1: Produkt anlegen (status: draft), Schritt 2: Varianten einzeln anlegen
router.post('/products', async (req, res, next) => {
  try {
    const wc = getClient();
    const { ssot_id, variations, ...payload } = req.body;

    // Schritt 1: Produkt anlegen
    console.log('WC POST /products payload:', JSON.stringify({ ...payload, status: 'draft' }, null, 2));
    const productResponse = await wc.post('products', { ...payload, status: 'draft' });
    console.log('WC POST /products HTTP status:', productResponse.status);
    const productRaw = productResponse.data;
    const product = Array.isArray(productRaw) ? productRaw[0] : productRaw;
    const productId = product.id;

    // Schritt 2: Varianten einzeln anlegen
    const variationResults = [];
    if (Array.isArray(variations) && variations.length) {
      for (const variation of variations) {
        try {
          const varResponse = await wc.post(`products/${productId}/variations`, {
            ...variation,
            status: 'publish',
          });
          const varRaw = varResponse.data;
          const v = Array.isArray(varRaw) ? varRaw[0] : varRaw;
          variationResults.push({ ok: true, id: v.id });
        } catch (varErr) {
          variationResults.push({ ok: false, error: varErr.message ?? String(varErr) });
        }
      }
    }

    const created = variationResults.filter(r => r.ok).length;
    const failed  = variationResults.filter(r => !r.ok).length;
    const errors  = variationResults.filter(r => !r.ok).map(r => r.error);

    res.status(201).json({
      id:                  productId,
      status:              product.status,
      variations_created:  created,
      variations_failed:   failed,
      variation_errors:    errors,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/woocommerce/products/:id
router.put('/products/:id', async (req, res, next) => {
  try {
    const wc = getClient();
    const { variations, ...payload } = req.body;
    console.log('WC PUT /products/:id payload:', JSON.stringify(payload, null, 2));
    const { data: productRaw } = await wc.put(`products/${req.params.id}`, payload);
    const product = Array.isArray(productRaw) ? productRaw[0] : productRaw;

    if (Array.isArray(variations) && variations.length) {
      const toUpdate = variations.filter(v => v.id).map(v => ({
        id:            v.id,
        attributes:    v.attributes,
        regular_price: v.regular_price,
      }));
      const toCreate = variations.filter(v => !v.id).map(v => ({
        attributes:    v.attributes,
        regular_price: v.regular_price,
        status:        'publish',
      }));
      if (toUpdate.length || toCreate.length) {
        await wc.post(`products/${req.params.id}/variations/batch`, {
          ...(toUpdate.length ? { update: toUpdate } : {}),
          ...(toCreate.length ? { create: toCreate } : {}),
        });
      }
    }

    res.json({ id: product.id });
  } catch (err) { next(err); }
});

export default router;
