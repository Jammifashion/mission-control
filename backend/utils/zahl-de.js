// Zahl aus einer Sheet-Zelle oder einem Shop-Wert lesen.
// Mit Komma = deutsches Format: Punkte sind Tausendertrenner ("1.234,50" -> 1234.5).
// Ohne Komma bleibt der Punkt Dezimalpunkt (Shop-Werte wie "16.81", Zahlen aus UNFORMATTED-Lesungen).
// Leerzeichen und Euro-Zeichen werden ignoriert. Ergebnis wie parseFloat (NaN, wenn keine Zahl).
export function parseDeZahl(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[\s €]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return parseFloat(s);
}
