// Auftrag HW2: Anlage-Skript Halloween (lib/anlageHalloween.js).
// SKU-Bildung (<= 50 Zeichen, eindeutig), Groessen (L-Shop XXL = Shop 2XL),
// Blockteilung, Payloads (Farbe/Groesse global mit id, Motiv lokal),
// Abbruch bei Pruefseite und Fortsetzen ohne Doppelanlage, Takt.

import { jest } from '@jest/globals';
import {
  ARTIKEL, MOTIVE, KURZ, BLOCK_MAX, AnlageStopp,
  ordneMockups, bildListe, ladeBilderHoch, bilderAusZustand, MOTIV_ZEILE,
  teileInBloecke, shopGroesse, groessenImBereich, preisFuer, preisVorlage, planeArtikel,
  produktPayload, variationsPayloads, variantenSheetPayload, maskeBody, naechsteSsotIds, planeSheets,
  geplanteAufrufe, getakteterClient, legeArtikelAn, fehlendeKombinationen, attributIds,
} from '../lib/anlageHalloween.js';
import { SKU_MAX } from '../lib/sku.js';
import { HosterPruefseiteError } from '../lib/hosterPruefseite.js';

// Shop-Terme "Größe" wie im Shop (2XL statt XXL, kein 6XL-8XL).
const GROESSEN_TERME = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '98', '104'];
const ATTR_IDS = { farbe: 3, groesse: 2 };

