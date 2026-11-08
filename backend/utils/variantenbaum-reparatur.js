// Reparatur kaputter Variantenbaeume (Auftrag VB2, Verallgemeinerung von VB1). Reine Logik.
//
// Ziel je Artikel:
//  - variierende Eltern-Attribute GLOBAL, wenn es ein globales Attribut gleichen Namens gibt
//    (lokal entstand nur durch den Fehler im Aenderungspfad, VB1);
//  - jede Variation mit ihren Werten, Quelle in dieser Reihenfolge:
//      1. heutiger Wert, wenn er in den Optionen des Elternartikels steht,
//      2. Reiter `Varianten` (WC_Variation_ID -> E1/V1 …),
//      3. Variations-SKU: <Eltern-SKU>-<wert1>-<wert2>… genau EINE passende Kombination;
//    sonst "unklar" -> nichts automatisch, Liste fuer den Inhaber;
//  - Optionen = Werte der sichtbaren Variationen (Reihenfolge wie bisher, Groessen nach Rang);
//  - nicht variierende Eltern-Attribute bleiben unveraendert (die Liste ERSETZT alle);
//  - Vorblendung nur, wenn der Wert danach noch gilt.
// Geloescht wird nie; die Reparatur stellt auch nichts privat (das entscheidet der Inhaber).

const norm = s => String(s ?? '').trim().toLowerCase();
const slug = s => norm(s).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const GR = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', 'XXXL', '4XL', '5XL', '6XL'];
const istGroesse = name => /^gr(ö|oe)(ß|ss)e$/i.test(String(name).trim());

/** Kombinationen der SKU-Endung gegen die Optionen (Reihenfolge der Attribute). */
export function ausSkuEndung(sku, elternSku, attribute) {
  const s = norm(sku), e = norm(elternSku);
  if (!e || !s.startsWith(e + '-')) return null;
  const rest = s.slice(e.length + 1);
  const treffer = [];
  const suche = (i, offen, gewaehlt) => {
    if (i === attribute.length) { if (offen === '') treffer.push(gewaehlt); return; }
    for (const o of attribute[i].options) {
      const t = slug(o);
      if (!t) continue;
      if (i === attribute.length - 1 ? offen === t : offen.startsWith(t + '-'))
        suche(i + 1, i === attribute.length - 1 ? '' : offen.slice(t.length + 1), [...gewaehlt, o]);
    }
  };
  suche(0, rest, []);
  return treffer.length === 1 ? treffer[0] : null;
}

/**
 * @param {object} produkt     WC-Produkt (context edit): sku, attributes, default_attributes
 * @param {object[]} variationen  [{ id, sku, status, attributes: [{ id, name, option }] }]
 * @param {Map<string, {id:number, name:string, terme?:Map<string,string>}>} globale  normierter Name -> globales Attribut (terme: normiert -> Termname)
 * @param {Map<string, object>} [reiter]  WC_Variation_ID -> { Achse: Wert } aus dem Reiter Varianten
 */
