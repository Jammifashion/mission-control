import { Router } from 'express';
import multer from 'multer';
import { ladeMedienHoch } from '../lib/wpMedien.js';

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

    // lib/wpMedien.js: Zeitlimit 60 s (Schreiben), Pruefseite -> HosterPruefseiteError.
    const { ok, status, data, fehlt } = await ladeMedienHoch({
      shop: req.query.shop, buffer: req.file.buffer,
      dateiname: req.file.originalname, mimetype: req.file.mimetype,
    });
    if (fehlt)
      return res.status(503).json({ error: 'WordPress-Zugangsdaten nicht konfiguriert (WC_URL/WP_APP_PASSWORD).' });
    if (status === 401)
      return res.status(401).json({ error: 'WordPress-Anmeldung fehlgeschlagen (Application Password prüfen).' });
    if (status === 413)
      return res.status(413).json({ error: 'WordPress hat die Datei als zu groß abgelehnt.' });
    if (!ok)
      return res.status(status).json({ error: data?.message || `WordPress-Upload fehlgeschlagen (HTTP ${status}).` });

    res.status(201).json({ attachmentId: data.id, sourceUrl: data.source_url });
  } catch (err) { next(err); }
});

export default router;