let nr = 1000000000;
const zeilen = (catalogNr, farbe, groessen, extra = {}) => groessen.map(size => ({
  articleNr: String(++nr), catalogNr, color1: farbe, color2: '', size, discontinued: '0', status: 'aktiv', ...extra,
}));
const LSHOP = [
  ...zeilen('E3000', 'Black', ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL', '7XL', '8XL']),
  ...zeilen('E3000', 'White', ['S', 'M']),
  ...zeilen('E3005', 'Black', ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']),
  ...zeilen('JH030', 'Deep Black', ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL']),
  ...zeilen('JH030', 'Jet Black', ['S', 'M']),
  ...zeilen('JH030F', 'Deep Black', ['XS', 'S', 'M', 'L', 'XL', 'XXL']),
];
const JH180 = zeilen('JH180', 'Washed Black', ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);

// JH180 entfaellt (Inhaber 10.10.); die Farbwahl aus LShop_Modelle bleibt mit diesem Testartikel abgedeckt.
const JH180_ARTIKEL = { titel: 'Test Hoodie', modell: 'JH180', farbe: null, von: null, bis: null, versand: 'paket', keyphrase: 'Test Hoodie', synonyme: [] };
const plan = (modell, { lshop = LSHOP, preise } = {}) =>
  planeArtikel({ artikel: modell === 'JH180' ? JH180_ARTIKEL : ARTIKEL.find(a => a.modell === modell), lshopZeilen: lshop, groessenTerme: GROESSEN_TERME, preise });

describe('Festlegungen', () => {
  test('8 Motive in der Reihenfolge der Entscheidung, SKU-Teile eindeutig', () => {
    expect(MOTIVE.map(m => m.titel)).toEqual([
      'There the Dog', 'There the Otter', 'Free Hugs', "Trust me, I'm a Doctor", 'Vertrau mir, ich bin Arzt',
      'Ich will doch nur spielen', 'Stay alive – Challenge accepted', 'Ich bin wegen des Kuchens hier',
    ]);
    expect(new Set(MOTIVE.map(m => m.sku)).size).toBe(8);
    for (const m of MOTIVE) expect(m.sku).toMatch(/^[a-z0-9-]+$/);
  });
  test('4 Artikel (JH180 entfaellt), gemeinsame Kurzbezeichnung', () => {
    expect(ARTIKEL.map(a => a.modell)).toEqual(['E3000', 'E3005', 'JH030', 'JH030F']);
    expect(KURZ).toBe('HW-Halloween');
  });
});

describe('SKU-Bildung', () => {
  const alle = [...LSHOP, ...JH180];
  const plaene = [...ARTIKEL.map(a => a.modell), 'JH180'].map(m => plan(m, { lshop: alle }));

  test('alle Artikel bereit, Artikelnummer <Modell>/HW-Halloween', () => {
    expect(plaene.map(p => p.status)).toEqual(['bereit', 'bereit', 'bereit', 'bereit', 'bereit']);
    expect(plaene.map(p => p.artikelnummer)).toEqual([...ARTIKEL.map(a => a.modell), 'JH180'].map(m => `${m}/HW-Halloween`));
  });

  test(`jede Variations-SKU <= ${SKU_MAX} Zeichen, eindeutig ueber alle Artikel`, () => {
    const skus = plaene.flatMap(p => p.varianten.map(v => v.sku));
    expect(skus.length).toBe((9 + 7 + 9 + 6 + 7) * 8);
    for (const s of skus) expect(s.length).toBeLessThanOrEqual(SKU_MAX);
    expect(new Set(skus).size).toBe(skus.length);
  });

  test('Aufbau <Artikelnummer>-<farbe>-<groesse>-<motivteil>', () => {
    const p = plan('JH030F');
    expect(p.varianten.find(v => v.groesse === '2XL' && v.motivSku === 'stayalive').sku)
      .toBe('JH030F/HW-Halloween-deep-black-2xl-stayalive');
  });

  test('voller Motivtitel waere zu lang - darum Kurzteil', () => {
    const lang = 'JH030F/HW-Halloween-deep-black-2xl-ich-bin-wegen-des-kuchens-hier';
    expect(lang.length).toBeGreaterThan(SKU_MAX);
  });
});

describe('Groessen und L-Shop', () => {
  test('L-Shop XXL -> Shop-Term 2XL, exakter Name hat Vorrang', () => {
    expect(shopGroesse('XXL', GROESSEN_TERME)).toBe('2XL');
    expect(shopGroesse('xl', GROESSEN_TERME)).toBe('XL');
    expect(shopGroesse('6XL', GROESSEN_TERME)).toBeNull();
  });

  test('Bereich XS-5XL laesst 6XL-8XL weg', () => {
    expect(groessenImBereich(['XS', 'XL', '5XL', '6XL', '8XL'], 'XS', '5XL')).toEqual(['XS', 'XL', '5XL']);
  });

  test('E3000: 9 Groessen x 8 Motive, eine ArticleNr je Groesse fuer alle Motive', () => {
    const p = plan('E3000');
    expect(p.groessen.map(g => g.shop)).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']);
    expect(p.varianten).toHaveLength(72);
    const je = new Map();
    for (const v of p.varianten) je.set(v.groesse, [...(je.get(v.groesse) ?? []), v.articleNr]);
    for (const nrn of je.values()) { expect(nrn).toHaveLength(8); expect(new Set(nrn).size).toBe(1); }
  });

  test('JH180 fehlt in LShop_Modelle -> wartet auf LS1, die anderen werden gerechnet', () => {
    const p = plan('JH180');
    expect(p.status).toBe('wartet auf LS1');
    expect(p.varianten).toHaveLength(0);
    expect(plan('JH030').status).toBe('bereit');
  });

  test('JH180: gewaschene schwarze Farbe aus LS1, mehrdeutig -> Fehler', () => {
    expect(plan('JH180', { lshop: JH180 }).farbe).toBe('Washed Black');
    const zwei = [...JH180, ...zeilen('JH180', 'Washed Black/Grey', ['M'])];
    expect(plan('JH180', { lshop: zwei }).status).toBe('fehler');
  });

  test('fehlende Groesse im Bereich -> Fehler, nichts geplant', () => {
    const ohneM = LSHOP.filter(z => !(z.catalogNr === 'E3005' && z.size === 'M'));
    const p = plan('E3005', { lshop: ohneM });
    expect(p.status).toBe('fehler');
  });

  test('Discontinued 3 in der Farbe -> Groesse nicht waehlbar -> Fehler', () => {
    const gesperrt = LSHOP.map(z => (z.catalogNr === 'JH030F' && z.size === 'L' ? { ...z, discontinued: '3' } : z));
    expect(plan('JH030F', { lshop: gesperrt }).status).toBe('fehler');
  });
});

describe('Preise (Datei, nie in der Ausgabe)', () => {
  const preise = { E3000: { basis: 25, groessen: { XXL: null, '3XL': '26,00', '4XL': 27 } } };
  test('Basis und Abweichung je Groesse, Schreibweise egal', () => {
    expect(preisFuer(preise, 'E3000', 'M')).toBe('25.00');
    expect(preisFuer(preise, 'E3000', '2XL')).toBe('25.00');
    expect(preisFuer(preise, 'E3000', '3XL')).toBe('26.00');
    expect(preisFuer(preise, 'E3000', '4XL')).toBe('27.00');
    expect(preisFuer(preise, 'E3005', 'M')).toBeNull();
    expect(preisFuer({ E3000: { basis: null } }, 'E3000', 'M')).toBeNull();
  });
  test('Vorlage mit leeren Werten je Modell und Groesse', () => {
    const v = preisVorlage([plan('E3005')]);
    expect(v.E3005.basis).toBeNull();
    expect(Object.keys(v.E3005.groessen)).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']);
  });
  test('fehlende Preise -> Hinweis, Plan bleibt bereit', () => {
    const p = plan('E3005');
    expect(p.status).toBe('bereit');
    expect(p.hinweise.join(' ')).toMatch(/56 von 56 Variationen ohne Preis/);
  });
});

describe('Blockteilung', () => {
  test('72 -> 50 + 22, 48 -> 48, leer -> keine Bloecke', () => {
    expect(teileInBloecke(Array.from({ length: 72 }), BLOCK_MAX).map(b => b.length)).toEqual([50, 22]);
    expect(teileInBloecke(Array.from({ length: 48 })).map(b => b.length)).toEqual([48]);
    expect(teileInBloecke([])).toEqual([]);
    expect(teileInBloecke([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });
  test('ungueltige Blockgroesse wirft', () => {
    expect(() => teileInBloecke([1], 0)).toThrow();
  });
  test('geplante Aufrufe: je Artikel GET sku + POST + Bloecke + Zuruecklesen', () => {
    const a = geplanteAufrufe([plan('E3000'), plan('JH030F')], { kategorieFehlt: true });
    expect(a.jeArtikel).toEqual([2 + 2 + 1, 2 + 1 + 1]);
    expect(a.summe).toBe(5 + 2 + 5 + 4);
  });
});

describe('Payloads', () => {
  const preise = { E3005: { basis: 25 } };
  const p = plan('E3005', { preise });

  test('Produkt: Entwurf, Bewertungen an, Farbe/Groesse mit id, Motiv ohne id', () => {
    const b = produktPayload(p, { kategorieId: 999, attrIds: ATTR_IDS, markeId: 7, lieferzeit: '21' });
    expect(b).toMatchObject({ status: 'draft', type: 'variable', sku: 'E3005/HW-Halloween', reviews_allowed: true,
      shipping_class: 'grossbrief', categories: [{ id: 999 }], brands: [{ id: 7 }] });
    expect(b.meta_data).toEqual([{ key: '_lieferzeit', value: '21' }]);
    expect(b.attributes[0]).toMatchObject({ id: 3, options: ['Black'], variation: true });
    expect(b.attributes[1]).toMatchObject({ id: 2, options: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] });
    expect(b.attributes[2]).toEqual(expect.objectContaining({ name: 'Motiv', options: MOTIVE.map(m => m.titel) }));
    expect(b.attributes[2].id).toBeUndefined();
  });

  test('ohne Attribut-IDs kein Payload (sonst wuerden Farbe/Groesse lokal)', () => {
    expect(() => produktPayload(p, { attrIds: {} })).toThrow(/Attribut-IDs/);
  });

  test('Variationen: "-1", _wc_gla_color, menu_order, Groesse aufsteigend, Motive in Reihenfolge', () => {
    const v = variationsPayloads(p, ATTR_IDS);
    expect(v).toHaveLength(56);
    expect(v.map(x => x.menu_order)).toEqual(Array.from({ length: 56 }, (_, i) => i + 1));
    expect(v[0].attributes).toEqual([
      { id: 3, name: 'Farbe', option: 'Black' }, { id: 2, name: 'Größe', option: 'XS' }, { name: 'Motiv', option: 'There the Dog' }]);
    expect(v[7].attributes[2].option).toBe('Ich bin wegen des Kuchens hier');
    expect(v[8].attributes[1].option).toBe('S');
    for (const x of v) {
      expect(x.meta_data).toEqual(expect.arrayContaining([{ key: '_lieferzeit', value: '-1' }, { key: '_wc_gla_color', value: 'Black' }]));
      expect(x.regular_price).toBe('25.00');
      expect(x.status).toBe('publish');
    }
  });

  test('Varianten-Reiter: E1 Farbe, E2 Größe, E3 Motiv, LShop_ArticleNr, Google_Farbe', () => {
    const z = variantenSheetPayload(p, [11, 12]);
    expect(z[0]).toMatchObject({ nr: 1, e1: 'Farbe', v1: 'Black', e2: 'Größe', v2: 'XS', e3: 'Motiv', v3: 'There the Dog',
      preis: 25, aktiv: true, wcVariationId: 11, googleFarbe: 'Black' });
    expect(z[0].lshopArticleNr).toMatch(/^\d{10}$/);
    expect(z[2].wcVariationId).toBe('');
  });

  test('Maske: Status wie nach der Anlage, SEO ausstehend, Keyphrase', () => {
    expect(maskeBody(p, { produktId: 5, marke: 'JammiFashion' })).toMatchObject({
      'Status': 'Im Shop', 'Status Shop': 'Entwurf', 'SEO_Status': 'Ausstehend', 'Produkt-ID': '5',
      'Artikelkurzbezeichnung': 'HW-Halloween', 'Artikelnummer': 'E3005/HW-Halloween', 'Kategorien': 'Halloween',
      'Fokus_Keyphrase': 'Halloween Shirt Damen', 'Fokus_Synonyme': 'Halloween T-Shirt Damen, Horror Shirt Damen',
    });
  });

  test('globale Attribut-IDs ueber den Namen, fehlend -> Fehler', () => {
    expect(attributIds([{ id: 3, name: 'Farbe' }, { id: 2, name: 'Größe' }])).toEqual({ farbe: 3, groesse: 2, motivGlobal: null });
    expect(() => attributIds([{ id: 3, name: 'Farbe' }])).toThrow(/Größe/);
  });
});

describe('Sheet-Plan', () => {
  test('naechste SSOT-IDs = max + 1, fortlaufend', () => {
    expect(naechsteSsotIds(['JFN-2026-0419', 'JFN-2026-0007', 'x'], 3, 2026)).toEqual(['JFN-2026-0420', 'JFN-2026-0421', 'JFN-2026-0422']);
  });

  test('Zeilen fortlaufend ab dem gemessenen Stand, wartende Artikel ohne Zeilen', () => {
    const reiter = {
      Erfassungsmaske: [['ID', 'Artikelnummer'], [`JFN-${new Date().getFullYear()}-0419`, 'Z108M/MJ-Logo']],
      Varianten: [['SSOT-ID'], ['a'], ['b']],
      Motive: [['Artikelkurzbezeichnung', 'Motiv'], ['MJ-Logo', 'x']],
      Struktur_Kategorien: [['Kategorienummer', 'Kategorien', 'Kategoriename', 'SEO_Hinweis']],
      SEO_Karte: [['Typ', 'Name', 'WC_ID', 'Soll_Keyphrase', 'Soll_Synonyme', 'Status']],
    };
    const sp = planeSheets(reiter, [plan('E3000'), plan('JH180'), plan('E3005')], { heute: '2026-10-10' });
    const j = new Date().getFullYear();
    expect(sp.artikel.map(a => [a.ssot, a.maskeZeile, a.variantenVon, a.variantenBis])).toEqual([
      [`JFN-${j}-0420`, 3, 4, 75], ['', null, null, null], [`JFN-${j}-0421`, 4, 76, 131]]);
    expect(sp.motive.zeile).toBe(3);
    expect(sp.motive.werte.slice(0, 1)).toEqual(['HW-Halloween']);
    expect(sp.karte.werte).toEqual(['Kategorie', 'Halloween', '', 'Halloween Shirts', 'Halloween T-Shirts, Horror Shirts, Halloween Pullover', 'Vorschlag']);
  });

  test('Artikelnummer schon in der Maske -> keine zweite Zeile', () => {
    const reiter = {
      Erfassungsmaske: [['ID', 'Artikelnummer'], ['JFN-2026-0430', 'E3005/HW-Halloween']],
      Varianten: [['SSOT-ID']], Motive: [['Artikelkurzbezeichnung'], ['HW-Halloween']],
      Struktur_Kategorien: [['Kategoriename'], ['Halloween']], SEO_Karte: [['Typ', 'Name'], ['Kategorie', 'Halloween']],
    };
    const sp = planeSheets(reiter, [plan('E3005')]);
    expect(sp.artikel[0]).toMatchObject({ ssot: 'JFN-2026-0430', vorhanden: true, maskeZeile: 2 });
    expect(sp.motive.vorhanden && sp.kategorie.vorhanden && sp.karte.vorhanden).toBe(true);
  });
});

// ── Fake-Shop fuer Abbruch/Fortsetzen ───────────────────────────────────────

function fakeShop({ stoppBeiBatch = 0 } = {}) {
  const produkte = [];
  const variationen = new Map();   // produktId -> []
  let naechsteId = 5000, batches = 0;
  const aufrufe = [];
  const echo = attrs => attrs.map(a => ({ id: a.id ?? 0, name: a.name, option: a.option }));
  return {
    produkte, variationen, aufrufe, shopLabel: 'Test',
    stoppAus() { stoppBeiBatch = 0; },
    async get(pfad, q = {}) {
      aufrufe.push(['get', pfad]);
      if (pfad === 'products') return { data: produkte.filter(p => p.sku === q.sku) };
      const m = /^products\/(\d+)\/variations$/.exec(pfad);
      if (m) { const alle = variationen.get(Number(m[1])) ?? []; const s = (q.page - 1) * q.per_page; return { data: alle.slice(s, s + q.per_page) }; }
      throw new Error(`unerwartet GET ${pfad}`);
    },
    async post(pfad, body) {
      aufrufe.push(['post', pfad]);
      if (pfad === 'products') { const p = { id: naechsteId++, sku: body.sku, type: body.type, status: body.status }; produkte.push(p); variationen.set(p.id, []); return { data: p }; }
      const m = /^products\/(\d+)\/variations\/batch$/.exec(pfad);
      if (m) {
        batches++;
        if (stoppBeiBatch && batches === stoppBeiBatch) throw new HosterPruefseiteError({ shop: 'Test', pfad, httpStatus: 200 });
        const liste = variationen.get(Number(m[1]));
        const create = body.create.map(v => { const n = { id: naechsteId++, sku: v.sku, attributes: echo(v.attributes) }; liste.push(n); return n; });
        return { data: { create } };
      }
      throw new Error(`unerwartet POST ${pfad}`);
    },
    async put() { throw new Error('kein PUT erwartet'); },
  };
}

describe('Abbruch und Fortsetzen', () => {
  const p = plan('E3000', { preise: { E3000: { basis: 25 } } });
  const kontext = { kategorieId: 999, attrIds: ATTR_IDS, markeId: 7, lieferzeit: '21' };

  test('Pruefseite im 2. Block -> AnlageStopp mit Stand, kein weiterer Aufruf', async () => {
    const wc = fakeShop({ stoppBeiBatch: 2 });
    const err = await legeArtikelAn(wc, p, kontext).catch(e => e);
    expect(err).toBeInstanceOf(AnlageStopp);
    expect(err.stand).toMatchObject({ produktId: 5000, produktNeu: true, angelegt: 50 });
    expect(wc.aufrufe.at(-1)).toEqual(['post', 'products/5000/variations/batch']);
    expect(wc.variationen.get(5000)).toHaveLength(50);
  });

  test('zweiter Lauf: Produkt ueber SKU gefunden, nur die 22 fehlenden angelegt, keine Dublette', async () => {
    const wc = fakeShop({ stoppBeiBatch: 2 });
    await legeArtikelAn(wc, p, kontext).catch(() => {});
    wc.stoppAus();
    const r = await legeArtikelAn(wc, p, kontext);
    expect(wc.produkte).toHaveLength(1);
    expect(wc.aufrufe.filter(([m, x]) => m === 'post' && x === 'products')).toHaveLength(1);
    expect(r).toMatchObject({ produktId: 5000, produktNeu: false, vorhanden: 50, angelegt: 22, fehlend: 0, variationen: 72 });
    expect(r.wcIds.filter(Boolean)).toHaveLength(72);
    expect(new Set(r.wcIds).size).toBe(72);
    expect(fehlendeKombinationen(p, wc.variationen.get(5000))).toHaveLength(0);
  });

  test('dritter Lauf: alles da -> kein POST mehr', async () => {
    const wc = fakeShop();
    await legeArtikelAn(wc, p, kontext);
    const vorher = wc.aufrufe.filter(([m]) => m === 'post').length;
    const r = await legeArtikelAn(wc, p, kontext);
    expect(wc.aufrufe.filter(([m]) => m === 'post').length).toBe(vorher);
    expect(r).toMatchObject({ vorhanden: 72, angelegt: 0, fehlend: 0 });
  });

  test('anderer Fehler (kein Stopp) wird mit Stand weitergereicht', async () => {
    const wc = fakeShop();
    wc.post = async () => { throw Object.assign(new Error('boom'), { response: { status: 400 } }); };
    const err = await legeArtikelAn(wc, p, kontext).catch(e => e);
    expect(err).not.toBeInstanceOf(AnlageStopp);
    expect(err.stand).toMatchObject({ produktId: null });
  });

  test('502 stoppt wie die Pruefseite', async () => {
    const wc = fakeShop();
    wc.post = async () => { throw Object.assign(new Error('Bad Gateway'), { response: { status: 502 } }); };
    await expect(legeArtikelAn(wc, p, kontext)).rejects.toBeInstanceOf(AnlageStopp);
  });
});

describe('Takt', () => {
  test('hoechstens ein Aufruf je 2 s, gezaehlt', async () => {
    let uhr = 0;
    const gewartet = [];
    const wc = getakteterClient({ get: async () => ({ data: [] }), post: async () => ({ data: {} }) },
      { taktMs: 2000, jetzt: () => uhr, warte: async ms => { gewartet.push(ms); uhr += ms; } });
    await wc.get('a'); uhr += 500; await wc.get('b'); await wc.post('c');
    expect(gewartet).toEqual([1500, 2000]);
    expect(wc.zaehler).toEqual({ get: 2, post: 1, put: 0 });
  });
});

// ── HW3: Bilder, Motivtexte, Upload ─────────────────────────────────────────

describe('HW3: Mockups und Bilder', () => {
  // Echte Dateinamen aus dem Postfach (halloween/mockups), Stand 10.10.
  const MOCKUPS = [
    'E3000 Halloween_free_hugs.jpg', 'E3000 Halloween_ich_will_doch_nur_spielen.jpg', 'E3000 Halloween_stay_alive.jpg',
    'E3000 Halloween_ther_the_otter.jpg', 'E3000 Halloween_there_the_dog.jpg', 'E3000 Halloween_trust_me.jpg',
    'E3000 Halloween_vertrau_mir.jpg', 'E3000 Halloween_wegen_kuchens.jpg',
    'E3005 Halloween_free_hugs.jpg', 'E3005 Halloween_ich_will_doch_nur_spielen.jpg', 'E3005 Halloween_stay_alive.jpg',
    'E3005 Halloween_ther_the_otter.jpg', 'E3005 Halloween_there_the_dog.jpg', 'E3005 Halloween_trust_me.jpg',
    'E3005 Halloween_vertrau_mir.jpg', 'E3005 Halloween_wegen_kuchens.jpg',
    ...['JH030F', 'JH030'].flatMap(p => [
      `${p}_Deep_black_Halloween Kuchens.jpg`, `${p}_Deep_black_Halloween free_hugsjpg.jpg`, `${p}_Deep_black_Halloween nur_spielen.jpg`,
      `${p}_Deep_black_Halloween vertrau_mir.jpg`, `${p}_Deep_black_Halloween_stay_alive.jpg`, `${p}_Deep_black_Halloween_there_the_dog.jpg`,
      `${p}_Deep_black_Halloween_there_the_otter.jpg`, `${p}_Deep_black_Halloween_trus_me.jpg`]),
  ];

  test('32 Mockups: je Artikel 8, jedes Motiv genau einmal, JH030 und JH030F getrennt', () => {
    const { zuordnung, fehler } = ordneMockups(MOCKUPS);
    expect(fehler).toEqual([]);
    for (const a of ARTIKEL) expect(Object.keys(zuordnung[a.modell]).sort()).toEqual(MOTIVE.map(m => m.titel).sort());
    expect(zuordnung.JH030["Trust me, I'm a Doctor"]).toBe('JH030_Deep_black_Halloween_trus_me.jpg');
    expect(zuordnung.JH030F['Ich bin wegen des Kuchens hier']).toBe('JH030F_Deep_black_Halloween Kuchens.jpg');
    expect(zuordnung.E3000['There the Otter']).toBe('E3000 Halloween_ther_the_otter.jpg');
  });

  test('Fehler = Stopp: fehlendes Motiv, doppeltes Motiv, unbekannte Datei', () => {
    expect(ordneMockups(MOCKUPS.filter(d => d !== 'E3000 Halloween_trust_me.jpg')).fehler)
      .toEqual(["E3000: 7 Mockups statt 8 (fehlt: Trust me, I'm a Doctor)"]);
    expect(ordneMockups([...MOCKUPS, 'E3000 Halloween_trust_me_2.jpg']).fehler[0]).toMatch(/doppelt/);
    expect(ordneMockups([...MOCKUPS, 'BY102 Halloween_dog.jpg']).fehler).toEqual(['BY102 Halloween_dog.jpg: kein Artikel (Präfix)']);
  });

  test('Upload-Liste: Sammelbild vorn, 8 Motive, SEO-Dateinamen, Titel = ALT', () => {
    const { zuordnung } = ordneMockups(MOCKUPS);
    const l = bildListe(ARTIKEL[0], zuordnung.E3000);
    expect(l).toHaveLength(9);
    expect(l[0]).toEqual({ schluessel: 'sammel', quelle: 'sammelbild-E3000.jpg', dateiname: 'halloween-shirt-herren-alle-motive.jpg', titel: 'Halloween Shirt Herren alle Motive' });
    expect(l[1]).toMatchObject({ dateiname: 'halloween-shirt-herren-there-the-dog.jpg', titel: 'Halloween Shirt Herren There the Dog', quelle: 'mockups/E3000 Halloween_there_the_dog.jpg' });
    expect(l[4].dateiname).toBe('halloween-shirt-herren-trust-me-im-a-doctor.jpg');
    expect(l[7].dateiname).toBe('halloween-shirt-herren-stay-alive-challenge-accepted.jpg');
    expect(new Set(l.map(b => b.dateiname)).size).toBe(9);
  });

  test('Galerie und Variationsbild ueber Motiv', () => {
    const p = plan('E3005', { preise: { E3005: { basis: 27 } } });
    const bilder = { sammel: 900, motive: Object.fromEntries(MOTIVE.map((m, i) => [m.titel, 901 + i])) };
    const b = produktPayload(p, { kategorieId: 1, attrIds: ATTR_IDS, markeId: 7, lieferzeit: '21', bilder });
    expect(b.images.map(i => i.id)).toEqual([900, 901, 902, 903, 904, 905, 906, 907, 908]);
    const v = variationsPayloads(p, ATTR_IDS, bilder);
    for (const x of v) expect(x.image.id).toBe(bilder.motive[x.attributes[2].option]);
    expect(() => variationsPayloads(p, ATTR_IDS, { sammel: 1, motive: {} })).toThrow(/Bild für Motiv/);
  });

  test('Upload: nur Fehlende, Zustand nach jedem Bild gespeichert (Fortsetzen ohne Doppel-Upload)', async () => {
    const { zuordnung } = ordneMockups(MOCKUPS);
    const l = bildListe(ARTIKEL[1], zuordnung.E3005);
    const zustand = { [l[0].dateiname]: { id: 500 } };
    let n = 600; const gespeichert = [];
    const lade = jest.fn(async b => ({ id: n++, src: `x/${b.dateiname}`, titel: b.titel, alt: b.titel }));
    const r = await ladeBilderHoch(l, { zustand, speichere: z => gespeichert.push(Object.keys(z).length), lade });
    expect(lade).toHaveBeenCalledTimes(8);
    expect(r).toMatchObject({ neu: 8, vorhanden: 1 });
    expect(r.bilder.sammel).toBe(500);
    expect(gespeichert).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    const r2 = await ladeBilderHoch(l, { zustand, speichere: () => {}, lade });
    expect(lade).toHaveBeenCalledTimes(8);
    expect(r2.neu).toBe(0);
    expect(bilderAusZustand(l, {})).toBeNull();
  });
});

describe('HW3: Motive-Zeile (freigegeben)', () => {
  test('volle Aufdrucke, Zombie-Arzt statt Pestdoktor, Druck vollfarbig, Offen leer, kein Werkname', () => {
    expect(MOTIV_ZEILE.motiv).toContain('„There the Dog – in the pan becomes crazy!“ (Mops in der Pfanne)');
    expect(MOTIV_ZEILE.motiv).toContain('„Vertrau mir, ich bin Arzt!“ (Zombie-Arzt im Kittel)');
    expect(MOTIV_ZEILE.motiv).toContain("„Trust me, I'm a Doctor“ (Pestdoktor)");
    expect(MOTIV_ZEILE.motiv).toContain('Horror-Clown mit Kettensäge');
    expect(MOTIV_ZEILE.motiv.match(/Pestdoktor/g)).toHaveLength(1);
    expect(MOTIV_ZEILE).toMatchObject({ druckposition: 'Front, großflächig', druckfarben: 'vollfarbig', offen: '' });
    expect(MOTIV_ZEILE.motiv).not.toMatch(/fanart|serie/i);
  });
});