export function planeReparatur(produkt, variationen, globale, reiter = new Map()) {
  const alle = produkt.attributes ?? [];
  const variierend = alle.filter(a => a.variation);
  // Zielattribut je variierendem Attribut
  const ziel = variierend.map(a => {
    const g = !a.id ? globale.get(norm(a.name)) : null;
    return { alt: a, id: a.id || g?.id || 0, name: a.id ? a.name : (g?.name ?? a.name), global: !!(a.id || g), wechsel: !a.id && !!g };
  });
  // Wertequellen: Optionen + Reiter + SKU-Kandidaten
  const zeilen = [], unklar = [];
  for (const v of variationen) {
    const ist = Object.fromEntries((v.attributes ?? []).map(a => [norm(a.name), a.option]));
    const r = reiter.get(String(v.id));
    let quelle = 'heute';
    let werte = ziel.map(z => {
      const w = ist[norm(z.alt.name)];
      return w && z.alt.options.some(o => norm(o) === norm(w)) ? z.alt.options.find(o => norm(o) === norm(w)) : null;
    });
    if (werte.some(w => w === null) && r) {
      const ausR = ziel.map(z => { const k = Object.keys(r).find(n => norm(n) === norm(z.alt.name)); return k ? r[k] : null; });
      if (ausR.every(Boolean)) { werte = ausR; quelle = 'Reiter Varianten'; }
    }
    if (werte.some(w => w === null)) {
      // SKU gegen Optionen inkl. der Werte, die es nur noch als Term gibt (z. B. entfernte Groesse)
      // terme: Map normierter Name -> Termname (oder Set); doppelte Schreibweisen nur einmal (nach slug)
      const kand = ziel.map(z => {
        const t = globale.get(norm(z.name))?.terme;
        const liste = [...z.alt.options, ...(t ? [...t.values()] : [])];
        const gesehen = new Set();
        return { options: liste.filter(o => { const k = slug(o); if (gesehen.has(k)) return false; gesehen.add(k); return true; }) };
      });
      const s = ausSkuEndung(v.sku, produkt.sku, kand);
      if (s) { werte = s; quelle = 'SKU'; }
    }
    const istText = (v.attributes ?? []).map(a => `${a.name}=${a.option}`).join(', ') || '(leer)';
    if (werte.some(w => w === null)) { unklar.push({ id: v.id, sku: v.sku, ist: istText, status: v.status }); continue; }
    const geaendert = quelle !== 'heute' || ziel.some(z => z.wechsel);
    zeilen.push({ id: v.id, sku: v.sku, status: v.status, ist: istText, quelle, werte, geaendert });
  }
  // Optionen: sichtbare Variationen; Reihenfolge wie bisher, neue dahinter, Groessen nach Rang
  const optionen = ziel.map((z, i) => {
    const werte = [...new Set(zeilen.filter(x => x.status !== 'private').map(x => x.werte[i]))];
    const alt = z.alt.options.filter(o => werte.some(w => norm(w) === norm(o)));
    const neu = werte.filter(w => !alt.some(o => norm(o) === norm(w)));
    let liste = [...alt, ...neu];
    if (istGroesse(z.name)) liste = [...liste].sort((a, b) => (GR.indexOf(a.toUpperCase()) + 1 || 99) - (GR.indexOf(b.toUpperCase()) + 1 || 99));
    return liste;
  });
  // fehlende globale Terme
  const fehlendeTerme = [];
  ziel.forEach((z, i) => {
    const g = globale.get(norm(z.name));
    if (z.global && g?.terme) for (const o of optionen[i]) if (!g.terme.has(norm(o))) fehlendeTerme.push(`${z.name}: ${o}`);
  });
  const attributes = alle.map(a => {
    const i = variierend.indexOf(a);
    if (i < 0) return a.id ? { id: a.id, position: a.position, visible: a.visible, variation: a.variation, options: a.options }
                          : { name: a.name, position: a.position, visible: a.visible, variation: a.variation, options: a.options };
    const z = ziel[i];
    return { ...(z.id ? { id: z.id } : { name: z.name }), position: a.position, visible: a.visible, variation: true, options: optionen[i] };
  });
  const defaults = (produkt.default_attributes ?? []).map(d => {
    const i = ziel.findIndex(z => (d.id && z.id ? Number(d.id) === Number(z.id) : norm(d.name) === norm(z.name)));
    if (i < 0) return null;
    const w = optionen[i].find(o => norm(o) === norm(d.option) || slug(o) === slug(d.option));
    return w ? { ...(ziel[i].id ? { id: ziel[i].id } : { name: ziel[i].name }), option: w } : null;
  }).filter(Boolean);
  const batch = zeilen.filter(x => x.geaendert).map(x => ({ id: x.id,
    attributes: ziel.map((z, i) => ({ ...(z.id ? { id: z.id } : { name: z.name }), option: x.werte[i] })) }));
  const elternAendern = ziel.some(z => z.wechsel) || ziel.some((z, i) => optionen[i].join('|') !== z.alt.options.join('|'))
    || JSON.stringify(defaults) !== JSON.stringify((produkt.default_attributes ?? []).map(({ id, name, option }) => (id ? { id, option } : { name, option })));
  return { ziel, optionen, attributes, default_attributes: defaults, zeilen, unklar, fehlendeTerme, batch, elternAendern,
    automatisch: unklar.length === 0 && fehlendeTerme.length === 0 };
}
