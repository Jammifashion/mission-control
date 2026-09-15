import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

import { google } from 'googleapis';
import { gzipSync } from 'zlib';
import { Readable } from 'stream';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive',
];

// ── Was gesichert wird ──────────────────────────────────────────────────────
//
// Befund B18: hier stand nur GOOGLE_SHEET_ID, also das SSOT-Sheet
// (JF_Master_Inventur_SSoT). Das Business-Sheet war in keinem einzigen Backup -
// weder Partner_Verkäufe noch Partner_Abrechnungen, Partner, Partner_Artikel
// oder Kalkulation_Fixkosten. Aufgefallen ist es, als in HK_Partner_Verkäufe
// 66 Zeilen fehlten und es nichts gab, woraus man sie hätte holen können.
//
// Beide Spreadsheets werden jetzt je in eine eigene Datei gesichert, am Präfix
// unterscheidbar. Fehlt eine der IDs, bricht der Lauf ab, bevor irgendetwas
// hochgeladen wird - ein halbes Backup, das wie ein vollständiges aussieht, ist
// schlimmer als keines.
export const ZIELE = [
  { praefix: 'SSOT',     envKey: 'GOOGLE_SHEET_ID' },
  { praefix: 'BUSINESS', envKey: 'BUSINESS_SHEET_ID' },
];

// ── Retention ───────────────────────────────────────────────────────────────
const DAILY_RETENTION_DAYS   = 14;
const MONTHLY_RETENTION_MONTHS = 12;

// Befund B19: Cloud Run laeuft als Dienstkonto mit Rolle Content-Manager auf
// der geteilten Ablage. files.delete verlangt Manager - alte Backups werden
// darum per files.update {trashed:true} in den Papierkorb verschoben.
//
// Angefasst werden nur Dateien, die dieses Skript schreibt oder geschrieben hat.
const BACKUP_PRAEFIXE = ZIELE.map(z => `${z.praefix}_Backup-`);

// Altlast, NUR für die Aufräumung: bis a3b9a1b (2026-09-11) hiessen die Dateien
// MC-Backup-<Datum>.json.gz (daily) und MC-Backup-<Monat>.json.gz (monthly).
// Geschrieben wird dieses Präfix nicht mehr - ohne diesen Eintrag lägen die
// alten Dateien aber für immer im Ordner, entgegen der Absicht von a3b9a1b.
// Kann raus, sobald keine MC-Backup-Datei mehr in daily/monthly liegt.
const ALTLAST_PRAEFIXE = ['MC-Backup-'];

export const AUFRAEUM_PRAEFIXE = [...BACKUP_PRAEFIXE, ...ALTLAST_PRAEFIXE];
const istBackupDatei = name => AUFRAEUM_PRAEFIXE.some(p => String(name ?? '').startsWith(p));

// ── Rate-Limit-Schutz für Cleanup ───────────────────────────────────────────
const DELETE_DELAY_MS   = 400;
const MAX_DELETE_RETRIES = 3;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fehlermeldungen landen im oeffentlichen Actions-Log. Drive- und
// Spreadsheet-IDs sind lange Tokens ohne Punkt - die werden ersetzt.
// Backup-Dateinamen bleiben lesbar: "BUSINESS_Backup-2026-09-15" hat selbst
// 26 Zeichen und wurde sonst ebenfalls zu <id>.
export function ohneIds(text) {
  return String(text ?? '').replace(/[A-Za-z0-9_-]{25,}/g,
    token => AUFRAEUM_PRAEFIXE.some(p => token.startsWith(p)) ? token : '<id>');
}

function isRateLimitError(err) {
  const code = err.code ?? err.response?.status;
  const message = (err.message ?? '').toLowerCase();
  return (code === 403 || code === 429) && message.includes('rate limit');
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function getAuth() {
  // GOOGLE_CREDENTIALS_JSON: JSON-String direkt (GitHub Actions Secret als Env-Var)
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    let credentials;
    try {
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    } catch {
      throw new Error('GOOGLE_CREDENTIALS_JSON ist kein gültiges JSON.');
    }
    return new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  }
  // GOOGLE_APPLICATION_CREDENTIALS: GoogleAuth liest den Pfad automatisch aus der Umgebung
  return new google.auth.GoogleAuth({ scopes: SCOPES });
}

