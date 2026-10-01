import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { getWcClient } from '../lib/shopConfig.js';
import { seitenListe } from '../lib/hosterPruefseite.js';

const SEARCH_TERM = process.argv[2] || 'Sorry Mama';

// Ueber getWcClient: jeder Abruf wird auf die Hoster-Pruefseite geprueft.
const wc = getWcClient('jfn');

async function findOrders() {
  console.log(`\nSuche nach Orders mit "${SEARCH_TERM}"...\n`);
  let found = 0;

  for (let page = 1; page <= 5; page++) {
    const { data } = await wc.get('orders', { per_page: 100, page, status: 'completed' });
    const orders = seitenListe(data, { wc, pfad: 'orders' });
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
