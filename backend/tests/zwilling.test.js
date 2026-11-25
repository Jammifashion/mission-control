// ZW1: HONK!-Zwilling - Plan, Ablauf mit Attrappen, Setup-Vorbelegung, Sperre in der Maske. Nur erfundene Daten.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

jest.unstable_mockModule('../lib/wpMedien.js', () => ({ ladeMedienHoch: jest.fn() }));
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: jest.fn(() => { throw new Error('kein echter Shop im Test'); }),
  getShopConfig: jest.fn(() => ({ wcUrl: 'https://honk.example' })),
}));

const Z = await import('../utils/zwilling.js');
const { legeZwillingAn, uhr } = await import('../lib/zwilling.js');
const { kategorieVorschlaege } = await import('../scripts/setup-zwilling.js');
uhr.pause = async () => {};

const PRODUKT = {
  id: 900, type: 'variable', sku: 'E3000/HK-Test', name: 'HONK! Test Shirt', status: 'draft',
  description: '<p>Text</p>', short_description: 'Kurz', shipping_class: 'grossbrief', tax_class: '', tax_status: 'taxable',
  categories: [{ id: 261, name: 'Delfin' }, { id: 246, name: 'Merch' }],
  attributes: [{ id: 3, name: 'Farbe', options: ['Black'], variation: true, visible: true }, { id: 0, name: 'Größe', options: ['S', 'M'], variation: true, visible: true }],
  images: [{ id: 11, src: 'https://jfn.example/a.jpg', name: 'a', alt: 'A' }],
  meta_data: [{ key: '_lieferzeit', value: '21' }],
};
const VARIATIONEN = [
  { id: 901, sku: 'E3000/HK-Test-Black-S', regular_price: '24.90', status: 'publish', menu_order: 1, image: { id: 12, src: 'https://jfn.example/b.jpg' },
    attributes: [{ id: 3, name: 'Farbe', option: 'Black' }, { id: 0, name: 'Größe', option: 'S' }], meta_data: [{ key: '_wc_gla_color', value: 'Black' }] },
  { id: 902, sku: 'E3000/HK-Test-Black-M', regular_price: '24.90', status: 'publish', menu_order: 2, image: { id: 11 },
    attributes: [{ id: 3, name: 'Farbe', option: 'Black' }, { id: 0, name: 'Größe', option: 'M' }], meta_data: [] },
];
const KAT = new Map([['261', '167'], ['246', '137'], ['231', '']]);
const LZ = new Map([['21', '92']]);

