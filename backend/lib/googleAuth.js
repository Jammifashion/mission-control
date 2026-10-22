import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
];

let cachedAuth = null;

/**
 * Returns an authenticated GoogleAuth client.
 *
 * Priority:
 *  1. GOOGLE_APPLICATION_CREDENTIALS – path to service-account JSON key file
 *  2. GOOGLE_CREDENTIALS_JSON        – raw service-account JSON string in .env
 *  3. ADC                            – Application Default Credentials fallback
 */
export async function getGoogleAuth() {
  if (cachedAuth) return cachedAuth;
  cachedAuth = googleAuthMitScopes(SCOPES);
  return cachedAuth;
}

/**
 * Dieselbe Anmeldung (gleiche Reihenfolge der Quellen) mit eigenen Scopes. Fuer Stellen, die mehr
 * oder weniger als SCOPES brauchen - z. B. das Beleg-Archiv (BO4b-2) mit drive.file.
 */
export function googleAuthMitScopes(scopes) {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    const keyPath = resolve(__dirname, '..', process.env.GOOGLE_APPLICATION_CREDENTIALS);
    const credentials = JSON.parse(readFileSync(keyPath, 'utf8'));
    return new google.auth.GoogleAuth({ credentials, scopes });
  }
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    let credentials;
    try {
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    } catch {
      throw new Error('GOOGLE_CREDENTIALS_JSON ist kein gültiges JSON.');
    }
    return new google.auth.GoogleAuth({ credentials, scopes });
  }
  return new google.auth.GoogleAuth({ scopes });
}
