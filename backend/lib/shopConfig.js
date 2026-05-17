import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';

// Sprint 5.4 – Multi-Shop Support
// Mapping shop-Slug → WC-Credentials + shop-spezifische Sheet-Tabs.
// Default-Shop ist 'jfn' (Jammi Fashion). 'honk' ist der HonkShop.
// Unbekannte oder fehlende Werte fallen auf 'jfn' zurück, damit Altcode
// ohne shop-Parameter weiterhin funktioniert.

const SHOPS = {
  jfn: {
    shop: 'jfn',
    label: 'Jammi Fashion',
    wcUrl:    () => process.env.WC_URL,
    wcKey:    () => process.env.WC_KEY,
    wcSecret: () => process.env.WC_SECRET,
    tabVerkaeufe:   'Partner_Verkäufe',
    tabAbrechnungen: 'Partner_Abrechnungen',
  },
  honk: {
    shop: 'honk',
    label: 'HonkShop',
    wcUrl:    () => process.env.WC_URL_HONK,
    wcKey:    () => process.env.WC_KEY_HONK,
    wcSecret: () => process.env.WC_SECRET_HONK,
    tabVerkaeufe:   'HK_Partner_Verkäufe',
    tabAbrechnungen: 'HK_Partner_Abrechnungen',
  },
};

export function normalizeShop(shop) {
  const s = String(shop ?? '').toLowerCase().trim();
  return SHOPS[s] ? s : 'jfn';
}

export function getShopConfig(shop) {
  const def = SHOPS[normalizeShop(shop)];
  return {
    shop:    def.shop,
    label:   def.label,
    wcUrl:   def.wcUrl(),
    wcKey:   def.wcKey(),
    wcSecret: def.wcSecret(),
    tabVerkaeufe:    def.tabVerkaeufe,
    tabAbrechnungen: def.tabAbrechnungen,
  };
}

export function getWcClient(shop) {
  const cfg = getShopConfig(shop);
  if (!cfg.wcUrl || !cfg.wcKey || !cfg.wcSecret) {
    const suffix = cfg.shop === 'honk' ? '_HONK' : '';
    throw new Error(`WooCommerce-Zugangsdaten fehlen (WC_URL${suffix}, WC_KEY${suffix}, WC_SECRET${suffix}).`);
  }
  return new WooCommerceRestApi.default({
    url:            cfg.wcUrl,
    consumerKey:    cfg.wcKey,
    consumerSecret: cfg.wcSecret,
    version:        'wc/v3',
    queryStringAuth: true,
  });
}