describe('zwillingPlan', () => {
  test('vollstaendig: Entwurf, Attribute lokal (ohne id), Kategorien + Lieferzeit gemappt, Variationen "-1" + Google-Farbe', () => {
    const p = Z.zwillingPlan({ produkt: PRODUKT, variationen: VARIATIONEN, kategorien: KAT, lieferzeiten: LZ });
    expect(p.gruende).toEqual([]);
    expect(p.produkt.status).toBe('draft');
    expect(p.produkt.sku).toBe('E3000/HK-Test');
    expect(p.produkt.categories).toEqual([{ id: 167 }, { id: 137 }]);
    expect(p.produkt.attributes.every(a => !('id' in a))).toBe(true);
    expect(p.produkt.meta_data).toEqual([{ key: '_lieferzeit', value: '92' }]);
    expect(p.produkt).not.toHaveProperty('brands');
    expect(p.variationen[0]).toMatchObject({ sku: 'E3000/HK-Test-Black-S', regular_price: '24.90',
      attributes: [{ name: 'Farbe', option: 'Black' }, { name: 'Größe', option: 'S' }] });
    expect(p.variationen[0].meta_data).toEqual([{ key: '_lieferzeit', value: '-1' }, { key: '_wc_gla_color', value: 'Black' }]);
    expect(p.skus).toHaveLength(3);
  });

  test('fehlende Kategorie- oder Lieferzeit-Zuordnung -> Gruende, kein Plan', () => {
    const p = Z.zwillingPlan({ produkt: { ...PRODUKT, categories: [...PRODUKT.categories, { id: 231, name: 'HONK!' }] },
      variationen: VARIATIONEN, kategorien: KAT, lieferzeiten: new Map([['21', '']]) });
    expect(p.produkt).toBeUndefined();
    expect(p.gruende.join(' ')).toMatch(/HONK!.*231.*HONK_Kategorie/);
    expect(p.gruende.join(' ')).toMatch(/Lieferzeit 21 hat keine Term_ID_HONK/);
  });

  test('Bilder: Galerie in JFN-Reihenfolge, Variationsbild gemappt, Hilfsfelder weg', () => {
    const p = Z.zwillingPlan({ produkt: PRODUKT, variationen: VARIATIONEN, kategorien: KAT, lieferzeiten: LZ });
    expect(Z.bildListe(PRODUKT, VARIATIONEN).map(b => b.id)).toEqual([11, 12]);
    const f = Z.mitBildern(p, new Map([[11, 511], [12, 512]]));
    expect(f.produkt.images).toEqual([{ id: 511 }]);
    expect(f.variationen.map(v => v.image)).toEqual([{ id: 512 }, { id: 511 }]);
    expect(f.variationen.some(v => '_jfnId' in v || '_bildJfn' in v)).toBe(false);
  });

  test('vergleicheZwilling meldet fehlende Variation und falsche Lieferzeit', () => {
    const p = Z.mitBildern(Z.zwillingPlan({ produkt: PRODUKT, variationen: VARIATIONEN, kategorien: KAT, lieferzeiten: LZ }), new Map([[11, 511]]));
    const ab = Z.vergleicheZwilling({ plan: p, bilderErwartet: 1,
      produkt: { id: 5, status: 'draft', sku: 'E3000/HK-Test', categories: [{ id: 137 }, { id: 167 }], images: [{ id: 511 }], meta_data: [{ key: '_lieferzeit', value: '92' }] },
      variationen: [{ sku: 'E3000/HK-Test-Black-S', regular_price: '24.90', meta_data: [] }] });
    expect(ab.join(' ')).toMatch(/1 Variation\(en\) fehlen/);
    expect(ab.join(' ')).toMatch(/ohne Lieferzeit/);
  });
});

describe('setup-zwilling: Vorbelegung HONK_Kategorie', () => {
  test('nur gleiche Namen unter HONK!, Wurzel und ohne Gegenstueck leer', () => {
    const jfn = [{ id: 231, name: 'HONK!', parent: 5 }, { id: 246, name: 'Merch', parent: 231 }, { id: 261, name: 'Delfin', parent: 246 },
      { id: 234, name: 'HohoHonk!', parent: 231 }, { id: 99, name: 'Delfin', parent: 1 }];
    const honk = [{ id: 137, name: 'Merch' }, { id: 167, name: 'delfin' }];
    const v = kategorieVorschlaege(jfn, honk);
    expect(v.map(x => [x.jfnId, x.honkId])).toEqual([['231', ''], ['246', '137'], ['261', '167'], ['234', '']]);
  });
});

