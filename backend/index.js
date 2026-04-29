import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import woocommerceRouter from './routes/woocommerce.js';
import claudeRouter from './routes/claude.js';
import sheetsRouter from './routes/sheets.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security & parsing ────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  methods: ['GET', 'POST'],
}));
app.use(express.json({ limit: '256kb' }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte kurz warten.' },
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use('/api/woocommerce', woocommerceRouter);
app.use('/api/claude', claudeRouter);
app.use('/api/sheets', sheetsRouter);

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
