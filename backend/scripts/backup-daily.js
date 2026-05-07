import dotenv from 'dotenv';
dotenv.config();

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';
import { Readable } from 'stream';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive',
];

// ── Auth ──────────────────────────────────────────────────────────────────────
function getAuth() {
  let credentials;

  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    } catch {
      throw new Error('GOOGLE_CREDENTIALS_JSON ist kein gültiges JSON.');
    }
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    const keyPath   = resolve(__dirname, '..', process.env.GOOGLE_APPLICATION_CREDENTIALS);
    credentials     = JSON.parse(readFileSync(keyPath, 'utf8'));
  } else {
    return new google.auth.GoogleAuth({ scopes: SCOPES });
  }

  return new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
}

// ── Backup-Logik (exportiert für Route-Wiederverwendung) ──────────────────────
export async function runBackup() {
  // Env-Vars hier lesen (nicht auf Top-Level) damit sie beim Import via Express schon gesetzt sind
  const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
  const SHARED_DRIVE   = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID;
  const DAILY_FOLDER   = process.env.GOOGLE_DRIVE_BACKUP_DAILY_ID;
  const MONTHLY_FOLDER = process.env.GOOGLE_DRIVE_BACKUP_MONTHLY_ID;

  if (!SPREADSHEET_ID) throw new Error('GOOGLE_SHEET_ID fehlt in .env');
  if (!SHARED_DRIVE)   throw new Error('GOOGLE_DRIVE_SHARED_DRIVE_ID fehlt in .env');
  if (!DAILY_FOLDER)   throw new Error('GOOGLE_DRIVE_BACKUP_DAILY_ID fehlt in .env');
  if (!MONTHLY_FOLDER) throw new Error('GOOGLE_DRIVE_BACKUP_MONTHLY_ID fehlt in .env');

  const auth   = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const drive  = google.drive({ version: 'v3', auth });

  // ── Alle Reiter ermitteln ─────────────────────────────────────────────────
  const { data: meta } = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'properties.title,sheets.properties',
  });
  const sheetName = meta.properties?.title ?? '';
  const tabTitles = meta.sheets.map(s => s.properties.title);

  // ── Alle Reiter parallel einlesen ─────────────────────────────────────────
  const tabData = {};
  await Promise.all(tabTitles.map(async title => {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${title}`,
    });
    tabData[title] = data.values ?? [];
  }));

  // ── JSON bauen + komprimieren ─────────────────────────────────────────────
  const now     = new Date();
  const payload = {
    exportedAt: now.toISOString(),
    sheetId:    SPREADSHEET_ID,
    sheetName,
    tabCount:   tabTitles.length,
    tabs:       tabData,
  };
  const jsonBuf  = Buffer.from(JSON.stringify(payload), 'utf8');
  const gzipBuf  = gzipSync(jsonBuf);
  const sizeKB   = Math.round(gzipBuf.length / 1024);

  // ── Dateinamen ────────────────────────────────────────────────────────────
  const dateStr  = now.toISOString().slice(0, 10);            // YYYY-MM-DD
  const monthStr = now.toISOString().slice(0, 7);             // YYYY-MM
  const dailyName   = `MC-Backup-${dateStr}.json.gz`;
  const monthlyName = `MC-Backup-${monthStr}.json.gz`;

  // ── In Daily-Ordner hochladen ─────────────────────────────────────────────
  const dailyFile = await drive.files.create({
    requestBody: {
      name:     dailyName,
      parents:  [DAILY_FOLDER],
      mimeType: 'application/gzip',
    },
    media: {
      mimeType: 'application/gzip',
      body:     Readable.from(gzipBuf),
    },
    supportsAllDrives: true,
    fields: 'id,name,size',
  });
  console.log(`✓ Daily-Backup hochgeladen: ${dailyName} (${sizeKB} KB, ${tabTitles.length} Reiter)`);

  // ── Monthly-Backup (nur am 1. des Monats) ─────────────────────────────────
  if (now.getDate() === 1) {
    await drive.files.create({
      requestBody: {
        name:     monthlyName,
        parents:  [MONTHLY_FOLDER],
        mimeType: 'application/gzip',
      },
      media: {
        mimeType: 'application/gzip',
        body:     Readable.from(gzipBuf),
      },
      supportsAllDrives: true,
      fields: 'id,name',
    });
    console.log(`✓ Monthly-Backup hochgeladen: ${monthlyName}`);
  }

  // ── Cleanup Daily (> 30 Tage) ─────────────────────────────────────────────
  const cutoffDaily = new Date(now);
  cutoffDaily.setDate(cutoffDaily.getDate() - 30);
  await cleanupFolder(drive, DAILY_FOLDER, SHARED_DRIVE, cutoffDaily, 'Daily');

  // ── Cleanup Monthly (> 12 Monate) ────────────────────────────────────────
  const cutoffMonthly = new Date(now);
  cutoffMonthly.setMonth(cutoffMonthly.getMonth() - 12);
  await cleanupFolder(drive, MONTHLY_FOLDER, SHARED_DRIVE, cutoffMonthly, 'Monthly');

  return { fileName: dailyName, sizeKB, tabCount: tabTitles.length, fileId: dailyFile.data.id };
}

async function cleanupFolder(drive, folderId, sharedDriveId, cutoff, label) {
  const { data } = await drive.files.list({
    q:                       `'${folderId}' in parents and trashed = false`,
    fields:                  'files(id,name,createdTime)',
    orderBy:                 'createdTime',
    pageSize:                200,
    supportsAllDrives:       true,
    includeItemsFromAllDrives: true,
    corpora:                 'drive',
    driveId:                 sharedDriveId,
  });
  const toDelete = (data.files ?? []).filter(f => new Date(f.createdTime) < cutoff);
  for (const f of toDelete) {
    await drive.files.delete({ fileId: f.id, supportsAllDrives: true });
    console.log(`  ✗ ${label} gelöscht: ${f.name} (${f.createdTime.slice(0,10)})`);
  }
  if (toDelete.length === 0) console.log(`  – ${label} Cleanup: nichts zu löschen`);
}

// ── Direktausführung (node backend/scripts/backup-daily.js) ──────────────────
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && (process.argv[1] === __filename || __filename.endsWith(process.argv[1].replace(/\\/g, '/')))) {
  console.log('== Mission Control Backup ==');
  runBackup()
    .then(r => console.log(`\nFertig: ${r.fileName} | ${r.sizeKB} KB | ${r.tabCount} Reiter`))
    .catch(err => { console.error('FEHLER:', err.message ?? err); process.exit(1); });
}