// ── Ablauf mit Attrappen ───────────────────────────────────────────────────
function sheetsAttrappe(reiter) {
  const geschrieben = [];
  const lese = range => {
    const tab = range.match(/^'([^']+)'/)[1];
    if (/!A1:ZZ$/.test(range)) return reiter[tab];
    const [, sp, z] = range.match(/!([A-Z]+)(\d+)$/);
    const col = [...sp].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
    return [[reiter[tab][Number(z) - 1]?.[col] ?? '']];
  };
  return {
    geschrieben,
    spreadsheets: { values: {
      get: async ({ range }) => ({ data: { values: lese(range) } }),
      batchGet: async ({ ranges }) => ({ data: { valueRanges: ranges.map(r => ({ values: lese(r) })) } }),
      batchUpdate: async ({ requestBody }) => {
        for (const d of requestBody.data) {
          geschrieben.push([d.range, d.values[0][0]]);
          const tab = d.range.match(/^'([^']+)'/)[1];
          const [, sp, z] = d.range.match(/!([A-Z]+)(\d+)$/);
          const col = [...sp].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
          const zeile = reiter[tab][Number(z) - 1];
          while (zeile.length <= col) zeile.push('');
          zeile[col] = d.values[0][0];
        }
        return {};
      },
    } },
  };
}
const reiterNeu = () => ({
  Erfassungsmaske: [['ID', 'Produkt-ID', 'HONK_Produkt_ID', 'HONK_Status'], ['JFN-2026-0900', '900', '', '']],
  Struktur_Kategorien: [['Kategorienummer', 'HONK_Kategorie'], ['261', '167'], ['246', '137']],
  Struktur_Lieferzeiten: [['Term_ID', 'Term_ID_HONK'], ['21', '92']],
  Varianten: [['SSOT-ID', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'WC_Variation_ID', 'HONK_Variation_ID'],
    ['JFN-2026-0900', 'Farbe', 'Black', 'Größe', 'S', '', '', '901', ''],
    ['JFN-2026-0900', 'Farbe', 'Black', 'Größe', 'M', '', '', '902', '']],
});
const wcJfnAttrappe = () => ({ get: jest.fn(async pfad => (pfad === 'products/900' ? { data: PRODUKT } : { data: VARIATIONEN })) });
function wcHonkAttrappe({ belegt = [] } = {}) {
  const angelegt = [];
  return {
    angelegt,
    get: jest.fn(async (pfad, params) => {
      if (pfad === 'products') return { data: belegt };
      if (pfad === 'products/700') return { data: { id: 700, status: 'draft', sku: 'E3000/HK-Test', categories: [{ id: 167 }, { id: 137 }],
        images: [{ id: 511 }], meta_data: [{ key: '_lieferzeit', value: '92' }] } };
      if (pfad === 'products/700/variations') return { data: angelegt.map((v, i) => ({ id: 801 + i, ...v })) };
      throw new Error(`unerwartet ${pfad} ${JSON.stringify(params)}`);
    }),
    post: jest.fn(async (pfad, body) => {
      if (pfad === 'products') return { data: { id: 700 } };
      if (pfad === 'products/700/variations/batch') { angelegt.push(...body.create); return { data: { create: body.create.map((_, i) => ({ id: 801 + i })) } }; }
      throw new Error(`unerwartet ${pfad}`);
    }),
  };
}
const bilderOk = async b => ({ map: new Map(b.map((x, i) => [x.id, 511 + i])), hochgeladen: [] });

