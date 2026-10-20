// Kalendertage in Europe/Berlin fuer das Dashboard (GET /api/woocommerce/stats).
//
// Cloud Run laeuft in UTC; "heute" nach Serverzeit zaehlte bis 01:00/02:00
// deutscher Zeit noch den Vortag. WooCommerce liefert date_created und wertet
// after in Ortszeit des Shops aus (Europe/Berlin, wie lib/trikotSync.js) -
// deshalb rechnen wir mit Berliner Datumsstrings "YYYY-MM-DD".

// Uhr des Dashboards. Tests setzen uhr.jetzt fest; im Code steht kein Datum.
export const uhr = { jetzt: () => new Date() };

// "YYYY-MM-DD" des Zeitpunkts in Berlin.
export const berlinDatum = d => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

// Die letzten `anzahl` Berliner Kalendertage bis einschliesslich heute, aufsteigend.
export function letzteTageBerlin(anzahl, jetzt = uhr.jetzt()) {
  const [y, m, d] = berlinDatum(jetzt).split('-').map(Number);
  return Array.from({ length: anzahl }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d - (anzahl - 1 - i))).toISOString().slice(0, 10));
}

// Kurzer Wochentag ("Mo.") zu "YYYY-MM-DD".
export const wochentagKurz = ymd =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'UTC' });
