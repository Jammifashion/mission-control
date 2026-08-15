import { Router } from 'express';
import multer from 'multer';
import { getShopConfig } from '../lib/shopConfig.js';

const router = Router();

// Bilder landen im Speicher (nicht auf Platte) – werden direkt an die WP Media
// API weitergereicht. 10 MB Limit spiegelt den üblichen WP-Upload-Rahmen.
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });

// ── POST /media-upload?shop=jfn|honk ──────────────────────────────────────────
// Lädt ein Bild (multipart/form-data, Feld "file") über die WordPress Media API
// hoch (Basic Auth mit Application Password) und gibt { attachmentId, sourceUrl }
// zurück. Wird von der Artikelerfassung für Varianten-Bilder genutzt – die
// zurückgegebene attachmentId wird beim WooCommerce-Push wiederverwendet
// (kein Re-Upload nötig, dieselbe ID kann mehrfach referenziert werden).
router.post('/media-upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(413).json({ error: `Datei zu groß (max. ${MAX_FILE_SIZE / 1024 / 1024} MB).` });
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen (Feld "file" fehlt).' });

    const cfg = getShopConfig(req.query.shop);
    if (!cfg.wcUrl || !cfg.wpAppUser || !cfg.wpAppPassword)
      return res.status(503).json({ error: 'WordPress-Zugangsdaten nicht konfiguriert (WC_URL/WP_APP_PASSWORD).' });

    const auth = Buffer.from(`${cfg.wpAppUser}:${cfg.wpAppPassword}`).toString('base64');
    const filename = (req.file.originalname || 'upload.jpg').replace(/"/g, '');
    const baseUrl = cfg.wcUrl.replace(/\/$/, '');

    const wpRes = await fetch(`${baseUrl}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': req.file.mimetype || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body: req.file.buffer,
    });

    if (wpRes.status === 401)
      return res.status(401).json({ error: 'WordPress-Anmeldung fehlgeschlagen (Application Password prüfen).' });
    if (wpRes.status === 413)
      return res.status(413).json({ error: 'WordPress hat die Datei als zu groß abgelehnt.' });

    const data = await wpRes.json().catch(() => ({}));
    if (!wpRes.ok)
      return res.status(wpRes.status).json({ error: data?.message || `WordPress-Upload fehlgeschlagen (HTTP ${wpRes.status}).` });

    res.status(201).json({ attachmentId: data.id, sourceUrl: data.source_url });
  } catch (err) { next(err); }
});

export default router;
