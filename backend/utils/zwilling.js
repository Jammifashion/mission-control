// HONK!-Zwilling (ZW1) - reine Logik. Ein in JFN angelegter Artikel bekommt in honkshop.de einen Zwilling
// als ENTWURF: gleiche SKUs, Varianten, Preise, Bilder (neu hochgeladen), Attribute LOKAL wie in JFN (Inhaber
// 25.11.: keine Terme in HONK anlegen), Kategorien und Lieferzeit ueber die Zuordnung im SSOT:
//   Struktur_Kategorien.HONK_Kategorie   (HONK-Kategorie-ID je JFN-Kategorie; leer = keine Zuordnung)
//   Struktur_Lieferzeiten.Term_ID_HONK   (HONK-Term-ID je JFN-Lieferzeit; leer = keine Zuordnung)
// ZW1-2 (Inhaber 27.11.): honkshop.de hat keine Kategorienavigation - JFN-Kategorien ohne HONK_Kategorie landen in der
// Standardkategorie aus Business-Config `zwilling.honk_standard_kategorie` (Merch). Fehlt auch die, wird in HONK NICHTS
// angelegt (kein halber Zwilling) - Grund in `gruende`. Ebenso fehlende Lieferzeit-Zuordnung.
// Verknuepfung: Erfassungsmaske.HONK_Produkt_ID + HONK_Status, Varianten.HONK_Variation_ID (keine zweite Zeile).

export const SPALTE_ERF_HONK_ID     = 'HONK_Produkt_ID';
export const SPALTE_ERF_HONK_STATUS = 'HONK_Status';
export const SPALTE_VAR_HONK_ID     = 'HONK_Variation_ID';
export const SPALTE_KAT_HONK        = 'HONK_Kategorie';
export const SPALTE_LZ_HONK         = 'Term_ID_HONK';

export const ANLAGE_NUR_JFN_TEXT = 'Neu angelegt wird nur in JammiFashion. HONK!-Artikel entstehen als Zwilling '
  + '(Haken „auch im HONK!-Shop anlegen“).';

export const CONFIG_STANDARD_KAT = 'zwilling.honk_standard_kategorie';
export const LIEFERZEIT_WIE_ELTERN = '-1';
export const BATCH_MAX = 50;

const t = v => String(v ?? '').trim();
const meta = (liste, key) => (Array.isArray(liste) ? liste : []).find(m => m?.key === key)?.value;

/** Zuordnung aus Reiterzeilen: [{ von, nach }] -> Map(von -> nach), leere `nach` bleiben als ''. */
export function zuordnungAus(zeilen) {
  const m = new Map();
  for (const z of zeilen ?? []) {
    const von = t(z?.von);
    if (von) m.set(von, t(z?.nach));
  }
  return m;
}

/**
 * Bilder des JFN-Artikels in Reihenfolge (Galerie, dann Variationsbilder), je Medien-ID einmal.
 * @returns {{ id: number, src: string, name: string, alt: string }[]}
 */
export function bildListe(produkt, variationen) {
  const raus = [];
  const gesehen = new Set();
  const nimm = b => {
    const id = Number(b?.id);
    if (!id || gesehen.has(id) || !t(b?.src)) return;
    gesehen.add(id);
    raus.push({ id, src: t(b.src), name: t(b.name), alt: t(b.alt) });
  };
  for (const b of produkt?.images ?? []) nimm(b);
  for (const v of variationen ?? []) nimm(v?.image);
  return raus;
}

/** Dateiname aus der Bild-Adresse (ohne Abfrage), sonst bild-<id>.jpg. */
export function dateinameAus(src, id) {
  try {
    const name = decodeURIComponent(new URL(src).pathname.split('/').pop() || '');
    if (/^[\w.\-() ]+\.(jpe?g|png|webp|gif)$/i.test(name)) return name;
  } catch { /* faellt durch */ }
  return `bild-${id}.jpg`;
}

/**
 * Plan fuer den Zwilling - nur aus gelesenen Daten, schreibt nichts.
 * @param {object} o
 * @param {object} o.produkt      JFN-Produkt (WC v3)
 * @param {object[]} o.variationen JFN-Variationen
 * @param {Map} o.kategorien      JFN-Kategorie-ID -> HONK-ID ('' = leer)
 * @param {Map} o.lieferzeiten    JFN-Term-ID -> HONK-Term-ID ('' = leer)
 * @param {string} [o.standardKategorie]  HONK-ID fuer Kategorien ohne Zuordnung (Config, ZW1-2)
 * @returns {{ gruende: string[], produkt?: object, variationen?: object[], skus: string[] }}
 */
