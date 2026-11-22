// GS2 Teil B (Inhaber 22.11.2026, vorher "PD3"): Fanshop-Konto eines Festpreis-Partners - reine Logik ohne Netz.
// Lesen in lib/fanshopKonto.js. Nur fuer Partner mit FP_Partner.Kunden_Nr (GS1).
//
//   Saldo         = Offene Auszahlung (GS2 Teil A) − Fanshop offen. > 0 "bekommst du noch", < 0 "zahlst du noch".
//   Fanshop offen = Fanshop-Rechnungen (RE1-Kennzeichen am Auftrag), die laut Lexware nicht bezahlt sind
//                   + Fanshop-Auftraege des Kunden ohne Rechnungs-Kennzeichen (nicht storniert).
//   Lexware nicht lesbar -> Rechnungsteil, Fanshop offen und Saldo = null ("Stand Lexware unbekannt"), nie eine geratene Zahl.
//
// Datenschutz: aus "für wen" (Bestell_Eintraege.Fuer) nur der VORNAME (erstes Wort). Keine Notizen, keine Nachnamen, keine Lexware-IDs
// ans Portal; Entwuerfe (Rechnung und Gutschrift) sieht nur MC.

import { positionAusZeile, positionWerte, auftragSummen, rabattAus } from './auftrag-preise.js';
import { lieferTag, positionName, istStorniert, hatKennzeichen } from './rechnung.js';

const t = v => String(v ?? '').trim();
const euro = cent => Math.round(cent) / 100;
const rabatt = a => { try { return rabattAus(a.Rabatt); } catch { return null; } };   // wie lib/auftraege.js
const zuCent = x => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) : null);

