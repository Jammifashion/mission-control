// Pure sync-logic helpers – no external dependencies, fully testable.

export function toFloat(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = parseFloat(val.toString().replace(',', '.'));
  return Number.isNaN(n) ? fallback : n;
}

export function toDE(date) {
  const d = new Date(date);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
}

export const WC_STATES_VERKAUF = ['processing', 'completed', 'on-hold'];
export const WC_STATES_STORNO  = ['refunded', 'cancelled'];
export const STORNO_MARKER     = 'Storniert/Rückerstattet';

/**
 * Liegt eine Bestellung vor dem Vertragsbeginn des Partners (Spalte Vertrag-ab)?
 *
 * Verglichen wird der Kalendertag aus date_created (WC liefert Shop-Ortszeit
 * ohne Zeitzone, "2024-12-31T23:10:00" ist also der 31.12.). Bestellungen am
 * Stichtag selbst gehoeren zur Vereinbarung. Ohne Vertragsbeginn (null) gibt
 * es keine Grenze.
 */
export function vorVertragsbeginn(dateCreated, beginn) {
  if (!beginn) return false;
  const m = String(dateCreated ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) < beginn.getTime();
}

/**
 * Bestellungen, fuer die der Sync Verkaufszeilen schreibt.
 *
 * Neben den laufenden Verkaeufen (processing/completed/on-hold) auch
 * Bestellungen, die beim ersten Sync schon storniert/erstattet sind. Frueher
 * entstand fuer die gar nichts: keine Verkaufszeile, also auch keine
 * Gegenbuchung, weil buildStornoRows nur vorhandene Zeilen negiert. Nach
 * einem Neu-Sync fehlten damit alle Paare, die es gab, solange der Sync
 * rechtzeitig lief. Jetzt entstehen Verkauf und Gegenbuchung in derselben
 * Runde (Summe 0).
 *
 * Nur bezahlte Bestellungen (date_paid gesetzt): eine nie bezahlte, abgebrochene
 * Bestellung war nie ein Verkauf. Und nur nach afterParam angelegte - die
 * Stornos werden voll-historisch geladen, der Verkaufszeitraum aber nicht.
 */
export function ordersFuerVerkaufszeilen(orders, stornoOrders, afterParam) {
  const ab = afterParam ? new Date(afterParam) : null;
  const nachgeholt = (stornoOrders ?? []).filter(o =>
    o.date_paid && (!ab || new Date(o.date_created) > ab));
  return [...(orders ?? []), ...nachgeholt];
}

/**
 * Erzeugt negative Gegeneinträge für bestehende Verkaufs-Zeilen, deren Order in WC
 * auf refunded/cancelled steht.
 *
 * Alle Spalten werden über vh() aus der Kopfzeile aufgelöst - eine eingefügte
 * Spalte verschiebt die Gegenbuchung damit nicht mehr. Fehlt eine Pflichtspalte,
 * bricht die Funktion ab, statt in falsche Zellen zu schreiben.
 *
 * Negiert werden: Stückzahl, VK-Preis-Brutto, Lizenzgebühr, Gewinn-netto,
 * Lizenz-Anteil, Porto-Saldo, Anteil-Brutto.
 */
export function buildStornoRows(vRows, vh, stornoOrders, partnerFilter) {
  const ordIdx = vh('Order-ID');
  const artIdx = vh('Artikelnummer');
  const varIdx = vh('Variante');
  const pIdx   = vh('Partner-ID');
  const varKey = v => (v === '' || v === null || v === undefined) ? '0' : String(v);

  const refundDate = new Map(
    stornoOrders.map(o => [String(o.id), toDE(new Date(o.date_modified || o.date_created))])
  );

  // Alle Spalten ueber die Kopfzeile aufloesen, nicht nur die vier oben.
  // Fest verdrahtete Indizes und vh()-Lookups nebeneinander halten nur,
  // solange die Kopfzeile unveraendert bleibt: kommt eine Spalte dazu, wandern
  // die Lookups mit, die Zahlen nicht - die Gegenbuchung negiert dann fremde
  // Zellen, Status und Marker landen falsch, und die Duplikaterkennung liest
  // ins Leere, wodurch Stornos doppelt gebucht werden.
  const pflicht = (name) => {
    const i = vh(name);
    if (i === -1) {
      throw Object.assign(
        new Error(`Spalte "${name}" fehlt in der Kopfzeile der Verkaeufe - `
                + 'Storno-Gegenbuchung abgebrochen, um keine falschen Zellen zu schreiben.'),
        { status: 500 },
      );
    }
    return i;
  };

  // Betragsspalten, die in der Gegenbuchung negiert werden.
  const NEG_COLS = [
    'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr',
    'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto',
  ].map(pflicht);
  const STATUS_COL = pflicht('Status');
  const DATE_COL   = pflicht('Datum');
  const STORNO_COL = pflicht('Storno-Status');

  // Breite der Gegenbuchung: so weit, wie die Kopfzeile reicht.
  const BREITE = Math.max(
    STORNO_COL, STATUS_COL, DATE_COL, ordIdx, artIdx, varIdx, pIdx, ...NEG_COLS,
  ) + 1;

  const stornoDone = new Set();
  for (const r of vRows) {
    if ((r[STORNO_COL] ?? '') !== '')
      stornoDone.add(`${r[ordIdx]}|${r[artIdx]}|${varKey(r[varIdx])}|${r[pIdx]}`);
  }

  const out = [];
  for (const r of vRows) {
    const oid = String(r[ordIdx] ?? '');
    if (!refundDate.has(oid)) continue;
    if ((r[STORNO_COL] ?? '') !== '') continue;
    if (partnerFilter && !partnerFilter.has(r[pIdx])) continue;

    const dupKey = `${r[ordIdx]}|${r[artIdx]}|${varKey(r[varIdx])}|${r[pIdx]}`;
    if (stornoDone.has(dupKey)) continue;
    stornoDone.add(dupKey);

    const counter = [];
    for (let i = 0; i < BREITE; i++) {
      let v = r[i] ?? '';
      if (NEG_COLS.includes(i) && v !== '' && v !== null) v = -toFloat(v);
      counter[i] = v;
    }
    counter[DATE_COL]   = refundDate.get(oid) || r[DATE_COL] || toDE(new Date());
    counter[STATUS_COL] = 'offen';
    counter[STORNO_COL] = STORNO_MARKER;
    out.push(counter);
  }
  return out;
}
