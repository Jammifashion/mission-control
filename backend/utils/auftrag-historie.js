// AM-6: Historie je Kunde ("Hatte bisher") - reine Logik ohne Netz. Lesen in lib/auftraege.js (leseKundenHistorie).
// Quelle: nur Auftraege aus MC (Reiter Auftraege + Auftrag_Positionen), keine Lexware-Belege. Keine Kundennamen in der Antwort
// (nur Kunden_Nr). Preise (netto) nur fuer die MC-Oberflaeche - nie ins Log, nie in Korb/EDI/Chat.
//
// Regeln (Auftrag AM-6):
//  - "hatte" = Auftrag ab Status "bestellt" (bestellt, in Produktion, fertig, übergeben, bezahlt), nicht storniert.
//  - Gruppen nur aus Anfrage/Angebot/Design = "nur angefragt"; stornierte Auftraege zaehlen gar nicht.
//  - L-Shop-Positionen verdichtet je Modell + Farbe (aus LShop_Modelle ueber die ArticleNr), neueste zuerst.
//  - Freie Positionen je gleichem Text (nur getrimmt, keine weitere Verdichtung).

import { SCHRITTE, STORNIERT, ART, aktivePositionen } from './auftraege.js';

const t = v => String(v ?? '').trim();
const idx = s => SCHRITTE.findIndex(x => x.status === s);
const HATTE_AB = idx('bestellt');

/** "hatte" | "angefragt" | "" (storniert/unbekannt - zaehlt nicht). */
export function historieArt(a) {
  if (a.Status === STORNIERT) return '';
  const i = idx(a.Status);
  if (i < 0) return '';
  return i >= HATTE_AB ? 'hatte' : 'angefragt';
}
/** Datum eines Auftrags fuer die Historie: ab "bestellt" das Bestelldatum, sonst das Anfragedatum (JJJJ-MM-TT). */
export function historieDatum(a) {
  const d = historieArt(a) === 'hatte' ? t(a.Bestellt_Am) || t(a.Anfrage_Am) : t(a.Anfrage_Am);
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : t(a.Angelegt).slice(0, 10);
}
const neuesteZuerst = (x, y) => y.datum.localeCompare(x.datum) || String(y.auftragNr).localeCompare(String(x.auftragNr));

// Lieferbarkeit (BO7): je schlechter, desto kleiner der Rang.
const LFB_RANG = { nicht_gefuehrt: 0, auslauf_null: 1, auslauf: 2, null: 3, lieferbar: 4 };
const schlechteste = liste => liste.filter(l => l && LFB_RANG[l.stufe] !== undefined).sort((a, b) => LFB_RANG[a.stufe] - LFB_RANG[b.stufe])[0] ?? null;
/** Hinweis (orange) bei laeuft aus / 0 / nicht gefuehrt. */
export const lfbHinweis = l => !!l && ['nicht_gefuehrt', 'auslauf_null', 'auslauf', 'null'].includes(l.stufe);

const preisAus = p => ({ Preis_Netto: p.Preis_Netto ?? '', Aufpreis_Netto: p.Aufpreis_Netto ?? '', Aufpreis_Ab: p.Aufpreis_Ab ?? '', USt_Satz: p.USt_Satz ?? '' });

/**
 * Historie eines Kunden.
 * @param {object} p
 * @param {object[]} p.auftraege  Zeilen aus Auftraege (alle; gefiltert wird hier ueber Kunden_Nr)
 * @param {object[]} p.positionen Zeilen aus Auftrag_Positionen (alle; nur aktive zaehlen)
 * @param {Map} p.info            ArticleNr -> { modell, bezeichnung, farbe, groesse, bestellbar, lieferbar } (lshopInfo)
 * @param {string} p.kundenNr
 * @returns {{ kundenNr, gruppen: object[], frei: object[] }}
 */