// ── Ein Spreadsheet sichern ─────────────────────────────────────────────────
async function sichereSpreadsheet(sheets, drive, ziel, ctx) {
  const { praefix, id } = ziel;
  const { now, dailyFolder, monthlyFolder } = ctx;

  // ── Alle Reiter ermitteln ─────────────────────────────────────────────────
  const { data: meta } = await sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: 'properties.title,sheets.properties',
  });
  const sheetName = meta.properties?.title ?? '';
  const tabTitles = meta.sheets.map(s => s.properties.title);

  // ── Alle Reiter parallel einlesen ─────────────────────────────────────────
  const tabData = {};
  await Promise.all(tabTitles.map(async title => {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `${title}`,
    });
    tabData[title] = data.values ?? [];
  }));

  // ── JSON bauen + komprimieren ─────────────────────────────────────────────
  const payload = {
    exportedAt: now.toISOString(),
    sheetId:    id,
    sheetName,
    tabCount:   tabTitles.length,
    tabs:       tabData,
  };
  const jsonBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const gzipBuf = gzipSync(jsonBuf);
  const sizeKB  = Math.round(gzipBuf.length / 1024);

  // ── Dateinamen ────────────────────────────────────────────────────────────
  const dateStr     = now.toISOString().slice(0, 10);   // YYYY-MM-DD
  const monthStr    = now.toISOString().slice(0, 7);    // YYYY-MM
  const dailyName   = `${praefix}_Backup-${dateStr}.json.gz`;
  const monthlyName = `${praefix}_Backup-${monthStr}.json.gz`;

  // ── In Daily-Ordner hochladen ─────────────────────────────────────────────
  const dailyFile = await drive.files.create({
    requestBody: {
      name:     dailyName,
      parents:  [dailyFolder],
      mimeType: 'application/gzip',
    },
    media: {
      mimeType: 'application/gzip',
      body:     Readable.from(gzipBuf),
    },
    supportsAllDrives: true,
    fields: 'id,name,size',
  });
  console.log(`✓ Daily-Backup hochgeladen: ${dailyName} (${sizeKB} KB, ${tabTitles.length} Reiter, "${sheetName}")`);

  // ── Monthly-Backup (nur am 1. des Monats) ─────────────────────────────────
  if (now.getDate() === 1) {
    await drive.files.create({
      requestBody: {
        name:     monthlyName,
        parents:  [monthlyFolder],
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

  return {
    praefix,
    spreadsheetId: id,
    sheetName,
    fileName:      dailyName,
    sizeKB,
    tabCount:      tabTitles.length,
    fileId:        dailyFile.data.id,
  };
}

// ── Backup-Logik (exportiert für Route-Wiederverwendung) ──────────────────────
export async function runBackup() {
  // Env-Vars hier lesen (nicht auf Top-Level) damit sie beim Import via Express schon gesetzt sind
  const SHARED_DRIVE   = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID;
  const DAILY_FOLDER   = process.env.GOOGLE_DRIVE_BACKUP_DAILY_ID;
  const MONTHLY_FOLDER = process.env.GOOGLE_DRIVE_BACKUP_MONTHLY_ID;

  // Alle Spreadsheet-IDs zuerst, gesammelt: wer zwei Sheets sichern soll und nur
  // eine ID hat, darf nicht mit einem grünen Lauf und einer Datei enden.
  const ziele   = ZIELE.map(z => ({ ...z, id: process.env[z.envKey] }));
  const fehlend = ziele.filter(z => !z.id || !String(z.id).trim()).map(z => z.envKey);
  if (fehlend.length)
    throw new Error(
      `Spreadsheet-ID fehlt: ${fehlend.join(', ')} – kein Backup geschrieben. `
      + `Erwartet werden alle: ${ZIELE.map(z => z.envKey).join(', ')}.`,
    );

  if (!SHARED_DRIVE)   throw new Error('GOOGLE_DRIVE_SHARED_DRIVE_ID fehlt in .env');
  if (!DAILY_FOLDER)   throw new Error('GOOGLE_DRIVE_BACKUP_DAILY_ID fehlt in .env');
  if (!MONTHLY_FOLDER) throw new Error('GOOGLE_DRIVE_BACKUP_MONTHLY_ID fehlt in .env');

  const auth   = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const drive  = google.drive({ version: 'v3', auth });

  const now = new Date();
  const ctx = { now, dailyFolder: DAILY_FOLDER, monthlyFolder: MONTHLY_FOLDER };

  // Beide Ziele versuchen, auch wenn eines scheitert: die Datei, die sich
  // schreiben laesst, ist besser als keine. Der Lauf endet danach trotzdem rot.
  const backups = [];
  const fehler  = [];
  for (const ziel of ziele) {
    try {
      backups.push(await sichereSpreadsheet(sheets, drive, ziel, ctx));
    } catch (err) {
      // Keine Spreadsheet-ID in der Meldung: sie geht als error-Text ins
      // oeffentliche Actions-Log. Praefix und envKey reichen zum Zuordnen.
      const msg = ohneIds(err.message ?? err);
      fehler.push(`${ziel.praefix} (${ziel.envKey}): ${msg}`);
      console.error(`FEHLER bei ${ziel.praefix}: ${msg}`);
    }
  }

  // ── Cleanup Daily (> DAILY_RETENTION_DAYS) ────────────────────────────────
  // Fehler in der Bereinigung lassen den Lauf nicht scheitern - der nächste
  // Lauf holt das nach. Sie gehen als cleanupWarnungen an den Aufrufer.
  const cleanupWarnungen = [];
  // Gezählt wird jede tatsächlich verschobene Datei - auch wenn der Ordner
  // danach mit einem Fehler abbricht.
  const aufgeraeumt = { daily: 0, monthly: 0 };
  const cutoffDaily = new Date(now);
  cutoffDaily.setDate(cutoffDaily.getDate() - DAILY_RETENTION_DAYS);
  try {
    await cleanupFolder(drive, DAILY_FOLDER, cutoffDaily, 'Daily', () => aufgeraeumt.daily++);
  } catch (err) {
    const msg = `Daily-Cleanup fehlgeschlagen: ${ohneIds(err.message ?? err)}`;
    cleanupWarnungen.push(msg);
    console.warn(`WARNUNG: ${msg} – wird beim nächsten Lauf nachgeholt`);
  }

  // ── Cleanup Monthly (> MONTHLY_RETENTION_MONTHS) ─────────────────────────
  const cutoffMonthly = new Date(now);
  cutoffMonthly.setMonth(cutoffMonthly.getMonth() - MONTHLY_RETENTION_MONTHS);
  try {
    await cleanupFolder(drive, MONTHLY_FOLDER, cutoffMonthly, 'Monthly', () => aufgeraeumt.monthly++);
  } catch (err) {
    const msg = `Monthly-Cleanup fehlgeschlagen: ${ohneIds(err.message ?? err)}`;
    cleanupWarnungen.push(msg);
    console.warn(`WARNUNG: ${msg} – wird beim nächsten Lauf nachgeholt`);
  }

  if (fehler.length)
    throw new Error(`Backup unvollständig – ${fehler.length} von ${ziele.length} fehlgeschlagen: ${fehler.join(' | ')}`);

  return { backups, dateien: backups.length, cleanupWarnungen, aufgeraeumt };
}

async function cleanupFolder(drive, folderId, cutoff, label, zaehle) {
  // PFLICHT: "trashed = false" bleibt in der Abfrage. Seit dem Umstieg auf den
  // Papierkorb liegen verschobene Dateien weiter im Ordner - ohne den Filter
  // werden sie bei jedem Lauf erneut gelistet und erneut verschoben. Genau das
  // hat im September den täglichen Lauf in "User rate limit exceeded" geschickt.
  const { data } = await drive.files.list({
    q:                         `'${folderId}' in parents and trashed = false`,
    fields:                    'files(id,name,createdTime)',
    orderBy:                   'createdTime',
    pageSize:                  200,
    supportsAllDrives:         true,
    includeItemsFromAllDrives: true,
    corpora:                   'allDrives',
  });
  const toTrash = (data.files ?? [])
    .filter(f => istBackupDatei(f.name))
    .filter(f => new Date(f.createdTime) < cutoff);
  for (const f of toTrash) {
    if (await trashWithRetry(drive, f, label)) zaehle();
    await sleep(DELETE_DELAY_MS);
  }
  if (toTrash.length === 0) console.log(`  – ${label} Cleanup: nichts aufzuräumen`);
}

async function trashWithRetry(drive, f, label, attempt = 0) {
  try {
    await drive.files.update({
      fileId:            f.id,
      supportsAllDrives: true,
      requestBody:       { trashed: true },
    });
    console.log(`  ✗ ${label} in Papierkorb: ${f.name} (${String(f.createdTime).slice(0,10)})`);
    return true;
  } catch (err) {
    if (err.code === 404) {
      console.log(`  – Nicht mehr vorhanden, übersprungen: ${f.name}`);
      return false;
    }
    if (isRateLimitError(err) && attempt < MAX_DELETE_RETRIES) {
      const backoffMs = 1000 * 2 ** attempt; // 1s, 2s, 4s
      console.warn(`  … Rate limit bei ${f.name}, Retry in ${backoffMs}ms (Versuch ${attempt + 1}/${MAX_DELETE_RETRIES})`);
      await sleep(backoffMs);
      return trashWithRetry(drive, f, label, attempt + 1);
    }
    throw new Error(`${f.name}: ${err.message ?? err}`);
  }
}

// ── Direktausführung (node backend/scripts/backup-daily.js) ──────────────────
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && (process.argv[1] === __filename || __filename.endsWith(process.argv[1].replace(/\\/g, '/')))) {
  console.log('== Mission Control Backup ==');
  runBackup()
    .then(r => {
      console.log(`\nFertig: ${r.dateien} Datei(en)`);
      for (const b of r.backups) {
        console.log(`  ${b.fileName} | ${b.sizeKB} KB | ${b.tabCount} Reiter | "${b.sheetName}"`);
      }
      console.log(`  Aufgeräumt: daily ${r.aufgeraeumt.daily}, monthly ${r.aufgeraeumt.monthly}`);
      for (const w of r.cleanupWarnungen) console.log(`  WARNUNG: ${w}`);
    })
    .catch(err => { console.error('FEHLER:', err.message ?? err); process.exit(1); });
}
