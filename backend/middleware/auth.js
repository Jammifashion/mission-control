import rateLimit from 'express-rate-limit';
import { getSecret } from '../utils/secrets.js';

const OPEN_PATHS = new Set(['/health', '/api/health', '/api/health/full']);

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

export async function requireApiKey(req, res, next) {
  if (OPEN_PATHS.has(req.path)) return next();

  try {
    const key = req.headers['x-api-key'];
    const expected = await getSecret('MC_API_KEY');
    if (!key || key !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  } catch (err) {
    next(err);
  }
}
