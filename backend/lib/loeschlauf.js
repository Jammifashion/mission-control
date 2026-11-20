// Datenschutz-Loeschlauf (FIX4). Logik in utils/loeschlauf.js, Drucknamen in lib/auftraege.js (SA4).
// Ohne `scharf` nur zaehlen. Scharf: je Bereich frisch lesen, die zu leerenden Zellen unmittelbar vorher noch einmal
// einzeln lesen (Wert unveraendert, sonst diese Zelle auslassen), EIN values.batchUpdate RAW mit '' je Bereich,
// zurueckgelesen. Bestellseite unter der Bestellseiten-Sperre. Antwort/Log nur Anzahlen, nie Inhalte.
import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { spalteBuchstabe } from './sheet-zeilen.js';
import { mitSperre as mitBestellSperre } from './bestellseite.js';
import { leereDrucknamen } from './auftraege.js';
import { bestellEintraegePlan, trikotsPlan, anfragenPlan } from '../utils/loeschlauf.js';

const q = tab => `'${tab}'`;
const lies = async (sheets, spreadsheetId, tab) =>
  (await sheets.spreadsheets.values.get({ spreadsheetId, range: q(tab), valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];

/** Zellen leeren (Compare-and-Set je Zelle). -> Anzahl geleerter Zellen. */
export async function leereZellen(sheets, spreadsheetId, tab, plan) {
  const ziele = plan.leeren.flatMap(z => z.zellen.map(c => ({
    range: `${q(tab)}!${spalteBuchstabe(plan.kopf.indexOf(c.feld))}${z.zeile}`, alt: c.alt,
  })));
  if (!ziele.length) return 0;
  const { data } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ziele.map(x => x.range), valueRenderOption: 'UNFORMATTED_VALUE' });
  const gleich = ziele.filter((x, i) => String(data.valueRanges?.[i]?.values?.[0]?.[0] ?? '') === String(x.alt ?? ''));
  if (!gleich.length) return 0;
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: gleich.map(x => ({ range: x.range, values: [['']] })) } });
  const { data: zurueck } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: gleich.map(x => x.range) });
  const nichtLeer = gleich.filter((x, i) => String(zurueck.valueRanges?.[i]?.values?.[0]?.[0] ?? '') !== '').length;
  if (nichtLeer) throw Object.assign(new Error(`${tab}: ${nichtLeer} Zelle(n) nach dem Leeren nicht leer`), { status: 500, code: 'ruecklesen' });
  return gleich.length;
}

/**
 * @param {{ scharf?: boolean, jetzt?: () => Date, sheets?: object }} o
 * @returns {{ scharf, ergebnis: { [bereich]: { zaehler, geleert } | { fehler } } }}
 */
export async function loeschlauf({ scharf = false, jetzt = () => new Date(), sheets: s } = {}) {
  const sheets = s ?? google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const ssot = process.env.GOOGLE_SHEET_ID, business = process.env.BUSINESS_SHEET_ID;
  const nun = jetzt();
  const ergebnis = {};
  const bereich = async (name, fn) => {
    try { ergebnis[name] = await fn(); }
    catch (e) { ergebnis[name] = { fehler: String(e.code || e.status || 'Fehler').slice(0, 40) }; }
  };

  await bereich('Bestellseite', () => mitBestellSperre(async () => {
    const plan = bestellEintraegePlan({ eintraege: await lies(sheets, ssot, 'Bestell_Eintraege'), termine: await lies(sheets, ssot, 'Bestell_Termine'), jetzt: nun });
    return { zaehler: plan.zaehler, geleert: scharf ? await leereZellen(sheets, ssot, 'Bestell_Eintraege', plan) : 0 };
  }));
  await bereich('Trikots', async () => {
    const plan = trikotsPlan({ trikots: await lies(sheets, business, 'Trikots'), jetzt: nun });
    return { zaehler: plan.zaehler, geleert: scharf ? await leereZellen(sheets, business, 'Trikots', plan) : 0 };
  });
  await bereich('Kundenanfragen', async () => {
    const plan = anfragenPlan({ anfragen: await lies(sheets, business, 'Kundenanfragen'), auftraege: await lies(sheets, ssot, 'Auftraege'), jetzt: nun });
    return { zaehler: plan.zaehler, geleert: scharf ? await leereZellen(sheets, business, 'Kundenanfragen', plan) : 0 };
  });
  await bereich('Drucknamen', async () => {
    const d = await leereDrucknamen({ write: scharf, sheets, jetzt });
    return { zaehler: { faellig: d.leeren, ...(d.zaehler ?? {}) }, geleert: d.geschrieben ? d.leeren : 0 };
  });
  return { scharf, ergebnis };
}
