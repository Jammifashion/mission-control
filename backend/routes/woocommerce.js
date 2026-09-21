import { Router } from 'express';
import { getWcClient } from '../lib/shopConfig.js';
import { markeFuerShop } from '../lib/shopMarke.js';
import { pruefeArtikelnummer, baueVariantenSkus } from '../lib/sku.js';

const router = Router();

// shop-Slug aus req.query.shop ziehen (Default 'jfn' wird in getWcClient erzwungen).
const getClient = (req) => getWcClient(req?.query?.shop);

// ── N2: In-Memory Cache für selten ändernde WC-Stammdaten ────────────────────
const _wcCache = new Map(); // `${shop}:${key}` → { data, at }
const WC_CACHE_TTL = 30 * 60 * 1000; // 30 min

async function wcCached(shop, key, fetcher) {
  const cacheKey = `${shop ?? 'jfn'}:${key}`;
  const hit = _wcCache.get(cacheKey);
  if (hit && Date.now() - hit.at < WC_CACHE_TTL) return hit.data;
  const data = await fetcher();
  _wcCache.set(cacheKey, { data, at: Date.now() });
  return data;
}

// GET /api/woocommerce/orders
router.get('/orders', async (req, res, next) => {
  try {
    const wc = getClient(req);
    const { per_page = 20, page = 1, status } = req.query;
    const perPage = Math.min(Number(per_page), 100);

    // Bei mehreren Status: alle Seiten je Status vollständig laden, dann zusammenführen
    // und erst danach paginieren – sonst mischt Seite N verschiedene Status inkorrekt.
    if (status && status.includes(',')) {
      const statuses = status.split(',').map(s => s.trim());
      const all = [];
      await Promise.all(statuses.map(async s => {
        for (let p = 1; ; p++) {
          const { data } = await wc.get('orders', { per_page: 100, page: p, status: s });
          all.push(...data);
          if (data.length < 100) break;
        }
      }));
      all.sort((a, b) => new Date(b.date_created) - new Date(a.date_created));
      const start = (Number(page) - 1) * perPage;
      return res.json(all.slice(start, start + perPage));
    }

    const params = { per_page: perPage, page: Number(page) };
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
    const wc = getClient(req);
    const { data } = await wc.get(`orders/${req.params.id}`);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/woocommerce/shipping-classes
router.get('/shipping-classes', async (req, res, next) => {
  try {
    const wc = getClient(req);
    const result = await wcCached(req.query.shop, 'shipping-classes', async () => {
      const { data } = await wc.get('products/shipping_classes', { per_page: 100 });
      return (Array.isArray(data) ? data : [data]).map(s => ({ id: s.id, slug: s.slug, name: s.name }));
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/woocommerce/categories
router.get('/categories', async (req, res, next) => {
  try {
    const wc = getClient(req);
    const result = await wcCached(req.query.shop, 'categories', async () => {
      const { data } = await wc.get('products/categories', { per_page: 100, hide_empty: false });
      const list = Array.isArray(data) ? data : [data];
      const byId = Object.fromEntries(list.map(c => [c.id, c.name]));
      return list.map(c => ({
        Kategorienummer: String(c.id),
        Kategoriename:   c.name,
        Kategorien:      c.parent ? `${byId[c.parent] ?? ''} > ${c.name}` : c.name,
      }));
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/woocommerce/attributes  — name + all terms
router.get('/attributes', async (req, res, next) => {
  try {
    const wc = getClient(req);
    const result = await wcCached(req.query.shop, 'attributes', async () => {
      const { data: attrs } = await wc.get('products/attributes', { per_page: 100 });
      const list = Array.isArray(attrs) ? attrs : [attrs];
      return Promise.all(list.map(async a => {
        const { data: terms } = await wc.get(`products/attributes/${a.id}/terms`, { per_page: 100 });
        return { eigenschaft: a.name, begriffe: (Array.isArray(terms) ? terms : [terms]).map(t => t.name) };
      }));
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/woocommerce/products/search?q=&per_page=40  — must come before /:id
router.get('/products/search', async (req, res, next) => {
  try {
    const wc = getClient(req);
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
    const wc = getClient(req);
    const { data } = await wc.get(`products/${req.params.id}/variations`, { per_page: 100 });
    res.json(Array.isArray(data) ? data : [data]);
  } catch (err) { next(err); }
});

// POST /api/woocommerce/products/:id/variations
router.post('/products/:id/variations', async (req, res, next) => {
  try {
    const wc = getClient(req);
    const { data: raw } = await wc.post(`products/${req.params.id}/variations`, { ...req.body, status: 'publish' });
    const v = Array.isArray(raw) ? raw[0] : raw;
    res.status(201).json({ id: v.id });
  } catch (err) { next(err); }
});

// PUT /api/woocommerce/products/:id/variations/:varId
router.put('/products/:id/variations/:varId', async (req, res, next) => {
  try {
    const wc = getClient(req);
    const { data: raw } = await wc.put(`products/${req.params.id}/variations/${req.params.varId}`, req.body);
    const v = Array.isArray(raw) ? raw[0] : raw;
    res.json({ id: v.id });
  } catch (err) { next(err); }
});

// DELETE /api/woocommerce/products/:id/variations/:varId
router.delete('/products/:id/variations/:varId', async (req, res, next) => {
  try {
    const wc = getClient(req);
    await wc.delete(`products/${req.params.id}/variations/${req.params.varId}`, { force: true });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// GET /api/woocommerce/products/:id
router.get('/products/:id', async (req, res, next) => {
  try {
    const wc = getClient(req);
    const { data } = await wc.get(`products/${req.params.id}`);
    const product = Array.isArray(data) ? data[0] : data;
    res.json(product);
  } catch (err) { next(err); }
});

// GET /api/woocommerce/products
router.get('/products', async (req, res, next) => {
  try {
    const wc = getClient(req);
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
    const wc = getClient(req);

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart  = new Date(); weekStart.setDate(weekStart.getDate() - 6); weekStart.setHours(0, 0, 0, 0);

    const [ordersToday, pendingOrders, processingOrders, activeProducts, ordersWeek] = await Promise.all([
      wc.get('orders', { after: todayStart.toISOString(), per_page: 100 }),
      wc.get('orders', { status: 'on-hold',    per_page: 1 }),
      wc.get('orders', { status: 'processing', per_page: 1 }),
      wc.get('products', { status: 'publish',  per_page: 1 }),
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
      pending:         parseInt(pendingOrders.headers['x-wp-total']    ?? '0', 10),
      processing:      parseInt(processingOrders.headers['x-wp-total'] ?? '0', 10),
      products_active: parseInt(activeProducts.headers['x-wp-total'] ?? '0', 10),
      revenue_7days:   Object.values(dayMap).map(d => ({ date: d.date, revenue: parseFloat(d.revenue.toFixed(2)) })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/woocommerce/products
// Schritt 1: Produkt anlegen (status: draft), Schritt 2: Varianten einzeln anlegen
//
// Marke: setzt das Backend selbst aus shopConfig.markenSlug - ein brands-Feld
// aus dem Body wird verworfen. Existiert der Slug im Shop nicht, scheitert die
// Anlage VOR dem Anlegen. Shop ohne Slug (honk): kein brands-Feld.
// Die Antwort enthaelt den Markennamen aus der WooCommerce-Antwort.
router.post('/products', async (req, res, next) => {
  try {
    const wc = getClient(req);
    const { ssot_id, variations, brands: _brandsAusBody, ...rest } = req.body;

    // S2: die SKU-Regeln gelten hier, nicht nur im Frontend. Ein Admin-Endpunkt
    // scheitert laut, statt eine 67-Zeichen-SKU oder eine leere durchzulassen.
    const artNrFehler = pruefeArtikelnummer(rest.sku);
    if (artNrFehler) return res.status(400).json({ error: artNrFehler.fehler, feld: artNrFehler.feld });

    // Varianten-SKUs VOR dem Anlegen pruefen: sonst bricht WooCommerce mitten
    // im Anlegen ab und hinterlaesst ein halb bestuecktes Produkt.
    const vorabSkus = baueVariantenSkus(rest.sku, variations ?? []);
    if (vorabSkus.fehler) return res.status(400).json({ error: vorabSkus.fehler, feld: vorabSkus.feld });

    const marke   = await markeFuerShop(req.query.shop);
    const payload = marke ? { ...rest, brands: [{ id: marke.id }] } : rest;

    // Schritt 1: Produkt anlegen (mit SKU-Fallback bei Duplikat)
    let productResponse;
    let skuHinweis = null;
    try {
      productResponse = await wc.post('products', { ...payload, status: 'draft' });
    } catch (skuErr) {
      if (skuErr.response?.data?.code === 'product_invalid_sku') {
        const fallbackSku = (payload.sku || '') + '-v2';
        console.warn(`SKU "${payload.sku}" bereits vergeben – Retry mit "${fallbackSku}"`);
        // Nicht mehr still: der Aufrufer bekommt den Hinweis in der Antwort und
        // zeigt ihn im Statustext. Sonst merkt niemand, dass die Nummer im Shop
        // eine andere ist als in der Erfassungsmaske.
        skuHinweis = `SKU "${payload.sku}" war bereits vergeben – angelegt als "${fallbackSku}".`;
        try {
          productResponse = await wc.post('products', { ...payload, sku: fallbackSku, status: 'draft' });
        } catch (retryErr) {
          const msg = retryErr.response?.data?.message || retryErr.message;
          console.error('WC SKU Retry fehlgeschlagen:', retryErr.response?.data);
          const e = new Error(`SKU bereits vergeben. Bitte Artikelnummer anpassen. (${msg})`);
          e.status = 422;
          throw e;
        }
      } else {
        throw skuErr;
      }
    }
    const productRaw = productResponse.data;
    const product = Array.isArray(productRaw) ? productRaw[0] : productRaw;
    const productId = product.id;

    // Schritt 2: Varianten einzeln anlegen - jede mit eigener SKU.
    // Gebaut wird aus der TATSAECHLICH vergebenen Eltern-SKU: hat der Fallback
    // oben auf "-v2" gedreht, muessen die Varianten mitwandern.
    const effektiveSku = product.sku || payload.sku;
    const nachSkus     = baueVariantenSkus(effektiveSku, variations ?? []);
    if (nachSkus.fehler) {
      // Das Produkt steht schon - hier nicht mehr abbrechen, sondern melden.
      skuHinweis = [skuHinweis, `Varianten-SKUs nicht vergeben: ${nachSkus.fehler}`].filter(Boolean).join(' ');
    }
    const variationResults = [];
    if (Array.isArray(variations) && variations.length) {
      for (const [vi, variation] of variations.entries()) {
        try {
          const varResponse = await wc.post(`products/${productId}/variations`, {
            ...variation,
            ...(nachSkus.skus ? { sku: nachSkus.skus[vi] } : {}),
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

    const created      = variationResults.filter(r => r.ok).length;
    const failed       = variationResults.filter(r => !r.ok).length;
    const errors       = variationResults.filter(r => !r.ok).map(r => r.error);
    const variationIds = variationResults.map(r => r.ok ? r.id : null);

    // Markenname so, wie WooCommerce ihn zurueckmeldet - nicht angenommen.
    const markeGesetzt = (product.brands ?? []).map(b => b.name).filter(Boolean).join(', ');
    if (marke && !markeGesetzt)
      console.warn(`Produkt ${productId}: Marke "${marke.slug}" gesendet, WooCommerce meldet keine Marke zurueck.`);

    res.status(201).json({
      id:                  productId,
      status:              product.status,
      marke:               markeGesetzt,
      sku:                 product.sku ?? '',
      hinweis:             skuHinweis,
      variations_created:  created,
      variations_failed:   failed,
      variation_errors:    errors,
      variation_ids:       variationIds,
    });
  } catch (err) {
    console.error('WC Error Response:', err.response?.data);
    next(err);
  }
});

// PUT /api/woocommerce/products/:id
// Schickt nie brands: ein nicht leeres Array ersetzt in WooCommerce alle
// vorhandenen Marken (wp_set_object_terms ohne append) - auch von Hand gesetzte.
router.put('/products/:id', async (req, res, next) => {
  try {
    const wc = getClient(req);
    const { variations, brands: _brandsAusBody, ...payload } = req.body;

    // Dieselben Regeln wie beim Anlegen. Achtung, bewusste Folge: ein
    // Bestandsartikel mit langer Alt-SKU laesst sich erst wieder speichern,
    // wenn seine Artikelnummer gekuerzt ist. Migriert wird nichts (S2, Punkt 7).
    if (payload.sku !== undefined) {
      const artNrFehler = pruefeArtikelnummer(payload.sku);
      if (artNrFehler) return res.status(400).json({ error: artNrFehler.fehler, feld: artNrFehler.feld });
    }
    const varSkus = baueVariantenSkus(payload.sku ?? '', variations ?? []);
    if (payload.sku !== undefined && varSkus.fehler)
      return res.status(400).json({ error: varSkus.fehler, feld: varSkus.feld });

    const { data: productRaw } = await wc.put(`products/${req.params.id}`, payload);
    const product = Array.isArray(productRaw) ? productRaw[0] : productRaw;

    if (Array.isArray(variations) && variations.length) {
      const skuVon = v => {
        const i = variations.indexOf(v);
        return varSkus.skus && varSkus.skus[i] ? { sku: varSkus.skus[i] } : {};
      };
      const toUpdate = variations.filter(v => v.id).map(v => ({
        id:            v.id,
        attributes:    v.attributes,
        regular_price: v.regular_price,
        ...skuVon(v),
        ...(v.image ? { image: v.image } : {}),
      }));
      const toCreate = variations.filter(v => !v.id).map(v => ({
        attributes:    v.attributes,
        regular_price: v.regular_price,
        status:        'publish',
        ...skuVon(v),
        ...(v.image ? { image: v.image } : {}),
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

// PUT /api/woocommerce/orders/:id/status
router.put('/orders/:id/status', async (req, res, next) => {
  try {
    const wc = getClient(req);
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status fehlt' });
    const { data } = await wc.put(`orders/${req.params.id}`, { status });
    const order = Array.isArray(data) ? data[0] : data;
    res.json({ id: order.id, status: order.status });
  } catch (err) { next(err); }
});

export default router;
