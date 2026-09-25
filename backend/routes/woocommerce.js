import { Router } from 'express';
import { getWcClient } from '../lib/shopConfig.js';
import { markeFuerShop } from '../lib/shopMarke.js';
import { pruefeArtikelnummer, baueVariantenSkus } from '../lib/sku.js';
import { achsenVon, achsenGleich, pruefeFarbAchse, mitGoogleFarbe } from '../lib/varianten-achsen.js';
import {
  LIEFERZEIT_WIE_ELTERN, pruefeLieferzeitWert, lieferzeitAusMetaData, mitLieferzeit,
} from '../lib/lieferzeiten.js';
import { sortiereAttributOptionen, variantenReihenfolge } from '../lib/groessen.js';
import { merkeKeyphrase } from '../lib/seo-artikel.js';

const router = Router();

// M3: Versandklasse (Slug). Anlage: Pflicht. Aenderung: nur Hinweis (S2b-Muster).
function pruefeVersandklasse(slug) {
  return String(slug ?? '').trim()
    ? null
    : 'Versandklasse fehlt – bei der Anlage Pflicht (brief, grossbrief, paket …).';
}

// shop-Slug aus req.query.shop ziehen (Default 'jfn' wird in getWcClient erzwungen).
const getClient = (req) => getWcClient(req?.query?.shop);

