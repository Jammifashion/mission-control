// RE1 (Inhaber 22.11.2026): Sammelrechnung aus Auftraegen als Lexware-ENTWURF - reine Logik ohne Netz.
// Lesen/Schreiben in lib/rechnung.js, der eine Lexware-Aufruf in lib/lexwareRechnung.js.
//
// Regeln:
// - Auswahl ueber das eigene Kennzeichen (Rechnung_Status leer), NICHT ueber den Auftragsstatus: geliefert, uebergeben und auch
//   bezahlt zaehlen mit. Storniert nie, entfernte Positionen nie. Ein von Hand gefuelltes `Lexoffice_Rechnung` zaehlt als
//   abgerechnet (nie doppelt).
// - Preise wie im Auftrag (Preis_Netto + Aufpreis je Groesse, USt je Position). Alle Auftraege "brutto" eingegeben -> Brutto-Rechnung
//   (taxType gross, grossAmount = Brutto je Stueck auf 2 Stellen, so wie MC es aus dem Netto mit 4 Stellen zurueckrechnet - der
//   vereinbarte Bruttopreis kommt exakt wieder heraus). Alle netto -> Netto-Rechnung (netAmount bis 4 Stellen, Lexware-Grenze).
//   Gemischt, Rabatt am Auftrag oder Positionen ohne Preis -> nicht abrechenbar (Grund), nichts geraten.
// - Nur Entwurf; Kontakt = Lexoffice_ID des MC-Kunden (fehlt -> nicht senden).
// - Personennamen ("für wen") gehen nur in den Positionstext der Rechnung, nie in Log/Chat.

import { positionAusZeile, positionWerte, bruttoAusNetto, cent, UST_STANDARD } from './auftrag-preise.js';
import { berlinDatum } from './berlin-tag.js';

export const RECHNUNG_SPALTEN = ['Rechnung_Lexware_ID', 'Rechnung_Am', 'Rechnung_Status'];
export const RE_STATUS = { ENTWURF: 'entwurf', UNKLAR: 'unklar' };
export const MAX_POSITIONEN = 300;   // Lexware: hoechstens 300 lineItems je Rechnung
export const TITEL = 'Rechnung';
export const EINHEIT = 'Stück';
export const LINK_BASIS = 'https://app.lexware.de/permalink/invoices/edit/';

