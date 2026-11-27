// Gespraechsverlauf des Kundenchats (KA2): Reiter `Kundenanfragen_Verlauf` im Business-Sheet. Logik utils/anfrage-verlauf.js.
// Schreiben nur beim Abschluss, ohne values.append (lib/sheet-zeilen.js), unter der Anfragen-Sperre. Inhalte nie ins Log.
import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { schreibeNeueZeilen } from './sheet-zeilen.js';
import { mitAnfragenSperre } from './anfragen.js';
import { TAB_VERLAUF, VERLAUF_SPALTEN, verlaufFuerSpeicher, verlaufFuerAnfrage } from '../utils/anfrage-verlauf.js';

async function sheetsClient() { return google.sheets({ version: 'v4', auth: await getGoogleAuth() }); }
function sheetId() {
  const id = process.env.BUSINESS_SHEET_ID;
  if (!id) throw Object.assign(new Error('BUSINESS_SHEET_ID nicht konfiguriert.'), { status: 503 });
  return id;
}
const lies = async (sheets, spreadsheetId) =>
  (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_VERLAUF}'`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];

/**
 * Verlauf einer gerade angelegten Anfrage speichern. Fehlt der Reiter oder sein Kopf -> Fehler mit code 'einrichtung'
 * (der Aufrufer loggt nur den Code; die Anfrage steht trotzdem).
 */
export async function speichereVerlauf({ anfrageId, nachrichten, antwort, sheets: s, jetzt = () => new Date() } = {}) {
  return mitAnfragenSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    let werte;
    try { werte = await lies(sheets, spreadsheetId); } catch { throw Object.assign(new Error('Verlauf-Reiter fehlt'), { code: 'einrichtung' }); }
    const kopf = (werte[0] ?? []).map(k => String(k).trim());
    const idx = Object.fromEntries(VERLAUF_SPALTEN.map(sp => [sp, kopf.indexOf(sp)]));
    if (Object.values(idx).some(i => i < 0)) throw Object.assign(new Error('Verlauf-Kopf unvollständig'), { code: 'einrichtung' });
    const zeile = Array.from({ length: kopf.length }, () => '');
    zeile[idx['Anfrage-ID']] = anfrageId;
    zeile[idx.Zeitpunkt] = jetzt().toISOString();
    zeile[idx.Nachrichten] = verlaufFuerSpeicher(nachrichten, antwort);
    await schreibeNeueZeilen(sheets, spreadsheetId, TAB_VERLAUF, [zeile], { alt: werte });
    return true;
  });
}

/** GET /api/anfragen/:id/verlauf - nur lesen. Fehlt der Reiter: status 'keiner'. */
export async function leseVerlauf({ anfrageId, sheets: s } = {}) {
  const sheets = s ?? await sheetsClient();
  let werte = [];
  try { werte = await lies(sheets, sheetId()); } catch { return { status: 'keiner' }; }
  return verlaufFuerAnfrage(werte, anfrageId);
}