describe('legeZwillingAn', () => {
  test('legt Entwurf an, schreibt HONK_Produkt_ID/Status und HONK_Variation_ID ueber die Kombination', async () => {
    const reiter = reiterNeu();
    const sheets = sheetsAttrappe(reiter);
    const honk = wcHonkAttrappe();
    const r = await legeZwillingAn({ jfnId: 900, ssotId: 'JFN-2026-0900', sheets, wcJfn: wcJfnAttrappe(), wcHonk: honk, bilderHochladen: bilderOk, spreadsheetId: 'x' });
    expect(r).toMatchObject({ honkId: 700, status: 'Entwurf', abweichungen: [], variationen: 2, bilder: 2 });
    expect(honk.post.mock.calls[0][1].status).toBe('draft');
    expect(reiter.Erfassungsmaske[1].slice(2)).toEqual(['700', 'Entwurf']);
    expect(reiter.Varianten.slice(1).map(z => z[8])).toEqual(['801', '802']);
    expect(r.link).toBe('https://honk.example/wp-admin/post.php?post=700&action=edit');
  });

  test('fehlende Zuordnung -> 422, in HONK nichts', async () => {
    const reiter = reiterNeu();
    reiter.Struktur_Lieferzeiten[1][1] = '';
    const honk = wcHonkAttrappe();
    const bilder = jest.fn(bilderOk);
    await expect(legeZwillingAn({ jfnId: 900, ssotId: 'JFN-2026-0900', sheets: sheetsAttrappe(reiter), wcJfn: wcJfnAttrappe(), wcHonk: honk, bilderHochladen: bilder, spreadsheetId: 'x' }))
      .rejects.toMatchObject({ status: 422, code: 'zuordnung' });
    expect(honk.post).not.toHaveBeenCalled();
    expect(bilder).not.toHaveBeenCalled();
  });

  test('SKU in HONK vergeben -> 409, kein -v2, nichts angelegt', async () => {
    const honk = wcHonkAttrappe({ belegt: [{ id: 5, sku: 'E3000/HK-Test' }] });
    await expect(legeZwillingAn({ jfnId: 900, ssotId: 'JFN-2026-0900', sheets: sheetsAttrappe(reiterNeu()), wcJfn: wcJfnAttrappe(), wcHonk: honk, bilderHochladen: bilderOk, spreadsheetId: 'x' }))
      .rejects.toMatchObject({ status: 409, code: 'sku_vergeben' });
    expect(honk.post).not.toHaveBeenCalled();
  });

  test('Bild-Upload scheitert -> kein Artikel (kein Zwilling ohne Bilder)', async () => {
    const honk = wcHonkAttrappe();
    const bilder = async () => { throw Object.assign(new Error('Rolle'), { status: 502, code: 'bilder' }); };
    await expect(legeZwillingAn({ jfnId: 900, ssotId: 'JFN-2026-0900', sheets: sheetsAttrappe(reiterNeu()), wcJfn: wcJfnAttrappe(), wcHonk: honk, bilderHochladen: bilder, spreadsheetId: 'x' }))
      .rejects.toMatchObject({ code: 'bilder' });
    expect(honk.post).not.toHaveBeenCalled();
  });

  test('Zwilling besteht schon -> 409 schon_da; Spalten fehlen -> 409 einrichtung', async () => {
    const reiter = reiterNeu();
    reiter.Erfassungsmaske[1][2] = '650';
    await expect(legeZwillingAn({ jfnId: 900, ssotId: 'JFN-2026-0900', sheets: sheetsAttrappe(reiter), wcJfn: wcJfnAttrappe(), wcHonk: wcHonkAttrappe(), bilderHochladen: bilderOk, spreadsheetId: 'x' }))
      .rejects.toMatchObject({ status: 409, code: 'schon_da' });
    const ohne = reiterNeu();
    ohne.Varianten[0].pop();
    await expect(legeZwillingAn({ jfnId: 900, ssotId: 'JFN-2026-0900', sheets: sheetsAttrappe(ohne), wcJfn: wcJfnAttrappe(), wcHonk: wcHonkAttrappe(), bilderHochladen: bilderOk, spreadsheetId: 'x' }))
      .rejects.toMatchObject({ status: 409, code: 'einrichtung' });
  });
});

// ── Maske ──────────────────────────────────────────────────────────────────
const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = (a, e) => html.slice(html.indexOf(a), html.indexOf(e));
describe('Maske', () => {
  const fe = new Function(`${block('// ── SKU-Regeln: Anfang', '// ── SKU-Regeln: Ende ──')}\n${block('// ── Artikel-ID: Anfang', '// ── Artikel-ID: Ende ──')}\n return { anlageZustand };`)();
  test('Shop HONK gewaehlt -> Anlage gesperrt mit Grund', () => {
    const z = fe.anlageZustand({ ssotId: 'JFN-2026-0900', variantenAnzahl: 0, shopHonk: true });
    expect(z.aktiv).toBe(false);
    expect(z.grund).toMatch(/nur in JammiFashion.*Haken/);
    expect(fe.anlageZustand({ ssotId: 'JFN-2026-0900', variantenAnzahl: 0 }).aktiv).toBe(true);
  });
  test('Verdrahtung: Haken mit Mouse-over, Klick-Sperre, Zwilling nach der Anlage, Hinweis beim Aendern', () => {
    expect(html).toMatch(/id="pf-zwilling-wrap"[^>]*data-hilfe="zwilling-haken"/);
    expect(html).toContain("if (currentShop() === 'honk') { showToast(ANLAGE_HONK_GRUND");
    expect(html).toContain("if (document.getElementById('pf-zwilling').checked && ssotId)");
    expect(html).toContain('nicht mitgeändert');
    expect(html).toContain("window.dispatchEvent(new CustomEvent('mc:shop'");
  });
});
