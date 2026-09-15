// Sheets-Zugriff fuer die Bereinigung von Verkaufszeilen vor Vertrag-ab.
// Logik und Schutzregeln: utils/vertragsbeginn-bereinigung.js.
// Aufrufer: POST /api/kalkulation/verkaeufe/vor-vertragsbeginn (hinter requireApiKey).
//
// Bewusst kein console-Aufruf: Die Zeilen enthalten Partner-Umsaetze, sie
// gehoeren in die API-Antwort, nicht in ein Log.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { baueVertragsbeginne } from '../utils/partner-kalkulation.js';
import { verkaufsSpalten } from '../utils/abrechnung-zeilen.js';
import { requireHeader } from '../utils/sheet-headers.js';
import {
  waehleZeilen, pruefeFreigabe, baueLoeschRequests, zeileFuerAntwort, betrag, round2, fehler,
} from '../utils/vertragsbeginn-bereinigung.js';

const text = v => String(v ?? '').trim();
const toDE = d => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;

async function readTab(sheets, spreadsheetId, tab) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:Z` });
  const [header, ...rows] = data.values ?? [];
  rows.forEach((r, i) => { r._sheetRow = i + 2; });   // vor dem Filtern – Leerzeilen zaehlen mit
  return { header: header ?? [], rows: rows.filter(r => r.some(c => text(c) !== '')) };
}

/**
 * @param {Object} o
 * @param {string} o.spreadsheetId
 * @param {string} o.tab                 Verkaeufe-Reiter des Shops
 * @param {string} o.partnerId
 * @param {boolean} o.loeschen
 * @param {number|null} o.erwarteteZeilen
 * @param {number|null} o.erwarteteSumme
 */
export async function bereinigeVorVertragsbeginn({ spreadsheetId, tab, partnerId, loeschen, erwarteteZeilen, erwarteteSumme }) {
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });

  const partnerTab = await readTab(sheets, spreadsheetId, 'Partner');
  const beginn = baueVertragsbeginne(partnerTab.header, partnerTab.rows)(partnerId);   // ungueltig → 500
  if (!beginn) throw fehler(409, `Partner ${partnerId} hat kein Vertrag-ab – nichts auszuwählen.`);

  const vTab    = await readTab(sheets, spreadsheetId, tab);
  const auswahl = waehleZeilen({ header: vTab.header, rows: vTab.rows, partnerId, beginn });
  const freigabe = pruefeFreigabe({ loeschen, erwarteteZeilen, erwarteteSumme }, auswahl);

  const basis = {
    partnerId, tab,
    vertragAb:   toDE(beginn),
    anzahl:      auswahl.anzahl,
    summe:       auswahl.summe,
    abgerechnet: auswahl.abgerechnet.length,
    waisen:      auswahl.waisen.length,
    bleiben:     auswahl.bleiben,
    freigabe,
    zeilen:      auswahl.zeilen.map(r => zeileFuerAntwort(r, auswahl.spalten)),
  };
  if (!freigabe.loeschen) return { ...basis, geloescht: false };

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const gid  = meta.data.sheets.find(s => s.properties.title === tab)?.properties.sheetId;
  if (gid === undefined) throw fehler(500, `Reiter "${tab}" nicht gefunden.`);

  const requests = baueLoeschRequests(gid, auswahl.zeilen);
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  // Kontrolllesung: frisch aus dem Sheet, nicht aus der Auswahl gerechnet.
  const nachher = await readTab(sheets, spreadsheetId, tab);
  const spN  = verkaufsSpalten(nachher.header);
  const lizN = requireHeader(nachher.header, 'Lizenzgebühr', 'Verkaeufe');
  const rest = nachher.rows.filter(r => text(r[spN.partner]) === partnerId);

  return {
    ...basis,
    geloescht: true,
    kontrolle: {
      zeilen: rest.length,
      summe:  round2(rest.reduce((s, r) => s + (Number.isFinite(betrag(r[lizN])) ? betrag(r[lizN]) : 0), 0)),
    },
  };
}
