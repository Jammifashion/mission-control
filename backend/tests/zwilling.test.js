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
const { legeZwillingAn, leseZwilling, pruefeZwilling, uhr } = await import('../lib/zwilling.js');
const { kategorieVorschlaege, standardKategoriePlan } = await import('../scripts/setup-zwilling.js');
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

  test('ZW1-2: Kategorie ohne Zuordnung -> Standard aus Config, Menge ohne Dubletten', () => {
    const produkt = { ...PRODUKT, categories: [...PRODUKT.categories, { id: 231, name: 'HONK!' }, { id: 77, name: 'Weihnachten' }] };
    const p = Z.zwillingPlan({ produkt, variationen: VARIATIONEN, kategorien: KAT, lieferzeiten: LZ, standardKategorie: '137' });
    expect(p.gruende).toEqual([]);
    expect(p.produkt.categories).toEqual([{ id: 167 }, { id: 137 }]);
    const nurStandard = Z.zwillingPlan({ produkt: { ...PRODUKT, categories: [{ id: 231, name: 'HONK!' }] }, variationen: VARIATIONEN,
      kategorien: KAT, lieferzeiten: LZ, standardKategorie: '137' });
    expect(nurStandard.produkt.categories).toEqual([{ id: 137 }]);
    const specials = Z.zwillingPlan({ produkt: { ...PRODUKT, categories: [{ id: 231, name: 'HONK!' }, { id: 234, name: 'HohoHonk!' }] },
      variationen: VARIATIONEN, kategorien: new Map([...KAT, ['234', '136']]), lieferzeiten: LZ, standardKategorie: '137' });
    expect(specials.produkt.categories).toEqual([{ id: 137 }, { id: 136 }]);
  });

  test('ZW1-2: ohne Zuordnung UND ohne Config -> Abbruch mit Grund', () => {
    for (const standardKategorie of [undefined, '', 'Merch']) {
      const p = Z.zwillingPlan({ produkt: { ...PRODUKT, categories: [{ id: 231, name: 'HONK!' }] }, variationen: VARIATIONEN,
        kategorien: KAT, lieferzeiten: LZ, standardKategorie });
      expect(p.produkt).toBeUndefined();
      expect(p.gruende.join(' ')).toMatch(/231.*zwilling\.honk_standard_kategorie ist leer/);
    }
  });

  test('ZW1-2: configWert und kategorieNamen', () => {
    const cfg = [['Schlüssel', 'Wert'], ['modell.x', 'claude'], ['zwilling.honk_standard_kategorie', 137]];
    expect(Z.configWert(cfg, Z.CONFIG_STANDARD_KAT)).toBe('137');
    expect(Z.configWert([['A', 'B']], Z.CONFIG_STANDARD_KAT)).toBe('');
    expect(Z.kategorieNamen([{ id: 137, name: 'Merch' }, { id: 136 }])).toEqual(['Merch', '#136']);
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
  test('ZW1-2: Config-Zeile nur, wenn der Schluessel fehlt; Merch ueber den Namen', () => {
    const honk = [{ id: 137, name: 'Merch' }, { id: 136, name: 'Specials' }];
    expect(standardKategoriePlan([['Schlüssel', 'Wert'], ['modell.x', 'y']], honk).neu).toEqual(['zwilling.honk_standard_kategorie', '137']);
    expect(standardKategoriePlan([['Schlüssel', 'Wert'], ['zwilling.honk_standard_kategorie', '']], honk).neu).toBeNull();
    expect(standardKategoriePlan([['Schlüssel', 'Wert']], [{ id: 1, name: 'merch' }, { id: 2, name: 'Merch' }]).neu).toBeNull();
  });
});

