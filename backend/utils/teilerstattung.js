// Teilerstattungen (NB1 Teil A) – reine Logik, ohne WooCommerce- oder Sheets-Zugriff.
//
// Eingabe je Bestellung:
//   items:   Positionen der Bestellung { id, product_id, variation_id, quantity }
//   refunds: Erstattungen { id, lines: [{ product_id, variation_id, quantity }] }
//            quantity positiv (WooCommerce liefert negative Mengen; hier wird abs() genommen).
//            Ohne lines = Erstattung nur mit Betrag (kein Positionsbezug).
//   gebucht: Map positionId -> bereits gegenbuchte Menge (aus den Verkaufszeilen)
//   gebuchteRefunds: Set "refundId|positionId" fuer schon gebuchte Erstattungen (Dubletten-Schutz)
//
// Zuordnung: Erstattungs-Position -> Bestell-Position ueber product_id + variation_id.
// Gibt es zu einer Erstattungs-Position mehrere Bestell-Positionen, wird NICHT geraten:
// der Fall geht als "mehrdeutig" in die Hinweise.
// Erstattungen ohne Positionsbezug werden nur als Hinweis gemeldet, nie gebucht.

const schluessel = (refundId, positionId) => `${refundId}|${positionId}`;

/**
 * @returns {{
 *   buchungen: Array<{ refundId, positionId, orderItem, menge, faktor }>,
 *   hinweise:  Array<{ refundId, grund: 'ohne_position' | 'mehrdeutig' | 'unbekannt', produktId?, variationId? }>
 * }}
 */
export function berechneTeilerstattung({ items = [], refunds = [], gebucht = new Map(), gebuchteRefunds = new Set() }) {
  const buchungen = [];
  const hinweise = [];
  // Verbleibende Menge je Bestell-Position (Original minus schon gegenbucht minus in diesem Lauf vergeben).
  const rest = new Map(items.map(i => [String(i.id), Number(i.quantity) - Number(gebucht.get(String(i.id)) ?? 0)]));
  const key = i => `${i.product_id ?? ''}|${Number(i.variation_id || 0)}`;

  for (const r of refunds) {
    const refundId = String(r.id);
    if (!r.lines || r.lines.length === 0) {
      hinweise.push({ refundId, grund: 'ohne_position' });
      continue;
    }
    for (const line of r.lines) {
      const k = `${line.product_id ?? ''}|${Number(line.variation_id || 0)}`;
      const treffer = items.filter(i => key(i) === k);
      if (treffer.length === 0) {
        hinweise.push({ refundId, grund: 'unbekannt', produktId: line.product_id, variationId: line.variation_id || 0 });
        continue;
      }
      if (treffer.length > 1) {
        hinweise.push({ refundId, grund: 'mehrdeutig', produktId: line.product_id, variationId: line.variation_id || 0 });
        continue;
      }
      const item = treffer[0];
      const positionId = String(item.id);
      if (gebuchteRefunds.has(schluessel(refundId, positionId))) continue;   // Dubletten-Schutz
      const menge = Math.min(Math.abs(Number(line.quantity)), Math.max(0, rest.get(positionId) ?? 0));
      if (menge <= 0) continue;
      rest.set(positionId, rest.get(positionId) - menge);
      const orig = Number(item.quantity) || 1;
      buchungen.push({ refundId, positionId, orderItem: item, menge, faktor: menge / orig });
    }
  }
  return { buchungen, hinweise };
}
