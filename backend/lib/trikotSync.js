// Trikot-Sync: WC-Bestellungen → Business-Sheet, Reiter "Trikots".
//
// Einzige Implementierung. Aufrufer:
//  - POST /api/trikot/sync            (routes/trikot.js, täglicher GitHub-Workflow)
//  - backend/scripts/sync-trikot.js   (lokales Werkzeug)
//
// Hier liegen nur die Zugriffe auf WooCommerce und Google Sheets. Was aus einer
// Bestellung wird (Zeilen, Quelle, Dedup-Schlüssel), steht in utils/trikot-logic.js.
//
// Bestehende Zeilen werden nie aktualisiert, nur neue angehängt (Dedup über
// Zeilen-ID = orderId|orderItemId|laufnummer). Die manuellen Spalten
// Charge..Notiz schreibt der Sync nicht.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { getWcClient } from './shopConfig.js';
import {
  TAB_TRIKOTS, TAB_ARTIKEL, WC_STATES_TRIKOT,
  parseArtikel, buildRowsForOrder, resolveTrikotColumns, toSheetRow,
  existingIds, juengstesBestelldatum,
} from '../utils/trikot-logic.js';

const APPEND_CHUNK = 500;

// status landet über den Express-Errorhandler direkt in der HTTP-Antwort.
export class TrikotSyncError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name   = 'TrikotSyncError';
    this.status = status;
  }
}

// after: fehlt/leer → null, sonst gültiges YYYY-MM-DD. dryRun: fehlt → false, sonst boolean.
export function parseSyncOptions({ after, dryRun } = {}) {
  let afterDate = null;
  if (after !== undefined && after !== null && after !== '') {
    const v = typeof after === 'string' ? after.trim() : '';
    const gueltig = /^\d{4}-\d{2}-\d{2}$/.test(v)
      && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
      && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
    if (!gueltig) throw new TrikotSyncError(`after erwartet YYYY-MM-DD, bekommen: ${JSON.stringify(after)}`);
    afterDate = v;
  }
  if (dryRun !== undefined && typeof dryRun !== 'boolean') {
    throw new TrikotSyncError(`dryRun erwartet true oder false, bekommen: ${JSON.stringify(dryRun)}`);
  }
  return { after: afterDate, dryRun: dryRun === true };
}

// Erfasst_Am in deutscher Ortszeit, im selben Format wie WC date_created.
function jetztBerlin() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(' ', 'T');
}

async function loadOrders(wc, afterDate) {
  const orders = [];
  for (let page = 1; ; page++) {
    const res = await wc.get('orders', {
      after:    `${afterDate}T00:00:00`,
      status:   WC_STATES_TRIKOT.join(','),
      orderby:  'date',
      order:    'asc',
      per_page: 100,
      page,
    });
    orders.push(...res.data);
    const totalPages = parseInt(res.headers?.['x-wp-totalpages'] ?? '1', 10) || 1;
    if (page >= totalPages || res.data.length === 0) break;
  }
  return orders;
}

// Liefert { gelesen, neu, dubletten, quellen, ab, dryRun, zeilen }.
// zeilen: die neuen Zeilen als Objekte (für die Ausgabe des lokalen Skripts).
export async function runTrikotSync(opts = {}) {
  const { after, dryRun } = parseSyncOptions(opts);
  const spreadsheetId = process.env.BUSINESS_SHEET_ID;
  if (!spreadsheetId) throw new TrikotSyncError('BUSINESS_SHEET_ID fehlt.', 503);

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const wc     = getWcClient('jfn');

  const [{ data: artData }, { data: trkData }] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId, range: `'${TAB_ARTIKEL}'`, valueRenderOption: 'UNFORMATTED_VALUE',
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId, range: `'${TAB_TRIKOTS}'`, valueRenderOption: 'UNFORMATTED_VALUE',
    }),
  ]);

  const artikel = parseArtikel(artData.values);
  if (artikel.productIds.size === 0 && artikel.skus.size === 0) {
    throw new TrikotSyncError(`Keine aktiven Artikel in "${TAB_ARTIKEL}" – nichts zu tun.`, 422);
  }

  const trkValues = trkData.values ?? [];
  const cols      = resolveTrikotColumns(trkValues[0] ?? []);
  const bestand   = existingIds(trkValues);

  const ab = after ?? juengstesBestelldatum(trkValues);
  if (!ab) {
    throw new TrikotSyncError(`"${TAB_TRIKOTS}" enthält noch kein Bestelldatum – erster Lauf braucht after (YYYY-MM-DD).`);
  }

  const orders    = await loadOrders(wc, ab);
  const erfasstAm = jetztBerlin();

  const zeilen  = [];
  const quellen = { addon: 0, variante: 0, notiz: 0 };
  let dubletten = 0;
  for (const order of orders) {
    for (const obj of buildRowsForOrder(order, artikel, erfasstAm)) {
      const id = obj['Zeilen-ID'];
      if (bestand.has(id)) { dubletten++; continue; }
      bestand.add(id);
      zeilen.push(obj);
      quellen[obj['Quelle']] = (quellen[obj['Quelle']] ?? 0) + 1;
    }
  }

  if (!dryRun) {
    const rows = zeilen.map(o => toSheetRow(cols, o));
    for (let i = 0; i < rows.length; i += APPEND_CHUNK) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range:            `'${TAB_TRIKOTS}'!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody:      { values: rows.slice(i, i + APPEND_CHUNK) },
      });
    }
  }

  return {
    gelesen:  orders.length,
    neu:      zeilen.length,
    dubletten,
    quellen,
    ab,
    dryRun,
    zeilen,
  };
}