/** Nur der Vorname: erstes Wort, nur Buchstaben/Bindestrich/Apostroph, hoechstens 20 Zeichen. */
export function vorname(fuer) {
  const w = t(fuer).split(/[\s,;/]+/)[0] ?? '';
  return w.replace(/[^\p{L}\-']/gu, '').slice(0, 20);
}

/** Lexware-Belegstatus -> Anzeige. */
export function belegStatus(voucherStatus) {
  const s = t(voucherStatus);
  if (s === 'draft') return 'entwurf';
  if (s === 'open' || s === 'overdue') return 'offen';
  if (s === 'paid' || s === 'paidoff') return 'bezahlt';
  if (s === 'voided') return 'storniert';
  return 'unbekannt';
}

/**
 * @param {object} o
 * @param {object[]} o.auftraege   Auftrags-Zeilen (alle; es zaehlen nur die des Kunden)
 * @param {object[]} o.positionen  Positions-Zeilen
 * @param {Map} o.info             ArticleNr -> { bezeichnung, farbe, groesse }
 * @param {Map<string,string[]>} o.fuerJe  Position_ID -> "für wen" (ganze Eintraege; hier nur Vorname uebernommen)
 * @param {object[]} o.gutschriften [{ abrechnung, id }] aus FP_Abrechnungen (Gutschrift_Lexware_ID)
 * @param {Map<string,object>|null} o.belege Lexware-Belege des Kontakts (id -> belegAus) oder null = Lexware unbekannt
 * @param {{ saldo, ausstehend, laufend, abgerechnetBis }} o.auszahlung  aus fpSaldo (Teil A)
 * @param {boolean} o.mitEntwuerfen  MC true, Portal false
 */
export function fanshopKonto({ kundenNr, auftraege, positionen, info = new Map(), fuerJe = new Map(), gutschriften = [], belege, auszahlung, mitEntwuerfen }) {
  const eigene = (auftraege ?? []).filter(a => t(a.Kunden_Nr) === kundenNr && !istStorniert(a) && !/^AG-/.test(t(a.Auftrag_Nr)));
  const aktivePos = nr => (positionen ?? []).filter(p => t(p.Auftrag_Nr) === nr && !t(p.Entfernt));
  const groesse = p => info.get(t(p.LShop_ArticleNr))?.groesse ?? '';
  const nachNummer = new Map([...(belege?.values() ?? [])].filter(b => b.voucherNumber).map(b => [b.voucherNumber, b]));

  // Auftraege ohne Kennzeichen = noch nicht abgerechnet
  const offeneAuftraege = [];
  let auftraegeCent = 0, ohnePreis = 0;
  for (const a of eigene.filter(x => !hatKennzeichen(x)).sort((x, y) => lieferTag(x).localeCompare(lieferTag(y)) || t(x.Auftrag_Nr).localeCompare(t(y.Auftrag_Nr)))) {
    const akt = aktivePos(t(a.Auftrag_Nr));
    const pos = akt.map(p => {
      const w = positionWerte(positionAusZeile(p, { groesse: groesse(p) }));
      const vn = [...new Set((fuerJe.get(t(p.Position_ID)) ?? []).map(vorname).filter(Boolean))];
      const brutto = w.netto === null ? null : Math.round((w.netto * (100 + Number(w.ust))) / 100);   // je Position nur Anzeige; Summe kommt aus auftragSummen
      return { name: positionName(p, info), menge: Number(w.menge) || 0, summe: brutto === null ? null : euro(brutto), ...(vn.length ? { fuer: vn } : {}) };
    });
    const s = auftragSummen(akt.map(p => positionAusZeile(p, { groesse: groesse(p) })), rabatt(a));
    const ohne = pos.filter(x => x.summe === null).length;
    ohnePreis += ohne;
    auftraegeCent += s.brutto;
    offeneAuftraege.push({ datum: lieferTag(a), titel: t(a.Kurztitel), status: t(a.Status), stueck: pos.reduce((n, x) => n + x.menge, 0),
      summe: euro(s.brutto), ohnePreis: ohne, positionen: pos });
  }

  // Rechnungen (je Lexware-Beleg einmal; ein Beleg kann mehrere Auftraege tragen)
  const rechnungen = new Map();   // schluessel -> { id, nummer, unklarCent }
  for (const a of eigene.filter(hatKennzeichen)) {
    const id = t(a.Rechnung_Lexware_ID), hand = t(a.Lexoffice_Rechnung), st = t(a.Rechnung_Status);
    if (id) rechnungen.set(`id:${id}`, { id });
    else if (hand) rechnungen.set(`nr:${hand}`, { nummer: hand });
    else if (st === 'unklar') {   // Antwort fehlte (RE1): zaehlt mit dem Auftragsbetrag als offen, bis geklaert
      const k = rechnungen.get('unklar') ?? { unklarCent: 0 };
      k.unklarCent += auftragSummen(aktivePos(t(a.Auftrag_Nr)).map(p => positionAusZeile(p, { groesse: groesse(p) })), rabatt(a)).brutto;
      rechnungen.set('unklar', k);
    }
  }
  let rechnungenCent = belege ? 0 : null, entwurfCent = 0, rechnungenAnzahl = 0;
  const liste = [];
  for (const [k, r] of rechnungen) {
    if (k === 'unklar') { if (rechnungenCent !== null) rechnungenCent += r.unklarCent; rechnungenAnzahl++; continue; }
    const b = belege ? (r.id ? belege.get(r.id) : nachNummer.get(r.nummer)) : null;
    if (!belege) { liste.push({ art: 'rechnung', nummer: r.nummer ?? '', datum: '', betrag: null, status: 'unbekannt', ...(mitEntwuerfen && r.id ? { id: r.id } : {}) }); continue; }
    if (!b) continue;   // in Lexware nicht (mehr) da, z. B. geloeschter Entwurf: nichts offen
    const status = belegStatus(b.voucherStatus);
    const offenCent = status === 'entwurf' ? zuCent(b.totalAmount) ?? 0 : status === 'offen' ? zuCent(b.openAmount ?? b.totalAmount) ?? 0 : 0;
    if (status === 'entwurf') entwurfCent += offenCent;
    else { rechnungenCent += offenCent; if (offenCent) rechnungenAnzahl++; }
    if (status === 'entwurf' && !mitEntwuerfen) continue;
    liste.push({ art: 'rechnung', nummer: b.voucherNumber, datum: b.voucherDate, betrag: b.totalAmount, status, ...(mitEntwuerfen ? { id: b.id } : {}) });
  }
  for (const g of gutschriften) {
    const b = belege?.get(t(g.id));
    if (!belege) { liste.push({ art: 'gutschrift', nummer: '', datum: '', betrag: null, status: 'unbekannt', abrechnung: g.abrechnung, ...(mitEntwuerfen ? { id: g.id } : {}) }); continue; }
    if (!b) continue;
    const status = belegStatus(b.voucherStatus);
    if (status === 'entwurf' && !mitEntwuerfen) continue;
    liste.push({ art: 'gutschrift', nummer: b.voucherNumber, datum: b.voucherDate, betrag: b.totalAmount, status, abrechnung: g.abrechnung, ...(mitEntwuerfen ? { id: b.id } : {}) });
  }
  liste.sort((x, y) => t(y.datum).localeCompare(t(x.datum)));

  // Entwurfs-Rechnungen: MC zeigt sie bei "Rechnungen offen", das Portal (sieht keine Entwuerfe) bei "noch nicht abgerechnet"
  const rechnungenAnzeige = rechnungenCent === null ? null : rechnungenCent + (mitEntwuerfen ? entwurfCent : 0);
  const auftraegeAnzeige = auftraegeCent + (mitEntwuerfen || rechnungenCent === null ? 0 : entwurfCent);
  const gesamtCent = rechnungenCent === null ? null : rechnungenCent + entwurfCent + auftraegeCent;
  const auszahlungCent = Math.round((Number(auszahlung?.saldo) || 0) * 100);
  return {
    aktiv: true,
    lexware: belege ? 'ok' : 'unbekannt',
    auszahlung: { saldo: euro(auszahlungCent), ausstehend: Number(auszahlung?.ausstehend) || 0, laufend: Number(auszahlung?.laufend) || 0, abgerechnetBis: t(auszahlung?.abgerechnetBis) },
    fanshopOffen: {
      gesamt: gesamtCent === null ? null : euro(gesamtCent),
      rechnungen: rechnungenAnzeige === null ? null : euro(rechnungenAnzeige), rechnungenAnzahl,
      auftraege: euro(auftraegeAnzeige), auftraegeAnzahl: offeneAuftraege.length, ohnePreis,
    },
    saldo: gesamtCent === null ? null : euro(auszahlungCent - gesamtCent),
    belege: liste,
    offeneAuftraege,
  };
}
