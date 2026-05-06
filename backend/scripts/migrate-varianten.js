import dotenv from 'dotenv';
dotenv.config();
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const SPREADSHEET_ID   = process.env.GOOGLE_SHEET_ID;
const TAB_ERFASSUNG    = 'Erfassungsmaske';
const TAB_VARIANTEN    = 'Varianten';
const VARIANTEN_HEADER = [
  'SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3',
  'Preis', 'Aktiv', 'WC_Variation_ID', 'Google_Farbe',
];

async function main() {
  if (!SPREADSHEET_ID) {
    console.error('Fehler: GOOGLE_SHEET_ID fehlt in .env');
    process.exit(1);
  }

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // ── Erfassungsmaske lesen ─────────────────────────────────────────────────
  const { data: erfData } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range:         `${TAB_ERFASSUNG}!A1:BZ2000`,
  });
  const erfRows    = erfData.values ?? [];
  const erfHeaders = erfRows[0] ?? [];

  const ssotIdx = erfHeaders.findIndex(h => /ssot.?id|^id$/i.test(h));
  if (ssotIdx < 0) {
    console.error('Fehler: SSOT-ID Spalte nicht gefunden in Erfassungsmaske');
    process.exit(1);
  }

  // ── Varianten-Reiter lesen (für Idempotenz-Prüfung) ──────────────────────
  const { data: varData } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range:         `${TAB_VARIANTEN}!A1:L2000`,
  });
  const varRows = varData.values ?? [];

  // SSOT-IDs die bereits im Varianten-Reiter vorhanden sind
  const existingSsotIds = new Set(
    varRows.slice(1).map(r => (r[0] ?? '').trim()).filter(Boolean)
  );

  // ── B-Slot Spalten im Header lokalisieren ─────────────────────────────────
  // Erwartet Muster: B1_E1, B1_V1, B1_E2, B1_V2, B1_E3, B1_V3, B1_Preis, B1_Google_Farbe
  function findBSlotIndices(headers) {
    const slots = {};
    headers.forEach((h, i) => {
      const m = h.match(/^B(\d+)_(E1|V1|E2|V2|E3|V3|Preis|Google_Farbe)$/i);
      if (!m) return;
      const nr  = parseInt(m[1], 10);
      const key = m[2].toLowerCase().replace('_farbe', 'Farbe');
      if (!slots[nr]) slots[nr] = {};
      slots[nr][m[2]] = i;
    });
    return slots;
  }

  const bSlots = findBSlotIndices(erfHeaders);
  const slotNrs = Object.keys(bSlots).map(Number).sort((a, b) => a - b);

  if (slotNrs.length === 0) {
    console.log('Keine B-Slot Spalten in der Erfassungsmaske gefunden – nichts zu migrieren.');
    return;
  }
  console.log(`Erkannte B-Slots: B${slotNrs[0]}–B${slotNrs[slotNrs.length - 1]}`);

  // ── Pro Artikel migrieren ─────────────────────────────────────────────────
  const newRows = [];
  let migratedCount = 0;
  let skippedCount  = 0;

  for (let i = 1; i < erfRows.length; i++) {
    const row    = erfRows[i];
    const ssotId = (row[ssotIdx] ?? '').trim();
    if (!ssotId) continue;

    if (existingSsotIds.has(ssotId)) {
      console.log(`${ssotId} → übersprungen (bereits im Varianten-Reiter)`);
      skippedCount++;
      continue;
    }

    let variantenNr = 0;
    const artikelRows = [];

    for (const nr of slotNrs) {
      const slot = bSlots[nr];

      const e1          = slot['E1']           !== undefined ? (row[slot['E1']]           ?? '').trim() : '';
      const v1          = slot['V1']           !== undefined ? (row[slot['V1']]           ?? '').trim() : '';
      const e2          = slot['E2']           !== undefined ? (row[slot['E2']]           ?? '').trim() : '';
      const v2          = slot['V2']           !== undefined ? (row[slot['V2']]           ?? '').trim() : '';
      const e3          = slot['E3']           !== undefined ? (row[slot['E3']]           ?? '').trim() : '';
      const v3          = slot['V3']           !== undefined ? (row[slot['V3']]           ?? '').trim() : '';
      const preis       = slot['Preis']        !== undefined ? (row[slot['Preis']]        ?? '').trim() : '';
      const googleFarbe = slot['Google_Farbe'] !== undefined ? (row[slot['Google_Farbe']] ?? '').trim() : '';

      // Slot gilt als gefüllt wenn mindestens V1 gesetzt ist
      if (!v1) continue;

      variantenNr++;
      artikelRows.push([
        ssotId,
        variantenNr,
        e1, v1,
        e2, v2,
        e3, v3,
        preis,
        true,   // Aktiv als Boolean
        '',     // WC_Variation_ID leer
        googleFarbe,
      ]);
    }

    if (artikelRows.length === 0) continue;

    newRows.push(...artikelRows);
    console.log(`${ssotId} → ${artikelRows.length} Variante${artikelRows.length !== 1 ? 'n' : ''} migriert`);
    migratedCount++;
  }

  // ── Neue Zeilen in Varianten-Reiter schreiben ─────────────────────────────
  if (newRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId:    SPREADSHEET_ID,
      range:            `${TAB_VARIANTEN}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody:      { values: newRows },
    });
  }

  console.log('\n─────────────────────────────────────');
  console.log(`Migration abgeschlossen.`);
  console.log(`  Artikel migriert:   ${migratedCount}`);
  console.log(`  Artikel übersprungen: ${skippedCount}`);
  console.log(`  Zeilen gesamt neu:  ${newRows.length}`);
}

main().catch(err => {
  console.error('Fehler:', err.message ?? err);
  process.exit(1);
});
