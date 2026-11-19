// Festpreis-Abrechnung: EINE Auswahl und EINE Rechnung fuer Vorschau (summary),
// Abrechnung (POST /abrechnungen) und Portal-Saldo (festpreis-public). Dazu die
// Zuordnung der Zeilen zu einer Abrechnung (Loeschen setzt nur genau diese zurueck)
// und die erlaubten Status-Wechsel.

import { createHash } from 'crypto';
import { parseDeZahl } from './zahl-de.js';

const t = v => String(v ?? '').trim();

export function fpZahl(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = parseDeZahl(val.toString());
  return Number.isNaN(n) ? fallback : n;
}
const round2 = n => Math.round(n * 100) / 100;

/**
 * Aggregiert FP_Verkaeufe-Zeilen pro Produkt-ID.
 * Festpreis und Handlingskosten sind Stueckpreise: gerechnet wird mit ihrem Betrag mal der
 * Stueckzahl MIT Vorzeichen. Eine Storno-Gegenbuchung (Stueckzahl negativ, Stueckpreise negativ
 * gespeichert) hebt den Verkauf damit genau auf. Summenspalten (VK, Mehrkosten, Porto, PayPal)
 * tragen ihr Vorzeichen selbst.
 */
export function aggregateFpVerkaeufe(rows, vh) {
  const gruppen = {};
  for (const r of rows) {
    const pid = String(r[vh('Produkt-ID')] ?? 'unbekannt');
    if (!gruppen[pid]) {
      gruppen[pid] = {
        produktId:       pid,
        artikelname:     r[vh('Artikelname')]      ?? '',
        artikelkategorie: r[vh('Artikelkategorie')] ?? '',
        stueckzahl: 0, vkNetto: 0, festpreisGesamt: 0, handlingGesamt: 0,
        mehrkosten: 0, portoEinnahmen: 0, portoKosten: 0, paypalGesamt: 0, auszahlung: 0,
      };
    }
    const stk             = fpZahl(r[vh('Stückzahl')]);
    const vk              = fpZahl(r[vh('VK-Netto')]);
    const festpreis       = Math.abs(fpZahl(r[vh('Festpreis')]));
    const handlingskosten = Math.abs(fpZahl(r[vh('Handlingskosten')]));
    const mehrkosten      = fpZahl(r[vh('Mehrkosten')]);
    const portoEin        = fpZahl(r[vh('Porto-Einnahme')]);
    const portoKost       = fpZahl(r[vh('Porto-Kosten')]) + fpZahl(r[vh('Versandnebenkosten')]);
    const paypal          = fpZahl(r[vh('PayPal-Kosten')]);
    const g = gruppen[pid];
    g.stueckzahl      += stk;
    g.vkNetto         += vk;
    g.festpreisGesamt += festpreis * stk;
    g.handlingGesamt  += handlingskosten * stk;
    g.mehrkosten      += mehrkosten;
    g.portoEinnahmen  += portoEin;
    g.portoKosten     += portoKost;
    g.paypalGesamt    += paypal;
    g.auszahlung      += vk - (festpreis + handlingskosten) * stk - mehrkosten + portoEin - portoKost - paypal;
  }
  const produkteGruppen = Object.values(gruppen).map(g => ({
    ...g,
    vkNetto: round2(g.vkNetto), festpreisGesamt: round2(g.festpreisGesamt),
    handlingGesamt: round2(g.handlingGesamt), mehrkosten: round2(g.mehrkosten),
    portoEinnahmen: round2(g.portoEinnahmen), portoKosten: round2(g.portoKosten),
    paypalGesamt: round2(g.paypalGesamt), auszahlung: round2(g.auszahlung),
  }));
  const summen = produkteGruppen.reduce((s, g) => ({
    stueckzahl: s.stueckzahl + g.stueckzahl,
    vkNetto: round2(s.vkNetto + g.vkNetto), festpreisGesamt: round2(s.festpreisGesamt + g.festpreisGesamt),
    handlingGesamt: round2(s.handlingGesamt + g.handlingGesamt), mehrkosten: round2(s.mehrkosten + g.mehrkosten),
    portoEinnahmen: round2(s.portoEinnahmen + g.portoEinnahmen), portoKosten: round2(s.portoKosten + g.portoKosten),
    paypalGesamt: round2(s.paypalGesamt + g.paypalGesamt), auszahlung: round2(s.auszahlung + g.auszahlung),
  }), { stueckzahl:0, vkNetto:0, festpreisGesamt:0, handlingGesamt:0, mehrkosten:0, portoEinnahmen:0, portoKosten:0, paypalGesamt:0, auszahlung:0 });
  return { produkteGruppen, summen };
}

