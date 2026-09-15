// Marke je Shop: Slug in shopConfig.js, Term-ID zur Laufzeit aus WooCommerce.

import { jest } from '@jest/globals';

const wcGet = { jfn: jest.fn(), honk: jest.fn() };

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getShopConfig: jest.fn(shop => shop === 'honk'
    ? { shop: 'honk', label: 'HonkShop', markenSlug: null }
    : { shop: 'jfn',  label: 'JammiFashion', markenSlug: 'jammifashion' }),
  getWcClient: jest.fn(shop => ({ get: wcGet[shop === 'honk' ? 'honk' : 'jfn'] })),
}));

let markeFuerShop, _resetMarkenCache;

beforeAll(async () => {
  ({ markeFuerShop, _resetMarkenCache } = await import('../lib/shopMarke.js'));
});

beforeEach(() => {
  _resetMarkenCache();
  wcGet.jfn.mockReset().mockResolvedValue({
    data: [{ id: 4711, name: 'JammiFashion', slug: 'jammifashion', count: 0 }],
  });
  wcGet.honk.mockReset();
});

describe('markeFuerShop', () => {
  test('jfn: ID kommt aus WooCommerce, gesucht wird ueber den Slug', async () => {
    expect(await markeFuerShop('jfn')).toEqual({ id: 4711, name: 'JammiFashion', slug: 'jammifashion' });
    expect(wcGet.jfn).toHaveBeenCalledWith('products/brands', { slug: 'jammifashion' });
  });

  test('honk: kein Slug → null, kein WooCommerce-Aufruf', async () => {
    expect(await markeFuerShop('honk')).toBeNull();
    expect(wcGet.honk).not.toHaveBeenCalled();
  });

  test('Slug nicht im Shop → wirft laut mit Slug und Shop', async () => {
    wcGet.jfn.mockResolvedValue({ data: [] });
    const err = await markeFuerShop('jfn').catch(e => e);
    expect(err.status).toBe(500);
    expect(err.message).toMatch(/jammifashion/);
    expect(err.message).toMatch(/JammiFashion/);
  });

  test('nur exakter Slug zaehlt, nicht ein aehnlicher Treffer', async () => {
    wcGet.jfn.mockResolvedValue({ data: [{ id: 1, name: 'Jammi', slug: 'jammifashion-2' }] });
    await expect(markeFuerShop('jfn')).rejects.toThrow(/jammifashion/);
  });

  test('Treffer wird je Shop gecacht', async () => {
    await markeFuerShop('jfn');
    await markeFuerShop('jfn');
    expect(wcGet.jfn).toHaveBeenCalledTimes(1);
  });

  test('Cache ist je Shop getrennt', async () => {
    const { getShopConfig } = await import('../lib/shopConfig.js');
    getShopConfig.mockImplementation(shop => ({
      shop, label: shop, markenSlug: shop === 'honk' ? 'honk-marke' : 'jammifashion',
    }));
    wcGet.honk.mockResolvedValue({ data: [{ id: 9, name: 'Honk', slug: 'honk-marke' }] });
    try {
      expect((await markeFuerShop('jfn')).id).toBe(4711);
      expect((await markeFuerShop('honk')).id).toBe(9);
      expect((await markeFuerShop('jfn')).id).toBe(4711);
      expect(wcGet.jfn).toHaveBeenCalledTimes(1);
      expect(wcGet.honk).toHaveBeenCalledTimes(1);
    } finally {
      getShopConfig.mockImplementation(shop => shop === 'honk'
        ? { shop: 'honk', label: 'HonkShop', markenSlug: null }
        : { shop: 'jfn',  label: 'JammiFashion', markenSlug: 'jammifashion' });
    }
  });

  test('fehlender Slug wird nicht gecacht', async () => {
    wcGet.jfn.mockResolvedValueOnce({ data: [] });
    await expect(markeFuerShop('jfn')).rejects.toThrow();
    expect((await markeFuerShop('jfn')).id).toBe(4711);
    expect(wcGet.jfn).toHaveBeenCalledTimes(2);
  });
});
