// GT1 B2 (AUD1): Pflichtspalten der Geld-Reiter an EINER Stelle. Die Reiter-Leser der Geld-Routen (kalkulation, partnerPortal,
// festpreis-portal, festpreis-public, partner-artikel) pruefen nach jedem Lesen die Kopfzeile. Fehlt eine Pflichtspalte, gibt es einen
// lauten Fehler mit dem Spaltennamen (MissingHeaderError, 500) - nie still 0 ueber indexOf -1. Oeffentliche Router (Portale) geben bei 5xx
// nur den festen Text aus (middleware/fehlerHandler.js), Admin sieht den Spaltennamen.
// Hier stehen nur Spalten, die Betraege, Status oder die Zuordnung tragen. Spalten, die spaeter hinten angehaengt wurden (Sperre,
// Positions-ID, Porto_*, Versandmethode, Gutschrift_*, Kunden_Nr, Token_*, Detailansicht, Saldo_Kachel …), bleiben optional.
// Spalten nie umbenennen (Merkposten AUD1) - die Namen hier muessen exakt zur Kopfzeile passen (Vergleich ueber normHeader).

import { findHeader, MissingHeaderError } from './sheet-headers.js';

const LIZENZ_VERKAEUFE = ['Partner-ID', 'Datum', 'Order-ID', 'Stückzahl', 'Lizenzgebühr', 'Status', 'Produkt-ID', 'Storno-Status'];
const LIZENZ_ABRECHNUNGEN = ['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Saldo', 'Status'];

export const PFLICHT_SPALTEN = {
  'Partner_Verkäufe': LIZENZ_VERKAEUFE,
  'HK_Partner_Verkäufe': LIZENZ_VERKAEUFE,
  'Partner_Abrechnungen': LIZENZ_ABRECHNUNGEN,
  'HK_Partner_Abrechnungen': LIZENZ_ABRECHNUNGEN,
  'Partner_Interne_Bestellungen': ['Partner-ID', 'Datum', 'Bezeichnung', 'Summe', 'Status'],
  'Partner': ['Partner-ID'],
  'FP_Partner': ['Partner-ID'],
  'FP_Verkäufe': ['Partner-ID', 'Datum', 'WC-Bestellnummer', 'Stückzahl', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto', 'Status Abrechnung',
    'Produkt-ID', 'Storno-Status', 'VK-Netto', 'Festpreis', 'Handlingskosten'],
  'FP_Abrechnungen': ['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Gesamt-Netto', 'Gesamt-Brutto', 'Status'],
};

/**
 * Kopfzeile eines Geld-Reiters pruefen. Leere Reiter (keine Kopfzeile) gelten als "nicht eingerichtet" und werden nicht geprueft
 * (die Aufrufer behandeln sie wie bisher). Unbekannte Reiter: keine Pruefung.
 */
export function pruefePflichtSpalten(tab, header) {
  const name = String(tab ?? '').replace(/^'|'$/g, '').split('!')[0];
  const pflicht = PFLICHT_SPALTEN[name];
  if (!pflicht || !(header ?? []).length) return;
  const fehlt = pflicht.filter(s => findHeader(header, s) < 0);
  if (fehlt.length) throw new MissingHeaderError(fehlt, name, header);
}