/**
 * Zeilen einer Abrechnung bzw. eines Saldos: Partner, Status (Standard "offen"), Datum im Zeitraum
 * (von/bis optional). Storno-Gegenbuchungen gehoeren dazu - Vorschau, Abrechnung und Portal-Saldo
 * nehmen genau diese Auswahl.
 */
export function fpAbrechnungsZeilen(rows, vh, { partnerId, von = null, bis = null, status = 'offen', parseDate }) {
  return (rows ?? []).filter(r => {
    if (partnerId && t(r[vh('Partner-ID')]) !== partnerId) return false;
    if (t(r[vh('Status Abrechnung')]).toLowerCase() !== String(status).toLowerCase()) return false;
    if (!von && !bis) return true;
    const d = parseDate(t(r[vh('Datum')]));
    if (!d) return false;
    return (!von || d >= von) && (!bis || d <= bis);
  });
}

/**
 * Schluessel einer FP_Verkaeufe-Zeile, um sie einer Abrechnung zuzuordnen: kurzer Hash (12 Hex) aus
 * Partner, Bestellung, Produkt, Artikel, Variante, Datum, Storno - klein genug fuer die Positionen-Zelle.
 */
export function fpZeilenSchluessel(r, vh) {
  const v = t(r[vh('Variante')]);
  const roh = [
    t(r[vh('Partner-ID')]), t(r[vh('WC-Bestellnummer')]), t(r[vh('Produkt-ID')]), t(r[vh('Artikelname')]),
    v === '' ? '0' : v, t(r[vh('Datum')]), t(r[vh('Storno-Status')]) === '' ? '' : 'S',
  ].join('|');
  return createHash('sha256').update(roh).digest('hex').slice(0, 12);
}
/** Hoechstlaenge der Positionen-Zelle (Sheets erlaubt 50 000 Zeichen je Zelle). */
export const POSITIONEN_MAX_ZEICHEN = 45000;

/** Schluessel einer internen Bestellung (aus der Zeile bzw. aus der gespeicherten Position). */
export const internSchluessel = ({ datum, bezeichnung, anzahl, summe }) =>
  [t(datum), t(bezeichnung), round2(fpZahl(anzahl)), round2(fpZahl(summe))].join('|');

/**
 * Trifft gespeicherte Schluessel auf Zeilen (Mehrfachmenge: gleiche Schluessel zaehlen einzeln).
 * @returns {{ treffer: any[], fehlend: string[] }}
 */
export function zeilenZuSchluesseln(rows, schluesselVon, schluessel) {
  const offen = new Map();
  for (const s of schluessel ?? []) offen.set(s, (offen.get(s) ?? 0) + 1);
  const treffer = [];
  for (const r of rows ?? []) {
    const s = schluesselVon(r);
    const n = offen.get(s) ?? 0;
    if (n > 0) { treffer.push(r); offen.set(s, n - 1); }
  }
  const fehlend = [...offen.entries()].flatMap(([s, n]) => Array(n).fill(s));
  return { treffer, fehlend };
}

/**
 * Loesch-Plan eines Entwurfs: welche Verkaufs- und internen Zeilen gehen zurueck auf "offen".
 * Mit gespeicherten Schluesseln (`positionen.zeilen`) genau diese; ohne (Altbestand) nur, wenn
 * keine andere Abrechnung des Partners den Zeitraum ueberschneidet - sonst Fehler (409), nichts geschrieben.
 * @returns {{ verkaeufe: any[], intern: any[] } | { fehler: string }}
 */
