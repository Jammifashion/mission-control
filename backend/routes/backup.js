import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { runBackup } from '../scripts/backup-daily.js';

const router = Router();

// ── POST /api/backup/manual ───────────────────────────────────────────────────
router.post('/manual', async (req, res, next) => {
  try {
    const result = await runBackup();
    res.json({ ok: true, message: 'Backup erfolgreich', ...result });
  } catch (err) { next(err); }
});

// ── GET /api/backup/list ──────────────────────────────────────────────────────
// Auth läuft bewusst über getGoogleAuth() – wird in Sprint 3 auf OAuth 2.0 migriert
// runBackup() nutzt eigenen Service-Account-Auth (Cron/System-Prozess, kein User-Kontext)
router.get('/list', async (req, res, next) => {
  try {
    const folderId    = process.env.GOOGLE_DRIVE_BACKUP_DAILY_ID;
    const sharedDrive = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID;
    if (!folderId || !sharedDrive) {
      return res.status(500).json({ error: 'Drive-Ordner-IDs fehlen in .env' });
    }

    const auth  = await getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    const { data } = await drive.files.list({
      q:                       `'${folderId}' in parents and trashed = false`,
      fields:                  'files(id,name,size,createdTime)',
      orderBy:                 'createdTime desc',
      pageSize:                10,
      supportsAllDrives:       true,
      includeItemsFromAllDrives: true,
      corpora:                 'drive',
      driveId:                 sharedDrive,
    });

    const files = (data.files ?? []).map(f => ({
      name:      f.name,
      sizeKB:    Math.round(parseInt(f.size ?? '0', 10) / 1024),
      createdAt: f.createdTime,
    }));

    res.json(files);
  } catch (err) { next(err); }
});

export default router;
