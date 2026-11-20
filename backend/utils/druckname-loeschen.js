// SA4: Drucknamen (Auftrag_Positionen.Druckname) leeren - 12 Monate nach Abschluss des Auftrags (bezahlt bzw. storniert)
// und bei der DSGVO-Sperre des Kunden. Reine Logik; Lesen/Schreiben in lib/auftraege.js. Ausgaben nur Nummern, nie Namen.
// Gemeinsamer Lauf mit den Rueckennamen (FIX4 D2) kann diese Funktion direkt aufrufen.

export const DRUCKNAME_MONATE = 12;

const t = v => String(v ?? '').trim();

/** Tag JJJJ-MM-TT (oder ISO) -> Date (UTC Mitternacht); sonst null. */
function tag(v) {
  const m = t(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}` ? d : null;
}

/** Abschluss eines Auftrags: { art: 'bezahlt'|'storniert', am: Date } oder null (offen bzw. ohne Datum). */
export function abschlussVon(auftrag) {
  if (t(auftrag?.Status) === 'storniert') return tag(auftrag.Storniert_Am) ? { art: 'storniert', am: tag(auftrag.Storniert_Am) } : null;
  if (t(auftrag?.Status) === 'bezahlt') return tag(auftrag.Bezahlt_Am) ? { art: 'bezahlt', am: tag(auftrag.Bezahlt_Am) } : null;
  return null;
}

/** Stichtag: heute minus `monate` Kalendermonate (UTC-Tag). */
export function stichtag(jetzt, monate = DRUCKNAME_MONATE) {
  const d = new Date(jetzt);
  const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monate, d.getUTCDate()));
  return s;
}

/**
 * Welche Druckname-Zellen werden geleert?
 * @param {object} o
 * @param {object[]} o.auftraege  Zeilen Auftraege (Auftrag_Nr, Kunden_Nr, Status, Bezahlt_Am, Storniert_Am)
 * @param {object[]} o.positionen Zeilen Auftrag_Positionen (_zeile, Position_ID, Auftrag_Nr, Druckname)
 * @param {Date|string} [o.jetzt]
 * @param {string} [o.kundenNr]   DSGVO: alle Auftraege dieses Kunden, ohne Frist
 * @returns {{ leeren: {zeile:number, positionId:string, auftragNr:string}[], zaehler: {abgeschlossenJung:number, offen:number, ohneDatum:number} }}
 */
export function drucknameLoeschPlan({ auftraege, positionen, jetzt = new Date(), kundenNr = '', monate = DRUCKNAME_MONATE } = {}) {
  const grenze = stichtag(jetzt, monate);
  const au = new Map((auftraege ?? []).map(a => [t(a.Auftrag_Nr), a]));
  const leeren = [];
  const zaehler = { abgeschlossenJung: 0, offen: 0, ohneDatum: 0 };
  for (const p of positionen ?? []) {
    if (!t(p.Druckname)) continue;
    const a = au.get(t(p.Auftrag_Nr));
    const eintrag = { zeile: p._zeile, positionId: t(p.Position_ID), auftragNr: t(p.Auftrag_Nr) };
    if (kundenNr) {
      if (a && t(a.Kunden_Nr) === t(kundenNr)) leeren.push(eintrag);
      continue;
    }
    if (!a || !['bezahlt', 'storniert'].includes(t(a.Status))) { zaehler.offen++; continue; }
    const ab = abschlussVon(a);
    if (!ab) { zaehler.ohneDatum++; continue; }
    if (ab.am <= grenze) leeren.push(eintrag);
    else zaehler.abgeschlossenJung++;
  }
  return { leeren, zaehler };
}