// Body einer NEU anzulegenden Variation im Aenderungspfad - eine Stelle fuer
// "Artikel aendern/Speichern" (PUT) und "Neue Varianten anlegen" (ergaenzen):
// "-1" = Lieferzeit wie Elternartikel, menu_order nach Befehl R, SKU nach sku.js.
function neueVariation(v, { menuOrder, sku } = {}) {
  return {
    menu_order:    menuOrder,
    attributes:    v.attributes,
    regular_price: v.regular_price,
    // M3: _wc_gla_color = Farbwert 1:1, nur an neuen Variationen.
    meta_data:     mitGoogleFarbe(mitLieferzeit(v.meta_data, LIEFERZEIT_WIE_ELTERN), v.attributes),
    status:        'publish',
    ...(sku ? { sku } : {}),
    ...(v.image ? { image: v.image } : {}),
  };
}

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
    const { ssot_id, variations, brands: _brandsAusBody, lieferzeit, ...rest } = req.body;

    // _lieferzeit am Elternartikel: Term-ID als String. Ein kaputter Wert
    // scheitert VOR dem Anlegen. Fehlt das Feld, wird nichts gesetzt und die
    // Antwort sagt es (lieferzeit.status) - der Aufrufer meldet es per Toast.
    if (lieferzeit !== undefined) {
      const lzFehler = pruefeLieferzeitWert(lieferzeit);
      if (lzFehler) return res.status(400).json({ error: lzFehler, feld: 'lieferzeit' });
    }

    // S2: die SKU-Regeln gelten hier, nicht nur im Frontend. Ein Admin-Endpunkt
    // scheitert laut, statt eine 67-Zeichen-SKU oder eine leere durchzulassen.
    const artNrFehler = pruefeArtikelnummer(rest.sku);
    if (artNrFehler) return res.status(400).json({ error: artNrFehler.fehler, feld: artNrFehler.feld });

    // Varianten-SKUs VOR dem Anlegen pruefen: sonst bricht WooCommerce mitten
    // im Anlegen ab und hinterlaesst ein halb bestuecktes Produkt.
    const vorabSkus = baueVariantenSkus(rest.sku, variations ?? []);
    if (vorabSkus.fehler) return res.status(400).json({ error: vorabSkus.fehler, feld: vorabSkus.feld });

    // Hat der Artikel Achsen, muss eine davon "Farbe" sein. Im Anlagepfad
    // streng: wer neu anlegt, legt vollstaendig an. Ohne Achse greift die Regel
    // nicht - Puck und Kuscheltier bleiben gueltig.
    const achsenFehler = pruefeFarbAchse(achsenVon({ attribute: rest.attributes, varianten: variations }));
    if (achsenFehler) return res.status(400).json({ error: achsenFehler.fehler, feld: achsenFehler.feld });

    // M3: Versandklasse ist bei der Anlage Pflicht. Ohne Klasse legt WooCommerce
    // den Artikel ohne Klasse an (so entstanden die vier Oldschool-Artikel).
    const versandFehler = pruefeVersandklasse(rest.shipping_class);
    if (versandFehler) return res.status(400).json({ error: versandFehler, feld: 'shipping_class' });

    // Groessen aufsteigend: Optionen der Groessen-Achse sortiert schicken. Das
    // Auswahlfeld im Shop folgt bei lokalen Attributen dieser Reihenfolge.
    const groessen = sortiereAttributOptionen(rest.attributes);

    const marke   = await markeFuerShop(req.query.shop);
    const payload = {
      ...rest,
      ...(Array.isArray(rest.attributes) ? { attributes: groessen.attributes } : {}),
      ...(marke ? { brands: [{ id: marke.id }] } : {}),
      ...(lieferzeit !== undefined ? { meta_data: mitLieferzeit(rest.meta_data, lieferzeit) } : {}),
    };

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
    // Variationen in sortierter Reihenfolge anlegen (Farbe, dann Groesse
    // aufsteigend) und menu_order danach setzen. Ergebnisse bleiben am INDEX
    // der Eingabe: variation_ids und die Varianten-SKUs sind index-gebunden.
    const variationResults = [];
    if (Array.isArray(variations) && variations.length) {
      const reihenfolge = variantenReihenfolge(variations, groessen.attributes);
      for (const [pos, vi] of reihenfolge.entries()) {
        const variation = variations[vi];
        try {
          // Jede neue Variation bekommt "-1" = wie Elternartikel. Nie leer
          // (erbt nicht), nie "'-1" (blockiert die Anzeige).
          const varResponse = await wc.post(`products/${productId}/variations`, {
            ...variation,
            ...(nachSkus.skus ? { sku: nachSkus.skus[vi] } : {}),
            // M3: _wc_gla_color = Farbwert 1:1 (Entscheidung Inhaber 25.09.).
            meta_data: mitGoogleFarbe(mitLieferzeit(variation.meta_data, LIEFERZEIT_WIE_ELTERN), variation.attributes),
            menu_order: pos + 1,
            status: 'publish',
          });
          const varRaw = varResponse.data;
          const v = Array.isArray(varRaw) ? varRaw[0] : varRaw;
          variationResults[vi] = { ok: true, id: v.id, lieferzeit: lieferzeitAusMetaData(v.meta_data) };
        } catch (varErr) {
          variationResults[vi] = { ok: false, error: varErr.message ?? String(varErr) };
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

    // Lieferzeit so, wie WooCommerce sie zurueckmeldet - nicht angenommen.
    const lzEltern  = lieferzeitAusMetaData(product.meta_data);
    const lzVarOk   = variationResults.filter(r => r.ok && r.lieferzeit === LIEFERZEIT_WIE_ELTERN).length;
    const lzVarAb   = variationResults.filter(r => r.ok && r.lieferzeit !== LIEFERZEIT_WIE_ELTERN)
                        .map(r => ({ id: r.id, wert: r.lieferzeit }));
    const lieferzeitStand = {
      gesendet:    lieferzeit ?? null,
      gesetzt:     lzEltern,
      status:      lieferzeit === undefined           ? 'nicht gesetzt'
                 : lzEltern === lieferzeit            ? 'gesetzt'
                 :                                      'abweichend',
      grund:       lieferzeit === undefined           ? 'keine Lieferzeit übergeben'
                 : lzEltern === lieferzeit            ? null
                 : `WooCommerce meldet "${lzEltern ?? '(kein Wert)'}" statt "${lieferzeit}"`,
      variationen: { wie_eltern: lzVarOk, abweichend: lzVarAb },
    };

    res.status(201).json({
      id:                  productId,
      status:              product.status,
      marke:               markeGesetzt,
      lieferzeit:          lieferzeitStand,
      galerie:             (product.images ?? []).length,
      sku:                 product.sku ?? '',
      hinweis:             [skuHinweis, groessen.hinweis].filter(Boolean).join(' ') || null,
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
    const { variations, brands: _brandsAusBody, lieferzeit, ...payload } = req.body;

    // _lieferzeit im Aenderungspfad: nur wenn der Aufrufer sie ausdruecklich
    // mitschickt (Nutzer hat die Auswahl geaendert). Ohne Feld bleibt der
    // Shop-Wert unangetastet. Nur Elternartikel; bestehende Variationen nie,
    // neu angelegte bekommen unten "-1".
    if (lieferzeit !== undefined) {
      const lzFehler = pruefeLieferzeitWert(lieferzeit);
      if (lzFehler) return res.status(400).json({ error: lzFehler, feld: 'lieferzeit' });
      payload.meta_data = mitLieferzeit(payload.meta_data, lieferzeit);
    }

    // S2b: der Aenderungspfad ist milder als die Anlage.
    //
    // S2 hat hier dieselbe Strenge angelegt wie beim Anlegen - mit der Folge,
    // dass sich kein Bestandsartikel mehr speichern liess, auch nicht fuer eine
    // reine Preisaenderung. Damit haette der Alltag genau die Migration
    // erzwungen, die S2 Punkt 7 ausschliesst; und weil die Artikelnummer der
    // Upsert-Schluessel der Erfassungsmaske ist, legt jede SKU-Aenderung dort
    // eine zweite Zeile an.
    //
    // Unveraendert gegenueber dem SHOP-Stand: durchlassen und melden.
    // Geaendert: volle Regeln, 400 mit Feldname - wer sie anfasst, macht sie
    // richtig. Der Anlage-Pfad bleibt unveraendert streng.
    let skuHinweis = null;
    let varSkus    = { skus: null };

    if (payload.sku !== undefined) {
      const artNrFehler = pruefeArtikelnummer(payload.sku);

      if (!artNrFehler) {
        varSkus = baueVariantenSkus(payload.sku, variations ?? []);
        if (varSkus.fehler) return res.status(400).json({ error: varSkus.fehler, feld: varSkus.feld });
      } else {
        // Ob die Nummer "unveraendert" ist, entscheidet allein der Shop-Stand,
        // nicht der Body. Der GET kostet nur in diesem Zweig eine Anfrage.
        let shopSku = null;
        try {
          const { data: alt } = await wc.get(`products/${req.params.id}`);
          const altProdukt = Array.isArray(alt) ? alt[0] : alt;
          shopSku = String(altProdukt?.sku ?? '').trim();
        } catch (e) {
          // Ohne Shop-Stand laesst sich "unveraendert" nicht belegen - dann
          // bleibt es streng, statt eine kaputte Nummer durchzuwinken.
          console.warn(`PUT /products/${req.params.id}: Shop-SKU nicht lesbar (${e.message}) – strenge Pruefung.`);
        }

        if (shopSku !== null && shopSku === String(payload.sku).trim()) {
          // Punkt 3: Varianten-SKUs bleiben unangetastet. Aus einer
          // 67-Zeichen-SKU liessen sich sonst nur Varianten-SKUs bauen, die
          // die 50 reissen und das Speichern wieder blockieren.
          skuHinweis = `Artikelnummer "${payload.sku}" entspricht nicht den Regeln: ${artNrFehler.fehler} `
                     + 'Unveraendert uebernommen – bitte beim naechsten Anfassen kuerzen. '
                     + 'Varianten-SKUs wurden deshalb nicht gesetzt.';
        } else {
          return res.status(400).json({ error: artNrFehler.fehler, feld: artNrFehler.feld });
        }
      }
    }

    // Farbachse im Aenderungspfad - dasselbe Muster wie oben bei der SKU (S2b).
    //
    // Mindestens fuenf Artikel im Shop haben heute keine Farbachse. Eine strenge
    // Pruefung legte sie bei der naechsten Preisaenderung still, und das waere
    // wieder die Migration, die ausgeschlossen ist. Also: Achsen unveraendert
    // gegenueber dem SHOP-Stand -> durchlassen und melden. Achsen angefasst ->
    // volle Regel mit 400.
    //
    // Verglichen wird gegen den Shop, nicht gegen die Erfassungsmaske: die
    // fuehrt gar keine Achsenspalte, die Achsen liegen im Varianten-Reiter.
    let achsenHinweis = null;
    const neueAchsen  = achsenVon({ attribute: payload.attributes, varianten: variations });

    // Ohne Achsen im Body ist nichts zu pruefen - ein Teil-Update (nur Preis,
    // nur Status) darf nicht an einer Regel scheitern, deren Daten es gar nicht
    // mitschickt.
    if (neueAchsen.length) {
      const achsenFehler = pruefeFarbAchse(neueAchsen);
      if (achsenFehler) {
        let shopAchsen = null;
        try {
          const { data: alt } = await wc.get(`products/${req.params.id}`);
          const altProdukt = Array.isArray(alt) ? alt[0] : alt;
          shopAchsen = achsenVon({ attribute: altProdukt?.attributes });
        } catch (e) {
          // Ohne Shop-Stand laesst sich "unveraendert" nicht belegen - dann
          // bleibt es streng, statt eine Achsenaenderung durchzuwinken.
          console.warn(`PUT /products/${req.params.id}: Shop-Achsen nicht lesbar (${e.message}) – strenge Pruefung.`);
        }

        if (shopAchsen !== null && achsenGleich(shopAchsen, neueAchsen)) {
          achsenHinweis = `${achsenFehler.fehler} Achsen unveraendert uebernommen – `
                        + 'bitte beim naechsten Anfassen die Farbachse ergaenzen.';
        } else {
          return res.status(400).json({ error: achsenFehler.fehler, feld: achsenFehler.feld });
        }
      }
    }

    // Groessen-Optionen immer sortiert schreiben, wenn Attribute mitkommen -
    // der Aufrufer baut sie aus der Variationsliste (neueste zuerst).
    let groessenHinweis = null;

    // M3, S2b-Muster: im Aenderungspfad speichert ein Artikel ohne Versandklasse
    // weiter (Bestand), der Aufrufer bekommt aber einen Hinweis.
    const versandHinweis = payload.shipping_class !== undefined && pruefeVersandklasse(payload.shipping_class)
      ? 'Hinweis: keine Versandklasse gesetzt – bitte ergänzen.'
      : null;
    if (Array.isArray(payload.attributes)) {
      const g = sortiereAttributOptionen(payload.attributes);
      payload.attributes = g.attributes;
      groessenHinweis    = g.hinweis;
    }

    const { data: productRaw } = await wc.put(`products/${req.params.id}`, payload);
    const product = Array.isArray(productRaw) ? productRaw[0] : productRaw;

    // Befehl SE1: geschriebene Keyphrase im Dubletten-Speicher nachziehen.
    const kwNeu = (payload.meta_data ?? []).find(m => m?.key === '_yoast_wpseo_focuskw');
    if (kwNeu) merkeKeyphrase(req.params.id, product?.name, kwNeu.value);

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
      // Neu angelegte Variationen bekommen "-1" (wie Elternartikel), genau
      // wie im Anlagepfad, und menu_order = Platz in der sortierten Gesamtliste
      // (Farbe, dann Groesse). Bestehende (toUpdate) bekommen weder meta_data
      // noch menu_order.
      const platz = new Map(variantenReihenfolge(variations, payload.attributes).map((vi, pos) => [vi, pos + 1]));
      const toCreate = variations.filter(v => !v.id).map(v =>
        neueVariation(v, { menuOrder: platz.get(variations.indexOf(v)), sku: skuVon(v).sku }));
      if (toUpdate.length || toCreate.length) {
        await wc.post(`products/${req.params.id}/variations/batch`, {
          ...(toUpdate.length ? { update: toUpdate } : {}),
          ...(toCreate.length ? { create: toCreate } : {}),
        });
      }
    }

    // hinweis ist gesetzt, wenn eine regelwidrige Alt-Nummer oder fehlende
    // Farbachse unveraendert durchgelassen wurde (S2b-Muster). Beide koennen
    // gleichzeitig zutreffen - der Aufrufer zeigt sie an, still bleibt nichts.
    const lzShop = lieferzeitAusMetaData(product.meta_data);
    res.json({
      id:      product.id,
      hinweis: [skuHinweis, achsenHinweis, groessenHinweis, versandHinweis].filter(Boolean).join(' ') || null,
      // Eigenes Feld: SKU- und Achsen-Hinweis zeigt das Frontend schon vor dem Speichern.
      groessen_hinweis: groessenHinweis,
      galerie: (product.images ?? []).length,
      lieferzeit: lieferzeit === undefined
        ? { gesendet: null, gesetzt: lzShop, status: 'unveraendert' }
        : { gesendet: lieferzeit, gesetzt: lzShop,
            status: lzShop === lieferzeit ? 'gesetzt' : 'abweichend',
            grund:  lzShop === lieferzeit ? null
                  : `WooCommerce meldet "${lzShop ?? '(kein Wert)'}" statt "${lieferzeit}"` },
    });
  } catch (err) { next(err); }
});

// POST /api/woocommerce/products/:id/variationen-ergaenzen
// Body: { variations: [{ attributes: [{ name, option }], regular_price, image? }] }
//
// "Neue Varianten anlegen" (Befehl V). Frueher schickte der Knopf per PUT nur
// die Werte der NEUEN Varianten als Attribute - WooCommerce ersetzt damit alle
// Optionen (gemessen 23.09. an einem Entwurf: [S, M] + L -> [L]). Jetzt:
//  - Optionen = Shop-Optionen VEREINIGT mit den neuen, Groesse sortiert.
//  - Neue Variationen wie im PUT-Pfad (neueVariation): "-1", menu_order nach
//    Platz in der Gesamtliste, Varianten-SKU aus der Shop-Artikelnummer.
//  - Bestehende Variationen werden NICHT angefasst - kein update im Batch.
router.post('/products/:id/variationen-ergaenzen', async (req, res, next) => {
  try {
    const wc   = getClient(req);
    const neu  = Array.isArray(req.body?.variations) ? req.body.variations : [];
    if (!neu.length) return res.status(400).json({ error: 'Keine neuen Varianten übergeben.', feld: 'variations' });

    const [{ data: pRaw }, { data: vRaw }] = await Promise.all([
      wc.get(`products/${req.params.id}`),
      wc.get(`products/${req.params.id}/variations`, { per_page: 100 }),
    ]);
    const produkt   = Array.isArray(pRaw) ? pRaw[0] : pRaw;
    const bestehend = Array.isArray(vRaw) ? vRaw : [];

    // Kombinationen, die es schon gibt, nicht doppelt anlegen.
    const schluessel = attrs => (attrs ?? [])
      .map(a => `${String(a.name).trim().toLowerCase()}=${String(a.option).trim().toLowerCase()}`).sort().join('|');
    const vorhanden  = new Set(bestehend.map(v => schluessel(v.attributes)));
    const anzulegen  = neu.filter(v => !vorhanden.has(schluessel(v.attributes)));
    const doppelt    = neu.length - anzulegen.length;

    // Optionen vereinigen: Shop-Stand zuerst, neue Werte dazu, dann sortieren.
    // Globale Attribute behalten ihre id, andere Felder bleiben wie im Shop.
    const attributes = (produkt.attributes ?? []).map(a => ({ ...a, options: [...(a.options ?? [])] }));
    for (const v of anzulegen) {
      for (const { name, option } of v.attributes ?? []) {
        let a = attributes.find(x => String(x.name).trim().toLowerCase() === String(name).trim().toLowerCase());
        if (!a) { a = { name, options: [], variation: true, visible: true }; attributes.push(a); }
        if (!a.options.includes(option)) a.options.push(option);
      }
    }
    const sortiert = sortiereAttributOptionen(attributes);

    // Varianten-SKUs ueber die GESAMTliste bauen (Dubletten-Pruefung gegen den
    // Bestand), vergeben nur an die neuen. Regelwidrige Alt-Nummer: keine SKU,
    // aber Hinweis (S2b-Muster) statt Abbruch.
    const alle     = [...bestehend.map(v => ({ attributes: v.attributes })), ...anzulegen];
    let skuHinweis = null;
    let skus       = null;
    const artNr    = String(produkt.sku ?? '').trim();
    const artNrFehler = pruefeArtikelnummer(artNr);
    if (artNrFehler) {
      skuHinweis = `Artikelnummer "${artNr}" entspricht nicht den Regeln: ${artNrFehler.fehler} `
                 + 'Varianten-SKUs der neuen Varianten wurden deshalb nicht gesetzt.';
    } else {
      const r = baueVariantenSkus(artNr, alle);
      if (r.fehler) return res.status(400).json({ error: r.fehler, feld: r.feld });
      skus = r.skus;
    }

    let angelegt = 0;
    let fehler   = [];
    if (anzulegen.length) {
      await wc.put(`products/${req.params.id}`, { attributes: sortiert.attributes });

      const platz  = new Map(variantenReihenfolge(alle, sortiert.attributes).map((vi, pos) => [vi, pos + 1]));
      const create = anzulegen.map((v, i) => {
        const vi = bestehend.length + i;
        return neueVariation(v, { menuOrder: platz.get(vi), sku: skus ? skus[vi] : null });
      });
      const { data: batch } = await wc.post(`products/${req.params.id}/variations/batch`, { create });
      angelegt = (batch?.create ?? []).filter(c => c && c.id && !c.error).length;
      fehler   = (batch?.create ?? []).filter(c => c?.error).map(c => c.error.message ?? String(c.error));
    }

    res.status(anzulegen.length ? 201 : 200).json({
      id:               produkt.id,
      angelegt,
      doppelt,
      fehler,
      optionen:         sortiert.attributes.map(a => ({ name: a.name, options: a.options })),
      hinweis:          [skuHinweis, sortiert.hinweis].filter(Boolean).join(' ') || null,
      groessen_hinweis: sortiert.hinweis,
    });
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
