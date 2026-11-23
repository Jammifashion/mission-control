// PR1 Teil B: Leseliste "EK gestiegen" - Shop-Artikel, deren Rohling-EK beim letzten L-Shop-Stammdaten-Update um mehr als x % gestiegen ist.
// Reine Logik. NUR LESEN - Preise aendert der Inhaber selbst. Quelle der Aenderung: LShop_EK_Verlauf (PR1, ab dem ersten Update danach).
// VK = Reiter Varianten "Preis" (Shop-Preis brutto, wie ihn die Maske kennt); Marge = (VK netto − EK) / VK netto.
// Festpreis-Partner-Artikel gekennzeichnet (dort entscheidet der Partner ueber den VK), Lizenz-Partner als Filter.

const t = v => String(v ?? '').trim();
const zahl = v => { const s = t(v); if (!s) return null; const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return Number.isFinite(n) ? n : null; };
const rund1 = n => Math.round(n * 10) / 10;
export const PROZENT_STANDARD = 5;

/**
 * @param {object} e
 * @param {Map<string, {tag, ekAlt, ekNeu}[]>} e.verlauf   je ArticleNr (verlaufJe)
 * @param {object[]} e.modelle      LShop_Modelle { articleNr, catalogNr, farbe, groesse, ek }
 * @param {object[]} e.varianten    Varianten { ssot, articleNr, preis, aktiv, wcVariationId }
 * @param {object[]} e.maske        Erfassungsmaske { id, produktId, name, kategorien }
 * @param {Map<string,string>} e.festpreis   Produkt-ID -> FP-Partner
 * @param {Map<string,string>} e.lizenz      Produkt-ID -> Lizenz-Partner
 * @param {number} e.prozent        Schwelle (Standard 5)
 * @param {string} e.seit           JJJJ-MM-TT; leer = Tag der letzten Preisaenderung im Verlauf
 * @param {number} e.mwst           Prozent (fuer VK netto)
 */
export function ekGestiegen({ verlauf, modelle = [], varianten = [], maske = [], festpreis = new Map(), lizenz = new Map(), prozent = PROZENT_STANDARD, seit = '', mwst = 19 }) {
  const alleTage = [...verlauf.values()].flat().map(x => x.tag).sort();
  const ab = t(seit) || alleTage[alleTage.length - 1] || '';
  if (!ab) return { seit: '', prozent, artikel: [], hinweis: 'Noch kein EK-Verlauf – die Liste füllt sich mit dem nächsten L-Shop-Stammdaten-Update.' };
  // je ArticleNr: EK vor dem ersten Wechsel ab "seit" und EK nach dem letzten
  const stieg = new Map();
  for (const [nr, liste] of verlauf) {
    const ab0 = liste.filter(x => x.tag >= ab);
    if (!ab0.length) continue;
    const alt = ab0[0].ekAlt, neu = ab0[ab0.length - 1].ekNeu;
    if (alt === null || neu === null || !(alt > 0)) continue;
    const plus = ((neu - alt) / alt) * 100;
    if (plus > prozent) stieg.set(nr, { alt, neu, plus: rund1(plus) });
  }
  const mod = new Map(modelle.map(m => [t(m.articleNr), m]));
  const produkt = new Map(maske.filter(m => t(m.produktId)).map(m => [t(m.id), m]));
  const je = new Map();
  for (const v of varianten) {
    const nr = t(v.articleNr), s = stieg.get(nr);
    if (!s || String(v.aktiv).toUpperCase() === 'FALSE') continue;
    const m = produkt.get(t(v.ssot));
    if (!m) continue;
    const pid = t(m.produktId);
    const a = je.get(pid) ?? { produktId: pid, name: t(m.name), kategorien: t(m.kategorien), festpreis: festpreis.get(pid) ?? '', lizenz: lizenz.get(pid) ?? '', zeilen: new Map() };
    const vk = zahl(v.preis), vkNetto = vk === null || vk <= 0 ? null : vk / (1 + mwst / 100);
    const md = mod.get(nr) ?? {};
    const key = `${nr}|${vk ?? ''}`;
    if (!a.zeilen.has(key)) {
      a.zeilen.set(key, {
        articleNr: nr, modell: t(md.catalogNr), farbe: t(md.farbe), groesse: t(md.groesse), ekAlt: s.alt, ekNeu: s.neu, plus: s.plus, vk,
        margeAlt: vkNetto ? rund1(((vkNetto - s.alt) / vkNetto) * 100) : null, margeNeu: vkNetto ? rund1(((vkNetto - s.neu) / vkNetto) * 100) : null,
      });
    }
    je.set(pid, a);
  }
  const artikel = [...je.values()].map(a => {
    const zeilen = [...a.zeilen.values()].sort((x, y) => y.plus - x.plus || x.articleNr.localeCompare(y.articleNr));
    return { ...a, zeilen, maxPlus: zeilen[0]?.plus ?? 0, minMargeNeu: Math.min(...zeilen.map(z => z.margeNeu ?? Infinity)) };
  }).map(a => ({ ...a, minMargeNeu: Number.isFinite(a.minMargeNeu) ? a.minMargeNeu : null }))
    .sort((x, y) => y.maxPlus - x.maxPlus || x.name.localeCompare(y.name, 'de'));
  return { seit: ab, prozent, artikel, nummern: stieg.size };
}

/** Text fuer "Liste kopieren" (ohne Kunden, ohne Partnernamen - nur IDs). */
export function ekGestiegenText(r) {
  const z = [`EK gestiegen (> ${r.prozent} %) seit ${r.seit}`];
  const e = n => (n === null || n === undefined ? '–' : n.toFixed(2).replace('.', ','));
  for (const a of r.artikel) {
    z.push(`${a.name} (${a.produktId})${a.festpreis ? ` · Festpreis ${a.festpreis}` : ''}${a.lizenz ? ` · Lizenz ${a.lizenz}` : ''}`);
    for (const x of a.zeilen) z.push(`  ${[x.modell, x.farbe, x.groesse].filter(Boolean).join(' ')}: EK ${e(x.ekAlt)} → ${e(x.ekNeu)} (+${String(x.plus).replace('.', ',')} %) · VK ${e(x.vk)} · Marge ${x.margeAlt ?? '–'} % → ${x.margeNeu ?? '–'} %`);
  }
  return z.join('\n');
}
