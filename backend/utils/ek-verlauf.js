// PR1 (Inhaber 22.11.2026): EK-Verlauf je L-Shop-ArticleNr und "EK damals" einer Auftragsposition - reine Logik.
//
// LShop_Modelle kennt nur den HEUTIGEN EK (10CartonsPrice). Das Stammdaten-Update ueberschreibt ihn. Darum schreibt das Update ab PR1 je
// Preisaenderung eine Zeile in den SSOT-Reiter LShop_EK_Verlauf (ArticleNr | EK_alt | EK_neu | Geaendert_Am | Quelle_Datei) - nie rueckwirkend
// EK in Auftraegen oder Partner-Reitern aendern.
//
// EK an einem Tag (Auftragsdatum):
//   1. Gibt es Preisaenderungen NACH dem Tag: EK_alt der fruehesten davon (so teuer war es an dem Tag).
//   2. Sonst, wenn die letzte inhaltliche Aenderung der Zeile (LShop_Modelle.Stand) am oder vor dem Tag lag: der heutige EK.
//   3. Sonst unbekannt (die Zeile wurde danach geaendert, ohne dass ein Verlauf da war - vor PR1).
// Nur Anzeige in MC (Marge-Vergleich, Leseliste); EK nie in Bestellseite, Portal, Lexware, Chat, Log.

export const TAB_EK_VERLAUF = 'LShop_EK_Verlauf';
export const EK_VERLAUF_SPALTEN = ['ArticleNr', 'EK_alt', 'EK_neu', 'Geaendert_Am', 'Quelle_Datei'];

const t = v => String(v ?? '').trim();
/** "TT.MM.JJJJ", "JJJJ-MM-TT…" oder Sheets-Seriennummer -> "JJJJ-MM-TT" ('' wenn unlesbar). */
export function tagAus(v) {
  const s = t(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 864e5).toISOString().slice(0, 10);
  return '';
}
const zahl = v => { const s = t(v); if (!s) return null; const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return Number.isFinite(n) ? n : null; };

/** Verlauf-Zeilen (Objekte nach Spaltenname) -> Map ArticleNr -> [{ tag, ekAlt, ekNeu }] nach Tag aufsteigend. */
export function verlaufJe(zeilen) {
  const je = new Map();
  for (const z of zeilen ?? []) {
    const nr = t(z.ArticleNr), tag = tagAus(z.Geaendert_Am), ekAlt = zahl(z.EK_alt), ekNeu = zahl(z.EK_neu);
    if (!nr || !tag || ekAlt === null) continue;
    je.set(nr, [...(je.get(nr) ?? []), { tag, ekAlt, ekNeu }]);
  }
  for (const l of je.values()) l.sort((a, b) => a.tag.localeCompare(b.tag));
  return je;
}

/**
 * @param {{ tag: string, ekHeute: number|null, geaendertAm: string, aenderungen: {tag, ekAlt}[] }} e
 * @returns {{ ek: number|null, quelle: 'verlauf'|'heute'|'unbekannt' }}
 */
export function ekZumTag({ tag, ekHeute, geaendertAm, aenderungen = [] }) {
  const d = tagAus(tag);
  if (!d) return { ek: null, quelle: 'unbekannt' };
  const danach = aenderungen.find(x => x.tag > d);
  if (danach) return { ek: danach.ekAlt, quelle: 'verlauf' };
  const g = tagAus(geaendertAm);
  if (ekHeute !== null && ekHeute !== undefined && g && g <= d) return { ek: ekHeute, quelle: 'heute' };
  return { ek: null, quelle: 'unbekannt' };
}

/** Preisaenderungen eines Stammdaten-Laufs -> Verlauf-Zeilen (nur echte Aenderungen mit altem und neuem Preis). */
export function verlaufZeilenAus(aenderungen, { tag, datei }) {
  return (aenderungen ?? []).filter(a => zahl(a.alt) !== null && zahl(a.neu) !== null && zahl(a.alt) !== zahl(a.neu))
    .map(a => [t(a.articleNr), zahl(a.alt), zahl(a.neu), tag, t(datei)]);
}
