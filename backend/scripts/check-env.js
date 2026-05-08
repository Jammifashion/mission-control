import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

const REQUIRED = [
  'ANTHROPIC_API_KEY',
  'WC_KEY',
  'WC_SECRET',
  'WC_URL',
  'GOOGLE_SHEET_ID',
  'GOOGLE_PROJECT_ID',
];

if (process.env.NODE_ENV === 'production') {
  // In production kein .env – Secrets kommen via loadAllSecrets() aus GCP Secret Manager.
  // Nur GOOGLE_PROJECT_ID muss als Cloud Run Env-Var gesetzt sein (wird für SM benötigt).
  if (!process.env.GOOGLE_PROJECT_ID) {
    console.error('✗ GOOGLE_PROJECT_ID fehlt – wird für Google Secret Manager benötigt');
    process.exit(1);
  }
} else {
  const missing = REQUIRED.filter(key => !process.env[key]);
  if (missing.length > 0) {
    for (const key of missing) console.error(`✗ ENV fehlt: ${key}`);
    process.exit(1);
  }
  console.log('✓ ENV check passed');
}