export function kundenHistorie({ auftraege, positionen, info = new Map(), kundenNr }) {
  const eigene = (auftraege ?? []).filter(a => a.Kunden_Nr === kundenNr && historieArt(a));
  const roh = [];   // je Auftrag und Gruppe ein Eintrag
  for (const a of eigene) {
    const art = historieArt(a), datum = historieDatum(a);
    const akt = aktivePositionen(positionen, a.Auftrag_Nr);
    const jeKey = new Map();
    for (const p of akt) {
      let key, basis;
      if (p.Art === ART.LSHOP) {
        const i = info.get(t(p.LShop_ArticleNr));
        // ArticleNr gar nicht mehr in LShop_Modelle: eigene Gruppe je Nummer (nicht mehr im Katalog)
        key = i?.modell ? `l|${i.modell}|${i.farbe ?? ''}` : `n|${t(p.LShop_ArticleNr)}`;
        basis = { art: 'lshop', modell: i?.modell ?? '', bezeichnung: i?.bezeichnung ?? '', farbe: i?.farbe ?? '', articleNr: i?.modell ? '' : t(p.LShop_ArticleNr) };
      } else {
        key = `f|${t(p.Freitext)}`;
        basis = { art: 'frei', text: t(p.Freitext) };
      }
      if (!jeKey.has(key)) jeKey.set(key, { key, ...basis, auftragNr: a.Auftrag_Nr, datum, histArt: art, positionen: [] });
      jeKey.get(key).positionen.push(p);
    }
    roh.push(...jeKey.values());
  }
  const gesamt = new Map();
  for (const r of roh) { if (!gesamt.has(r.key)) gesamt.set(r.key, []); gesamt.get(r.key).push(r); }
  const gruppen = [], frei = [];
  for (const [key, liste] of gesamt) {
    const hatte = liste.filter(x => x.histArt === 'hatte').sort(neuesteZuerst);
    const zaehlt = hatte.length ? hatte : liste.filter(x => x.histArt === 'angefragt').sort(neuesteZuerst);
    const letzt = zaehlt[0];
    const p0 = letzt.positionen.find(p => t(p.Motiv) || t(p.Druck)) ?? letzt.positionen[0];
    const basis = {
      key, zuletzt: letzt.datum, auftraege: new Set(zaehlt.map(x => x.auftragNr)).size, nurAngefragt: !hatte.length,
      stueck: hatte.reduce((s, x) => s + x.positionen.reduce((u, p) => u + (Number(p.Menge) || 0), 0), 0),
      letzter: { auftragNr: letzt.auftragNr, datum: letzt.datum, motiv: t(p0.Motiv), druck: t(p0.Druck), notiz: t(p0.Notiz), ...preisAus(letzt.positionen[0]) },
    };
    if (letzt.art === 'frei') {
      frei.push({ ...basis, text: letzt.text, menge: letzt.positionen.reduce((s, p) => s + (Number(p.Menge) || 0), 0) });
      continue;
    }
    // Katalog heute: gibt es Modell + Farbe noch waehlbar (nicht ausgelaufen, nicht Discontinued 3/6)?
    const varianten = letzt.modell ? [...info.entries()].filter(([, i]) => i.modell === letzt.modell && (i.farbe ?? '') === letzt.farbe) : [];
    const waehlbar = varianten.filter(([, i]) => i.bestellbar);
    const gehabt = new Set(zaehlt.flatMap(x => x.positionen.map(p => t(p.LShop_ArticleNr))));
    const lfbQuelle = waehlbar.filter(([nr]) => gehabt.has(nr));
    gruppen.push({
      ...basis, modell: letzt.modell, bezeichnung: letzt.bezeichnung, farbe: letzt.farbe, articleNr: letzt.articleNr,
      katalog: waehlbar.length > 0,
      lieferbar: schlechteste((lfbQuelle.length ? lfbQuelle : waehlbar).map(([, i]) => i.lieferbar)),
    });
  }
  const sortiere = (x, y) => (x.nurAngefragt - y.nurAngefragt) || y.zuletzt.localeCompare(x.zuletzt) || String(y.letzter.auftragNr).localeCompare(String(x.letzter.auftragNr));
  return { kundenNr, gruppen: gruppen.sort(sortiere), frei: frei.sort(sortiere) };
}
