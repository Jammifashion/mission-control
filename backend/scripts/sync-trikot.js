// Täglicher Trikot-Sync: WC-Bestellungen → Business-Sheet, Reiter "Trikots".
//
// Aufruf:
//   node backend/scripts/sync-trikot.js                     # ab jüngstem Bestelldatum im Reiter
//   node backend/scripts/sync-trikot.js --after=2026-09-01  # erster Lauf / expliziter Start
//   node backend/scripts/sync-trikot.js --dry-run           # nichts schreiben, nur zählen
//
// Welche Artikel erfasst werden, steuert allein der Reiter "Trikot_Artikel".
// Bestehende Zeilen werden nie aktualisiert, nur neue angehängt (Dedup über
// Zeilen-ID = orderId|orderItemId|laufnummer). Die manuellen Spalten
// Charge..Notiz schreibt dieses Skript nicht.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient } from '../lib/shopConfig.js';
import {
  TAB_TRIKOTS, TAB_ARTIKEL, WC_STATES_TRIKOT,
  parseArtikel, buildRowsForOrder, resolveTrikotColumns, toSheetRow,
  existingIds, juengstesBestelldatum,
} from '../utils/trikot-logic.js';

const SPREADSHEET_ID = process.env.BUSINESS_SHEET_ID;
const APPEND_CHUNK   = 500;

function parseArgs(argv) {
  const args = { after: null, dryRun: false };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--after=')) {
      const v = a.slice('--after='.length).trim();
      if (v === '') continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`--after erwartet YYYY-MM-DD, bekommen: "${v}"`);
      args.after = v;
    } else {
      throw new Error(`Unbekanntes Argument: ${a}`);
    }
  }
  return args;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!SPREADSHEET_ID) throw new Error('BUSINESS_SHEET_ID fehlt.');

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const wc     = getWcClient('jfn');

  const [{ data: artData }, { data: trkData }] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `'${TAB_ARTIKEL}'`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: `'${TAB_TRIKOTS}'`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
  ]);

  const artikel = parseArtikel(artData.values);
  if (artikel.productIds.size === 0 && artikel.skus.size === 0) {
    throw new Error(`Keine aktiven Artikel in "${TAB_ARTIKEL}" – nichts zu tun.`);
  }
  console.log(`Aktive Artikel: ${artikel.productIds.size} Produkt-ID(s), ${artikel.skus.size} Artikelnummer(n)`);

  const trkValues = trkData.values ?? [];
  const cols      = resolveTrikotColumns(trkValues[0] ?? []);
  const bestand   = existingIds(trkValues);

  const afterDate = args.after ?? juengstesBestelldatum(trkValues);
  if (!afterDate) {
    throw new Error(`"${TAB_TRIKOTS}" enthält noch kein Bestelldatum – erster Lauf braucht --after=YYYY-MM-DD.`);
  }
  console.log(`Lade WC-Bestellungen ab ${afterDate} (Status: ${WC_STATES_TRIKOT.join(', ')})${args.dryRun ? ' – DRY RUN' : ''}`);

  const orders    = await loadOrders(wc, afterDate);
  const erfasstAm = jetztBerlin();

  const neu = [];
  let dubletten = 0;
  for (const order of orders) {
    for (const obj of buildRowsForOrder(order, artikel, erfasstAm)) {
      const id = obj['Zeilen-ID'];
      if (bestand.has(id)) { dubletten++; continue; }
      bestand.add(id);
      neu.push(obj);
    }
  }

  if (args.dryRun) {
    for (const o of neu) {
      console.log(`  + ${o['Zeilen-ID']}  ${o['Groesse'] || '-'}  ${o['Name'] || '-'}/${o['Nummer'] || '-'}  x${o['Stueck']}  [${o['Quelle']}]`);
    }
  } else {
    const rows = neu.map(o => toSheetRow(cols, o));
    for (let i = 0; i < rows.length; i += APPEND_CHUNK) {
      await sheets.spreadsheets.values.append({
        spreadsheetId:    SPREADSHEET_ID,
        range:            `'${TAB_TRIKOTS}'!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody:      { values: rows.slice(i, i + APPEND_CHUNK) },
      });
    }
  }

  console.log('─'.repeat(50));
  console.log(`Gelesene Bestellungen:   ${orders.length}`);
  console.log(`Neue Zeilen:             ${neu.length}${args.dryRun ? ' (nicht geschrieben)' : ''}`);
  console.log(`Übersprungene Dubletten: ${dubletten}`);
}

main().catch(err => {
  console.error('✗ Trikot-Sync fehlgeschlagen:', err.message ?? err);
  process.exit(1);
});
