// Befehl SE1: Reiter "SEO-Daten aendern" - Artikelsuche und Keyphrase-
// Dubletten. Nur LESEN aus WooCommerce; geschrieben wird ueber den Yoast-
// Schreibweg des SEO-Reiters (PUT products/<id> mit ausschliesslich meta_data).
//
// Dubletten-Pruefung: Die WooCommerce-REST kann nicht nach meta_data filtern
// (kein meta_key/meta_value-Parameter, "search" durchsucht nur Titel/Inhalt).
// Also: alle veroeffentlichten Artikel lesen, nur id, name und meta_data
// (_fields). GEMESSEN 24.09.: 100 Artikel je Seite in ~1,7 s statt ~4,6 s,
// ~0,57 MB statt ~2,4 MB; 572 Artikel = 6 Seiten. Ergebnis 10 Minuten im
// Speicher, nach jedem Schreiben wird der eine Eintrag nachgezogen.

const SEITE     = 100;
const CACHE_TTL = 10 * 60 * 1000;
const KW_KEY    = '_yoast_wpseo_focuskw';

let _cache = null;   // { at, eintraege: Map<id, { id, name, keyphrase }> }

export function _resetKeyphraseCache() { _cache = null; }

const norm = s => String(s ?? '').trim().toLowerCase();

function keyphraseAus(metaData) {
  const e = (Array.isArray(metaData) ? metaData : []).find(m => m && m.key === KW_KEY);
  return e && typeof e.value === 'string' ? e.value.trim() : '';
}

async function ladeKeyphrasen(wc) {
  if (_cache && Date.now() - _cache.at < CACHE_TTL) return _cache.eintraege;
  const eintraege = new Map();
  for (let page = 1; ; page++) {
    const { data, headers } = await wc.get('products', {
      status: 'publish', per_page: SEITE, page, _fields: 'id,name,meta_data',
    });
    for (const p of Array.isArray(data) ? data : []) {
      eintraege.set(p.id, { id: p.id, name: p.name, keyphrase: keyphraseAus(p.meta_data) });
    }
    if (page >= Number(headers?.['x-wp-totalpages'] || 1) || !data?.length) break;
  }
  _cache = { at: Date.now(), eintraege };
  return eintraege;
}

/**
 * Andere veroeffentlichte Artikel mit derselben Keyphrase (Gross/Klein egal).
 * @returns {Promise<Array<{id:number,name:string,keyphrase:string}>>}
 */
export async function keyphraseDubletten(wc, keyphrase, ausserId) {
  const kw = norm(keyphrase);
  if (!kw) return [];
  const eintraege = await ladeKeyphrasen(wc);
  return [...eintraege.values()].filter(e => norm(e.keyphrase) === kw && String(e.id) !== String(ausserId));
}

/** Nach dem Schreiben den einen Eintrag im Speicher nachziehen. */
export function merkeKeyphrase(id, name, keyphrase) {
  if (!_cache) return;
  _cache.eintraege.set(Number(id), { id: Number(id), name, keyphrase: String(keyphrase ?? '').trim() });
}

/**
 * Veroeffentlichte Artikel nach Name, SKU oder Produkt-ID.
 * Zahl -> zuerst als ID; dazu immer Namens- und SKU-Suche.
 */
export async function sucheArtikel(wc, q) {
  const text = String(q ?? '').trim();
  if (!text) return [];
  const treffer = new Map();
  const nimm = p => {
    if (p && p.id && p.status === 'publish' && !treffer.has(p.id))
      treffer.set(p.id, { id: p.id, name: p.name, sku: p.sku ?? '', status: p.status });
  };

  if (/^\d+$/.test(text)) {
    try {
      const { data } = await wc.get(`products/${text}`);
      nimm(Array.isArray(data) ? data[0] : data);
    } catch (e) {
      if (e.response?.status !== 404) throw e;              // unbekannte ID ist kein Fehler
    }
  }
  const [nachName, nachSku] = await Promise.all([
    wc.get('products', { search: text, status: 'publish', per_page: 40 }),
    wc.get('products', { sku: text, status: 'publish', per_page: 40 }),
  ]);
  for (const p of [...(nachSku.data ?? []), ...(nachName.data ?? [])]) nimm(p);
  return [...treffer.values()];
}
