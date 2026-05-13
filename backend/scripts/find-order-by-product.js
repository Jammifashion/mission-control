import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';

const SEARCH_TERM = process.argv[2] || 'Sorry Mama';

const wc = new WooCommerceRestApi.default({
  url: process.env.WC_URL, consumerKey: process.env.WC_KEY,
  consumerSecret: process.env.WC_SECRET, version: 'wc/v3', queryStringAuth: true,
});

async function findOrders() {
  console.log(`\nSuche nach Orders mit "${SEARCH_TERM}"...\n`);
  let found = 0;

  for (let page = 1; page <= 5; page++) {
    const { data: orders } = await wc.get('orders', { per_page: 100, page, status: 'completed' });
    if (!orders.length) break;

    for (const order of orders) {
      const matching = order.line_items.filter(item =>
        item.name?.includes(SEARCH_TERM) || item.sku?.includes(SEARCH_TERM)
      );
      if (matching.length) {
        console.log(`Order ${order.id}  ·  ${order.date_created}  ·  Status: ${order.status}`);
        matching.forEach(item => {
          console.log(`  - ${item.name} (Prod-ID: ${item.product_id}, Qty: ${item.quantity}, Total: ${item.total}€)`);
        });
        console.log('');
        found++;
      }
    }
  }

  if (!found) console.log(`Keine Orders mit "${SEARCH_TERM}" gefunden.\n`);
  else console.log(`→ ${found} Order(s) gefunden`);
}

findOrders().catch(e => { console.error(e); process.exit(1); });