const t = v => String(v ?? '').trim();
const de = ymd => (/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}` : '');
export const istStorniert = a => t(a.Status) === 'storniert' || t(a.Storniert_Am) !== '';
export const hatKennzeichen = a => t(a.Rechnung_Status) !== '' || t(a.Rechnung_Lexware_ID) !== '' || t(a.Lexoffice_Rechnung) !== '';
const aktiv = (positionen, nr) => (positionen ?? []).filter(p => t(p.Auftrag_Nr) === nr && !t(p.Entfernt));
/** Lieferdatum eines Auftrags fuer die Rechnung: Termin, sonst Uebergeben_Am, sonst Anlagetag. */
export const lieferTag = a => [a.Termin, a.Uebergeben_Am, t(a.Angelegt).slice(0, 10)].map(t).find(v => /^\d{4}-\d{2}-\d{2}$/.test(v)) ?? '';

/**
 * Auftraege eines Kunden fuer "Abrechnen". offen = ohne Kennzeichen (auswaehlbar, wenn ohne Grund), abgerechnet = mit Kennzeichen.
 * Zeitraum (optional) ueber den Liefertag.
 */
export function abrechnenListe({ auftraege, positionen, kundenNr, von = '', bis = '' }) {
  const offen = [], abgerechnet = [];
  for (const a of auftraege ?? []) {
    if (t(a.Kunden_Nr) !== kundenNr || istStorniert(a) || /^AG-/.test(t(a.Auftrag_Nr))) continue;
    const tag = lieferTag(a);
    if ((von && tag && tag < von) || (bis && tag && tag > bis)) continue;
    const akt = aktiv(positionen, t(a.Auftrag_Nr));
    const zeile = {
      auftragNr: t(a.Auftrag_Nr), kurztitel: t(a.Kurztitel), status: t(a.Status), liefertag: tag, stand: t(a.Stand),
      positionen: akt.length, ohnePreis: akt.filter(p => t(p.Preis_Netto) === '').length, eingabe: t(a.Preis_Eingabe) === 'brutto' ? 'brutto' : 'netto',
      rabatt: t(a.Rabatt) !== '',
    };
    if (hatKennzeichen(a)) {
      abgerechnet.push({ ...zeile, rechnung: { id: t(a.Rechnung_Lexware_ID), am: t(a.Rechnung_Am), status: t(a.Rechnung_Status), hand: t(a.Lexoffice_Rechnung) } });
    } else {
      zeile.grund = !akt.length ? 'keine Positionen' : zeile.ohnePreis ? `${zeile.ohnePreis} Position${zeile.ohnePreis === 1 ? '' : 'en'} ohne Preis`
        : zeile.rabatt ? 'Rabatt am Auftrag – bitte von Hand abrechnen' : '';
      offen.push(zeile);
    }
  }
  const sort = (x, y) => x.liefertag.localeCompare(y.liefertag) || x.auftragNr.localeCompare(y.auftragNr);
  return { offen: offen.sort(sort), abgerechnet: abgerechnet.sort(sort) };
}

/** Positionstext: Artikel · Farbe · Groesse (L-Shop) bzw. Freitext; <= 255. */
export function positionName(p, info) {
  if (t(p.Art) === 'lshop') {
    const i = info?.get?.(t(p.LShop_ArticleNr)) ?? {};
    return [t(p.Motiv) || t(i.bezeichnung) || `Artikel ${t(p.LShop_ArticleNr)}`, t(i.farbe), t(i.groesse)].filter(Boolean).join(' · ').slice(0, 255);
  }
  return (t(p.Freitext) || 'Position').slice(0, 255);
}

/** voucherDate/shippingDate im Lexware-Format (RFC 3339, Mitternacht Europe/Berlin mit Versatz). */
export function lexwareDatum(ymd) {
  const mittag = new Date(`${ymd}T12:00:00Z`);
  const teil = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' }).formatToParts(mittag)
    .find(x => x.type === 'timeZoneName')?.value ?? 'GMT+1';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(teil);
  const versatz = m ? `${m[1]}${m[2].padStart(2, '0')}:${m[3] ?? '00'}` : '+01:00';
  return `${ymd}T00:00:00.000${versatz}`;
}

/**
 * Rechnungsentwurf fuer die gewaehlten Auftraege.
 * @param {object} o
 * @param {object[]} o.auftraege  gewaehlte Auftrags-Zeilen (Objekte nach Spaltenname)
 * @param {object[]} o.positionen alle Positionen (es zaehlen nur aktive der gewaehlten Auftraege)
 * @param {Map} o.info            ArticleNr -> { bezeichnung, farbe, groesse } (lshopInfo)
 * @param {Map<string,string[]>} o.fuerJe  Position_ID -> Namen ("für wen", aus der Bestellseite)
 * @param {string} o.kontaktId    Lexoffice_ID des Kunden
 * @param {Date} o.jetzt
 * @returns {{ payload, summen: { netto, mwst: [{satz, betrag}], brutto }, taxType, positionen: object[], probleme: string[] }}
 */
export function rechnungsPlan({ auftraege, positionen, info = new Map(), fuerJe = new Map(), kontaktId, jetzt }) {
  const probleme = [];
  if (!t(kontaktId)) probleme.push('Kunde ist nicht mit Lexoffice verknüpft – erst in der Kundenkarte verknüpfen.');
  if (!(auftraege ?? []).length) probleme.push('Kein Auftrag gewählt.');
  const eingaben = new Set((auftraege ?? []).map(a => (t(a.Preis_Eingabe) === 'brutto' ? 'brutto' : 'netto')));
  if (eingaben.size > 1) probleme.push('Brutto- und Netto-Aufträge gemischt – bitte getrennt abrechnen.');
  const taxType = eingaben.has('brutto') && eingaben.size === 1 ? 'gross' : 'net';
  const sortiert = [...(auftraege ?? [])].sort((x, y) => lieferTag(x).localeCompare(lieferTag(y)) || t(x.Auftrag_Nr).localeCompare(t(y.Auftrag_Nr)));
  const lineItems = [], zeilen = [];
  const jeSatz = new Map();   // satz -> { netto (genau), brutto (Cent) }
  for (const a of sortiert) {
    const nr = t(a.Auftrag_Nr);
    if (istStorniert(a)) { probleme.push(`${nr} ist storniert.`); continue; }
    if (hatKennzeichen(a)) { probleme.push(`${nr} ist schon abgerechnet.`); continue; }
    if (t(a.Rabatt)) probleme.push(`${nr}: Rabatt am Auftrag – bitte von Hand abrechnen.`);
    const akt = aktiv(positionen, nr);
    if (!akt.length) probleme.push(`${nr}: keine Positionen.`);
    const tag = lieferTag(a);
    lineItems.push({ type: 'text', name: `Lieferung ${de(tag) || nr} · ${nr}`.slice(0, 255) });
    zeilen.push({ art: 'text', auftragNr: nr, text: `Lieferung ${de(tag) || nr} · ${nr}` });
    for (const p of akt) {
      const groesse = info?.get?.(t(p.LShop_ArticleNr))?.groesse ?? '';
      const w = positionWerte(positionAusZeile(p, { groesse }));
      if (w.netto === null) { probleme.push(`${t(p.Position_ID)}: ohne Preis.`); continue; }
      const menge = w.menge;
      const nettoGenau = Math.round((w.netto / menge) * 100) / 10000;   // Euro je Stueck, bis 4 Stellen (AMQ1, Lexware-Grenze)
      const satz = w.ust ?? UST_STANDARD;
      const brutto = bruttoAusNetto(nettoGenau, satz);
      const namen = fuerJe.get(t(p.Position_ID)) ?? [];
      const name = positionName(p, info);
      const item = {
        type: 'custom', name, quantity: menge, unitName: EINHEIT,
        unitPrice: taxType === 'gross'
          ? { currency: 'EUR', grossAmount: brutto, taxRatePercentage: satz }
          : { currency: 'EUR', netAmount: nettoGenau, taxRatePercentage: satz },
        discountPercentage: 0,
        ...(namen.length ? { description: `für ${namen.join(', ')}`.slice(0, 2000) } : {}),
      };
      lineItems.push(item);
      const s = jeSatz.get(satz) ?? { netto: 0, brutto: 0 };
      s.netto += w.netto;                               // Cent mit Bruchteil
      s.brutto += Math.round(cent(brutto) * menge);    // Cent
      jeSatz.set(satz, s);
      zeilen.push({ art: 'position', auftragNr: nr, positionId: t(p.Position_ID), name, fuer: namen.length > 0, menge, satz,
        stueck: taxType === 'gross' ? cent(brutto) : Math.round(nettoGenau * 10000) / 100, summe: taxType === 'gross' ? Math.round(cent(brutto) * menge) : Math.round(w.netto) });
    }
  }
  if (lineItems.length > MAX_POSITIONEN) probleme.push(`Mehr als ${MAX_POSITIONEN} Zeilen – bitte weniger Aufträge wählen.`);
  // Summen wie Lexware: Brutto-Rechnung = Summe Menge x Bruttopreis je Satz, MwSt herausgerechnet; Netto-Rechnung = MwSt je Satz.
  const mwst = [], summen = { netto: 0, brutto: 0, mwst };
  for (const [satz, s] of [...jeSatz].sort((x, y) => y[0] - x[0])) {
    if (taxType === 'gross') {
      const n = Math.round((s.brutto * 100) / (100 + satz));
      mwst.push({ satz, betrag: s.brutto - n }); summen.netto += n; summen.brutto += s.brutto;
    } else {
      const basis = Math.round(s.netto);
      const betrag = Math.round((s.netto * (100 + satz)) / 100) - basis;
      mwst.push({ satz, betrag }); summen.netto += basis; summen.brutto += basis + betrag;
    }
  }
  const tage = sortiert.map(lieferTag).filter(Boolean).sort();
  const heute = berlinDatum(new Date(jetzt));
  const shippingConditions = !tage.length ? { shippingType: 'delivery', shippingDate: lexwareDatum(heute) }
    : tage[0] === tage[tage.length - 1] ? { shippingType: 'delivery', shippingDate: lexwareDatum(tage[0]) }
      : { shippingType: 'deliveryperiod', shippingDate: lexwareDatum(tage[0]), shippingEndDate: lexwareDatum(tage[tage.length - 1]) };
  const payload = {
    voucherDate: lexwareDatum(heute),
    address: { contactId: t(kontaktId) },
    lineItems,
    totalPrice: { currency: 'EUR' },
    taxConditions: { taxType },
    shippingConditions,
    title: TITEL,
  };
  return { payload, summen, taxType, positionen: zeilen, probleme: [...new Set(probleme)] };
}

/** Brutto der Rechnung = Summe der Auftrags-Bruttos (MC-Rechnung je Auftrag)? Nur Hinweis, wenn nicht. */
export function bruttoAbgleich(summen, auftragsBruttoCent) {
  return summen.brutto === auftragsBruttoCent ? '' : `Brutto der Rechnung weicht um ${((summen.brutto - auftragsBruttoCent) / 100).toFixed(2).replace('.', ',')} € von der Summe der Aufträge ab (Rundung).`;
}

/** Zellen fuer das Kennzeichen (alle gewaehlten Auftraege). */
export const kennzeichenFelder = ({ id = '', status, am, stand }) => ({ Rechnung_Lexware_ID: id, Rechnung_Status: status, Rechnung_Am: am, Stand: stand });
export const leerFelder = stand => ({ Rechnung_Lexware_ID: '', Rechnung_Status: '', Rechnung_Am: '', Stand: stand });

/** Kennzeichen von Hand: "angelegt" (unklar -> entwurf, ID Pflicht) oder "zuruecksetzen" (entwurf/unklar -> leer). */
export function kennzeichenPlan({ auftrag, aktion, lexwareId = '' }) {
  const st = t(auftrag?.Rechnung_Status);
  if (![RE_STATUS.ENTWURF, RE_STATUS.UNKLAR].includes(st)) {
    const e = new Error(`${t(auftrag?.Auftrag_Nr)}: kein Rechnungskennzeichen von MC (Status „${st || 'leer'}“).`); e.status = 409; e.code = 'kennzeichen'; throw e;
  }
  if (aktion === 'zuruecksetzen') return { zuruecksetzen: true };
  if (aktion === 'angelegt') {
    const id = t(lexwareId) || t(auftrag.Rechnung_Lexware_ID);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      const e = new Error('Bitte die Lexware-ID des Entwurfs angeben (aus „In Lexware nachsehen“ oder der Adresse in Lexware).'); e.status = 422; e.code = 'id'; throw e;
    }
    if (st !== RE_STATUS.UNKLAR) { const e = new Error('Nur ein unklares Kennzeichen kann als angelegt markiert werden.'); e.status = 409; e.code = 'kennzeichen'; throw e; }
    return { id };
  }
  const e = new Error('Aktion unbekannt.'); e.status = 422; throw e;
}

/** Chat-Text bei Fehler/unklar: nur AU-Nummern und Anzahl, keine Betraege, keine Namen. */
export const chatText = ({ ergebnis, auftragNrn, grund }) =>
  `⚠️ Lexware-Rechnungsentwurf ${ergebnis === 'unklar' ? 'UNKLAR (bitte in Lexware nachsehen, nicht erneut senden)' : 'fehlgeschlagen'}: ${auftragNrn.length} Auftrag/Aufträge (${auftragNrn.join(', ')})${grund ? ` – ${grund}` : ''}.`;
