// AS1 (Inhaber 28.11.): Auftrag stornieren raeumt L-Shop- und DTF-Korb mit auf - reine Logik, Schreiben in lib/auftraege.js.
//
// Regeln:
// - Storno: alle OFFENEN Zeilen des Auftrags in beiden Koerben -> abgewählt, Grund "Auftrag storniert" (eine Zeichenkette in beiden Koerben,
//   nicht in der Hand-Auswahl - nur dieser Weg setzt sie, darum erkennt der Rueckweg sie sicher).
// - Schon bestellte Zeilen (L-Shop bestellt, DTF bestellt) bleiben; sie kommen als Hinweis zurueck ("bei Ankunft ins Lager?").
// - Storno zuruecknehmen: genau die Zeilen mit diesem Grund, die noch abgewählt sind -> offen.
// - Position entfernen (BS4/KS8) nutzt dieselbe Funktion fuer EINE Position mit Grund "im Auftrag entfernt" (L-Shop seit KS8, neu DTF).
// - Lager: nie automatisch; Abgaenge des Auftrags werden nur gezaehlt (Hinweis "zurück ins Lager?").

import { GRUND_IM_AUFTRAG_ENTFERNT } from './korb-logic.js';   // KS8

const t = v => String(v ?? '').trim();

export const GRUND_AUFTRAG_STORNIERT = 'Auftrag storniert';
export { GRUND_IM_AUFTRAG_ENTFERNT };
const OFFEN = 'offen', ABGEWAEHLT = 'abgewählt';

/**
 * Zeilen eines Auftrags (bzw. einer Position) in beiden Koerben -> Aenderungen + Hinweise.
 * L-Shop: Korb_Schluessel der Positionen; ohne Position zusaetzlich eigene Zeilen mit Referenz = Auftrag_Nr.
 * DTF: Quelle AU + Nummer (+ Position).
 * @param {'storno'|'zurueck'} o.richtung
 * @returns {{ korb: {zeile, schluessel, werte}[], dtf: {zeile, schluessel, werte}[], korbBestellt: {schluessel, status}[], dtfBestellt: {schluessel, status}[],
 *   lagerTeile: number, lagerPositionen: string[] }}
 */
export function koerbePlan({ auftrag, positionen = [], korbZeilen = [], dtfZeilen = [], richtung = 'storno', positionId = '', grund = GRUND_AUFTRAG_STORNIERT, jetzt }) {
  const nr = t(auftrag?.Auftrag_Nr);
  const iso = new Date(jetzt).toISOString();
  const pos = (positionen ?? []).filter(p => t(p.Auftrag_Nr) === nr && (!positionId || t(p.Position_ID) === t(positionId)));
  const schluessel = new Set(pos.map(p => t(p.Korb_Schluessel)).filter(Boolean));
  const kZeilen = (korbZeilen ?? []).filter(z => schluessel.has(t(z.Schluessel)) || (!positionId && t(z.Herkunft) === 'eigen' && t(z.Referenz) === nr));
  const dZeilen = (dtfZeilen ?? []).filter(z => t(z.Quelle) === 'AU' && t(z.Nummer) === nr && (!positionId || t(z.Position) === t(positionId)));
  const aendern = (zeilen, extra = {}) => {
    const aus = [], bestellt = [];
    for (const z of zeilen) {
      const st = t(z.Status), s = t(z.Schluessel);
      if (richtung === 'storno') {
        if (st === OFFEN) aus.push({ zeile: z._zeile, schluessel: s, werte: { Status: ABGEWAEHLT, Grund: grund, Status_Datum: iso, Stand: iso, ...extra } });
        else if (st !== ABGEWAEHLT) bestellt.push({ schluessel: s, status: st });
      } else if (st === ABGEWAEHLT && t(z.Grund) === grund) {
        aus.push({ zeile: z._zeile, schluessel: s, werte: { Status: OFFEN, Grund: '', Status_Datum: iso, Stand: iso, ...extra } });
      }
    }
    return { aus, bestellt };
  };
  const k = aendern(kZeilen);
  const d = aendern(dZeilen);
  const lager = pos.filter(p => t(p.Lager_Buchung) && !t(p.Entfernt));
  return {
    korb: k.aus, dtf: d.aus,
    // "geliefert"/"Lager" sind schon bei uns - als Hinweis nur, was noch unterwegs ist bzw. bei L-Shop/Nico liegt
    korbBestellt: k.bestellt.filter(x => x.status !== 'geliefert'), dtfBestellt: d.bestellt.filter(x => x.status !== 'geliefert'),
    lagerTeile: lager.reduce((s, p) => s + (Number(t(p.Menge)) || 0), 0), lagerPositionen: lager.map(p => t(p.Position_ID)),
  };
}

/** Kurztext fuer die Rueckfrage (Zahlen, keine Namen). */
export function stornoText(plan) {
  const teile = [];
  if (plan.korb.length) teile.push(`${plan.korb.length} Zeile${plan.korb.length === 1 ? '' : 'n'} im L-Shop-Korb`);
  if (plan.dtf.length) teile.push(`${plan.dtf.length} Zeile${plan.dtf.length === 1 ? '' : 'n'} im DTF-Korb`);
  return teile.length ? `${teile.join(' und ')} werden abgewählt („${GRUND_AUFTRAG_STORNIERT}“).` : 'Keine offenen Zeilen in den Körben.';
}
