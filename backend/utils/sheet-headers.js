// Zentrale Auflösung von Sheet-Spalten über den Header-Namen.
//
// Zwei Regeln, die hier an genau einer Stelle stehen:
//  1. Verglichen wird EXAKT auf dem normalisierten Namen, nie als Teilstring.
//     Ein Teilstring-Match würde "Artikelnummer" in "L-Shop-Artikelnummer"
//     finden und still die falsche Spalte lesen.
//  2. Ein Pflicht-Header, der fehlt, wirft. Ohne das läuft findIndex auf -1,
//     row[-1] auf undefined und `?? ''` auf einen leeren String – der Endpunkt
//     antwortet mit 200 und leeren Feldern, was niemand bemerkt.

export function normHeader(s) {
  return String(s ?? '').trim().toLowerCase().replace(/[\s\-_]+/g, '');
}

export class MissingHeaderError extends Error {
  constructor(names, context, headers) {
    const wanted = Array.isArray(names) ? names.join('" / "') : names;
    super(
      `Spalte "${wanted}" fehlt in der Kopfzeile (${context}). ` +
      `Gefundene Spalten: ${(headers ?? []).filter(Boolean).join(', ') || '(keine)'}`
    );
    this.name    = 'MissingHeaderError';
    this.status  = 500;
    this.header  = names;
    this.context = context;
  }
}

// Index oder -1. Für optionale Spalten.
export function findHeader(headers, name) {
  const target = normHeader(name);
  if (!target) return -1;
  return (headers ?? []).findIndex(h => normHeader(h) === target);
}

// Index oder MissingHeaderError. Für Pflichtspalten.
export function requireHeader(headers, name, context) {
  const idx = findHeader(headers, name);
  if (idx < 0) throw new MissingHeaderError(name, context, headers);
  return idx;
}

// Erster Treffer aus mehreren erlaubten Schreibweisen, oder -1.
export function findHeaderAny(headers, names) {
  for (const name of names) {
    const idx = findHeader(headers, name);
    if (idx >= 0) return idx;
  }
  return -1;
}

// Erster Treffer aus mehreren erlaubten Schreibweisen (z.B. "SSOT-ID" oder "ID").
export function requireHeaderAny(headers, names, context) {
  for (const name of names) {
    const idx = findHeader(headers, name);
    if (idx >= 0) return idx;
  }
  throw new MissingHeaderError(names, context, headers);
}
