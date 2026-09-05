// Zeilen fuer die Erfassungsmaske bauen.
//
// Kernunterscheidung: "Feld nicht im Body" ist etwas anderes als "Feld leer im
// Body". lookupField() liefert dafuer undefined statt '' – erst der Aufrufer
// entscheidet, ob daraus ein Leerwert oder der Bestandswert wird.

import { normHeader } from './sheet-headers.js';

// Body auf die Sheet-Feldnamen normalisieren. defaults=false liefert nur das,
// was der Body wirklich enthaelt (fuer mergeRow).
export function flattenBody(body, ssotId, { defaults = true } = {}) {
  const flat = { ...body };
  if (ssotId !== undefined && ssotId !== null) {
    flat['SSOT-ID'] = ssotId;
    flat['ID']      = ssotId;
  }
  if (defaults) {
    flat['Status Shop'] = body['Status Shop'] || body.statusShop || '';
    flat['SEO_Status']  = body['SEO_Status']  || body.seoStatus  || '';
    flat['Produkt-ID']  = body['Produkt-ID']  || body.produktId  || '';
    flat['Datum']       = body['Datum'] || new Date().toLocaleDateString('de-DE');
  }
  delete flat.varianten;
  delete flat.row;
  return flat;
}

// Wert zu einem Header aus dem Body holen. undefined heisst: der Body sagt
// nichts dazu. Das ist bewusst von '' (ausdruecklich leer gesetzt) getrennt.
export function lookupField(header, flat) {
  if (flat[header] !== undefined) return String(flat[header]);
  const hn  = normHeader(header);
  const hit = Object.entries(flat).find(([k]) => normHeader(k) === hn);
  return hit ? String(hit[1]) : undefined;
}

// Neue Zeile: fehlende Header werden zu ''. Fuer append korrekt, da es keinen
// Bestandswert gibt, den man verlieren koennte.
export function buildRow(headers, body, ssotId) {
  const flat = flattenBody(body, ssotId);
  return headers.map(h => lookupField(h, flat) ?? '');
}

// Overwrite: jeder Header, zu dem der Body nichts sagt, behaelt seinen
// Bestandswert aus currentRow. Leeren geht nur noch ausdruecklich ueber einen
// leeren String im Body. Schuetzt Lieferzeit, Produkt-ID und die B-Spalten.
export function mergeRow(headers, body, ssotId, currentRow) {
  const flat = flattenBody(body, ssotId, { defaults: false });
  return headers.map((h, i) => lookupField(h, flat) ?? (currentRow[i] ?? ''));
}