export function zwillingPlan({ produkt, variationen, kategorien, lieferzeiten, standardKategorie }) {
  const gruende = [];
  if (!produkt?.id) return { gruende: ['JFN-Artikel nicht gelesen.'], skus: [] };
  if (produkt.type !== 'variable') gruende.push(`JFN-Artikel ist vom Typ „${produkt.type}“ – Zwilling nur für variable Artikel.`);
  const sku = t(produkt.sku);
  if (!sku) gruende.push('JFN-Artikel hat keine SKU.');

  // Kategorien: Zuordnung aus Struktur_Kategorien, sonst Standard (ZW1-2); Menge ohne Dubletten.
  const katIds = [];
  const standard = /^\d+$/.test(t(standardKategorie)) ? t(standardKategorie) : '';
  for (const k of produkt.categories ?? []) {
    const von = String(k.id);
    const zu = kategorien?.get(von) ?? '';
    const nach = /^\d+$/.test(zu) ? zu : standard;
    if (!nach) gruende.push(`Kategorie „${t(k.name) || von}“ (${von}) hat keine HONK_Kategorie in Struktur_Kategorien `
      + `und Config ${CONFIG_STANDARD_KAT} ist leer.`);
    else if (!katIds.includes(Number(nach))) katIds.push(Number(nach));
  }
  if (!(produkt.categories ?? []).length) gruende.push('JFN-Artikel hat keine Kategorie.');

  const lzJfn = t(meta(produkt.meta_data, '_lieferzeit'));
  const lzHonk = lieferzeiten?.get(lzJfn) ?? '';
  if (!/^\d+$/.test(lzJfn)) gruende.push(`JFN-Artikel hat keine Lieferzeit („${lzJfn || 'leer'}“).`);
  else if (!/^\d+$/.test(lzHonk)) gruende.push(`Lieferzeit ${lzJfn} hat keine Term_ID_HONK in Struktur_Lieferzeiten.`);

  if (!t(produkt.shipping_class)) gruende.push('JFN-Artikel hat keine Versandklasse.');
  const vars = (variationen ?? []).filter(v => v?.id);
  if (!vars.length) gruende.push('JFN-Artikel hat keine Variationen.');
  const skus = [sku, ...vars.map(v => t(v.sku))].filter(Boolean);
  const doppelt = skus.filter((s, i) => skus.indexOf(s) !== i);
  if (doppelt.length) gruende.push(`SKU doppelt im JFN-Artikel: ${[...new Set(doppelt)].join(', ')}`);
  const ohneSku = vars.filter(v => !t(v.sku)).map(v => v.id);
  if (ohneSku.length) gruende.push(`Variationen ohne SKU: ${ohneSku.join(', ')}`);
  if (gruende.length) return { gruende, skus };

  // Attribute LOKAL (nur Name, keine id) - wie die Maske in JFN anlegt (Inhaber 25.11.).
  const attributes = (produkt.attributes ?? []).map((a, i) => ({
    name: t(a.name), options: (a.options ?? []).map(String), position: a.position ?? i,
    visible: a.visible !== false, variation: a.variation !== false,
  }));
  const p = {
    name: t(produkt.name),
    type: 'variable',
    status: 'draft',
    sku,
    description: produkt.description ?? '',
    short_description: produkt.short_description ?? '',
    categories: katIds.map(id => ({ id })),
    attributes,
    shipping_class: t(produkt.shipping_class),
    tax_status: produkt.tax_status || 'taxable',
    tax_class: produkt.tax_class ?? '',
    manage_stock: false,
    ...(produkt.default_attributes?.length ? { default_attributes: produkt.default_attributes.map(d => ({ name: d.name, option: d.option })) } : {}),
    meta_data: [{ key: '_lieferzeit', value: lzHonk }],
  };
  const v = vars.map((x, i) => {
    const gla = meta(x.meta_data, '_wc_gla_color');
    return {
      _jfnId: x.id,
      _bildJfn: Number(x.image?.id) || 0,
      attributes: (x.attributes ?? []).map(a => ({ name: t(a.name), option: t(a.option) })),
      regular_price: t(x.regular_price),
      ...(t(x.sale_price) ? { sale_price: t(x.sale_price) } : {}),
      sku: t(x.sku),
      status: x.status === 'private' ? 'private' : 'publish',
      menu_order: x.menu_order ?? i + 1,
      manage_stock: false,
      meta_data: [{ key: '_lieferzeit', value: LIEFERZEIT_WIE_ELTERN }, ...(t(gla) ? [{ key: '_wc_gla_color', value: t(gla) }] : [])],
    };
  });
  const galerieJfn = (produkt.images ?? []).map(b => Number(b.id)).filter(Boolean);
  return { gruende, produkt: p, variationen: v, skus, galerieJfn };
}

