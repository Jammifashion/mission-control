// Kurze, eindeutige SKUs - fuer das Elternprodukt und fuer jede Variante.
//
// Warum es diese Datei gibt: die SKU entstand bisher ausschliesslich im
// Frontend (index.html, updateArticleNr) aus L-Shop-Nummer und
// Artikelkurzbezeichnung, und die Kurzbezeichnung war eine Spiegelung des
// Produktnamens. Daraus wurden SKUs wie
//   JH30F/Nothing-Butt-A-Merry-Christmas-–-Ugly-Christmas-Sweater-Damen
// (67 Zeichen), und alle Varianten trugen dieselbe Eltern-SKU, weil beim Push
// gar kein sku-Feld mitging. Die Regeln stehen jetzt hier, an genau einer
// Stelle, und werden im Backend erzwungen - das Frontend spiegelt sie nur.
//
// Nicht migriert wird: Bestandsartikel behalten ihre alten SKUs.

export const KURZ_MIN  = 3;
export const KURZ_MAX  = 20;
export const ARTNR_MAX = 30;
export const SKU_MAX   = 50;

// Nur ASCII-Buchstaben, Ziffern, Bindestrich. Bewusst ohne Unterstrich und
// ohne Leerzeichen - beides steckt im Altbestand und macht SKUs unbrauchbar
// fuer Dateinamen, URLs und EDI-Exporte.
export const KURZ_RE = /^[A-Za-z0-9-]+$/;

/**
 * Vergleichs- und Bauform fuer einen Variantenwert:
 * klein, Umlaute aufgeloest, Leerzeichen zu Bindestrich, Rest faellt weg.
 * "Grau meliert" -> "grau-meliert", "Größe XL" -> "groesse-xl", "5XL" -> "5xl".
 * "/" und "|" entfallen samt umgebender Leerzeichen, damit jede Schreibweise
 * dieselbe SKU ergibt: "Weiß/Pink", "Weiß / Pink", "Weiß | Pink" -> "weisspink".
 */
export function normalisiereTeil(wert) {
  return String(wert ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\s*[/|]\s*/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @returns {{feld: string, fehler: string}|null} null = in Ordnung.
 */
export function pruefeKurzbezeichnung(kurz) {
  const k = String(kurz ?? '').trim();
  const feld = 'Artikelkurzbezeichnung';
  if (!k) return { feld, fehler: 'Artikelkurzbezeichnung fehlt - sie ist Pflicht, es gibt keinen Fallback aus dem Produktnamen mehr.' };
  if (k.length < KURZ_MIN || k.length > KURZ_MAX)
    return { feld, fehler: `Artikelkurzbezeichnung muss ${KURZ_MIN}-${KURZ_MAX} Zeichen haben (ist ${k.length}).` };
  if (!KURZ_RE.test(k))
    return { feld, fehler: 'Artikelkurzbezeichnung darf nur A-Z, a-z, 0-9 und Bindestrich enthalten.' };
  return null;
}

/**
 * Artikelnummer = L-Shop-Nummer + "/" + Kurzbezeichnung.
 * Ohne L-Shop-Nummer wird nicht gespeichert - frueher entstand hier eine
 * leere SKU, weil updateArticleNr() auf '' fiel und das kommentarlos durchging.
 *
 * @returns {{artikelnummer: string}|{feld: string, fehler: string}}
 */
export function baueArtikelnummer(lshopNr, kurz) {
  const l = String(lshopNr ?? '').trim();
  if (!l) return {
    feld:  'L-Shop-Artikelnummer',
    fehler: 'L-Shop-Artikelnummer fehlt - ohne sie wird nicht gespeichert (sonst entsteht eine leere SKU).',
  };

  const kurzFehler = pruefeKurzbezeichnung(kurz);
  if (kurzFehler) return kurzFehler;

  const artikelnummer = `${l}/${String(kurz).trim()}`;
  if (artikelnummer.length > ARTNR_MAX) return {
    feld:  'Artikelnummer',
    fehler: `Artikelnummer "${artikelnummer}" ist ${artikelnummer.length} Zeichen, erlaubt sind ${ARTNR_MAX}.`,
  };
  return { artikelnummer };
}

/**
 * Eine FERTIGE Artikelnummer pruefen - das Backend bekommt sie gebaut vom
 * Frontend und darf sich darauf nicht verlassen.
 * @returns {{feld: string, fehler: string}|null}
 */
export function pruefeArtikelnummer(artNr) {
  const a = String(artNr ?? '').trim();
  if (!a) return { feld: 'sku', fehler: 'Artikelnummer (sku) fehlt - ohne sie wird nicht angelegt.' };
  if (a.length > ARTNR_MAX)
    return { feld: 'sku', fehler: `Artikelnummer "${a}" ist ${a.length} Zeichen, erlaubt sind ${ARTNR_MAX}.` };
  const teile = a.split('/');
  if (teile.length !== 2 || !teile[0].trim())
    return { feld: 'sku', fehler: `Artikelnummer "${a}" muss die Form <L-Shop-Nummer>/<Kurzbezeichnung> haben.` };
  const kurzFehler = pruefeKurzbezeichnung(teile[1]);
  if (kurzFehler) return { feld: 'sku', fehler: kurzFehler.fehler };
  return null;
}

// Ein Attribut kann in drei Schreibweisen ankommen: {value} aus dem Frontend,
// {option} aus dem WooCommerce-Format, {wert} aus dem Varianten-Reiter.
const attrWert = a => (a == null ? '' : (a.value ?? a.option ?? a.wert ?? ''));

/**
 * Varianten-SKU aus den TATSAECHLICH vorhandenen Achsen, in der Reihenfolge,
 * in der sie ankommen (Varianten-Reiter: E1/V1, E2/V2, E3/V3).
 * Keine Annahme "Farbe dann Groesse", kein Platzhalter fuer fehlende Achsen.
 * Ohne Achsen bleibt es bei der Eltern-SKU.
 */
export function baueVariantenSku(artikelnummer, attrs) {
  const teile = (Array.isArray(attrs) ? attrs : [])
    .map(a => normalisiereTeil(attrWert(a)))
    .filter(Boolean);
  return teile.length ? `${artikelnummer}-${teile.join('-')}` : String(artikelnummer ?? '');
}

/**
 * Alle Varianten-SKUs bauen und dabei pruefen: Laenge und Dubletten.
 * Die Dublettenpruefung passiert VOR dem Push - WooCommerce wuerde sonst
 * mitten im Anlegen abbrechen und ein halb angelegtes Produkt hinterlassen.
 *
 * @returns {{skus: string[]}|{feld: string, fehler: string}}
 */
export function baueVariantenSkus(artikelnummer, varianten) {
  const skus = [];
  const gesehen = new Map();
  const liste = Array.isArray(varianten) ? varianten : [];

  for (let i = 0; i < liste.length; i++) {
    const v = liste[i] ?? {};
    const sku = baueVariantenSku(artikelnummer, v.attrs ?? v.attributes);

    if (sku.length > SKU_MAX) return {
      feld:  'sku',
      fehler: `Varianten-SKU "${sku}" ist ${sku.length} Zeichen, erlaubt sind ${SKU_MAX}. Artikelnummer kuerzen.`,
    };
    if (gesehen.has(sku)) return {
      feld:  'sku',
      fehler: `Varianten ${gesehen.get(sku) + 1} und ${i + 1} ergeben dieselbe SKU "${sku}".`,
    };

    gesehen.set(sku, i);
    skus.push(sku);
  }
  return { skus };
}