// ── Ablauf mit Attrappen ───────────────────────────────────────────────────
function sheetsAttrappe(reiter) {
  const geschrieben = [];
  const lese = range => {
    const tab = range.match(/^'([^']+)'/)[1];
    if (/!A1:ZZ$/.test(range) || range === `'${tab}'`) return reiter[tab];
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
  Config: [['Schlüssel', 'Wert'], ['zwilling.honk_standard_kategorie', 137]],
  Varianten: [['SSOT-ID', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'WC_Variation_ID', 'HONK_Variation_ID'],
    ['JFN-2026-0900', 'Farbe', 'Black', 'Größe', 'S', '', '', '901', ''],
    ['JFN-2026-0900', 'Farbe', 'Black', 'Größe', 'M', '', '', '902', '']],
});
const wcJfnAttrappe = () => ({ get: jest.fn(async pfad => (pfad === 'products/900' ? { data: PRODUKT } : { data: VARIATIONEN })) });
function wcHonkAttrappe({ belegt = [], status = 'draft', angelegt = [] } = {}) {
  return {
    angelegt,
    get: jest.fn(async (pfad, params) => {
      if (pfad === 'products') return { data: belegt };
      if (pfad === 'products/700') return { data: { id: 700, status, sku: 'E3000/HK-Test', categories: [{ id: 167, name: 'Delfin' }, { id: 137, name: 'Merch' }],
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
    expect(r).toMatchObject({ honkId: 700, status: 'Entwurf', abweichungen: [], variationen: 2, bilder: 2, kategorien: ['Delfin', 'Merch'] });
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

  test('SKU in HONK vergeben -> 409 mit Link, kein -v2, nichts angelegt', async () => {
    const honk = wcHonkAttrappe({ belegt: [{ id: 6, sku: 'E3000/HK-Test-Black-S', parent_id: 5 }] });
    const bilder = jest.fn(bilderOk);
    await expect(legeZwillingAn({ jfnId: 900, ssotId: 'JFN-2026-0900', sheets: sheetsAttrappe(reiterNeu()), wcJfn: wcJfnAttrappe(), wcHonk: honk, bilderHochladen: bilder, spreadsheetId: 'x' }))
      .rejects.toMatchObject({ status: 409, code: 'sku_vergeben', honkId: '5', link: 'https://honk.example/wp-admin/post.php?post=5&action=edit' });
    expect(honk.post).not.toHaveBeenCalled();
    expect(bilder).not.toHaveBeenCalled();
  });

  test('ZW1-2: Kategorie ohne Zuordnung -> Standard aus Business-Config (frisch gelesen), Zwilling entsteht', async () => {
    const reiter = reiterNeu();
    const produkt = { ...PRODUKT, categories: [{ id: 231, name: 'HONK!' }, { id: 246, name: 'Merch' }] };
    const wcJfn = { get: jest.fn(async pfad => (pfad === 'products/900' ? { data: produkt } : { data: VARIATIONEN })) };
    const honk = wcHonkAttrappe();
    const r = await legeZwillingAn({ jfnId: 900, ssotId: 'JFN-2026-0900', sheets: sheetsAttrappe(reiter), wcJfn, wcHonk: honk,
      bilderHochladen: bilderOk, spreadsheetId: 'x', businessId: 'b' });
    expect(honk.post.mock.calls[0][1].categories).toEqual([{ id: 137 }]);
    expect(r.honkId).toBe(700);
    // ohne Config -> 422, nichts in HONK
    const ohne = reiterNeu(); ohne.Config = [['Schlüssel', 'Wert']];
    const honk2 = wcHonkAttrappe();
    await expect(legeZwillingAn({ jfnId: 900, ssotId: 'JFN-2026-0900', sheets: sheetsAttrappe(ohne), wcJfn, wcHonk: honk2,
      bilderHochladen: bilderOk, spreadsheetId: 'x', businessId: 'b' })).rejects.toMatchObject({ status: 422, code: 'zuordnung' });
    expect(honk2.post).not.toHaveBeenCalled();
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

describe('ZW1-2: lesen und pruefen', () => {
  test('leseZwilling liefert ssotId (Nachholen) bzw. HONK_Status', async () => {
    const reiter = reiterNeu();
    expect(await leseZwilling({ jfnId: 900, sheets: sheetsAttrappe(reiter), spreadsheetId: 'x' })).toEqual({ honkId: '', ssotId: 'JFN-2026-0900' });
    expect(await leseZwilling({ jfnId: 901, sheets: sheetsAttrappe(reiter), spreadsheetId: 'x' })).toEqual({ honkId: '', ssotId: '' });
    reiter.Erfassungsmaske[1][2] = '700'; reiter.Erfassungsmaske[1][3] = 'unvollständig';
    const honk = { get: jest.fn(async () => ({ data: { id: 700, status: 'draft' } })) };
    expect(await leseZwilling({ jfnId: 900, sheets: sheetsAttrappe(reiter), wcHonk: honk, spreadsheetId: 'x' }))
      .toMatchObject({ honkId: '700', ssotId: 'JFN-2026-0900', honkStatus: 'unvollständig', status: 'draft' });
  });

  test('pruefeZwilling liest nur, Status "veroeffentlicht" ist keine Abweichung, fehlende Variation schon', async () => {
    const reiter = reiterNeu();
    reiter.Erfassungsmaske[1][2] = '700';
    const sheets = sheetsAttrappe(reiter);
    const angelegt = Z.zwillingPlan({ produkt: PRODUKT, variationen: VARIATIONEN, kategorien: KAT, lieferzeiten: LZ }).variationen
      .map(({ _jfnId, _bildJfn, ...v }) => v);
    const honk = wcHonkAttrappe({ status: 'publish', angelegt: [angelegt[0]] });
    const r = await pruefeZwilling({ jfnId: 900, sheets, wcJfn: wcJfnAttrappe(), wcHonk: honk, spreadsheetId: 'x', businessId: 'b' });
    expect(r).toMatchObject({ honkId: '700', status: 'publish', kategorien: ['Delfin', 'Merch'] });
    expect(r.abweichungen.join(' ')).toMatch(/1 Variation\(en\) fehlen/);
    expect(r.abweichungen.join(' ')).not.toMatch(/Entwurf/);
    expect(sheets.geschrieben).toEqual([]);
    expect(honk.post).not.toHaveBeenCalled();
    await expect(pruefeZwilling({ jfnId: 900, sheets: sheetsAttrappe(reiterNeu()), wcJfn: wcJfnAttrappe(), wcHonk: honk, spreadsheetId: 'x' }))
      .rejects.toMatchObject({ status: 404, code: 'kein_zwilling' });
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
  test('ZW1-2: Nachholen und Pruefen in "Artikel ändern" mit Mouse-over und Rueckfrage, nur JFN', () => {
    const b = block('// ── Zwilling: Anfang', '// ── Zwilling: Ende ──');
    expect(b).toMatch(/zwKnopf\('Zwilling in HONK! anlegen …'[^\n]*\n\s*b\.dataset\.hilfe = 'zwilling-nachholen'/);
    expect(b).toMatch(/zwKnopf\('Zwilling prüfen …'[^\n]*\n\s*b\.dataset\.hilfe = 'zwilling-pruefen'/);
    expect(b).toContain("d.honkStatus === 'unvollständig'");
    expect(b).toMatch(/zwillingNachholen[\s\S]*showConfirm\('Zwilling in HONK! anlegen\?'[\s\S]*zwillingAnlegen\(jfnId, ssotId\)/);
    expect(b).toContain("if (currentShop() !== 'jfn') return;");
    expect(b).toContain('/api/zwilling/pruefen?jfnId=');
    expect(b).not.toMatch(/\btitle\s*=/);
    for (const k of ['zwilling-nachholen', 'zwilling-pruefen']) expect(html).toMatch(new RegExp(`'${k}':\\s*\\{ name:`));
  });
});
