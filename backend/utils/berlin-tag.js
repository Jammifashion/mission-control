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

// GT1 C4 (Inhaber 22.11.): Geld-Routen rechnen Tage, Jahre und "heute" in Europe/Berlin, nie in Server-Zeit (Cloud Run = UTC).
/** Heutiger (bzw. jetziger) Tag in Berlin als "TT.MM.JJJJ" (Format der Geld-Reiter). */
export function deHeuteBerlin(jetzt = uhr.jetzt()) {
  const [y, m, d] = berlinDatum(jetzt).split('-');
  return `${d}.${m}.${y}`;
}
/** Jahr in Berlin (Abrechnungs-/Buchungsnummern): 01.01. 00:30 Berlin ist schon das neue Jahr. */
export const berlinJahr = (jetzt = uhr.jetzt()) => Number(berlinDatum(jetzt).slice(0, 4));
/**
 * WooCommerce-Zeit -> Berliner Kalendertag "TT.MM.JJJJ", unabhaengig von der Zeitzone des Servers.
 * date_created/date_modified kommen in Shop-Ortszeit OHNE Zonenangabe ("2026-12-31T23:30:00") - der Tag steht schon im Text.
 * Mit Zone ("...Z", "+01:00", z. B. *_gmt) wird nach Berlin umgerechnet. Leer/unlesbar -> ''.
 */
export function wcTagDE(s) {
  const t = String(s ?? '').trim();
  let ymd = '';
  if (/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+)?$/.test(t)) ymd = t.slice(0, 10);
  else if (t) { const d = new Date(t); if (!Number.isNaN(d.getTime())) ymd = berlinDatum(d); }
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}

// Die letzten `anzahl` Berliner Kalendertage bis einschliesslich heute, aufsteigend.
export function letzteTageBerlin(anzahl, jetzt = uhr.jetzt()) {
  const [y, m, d] = berlinDatum(jetzt).split('-').map(Number);
  return Array.from({ length: anzahl }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d - (anzahl - 1 - i))).toISOString().slice(0, 10));
}

// Kurzer Wochentag ("Mo.") zu "YYYY-MM-DD".
export const wochentagKurz = ymd =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'UTC' });
