// DSGVO-Pruefliste (FIX4). Logik utils/kunde-fundstellen.js. Nur lesen, ausser `leereFundstellen` (je Bereich,
// nach Rueckfrage in MC): frisch gelesen, Compare-and-Set je Zelle (lib/loeschlauf.js leereZellen), zurueckgelesen.
// Auftraege/Aufgaben unter der Auftrags-Sperre, Bestellseite unter der Bestellseiten-Sperre. Nur Anzahlen nach aussen.
import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { leseKunden } from './kunden.js';
import { mitAuftragSperre } from './auftraege.js';
import { mitSperre as mitBestellSperre } from './bestellseite.js';
import { leereZellen } from './loeschlauf.js';
import { fundstellenPlan, fundstellenAntwort, BEREICHE } from '../utils/kunde-fundstellen.js';

const TABS = {
  auftraege: ['ssot', 'Auftraege'], positionen: ['ssot', 'Auftrag_Positionen'], aufgaben: ['ssot', 'Aufgaben'],
  bestellseiten: ['ssot', 'Bestellseiten'], eintraege: ['ssot', 'Bestell_Eintraege'],
  trikots: ['business', 'Trikots'], anfragen: ['business', 'Kundenanfragen'], verlauf: ['business', 'Kundenanfragen_Verlauf'],
};
const ZIEL = { auftraege: 'auftraege', positionen: 'positionen', aufgaben: 'aufgaben', bestellseite: 'eintraege', trikots: 'trikots', anfragen: 'anfragen', verlauf: 'verlauf' };

const fehler = (msg, status = 400, code) => Object.assign(new Error(msg), { status, ...(code ? { code } : {}) });

async function lesen(sheets) {
  const id = { ssot: process.env.GOOGLE_SHEET_ID, business: process.env.BUSINESS_SHEET_ID };
  const d = {};
  for (const [k, [sheet, tab]] of Object.entries(TABS)) {
    try { d[k] = (await sheets.spreadsheets.values.get({ spreadsheetId: id[sheet], range: `'${tab}'`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? []; }
    catch { d[k] = []; }   // Reiter fehlt = keine Fundstelle
  }
  return { d, id };
}

async function kundeVon(kundenNr) {
  const nr = String(kundenNr ?? '').trim();
  if (!/^K-\d{5}$/.test(nr)) throw fehler('Kunden-Nr. ungültig.', 422);
  const { kunden } = await leseKunden({});
  const k = kunden.find(x => x.Kunden_Nr === nr);
  if (!k) throw fehler(`Kunde ${nr} gibt es nicht.`, 404);
  return k;
}

/** Pruefliste: je Bereich Anzahl Zeilen/Zellen. Vor dem Sperren aufrufen (danach fehlen Name/Mail fuer die Suche). */
/** KA2: Kunde vor der DSGVO-Sperre lesen (Name/Mail fuer die Verlauf-Zuordnung). */
export async function kundeFuerSperre(kundenNr) { return kundeVon(kundenNr); }

export async function leseFundstellen({ kundenNr, sheets: s } = {}) {
  const k = await kundeVon(kundenNr);
  const sheets = s ?? google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const { d } = await lesen(sheets);
  return { kundenNr: k.Kunden_Nr, bereiche: fundstellenAntwort(fundstellenPlan({ kundenNr: k.Kunden_Nr, kunde: k, ...d })) };
}

/**
 * Einen Bereich leeren (nach Rueckfrage). -> { bereich, geleert } (Zellen).
 * KA2: "anfragen" leert den Gespraechsverlauf derselben Anfragen mit (danach waere er ueber Name/Mail nicht mehr zu finden).
 * `kunde` = vor einer DSGVO-Sperre gelesener Stand (danach fehlen Name/Mail fuer die Zuordnung).
 */
export async function leereFundstellen({ kundenNr, bereich, kunde, sheets: s } = {}) {
  if (!BEREICHE[bereich]) throw fehler('Bereich unbekannt.', 422);
  const k = kunde ?? await kundeVon(kundenNr);
  const sheets = s ?? google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const sperre = ['auftraege', 'positionen', 'aufgaben'].includes(bereich) ? mitAuftragSperre
    : bereich === 'bestellseite' ? mitBestellSperre : fn => fn();
  return sperre(async () => {
    const { d, id } = await lesen(sheets);
    const plan = fundstellenPlan({ kundenNr: k.Kunden_Nr, kunde: k, ...d })[bereich];
    let geleert = 0;
    if (bereich === 'anfragen') {
      const v = fundstellenPlan({ kundenNr: k.Kunden_Nr, kunde: k, ...d }).verlauf;
      geleert += await leereZellen(sheets, id.business, TABS.verlauf[1], v);
    }
    const [sheet, tab] = TABS[ZIEL[bereich]];
    geleert += await leereZellen(sheets, id[sheet], tab, plan);
    return { kundenNr: k.Kunden_Nr, bereich, geleert };
  });
}
