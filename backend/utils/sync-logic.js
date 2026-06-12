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
 * Erzeugt negative Gegeneinträge für bestehende Verkaufs-Zeilen, deren Order in WC
 * auf refunded/cancelled steht. Spalten-Layout fix (identisch zum Append A:N).
 * NEG_COLS: Stückzahl(5), VK(6), Lizenz(7), gewinn(10), lizenzAnteil(11), portoSaldo(12), brutto(13)
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

  const NEG_COLS   = [5, 6, 7, 10, 11, 12, 13];
  const STATUS_COL = 8;
  const DATE_COL   = 1;
  const STORNO_COL = 14;

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
    for (let i = 0; i < 14; i++) {
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