export function fpLoeschPlan({ positionen, verkaufsZeilen, internZeilen, vh, ih, partnerId, von, bis, andere, parseDate }) {
  const abgerechnet = (rows, statusSpalte, pidSpalte) => (rows ?? []).filter(r =>
    t(r[pidSpalte]) === partnerId && t(r[statusSpalte]).toLowerCase() === 'abgerechnet');
  const vAbg = abgerechnet(verkaufsZeilen, vh('Status Abrechnung'), vh('Partner-ID'));
  const iAbg = ih('Status') === -1 ? [] : abgerechnet(internZeilen, ih('Status'), ih('Partner-ID'));

  const iRow = r => internSchluessel({ datum: r[ih('Datum')], bezeichnung: r[ih('Bezeichnung')], anzahl: r[ih('Anzahl')], summe: r[ih('Summe')] });
  const intern = zeilenZuSchluesseln(iAbg, iRow, (positionen?.intern ?? []).map(internSchluessel)).treffer;

  if (Array.isArray(positionen?.zeilen)) {
    return { verkaeufe: zeilenZuSchluesseln(vAbg, r => fpZeilenSchluessel(r, vh), positionen.zeilen).treffer, intern };
  }
  // Altbestand ohne Zeilen-Schluessel: Zeitraum, aber nur ohne Ueberschneidung mit einer anderen Abrechnung.
  const ueberschneidet = (andere ?? []).some(a => a.von && a.bis && a.von <= bis && a.bis >= von);
  if (ueberschneidet) {
    return { fehler: 'Dieser Entwurf stammt von vor der Umstellung und sein Zeitraum überschneidet eine andere Abrechnung des Partners. Nichts zurückgesetzt – bitte die Verkäufe von Hand prüfen.' };
  }
  const imZeitraum = r => { const d = parseDate(t(r[vh('Datum')])); return d && d >= von && d <= bis; };
  return { verkaeufe: vAbg.filter(imZeitraum), intern };
}

/**
 * Erlaubte Status-Wechsel einer Festpreis-Abrechnung (die Verkaeufe sind ab "entwurf" abgerechnet):
 * nur vorwaerts entwurf -> freigegeben -> bezahlt, dazu bezahlt -> freigegeben (Zahlung zuruecknehmen).
 * Nie zurueck auf "entwurf" (Loeschen wuerde sonst eine freigegebene Abrechnung wieder oeffnen).
 */
export const FP_STATUS_WECHSEL = {
  entwurf:     ['freigegeben'],
  freigegeben: ['bezahlt'],
  bezahlt:     ['freigegeben'],
};
export function fpStatusWechselErlaubt(von, nach) {
  const a = t(von).toLowerCase() || 'entwurf';
  return a === t(nach).toLowerCase() || (FP_STATUS_WECHSEL[a] ?? []).includes(t(nach).toLowerCase());
}

/**
 * Lizenz-Abrechnung: "freigegeben" nur ueber POST /freigeben (markiert die Posten), nie zurueck auf
 * "entwurf". Erlaubt: freigegeben -> bezahlt, bezahlt -> freigegeben, Altwerte (angefordert, geprueft) -> bezahlt.
 */
export const LIZENZ_STATUS_WECHSEL = {
  freigegeben: ['bezahlt'],
  bezahlt:     ['freigegeben'],
  angefordert: ['bezahlt'],
  'geprüft':   ['bezahlt'],
};
export function lizenzStatusWechselErlaubt(von, nach) {
  const a = t(von).toLowerCase();
  return a === t(nach).toLowerCase() || (LIZENZ_STATUS_WECHSEL[a] ?? []).includes(t(nach).toLowerCase());
}

