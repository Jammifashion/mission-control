// Teilerstattungen (NB1 Teil A) – reine Logik, ohne WooCommerce- oder Sheets-Zugriff.
//
// Eingabe je Bestellung:
//   items:   Positionen der Bestellung { id, product_id, variation_id, quantity }
//   refunds: Erstattungen { id, lines: [{ product_id, variation_id, quantity, total }], versand }
//            quantity/total wie von WooCommerce (negativ) oder positiv - es zaehlt der Betrag (abs).
//            lines leer = Erstattung nur mit Betrag (kein Positionsbezug).
//            versand = erstatteter Versand (Betrag, > 0 = Versand erstattet).
//   gebucht: Map positionId -> bereits gegengebuchte Menge (aus den Verkaufszeilen)
//   gebuchteRefunds: Set "refundId|positionId" fuer schon gebuchte Erstattungen (Dubletten-Schutz)
//
// Zuordnung: Erstattungs-Position -> Bestell-Position ueber product_id + variation_id.
// Nichts wird geraten - jeder Fall, der nicht eindeutig eine Menge einer Position erstattet,
// geht als Hinweis heraus und wird nicht gebucht:
//   ohne_position      Erstattung ohne Positionen (Kulanz, nur Betrag)
//   versand            Versand erstattet (FP: Porto-Einnahme mindern, Lizenz: pruefen)
//   betrag_ohne_menge  Position mit Betrag, aber Menge 0 (Teilbetrag einer Position)
//   unbekannt          Produkt/Variante nicht in der Bestellung
//   mehrdeutig         Produkt/Variante mehrfach in der Bestellung
//   mehr_als_rest      mehr Menge erstattet als noch offen (gebucht wird nur der Rest)

export const refundSchluessel = (refundId, positionId) => `${refundId}|${positionId}`;

const zahl = v => { const n = Math.abs(Number(String(v ?? '').replace(',', '.'))); return Number.isFinite(n) ? n : 0; };
const kombi = (productId, variationId) => `${productId ?? ''}|${Number(variationId || 0)}`;

/**
 * @returns {{
 *   buchungen: Array<{ refundId: string, positionId: string, orderItem: object, menge: number, faktor: number }>,
 *   hinweise:  Array<{ refundId: string, grund: string, produktId?, variationId?, menge? }>
 * }}
 */
export function berechneTeilerstattung({ items = [], refunds = [], gebucht = new Map(), gebuchteRefunds = new Set() }) {
  const buchungen = [];
  const hinweise = [];
  // Offene Menge je Bestell-Position: Original minus schon gegengebucht minus in diesem Lauf vergeben.
  const rest = new Map(items.map(i => [String(i.id), Math.max(0, Number(i.quantity) - Number(gebucht.get(String(i.id)) ?? 0))]));

  for (const r of refunds) {
    const refundId = String(r.id);
    if (zahl(r.versand) > 0) hinweise.push({ refundId, grund: 'versand' });
    if (!r.lines || r.lines.length === 0) {
      if (!(zahl(r.versand) > 0)) hinweise.push({ refundId, grund: 'ohne_position' });
      continue;
    }
    // Mehrere Zeilen derselben Position in EINER Erstattung zusammenfassen (eine Buchung je Schluessel).
    const jePosition = new Map();
    for (const line of r.lines) {
      const k = kombi(line.product_id, line.variation_id);
      const treffer = items.filter(i => kombi(i.product_id, i.variation_id) === k);
      const info = { refundId, produktId: line.product_id, variationId: Number(line.variation_id || 0) };
      if (treffer.length === 0) { hinweise.push({ ...info, grund: 'unbekannt' }); continue; }
      if (treffer.length > 1)   { hinweise.push({ ...info, grund: 'mehrdeutig' }); continue; }
      const menge = zahl(line.quantity);
      if (menge === 0) {
        if (zahl(line.total) > 0) hinweise.push({ ...info, grund: 'betrag_ohne_menge' });
        continue;
      }
      const item = treffer[0];
      const pid = String(item.id);
      const vorher = jePosition.get(pid);
      jePosition.set(pid, { item, menge: (vorher?.menge ?? 0) + menge, info });
    }
    for (const [positionId, { item, menge: gewollt, info }] of jePosition) {
      if (gebuchteRefunds.has(refundSchluessel(refundId, positionId))) continue;   // Dubletten-Schutz
      const offen = rest.get(positionId) ?? 0;
      const menge = Math.min(gewollt, offen);
      if (gewollt > offen) hinweise.push({ ...info, grund: 'mehr_als_rest', menge: gewollt - offen });
      if (menge <= 0) continue;
      rest.set(positionId, offen - menge);
      const orig = Number(item.quantity) || 1;
      buchungen.push({ refundId, positionId, orderItem: item, menge, faktor: menge / orig });
    }
  }
  return { buchungen, hinweise };
}
