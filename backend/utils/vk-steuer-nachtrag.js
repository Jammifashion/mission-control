// GT1 Punkt 7: VK-Steuer fuer OFFENE FP_Verkaeufe-Zeilen nachtragen (Inhaber 22.11.: neue Rundung ab den naechsten Abrechnungen) - reine Logik.
// Abgerechnete Zeilen werden nie angefasst (freigegebene/bezahlte Abrechnungen und Gutschriften bleiben, wie sie sind).
// Steuer je Zeile = Steuer der Shop-Position anteilig zum VK-Netto der Zeile (Vorzeichen wie VK-Netto: Storno/Erstattung negativ),
// gefunden NUR ueber die Positions-ID (Spalte AA). Ohne Positions-ID, ohne Shop-Position oder mit unklarem Betrag: nichts (Liste "offen").

const t = v => String(v ?? '').trim();
const zahl = v => { const s = t(v); if (!s) return 0; const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return Number.isFinite(n) ? n : 0; };
const rund = n => Math.round(n * 100) / 100;

/**
 * @param {{ kopf: string[], zeilen: any[][], bestellungen: Map<string, { line_items: object[] }> }} e
 *   zeilen: Rohzeilen ohne Kopf, je Zeile _zeile (Sheet-Zeilennummer)
 * @returns {{ plan: [{ zeile, wert, bestellung }], ohnePosition: number, ohneShop: number, schonDa: number, nichtOffen: number }}
 */
export function vkSteuerPlan({ kopf, zeilen, bestellungen }) {
  const h = n => kopf.indexOf(n);
  const iSt = h('Status Abrechnung'), iVk = h('VK-Netto'), iPos = h('Positions-ID'), iO = h('WC-Bestellnummer'), iSteuer = h('VK-Steuer');
  if ([iSt, iVk, iPos, iO].some(i => i === -1)) throw new Error('FP_Verkäufe: Spalten Status Abrechnung, VK-Netto, Positions-ID, WC-Bestellnummer nötig.');
  const erg = { plan: [], ohnePosition: 0, ohneShop: 0, schonDa: 0, nichtOffen: 0 };
  for (const r of zeilen) {
    if (t(r[iSt]) !== 'offen') { erg.nichtOffen++; continue; }
    if (iSteuer !== -1 && t(r[iSteuer]) !== '') { erg.schonDa++; continue; }
    const pos = t(r[iPos]);
    if (!pos) { erg.ohnePosition++; continue; }
    const li = bestellungen.get(t(r[iO]))?.line_items?.find(x => String(x.id) === pos);
    if (!li) { erg.ohneShop++; continue; }
    const total = zahl(li.total), steuer = zahl(li.total_tax), vk = zahl(r[iVk]);
    const wert = total === 0 ? 0 : rund(steuer * (vk / total));
    erg.plan.push({ zeile: r._zeile, wert: wert === 0 ? 0 : wert, bestellung: t(r[iO]) });
  }
  return erg;
}
