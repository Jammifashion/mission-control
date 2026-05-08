import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });
import './scripts/check-env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { loadAllSecrets } from './utils/secrets.js';
import { apiRateLimiter, requireApiKey } from './middleware/auth.js';
import woocommerceRouter from './routes/woocommerce.js';
import claudeRouter from './routes/claude.js';
import sheetsRouter from './routes/sheets.js';
import auftragsmonitorRouter from './routes/auftragsmonitor.js';
import backupRouter from './routes/backup.js';
import systemRoutes from './routes/system.js';

// Secrets vor Express-Setup laden – stellt sicher dass process.env.CORS_ORIGIN
// (und alle anderen Secrets) bereits gesetzt sind wenn die Middleware konfiguriert wird.
await loadAllSecrets();

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security & parsing ────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'https://jammifashion.github.io').split(',').map(s => s.trim()),
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(express.json({ limit: '256kb' }));

// ── Rate limiting → Auth (Reihenfolge: rateLimiter → requireApiKey → Router) ──
app.use('/api/', apiRateLimiter);
app.use(requireApiKey);

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use('/api/woocommerce', woocommerceRouter);
app.use('/api/claude', claudeRouter);
app.use('/api/sheets', sheetsRouter);
app.use('/api/auftragsmonitor', auftragsmonitorRouter);
app.use('/api/backup', backupRouter);
app.use('/api/system', systemRoutes);
app.use('/api/health', systemRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Interner Serverfehler.' });
});

app.listen(PORT, () => {
  console.log(`Mission Control backend → http://localhost:${PORT}`);
});