// ── Erst klaeren, dann abrechnen ────────────────────────────────────────────
// Leitlinie (wie PA8/VP1): fehlt etwas, wird nicht still mit 0 abgerechnet. Vorschau zeigt die Punkte,
// Erstellen lehnt mit 409 ab, bis sie geklaert sind. Gilt fuer Festpreis (Porto, Verpackung, interne
// Bestellungen, MwSt) und Lizenz (interne Bestellungen, MwSt).

export const leerZelle = v => v === null || v === undefined || String(v).trim() === '';

/**
 * @param {object} o
 * @param {object|null} [o.porto]          Ergebnis berechnePorto (status 'fehlt': unbekannt / fixkostenFehlen)
 * @param {object|null} [o.verpackung]     Ergebnis berechneVerpackung (status 'fehlt': hinweise)
 * @param {{datum, bezeichnung}[]} [o.interneOhneSumme]  offene interne Bestellungen mit LEERER Summe (0 = bewusst)
 * @param {string[]} [o.fixkostenFehlen]   fehlende Fixkosten-Positionen fuer die Abrechnung (z. B. MwSt)
 * @param {(id:string)=>string} [o.bestellLink]  Link "Bestellung im Shop oeffnen"
 * @returns {{ art: string, text: string, weg: string, eintraege?: object[] }[]}  leer = nichts zu klaeren
 */
export function abrechnungKlaeren({ porto = null, verpackung = null, interneOhneSumme = [], fixkostenFehlen = [], bestellLink = () => '' } = {}) {
  const punkte = [];
  if (porto?.unbekannt?.length) punkte.push({
    art: 'porto_versandart',
    text: `Versandart fehlt – erst klären: ${porto.unbekannt.length} Bestellung(en)`,
    weg: 'Bestellung im Shop öffnen und Versandart prüfen; danach die Versandmethode nachtragen (scripts/fill-fp-versandmethode.js) und die Vorschau neu laden.',
    eintraege: porto.unbekannt.map(id => ({ bestellung: String(id), link: bestellLink(id) })),
  });
  if (porto?.fixkostenFehlen?.length) punkte.push({
    art: 'porto_satz',
    text: `Porto-Satz fehlt in Kalkulation_Fixkosten zum Bestelldatum: ${porto.fixkostenFehlen.length} Bestellung(en)`,
    weg: 'In Kalkulation_Fixkosten Porto B/P und Versandnebenkosten B/P mit Gültig_ab vor dem Bestelldatum eintragen.',
    eintraege: porto.fixkostenFehlen.map(id => ({ bestellung: String(id), link: bestellLink(id) })),
  });
  if (verpackung?.status === 'fehlt') punkte.push({
    art: 'verpackung',
    text: `Verpackungspauschale nicht berechenbar – erst klären`,
    weg: (verpackung.hinweise ?? []).join(' ') || 'FP_Partner: Verpackung_je_Bestellung und Verpackung_ab prüfen ("nein" = keine Pauschale).',
  });
  if (interneOhneSumme.length) punkte.push({
    art: 'intern_ohne_preis',
    text: `Eigenaufträge ohne Preis: ${interneOhneSumme.length}`,
    weg: 'Preis (Summe) eintragen – 0 = bewusst ohne Betrag – oder den Eintrag aus der Abrechnung nehmen (Status ändern).',
    eintraege: interneOhneSumme.map(i => ({ datum: i.datum, bezeichnung: i.bezeichnung })),
  });
  if (fixkostenFehlen.length) punkte.push({
    art: 'fixkosten',
    text: `Fixkosten fehlen in Kalkulation_Fixkosten: ${fixkostenFehlen.join(', ')}`,
    weg: 'Position mit gültigem Wert (Gültig_ab bis heute) eintragen.',
  });
  return punkte;
}

/** 409-Antwort, wenn noch etwas zu klaeren ist (Erstellen). */
export const klaerenAntwort = punkte => ({
  status: 409,
  body: { error: `Abrechnung gesperrt – erst klären: ${punkte.map(p => p.text).join('; ')}.`, code: 'erst_klaeren', klaeren: punkte },
});
