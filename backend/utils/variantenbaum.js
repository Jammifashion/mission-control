// Variantenbaum im Aenderungspfad schuetzen (Auftrag VB1, 08.11.2026).
//
// Befund: "Artikel ändern" schickte Eltern-Attribute nur mit NAMEN. WooCommerce (REST)
// liest `name` ohne `id` als LOKALES Attribut und ersetzt damit ein globales (pa_farbe,
// pa_groesse). Die Variationen speichern ihre Werte unter attribute_pa_* - nach dem
// Wechsel passt kein Wert mehr, im Shop steht "Beliebig" (BY052, 5 Artikel, 07.11.).
// Dazu verlor die Maske beim Laden die Variations-IDs (recomputeVariants), schickte alle
// Variationen als neu, und die Neuanlage scheiterte an den belegten SKUs.
//
// Regeln (reine Logik, ohne Shop-Zugriff):
//  - Ein Attribut im Body ohne id, dessen Name im Shop ein GLOBALES Attribut ist, bekommt
//    dessen id (Eltern und jede Variation). Nie global -> lokal.
//  - Werte, die beim Speichern aus den Optionen fallen: die Shop-Variationen mit diesem
//    Wert werden PRIVAT (nie geloescht, nie verwaist); default_attributes mit diesem Wert
//    fallen weg.
//  - Ausdruecklich privat gestellte Variationen (Body `privat`) nur, wenn sie zum Artikel
//    gehoeren.

const norm = s => String(s ?? '').trim().toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

/** Shop-Attribute nach normiertem Namen. */
function nachName(shopAttribute) {
  const m = new Map();
  for (const a of shopAttribute ?? []) if (a?.name) m.set(norm(a.name), a);
  return m;
}

/**
 * Eltern-Attribute des Bodys mit den ids der globalen Shop-Attribute ergaenzen.
 * @returns {{ attribute: object[], ergaenzt: number }}
 */
export function attributeMitIds(bodyAttribute, shopAttribute) {
  const shop = nachName(shopAttribute);
  let ergaenzt = 0;
  const attribute = (bodyAttribute ?? []).map(a => {
    if (!a || a.id) return a;
    const s = shop.get(norm(a.name));
    if (s?.id) { ergaenzt++; return { ...a, id: s.id, name: s.name }; }
    return a;
  });
  return { attribute, ergaenzt };
}

/** Attribute einer Variation ({ name, option }) mit den ids globaler Eltern-Attribute ergaenzen. */
export function variationsAttributeMitIds(attrs, shopAttribute) {
  const shop = nachName(shopAttribute);
  return (attrs ?? []).map(a => {
    if (!a || a.id) return a;
    const s = shop.get(norm(a.name));
    return s?.id ? { ...a, id: s.id, name: s.name } : a;
  });
}

/** Zu welchem Body-Attribut gehoert ein Variations-Attribut? (id vor Name) */
function findeAttribut(liste, va) {
  return (liste ?? []).find(a => (va.id && a.id ? Number(a.id) === Number(va.id) : norm(a.name) === norm(va.name)));
}

/**
 * Werte, die gegenueber dem Shop-Stand aus den Optionen fallen.
 * Nur Attribute, die im Body weiter vorkommen (ganze Achse weg = Farbachsen-Regel, nicht hier).
 * @returns {{ name: string, werte: string[] }[]}
 */
export function entfalleneWerte(shopAttribute, bodyAttribute) {
  const aus = [];
  for (const s of shopAttribute ?? []) {
    if (!s?.variation) continue;
    const b = findeAttribut(bodyAttribute, { id: s.id, name: s.name });
    if (!b || !Array.isArray(b.options)) continue;
    const neu = new Set(b.options.map(norm));
    const weg = (s.options ?? []).filter(o => !neu.has(norm(o)));
    if (weg.length) aus.push({ name: s.name, id: s.id || 0, werte: weg });
  }
  return aus;
}

/**
 * Shop-Variationen, die nach dem Speichern privat werden muessen: Wert entfaellt.
 * Bereits private Variationen und solche, die der Body mit gueltigen Werten aktualisiert,
 * bleiben aussen vor.
 * @param {object[]} shopVariationen  [{ id, status, attributes: [{ id, name, option }] }] - VOR dem Produkt-PUT gelesen
 * @param {object[]} bodyAttribute    Eltern-Attribute, wie sie geschrieben werden
 * @param {Set<string>} [aktualisiert]  ids aus dem update-Teil des Batches
 */
export function variationenMitEntfallenemWert(shopVariationen, bodyAttribute, aktualisiert = new Set()) {
  const ids = [];
  for (const v of shopVariationen ?? []) {
    if (!v?.id || v.status === 'private' || aktualisiert.has(String(v.id))) continue;
    const faellt = (v.attributes ?? []).some(va => {
      const b = findeAttribut(bodyAttribute, va);
      if (!b || !Array.isArray(b.options)) return false;
      const wert = norm(va.option);
      return wert !== '' && !b.options.some(o => norm(o) === wert);
    });
    if (faellt) ids.push(v.id);
  }
  return ids;
}

/** default_attributes ohne Werte, die nicht mehr in den Optionen stehen. null = unveraendert. */
export function defaultsBereinigt(defaults, bodyAttribute) {
  const alt = Array.isArray(defaults) ? defaults : [];
  const neu = alt.filter(d => {
    const b = findeAttribut(bodyAttribute, d);
    if (!b) return false;
    return !Array.isArray(b.options) || b.options.some(o => norm(o) === norm(d.option));
  });
  return neu.length === alt.length ? null : neu;
}

/** Body `privat`: nur ids, die zum Artikel gehoeren und noch nicht privat sind. */
export function privatAusBody(privat, shopVariationen) {
  const imShop = new Map((shopVariationen ?? []).map(v => [String(v.id), v]));
  const ok = [], fremd = [];
  for (const id of Array.isArray(privat) ? privat : []) {
    const v = imShop.get(String(id));
    if (!v) fremd.push(id);
    else if (v.status !== 'private') ok.push(v.id);
  }
  return { ok: [...new Set(ok)], fremd };
}