/** Bild-IDs (JFN -> HONK) einsetzen: Galerie in JFN-Reihenfolge, Variationsbild nur an der Variation. */
export function mitBildern(plan, bildMap) {
  const galerie = (plan.galerieJfn ?? []).map(id => bildMap.get(id)).filter(Boolean);
  return {
    produkt: { ...plan.produkt, ...(galerie.length ? { images: galerie.map(id => ({ id })) } : {}) },
    variationen: plan.variationen.map(({ _jfnId, _bildJfn, ...rest }) => ({
      ...rest, ...(_bildJfn && bildMap.get(_bildJfn) ? { image: { id: bildMap.get(_bildJfn) } } : {}),
    })),
    galerieAnzahl: galerie.length,
  };
}

/** Teilt eine Liste in Stuecke zu hoechstens n. */
export const stuecke = (liste, n = BATCH_MAX) => {
  const raus = [];
  for (let i = 0; i < liste.length; i += n) raus.push(liste.slice(i, i + n));
  return raus;
};

/**
 * Rueckgelesenen HONK-Zwilling gegen den Plan pruefen.
 * @returns {string[]} Abweichungen (leer = alles da)
 */
export function vergleicheZwilling({ plan, produkt, variationen, bilderErwartet, statusEgal = false }) {
  const ab = [];
  if (!produkt?.id) return ['HONK-Artikel nicht zurückgelesen.'];
  if (!statusEgal && produkt.status !== 'draft') ab.push(`Status „${produkt.status}“ statt Entwurf.`);
  if (t(produkt.sku) !== plan.produkt.sku) ab.push(`SKU „${t(produkt.sku)}“ statt „${plan.produkt.sku}“.`);
  const lz = t(meta(produkt.meta_data, '_lieferzeit'));
  const lzSoll = plan.produkt.meta_data.find(m => m.key === '_lieferzeit').value;
  if (lz !== lzSoll) ab.push(`Lieferzeit „${lz || 'leer'}“ statt „${lzSoll}“.`);
  const katSoll = plan.produkt.categories.map(c => c.id).sort().join(',');
  const katIst = (produkt.categories ?? []).map(c => c.id).sort().join(',');
  if (katSoll !== katIst) ab.push(`Kategorien ${katIst || '–'} statt ${katSoll}.`);
  if ((produkt.images ?? []).length < (bilderErwartet ?? 0)) ab.push(`${(produkt.images ?? []).length} von ${bilderErwartet} Galeriebildern.`);
  const ist = new Map((variationen ?? []).map(v => [t(v.sku), v]));
  const fehlen = plan.variationen.filter(v => !ist.has(v.sku)).map(v => v.sku);
  if (fehlen.length) ab.push(`${fehlen.length} Variation(en) fehlen: ${fehlen.slice(0, 5).join(', ')}${fehlen.length > 5 ? ' …' : ''}`);
  let lzFalsch = 0, preisFalsch = 0;
  for (const v of plan.variationen) {
    const x = ist.get(v.sku);
    if (!x) continue;
    if (t(meta(x.meta_data, '_lieferzeit')) !== LIEFERZEIT_WIE_ELTERN) lzFalsch++;
    if (t(x.regular_price) !== v.regular_price) preisFalsch++;
  }
  if (lzFalsch) ab.push(`${lzFalsch} Variation(en) ohne Lieferzeit „-1“.`);
  if (preisFalsch) ab.push(`${preisFalsch} Variation(en) mit anderem Preis.`);
  return ab;
}

/** Statuswert fuer Erfassungsmaske.HONK_Status. */
export const honkStatusText = (status, abweichungen) =>
  (abweichungen?.length ? 'unvollständig' : status === 'publish' ? 'Veröffentlicht' : status === 'private' ? 'Privat' : 'Entwurf');

/** ZW1-2: Kategorienamen fuer die Rueckmeldung ("Merch", "Specials"); ohne Namen die ID. */
export const kategorieNamen = kat => (kat ?? []).map(k => t(k?.name) || `#${k?.id}`).filter(Boolean);

/** ZW1-2: Wert aus Config-Zeilen (Kopf mit Schlüssel/Wert). */
export function configWert(werte, schluessel) {
  const [kopf = [], ...rest] = werte ?? [];
  const n = kopf.map(x => t(x).toLowerCase());
  const iS = n.findIndex(x => x === 'schlüssel' || x === 'schluessel'), iW = n.indexOf('wert');
  if (iS < 0 || iW < 0) return '';
  return t(rest.find(r => t(r[iS]) === schluessel)?.[iW]);
}
